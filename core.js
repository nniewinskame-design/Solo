/* Solo: nuty z obrazka, bez fortepianu, w Twoim kluczu i tonacji.
   Everything runs in the browser; nothing about the music leaves the device. */
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const xesc = esc;
const store = {
  get(k, d = null) { try { const v = localStorage.getItem("solo:" + k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("solo:" + k, v); } catch {} }
};
function hud(msg, ms = 2400) {
  const h = $("#toast"); if (!h) return;
  h.textContent = msg; h.classList.add("show");
  clearTimeout(hud._t); hud._t = setTimeout(() => h.classList.remove("show"), ms);
}
/* ---------------- Music theory helpers ---------------- */
const LETTERS = "CDEFGAB";
const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function lofToPitch(p) { // line of fifths position (C=0, G=1, F=-1) -> {letter, alter}
  const idx = (((p + 1) % 7) + 7) % 7;
  return { letter: "FCGDAEB"[idx], alter: Math.floor((p + 1) / 7) };
}
function plName(letter, alter) {
  if (letter === "B") {
    if (alter === -1) return "B";
    if (alter === -2) return "Heses";
    return "H" + (alter === 1 ? "is" : alter === 2 ? "isis" : "");
  }
  if (alter === 0) return letter;
  if (alter === -1) return letter === "E" ? "Es" : letter === "A" ? "As" : letter + "es";
  if (alter === -2) return letter === "E" ? "Eses" : letter === "A" ? "Ases" : letter + "eses";
  if (alter === 1) return letter + "is";
  return letter + "isis";
}
function keyName(fifths, mode) {
  const minor = mode === "minor";
  const t = lofToPitch(fifths + (minor ? 3 : 0));
  const n = plName(t.letter, t.alter);
  return minor ? n.toLowerCase() + "-moll" : n + "-dur";
}
function keySigLabel(f) { return f === 0 ? "bez znaków" : f > 0 ? f + "♯" : (-f) + "♭"; }
const PERFECT = { 0: 0, 3: 5, 4: 7 };
const MAJOR = { 1: 2, 2: 4, 5: 9, 6: 11 };
// interval: {d: signed diatonic steps, s: signed semitones}
function intervalFifths(iv) { return 7 * iv.s - 12 * iv.d; }
function intervalParts(iv) {
  const sign = (iv.d < 0 || (iv.d === 0 && iv.s < 0)) ? -1 : 1;
  const ad = Math.abs(iv.d), as = sign * iv.s;
  const steps = ad % 7, octs = Math.floor(ad / 7);
  const r = as - 12 * octs;
  let q;
  if (steps in PERFECT) { const df = r - PERFECT[steps]; q = df === 0 ? "P" : df === 1 ? "A" : df === -1 ? "d" : df === 2 ? "AA" : "dd"; }
  else { const df = r - MAJOR[steps]; q = df === 0 ? "M" : df === -1 ? "m" : df === 1 ? "A" : df === -2 ? "d" : df === 2 ? "AA" : "dd"; }
  return { sign, q, num: ad + 1 };
}
function intervalString(iv) {
  if (iv.d === 0 && iv.s === 0) return "";
  const p = intervalParts(iv);
  return (p.sign < 0 ? "-" : "+") + p.q + p.num;
}
const NUM_ACC = ["", "prymę", "sekundę", "tercję", "kwartę", "kwintę", "sekstę", "septymę", "oktawę", "nonę", "decymę", "undecymę", "duodecymę", "tercdecymę", "kwartdecymę", "dwie oktawy"];
const Q_ACC = { P: "czystą", M: "wielką", m: "małą", A: "zwiększoną", d: "zmniejszoną", AA: "dwukrotnie zwiększoną", dd: "dwukrotnie zmniejszoną" };
function intervalPl(iv) {
  if (iv.d === 0 && iv.s === 0) return "bez przenoszenia";
  const p = intervalParts(iv);
  let name;
  if (p.num === 8 && p.q === "P") name = "oktawę";
  else if (p.num === 15 && p.q === "P") name = "dwie oktawy";
  else if (p.num === 22 && p.q === "P") name = "trzy oktawy";
  else name = (NUM_ACC[p.num] || (p.num + ". stopień")) + " " + Q_ACC[p.q];
  return "o " + name + (p.sign < 0 ? " w dół" : " w górę");
}
function fixEnharmonic(iv, srcFifths) {
  let r = { ...iv };
  let f = srcFifths + intervalFifths(r);
  if (f > 7) { r.d += 1; } else if (f < -7) { r.d -= 1; }
  return r;
}
// Build interval from source key + target key + direction + octave shift
function intervalFromKeys(srcF, dstF, mode, dir, oct) {
  const off = mode === "minor" ? 3 : 0;
  const a = lofToPitch(srcF + off), b = lofToPitch(dstF + off);
  let d = (LETTERS.indexOf(b.letter) - LETTERS.indexOf(a.letter) + 7) % 7;
  let s = ((LETTER_PC[b.letter] + b.alter) - (LETTER_PC[a.letter] + a.alter));
  // normalize s to fit d (upward interval)
  const exp = [0, 2, 4, 5, 7, 9, 11][d];
  s = exp + ((((s - exp) % 12) + 18) % 12) - 6;
  if (dir === "down" && !(d === 0 && s === 0)) {
    if (d === 0) { s = s - 12; d = -7; } else { d = d - 7; s = s - 12; }
  }
  d += 7 * oct; s += 12 * oct;
  return { d, s };
}
// Inverse: interval -> {dstF, dir, oct}
function keysFromInterval(iv, srcF) {
  const dstF = srcF + intervalFifths(iv);
  const base = intervalFromKeys(srcF, dstF, "major", "up", 0);
  if (base.d === 0 && base.s === 0) return { dstF, dir: "up", oct: Math.round(iv.d / 7) };
  const k = Math.round((iv.d - base.d) / 7);
  if (k >= 0) return { dstF, dir: "up", oct: k };
  return { dstF, dir: "down", oct: k + 1 };
}


/* ---------------- MusicXML handling ---------------- */
function parseXml(str) {
  const doc = new DOMParser().parseFromString(str, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("To nie wygląda na poprawny plik MusicXML.");
  return doc;
}
function kids(el, name) { return Array.from(el.children).filter(c => c.tagName === name); }
function kid(el, name) { return kids(el, name)[0] || null; }
function txt(el, name) { const k = el && kid(el, name); return k ? k.textContent.trim() : ""; }
function clefNameOf(clefEl) {
  if (!clefEl) return null;
  const sign = txt(clefEl, "sign"), line = txt(clefEl, "line");
  if (sign === "G") return "treble";
  if (sign === "F") return "bass";
  if (sign === "C") return line === "4" ? "tenor" : line === "3" ? "alto" : "c" + line;
  return null;
}
const PIANO_RE = /piano|fortepian|klavier|pianoforte|^pf\.?$|^pno\.?$|klaw|keyboard|organ|organy|akompan|accomp|harf|harp|cembal/i;
function analyseXml(xml) {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  if (root.tagName !== "score-partwise") throw new Error("Ten rodzaj pliku MusicXML (timewise) nie jest obsługiwany. Zapisz go w programie jeszcze raz jako zwykły MusicXML.");
  const names = {};
  $$("part-list > score-part", doc).forEach(sp => { names[sp.getAttribute("id")] = txt(sp, "part-name") || txt(sp, "part-abbreviation") || "Głos"; });
  const parts = kids(root, "part").map(p => {
    const id = p.getAttribute("id");
    let staves = 1; const st = p.getElementsByTagName("staves")[0]; if (st) staves = parseInt(st.textContent, 10) || 1;
    const clefEl = p.getElementsByTagName("clef")[0];
    const trEl = p.getElementsByTagName("transpose")[0];
    const transp = trEl ? parseInt(txt(trEl, "chromatic") || "0", 10) : 0;
    const name = names[id] || "Głos";
    const isPiano = staves > 1 || PIANO_RE.test(name);
    return { id, name, staves, keep: !isPiano, clef: clefNameOf(clefEl) || "treble", transp };
  });
  if (!parts.some(p => p.keep)) parts.forEach(p => (p.keep = true));
  let fifths = 0, mode = "major";
  const firstKept = parts.find(p => p.keep);
  const pEl = firstKept && kids(root, "part").find(p => p.getAttribute("id") === firstKept.id);
  const keyEl = pEl && pEl.getElementsByTagName("key")[0];
  if (keyEl) { fifths = parseInt(txt(keyEl, "fifths") || "0", 10) || 0; mode = txt(keyEl, "mode") === "minor" ? "minor" : "major"; }
  let title = txt(kid(root, "work") || root, "work-title") || txt(root, "movement-title");
  if (!title) { const c = $$("credit credit-words", doc)[0]; if (c) title = c.textContent.trim(); }
  const ident = kid(root, "identification");
  const composer = ident ? (Array.from(ident.getElementsByTagName("creator")).find(c => c.getAttribute("type") === "composer")?.textContent.trim() || "") : "";
  return { parts, key: { fifths, mode }, title, composer };
}
function processedXml() {
  const doc = addAccidentals(parseXml(S.piece.xml));
  const root = doc.documentElement;
  const keep = new Set(S.parts.filter(p => p.keep).map(p => p.id));
  const removed = S.parts.some(p => !p.keep);
  kids(root, "part").forEach(p => { if (!keep.has(p.getAttribute("id"))) p.remove(); });
  const pl = kid(root, "part-list");
  if (pl) {
    kids(pl, "score-part").forEach(sp => { if (!keep.has(sp.getAttribute("id"))) sp.remove(); });
    if (removed) kids(pl, "part-group").forEach(g => g.remove());
  }
  // title/composer from the editable fields
  let work = kid(root, "work");
  if (!work) { work = doc.createElement("work"); root.insertBefore(work, root.firstChild); }
  let wt = kid(work, "work-title"); if (!wt) { wt = doc.createElement("work-title"); work.appendChild(wt); }
  wt.textContent = S.piece.title || "";
  kids(root, "movement-title").forEach(m => m.remove());
  kids(root, "credit").forEach(c => c.remove());
  let ident = kid(root, "identification");
  if (!ident) { ident = doc.createElement("identification"); work.after(ident); }
  Array.from(ident.getElementsByTagName("creator")).filter(c => c.getAttribute("type") === "composer").forEach(c => c.remove());
  if (S.piece.composer) { const c = doc.createElement("creator"); c.setAttribute("type", "composer"); c.textContent = S.piece.composer; ident.insertBefore(c, ident.firstChild); }
  // Page header as credits: big centred title, two spacer rows, then instrument (left) and composer (right).
  // The spacer rows give room for the enlarged title (see enlargeTitle in app.js).
  const plEl = kid(root, "part-list");
  const credit = (txtv, x, y, just) => {
    const c = doc.createElement("credit"); c.setAttribute("page", "1");
    const w = doc.createElement("credit-words");
    w.setAttribute("default-x", String(x)); w.setAttribute("default-y", String(y)); w.setAttribute("justify", just); w.setAttribute("valign", "top");
    w.textContent = txtv; c.appendChild(w); root.insertBefore(c, plEl);
  };
  // Verovio stacks each column (left / centre / right) on its own, so every column gets two spacer rows.
  credit(S.piece.title || "Bez tytułu", 1050, 2850, "center");
  credit("\u00a0", 1050, 2780, "center");
  credit("\u00a0", 1050, 2740, "center");
  [[150, "left", S.piece.instrument], [1950, "right", S.piece.composer]].forEach(([x, j, t]) => {
    credit("\u00a0", x, 2800, j); credit("\u00a0", x, 2760, j); credit(t || "\u00a0", x, 2700, j);
  });
  // the solo part is named after the instrument in the header, so the score never says two different things
  const soloInfo = S.parts.find(p => !(p.staves > 1 || PIANO_RE.test(p.name)));
  if (pl && soloInfo && S.piece.instrument) {
    const sp = kids(pl, "score-part").find(x => x.getAttribute("id") === soloInfo.id);
    if (sp) {
      let pn = kid(sp, "part-name");
      if (!pn) { pn = doc.createElement("part-name"); sp.insertBefore(pn, sp.firstChild); }
      pn.textContent = S.piece.instrument;
      ["part-abbreviation", "part-name-display", "part-abbreviation-display"].forEach(t => { const e = kid(sp, t); if (e) e.remove(); });
    }
  }
  // single visible part: don't repeat its name at the first system (it is in the header)
  const keptParts = kids(root, "part");
  if (pl && keptParts.length === 1) kids(pl, "score-part").forEach(sp => { const pn = kid(sp, "part-name"); if (pn) pn.setAttribute("print-object", "no"); });
  // clef change
  if (S.clef !== "keep") {
    const map = { treble: ["G", "2"], bass: ["F", "4"], tenor: ["C", "4"], alto: ["C", "3"] }[S.clef];
    kids(root, "part").forEach(p => {
      const info = S.parts.find(x => x.id === p.getAttribute("id"));
      if (!info || info.staves > 1) return;
      const clefs = Array.from(p.getElementsByTagName("clef"));
      clefs.forEach(c => {
        const n = c.getAttribute("number"); if (n && n !== "1") return;
        let sign = kid(c, "sign"), line = kid(c, "line");
        if (!sign) { sign = doc.createElement("sign"); c.appendChild(sign); }
        sign.textContent = map[0];
        if (!line) { line = doc.createElement("line"); sign.after(line); }
        line.textContent = map[1];
        kids(c, "clef-octave-change").forEach(x => x.remove());
      });
      if (!clefs.length) {
        const m1 = kid(p, "measure"); if (!m1) return;
        let at = kid(m1, "attributes"); if (!at) { at = doc.createElement("attributes"); m1.insertBefore(at, m1.firstChild); }
        const c = doc.createElement("clef"); c.innerHTML = "";
        const sg = doc.createElement("sign"); sg.textContent = map[0]; const ln = doc.createElement("line"); ln.textContent = map[1];
        c.appendChild(sg); c.appendChild(ln);
        const before = kid(at, "staff-details") || kid(at, "transpose") || kid(at, "directive") || kid(at, "measure-style");
        before ? at.insertBefore(c, before) : at.appendChild(c);
      }
    });
  }
  return new XMLSerializer().serializeToString(doc);
}

/* Write the interval into the MusicXML itself (used for exporting the file to other programs). */
function transposeXmlString(xml, iv) {
  if (!iv || (iv.d === 0 && iv.s === 0)) return xml;
  const doc = parseXml(xml);
  const df = intervalFifths(iv);
  Array.from(doc.getElementsByTagName("pitch")).forEach(p => {
    const st = kid(p, "step"), oc = kid(p, "octave"); if (!st || !oc) return;
    let al = kid(p, "alter");
    const L = st.textContent.trim(), O = parseInt(oc.textContent, 10), A = al ? parseFloat(al.textContent) || 0 : 0;
    const idx = LETTERS.indexOf(L) + 7 * O + iv.d;
    const nl = LETTERS[((idx % 7) + 7) % 7], no = Math.floor(idx / 7);
    const target = LETTER_PC[L] + A + 12 * O + iv.s;
    const na = target - (LETTER_PC[nl] + 12 * no);
    st.textContent = nl; oc.textContent = String(no);
    if (na) { if (!al) { al = doc.createElement("alter"); st.after(al); } al.textContent = String(na); }
    else if (al) al.remove();
  });
  Array.from(doc.getElementsByTagName("key")).forEach(k => { const f = kid(k, "fifths"); if (f) f.textContent = String((parseInt(f.textContent, 10) || 0) + df); });
  Array.from(doc.getElementsByTagName("accidental")).forEach(a => a.remove());
  Array.from(doc.getElementsByTagName("transpose")).forEach(t => t.remove());
  return new XMLSerializer().serializeToString(doc);
}

/* ---------------- On-device reading (homr) -> Solo ----------------
   homr writes a score as it sees it: a two-staff part ("brace") for anything it takes for a
   grand staff, single-staff parts otherwise. Solo wants one part per staff, top staff first,
   so the solo line can be kept and the accompaniment hidden. */
function splitHomrParts(doc) {
  const root = doc.documentElement, out = [];
  kids(root, "part").forEach(p => {
    const stEl = p.getElementsByTagName("staves")[0];
    const staves = stEl ? parseInt(stEl.textContent, 10) || 1 : 1;
    for (let s = 1; s <= staves; s++) {
      const np = staves === 1 ? p : p.cloneNode(true);
      let div = 1, beats = 4, beatType = 4;
      kids(np, "measure").forEach(m => {
        if (staves > 1) {
          Array.from(m.getElementsByTagName("staves")).forEach(e => e.remove());
          Array.from(m.getElementsByTagName("part-symbol")).forEach(e => e.remove());
          Array.from(m.getElementsByTagName("clef")).forEach(c => { if ((c.getAttribute("number") || "1") !== String(s)) c.remove(); else c.removeAttribute("number"); });
        }
        const d = m.getElementsByTagName("divisions")[0]; if (d) div = parseFloat(d.textContent) || div;
        const bt = m.getElementsByTagName("beats")[0], bty = m.getElementsByTagName("beat-type")[0];
        if (bt) beats = parseInt(bt.textContent, 10) || beats; if (bty) beatType = parseInt(bty.textContent, 10) || beatType;
        let voice = null, count = 0;
        [...m.children].forEach(ch => {
          if (ch.tagName === "backup" || ch.tagName === "forward") { ch.remove(); return; }
          if (ch.tagName === "direction") { const sf = txt(ch, "staff"); if (sf && sf !== String(s)) ch.remove(); else kids(ch, "staff").forEach(e => e.remove()); return; }
          if (ch.tagName !== "note") return;
          if ((txt(ch, "staff") || "1") !== String(s)) { ch.remove(); return; }
          const v = txt(ch, "voice") || "1";
          if (voice === null) voice = v;
          if (v !== voice) { ch.remove(); return; }
          kids(ch, "staff").forEach(e => e.remove());
          count++;
        });
        if (!count) {
          const n = doc.createElement("note");
          n.innerHTML = `<rest measure="yes"/><duration>${Math.round(div * beats * 4 / beatType)}</duration><voice>1</voice>`;
          const bar = kid(m, "barline"); bar && bar.getAttribute("location") === "right" ? m.insertBefore(n, bar) : m.appendChild(n);
        }
      });
      out.push(np);
    }
  });
  return out;
}
function homrToSolo(xmlPages, title) {
  const pages = xmlPages.map(x => { const doc = parseXml(x); return { doc, parts: splitHomrParts(doc) }; });
  const base = pages[0];
  const sameShape = pages.every(p => p.parts.length === base.parts.length);
  let parts = sameShape ? base.parts : [base.parts[0]];
  pages.slice(1).forEach(pg => {
    parts.forEach((part, i) => kids(pg.parts[i], "measure").forEach((m, k) => {
      const nm = part.appendChild(base.doc.importNode(m, true));
      if (k === 0 && !nm.getElementsByTagName("print").length) { const pr = base.doc.createElement("print"); pr.setAttribute("new-system", "yes"); nm.insertBefore(pr, nm.firstChild); }
    }));
  });
  const root = base.doc.documentElement;
  kids(root, "part").forEach(p => p.remove());
  let pl = kid(root, "part-list"); if (pl) pl.remove();
  pl = base.doc.createElement("part-list");
  const n = parts.length;
  const names = n === 1 ? ["Głos solowy"] : n === 2 ? ["Głos solowy", "Akompaniament"] : ["Głos solowy", ...parts.slice(1).map((_, i) => i === 0 ? "Fortepian, prawa ręka" : i === 1 ? "Fortepian, lewa ręka" : "Fortepian " + (i + 1))];
  parts.forEach((p, i) => {
    const id = "P" + (i + 1); p.setAttribute("id", id);
    const sp = base.doc.createElement("score-part"); sp.setAttribute("id", id);
    const nm = base.doc.createElement("part-name"); nm.textContent = names[i]; sp.appendChild(nm); pl.appendChild(sp);
    kids(p, "measure").forEach((m, k) => m.setAttribute("number", String(k + 1)));
  });
  const after = kid(root, "identification") || kid(root, "work") || null;
  root.insertBefore(pl, after ? after.nextSibling : root.firstChild);
  parts.forEach(p => root.appendChild(p));
  let work = kid(root, "work"); if (!work) { work = base.doc.createElement("work"); root.insertBefore(work, root.firstChild); }
  let wt = kid(work, "work-title"); if (!wt) { wt = base.doc.createElement("work-title"); work.appendChild(wt); }
  if (!wt.textContent.trim()) wt.textContent = title || "";
  return new XMLSerializer().serializeToString(base.doc);
}

/* ---------------- Checking a reading (T15) ----------------
   The reader is never perfect, so Solo corrects what it safely can and marks the rest:
   - the user's answers before reading (clef, metre, key) override what was read;
   - metre changes that keep the bar length (2/2 among 4/4, a misread "C") are dropped;
   - bars that don't add up to the metre, and lone octave jumps, are listed as "Takt n: ...". */
const CLEF_BOTTOM = { G: 30, F: 18, C3: 24, C4: 22 };          // diatonic index (octave*7+step) of the bottom staff line
const STEP_I = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 }, STEP_N = "CDEFGAB";
const SHARPS = "FCGDAEB", FLATS = "BEADGCF";
function keyAlter(fifths, step) {
  if (fifths > 0) return SHARPS.slice(0, fifths).includes(step) ? 1 : 0;
  if (fifths < 0) return FLATS.slice(0, -fifths).includes(step) ? -1 : 0;
  return 0;
}
function clefId(c) { const s = txt(c, "sign"), l = txt(c, "line"); return s === "C" ? "C" + (l || "3") : s; }
/* T33: the reader knows a note is E-flat but writes no accidental sign, so Verovio drew a plain E
   (this is what looked like "flats are not read"). Add the signs as they are printed: against the key,
   once per bar and line position. Safe to run on any score: notes that already have a sign are kept. */
const ACC_BY_ALTER = { "-2": "flat-flat", "-1": "flat", "0": "natural", "1": "sharp", "2": "double-sharp" };
function addAccidentals(doc) {
  Array.from(doc.getElementsByTagName("part")).forEach(part => {
    let fifths = 0;
    kids(part, "measure").forEach(m => {
      kids(m, "attributes").forEach(a => { const k = kid(a, "key"); if (k) fifths = parseInt(txt(k, "fifths"), 10) || 0; });
      const state = new Map();
      kids(m, "note").forEach(n => {
        const p = kid(n, "pitch"); if (!p) return;
        const step = txt(p, "step"), key = step + txt(p, "octave"), alt = Math.round(parseFloat(txt(p, "alter")) || 0);
        const cur = state.has(key) ? state.get(key) : keyAlter(fifths, step);
        state.set(key, alt);
        if (kid(n, "accidental") || alt === cur || !ACC_BY_ALTER[String(alt)]) return;
        const acc = doc.createElement("accidental"); acc.textContent = ACC_BY_ALTER[String(alt)];
        const after = kids(n, "dot").pop() || kid(n, "type");
        if (after) n.insertBefore(acc, after.nextSibling); else n.insertBefore(acc, kid(n, "notations") || kid(n, "stem") || null);
      });
    });
  });
  return doc;
}
function checkReading(xml, ans = {}) {
  const doc = parseXml(xml), issues = [];
  const parts = Array.from(doc.getElementsByTagName("part"));
  parts.forEach((part, pi) => {
    /* a multi-bar rest must be followed by its empty bars (MusicXML), or the bars after it disappear from view */
    let dv = 1, bts = 4, btt = 4;
    kids(part, "measure").forEach(m => {
      kids(m, "attributes").forEach(a => {
        const d = kid(a, "divisions"); if (d) dv = parseFloat(d.textContent) || dv;
        const t = kid(a, "time"); if (t) { bts = parseInt(txt(t, "beats"), 10) || bts; btt = parseInt(txt(t, "beat-type"), 10) || btt; }
      });
      const mr = m.getElementsByTagName("multiple-rest")[0]; if (!mr) return;
      const n = parseInt(mr.textContent, 10) || 1; let after = m;
      for (let k = 1; k < n; k++) {
        const e = doc.createElement("measure");
        e.innerHTML = `<note><rest measure="yes"/><duration>${Math.round(dv * bts * 4 / btt)}</duration><voice>1</voice></note>`;
        after.parentNode.insertBefore(e, after.nextSibling); after = e;
      }
    });
    kids(part, "measure").forEach((m, k) => m.setAttribute("number", String(k + 1)));
    const measures = kids(part, "measure");
    /* metre */
    const times = [];
    measures.forEach(m => kids(m, "attributes").forEach(a => kids(a, "time").forEach(t => times.push(t))));
    const len = t => (parseInt(txt(t, "beats"), 10) || 4) * 4 / (parseInt(txt(t, "beat-type"), 10) || 4);
    let want = null;
    if (ans.time) want = ans.time.split("/").map(Number);
    else if (times.length > 1 && times.every(t => len(t) === len(times[0]))) {
      const four = times.find(t => txt(t, "beats") === "4" && txt(t, "beat-type") === "4");
      const t0 = four || times[0]; want = [parseInt(txt(t0, "beats"), 10), parseInt(txt(t0, "beat-type"), 10)];
    }
    if (want && measures.length) {
      times.forEach(t => t.remove());
      let a = kids(measures[0], "attributes").find(x => kid(x, "key") || kid(x, "clef")) || kids(measures[0], "attributes")[0];
      if (!a) { a = doc.createElement("attributes"); measures[0].insertBefore(a, measures[0].firstChild); }
      const t = doc.createElement("time"); t.innerHTML = `<beats>${want[0]}</beats><beat-type>${want[1]}</beat-type>`;
      const after = kid(a, "key"); after ? a.insertBefore(t, after.nextSibling) : a.insertBefore(t, kid(a, "clef") || null);
    }
    /* key and clef from the answers: keep every note on its printed line, recompute what the key implies */
    let readKey = 0, clef = "F";
    const targetClef = pi === 0 && ans.clef ? ans.clef : null, targetKey = pi === 0 && ans.key != null && ans.key !== "" ? +ans.key : null;
    measures.forEach(m => {
      kids(m, "attributes").forEach(a => {
        const k = kid(a, "key"); if (k) { readKey = parseInt(txt(k, "fifths"), 10) || 0; if (targetKey !== null) kid(k, "fifths").textContent = String(targetKey); }
        kids(a, "clef").forEach(c => {
          clef = clefId(c);
          if (targetClef) { const [sg, ln] = targetClef === "G" ? ["G", 2] : targetClef === "F" ? ["F", 4] : ["C", targetClef.slice(1)]; c.innerHTML = `<sign>${sg}</sign><line>${ln}</line>`; }
        });
      });
      if (targetKey !== null && !kids(part, "measure")[0].getElementsByTagName("key").length && m === measures[0]) {
        let a = kids(m, "attributes")[0]; if (!a) { a = doc.createElement("attributes"); m.insertBefore(a, m.firstChild); }
        const k = doc.createElement("key"); k.innerHTML = `<fifths>${targetKey}</fifths>`; a.insertBefore(k, a.firstChild);
      }
      const shift = targetClef && CLEF_BOTTOM[clef] != null ? CLEF_BOTTOM[targetClef] - CLEF_BOTTOM[clef] : 0;
      const newKey = targetKey !== null ? targetKey : readKey;
      if (!shift && newKey === readKey) return;
      kids(m, "note").forEach(n => {
        const p = kid(n, "pitch"); if (!p) return;
        const step = txt(p, "step"), oct = parseInt(txt(p, "octave"), 10), alt = parseFloat(txt(p, "alter")) || 0;
        const fromKey = alt === keyAlter(readKey, step);
        const idx = oct * 7 + STEP_I[step] + shift, ns = STEP_N[((idx % 7) + 7) % 7], no = Math.floor(idx / 7);
        kid(p, "step").textContent = ns; kid(p, "octave").textContent = String(no);
        const na = fromKey ? keyAlter(newKey, ns) : alt;
        let al = kid(p, "alter");
        if (na) { if (!al) { al = doc.createElement("alter"); p.insertBefore(al, kid(p, "octave")); } al.textContent = String(na); }
        else if (al) al.remove();
      });
    });
    if (pi !== 0) return;
    /* bars that don't add up */
    let div = 1, beats = 4, bt = 4;
    const midis = [];
    measures.forEach((m, i) => {
      kids(m, "attributes").forEach(a => {
        const d = kid(a, "divisions"); if (d) div = parseFloat(d.textContent) || div;
        const t = kid(a, "time"); if (t) { beats = parseInt(txt(t, "beats"), 10) || beats; bt = parseInt(txt(t, "beat-type"), 10) || bt; }
      });
      let sum = 0, whole = false;
      kids(m, "note").forEach(n => {
        if (kid(n, "chord") || kid(n, "grace")) return;
        sum += parseFloat(txt(n, "duration")) || 0;
        const r = kid(n, "rest"); if (r && r.getAttribute("measure") === "yes") whole = true;
        const p = kid(n, "pitch");
        if (p) midis.push({ i, m: 12 * (parseInt(txt(p, "octave"), 10) + 1) + [0, 2, 4, 5, 7, 9, 11][STEP_I[txt(p, "step")]] + (parseFloat(txt(p, "alter")) || 0) });
      });
      const full = div * beats * 4 / bt;
      const pickup = (i === 0 || i === measures.length - 1) && sum < full;
      if (!whole && !m.getElementsByTagName("multiple-rest").length && sum > 0 && Math.abs(sum - full) > 0.01 && !pickup)
        issues.push(`Takt ${i + 1}: ${sum > full ? "za dużo" : "za mało"} wartości rytmicznych`);
    });
    /* a single note an octave away from both neighbours */
    for (let k = 1; k < midis.length - 1; k++) {
      const a = midis[k - 1].m, b = midis[k].m, c = midis[k + 1].m;
      if (Math.abs(b - a) >= 12 && Math.abs(b - c) >= 12 && Math.abs(a - c) <= 7) issues.push(`Takt ${midis[k].i + 1}: nuta może być o oktawę ${b < a ? "za nisko" : "za wysoko"}`);
    }
  });
  addAccidentals(doc);
  issues.sort((a, b) => parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10));
  return { xml: new XMLSerializer().serializeToString(doc), issues };
}
/* bar numbers in the order Verovio draws them: a multi-bar rest is drawn as one measure */
function drawnBars(xml) {
  const part = parseXml(xml).getElementsByTagName("part")[0]; if (!part) return [];
  const out = []; let skip = 0;
  kids(part, "measure").forEach((m, i) => {
    if (skip > 0) { skip--; return; }
    out.push(i + 1);
    const mr = m.getElementsByTagName("multiple-rest")[0]; if (mr) skip = Math.max(0, (parseInt(mr.textContent, 10) || 1) - 1);
  });
  return out;
}
/* bars of the first part that don't add up to their metre (also used after editing) */
function barIssues(xml) {
  const part = parseXml(xml).getElementsByTagName("part")[0], out = []; if (!part) return out;
  const ms = kids(part, "measure"); let div = 1, beats = 4, bt = 4;
  ms.forEach((m, i) => {
    kids(m, "attributes").forEach(a => {
      const d = kid(a, "divisions"); if (d) div = parseFloat(d.textContent) || div;
      const t = kid(a, "time"); if (t) { beats = parseInt(txt(t, "beats"), 10) || beats; bt = parseInt(txt(t, "beat-type"), 10) || bt; }
    });
    let sum = 0, whole = false;
    kids(m, "note").forEach(n => { if (kid(n, "chord") || kid(n, "grace")) return; sum += parseFloat(txt(n, "duration")) || 0; const r = kid(n, "rest"); if (r && r.getAttribute("measure") === "yes") whole = true; });
    const full = div * beats * 4 / bt, pickup = (i === 0 || i === ms.length - 1) && sum < full;
    if (!whole && !m.getElementsByTagName("multiple-rest").length && sum > 0 && Math.abs(sum - full) > 0.01 && !pickup)
      out.push(`Takt ${i + 1}: ${sum > full ? "za dużo" : "za mało"} wartości rytmicznych`);
  });
  return out;
}
/* T19: an empty piece to write your own tune: bass clef (trombone), 4/4, C major, 8 empty bars */
function blankXml(bars = 8) {
  let m = "";
  for (let i = 1; i <= bars; i++) m += `<measure number="${i}">${i === 1 ? `<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes>` : ""}<note><rest measure="yes"/><duration>16</duration><voice>1</voice></note></measure>`;
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>Moje nuty</work-title></work><part-list><score-part id="P1"><part-name>Głos solowy</part-name></score-part></part-list><part id="P1">${m}</part></score-partwise>`;
}
function doubtfulBars(issues) { return [...new Set((issues || []).map(t => parseInt((t.match(/Takt (\d+)/) || [])[1], 10)).filter(Boolean))]; }

/* ---------------- AI JSON -> MusicXML ---------------- */
const DIV = 24;
const BASE = { "1": 96, "2": 48, "4": 24, "8": 12, "16": 6, "32": 3, "64": 1.5 };
const TYPE = { "1": "whole", "2": "half", "4": "quarter", "8": "eighth", "16": "16th", "32": "32nd", "64": "64th" };
const ACC_ALTER = { "#": 1, "b": -1, "n": 0, "x": 2, "##": 2, "bb": -2 };
const ACC_NAME = { "#": "sharp", "b": "flat", "n": "natural", "x": "double-sharp", "##": "double-sharp", "bb": "flat-flat" };
const CLEF_XML = { treble: ["G", 2], bass: ["F", 4], tenor: ["C", 4], alto: ["C", 3] };
const DYNS = ["pppp", "ppp", "pp", "p", "mp", "mf", "f", "ff", "fff", "ffff", "sf", "sfz", "sffz", "fp", "fz", "rf", "rfz", "sfp", "sfpp"];
function keyAlter(fifths, step) {
  if (fifths > 0) return "FCGDAEB".slice(0, fifths).includes(step) ? 1 : 0;
  if (fifths < 0) return "BEADGCF".slice(0, -fifths).includes(step) ? -1 : 0;
  return 0;
}
function parseTime(t) {
  if (!t) return null;
  t = String(t).trim();
  if (t === "C" || t === "c") return { beats: 4, type: 4, symbol: "common" };
  if (t === "C|" || t === "¢") return { beats: 2, type: 2, symbol: "cut" };
  const m = t.match(/^(\d+)\s*\/\s*(\d+)$/); if (!m) return null;
  return { beats: +m[1], type: +m[2] };
}
function noteDur(n) {
  let b = BASE[String(n.d)] ?? 24;
  let dur = b, add = b;
  for (let i = 0; i < (n.dots || 0); i++) { add /= 2; dur += add; }
  if (n.tup) dur = dur * 2 / 3;
  return dur;
}
function aiToMusicXml(j) {
  const issues = [];
  let fifths = Number.isFinite(+j.key) ? +j.key : 0;
  let time = parseTime(j.time) || { beats: 4, type: 4 };
  let clef = CLEF_XML[j.clef] ? j.clef : "treble";
  const measuresIn = Array.isArray(j.measures) ? j.measures : [];
  // expand multirests
  const ms = [];
  measuresIn.forEach((m, i) => {
    const r = parseInt(m.rest, 10);
    if (r > 0 && (!m.notes || !m.notes.length)) {
      for (let k = 0; k < r; k++) ms.push({ ...m, notes: [{ p: "R", d: "m" }], _multi: k === 0 ? r : 0, _multiEnd: k === r - 1 });
    } else ms.push({ ...m });
  });
  let out = "";
  let num = (ms[0] && ms[0].pickup) ? 0 : 1;
  let prevTie = null; // {step, oct, alter}
  // volta grouping
  ms.forEach((m, i) => { m._voltaStart = m.volta && (!ms[i - 1] || ms[i - 1].volta !== m.volta); m._voltaEnd = m.volta && (!ms[i + 1] || ms[i + 1].volta !== m.volta); });
  ms.forEach((m, mi) => {
    let attrs = "";
    if (mi === 0 || m.key !== undefined || m.time || m.clef || m._multi) {
      let a = "";
      if (mi === 0) a += `<divisions>${DIV}</divisions>`;
      if (m.key !== undefined && Number.isFinite(+m.key)) fifths = +m.key;
      if (mi === 0 || m.key !== undefined) a += `<key><fifths>${fifths}</fifths></key>`;
      const nt = parseTime(m.time); if (nt) time = nt;
      if (mi === 0 || nt) a += `<time${time.symbol ? ` symbol="${time.symbol}"` : ""}><beats>${time.beats}</beats><beat-type>${time.type}</beat-type></time>`;
      if (m.clef && CLEF_XML[m.clef]) clef = m.clef;
      if (mi === 0 || (m.clef && CLEF_XML[m.clef])) a += `<clef><sign>${CLEF_XML[clef][0]}</sign><line>${CLEF_XML[clef][1]}</line></clef>`;
      if (m._multi > 1) a += `<measure-style><multiple-rest>${m._multi}</multiple-rest></measure-style>`;
      if (a) attrs = `<attributes>${a}</attributes>`;
    }
    const mLen = time.beats * (96 / time.type);
    let body = "";
    // left barline
    let left = "";
    if (m.barline === "repeat-start" || m.barline === "repeat-both") left += `<bar-style>heavy-light</bar-style><repeat direction="forward"/>`;
    if (m._voltaStart) left += `<ending number="${xesc(m.volta)}" type="start"/>`;
    if (left) body += `<barline location="left">${left}</barline>`;
    if (mi === 0 && (j.tempo || j.bpm)) {
      const bpm = parseInt(j.bpm, 10);
      body += `<direction placement="above"><direction-type><words font-weight="bold">${xesc(j.tempo || "")}</words></direction-type>${bpm > 0 ? `<sound tempo="${bpm}"/>` : ""}</direction>`;
    }
    const notes = Array.isArray(m.notes) ? m.notes : [];
    // positions for beaming
    const beatLen = (time.type === 8 && time.beats % 3 === 0) ? 36 : (time.type === 2 ? 24 : (time.type === 8 ? 12 : 96 / time.type * (time.type === 4 ? 1 : 1)));
    let pos = 0, total = 0;
    const meta = notes.map(n => { const isGrace = !!n.grace; const isRest = String(n.p || "").toUpperCase().startsWith("R"); const dur = n.d === "m" ? mLen : (isGrace ? 0 : noteDur(n)); const o = { n, isGrace, isRest, dur, pos }; pos += dur; return o; });
    total = pos;
    const offset = (m.pickup && mi === 0) ? Math.max(0, mLen - total) : 0;
    // beams
    let grp = [];
    const flush = () => { if (grp.length > 1) { grp.forEach((o, i) => (o.beam = i === 0 ? "begin" : i === grp.length - 1 ? "end" : "continue")); } grp = []; };
    meta.forEach(o => {
      const bv = String(o.n.d);
      const beamable = !o.isRest && !o.isGrace && ["8", "16", "32", "64"].includes(bv);
      if (!beamable) { if (!o.isGrace) flush(); return; }
      const beat = Math.floor((o.pos + offset) / beatLen + 1e-6);
      if (grp.length && grp._beat !== beat) flush();
      grp._beat = beat; grp.push(o);
    });
    flush();
    // tuplet bracketing
    let tupAcc = 0, tupMin = 0, inTup = false;
    const accState = {};
    meta.forEach((o, ni) => {
      const n = o.n;
      // directions
      if (n.dyn) {
        const dl = String(n.dyn).toLowerCase().trim();
        if (DYNS.includes(dl)) body += `<direction placement="below"><direction-type><dynamics><${dl}/></dynamics></direction-type></direction>`;
        else body += `<direction placement="below"><direction-type><words font-style="italic">${xesc(n.dyn)}</words></direction-type></direction>`;
      }
      if (n.wedge) {
        const w = String(n.wedge).toLowerCase();
        const t = w.startsWith("cr") ? "crescendo" : w.startsWith("d") ? "diminuendo" : "stop";
        body += `<direction placement="below"><direction-type><wedge type="${t}"/></direction-type></direction>`;
      }
      if (n.txt) body += `<direction placement="above"><direction-type><words font-style="italic">${xesc(n.txt)}</words></direction-type></direction>`;
      let x = "<note>";
      if (o.isGrace) x += `<grace slash="yes"/>`;
      let tieStop = false, step = "C", oct = 4, alter = 0, accName = "";
      if (o.isRest) {
        x += n.d === "m" ? `<rest measure="yes"/>` : `<rest/>`;
      } else {
        const mm = String(n.p || "").trim().match(/^([A-Ga-g])\s*([#bnx]{0,2})?\s*(-?\d)$/);
        if (!mm) { issues.push(`Takt ${num}: nieczytelna nuta „${n.p}”`); x += `<rest/>`; o.isRest = true; }
        else {
          step = mm[1].toUpperCase(); oct = +mm[3];
          let a = n.a !== undefined && n.a !== null && n.a !== "" ? String(n.a) : (mm[2] || "");
          if (a === "♯") a = "#"; if (a === "♭") a = "b"; if (a === "♮") a = "n";
          const k = step + oct;
          if (prevTie && prevTie.step === step && prevTie.oct === oct) { alter = prevTie.alter; tieStop = true; if (a in ACC_ALTER) { alter = ACC_ALTER[a]; accName = ACC_NAME[a]; } }
          else if (a in ACC_ALTER) { alter = ACC_ALTER[a]; accName = ACC_NAME[a]; }
          else if (k in accState) alter = accState[k];
          else alter = keyAlter(fifths, step);
          if (a in ACC_ALTER) accState[k] = alter;
          x += `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${oct}</octave></pitch>`;
        }
      }
      if (!o.isGrace) x += `<duration>${Math.round(o.dur * 1000) / 1000}</duration>`;
      if (tieStop) x += `<tie type="stop"/>`;
      if (n.tie && !o.isRest) x += `<tie type="start"/>`;
      x += `<voice>1</voice>`;
      if (n.d !== "m") x += `<type>${TYPE[String(n.d)] || "quarter"}</type>`;
      for (let i = 0; i < (n.dots || 0); i++) x += `<dot/>`;
      if (accName && !o.isRest) x += `<accidental>${accName}</accidental>`;
      let tupNot = "";
      if (n.tup && !o.isGrace) {
        x += `<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>`;
        const b = BASE[String(n.d)] ?? 24;
        if (!inTup) { inTup = true; tupAcc = 0; tupMin = b; tupNot = `<tuplet type="start" bracket="${o.beam ? "no" : "yes"}"/>`; }
        tupMin = Math.min(tupMin, b); tupAcc += o.dur;
        const unit = 2 * tupMin;
        const nextTup = meta[ni + 1] && meta[ni + 1].n.tup;
        if (Math.abs(tupAcc / unit - Math.round(tupAcc / unit)) < 1e-6 && tupAcc > 0 || !nextTup) { tupNot += `<tuplet type="stop"/>`; inTup = false; }
      } else if (inTup && !o.isGrace) { inTup = false; }
      if (o.beam) x += `<beam number="1">${o.beam}</beam>`;
      let nots = "";
      if (tieStop) nots += `<tied type="stop"/>`;
      if (n.tie && !o.isRest) nots += `<tied type="start"/>`;
      const sl = String(n.slur || "");
      if (sl.includes("stop") || sl === "end") nots += `<slur type="stop" number="1"/>`;
      if (sl.includes("start")) nots += `<slur type="start" number="1"/>`;
      nots += tupNot;
      const art = Array.isArray(n.art) ? n.art.map(a => String(a).toLowerCase()) : [];
      const artMap = { staccato: "staccato", accent: "accent", tenuto: "tenuto", marcato: "strong-accent", staccatissimo: "staccatissimo" };
      const arts = art.filter(a => artMap[a]).map(a => `<${artMap[a]}${a === "marcato" ? ' type="up"' : ""}/>`).join("");
      if (arts) nots += `<articulations>${arts}</articulations>`;
      if (art.includes("fermata") || n.fermata) nots += `<fermata type="upright"/>`;
      if (art.includes("trill")) nots += `<ornaments><trill-mark/></ornaments>`;
      if (nots) x += `<notations>${nots}</notations>`;
      x += "</note>";
      body += x;
      if (!o.isGrace) prevTie = (n.tie && !o.isRest) ? { step, oct, alter } : null;
    });
    // right barline
    let right = "", style = "";
    if (m.barline === "repeat-end" || m.barline === "repeat-both") style = "light-heavy";
    else if (m.barline === "final" || (mi === ms.length - 1 && !m.barline)) style = "light-heavy";
    else if (m.barline === "double") style = "light-light";
    if (style) right += `<bar-style>${style}</bar-style>`;
    if (m._voltaEnd) right += `<ending number="${xesc(m.volta)}" type="${(m.barline === "repeat-end" || m.barline === "repeat-both") ? "stop" : (String(m.volta) === "1" ? "stop" : "discontinue")}"/>`;
    if (m.barline === "repeat-end" || m.barline === "repeat-both") right += `<repeat direction="backward"/>`;
    if (right) body += `<barline location="right">${right}</barline>`;
    // duration check
    if (!(m.pickup && mi === 0) && !m._multi && !(m.rest > 0)) {
      if (Math.abs(total - mLen) > 0.01 && notes.length) {
        const isLast = mi === ms.length - 1;
        if (!(isLast && total < mLen)) issues.push(`Takt ${num}: ${total > mLen ? "za dużo" : "za mało"} wartości rytmicznych`);
      }
    }
    out += `<measure number="${num}"${(m.pickup && mi === 0) ? ' implicit="yes"' : ""}>${attrs}${body}</measure>`;
    num++;
  });
  if (!ms.length) throw new Error("Nie znalazłem żadnych taktów na obrazku.");
  const partName = j.instrument || "Głos solowy";
  const xml = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>${xesc(j.title || "")}</work-title></work><identification>${j.composer ? `<creator type="composer">${xesc(j.composer)}</creator>` : ""}</identification><part-list><score-part id="P1"><part-name>${xesc(partName)}</part-name></score-part></part-list><part id="P1">${out}</part></score-partwise>`;
  (Array.isArray(j.unsure) ? j.unsure : []).forEach(u => issues.push(`Takt ${u}: odczyt niepewny`));
  return { xml, issues };
}

