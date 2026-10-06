/* Solo: arranging, rule-based and on the device (no paid AI): a second voice (T25), chords or
   functions under the melody (T26), a part for another instrument (T27), a swing feel (T29).
   Uses the helpers in core.js (parseXml, kids, kid, txt, keyAlter, STEP_I, STEP_N, lofToPitch, plName). */
"use strict";

const midiOf = p => 12 * (parseInt(txt(p, "octave"), 10) + 1) + [0, 2, 4, 5, 7, 9, 11][STEP_I[txt(p, "step")]] + (parseFloat(txt(p, "alter")) || 0);
function setPitch(doc, p, idx, fifths) {
  const st = STEP_N[((idx % 7) + 7) % 7];
  kid(p, "step").textContent = st; kid(p, "octave").textContent = String(Math.floor(idx / 7));
  let al = kid(p, "alter"); const a = keyAlter(fifths, st);
  if (a) { if (!al) { al = doc.createElement("alter"); p.insertBefore(al, kid(p, "octave")); } al.textContent = String(a); } else if (al) al.remove();
}

/* T25: a second voice under the melody, inside the key.
   level 1 (Łatwy): parallel thirds; 2 (Średni): thirds, but a big leap in the melody keeps the second voice
   still (it holds its note); 3 (Zaawansowany): third or sixth below, whichever moves least (smooth line). */
function secondVoiceXml(xml, partId, { interval = 3, level = 1 } = {}) {
  const doc = parseXml(xml), root = doc.documentElement;
  const src = kids(root, "part").find(p => p.getAttribute("id") === partId); if (!src) return xml;
  const ids = new Set(kids(root, "part").map(p => p.getAttribute("id")));
  let n = 2; while (ids.has("P" + n)) n++; const id = "P" + n;
  const part = src.cloneNode(true); part.setAttribute("id", id);
  let fifths = 0, prev = null, prevMel = null;
  kids(part, "measure").forEach(m => {
    kids(m, "attributes").forEach(a => { const k = kid(a, "key"); if (k) fifths = parseInt(txt(k, "fifths"), 10) || 0; });
    kids(m, "direction").forEach(d => d.remove());
    kids(m, "note").forEach(note => {
      kids(note, "accidental").forEach(a => a.remove()); kids(note, "lyric").forEach(a => a.remove());
      const p = kid(note, "pitch"); if (!p) return;
      const idx = parseInt(txt(p, "octave"), 10) * 7 + STEP_I[txt(p, "step")], mel = midiOf(p);
      let target = idx - (interval - 1);                                   // a third = 2 steps, a sixth = 5 steps
      if (level === 3) {
        const a = idx - 2, b = idx - 5;
        target = prev === null ? a : (Math.abs(a - prev) <= Math.abs(b - prev) ? a : b);
      }
      if (level === 2 && prev !== null && prevMel !== null && Math.abs(mel - prevMel) > 5) {
        /* the melody leaps: keep the previous harmony note if it still sounds well (a 3rd or 6th below, or 5th/8ve) */
        const iv = ((idx - prev) % 7 + 7) % 7;
        if ([2, 4, 5, 0].includes(iv) && prev < idx) target = prev;
      }
      setPitch(doc, p, target, fifths); prev = target; prevMel = mel;
    });
  });
  root.appendChild(part);
  const pl = kid(root, "part-list"), sp = doc.createElement("score-part");
  sp.setAttribute("id", id); sp.innerHTML = `<part-name>Głos 2</part-name>`; pl.appendChild(sp);
  return new XMLSerializer().serializeToString(doc);
}

/* T26: the chord (or function) of each bar, chosen from the key's main triads by how much of the bar
   each one covers; the strong beat and the bar's first note weigh more. Names are given in the key the
   music is shown in (after transposition), Polish style: major upper case, minor lower case. */
