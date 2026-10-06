/* Solo: nuty z obrazka, bez fortepianu, w Twoim kluczu i tonacji.
   Everything runs in the browser; nothing about the music leaves the device. */
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const xesc = esc;
/* the top number of a metre: 7, or an additive one as composers write it (3+2+2 → 7) */
const beatsOf = s => String(s ?? "").split("+").reduce((a, b) => a + (parseInt(b, 10) || 0), 0) || NaN;
/* small settings only (localStorage is ~5 MB and synchronous); set() says whether it was kept, so a full or
   blocked storage is never mistaken for a save */
const store = {
  get(k, d = null) { try { const v = localStorage.getItem("solo:" + k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("solo:" + k, v); return true; } catch (e) { console.warn("store.set", k, e); return false; } },
  del(k) { try { localStorage.removeItem("solo:" + k); } catch {} }
};
/* search without Polish letters or case: "wlazl" finds "Wlazł", "trabka" finds "Trąbka" */
const fold = s => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l");
function hud(msg, ms = 2400) {
  const h = $("#toast"); if (!h) return;
  h.innerHTML = ""; const t = document.createElement("span"); t.className = "t-msg"; t.textContent = msg; h.appendChild(t); h.classList.add("show");
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
/* a numbered part (Puzon II, Trombone 2): one rule everywhere */
const ROMAN_RE = / (I|II|III|IV|V|VI|\d+)$/;
const PIANO_RE = /piano|fortepian|klavier|pianoforte|^pf\.?$|^pno\.?$|klaw|keyboard|organ|organy|akompan|accomp|harf|harp|cembal/i;
/* pref: the part whose key is the piece's key (the melody); otherwise the first part that is not a piano */
function analyseXml(xml, pref = null) {
  const doc = parseXml(xml);
  const root = doc.documentElement;
  if (root.tagName !== "score-partwise") throw new Error("Ten rodzaj pliku MusicXML (timewise) nie jest obsługiwany. Zapisz go w programie jeszcze raz jako zwykły MusicXML.");
  const names = {};
  $$("part-list > score-part", doc).forEach(sp => { names[sp.getAttribute("id")] = txt(sp, "part-name") || txt(sp, "part-abbreviation") || "Głos"; });
  const parts = kids(root, "part").map(p => {
    const id = p.getAttribute("id");
    let staves = 1; const st = p.getElementsByTagName("staves")[0]; if (st) staves = parseInt(st.textContent, 10) || 1;
    const clefEl = [...p.getElementsByTagName("clef")].find(c => (c.getAttribute("number") || "1") === "1");     // staff 1, not a piano's bass
    const trEl = p.getElementsByTagName("transpose")[0];
    const transp = trEl ? (parseInt(txt(trEl, "chromatic") || "0", 10) || 0) + 12 * (parseInt(txt(trEl, "octave-change") || "0", 10) || 0) : 0;   // sounding − written
    const name = names[id] || "Głos";
    const isPiano = staves > 1 || PIANO_RE.test(name);
    return { id, name, staves, keep: !isPiano, clef: clefNameOf(clefEl) || "treble", transp };
  });
  if (!parts.some(p => p.keep)) parts.forEach(p => (p.keep = true));
  let fifths = 0, mode = "major";
  const firstKept = parts.find(p => p.id === pref) || parts.find(p => p.keep);
  const pEl = firstKept && kids(root, "part").find(p => p.getAttribute("id") === firstKept.id);
  const keyEl = pEl && pEl.getElementsByTagName("key")[0];
  if (keyEl) { fifths = parseInt(txt(keyEl, "fifths") || "0", 10) || 0; const md = txt(keyEl, "mode"); mode = md === "minor" || (!md && detectMode(pEl, fifths) === "minor") ? "minor" : "major"; }
  let title = txt(kid(root, "work") || root, "work-title") || txt(root, "movement-title");
  if (!title) {         /* the credit marked as the title; a file without credit types: its first credit (old programs) */
    const cr = kids(root, "credit"), typed = cr.filter(c => kid(c, "credit-type")), t = typed.find(c => txt(c, "credit-type") === "title");
    const w = t ? kid(t, "credit-words") : !typed.length && cr[0] ? kid(cr[0], "credit-words") : null; if (w) title = w.textContent.trim();
  }
  const ident = kid(root, "identification");
  const composer = ident ? (Array.from(ident.getElementsByTagName("creator")).find(c => c.getAttribute("type") === "composer")?.textContent.trim() || "") : "";
  return { parts, key: { fifths, mode }, title, composer };
}
/* the melody: the part the piece is for. Kept with the piece (settings.melody), so a part added above it in score
   order (a flute over a trombone tune) never takes its place; otherwise the first part that is not a piano */
function melodyId() {
  if (!S.parts || !S.parts.length) return null;
  if (S.melody && S.parts.some(p => p.id === S.melody)) return S.melody;
  const solo = p => !(p.staves > 1 || PIANO_RE.test(p.name));
  return (S.parts.find(p => p.keep && solo(p)) || S.parts.find(solo) || S.parts[0]).id;
}
/* the melody of a score just opened: the part the piece's instrument names (declared or by its name), else the first
   part that is not a piano */
function guessMelody(xml, parts, instrument) {
  const solo = parts.filter(p => !(p.staves > 1 || PIANO_RE.test(p.name))); if (!solo.length) return parts[0] ? parts[0].id : null;
  if (instrument && typeof declaredInstr === "function") {
    const want = String(instrument).replace(ROMAN_RE, "").trim().toLowerCase(), sps = [...parseXml(xml).getElementsByTagName("score-part")];
    const hit = solo.find(p => { const sp = sps.find(x => x.getAttribute("id") === p.id), d = sp && declaredInstr(sp); return (d && d.name.toLowerCase() === want) || p.name.replace(ROMAN_RE, "").trim().toLowerCase() === want; });
    if (hit) return hit.id;
  }
  return solo[0].id;
}
function readingPartId() {
  const shown = S.parts.filter(p => p.keep);
  if (shown.length === 1) return shown[0].id;
  const mel = melodyId(); if (shown.some(p => p.id === mel)) return mel;
  const m = shown.find(p => !(p.staves > 1 || PIANO_RE.test(p.name))) || shown[0];
  return m && m.id;
}
/* the score as it is drawn; the same piece and settings give the same text, so taps and bar lookups do not parse,
   beam and serialise the whole score again */
function processedXml() {
  const key = [S.piece.xml, S.parts.map(p => p.id + (p.keep ? 1 : 0) + p.name).join(), S.piece.title, S.piece.composer, S.piece.instrument, S.clef, S.readOct, S.under, S.iv.d, S.iv.s, S.melody, castsOff(), S.layout, S.meterLines].join("\u0001");
  if (processedXml.key === key) return processedXml.out;
  const out = processedXmlNow(); processedXml.key = key; processedXml.out = out; return out;
}
function processedXmlNow() {
  const doc = autoBeam(cleanBeams(addAccidentals(parseXml(S.piece.xml))));
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
  /* the instrument in the corner only when one part is shown (in a score each staff carries its own name) */
  const shown = S.parts.filter(p => p.keep), single = shown.length === 1;
  let corner = "";
  if (single && pl) { const sp = kids(pl, "score-part").find(x => x.getAttribute("id") === shown[0].id), nm = sp ? txt(sp, "part-name").trim() : ""; corner = ROMAN_RE.test(nm) ? nm : (S.piece.instrument || nm); }
  [[150, "left", corner], [1950, "right", S.piece.composer]].forEach(([x, j, t]) => {
    credit("\u00a0", x, 2800, j); credit("\u00a0", x, 2760, j); credit(t || "\u00a0", x, 2700, j);
  });
  // the solo part is named after the instrument in the header, so the score never says two different things
  const soloInfo = S.parts.find(p => p.id === melodyId() && !(p.staves > 1 || PIANO_RE.test(p.name)));
  if (pl && soloInfo && S.piece.instrument) {
    const sp = kids(pl, "score-part").find(x => x.getAttribute("id") === soloInfo.id);
    if (sp) {
      let pn = kid(sp, "part-name");
      if (!pn) { pn = doc.createElement("part-name"); sp.insertBefore(pn, sp.firstChild); }
      /* a numbered part (Puzon I, Puzon II) keeps its own name */
      if (!ROMAN_RE.test(pn.textContent.trim())) pn.textContent = S.piece.instrument;
      ["part-abbreviation", "part-name-display", "part-abbreviation-display"].forEach(t => { const e = kid(sp, t); if (e) e.remove(); });
    }
  }
  // single visible part: don't repeat its name at the first system (it is in the header)
  const keptParts = kids(root, "part");
  if (pl && keptParts.length === 1) kids(pl, "score-part").forEach(sp => { const pn = kid(sp, "part-name"); if (pn) pn.setAttribute("print-object", "no"); });
  // clef change
  /* the reading clef (and the octave that fits it) belongs to the part being read: the only part shown, or the
     melody; every other part keeps its own clef and octave (a bass trombone stays in the bass clef) */
  const readPart = readingPartId();
  if (S.clef !== "keep" || S.readOct) {
    const map = { treble: ["G", "2"], bass: ["F", "4"], tenor: ["C", "4"], alto: ["C", "3"] }[S.clef] || null;
    kids(root, "part").forEach(p => {
      const info = S.parts.find(x => x.id === p.getAttribute("id"));
      if (!info || info.staves > 1 || p.getAttribute("id") !== readPart) return;
      if (S.readOct) [...p.getElementsByTagName("octave")].forEach(o => { o.textContent = String((parseInt(o.textContent, 10) || 0) + S.readOct); });
      if (!map) return;
      const clefs = Array.from(p.getElementsByTagName("clef"));
      /* the part's own clef chosen again (a trombone in the bass clef): its clef changes (tenor passages) stay */
      const own = clefs.find(c => (c.getAttribute("number") || "1") === "1"); if (own && clefNameOf(own) === S.clef) return;
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
  if (castsOff()) castOff(root);
  /* a scan shown as in the original: the metre printed at the start of every line (exercise books do), unless turned off */
  if (S.layout === "orig" && S.hasLines && S.meterLines !== false) kids(root, "part").forEach(part => {
    let cur = null;
    kids(part, "measure").forEach((m, i) => {
      kids(m, "attributes").forEach(a => { const t = kid(a, "time"); if (t) cur = t; });
      if (!i || !cur || !kids(m, "print").some(x => x.getAttribute("new-system") === "yes")) return;
      if (kids(m, "attributes").some(a => kid(a, "time"))) return;
      let a = kids(m, "attributes")[0]; if (!a) { a = doc.createElement("attributes"); const pr = kid(m, "print"); pr ? pr.after(a) : m.insertBefore(a, m.firstChild); }
      a.insertBefore(cur.cloneNode(true), kid(a, "clef") || kid(a, "staves") || null);
    });
  });
  if (S.under && typeof withChords === "function") { const first = S.parts.find(p => p.keep && p.id === melodyId()) || S.parts.find(p => p.keep); withChords(doc, first && first.id, S.under, intervalFifths(S.iv)); }
  return new XMLSerializer().serializeToString(doc);
}

/* Bars per line on an A4 page, as engravers cast off a part: four bars a line (the 4-bar phrase of most tunes and
   method books), three or two when the bars are crowded (many short notes in the busiest part). A pickup bar joins the
   first line; a lone last bar joins the line before it when that line is light. A scanned piece shown "as in the
   original" keeps the lines of the paper. */
const castsOff = () => !!S.piece && S.page !== "screen" && !(S.layout === "orig" && S.hasLines);
function castOff(root) {
  const parts = kids(root, "part"); if (!parts.length) return;
  const bars = kids(parts[0], "measure").length; if (!bars) return;
  const busy = Array.from({ length: bars }, (_, i) => Math.max(...parts.map(p => {
    const m = kids(p, "measure")[i]; if (!m) return 0;
    const ns = kids(m, "note").filter(n => !kid(n, "chord") && !kid(n, "grace"));
    const staves = new Set(ns.map(n => txt(n, "staff") || "1")).size || 1;   // a piano bar: its notes per staff
    return ns.length / staves;
  })));
  const pickup = kids(parts[0], "measure")[0].getAttribute("implicit") === "yes" ? 1 : 0;
  const lines = []; let i = pickup;
  while (i < bars) {
    const look = busy.slice(i, i + 4), avg = look.reduce((a, b) => a + b, 0) / look.length;
    const n = avg > 14 ? 2 : avg > 10 ? 3 : 4;
    lines.push([i, Math.min(bars, i + n)]); i += n;
  }
  if (pickup && lines.length) lines[0][0] = 0;
  if (lines.length > 1) {
    const last = lines[lines.length - 1], prev = lines[lines.length - 2];
    const light = busy.slice(prev[0], last[1]).reduce((a, b) => a + b, 0) / (last[1] - prev[0]) <= 8;
    if (last[1] - last[0] === 1 && light) { prev[1] = last[1]; lines.pop(); }
  }
  const starts = new Set(lines.slice(1).map(l => l[0]));
  parts.forEach(p => kids(p, "measure").forEach((m, k) => {
    kids(m, "print").forEach(pr => { pr.removeAttribute("new-system"); pr.removeAttribute("new-page"); if (!pr.attributes.length && !pr.children.length) pr.remove(); });
    if (!starts.has(k)) return;
    const pr = root.ownerDocument.createElement("print"); pr.setAttribute("new-system", "yes"); m.insertBefore(pr, m.firstChild);
  }));
}

/* Write the interval into the MusicXML itself (used for exporting the file to other programs). */
function transposeXmlString(xml, iv, keepTr = false) {
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
  if (!keepTr) Array.from(doc.getElementsByTagName("transpose")).forEach(t => t.remove());     // kept when the piece itself is moved (a B♭ part stays a B♭ part)
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
        if (bt) beats = beatsOf(bt.textContent) || beats; if (bty) beatType = parseInt(bty.textContent, 10) || beatType;
        let voice = null, count = 0, last = null;
        [...m.children].forEach(ch => {
          /* a hidden gap (<forward>) in the kept voice becomes a rest, so its later notes keep their place */
          if (ch.tagName === "forward" && (txt(ch, "staff") || "1") === String(s) && (voice === null || (txt(ch, "voice") || last || voice) === voice)) {
            const r = doc.createElement("note"); r.innerHTML = `<rest/><duration>${txt(ch, "duration")}</duration><voice>${voice || "1"}</voice>`; ch.replaceWith(r); count++; return;
          }
          if (ch.tagName === "backup" || ch.tagName === "forward") { ch.remove(); return; }
          if (ch.tagName === "note") last = txt(ch, "voice") || "1";
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
/* a full-bar rest for a bar missing in one staff of a page (parts must have the same bars, R19) */
function padParts(parts) {
  const most = Math.max(0, ...parts.map(p => kids(p, "measure").length));
  parts.forEach(p => {
    let div = 1, beats = 4, bt = 4;
    kids(p, "measure").forEach(m => kids(m, "attributes").forEach(a => {
      const d = kid(a, "divisions"); if (d) div = parseFloat(d.textContent) || div;
      const t = kid(a, "time"); if (t) { beats = beatsOf(txt(t, "beats")) || beats; bt = parseInt(txt(t, "beat-type"), 10) || bt; }
    }));
    for (let k = kids(p, "measure").length; k < most; k++) {
      const m = p.ownerDocument.createElement("measure");
      m.innerHTML = `<note><rest measure="yes"/><duration>${Math.round(div * beats * 4 / bt)}</duration><voice>1</voice></note>`;
      p.appendChild(m);
    }
  });
  return parts;
}
function homrToSolo(xmlPages, title) {
  /* a cover, a page of text or a page the reader found no staff on adds nothing (B-14) */
  const pages = xmlPages.map(x => { const doc = parseXml(x); return { doc, parts: padParts(splitHomrParts(doc).filter(p => kids(p, "measure").length)) }; }).filter(p => p.parts.length);
  if (!pages.length) throw new Error("Na zdjęciach nie widać pięciolinii.");
  const base = pages[0];
  const sameShape = pages.every(p => p.parts.length === base.parts.length);
  let parts = sameShape ? base.parts : [base.parts[0]];
  pages.slice(1).forEach(pg => {
    parts.forEach((part, i) => pg.parts[i] && kids(pg.parts[i], "measure").forEach((m, k) => {
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
/* how long a bar really is (in divisions): the furthest any voice reaches (<backup>/<forward> followed) */
function barFill(m) {
  let pos = 0, max = 0;
  [...m.children].forEach(el => {
    const d = parseFloat(txt(el, "duration")) || 0;
    if (el.tagName === "backup") pos -= d; else if (el.tagName === "forward") pos += d;
    else if (el.tagName === "note" && !kid(el, "chord") && !kid(el, "grace")) pos += d;
    max = Math.max(max, pos);
  });
  return max;
}
/* bars of a part: divisions, full length and real length (a pickup or the bar that completes it is shorter, §12) */
function barInfo(part) {
  let div = 1, beats = 4, bt = 4; const ms = kids(part, "measure");
  return ms.map((m, i) => {
    kids(m, "attributes").forEach(a => {
      const d = kid(a, "divisions"); if (d) div = parseFloat(d.textContent) || div;
      const t = kid(a, "time"); if (t) { beats = beatsOf(txt(t, "beats")) || beats; bt = parseInt(txt(t, "beat-type"), 10) || bt; }
    });
    const full = div * 4 * beats / bt, f = barFill(m), whole = [...m.getElementsByTagName("rest")].some(r => r.getAttribute("measure") === "yes");
    const len = !whole && f > 0 && f < full - 1e-6 && (i === 0 || i === ms.length - 1) ? f : full;
    return { m, div, beats, bt, full, len, pickup: i === 0 && len < full };
  });
}
/* note values for a length in quarters: one value when there is one (dotted too), else tied values that keep the beat
   visible (5/4 = dotted half + half, 9/8 = dotted half + dotted quarter) */
const NOTE_VAL = [[6, "whole", 1], [4, "whole", 0], [3, "half", 1], [2, "half", 0], [1.5, "quarter", 1], [1, "quarter", 0], [0.75, "eighth", 1], [0.5, "eighth", 0], [0.25, "16th", 0]];
function noteValues(q) {
  const one = NOTE_VAL.find(v => Math.abs(v[0] - q) < 1e-6); if (one) return [one];
  const out = []; let left = q;
  while (left > 1e-6) { const v = NOTE_VAL.find(x => x[0] <= left + 1e-6 && x[0] <= 3) || NOTE_VAL[NOTE_VAL.length - 1]; out.push(v); left -= v[0]; if (out.length > 16) break; }
  return out;
}
/* major or minor when the file does not say (<mode> missing: homr, ready tunes, new melodies): a tune that ends on the
   relative minor's tonic, or ends in its tonic triad and uses its raised leading tone, is minor */
function detectMode(part, fifths) {
  const pcs = [...part.getElementsByTagName("note")].filter(n => !kid(n, "chord") && !kid(n, "grace") && kid(n, "pitch")).map(n => { const p = kid(n, "pitch"); return ((LETTER_PC[txt(p, "step")] + (parseFloat(txt(p, "alter")) || 0)) % 12 + 12) % 12; });
  if (!pcs.length) return "major";
  const pc = l => { const p = lofToPitch(l); return ((LETTER_PC[p.letter] + p.alter) % 12 + 12) % 12; };
  const last = pcs[pcs.length - 1], minT = pc(fifths + 3), majT = pc(fifths), lt = pc(fifths + 8);
  if (last === minT) return "minor";
  if (last === majT) return "major";
  return pcs.filter(x => x === lt).length >= 2 && [minT, pc(fifths), pc(fifths + 4)].includes(last) ? "minor" : "major";
}
/* T33: the reader knows a note is E-flat but writes no accidental sign, so Verovio drew a plain E
   (this is what looked like "flats are not read"). Add the signs as they are printed: against the key,
   once per bar and line position. Safe to run on any score: notes that already have a sign are kept. */
const ACC_BY_ALTER = { "-2": "flat-flat", "-1": "flat", "0": "natural", "1": "sharp", "2": "double-sharp" };
function addAccidentals(doc) {
  Array.from(doc.getElementsByTagName("part")).forEach(part => {
    /* Gould: an accidental holds to the barline at its own octave; a note tied over the barline keeps it without a
       new sign; the next bar gets a courtesy sign when that note returns to the key */
    let fifths = 0, prevAltered = new Map();
    kids(part, "measure").forEach(m => {
      kids(m, "attributes").forEach(a => { const k = kid(a, "key"); if (k) fifths = parseInt(txt(k, "fifths"), 10) || 0; });
      const state = new Map(), altered = new Map(), seen = new Set();
      kids(m, "note").forEach(n => {
        const p = kid(n, "pitch"); if (!p) return;
        const step = txt(p, "step"), key = (txt(n, "staff") || "1") + step + txt(p, "octave"), alt = Math.round(parseFloat(txt(p, "alter")) || 0);
        const tiedIn = [...n.getElementsByTagName("tie")].some(t => t.getAttribute("type") === "stop") && !seen.has(key);
        const cur = state.has(key) ? state.get(key) : keyAlter(fifths, step);
        const first = !seen.has(key); seen.add(key);
        /* a note tied in over the barline carries its sign without a new one, but only itself: a later note on that
           line in the bar is measured against the key again (Gould) */
        if (!tiedIn) { state.set(key, alt); if (alt !== keyAlter(fifths, step)) altered.set(key, alt); }
        if (kid(n, "accidental") || tiedIn || !ACC_BY_ALTER[String(alt)]) return;
        let cautionary = false;
        if (alt === cur) { if (!(first && prevAltered.has(key) && prevAltered.get(key) !== alt)) return; cautionary = true; }
        const acc = doc.createElement("accidental"); acc.textContent = ACC_BY_ALTER[String(alt)]; if (cautionary) acc.setAttribute("cautionary", "yes");
        /* schema order: … type, dot, accidental, time-modification, stem, notehead, staff, beam, notations, lyric */
        n.insertBefore(acc, ["time-modification", "stem", "notehead", "notehead-text", "staff", "beam", "notations", "lyric", "play", "listen"].map(t => kid(n, t)).find(Boolean) || null);
      });
      prevAltered = altered;
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
        const t = kid(a, "time"); if (t) { bts = beatsOf(txt(t, "beats")) || bts; btt = parseInt(txt(t, "beat-type"), 10) || btt; }
      });
      const mr = m.getElementsByTagName("multiple-rest")[0]; if (!mr) return;
      const n = parseInt(mr.textContent, 10) || 1; let after = m;
      /* a file that already has the empty bars (MuseScore, Finale do) keeps them as they are */
      const nx = kids(part, "measure"), at = nx.indexOf(m), follow = nx.slice(at + 1, at + n);
      if (follow.length === n - 1 && follow.every(x => !x.getElementsByTagName("pitch").length)) return;
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
    const len = t => (beatsOf(txt(t, "beats")) || 4) * 4 / (parseInt(txt(t, "beat-type"), 10) || 4);
    let want = null;
    if (ans.time) want = ans.time.split("/").map(Number);
    /* a misread C / ¢ (4/4 among 2/2) is one metre; 3/4 against 6/8 is a real change (hemiola) and stays */
    else if (times.length > 1 && times.every(t => ["4/4", "2/2"].includes(txt(t, "beats") + "/" + txt(t, "beat-type")))) {
      const four = times.find(t => txt(t, "beats") === "4" && txt(t, "beat-type") === "4");
      const t0 = four || times[0]; want = [beatsOf(txt(t0, "beats")), parseInt(txt(t0, "beat-type"), 10)];
    }
    if (want && measures.length) {
      /* the bars that carried a metre keep showing it (an exercise book prints 4/4 on every line; Tata: "identical") */
      const shown = new Set(times.map(t => measures.indexOf(t.closest("measure"))).filter(i => i > 0));
      times.forEach(t => t.remove());
      shown.forEach(i => {      /* a metre printed again at a line start ends an exercise: the line before ends with a final bar line */
        const prev = measures[i - 1]; if (prev && !kids(prev, "barline").some(b => (b.getAttribute("location") || "right") === "right")) { const bl = doc.createElement("barline"); bl.setAttribute("location", "right"); bl.innerHTML = "<bar-style>light-heavy</bar-style>"; prev.appendChild(bl); }
      });
      shown.forEach(i => { const m = measures[i]; let a2 = kids(m, "attributes")[0]; if (!a2) { a2 = doc.createElement("attributes"); const pr = kid(m, "print"); pr ? pr.after(a2) : m.insertBefore(a2, m.firstChild); } const t2 = doc.createElement("time"); t2.innerHTML = `<beats>${want[0]}</beats><beat-type>${want[1]}</beat-type>`; a2.insertBefore(t2, kid(a2, "clef") || null); });
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
        const t = kid(a, "time"); if (t) { beats = beatsOf(txt(t, "beats")) || beats; bt = parseInt(txt(t, "beat-type"), 10) || bt; }
      });
      let sum = barFill(m), whole = false;          // the longest voice (two voices: <backup>), not every note added up
      kids(m, "note").forEach(n => {
        if (kid(n, "chord") || kid(n, "grace")) return;
        const r = kid(n, "rest"); if (r && r.getAttribute("measure") === "yes") whole = true;
        const p = kid(n, "pitch");
        if (p) midis.push({ i, m: 12 * (parseInt(txt(p, "octave"), 10) + 1) + [0, 2, 4, 5, 7, 9, 11][STEP_I[txt(p, "step")]] + (parseFloat(txt(p, "alter")) || 0) });
      });
      const full = div * beats * 4 / bt;
      /* a short first bar is a pickup when the last bar completes it, or when it is at most half a bar (a misread
         first bar with one note missing is flagged); a short last bar is accepted (B-19) */
      const lastSum = measures.length > 1 ? barFill(measures[measures.length - 1]) : 0;
      const pickup = i === 0 ? sum < full && (sum <= full / 2 + 0.01 || Math.abs(sum + lastSum - full) < 0.01) : i === measures.length - 1 && sum < full;
      if (!whole && !m.getElementsByTagName("multiple-rest").length && sum > 0 && Math.abs(sum - full) > 0.01 && !pickup)
        issues.push(`Takt ${i + 1}: ${sum > full ? "za dużo" : "za mało"} wartości rytmicznych`);
    });
    /* a single note an octave away from both neighbours */
    for (let k = 1; k < midis.length - 1; k++) {
      const a = midis[k - 1].m, b = midis[k].m, c = midis[k + 1].m;
      if (Math.abs(b - a) >= 12 && Math.abs(b - c) >= 12 && Math.abs(a - c) <= 7) issues.push(`Takt ${midis[k].i + 1}: nuta może być o oktawę ${b < a ? "za nisko" : "za wysoko"}`);
    }
  });
  /* mechanical checks after reading (Tata: the result must look like the paper):
     - a bar with rests only, filling the bar, is one whole-bar rest (drawn in the middle of the bar);
     - a fermata over a rest inside the piece is almost always a pencil mark (a teacher's "V"): it goes, the bar is
       marked to be checked */
  parts.forEach(part => {
    let dv = 1, bts = 4, btt = 4; const ms = kids(part, "measure");
    ms.forEach((m, i) => {
      kids(m, "attributes").forEach(a => { const d = kid(a, "divisions"); if (d) dv = parseFloat(d.textContent) || dv; const t = kid(a, "time"); if (t) { bts = beatsOf(txt(t, "beats")) || bts; btt = parseInt(txt(t, "beat-type"), 10) || btt; } });
      const ns = kids(m, "note");
      if (ns.length && !kids(m, "backup").length && ns.every(n => kid(n, "rest"))) {
        const sum = ns.reduce((a, n) => a + (parseFloat(txt(n, "duration")) || 0), 0), full = dv * bts * 4 / btt;
        if (Math.abs(sum - full) < 0.01 && !(ns.length === 1 && kid(ns[0], "rest").getAttribute("measure") === "yes")) {
          const keep = ns[0]; ns.slice(1).forEach(n => n.remove());
          const r = kid(keep, "rest"); r.setAttribute("measure", "yes"); [...r.children].forEach(c => c.remove());
          kid(keep, "duration").textContent = String(Math.round(full)); ["type", "dot"].forEach(t => kids(keep, t).forEach(x => x.remove()));
        }
      }
      if (i < ms.length - 1) kids(m, "note").filter(n => kid(n, "rest")).forEach(n => {
        const f = n.getElementsByTagName("fermata"); if (!f.length) return;
        [...f].forEach(x => { const no = x.parentNode; x.remove(); if (no && !no.children.length) no.remove(); });
        issues.push(`Takt ${i + 1}: usunięto fermatę nad pauzą (pewnie znak ołówkiem)`);
      });
    });
  });
  /* notes far off the staff (more than 4 ledger lines) are often words under the staff read as notes ("f ess d" in
     an exercise to fill in): in a line otherwise without notes they go, elsewhere the bar is marked */
  parts.forEach(part => {
    let clef = "G"; const ms = kids(part, "measure");
    const pos = n => { const p = kid(n, "pitch"); if (!p) return null; return parseInt(txt(p, "octave"), 10) * 7 + STEP_I[txt(p, "step")] - (CLEF_BOTTOM[clef] ?? 30); };
    const far = n => { const d = pos(n); return d != null && (d < -8 || d > 16); };
    const off = n => { const d = pos(n); return d != null && (d < -1 || d > 9); };      // below the bottom line or above the top line
    const lineOf = []; let line = 0; ms.forEach((m, i) => { if (i && kids(m, "print").some(x => x.getAttribute("new-system") === "yes")) line++; lineOf[i] = line; });
    const farBy = new Map(), offBy = [];
    ms.forEach((m, i) => {
      kids(m, "attributes").forEach(a => kids(a, "clef").forEach(c => { const n = c.getAttribute("number"); if (!n || n === "1") clef = clefId(c); }));
      const ns = kids(m, "note").filter(n => kid(n, "pitch") && !kid(n, "chord"));
      const f = ns.filter(far); if (f.length) farBy.set(i, { all: f.length === ns.length, f });
      offBy[i] = { n: ns.length, off: ns.filter(off).length };
    });
    const lines = new Map(); farBy.forEach((v, i) => { const L = lineOf[i]; if (!lines.has(L)) lines.set(L, []); lines.get(L).push(i); });
    /* a line with a few notes only, all off the staff (the rest rests): words under or over the staff, not music */
    new Set(lineOf).forEach(L => {
      const idx = ms.map((m, i) => i).filter(i => lineOf[i] === L), n = idx.reduce((a, i) => a + offBy[i].n, 0), o = idx.reduce((a, i) => a + offBy[i].off, 0);
      if (n && n === o && n <= 4 && idx.length >= 3) { const has = idx.filter(i => offBy[i].n); if (!lines.has(L)) lines.set(L, []); has.forEach(i => { if (!lines.get(L).includes(i)) lines.get(L).push(i); farBy.set(i, { all: true, f: [] }); }); }
    });
    lines.forEach((idxs, L) => {
      const lineMs = ms.map((m, i) => i).filter(i => lineOf[i] === L);
      const onlyFar = lineMs.every(i => { const ns = kids(ms[i], "note").filter(n => kid(n, "pitch")); return !ns.length || (farBy.get(i) && farBy.get(i).all); });
      if (onlyFar) idxs.forEach(i => { const m = ms[i]; const ns = kids(m, "note"); const full = ns.reduce((a, n) => a + (kid(n, "chord") ? 0 : parseFloat(txt(n, "duration")) || 0), 0); ns.forEach(n => n.remove()); const r = doc.createElement("note"); r.innerHTML = `<rest measure="yes"/><duration>${Math.round(full)}</duration><voice>1</voice>`; const bl = kids(m, "barline").find(b => (b.getAttribute("location") || "right") === "right"); m.insertBefore(r, bl || null); issues.push(`Takt ${i + 1}: usunięto znaki pod pięciolinią (to pewnie podpisy, nie nuty)`); });
      else idxs.forEach(i => issues.push(`Takt ${i + 1}: nuta daleko od pięciolinii, sprawdź`));
    });
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
      const t = kid(a, "time"); if (t) { beats = beatsOf(txt(t, "beats")) || beats; bt = parseInt(txt(t, "beat-type"), 10) || bt; }
    });
    let sum = barFill(m), whole = false;          // the longest voice (two voices: <backup>)
    kids(m, "note").forEach(n => { const r = kid(n, "rest"); if (r && r.getAttribute("measure") === "yes") whole = true; });
    const full = div * beats * 4 / bt, pickup = (i === 0 || i === ms.length - 1) && sum < full;
    if (!whole && !m.getElementsByTagName("multiple-rest").length && sum > 0 && Math.abs(sum - full) > 0.01 && !pickup)
      out.push(`Takt ${i + 1}: ${sum > full ? "za dużo" : "za mało"} wartości rytmicznych`);
  });
  return out;
}
/* T19: an empty piece to write your own tune, in the instrument's clef (treble, bass, alto or tenor); a keyboard or
   harp melody is one staff in the treble clef (the editor corrects single staves) */
/* the rests of an empty bar: one whole-bar rest, or in an additive metre (3+2+2/8) one rest per group, as editions
   print it (Verovio also gives an additive whole-bar rest no width, so the bar could not be tapped) */
const REST_Q = { 0.5: ["eighth", 0], 0.75: ["eighth", 1], 1: ["quarter", 0], 1.5: ["quarter", 1], 2: ["half", 0], 3: ["half", 1], 4: ["whole", 0], 6: ["whole", 1] };
function emptyBarXml(beats, bt, div, extra = "<voice>1</voice>") {
  const whole = `<note><rest measure="yes"/><duration>${Math.round(div * 4 * beatsOf(beats) / bt)}</duration>${extra}</note>`;
  if (!String(beats).includes("+")) return whole;
  const gs = String(beats).split("+").map(g => { const q = (parseInt(g, 10) || 0) * 4 / bt, d = div * q, r = REST_Q[q]; return r && Number.isInteger(d) ? `<note><rest/><duration>${d}</duration>${extra}<type>${r[0]}</type>${r[1] ? "<dot/>" : ""}</note>` : null; });
  return gs.every(Boolean) ? gs.join("") : whole;
}
function blankXml(bars = 8, o = {}) {
  const beats = o.beats || 4, bt = +o.beatType || 4, div = Math.max(4, bt / 4), cap = div * 4 * beatsOf(beats) / bt, fifths = o.fifths || 0;
  const cx = { treble: ["G", 2], bass: ["F", 4], tenor: ["C", 4], alto: ["C", 3] }[o.clef] || ["G", 2], clef = `<sign>${cx[0]}</sign><line>${cx[1]}</line>`;
  const tempo = o.tempo ? `<direction placement="above"><direction-type><words></words></direction-type><sound tempo="${o.tempo}"/></direction>` : "";
  let m = "";
  for (let i = 1; i <= bars; i++) m += `<measure number="${i}">${i === 1 ? `<attributes><divisions>${div}</divisions><key><fifths>${fifths}</fifths>${o.mode === "minor" ? "<mode>minor</mode>" : ""}</key><time><beats>${beats}</beats><beat-type>${bt}</beat-type></time><clef>${clef}</clef></attributes>${tempo}` : ""}${emptyBarXml(beats, bt, div)}</measure>`;
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>${xesc(o.title || "Moje nuty")}</work-title></work><part-list><score-part id="P1"><part-name>${xesc(o.part || "Głos solowy")}</part-name></score-part></part-list><part id="P1">${m}</part></score-partwise>`;
}
function doubtfulBars(issues) { return [...new Set((issues || []).map(t => parseInt((t.match(/Takt (\d+)/) || [])[1], 10)).filter(Boolean))]; }

/* ---------------- Example piece (public domain melody) ---------------- */
/* "Wlazł kotek na płotek" (by meow, says the running joke): a folk tune with piano, so the piano can be hidden */
function exampleXml() {
  /* "Wlazł kotek na płotek", Polish folk song (public domain). As printed on Polish Wikipedia: 3/4, C major,
     G E E | F D D | C/E/ G2 | G E E | F D D | C/E/ C2 (no words: an instrumental part). Waltz accompaniment.
     For the trombone it sits in the bass clef, small octave (g e e …): on the staff, no ledger lines. */
  const mel = [[["G3", 4, "Wlazł", "single"], ["E3", 4, "ko", "begin"], ["E3", 4, "tek", "end"]],
               [["F3", 4, "na", "single"], ["D3", 4, "pło", "begin"], ["D3", 4, "tek", "end"]],
               [["C3", 8, "i", "single"], ["E3", 8, "mru", "begin"], ["G3", 2, "ga,", "end"]],
               [["G3", 4, "Ład", "begin"], ["E3", 4, "na", "end"], ["E3", 4, "to", "single"]],
               [["F3", 4, "pio", "begin"], ["D3", 4, "sen", "middle"], ["D3", 4, "ka", "end"]],
               [["C3", 8, "nie", "single"], ["E3", 8, "dłu", "begin"], ["C3", 2, "ga.", "end"]]];
  const harm = ["C", "G7", "C", "C", "G7", "C"];
  const RH = { C: ["E4", "G4", "C5"], G7: ["D4", "F4", "B4"] }, LH = { C: "C3", G7: "G2" };     // right hand in close position (§10)
  const dur = { 2: 48, 4: 24, 8: 12 }, typ = { 2: "half", 4: "quarter", 8: "eighth" };
  const pitch = p => { const m = p.match(/^([A-G])(b|#)?(\d)$/); const alt = m[2] === "b" ? -1 : m[2] === "#" ? 1 : 0;
    return `<pitch><step>${m[1]}</step>${alt ? `<alter>${alt}</alter>` : ""}<octave>${m[3]}</octave></pitch>`; };
  let solo = "", pno = "";
  mel.forEach((m, i) => {
    let s = `<measure number="${i + 1}">`;
    if (i === 0) s += `<attributes><divisions>24</divisions><key><fifths>0</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><clef><sign>F</sign><line>4</line></clef></attributes><direction placement="above"><direction-type><words font-weight="bold">Wesoło</words></direction-type><sound tempo="112"/></direction><direction placement="below"><direction-type><dynamics><mf/></dynamics></direction-type></direction>`;
    m.forEach(([p, d]) => { s += `<note>${pitch(p)}<duration>${dur[d]}</duration><voice>1</voice><type>${typ[d]}</type></note>`; });
    if (i === mel.length - 1) s += `<barline location="right"><bar-style>light-heavy</bar-style></barline>`;
    solo += s + "</measure>";
    /* um-pa-pa: the bass on 1, the chord on 2 and 3 */
    let q = `<measure number="${i + 1}">`;
    if (i === 0) q += `<attributes><divisions>24</divisions><key><fifths>0</fifths></key><time><beats>3</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction placement="below"><direction-type><dynamics><p/></dynamics></direction-type><staff>1</staff></direction>`;
    const h = harm[i];
    q += `<note><rest/><duration>24</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`;
    for (let k = 0; k < 2; k++) RH[h].forEach((p, j) => { q += `<note>${j ? "<chord/>" : ""}${pitch(p)}<duration>24</duration><voice>1</voice><type>quarter</type><staff>1</staff></note>`; });
    q += `<backup><duration>72</duration></backup><note>${pitch(LH[h])}<duration>24</duration><voice>5</voice><type>quarter</type><staff>2</staff></note><note><rest/><duration>48</duration><voice>5</voice><type>half</type><staff>2</staff></note>`;
    if (i === mel.length - 1) q += `<barline location="right"><bar-style>light-heavy</bar-style></barline>`;
    pno += q + "</measure>";
  });
  return `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>Wlazł kotek na płotek</work-title></work><part-list><part-group type="start" number="1"><group-symbol>bracket</group-symbol></part-group><score-part id="P1"><part-name>Głos solowy</part-name></score-part><score-part id="P2"><part-name>Fortepian</part-name></score-part><part-group type="stop" number="1"/></part-list><part id="P1">${solo}</part><part id="P2">${pno}</part></score-partwise>`;
}


/* Tata's library lives here, per web address (origin). Never rename the database or a store, and never
   move the live address, without a migration: the pieces would look gone.
   v2: page photos sit in "images" (written only when they change, not on every autosave; records saved by v1
   still carry them inline and move over on their next save), own-sound recordings in "samples".
   iOS drops the connection of an app left in the background ("Connection to Indexed Database server lost"):
   every call reopens and tries once more instead of failing until a reload. A failed read is an error for the
   caller, never an empty library. */
const DB = {
  db: null, opening: null, ok: true, imgStored: new Map(),
  mem: { pieces: new Map(), images: new Map(), samples: new Map() },        // only where the browser has no IndexedDB
  open() {
    if (this.db) return Promise.resolve(this.db);
    if (!this.ok) return Promise.resolve(null);
    if (this.opening) return this.opening;
    let r; try { if (!self.indexedDB) throw new Error("no IndexedDB"); r = indexedDB.open("pulpit-nutowy", 2); }
    catch (e) { console.warn(e); this.ok = false; return Promise.resolve(null); }
    this.opening = new Promise((res, rej) => {
      /* an open can hang on iOS: after 6 s the caller gets an error (and a retry button), a late success is still kept */
      const t = setTimeout(() => rej(Object.assign(new Error("IndexedDB open timeout"), { name: "TimeoutError" })), 6000);
      r.onupgradeneeded = () => { const d = r.result; ["pieces", "images", "samples"].forEach(n => { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: "id" }); }); };
      r.onblocked = () => hud("Zamknij Solo w innych kartach przeglądarki.", 5000);   // an older Solo still holds version 1
      r.onsuccess = () => {
        const d = r.result; clearTimeout(t);
        d.onversionchange = () => { d.close(); if (this.db === d) this.db = null; };
        d.onclose = () => { if (this.db === d) this.db = null; };
        if (this.db && this.db !== d) d.close(); else this.db = d;
        res(this.db);
      };
      r.onerror = () => { clearTimeout(t); rej(r.error); };
    }).finally(() => { this.opening = null; });
    return this.opening;
  },
  lost: e => !!e && /^(InvalidStateError|UnknownError|TransactionInactiveError|TimeoutError)$/.test(e.name),
  async run(fn) {
    let db = await this.open();
    try { return await fn(db); }
    catch (e) {
      if (!db || !this.lost(e)) throw e;
      console.warn("IndexedDB: reopening after", e);
      if (this.db === db) { try { db.close(); } catch {} this.db = null; }
      db = await this.open(); return fn(db);
    }
  },
  /* one transaction; body(t) may return a function giving the result once everything is written */
  tx(db, stores, mode, body) {
    return new Promise((res, rej) => {
      const t = db.transaction(stores, mode); let done;
      t.oncomplete = () => res(typeof done === "function" ? done() : done);
      t.onabort = t.onerror = () => rej(t.error || Object.assign(new Error("transaction aborted"), { name: "AbortError" }));
      done = body(t);
    });
  },
  join(p, list) {
    if (list) { p.images = list; this.imgStored.set(p.id, list); }
    else { if (!Array.isArray(p.images)) p.images = []; if (p.images.length) this.imgStored.delete(p.id); else this.imgStored.set(p.id, p.images); }
    return p;
  },
  all() {
    return this.run(db => {
      if (!db) return Array.from(this.mem.pieces.values());
      return this.tx(db, ["pieces", "images"], "readonly", t => {
        const ps = t.objectStore("pieces").getAll(), is = t.objectStore("images").getAll();
        return () => { const im = new Map((is.result || []).map(x => [x.id, x.list])); return (ps.result || []).map(p => this.join(p, im.get(p.id))); };
      });
    });
  },
  get(id) {
    return this.run(db => {
      if (!db) return this.mem.pieces.get(id);
      return this.tx(db, ["pieces", "images"], "readonly", t => {
        const p = t.objectStore("pieces").get(id), i = t.objectStore("images").get(id);
        return () => p.result ? this.join(p.result, i.result && i.result.list) : undefined;
      });
    });
  },
  /* each piece in turn with its photos, without holding the whole library twice (the backup) */
  each(fn, start) {                               // start(): called again if the read has to begin anew
    return this.run(db => {
      if (start) start();
      if (!db) { this.mem.pieces.forEach(p => fn(p)); return; }
      return this.tx(db, ["pieces", "images"], "readonly", t => {
        const is = t.objectStore("images");
        t.objectStore("pieces").openCursor().onsuccess = e => {
          const c = e.target.result; if (!c) return;
          const p = c.value; is.get(p.id).onsuccess = ev => { const x = ev.target.result; p.images = x ? x.list : Array.isArray(p.images) ? p.images : []; fn(p); c.continue(); };
        };
      });
    });
  },
  put(p) {
    const imgs = Array.isArray(p.images) ? p.images : [], prev = this.imgStored.get(p.id);
    const same = !!prev && (prev === imgs || (prev.length === imgs.length && prev.every((x, i) => x === imgs[i])));
    const rec = { ...p }; delete rec.images;
    return this.run(db => {
      if (!db) { this.mem.pieces.set(p.id, { ...rec, images: imgs }); return; }
      return this.tx(db, ["pieces", "images"], "readwrite", t => {
        t.objectStore("pieces").put(rec);
        if (!same) { if (imgs.length) t.objectStore("images").put({ id: p.id, list: imgs }); else t.objectStore("images").delete(p.id); }
        return () => { this.imgStored.set(p.id, imgs); };
      });
    });
  },
  del(id) {
    return this.run(db => {
      if (!db) { this.mem.pieces.delete(id); return; }
      return this.tx(db, ["pieces", "images"], "readwrite", t => { t.objectStore("pieces").delete(id); t.objectStore("images").delete(id); return () => { this.imgStored.delete(id); }; });
    });
  },
  /* other stores (own-sound recordings): records with an "id" */
  getAllIn(name) { return this.run(db => db ? this.tx(db, [name], "readonly", t => { const r = t.objectStore(name).getAll(); return () => r.result || []; }) : Array.from(this.mem[name].values())); },
  putIn(name, list, dels = []) {
    return this.run(db => {
      if (!db) { list.forEach(v => this.mem[name].set(v.id, v)); dels.forEach(k => this.mem[name].delete(k)); return; }
      return this.tx(db, [name], "readwrite", t => { const st = t.objectStore(name); list.forEach(v => st.put(v)); dels.forEach(k => st.delete(k)); });
    });
  }
};
/* what to tell the person when a save failed: only a full device is "no space" */
function saveErrorText(e) {
  if (e && (e.name === "QuotaExceededError" || (e.inner && e.inner.name === "QuotaExceededError"))) return "Brak miejsca na urządzeniu. Usuń niepotrzebne nuty lub zdjęcia z telefonu.";
  return "Nie udało się zapisać. Spróbuj jeszcze raz.";
}

function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
/* an app on the iPhone home screen cannot follow a download link (a preview with no way back, or nothing):
   the share sheet ("Zachowaj w Plikach") takes the file instead. "shared", "cancelled", "blocked" or "downloaded" */
const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => !!(navigator.standalone || (self.matchMedia && matchMedia("(display-mode: standalone)").matches));
async function saveFile(name, blob) {
  if (isIOS() && isStandalone() && navigator.canShare) {
    const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return "shared"; }
      catch (e) { if (e && e.name === "AbortError") return "cancelled"; if (e && e.name === "NotAllowedError") return "blocked"; console.warn(e); }
    }
  }
  download(name, blob); return "downloaded";
}
/* a photo kept as a data: URL, as a file to share (no fetch: the page's CSP allows no data: requests) */
function dataUrlBlob(u) {
  const i = u.indexOf(","), head = u.slice(0, i), bin = atob(u.slice(i + 1)), a = new Uint8Array(bin.length);
  for (let k = 0; k < bin.length; k++) a[k] = bin.charCodeAt(k);
  return new Blob([a], { type: (head.match(/^data:([^;,]+)/) || [])[1] || "application/octet-stream" });
}
const safeName = s => (s || "nuty").replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 60) || "nuty";


function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Nie udało się otworzyć obrazu.")); i.src = src; }); }
function canvasToJpeg(srcCanvasOrImg, maxEdge, q) {
  const w0 = srcCanvasOrImg.naturalWidth || srcCanvasOrImg.width, h0 = srcCanvasOrImg.naturalHeight || srcCanvasOrImg.height;
  const sc = Math.min(1, maxEdge / Math.max(w0, h0));
  const c = document.createElement("canvas"); c.width = Math.round(w0 * sc); c.height = Math.round(h0 * sc);
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(srcCanvasOrImg, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", q); c.width = c.height = 0;          // let Safari have the canvas memory back now (R21)
  if (url.length < 100) throw new Error("Za mało pamięci na to zdjęcie. Zamknij inne karty i spróbuj jeszcze raz.");   // "data:," when it ran out
  return url;
}
/* the same as a Blob (for the reader: no 3 MB base64 string per page), with its size */
async function canvasToJpegBlob(srcCanvasOrImg, maxEdge, q) {
  const w0 = srcCanvasOrImg.naturalWidth || srcCanvasOrImg.width, h0 = srcCanvasOrImg.naturalHeight || srcCanvasOrImg.height;
  const sc = Math.min(1, maxEdge / Math.max(w0, h0));
  const c = document.createElement("canvas"); c.width = Math.round(w0 * sc); c.height = Math.round(h0 * sc);
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(srcCanvasOrImg, 0, 0, c.width, c.height);
  const W = c.width, H = c.height, blob = await new Promise(r => c.toBlob(r, "image/jpeg", q));
  c.width = c.height = 0;
  if (!blob) throw new Error("Za mało pamięci na to zdjęcie. Zamknij inne karty i spróbuj jeszcze raz.");
  return { blob, W, H };
}


/* ---------------- engraving: beams by metre (Gould, "Behind Bars"; LilyPond/Dorico beam grouping) ----------------
   Only for bars that have no beams of their own (scans, the editor and generated parts come without them).
   - a group never crosses a beat; the beat is a quarter in x/4, a half in x/2, a dotted quarter in 6/8, 9/8, 12/8;
     3/8 and 2/8 are one group
   - 2/4 by the beat; 3/4: six eighths are one group; in 4/4 a half bar of eighths only is one group (beats 1–2,
     3–4, never across the middle); 16ths always by the beat
   - rests, longer notes and grace notes break a group; 16ths get a second beam inside their beat, with a hook
     for a lone 16th; chord notes are beamed through their first note */
const BEAMABLE = { eighth: 1, "16th": 2, "32nd": 3, "64th": 4 };
function beamPlan(beats, bt) {
  /* x/16 beams like x/8 at half the size (12/16 in dotted eighths, 3/16 one group) */
  const u = bt === 16 ? 0.5 : 1, b8 = bt === 8 || bt === 16, compound = b8 && beats % 3 === 0 && beats > 3;
  if (b8 && beats <= 3) return { beat: beats * 0.5 * u, compound: false, whole: true };          // 3/8, 2/8: one group (in quarters)
  if (compound) return { beat: 1.5 * u, compound: true };
  if (bt === 2) return { beat: 2 };
  /* 5/8 = 3+2, 7/8 = 2+2+3 (§2) */
  if (b8) { const g = beats === 7 ? [1, 1, 1.5] : beats === 5 ? [1.5, 1] : null; return { beat: u, groups: g && g.map(x => x * u) }; }
  return { beat: 4 / bt };
}
function autoBeam(doc) {
  [...doc.getElementsByTagName("part")].forEach(part => {
    let div = 1, beats = 4, bt = 4;
    kids(part, "measure").forEach(m => {
      kids(m, "attributes").forEach(a => {
        const d = kid(a, "divisions"); if (d) div = parseFloat(d.textContent) || div;
        const t = kid(a, "time"); if (t) { beats = beatsOf(txt(t, "beats")) || beats; bt = parseInt(txt(t, "beat-type"), 10) || bt; }
      });
      if (m.getElementsByTagName("beam").length) return;                  // the bar already says how it is beamed
      const plan = beamPlan(beats, bt), barQ = beats * 4 / bt;
      /* onsets per voice, in quarter notes from the start of the bar */
      const voices = new Map(); let pos = 0, last = null;
      [...m.children].forEach(el => {
        if (el.tagName === "backup") { pos -= (parseFloat(txt(el, "duration")) || 0) / div; return; }
        if (el.tagName === "forward") { pos += (parseFloat(txt(el, "duration")) || 0) / div; return; }
        if (el.tagName !== "note") return;
        if (kid(el, "chord")) { if (last) last.chord.push(el); return; }
        const grace = !!kid(el, "grace"), dur = grace ? 0 : (parseFloat(txt(el, "duration")) || 0) / div;
        const v = (txt(el, "voice") || "1") + "/" + (txt(el, "staff") || "1");
        const o = { el, chord: [], on: pos, dur, grace, rest: !!kid(el, "rest"), lvl: BEAMABLE[txt(el, "type")] || 0 };
        if (!voices.has(v)) voices.set(v, []); voices.get(v).push(o); last = o;
        pos += dur;
      });
      voices.forEach(list => {
        const notes = list.filter(o => !o.grace);
        const eighthsOnly = notes.length && notes.every(o => !o.rest && o.lvl === 1);
        /* in 4/4 a half bar of eighths only may be one group (never across the middle) */
        const halfOnly = h => { const hs = notes.filter(o => (o.on < 2 - 1e-6) === (h === 0)); return hs.length && hs.every(o => !o.rest && o.lvl === 1); };
        /* which group a note belongs to */
        const bounds = []; if (plan.groups) { let x = 0; plan.groups.forEach(g => { x += g; bounds.push(x); }); }
        const groupOf = o => {
          if (plan.whole) return 0;
          if (plan.groups) return bounds.findIndex(b => o.on < b - 1e-6);
          if (eighthsOnly && beats === 3 && bt === 4) return 0;                       // 3/4: six eighths are one group
          if (beats === 4 && bt === 4) { const h = o.on < 2 - 1e-6 ? 0 : 1; if (halfOnly(h)) return 10 + h; }   // 4/4: half bars of eighths
          return Math.floor(o.on / plan.beat + 1e-6);
        };
        let grp = [];
        const flush = () => {
          if (grp.length > 1) grp.forEach((o, i) => {
            const pos = i === 0 ? "begin" : i === grp.length - 1 ? "end" : "continue";
            const set = (n, txtv) => { const b = doc.createElement("beam"); b.setAttribute("number", String(n)); b.textContent = txtv; insertBeam(o.el, b); };
            set(1, pos);
            /* second beam between neighbouring 16ths; a lone 16th gets a hook towards its group */
            if (o.lvl >= 2) {
              const p = grp[i - 1], q = grp[i + 1], lp = p && p.lvl >= 2, lq = q && q.lvl >= 2;
              set(2, lp && lq ? "continue" : lp ? "end" : lq ? "begin" : i === grp.length - 1 ? "backward hook" : "forward hook");
            }
          });
          grp = [];
        };
        let g = null;
        list.forEach(o => {
          if (o.grace) return;
          if (o.rest || !o.lvl) { flush(); g = null; return; }
          const k = groupOf(o); if (grp.length && k !== g) flush();
          g = k; grp.push(o);
        });
        flush();
      });
    });
  });
  return doc;
}
/* <beam> goes after <type>, <dot>s, <accidental>, <time-modification> and <stem>, before <notations> and <lyric> */
/* beams set by hand in a bar (the editor's "Belka") are kept; when later edits leave them wrong (a beam on a quarter
   or a rest, a group that never ends), the bar goes back to automatic beaming */
function cleanBeams(doc) {
  [...doc.getElementsByTagName("measure")].forEach(m => {
    if (!m.getElementsByTagName("beam").length) return;
    const voices = new Map();
    kids(m, "note").filter(n => !kid(n, "chord") && !kid(n, "grace")).forEach(n => { const v = (txt(n, "voice") || "1") + "/" + (txt(n, "staff") || "1"); if (!voices.has(v)) voices.set(v, []); voices.get(v).push(n); });
    let ok = true;
    voices.forEach(list => { let open = false; list.forEach(n => {
      const b = [...n.getElementsByTagName("beam")].find(x => (x.getAttribute("number") || "1") === "1"), t = b && b.textContent.trim();
      if (b && (kid(n, "rest") || !BEAMABLE[txt(n, "type")])) ok = false;
      if (t === "begin") { if (open) ok = false; open = true; } else if (t === "continue" || t === "end") { if (!open) ok = false; if (t === "end") open = false; } else if (open) ok = false;
    }); if (open) ok = false; });
    if (!ok) [...m.getElementsByTagName("beam")].forEach(b => b.remove());
  });
  return doc;
}
/* the editor's "Belka": join the chosen note to the next one with a beam, or part them; the bar's beams become
   explicit (copied from the automatic ones first) so the choice stays */
function setBeamJoin(doc, m, n, join) {
  if (!m.getElementsByTagName("beam").length) {
    const tmp = autoBeam(parseXml(new XMLSerializer().serializeToString(doc)));
    const part = m.parentNode, pi = [...doc.getElementsByTagName("part")].indexOf(part), mi = kids(part, "measure").indexOf(m);
    const am = kids(tmp.getElementsByTagName("part")[pi], "measure")[mi], an = kids(am, "note");
    kids(m, "note").forEach((x, i) => kids(an[i], "beam").forEach(b => insertBeam(x, doc.importNode(b, true))));
  }
  const v = (txt(n, "voice") || "1") + "/" + (txt(n, "staff") || "1");
  const list = kids(m, "note").filter(x => !kid(x, "chord") && !kid(x, "grace") && (txt(x, "voice") || "1") + "/" + (txt(x, "staff") || "1") === v);
  const i = list.indexOf(n); if (i < 0 || i + 1 >= list.length) return "last";
  const lvl = x => (kid(x, "rest") ? 0 : BEAMABLE[txt(x, "type")] || 0);
  if (join && (!lvl(n) || !lvl(list[i + 1]))) return "long";
  const b1 = x => { const b = [...x.getElementsByTagName("beam")].find(y => (y.getAttribute("number") || "1") === "1"); return b ? b.textContent.trim() : ""; };
  const joined = list.map((x, k) => k + 1 < list.length && ["begin", "continue"].includes(b1(x)) && ["continue", "end"].includes(b1(list[k + 1])));
  joined[i] = join;
  /* rewrite this voice's beams from the joins: level 1 over each run, level 2+ between neighbouring 16ths, a hook for a lone one */
  const chordOf = x => { const out = [x]; let y = x.nextElementSibling; while (y && y.tagName === "note" && kid(y, "chord")) { out.push(y); y = y.nextElementSibling; } return out; };
  list.forEach(x => chordOf(x).forEach(y => kids(y, "beam").forEach(b => b.remove())));
  let k = 0;
  while (k < list.length) {
    let e = k; while (e < list.length - 1 && joined[e]) e++;
    if (e > k) {
      const run = list.slice(k, e + 1);
      run.forEach((x, j) => {
        const put = (num, t) => { const b = doc.createElement("beam"); b.setAttribute("number", String(num)); b.textContent = t; insertBeam(x, b); };
        put(1, j === 0 ? "begin" : j === run.length - 1 ? "end" : "continue");
        for (let L = 2; L <= lvl(x); L++) {
          const p = run[j - 1], q = run[j + 1], lp = p && lvl(p) >= L, lq = q && lvl(q) >= L;
          put(L, lp && lq ? "continue" : lp ? "end" : lq ? "begin" : (q ? "forward hook" : "backward hook"));
        }
      });
    }
    k = e + 1;
  }
  return "ok";
}
function insertBeam(note, beam) {
  const after = ["notations", "lyric", "play", "listen"].map(t => kid(note, t)).find(Boolean);
  note.insertBefore(beam, after || null);
}

/* ---------------- staff fit: how many ledger lines a part needs (Gould: 2–3 are comfortable, more is hard) ----------------
   Diatonic index = octave × 7 + step (C=0 … B=6). The five lines of a clef span bottom … bottom + 8. */
const CLEF_LINES = { treble: 30, bass: 18, tenor: 22, alto: 24 };     // bottom line: E4, G2, D3, F3
function ledgerCost(idxs, clef) {
  const lo = CLEF_LINES[clef] ?? 30, hi = lo + 8; let cost = 0;
  idxs.forEach(d => { const n = d < lo - 1 ? Math.floor((lo - d) / 2) : d > hi + 1 ? Math.floor((d - hi) / 2) : 0; cost += n * n + (n > 3 ? 6 : 0); });
  return cost / Math.max(1, idxs.length);
}
/* written diatonic positions of the melody-like parts (not a piano) of a score */
function partIndexes(xml, keepIds) {
  const doc = parseXml(xml), out = [];
  kids(doc.documentElement, "part").forEach(p => {
    if (keepIds && !keepIds.includes(p.getAttribute("id"))) return;
    if (p.getElementsByTagName("staves")[0] && parseInt(p.getElementsByTagName("staves")[0].textContent, 10) > 1) return;
    [...p.getElementsByTagName("pitch")].forEach(x => out.push(parseInt(txt(x, "octave"), 10) * 7 + STEP_I[txt(x, "step")]));
  });
  return out;
}

/* ---------------- markings read as text (the reader's OCR of the band above each staff) ----------------
   Each text has its staff and its place on the photo; it goes to the bar under it (bars of a line are taken as
   equally wide) and before the note nearest its left edge. Only what is clearly music is kept: tempo and
   performance words (Italian, Polish, German), metronome marks (also set the playback tempo), dynamics of two
   or more letters, D.C./D.S./Fine. Bar numbers, chord-like fragments and noise are left out. */
const MUSIC_WORDS = /^(allegr|andant|moderat|adagi|largo|larghett|lento|presto|prestissim|vivac|vivo|grave|maestos|cantabil|dolc|espress|legat|staccat|marcat|tenut|simil|rit|ritard|riten|rall|accel|a\s?tempo|tempo|cresc|decresc|dim|smorz|morendo|perdendo|poco|molto|pi[uù]|meno|sempre|subito|con\s|senza|tranquill|giocos|scherz|animat|agitat|energic|risolut|pesant|leggier|sostenut|fine|d\.?\s?c\.?|d\.?\s?s\.?|al\s(fine|coda)|coda|solo|soli|tutti|a\s?2|div|unis|sord|wesoł|wesol|wolno|umiarkowan|szybk|spokojn|żyw|zyw|marsz|śpiewn|spiewn|łagodn|lagodn|ciężk|ciezk|mäßig|massig|langsam|schnell|lebhaft|ruhig|breit|zart)/i;
function classifyText(raw, score) {
  const t = String(raw || "").trim().replace(/\s+/g, " "); if (!t || score < 0.5) return null;
  /* a lone p, f or capital letter above a staff is as often a note name in an exercise as a dynamic or a
     rehearsal letter: left out (a wrong marking is worse than a missing one; the editor adds them in a tap) */
  if (/^(ppp|pp|mp|mf|ff|fff|sfz|sfp|rfz|fz)$/.test(t)) return { kind: "dyn", value: t };
  const mm = t.match(/[=＝]\s*(?:ca\.?\s*)?(\d{2,3})\b/); if (mm && +mm[1] >= 30 && +mm[1] <= 260) return { kind: "tempo", bpm: +mm[1], text: t };
  if (/^\d+$/.test(t)) return null;                                      // bar numbers
  if (t.length >= 2 && t.length <= 32 && MUSIC_WORDS.test(t.replace(/^[^A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]+/, ""))) return { kind: "words", text: t };
  return null;
}
function attachTexts(xml, pages) {
  try {
    const doc = parseXml(xml), part = doc.getElementsByTagName("part")[0]; if (!part) return xml;
    const ms = kids(part, "measure"), sys = [];
    ms.forEach((m, i) => { const nl = i === 0 || [...m.getElementsByTagName("print")].some(p => p.getAttribute("new-system") === "yes" || p.getAttribute("new-page") === "yes"); if (nl || !sys.length) sys.push([]); sys[sys.length - 1].push(m); });
    const staves = []; pages.forEach(pg => (pg.staves || []).slice().sort((a, b) => a.index - b.index).forEach(s => staves.push({ ...s, texts: (pg.texts || []).filter(t => t.staff === s.index) })));
    if (staves.length !== sys.length) return xml;                       // not one staff per line (e.g. piano): leave it
    let added = 0;
    staves.forEach((st, si) => st.texts.forEach(t => {
      const c = classifyText(t.text, t.score); if (!c) return;
      if (!(st.w > 0) || !Number.isFinite(st.cx) || !Number.isFinite(t.x0) || !sys[si] || !sys[si].length) return;     // no place on the photo
      const left = st.cx - st.w / 2, frac = Math.max(0, Math.min(0.999, (t.x0 - left) / st.w)), bars = sys[si];
      const bi = Math.min(bars.length - 1, Math.floor(frac * bars.length)), m = bars[bi], inBar = frac * bars.length - bi;
      const notes = kids(m, "note").filter(n => !kid(n, "chord") && !kid(n, "grace")), target = notes[Math.min(notes.length - 1, Math.floor(inBar * notes.length))] || null;
      const d = doc.createElement("direction"); d.setAttribute("placement", c.kind === "dyn" ? "below" : "above");
      if (c.kind === "dyn") d.innerHTML = `<direction-type><dynamics><${c.value}/></dynamics></direction-type>`;
      else if (c.kind === "rehearsal") d.innerHTML = `<direction-type><rehearsal>${xesc(c.text)}</rehearsal></direction-type>`;
      else if (c.kind === "tempo") d.innerHTML = `<direction-type><words font-weight="bold">${xesc(c.text)}</words></direction-type><sound tempo="${c.bpm}"/>`;
      else d.innerHTML = `<direction-type><words${/^(allegr|andant|moderat|adagi|largo|lento|presto|vivac|grave|tempo|wesoł|wolno|umiarkowan|szybk|spokojn|marsz)/i.test(c.text) ? ' font-weight="bold"' : ' font-style="italic"'}>${xesc(c.text)}</words></direction-type>`;
      m.insertBefore(d, target || kids(m, "barline").find(b => (b.getAttribute("location") || "right") === "right") || null); added++;     // never after the closing barline
    }));
    return added ? new XMLSerializer().serializeToString(doc) : xml;
  } catch (e) { console.warn(e); return xml; }
}

/* ---------------- ready tunes (public domain only) ----------------
   Notes at concert pitch, durations in sixteenths; Solo writes them for the chosen instrument (its octave,
   transposition and clef) and adds the piano, like the example. Copyrighted children's songs are never shipped. */
const READY_TUNES = {
  kotek: { title: "Wlazł kotek na płotek", composer: "", fifths: 0, time: [3, 4], tempo: 112,
    bars: "G4:4 E4:4 E4:4|F4:4 D4:4 D4:4|C4:2 E4:2 G4:8|G4:4 E4:4 E4:4|F4:4 D4:4 D4:4|C4:2 E4:2 C4:8" },
  janie: { title: "Panie Janie", composer: "", fifths: -1, time: [4, 4], tempo: 100,
    bars: "F4:4 G4:4 A4:4 F4:4|F4:4 G4:4 A4:4 F4:4|A4:4 Bb4:4 C5:8|A4:4 Bb4:4 C5:8|C5:2 D5:2 C5:2 Bb4:2 A4:4 F4:4|C5:2 D5:2 C5:2 Bb4:2 A4:4 F4:4|F4:4 C4:4 F4:8|F4:4 C4:4 F4:8" },
  oda: { title: "Oda do radości", composer: "Ludwig van Beethoven", fifths: 2, time: [4, 4], tempo: 100,
    bars: "F#4:4 F#4:4 G4:4 A4:4|A4:4 G4:4 F#4:4 E4:4|D4:4 D4:4 E4:4 F#4:4|F#4:6 E4:2 E4:8|F#4:4 F#4:4 G4:4 A4:4|A4:4 G4:4 F#4:4 E4:4|D4:4 D4:4 E4:4 F#4:4|E4:6 D4:2 D4:8" }
};
function readyTuneXml(id) {
  const t = READY_TUNES[id], typ = { 1: "16th", 2: "eighth", 3: "eighth", 4: "quarter", 6: "quarter", 8: "half", 12: "half", 16: "whole" }, n = t.bars.split("|").length;
  let s = `<?xml version="1.0" encoding="UTF-8"?><score-partwise version="3.1"><work><work-title>${xesc(t.title)}</work-title></work>${t.composer ? `<identification><creator type="composer">${xesc(t.composer)}</creator></identification>` : ""}<part-list><score-part id="P1"><part-name>Melodia</part-name></score-part></part-list><part id="P1">`;
  t.bars.split("|").forEach((b, i) => {
    s += `<measure number="${i + 1}">` + (i ? "" : `<attributes><divisions>4</divisions><key><fifths>${t.fifths}</fifths></key><time><beats>${t.time[0]}</beats><beat-type>${t.time[1]}</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction placement="above"><direction-type><words></words></direction-type><sound tempo="${t.tempo}"/></direction>`);
    b.trim().split(/\s+/).forEach(tok => { const [p, d] = tok.split(":"), m = p.match(/^([A-G])(#|b)?(\d)$/), dd = +d;
      s += `<note><pitch><step>${m[1]}</step>${m[2] ? `<alter>${m[2] === "#" ? 1 : -1}</alter>` : ""}<octave>${m[3]}</octave></pitch><duration>${dd}</duration><voice>1</voice><type>${typ[dd]}</type>${[3, 6, 12].includes(dd) ? "<dot/>" : ""}</note>`; });
    s += (i === n - 1 ? `<barline location="right"><bar-style>light-heavy</bar-style></barline>` : "") + `</measure>`;
  });
  return s + `</part></score-partwise>`;
}

/* the Solo "aura": a clean wash of neighbouring colours (blue, violet, a touch of pink), never mixed into grey; used on
   the start screen, the first-run welcome and above the library instead of pictures */
const STAGE_SVG = `<div class="aura" aria-hidden="true"></div>`;

/* ---------------- re-barring after a metre change (Nat, 7 Oct: "the notes should adapt by themselves") ----------------
   From the bar where the metre changes to the next metre change (or the end), every part's music flows into bars of the
   new length, as notation programs do: a note that crosses a bar line is split into tied notes, lengths that cannot be
   written as one note (5 eighths) become tied notes, rests are split without ties, the last bar is filled with rests.
   Directions (dynamics, tempo words) and chord symbols travel with the note they stood before. Parts with two voices,
   two staves, tuplets, repeats or voltas are not rewritten (the change then only marks the bars that do not add up). */
const REBAR_Q = [[4, "whole", 0], [3, "half", 1], [2, "half", 0], [1.5, "quarter", 1], [1, "quarter", 0], [0.75, "eighth", 1], [0.5, "eighth", 0], [0.375, "16th", 1], [0.25, "16th", 0], [0.125, "32nd", 0]];
function rebarSplit(d, div) {               // a length in divisions as written note values, longest first
  const out = []; let left = d;
  while (left > 1e-9) { const r = REBAR_Q.find(([q]) => q * div <= left + 1e-9 && Number.isInteger(Math.round(q * div * 1e6) / 1e6)); if (!r) return null; out.push(r); left -= r[0] * div; }
  return out;
}
function rebarCan(part, from, to) {
  const ms = kids(part, "measure").slice(from, to);
  return ms.every(m => !m.getElementsByTagName("time-modification").length && !m.getElementsByTagName("repeat").length && !m.getElementsByTagName("ending").length);
}
function rebarScore(doc, parts, from, beats, bt) {
  /* the stretch: to the next bar that sets a metre of its own */
  const stopOf = part => { const ms = kids(part, "measure"); for (let i = from + 1; i < ms.length; i++) if (kids(ms[i], "attributes").some(a => kid(a, "time"))) return i; return ms.length; };
  if (!parts.every(p => rebarCan(p, from, stopOf(p)))) return false;
  const counts = parts.map(part => rebarPart(doc, part, from, stopOf(part), beats, bt));
  if (counts.some(c => c == null)) return false;
  /* every part ends with the same number of bars: shorter ones get whole-bar rests */
  const max = Math.max(...counts);
  parts.forEach((part, i) => {
    for (let k = counts[i]; k < max; k++) {
      const ms = kids(part, "measure"), last = ms[from + counts[i] - 1 + (k - counts[i])], div = divAt(part, last), cap = Math.round(div * 4 * beatsOf(beats) / bt);
      const m = doc.createElement("measure"); m.innerHTML = `<note><rest measure="yes"/><duration>${cap}</duration><voice>1</voice></note>`;
      last.after(m); const fin = kids(last, "barline").find(b => (b.getAttribute("location") || "right") === "right"); if (fin) m.appendChild(fin);
    }
  });
  parts.forEach(part => kids(part, "measure").forEach((m, i) => m.setAttribute("number", String(i + 1))));
  return true;
}
function divAt(part, m) { let d = 1; for (const mm of kids(part, "measure")) { kids(mm, "attributes").forEach(a => { const x = kid(a, "divisions"); if (x) d = parseFloat(x.textContent) || d; }); if (mm === m) break; } return d; }
function rebarPart(doc, part, from, stop, beats, bt) {
  const all = kids(part, "measure"), ms = all.slice(from, stop); if (!ms.length) return 0;
  let div = divAt(part, ms[0]), cap = div * 4 * beatsOf(beats) / bt;
  /* bars that cannot hold a whole number of divisions (7/8 with divisions 1): every length in the part doubles */
  let k = 1; while (!Number.isInteger(Math.round(cap * k * 1e6) / 1e6) && k < 16) k *= 2;
  if (k > 1) {
    [...part.getElementsByTagName("divisions")].forEach(d => (d.textContent = String((parseFloat(d.textContent) || 1) * k)));
    [...part.getElementsByTagName("duration")].forEach(d => (d.textContent = String(Math.round((parseFloat(d.textContent) || 0) * k))));
    div *= k; cap *= k;
  }
  cap = Math.round(cap);
  /* the music of the stretch, one stream per voice and staff (a piano: right hand, left hand, second voices) */
  const firstAttrs = kids(ms[0], "attributes"), streams = new Map(); let pending = [], finalBar = null, lastKey = "1/1", lastItem = null;
  const key = n => (txt(n, "voice") || "1") + "/" + (txt(n, "staff") || "1");
  const stream = kk => { if (!streams.has(kk)) streams.set(kk, []); return streams.get(kk); };
  ms.forEach((m, mi) => {
    [...m.children].forEach(el => {
      const t = el.tagName;
      if (t === "attributes") { if (mi > 0) pending.push(el); return; }
      if (t === "print" || t === "backup") return;
      if (t === "barline") { if (mi === ms.length - 1 && (el.getAttribute("location") || "right") === "right") finalBar = el; return; }
      if (t === "forward") {          // a gap in a voice: a rest of that length
        const n = doc.createElement("note"); n.innerHTML = `<rest/><duration>${txt(el, "duration")}</duration>${kid(el, "voice") ? kid(el, "voice").outerHTML : ""}${kid(el, "staff") ? kid(el, "staff").outerHTML : ""}`;
        el = n;
      } else if (t !== "note") { pending.push(el); return; }
      if (kid(el, "chord") && lastItem) { lastItem.els.push(el); return; }
      const grace = !!kid(el, "grace"), kk = key(el);
      lastItem = { pre: pending, els: [el], dur: grace ? 0 : Math.round(parseFloat(txt(el, "duration")) || 0), rest: !!kid(el, "rest"), grace, vs: kk };
      stream(kk).push(lastItem); pending = []; lastKey = kk;
    });
  });
  const tail = pending, hasStaff = ms.some(m => m.getElementsByTagName("staff").length);
  if (!streams.size) stream("1/1");
  /* each stream flows into bars of the new length */
  const setLen = (n, d, r) => {
    let du = kid(n, "duration"); if (!du) { du = doc.createElement("duration"); n.appendChild(du); } du.textContent = String(d);
    kids(n, "type").forEach(x => x.remove()); kids(n, "dot").forEach(x => x.remove()); [...n.getElementsByTagName("beam")].forEach(x => x.remove());
    const rest = kid(n, "rest"); if (rest) rest.removeAttribute("measure");
    const ty = doc.createElement("type"); ty.textContent = r[1]; const after = kid(n, "voice") || du; after.after(ty);
    if (r[2]) { const dt = doc.createElement("dot"); ty.after(dt); }
  };
  const tie = (n, type) => {
    const t = doc.createElement("tie"); t.setAttribute("type", type); kid(n, "duration").after(t);
    let no = kid(n, "notations"); if (!no) { no = doc.createElement("notations"); n.appendChild(no); }
    const td = doc.createElement("tied"); td.setAttribute("type", type); no.appendChild(td);
  };
  const dropTies = n => { kids(n, "tie").forEach(x => x.remove()); const no = kid(n, "notations"); if (no) { kids(no, "tied").forEach(x => x.remove()); if (!no.children.length) no.remove(); } };
  const restXml = (d, vs, r) => { const [v, st] = vs.split("/"); return `<note><rest${r ? "" : ' measure="yes"'}/><duration>${d}</duration><voice>${v}</voice>${r ? `<type>${r[1]}</type>${r[2] ? "<dot/>" : ""}` : ""}${hasStaff ? `<staff>${st}</staff>` : ""}</note>`; };
  const barsOf = (list, vs) => {
    const bars = [[]]; let room = cap;
    for (const it of list) {
      const bar = () => bars[bars.length - 1];
      if (it.grace || !it.dur) { bar().push(...it.pre, ...it.els); continue; }
      const hadStart = it.els.map(n => kids(n, "tie").some(t => t.getAttribute("type") === "start")), hadStop = it.els.map(n => kids(n, "tie").some(t => t.getAttribute("type") === "stop"));
      const pieces = []; let left = it.dur;
      while (left > 0) {
        if (room === 0) { pieces.push("bar"); room = cap; }
        const take = Math.min(left, room), sp = rebarSplit(take, div); if (!sp) return null;
        sp.forEach(r => pieces.push(r)); left -= take; room -= take;
      }
      const last = pieces.filter(p => p !== "bar").length - 1; let idx = 0;
      for (const p of pieces) {
        if (p === "bar") { bars.push([]); continue; }
        if (idx === 0) bar().push(...it.pre);
        it.els.map(e => (idx === last ? e : e.cloneNode(true))).forEach((c, ci) => {
          setLen(c, Math.round(p[0] * div), p);
          if (!it.rest) {
            dropTies(c);
            if (idx > 0 || hadStop[ci]) tie(c, "stop");
            if (idx < last || hadStart[ci]) tie(c, "start");
            /* only the first piece keeps articulations, dynamics and lyrics; only the last one ends a slur */
            if (idx > 0) { kids(c, "lyric").forEach(x => x.remove()); const no = kid(c, "notations"); if (no) [...no.children].filter(x => x.tagName !== "tied" && !(x.tagName === "slur" && x.getAttribute("type") === "stop")).forEach(x => x.remove()); }
            if (idx < last) { const no = kid(c, "notations"); if (no) kids(no, "slur").filter(x => x.getAttribute("type") === "stop").forEach(x => x.remove()); }
          }
          bar().push(c);
        });
        idx++;
      }
    }
    /* the last bar of the stream: rests to its end */
    const used = cap - room;
    if (used > 0 && used < cap) (rebarSplit(cap - used, div) || []).forEach(r => bars[bars.length - 1].push(parseXml(restXml(Math.round(r[0] * div), vs, r)).documentElement));
    if (!used && bars.length > 1 && !bars[bars.length - 1].some(x => x.tagName === "note")) { const extra = bars.pop(); bars[bars.length - 1].push(...extra); }
    return bars;
  };
  const per = [...streams].map(([vs, list]) => ({ vs, bars: barsOf(list, vs) }));
  if (per.some(x => !x.bars)) return null;
  const n = Math.max(...per.map(x => x.bars.length));
  /* the bars, stream after stream with a backup between them */
  const out = [];
  for (let i = 0; i < n; i++) {
    const m = doc.createElement("measure"); if (i === 0) firstAttrs.forEach(a => m.appendChild(a));
    per.forEach((x, si) => {
      if (si > 0) { const b = doc.createElement("backup"); b.innerHTML = `<duration>${cap}</duration>`; m.appendChild(b); }
      let content = x.bars[i] || [];
      const notes = content.filter(e => e.tagName === "note" && !kid(e, "chord") && !kid(e, "grace"));
      if (!notes.length || notes.every(e => kid(e, "rest"))) content = [...content.filter(e => e.tagName !== "note"), parseXml(restXml(cap, x.vs, null)).documentElement];
      content.forEach(e => m.appendChild(e.ownerDocument === doc ? e : doc.importNode(e, true)));
    });
    out.push(m);
  }
  tail.forEach(x => out[out.length - 1].appendChild(x));
  if (finalBar) out[out.length - 1].appendChild(finalBar);
  const anchor = all[stop] || null; ms.forEach(m => m.remove());
  out.forEach(m => part.insertBefore(m, anchor));
  return out.length;
}
