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