/* ---------------- Example piece (public domain melody) ---------------- */
/* "Wlazł kotek na płotek" (by meow, says the running joke): a folk tune with piano, so the piano can be hidden */
function exampleXml() {
  // "Wlazł kotek na płotek", Polish folk song (public domain): sol mi mi | fa re re | do mi sol
  const A = [["G4", 8], ["E4", 8], ["E4", 4]], B = [["F4", 8], ["D4", 8], ["D4", 4]];
  const mel = [A, B, [["C4", 8], ["E4", 8], ["G4", 4]],
               A, B, [["C4", 8], ["E4", 8], ["C4", 4]],
               [["C4", 8], ["E4", 8], ["E4", 4]], B, [["C4", 8], ["E4", 8], ["G4", 4]],
               A, B, [["C4", 8], ["E4", 8], ["C4", 4]]];
  const harm = ["C", "G", "C", "C", "G", "C", "C", "G", "C", "C", "G", "C"];
  const RH = { C: ["E4", "G4", "C5"], G: ["D4", "G4", "B4"] };
  const LH = { C: "C3", G: "G2" };
  const dur = { 1: 96, 2: 48, 4: 24, 8: 12 };
  const typ = { 1: "whole", 2: "half", 4: "quarter", 8: "eighth" };
  const pitch = p => { const m = p.match(/^([A-G])(b|#)?(\d)$/); const alt = m[2] === "b" ? -1 : m[2] === "#" ? 1 : 0;
    return `<pitch><step>${m[1]}</step>${alt ? `<alter>${alt}</alter>` : ""}<octave>${m[3]}</octave></pitch>`; };
  let solo = "", pno = "";
  mel.forEach((m, i) => {
    let s = `<measure number="${i + 1}">`;
    if (i === 0) s += `<attributes><divisions>24</divisions><key><fifths>0</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction placement="above"><direction-type><words font-weight="bold">Wesoło</words></direction-type><sound tempo="96"/></direction><direction placement="below"><direction-type><dynamics><mf/></dynamics></direction-type></direction>`;
    m.forEach(([p, d, dot]) => { let dd = dur[d]; if (dot) dd *= 1.5; s += `<note>${pitch(p)}<duration>${dd}</duration><voice>1</voice><type>${typ[d]}</type>${dot ? "<dot/>" : ""}</note>`; });
    if (i === mel.length - 1) s += `<barline location="right"><bar-style>light-heavy</bar-style></barline>`;
    solo += s + "</measure>";
    let q = `<measure number="${i + 1}">`;
    if (i === 0) q += `<attributes><divisions>24</divisions><key><fifths>0</fifths></key><time><beats>2</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction placement="below"><direction-type><dynamics><p/></dynamics></direction-type><staff>1</staff></direction>`;
    const h = harm[i];
    RH[h].forEach((p, k) => { q += `<note>${k ? "<chord/>" : ""}${pitch(p)}<duration>48</duration><voice>1</voice><type>half</type><staff>1</staff></note>`; });
    q += `<backup><duration>48</duration></backup><note>${pitch(LH[h])}<duration>48</duration><voice>5</voice><type>half</type><staff>2</staff></note>`;
    if (i === mel.length - 1) q += `<barline location="right"><bar-style>light-heavy</bar-style></barline>`;
    pno += q + "</measure>";
  });
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>Wlazł kotek na płotek</work-title></work><identification><creator type="composer">meow</creator></identification><part-list><part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group><score-part id="P1"><part-name>Głos solowy</part-name></score-part><score-part id="P2"><part-name>Fortepian</part-name></score-part><part-group type="stop" number="1"/></part-list><part id="P1">${solo}</part><part id="P2">${pno}</part></score-partwise>`;
}


/* Tata's library lives here, per web address (origin). Never rename the database or store, and never
   move the live address, without a migration: the pieces would look gone. */
const DB = {
  db: null, mem: new Map(), ok: true,
  async open() {
    if (this.db || !this.ok) return this.db;
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open("pulpit-nutowy", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("pieces", { keyPath: "id" });
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
    } catch (e) { this.ok = false; console.warn(e); }
    return this.db;
  },
  async tx(mode, fn) {
    const db = await this.open();
    if (!db) return fn(null);
    return new Promise((res, rej) => {
      const t = db.transaction("pieces", mode); const st = t.objectStore("pieces");
      let out; Promise.resolve(fn(st)).then(v => (out = v));
      t.oncomplete = () => res(out); t.onerror = () => rej(t.error);
    });
  },
  async all() {
    const db = await this.open();
    if (!db) return Array.from(this.mem.values());
    return new Promise((res, rej) => { const r = db.transaction("pieces").objectStore("pieces").getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
  },
  async put(p) { const db = await this.open(); if (!db) { this.mem.set(p.id, p); return; } return new Promise((res, rej) => { const t = db.transaction("pieces", "readwrite"); t.objectStore("pieces").put(p); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
  async del(id) { const db = await this.open(); if (!db) { this.mem.delete(id); return; } return new Promise((res, rej) => { const t = db.transaction("pieces", "readwrite"); t.objectStore("pieces").delete(id); t.oncomplete = res; t.onerror = () => rej(t.error); }); }
};

function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
const safeName = s => (s || "nuty").replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 60) || "nuty";


function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Nie udało się otworzyć obrazu.")); i.src = src; }); }
function canvasToJpeg(srcCanvasOrImg, maxEdge, q) {
  const w0 = srcCanvasOrImg.naturalWidth || srcCanvasOrImg.width, h0 = srcCanvasOrImg.naturalHeight || srcCanvasOrImg.height;
  const sc = Math.min(1, maxEdge / Math.max(w0, h0));
  const c = document.createElement("canvas"); c.width = Math.round(w0 * sc); c.height = Math.round(h0 * sc);
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(srcCanvasOrImg, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", q);
}