const DEGREES = [
  { d: 0, lof: 0, minor: false, fn: "T" }, { d: 3, lof: -1, minor: false, fn: "S" }, { d: 4, lof: 1, minor: false, fn: "D" },
  { d: 5, lof: 3, minor: true, fn: "Tp" }, { d: 1, lof: 2, minor: true, fn: "Sp" }, { d: 2, lof: 4, minor: true, fn: "Dp" }
];
function chordsForBars(xml, partId) {
  const doc = parseXml(xml), part = kids(doc.documentElement, "part").find(p => p.getAttribute("id") === partId) || kids(doc.documentElement, "part")[0];
  if (!part) return [];
  let fifths = 0, mode = "major";
  const out = [];
  kids(part, "measure").forEach((m, i) => {
    kids(m, "attributes").forEach(a => { const k = kid(a, "key"); if (k) { fifths = parseInt(txt(k, "fifths"), 10) || 0; mode = txt(k, "mode") === "minor" ? "minor" : "major"; } });
    const tonicLof = fifths + (mode === "minor" ? 3 : 0);       // a minor key is read from its relative major's triads
    const w = new Array(12).fill(0); let first = true;
    kids(m, "note").forEach(n => {
      const p = kid(n, "pitch"); if (!p || kid(n, "grace")) return;
      const d = parseFloat(txt(n, "duration")) || 1; w[((midiOf(p) % 12) + 12) % 12] += d * (first ? 1.6 : 1); first = false;
    });
    if (!w.some(Boolean)) { out.push(null); return; }
    const pcOfLof = l => ((l * 7) % 12 + 12) % 12;
    let best = null, score = -1;
    DEGREES.forEach((g, k) => {
      const root = pcOfLof(tonicLof + g.lof), tri = [root, (root + (g.minor ? 3 : 4)) % 12, (root + 7) % 12];
      if (g.fn === "D") tri.push((root + 10) % 12);                                  // the dominant may carry its seventh (G7)
      const s = tri.reduce((a, pc) => a + w[pc], 0) - k * 0.01;                        // ties: T, S, D first
      if (s > score) { score = s; best = { ...g, seventh: g.fn === "D" && w[(root + 10) % 12] > 0 }; }
    });
    out.push({ bar: i + 1, ...best, tonicLof, mode });
  });
  return out;
}
function chordLabel(c, shiftFifths, kind) {
  if (!c) return "";
  if (kind === "fn") return (c.mode === "minor" ? ({ T: "tP", S: "sP", D: "dP", Tp: "t", Sp: "s", Dp: "D" }[c.fn] || c.fn) : c.fn) + (c.seventh ? "7" : "");
  const p = lofToPitch(c.tonicLof + c.lof + shiftFifths), name = plName(p.letter, p.alter);
  return (c.minor ? name.toLowerCase() : name) + (c.seventh ? "7" : "");
}
/* the labels as text under the first note of each bar */
function withChords(doc, partId, kind, shiftFifths) {
  const part = kids(doc.documentElement, "part").find(p => p.getAttribute("id") === partId) || kids(doc.documentElement, "part")[0];
  if (!part) return doc;
  const chords = chordsForBars(new XMLSerializer().serializeToString(doc), partId);
  kids(part, "measure").forEach((m, i) => {
    const label = chordLabel(chords[i], shiftFifths, kind); if (!label) return;
    const d = doc.createElement("direction"); d.setAttribute("placement", "below");
    d.innerHTML = `<direction-type><words font-weight="bold">${label}</words></direction-type>`;
    const firstNote = kid(m, "note"); m.insertBefore(d, firstNote || null);
  });
  return doc;
}

/* T27: a part for another instrument: the music moved by the inverse of the preset that reads it, in the
   treble clef (trumpet, clarinet, saxophone, horn, violin, flute all read treble clef) */
function partForInstrument(xml, iv, srcFifths = 0) {
  const inv = fixEnharmonic({ d: -iv.d, s: -iv.s }, srcFifths);         // the key with the fewest signs
  const doc = parseXml(transposeXmlString(xml, inv));                    // pitches and key signature move together
  Array.from(doc.getElementsByTagName("clef")).forEach(c => { c.innerHTML = "<sign>G</sign><line>2</line>"; });
  return new XMLSerializer().serializeToString(addAccidentals(doc));
}

/* ---------------- 3.8 parts: "+" adds a part for an instrument, written automatically ----------------
   role: "melody" (the same tune), "voice2" (harmony under it: thirds, sixths or fifths, chosen to move smoothly),
   "chords" (one chord per bar), "bass" (the chord root per bar). The new part is written for its instrument:
   its transposition (trumpet in B♭ reads a tone higher), its clef, and an octave that suits its range. */
const TR_IV = { 0: { d: 0, s: 0 }, 2: { d: 1, s: 2 }, 7: { d: 4, s: 7 }, 9: { d: 5, s: 9 }, 14: { d: 8, s: 14 } };
const PART_CLEF = { bass: "<sign>F</sign><line>4</line>", treble: "<sign>G</sign><line>2</line>" };
function partPitches(part) { return [...part.getElementsByTagName("pitch")].map(midiOf); }
function median(a) { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 60; }
/* a one-part score with just this part (so transposition and chords work on it alone) */
function soloScore(doc, part) {
  const d = doc.cloneNode(true), root = d.documentElement;
  kids(root, "part").forEach(p => { if (p.getAttribute("id") !== part.getAttribute("id")) p.remove(); });
  const pl = kid(root, "part-list"); if (pl) kids(pl, "score-part").forEach(sp => { if (sp.getAttribute("id") !== part.getAttribute("id")) sp.remove(); });
  return new XMLSerializer().serializeToString(d);
}
function makePart(xml, srcId, { role = "melody", instr, interval = 0, keepClef = false } = {}) {
  const doc = parseXml(xml), root = doc.documentElement, parts = kids(root, "part");
  const src = parts.find(p => p.getAttribute("id") === srcId) || parts[0]; if (!src) return xml;
  let one = soloScore(doc, src);
  let srcFifths = 0; { const k = src.getElementsByTagName("key")[0]; if (k) srcFifths = parseInt(txt(k, "fifths"), 10) || 0; }
  if (role === "voice2") {
    const v = parseXml(secondVoiceXml(one, srcId, { interval: interval || 3, level: interval ? 1 : 3 }));
    const ps = kids(v.documentElement, "part"); one = soloScore(v, ps[ps.length - 1]);
  } else if (role === "chords" || role === "bass") {
    one = chordPartXml(one, srcId, role);
  }
  /* sounding range of the instrument: move by octaves so the part sits in its middle */
  const od = parseXml(one), op = kids(od.documentElement, "part")[0];
  const mid = (instr.lo + instr.hi) / 2, med = median(partPitches(op)), oct = Math.round((mid - med) / 12);
  let iv = { d: 7 * oct, s: 12 * oct };
  const t = TR_IV[instr.tr] || TR_IV[0]; iv = fixEnharmonic({ d: iv.d + t.d, s: iv.s + t.s }, srcFifths);
  const wd = parseXml(transposeXmlString(one, iv)), wp = kids(wd.documentElement, "part")[0];
  const srcClef = src.getElementsByTagName("clef")[0];
  [...wp.getElementsByTagName("clef")].forEach((c, i) => { if (i === 0) c.innerHTML = keepClef && srcClef ? srcClef.innerHTML : (PART_CLEF[instr.clef] || PART_CLEF.treble); else c.remove(); });
  [...wp.getElementsByTagName("direction")].forEach(d => { if (!d.getElementsByTagName("sound").length) d.remove(); });
  [...wp.getElementsByTagName("lyric")].forEach(l => l.remove());
  /* the new part joins the score with a free id */
  const ids = new Set(parts.map(p => p.getAttribute("id"))); let n = 2; while (ids.has("P" + n)) n++;
  const id = "P" + n, np = doc.importNode(wp, true); np.setAttribute("id", id);
  root.appendChild(np);
  const pl = kid(root, "part-list"), sp = doc.createElement("score-part"); sp.setAttribute("id", id);
  sp.innerHTML = `<part-name>${xesc(instr.name)}</part-name>`; pl.appendChild(sp);
  return new XMLSerializer().serializeToString(addAccidentals(doc));
}
/* chords or bass: one per bar, as long as the bar, in the key's main triads (chordsForBars) */
function chordPartXml(one, srcId, role) {
  const doc = parseXml(one), part = kids(doc.documentElement, "part")[0], chords = chordsForBars(one, srcId); chordPartXml.last = 48;
  let div = 1, beats = 4, bt = 4, prev = null;
  kids(part, "measure").forEach((m, i) => {
    kids(m, "attributes").forEach(a => { const d = kid(a, "divisions"); if (d) div = parseFloat(d.textContent) || div; const t = kid(a, "time"); if (t) { beats = parseInt(txt(t, "beats"), 10) || beats; bt = parseInt(txt(t, "beat-type"), 10) || bt; } });
    [...m.children].filter(c => !["attributes", "print"].includes(c.tagName)).forEach(c => c.remove());
    const cap = div * 4 * beats / bt, ty = { 16: "whole", 8: "half", 4: "quarter" }[cap / div * 4] || "", dot = [12, 6, 3].includes(cap / div * 4) ? "<dot/>" : "", tyd = ty || { 12: "half", 6: "quarter", 3: "eighth" }[cap / div * 4] || "whole";
    const c = chords[i] || prev; prev = c;
    if (!c) { m.insertAdjacentHTML("beforeend", `<note><rest measure="yes"/><duration>${cap}</duration><voice>1</voice></note>`); return; }
    const rootLof = c.tonicLof + c.lof, pc = l => { const p = lofToPitch(l); return { p, semi: ([0, 2, 4, 5, 7, 9, 11][STEP_I[p.letter]] + p.alter + 12) % 12 }; };
    const tones = role === "bass" ? [rootLof] : [rootLof, rootLof + (c.minor ? -3 : 4), rootLof + 1];
    let base = 48;   // C3: chords from here up (moved into the instrument's range afterwards)
    tones.forEach((l, k) => {
      const { p, semi } = pc(l); let midi = base + semi; if (k && midi <= base) midi += 12;
      /* the bass (and the chord's root) goes to the nearer octave, so it moves by step or a fourth, not a leap */
      if (k === 0) { const last = chordPartXml.last ?? 48; midi = [36, 48, 60].map(o => o + semi).reduce((a, b) => Math.abs(b - last) < Math.abs(a - last) ? b : a); chordPartXml.last = midi; base = midi; }
      const oct = Math.floor((midi - p.alter) / 12) - 1;
      m.insertAdjacentHTML("beforeend", `<note>${k ? "<chord/>" : ""}<pitch><step>${p.letter}</step>${p.alter ? `<alter>${p.alter}</alter>` : ""}<octave>${oct}</octave></pitch><duration>${cap}</duration><voice>1</voice><type>${tyd}</type>${dot}</note>`);
    });
  });
  return new XMLSerializer().serializeToString(doc);
}
/* the second voice on the same staff as the melody: voice 2, stems down (the melody's stems go up) */
function mergeAsVoice2(xml, srcId, newId) {
  const doc = parseXml(xml), root = doc.documentElement, parts = kids(root, "part");
  const a = parts.find(p => p.getAttribute("id") === srcId), b = parts.find(p => p.getAttribute("id") === newId); if (!a || !b) return xml;
  const am = kids(a, "measure"), bm = kids(b, "measure");
  am.forEach((m, i) => {
    const notes = kids(m, "note"); if (!bm[i]) return;
    notes.forEach(n => { if (kid(n, "chord") || kid(n, "grace")) return; kids(n, "stem").forEach(s => s.remove()); const st = doc.createElement("stem"); st.textContent = "up"; (kid(n, "type") || kid(n, "duration")).after(st); });
    const total = notes.reduce((s, n) => s + ((kid(n, "chord") || kid(n, "grace")) ? 0 : (parseFloat(txt(n, "duration")) || 0)), 0);
    const bk = doc.createElement("backup"); bk.innerHTML = `<duration>${total}</duration>`; m.appendChild(bk);
    kids(bm[i], "note").forEach(n => {
      const c = doc.importNode(n, true); kids(c, "voice").forEach(v => (v.textContent = "2")); kids(c, "stem").forEach(s => s.remove());
      if (!kid(c, "rest")) { const st = doc.createElement("stem"); st.textContent = "down"; (kid(c, "type") || kid(c, "duration")).after(st); }
      m.appendChild(c);
    });
  });
  b.remove(); const pl = kid(root, "part-list"); kids(pl, "score-part").forEach(sp => { if (sp.getAttribute("id") === newId) sp.remove(); });
  return new XMLSerializer().serializeToString(doc);
}
