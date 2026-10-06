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
/* minor (§9): natural minor for t and s, harmonic minor for D (the raised leading tone: E major in A minor); the side
   chords are the major triads III (tP), VI (sP) and VII (dP). Same order as DEGREES, so the functions line up. */
const DEGREES_MINOR = [
  { d: 0, lof: 0, minor: true, fn: "T" }, { d: 3, lof: -1, minor: true, fn: "S" }, { d: 4, lof: 1, minor: false, fn: "D" },
  { d: 2, lof: -3, minor: false, fn: "Tp" }, { d: 5, lof: -4, minor: false, fn: "Sp" }, { d: 6, lof: -2, minor: false, fn: "Dp" }
];
const degreesOf = mode => mode === "minor" ? DEGREES_MINOR : DEGREES;
/* The chord of each bar, chosen for the whole tune at once (iastate "Harmonizing a melody", Open Music Theory
   harmonic syntax, folk-song practice):
   - melody notes weigh by length and place: beat 1 ×1, the bar's middle beat (3 of 4/4, 4 of 6/8) ×0.6, other beats
     ×0.3, off the beat ×0.15, a note reached by a leap ×1.5; prominent notes should be chord tones
   - few chords: T and D(7) first, then S, rarely the side chords (vi, ii, iii)
   - functions move T → S → D → T; a step back D → S is avoided
   - the last bar is the tonic, the bar before it prefers the dominant (a cadence)
   - a pickup bar is counted from where it really starts (the end of a full bar) */
const VOCAB = { T: 1, D: 1, S: 0.85, Tp: 0.45, Sp: 0.45, Dp: 0.12 };
const FUNC = { T: "T", Tp: "T", Dp: "T", S: "S", Sp: "S", D: "D" };
function chordsForBars(xml, partId) {
  const doc = parseXml(xml), part = kids(doc.documentElement, "part").find(p => p.getAttribute("id") === partId) || kids(doc.documentElement, "part")[0];
  if (!part) return [];
  let fifths = 0, mode = "major", prevMidi = null, guess = null;
  const bars = [];
  barInfo(part).forEach(({ m, div, beats, bt, full, len, pickup }) => {
    kids(m, "attributes").forEach(a => {
      const k = kid(a, "key"); if (k) { fifths = parseInt(txt(k, "fifths"), 10) || 0; const md = txt(k, "mode"); mode = md === "minor" ? "minor" : md ? "major" : (guess = guess || detectMode(part, fifths)); }
    });
    const tonicLof = fifths + (mode === "minor" ? 3 : 0), beat = bt === 8 && beats % 3 === 0 ? 1.5 : 4 / bt;
    const nb = Math.round(beats * 4 / bt / beat), mid = nb % 2 === 0 && nb > 2 ? nb / 2 : nb === 2 && beat === 1.5 ? 1 : -1;
    const w = new Array(12).fill(0); let pos = pickup ? (full - len) / div : 0, any = false;
    const v1 = (kids(m, "note")[0] && txt(kids(m, "note")[0], "voice")) || "1";
    kids(m, "note").forEach(n => {
      if (kid(n, "chord") || kid(n, "grace") || (txt(n, "voice") || "1") !== v1) return;
      const d = (parseFloat(txt(n, "duration")) || 0) / div, p = kid(n, "pitch");
      if (p) {
        const midi = midiOf(p), onBeat = Math.abs(pos / beat - Math.round(pos / beat)) < 1e-6, bi = Math.round(pos / beat);
        let mw = !onBeat ? 0.15 : bi === 0 ? 1 : bi === mid ? 0.6 : 0.3;
        if (prevMidi !== null && Math.abs(midi - prevMidi) > 2) mw *= 1.5;
        w[((midi % 12) + 12) % 12] += Math.max(0.25, d) * mw; prevMidi = midi; any = true;
      }
      pos += d;
    });
    bars.push({ w, any, tonicLof, mode });
  });
  const pcOfLof = l => ((l * 7) % 12 + 12) % 12;
  /* how well each chord fits each bar */
  const fit = bars.map(b => degreesOf(b.mode).map(g => {
    if (!b.any) return 0;
    const root = pcOfLof(b.tonicLof + g.lof), tri = [root, (root + (g.minor ? 3 : 4)) % 12, (root + 7) % 12];
    const tot = b.w.reduce((a, x) => a + x, 0) || 1;
    let inC = tri.reduce((a, pc) => a + b.w[pc], 0); const sev = g.fn === "D" ? b.w[(root + 10) % 12] : 0; inC += sev;
    return (inC / tot * 4 - (tot - inC) / tot * 3) * VOCAB[g.fn];
  }));
  const n = bars.length, K = DEGREES.length;
  const trans = (a, b) => { const fa = FUNC[DEGREES[a].fn], fb = FUNC[DEGREES[b].fn]; if (a === b) return 0.3; if (fa === "D" && fb === "S") return -4; if ((fa === "T" && fb === "S") || (fa === "S" && fb === "D") || (fa === "D" && fb === "T") || (fa === "T" && fb === "D")) return 1; return 0; };
  const lastPitched = (() => { for (let i = n - 1; i >= 0; i--) if (bars[i].any) return i; return -1; })();
  const bonus = (i, k) => i === lastPitched ? (DEGREES[k].fn === "T" ? 6 : -6) : i === lastPitched - 1 && DEGREES[k].fn === "D" ? 1.5 : 0;
  const D = Array.from({ length: n }, () => new Array(K).fill(-Infinity)), F = Array.from({ length: n }, () => new Array(K).fill(-1));
  for (let k = 0; k < K; k++) D[0][k] = fit[0][k] + bonus(0, k) + (DEGREES[k].fn === "T" ? 1 : 0);
  for (let i = 1; i < n; i++) for (let k = 0; k < K; k++) for (let j = 0; j < K; j++) {
    const v = D[i - 1][j] + (bars[i].any ? fit[i][k] + trans(j, k) : (j === k ? 0 : -9)) + bonus(i, k);
    if (v > D[i][k]) { D[i][k] = v; F[i][k] = j; }
  }
  let k = D[n - 1].reduce((b, x, kk) => x > D[n - 1][b] ? kk : b, 0); const pick = new Array(n);
  for (let i = n - 1; i >= 0; i--) { pick[i] = k; k = F[i][k]; }
  return bars.map((b, i) => {
    const g = degreesOf(b.mode)[pick[i]], root = pcOfLof(b.tonicLof + g.lof);
    return { bar: i + 1, ...g, seventh: g.fn === "D" && b.w[(root + 10) % 12] > 0, tonicLof: b.tonicLof, mode: b.mode };
  });
}
/* Polish function names: major T S D Tp Sp Dp; minor t s D tP sP dP (the dominant is major: harmonic minor) */
const FN_MINOR = { T: "t", S: "s", D: "D", Tp: "tP", Sp: "sP", Dp: "dP" };
function chordLabel(c, shiftFifths, kind) {
  if (!c) return "";
  if (kind === "fn") return (c.mode === "minor" ? FN_MINOR[c.fn] || c.fn : c.fn) + (c.seventh ? "7" : "");
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
const TR_IV = { 0: { d: 0, s: 0 }, 2: { d: 1, s: 2 }, 3: { d: 2, s: 3 }, 5: { d: 3, s: 5 }, 7: { d: 4, s: 7 }, 9: { d: 5, s: 9 }, 12: { d: 7, s: 12 }, 14: { d: 8, s: 14 }, 21: { d: 12, s: 21 }, "-3": { d: -2, s: -3 }, "-12": { d: -7, s: -12 }, "-24": { d: -14, s: -24 } };
const PART_CLEF = { bass: "<sign>F</sign><line>4</line>", treble: "<sign>G</sign><line>2</line>", alto: "<sign>C</sign><line>3</line>", tenor: "<sign>C</sign><line>4</line>" };
/* the octave a new part is written in (sounding pitches ps, their diatonic positions idx): inside the instrument's
   range, then in the range a pupil plays comfortably (TRN / Bandworld grade tables), then the fewest ledger lines in
   the best of the instrument's clefs (Gould: 2–3 are fine, more means another octave or clef) */
function octaveFor(ps, instr, idx, maxOct = 4, info = {}) {
  const [cl, ch] = comfOf(instr), t = TR_IV[instr.tr] || TR_IV[0], n = Math.max(1, ps.length); let best = Infinity, oct = Math.min(0, maxOct);
  info.outR = 1;
  for (let o = -4; o <= maxOct; o++) {
    const outR = ps.filter(x => x + 12 * o < instr.lo || x + 12 * o > instr.hi).length / n, outC = ps.filter(x => x + 12 * o < cl || x + 12 * o > ch).length / n;
    const led = idx ? Math.min(...clefsOf(instr).map(c => ledgerCost(idx.map(i => i + 7 * o + t.d), c))) : 0;
    const cost = outR * 40 + outC * 4 + led + Math.abs(o) * 0.15;
    if (cost < best) { best = cost; oct = o; info.outR = outR; }
  }
  return oct;
}
const partIdx = part => [...part.getElementsByTagName("pitch")].map(p => parseInt(txt(p, "octave"), 10) * 7 + STEP_I[txt(p, "step")]);
function partPitches(part) { return [...part.getElementsByTagName("pitch")].map(midiOf); }
function median(a) { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 60; }
/* a one-part score with just this part (so transposition and chords work on it alone) */
function soloScore(doc, part) {
  const d = doc.cloneNode(true), root = d.documentElement;
  kids(root, "part").forEach(p => { if (p.getAttribute("id") !== part.getAttribute("id")) p.remove(); });
  const pl = kid(root, "part-list"); if (pl) kids(pl, "score-part").forEach(sp => { if (sp.getAttribute("id") !== part.getAttribute("id")) sp.remove(); });
  return new XMLSerializer().serializeToString(d);
}
function makePart(xml, srcId, { role = "melody", instr, interval = 0, keepClef = false, v2Midi = null, srcTr = 0 } = {}) {
  const doc = parseXml(xml), root = doc.documentElement, parts = kids(root, "part");
  const src = parts.find(p => p.getAttribute("id") === srcId) || parts[0]; if (!src) return xml;
  let one = soloScore(doc, src);
  let srcFifths = 0; { const k = src.getElementsByTagName("key")[0]; if (k) srcFifths = parseInt(txt(k, "fifths"), 10) || 0; }
  let voiceMax = 4, placedVoice = false;
  if (role === "voice2" || role === "voice3") {
    /* interval 0: chosen to move smoothly; 9: chord tones; 3/6/5: parallel. The third voice sits lower:
       the second chord tone below, or the interval taken twice (a third → a fifth below) */
    const third = role === "voice3";
    /* 0 = "Sam dobierze": the rule-based line; 9: chord tones; 3/6/5: parallel, as the player asked */
    /* the clef the voice will be read in: of the instrument's clefs, the one whose staff sits on its comfortable
       range; written positions = source positions − the source's transposition + the instrument's */
    const tW = TR_IV[instr.tr] || TR_IV[0], tS = TR_IV[srcTr] || TR_IV[0], cm = comfOf(instr), mid = (cm[0] + cm[1]) / 2 + (instr.tr || 0);
    const midIdx = Math.round((mid - 12) * 7 / 12), cf = clefsOf(instr).reduce((a, b) => Math.abs(CLEF_LINES[b] + 4 - midIdx) < Math.abs(CLEF_LINES[a] + 4 - midIdx) ? b : a);
    const place = { range: [instr.lo + srcTr, instr.hi + srcTr], comf: cm.map(x => x + srcTr), staff: CLEF_LINES[cf], wShift: tW.d - tS.d };
    const gen = (above, placed) => { const vx = interval === 0 ? ruledVoiceXml(one, srcId, { third, lowMidi: comfOf(instr)[0] + srcTr - (above ? 12 : 0), v2Midi, above, place: placed ? place : null })
      : interval === 9 ? chordVoiceXml(one, srcId, third ? 2 : 1)
      : secondVoiceXml(one, srcId, { interval: third ? ({ 3: 5, 6: 8, 5: 8 }[interval] || 6) : interval, level: 1 });
      const v = parseXml(vx), ps = kids(v.documentElement, "part"); return soloScore(v, ps[ps.length - 1]); };
    /* a higher instrument than the melody's (trumpet with a trombone tune) plays the voice an octave up, above the
       melody: written so that it still sounds right there (3rds and 6ths, no 5th that would turn into a 4th) */
    /* octaves may move the voice only as far as it stays under the voices it was written against (otherwise a 5th
       turns into a 4th); if the instrument cannot play it there, the voice is written for above the melody */
    const melL = partPitches(kids(parseXml(one).documentElement, "part")[0]);
    let vone = gen(false, third && interval === 0);
    if (third && interval === 0) { voiceMax = 0; placedVoice = true; }
    const vpart = kids(parseXml(vone).documentElement, "part")[0], vp = partPitches(vpart);
    const tops = melL.map((m, i) => third && v2Midi && v2Midi.length === melL.length ? Math.min(m, v2Midi[i]) : m);
    if (vp.length === tops.length && !placedVoice) {
      voiceMax = Math.floor(Math.min(...vp.map((x, i) => (tops[i] - x) / 12)));
      const info = {}; octaveFor(vp.map(x => x - srcTr), instr, partIdx(vpart).map(i => i - (TR_IV[srcTr] || TR_IV[0]).d), voiceMax, info);
      if (info.outR > 0) { if (interval === 0) { vone = gen(false, true); voiceMax = 0; placedVoice = true; } else { vone = gen(true); voiceMax = 4; } }
    }
    one = vone;
  } else if (role === "chords" && (instr.group === "Klawiszowe" || instr.id === "harfa")) {
    one = pianoPartXml(one, srcId);
  } else if (role === "chords" || role === "bass") {
    one = chordPartXml(one, srcId, role, !POLY.has(instr.id));
  }
  /* a source written for a transposing instrument (trumpet in B♭: a 2nd above) is taken back to concert pitch
     first, so the new part sounds with it, not a 2nd off */
  if (srcTr) { const t0 = TR_IV[srcTr] || { d: 0, s: srcTr }; one = transposeXmlString(one, fixEnharmonic({ d: -t0.d, s: -t0.s }, srcFifths)); const k = parseXml(one).getElementsByTagName("key")[0]; srcFifths = k ? parseInt(txt(k, "fifths"), 10) || 0 : 0; }
  const twoStaves = /<staves>2<\/staves>/.test(one);
  /* sounding range of the instrument: move by octaves so the part sits in its middle */
  const od = parseXml(one), op = kids(od.documentElement, "part")[0];
  /* octaves move only when the part would leave the instrument's range (a lower voice stays below its melody) */
  const ps = partPitches(op), lo = Math.min(...ps), hi = Math.max(...ps);
  /* the octave: keep it if the part fits the instrument; otherwise the shift with the most notes in the range a
     pupil plays comfortably (TRN / Bandworld grade tables), never outside the full range if it can be helped */
  const oct = twoStaves || placedVoice ? 0 : octaveFor(ps, instr, partIdx(op), voiceMax);
  let iv = { d: 7 * oct, s: 12 * oct };
  const t = TR_IV[instr.tr] || TR_IV[0]; iv = fixEnharmonic({ d: iv.d + t.d, s: iv.s + t.s }, srcFifths);
  const wd = parseXml(transposeXmlString(one, iv)), wp = kids(wd.documentElement, "part")[0];
  const srcClef = src.getElementsByTagName("clef")[0];
  /* the clef: the instrument's own, or (trombone, cello, bassoon: tenor clef; viola: treble) another one if it
     saves many ledger lines (Gould: change clef rather than read 4+ ledger lines) */
  const CLEF_OF = { bass: "bass", treble: "treble", alto: "alto", tenor: "tenor" }, ALT = { puzon: ["tenor"], "puzon-alt": ["tenor", "treble"], wiolonczela: ["tenor"], fagot: ["tenor"], altowka: ["treble"], eufonium: ["tenor"] };
  let clefName = keepClef && srcClef && clefsOf(instr).includes(clefNameOf(srcClef)) ? null : instr.clef;
  if (clefName && !twoStaves) {
    const idx = [...wp.getElementsByTagName("pitch")].map(x => parseInt(txt(x, "octave"), 10) * 7 + STEP_I[txt(x, "step")]);
    /* every clef the instrument is written in (harp, piano, organ, marimba: treble and bass); the instrument's
       usual clef unless another one clearly saves ledger lines */
    let best = ledgerCost(idx, CLEF_OF[clefName]) - 0.5;
    clefsOf(instr).filter(c => c !== instr.clef).forEach(c => { const v = ledgerCost(idx, c); if (v < best) { best = v; clefName = c; } });
  }
  if (!twoStaves) [...wp.getElementsByTagName("clef")].forEach((c, i) => { if (i === 0) c.innerHTML = clefName ? (PART_CLEF[clefName] || PART_CLEF.treble) : srcClef.innerHTML; else c.remove(); });
  /* tempo words and dynamics stay with the top part only (a score prints them once); the tempo itself is kept */
  [...wp.getElementsByTagName("direction")].forEach(d => { if (!d.getElementsByTagName("sound").length) d.remove(); else [...d.getElementsByTagName("direction-type")].forEach(t => { t.innerHTML = "<words></words>"; }); });
  [...wp.getElementsByTagName("lyric")].forEach(l => l.remove());
  /* the new part joins the score with a free id */
  const ids = new Set(parts.map(p => p.getAttribute("id"))); let n = 2; while (ids.has("P" + n)) n++;
  const id = "P" + n, np = doc.importNode(wp, true); np.setAttribute("id", id);
  root.appendChild(np);
  const pl = kid(root, "part-list"), sp = doc.createElement("score-part"); sp.setAttribute("id", id);
  sp.innerHTML = `<part-name>${xesc(instr.name)}</part-name>`; pl.appendChild(sp); setDeclared(doc, sp, instr);
  return new XMLSerializer().serializeToString(addAccidentals(doc));
}
/* chords or bass: one per bar, as long as the bar, in the key's main triads (chordsForBars) */
/* instruments that play chords (stacked notes); every other one plays a chord one note at a time */
const POLY = new Set(["fortepian", "organy", "akordeon", "keyboard", "harfa", "gitara", "ukulele", "mandolina", "marimba", "wibrafon"]);
/* an accompaniment bar keeps its barlines (repeats, voltas, the final double bar), the tempo and the attributes;
   new notes go before the closing barline */
function clearBar(m) {
  [...m.children].filter(c => !["attributes", "print", "barline"].includes(c.tagName) && !(c.tagName === "direction" && c.getElementsByTagName("sound").length)).forEach(c => c.remove());
  const end = kids(m, "barline").find(b => (b.getAttribute("location") || "right") === "right") || null;
  return h => { const t = m.ownerDocument.createElement("x"); t.innerHTML = h; [...t.childNodes].forEach(nd => m.insertBefore(nd, end)); };
}
/* q quarters as notes (tied when one value cannot hold it: 5/4 = dotted half + half) or rests; pitches: <pitch> xml list */
function valuesXml(q, div, pitches, voice = 1, staff = "") {
  const vs = noteValues(q), st = staff ? `<staff>${staff}</staff>` : "";
  return vs.map(([len, type, dot], i) => {
    const tie = pitches && vs.length > 1 ? (i ? `<tie type="stop"/>` : "") + (i < vs.length - 1 ? `<tie type="start"/>` : "") : "";
    const tied = tie ? `<notations>${tie.replace(/<tie /g, "<tied ")}</notations>` : "";
    const body = `<duration>${len * div}</duration>${tie}<voice>${voice}</voice><type>${type}</type>${dot ? "<dot/>" : ""}${st}`;
    return pitches ? pitches.map((p, j) => `<note>${j ? "<chord/>" : ""}${p}${body}${tied}</note>`).join("") : `<note><rest/>${body}</note>`;
  }).join("");
}
function chordPartXml(one, srcId, role, mono = false) {
  const doc = parseXml(one), part = kids(doc.documentElement, "part")[0], chords = chordsForBars(one, srcId);
  let prev = null, last = 48;     // the previous bass note: the next root goes to the nearer octave
  const P = (p, midi) => `<pitch><step>${p.letter}</step>${p.alter ? `<alter>${p.alter}</alter>` : ""}<octave>${Math.floor((midi - p.alter) / 12) - 1}</octave></pitch>`;
  barInfo(part).forEach(({ m, div, beats, bt, full, len, pickup }, i) => {
    const add = clearBar(m), q = len / div;
    const c = chords[i] || prev; prev = c;
    /* the pickup (§12): the accompaniment waits for the first full bar */
    if (pickup) { add(valuesXml(q, div, null)); return; }
    if (!c) { add(`<note><rest measure="yes"/><duration>${len}</duration><voice>1</voice></note>`); return; }
    const rootLof = c.tonicLof + c.lof, pc = l => { const p = lofToPitch(l); return { p, semi: ([0, 2, 4, 5, 7, 9, 11][STEP_I[p.letter]] + p.alter + 12) % 12 }; };
    if (mono && role === "chords") {
      /* a wind or string player breaks the chord: one note per beat, root – 3rd – 5th (– 3rd), close above the
         root, the root moving to the nearer octave (band accompaniment) */
      const comp = bt === 8 && beats % 3 === 0, bq = comp ? 1.5 : 4 / bt, nb = Math.max(1, Math.round(q / bq));
      const tl = [rootLof, rootLof + (c.minor ? -3 : 4), rootLof + 1], r0 = pc(tl[0]).semi;
      const root = [36, 48, 60].map(o => o + r0).reduce((a, b) => Math.abs(b - last) < Math.abs(a - last) ? b : a); last = root;
      const mid = tl.map((l, k) => { const { p, semi } = pc(l); let midi = root - r0 + semi; if (k && midi <= root) midi += 12; return { p, midi }; });
      const seq = nb === 2 ? [0, 2] : nb === 3 ? [0, 1, 2] : [0, 1, 2, 1, 0, 1, 2, 1].slice(0, nb);
      let left = q; seq.forEach((k, j) => { const d = j === seq.length - 1 ? left : Math.min(bq, left); left -= d; if (d > 1e-6) add(valuesXml(d, div, [P(mid[k].p, mid[k].midi)])); });
      return;
    }
    const tones = role === "bass" ? [rootLof] : [rootLof, rootLof + (c.minor ? -3 : 4), rootLof + 1];
    let base = 48;   // C3: chords from here up (moved into the instrument's range afterwards)
    const ps = tones.map((l, k) => {
      const { p, semi } = pc(l); let midi = base + semi; if (k && midi <= base) midi += 12;
      /* the bass (and the chord's root) goes to the nearer octave, so it moves by step or a fourth, not a leap */
      if (k === 0) { midi = [36, 48, 60].map(o => o + semi).reduce((a, b) => Math.abs(b - last) < Math.abs(a - last) ? b : a); last = midi; base = midi; }
      return P(p, midi);
    });
    add(valuesXml(q, div, ps));
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

/* a voice from the chord under the melody: for each note the nearest chord tone below it (nth = 1: the next one
   down, the second voice; nth = 2: the one below that, the third voice). Chords come from chordsForBars. */
function chordVoiceXml(xml, partId, nth = 1) {
  const doc = parseXml(xml), root = doc.documentElement, src = kids(root, "part").find(p => p.getAttribute("id") === partId); if (!src) return xml;
  const chords = chordsForBars(xml, partId), ids = new Set(kids(root, "part").map(p => p.getAttribute("id")));
  let n = 2; while (ids.has("P" + n)) n++; const id = "P" + n, part = src.cloneNode(true); part.setAttribute("id", id);
  let fifths = 0;
  kids(part, "measure").forEach((m, i) => {
    kids(m, "attributes").forEach(a => { const k = kid(a, "key"); if (k) fifths = parseInt(txt(k, "fifths"), 10) || 0; });
    kids(m, "direction").forEach(d => d.remove());
    const c = chords[i]; if (!c) return;
    const r = c.tonicLof + c.lof, pcs = [r, r + (c.minor ? -3 : 4), r + 1].map(l => { const p = lofToPitch(l); return ((([0, 2, 4, 5, 7, 9, 11][STEP_I[p.letter]] + p.alter) % 12) + 12) % 12; });
    kids(m, "note").forEach(note => {
      kids(note, "accidental").forEach(a => a.remove()); kids(note, "lyric").forEach(a => a.remove());
      const p = kid(note, "pitch"); if (!p) return;
      let midi = midiOf(p), found = 0;
      for (let t = midi - 1; t > midi - 13; t--) if (pcs.includes(((t % 12) + 12) % 12) && ++found === nth) { midi = t; break; }
      if (!found) midi -= nth === 1 ? 3 : 7;
      /* write it with the key's spelling: the nearest letter whose pitch matches */
      const idx0 = parseInt(txt(p, "octave"), 10) * 7 + STEP_I[txt(p, "step")];
      let best = null; for (let d = 0; d <= 8; d++) { const idx = idx0 - d, st = STEP_N[((idx % 7) + 7) % 7], oc = Math.floor(idx / 7), base = 12 * (oc + 1) + [0, 2, 4, 5, 7, 9, 11][STEP_I[st]], al = midi - base; if (Math.abs(al) <= 1 && (!best || Math.abs(al - keyAlter(fifths, st)) < Math.abs(best.al - keyAlter(fifths, best.st)))) best = { st, oc, al }; }
      if (!best) return;
      kid(p, "step").textContent = best.st; kid(p, "octave").textContent = String(best.oc);
      let a = kid(p, "alter"); if (best.al) { if (!a) { a = doc.createElement("alter"); p.insertBefore(a, kid(p, "octave")); } a.textContent = String(best.al); } else if (a) a.remove();
    });
  });
  root.appendChild(part);
  const pl = kid(root, "part-list"), sp = doc.createElement("score-part"); sp.setAttribute("id", id); sp.innerHTML = `<part-name>Głos</part-name>`; pl.appendChild(sp);
  return new XMLSerializer().serializeToString(doc);
}

/* ---------------- 3.9 voice leading: a whole line chosen at once (dynamic programming) ----------------
   Rules (Open Music Theory, first/second species; Fux; Kostka-Payne via OMT), scored per note:
   - strong beats consonant: 3rds and 6ths best, 5ths and octaves allowed, unison only on the first or last note,
     2nds, 4ths, 7ths and the tritone never on a strong beat (on weak beats only as a passing step)
   - no parallel 5ths or octaves, no hidden 5th/octave when the melody leaps, contrary/oblique motion rewarded
   - the voice never crosses above the melody (or above the voice it sits under) and never overlaps it
   - steps and repeated notes are easy, leaps cost more, nothing wider than an octave
   - the same interval more than 3 times in a row costs a little (no endless parallel 3rds)
   - chord tones on strong beats; the last note on the tonic (or its 3rd); the leading tone goes to the tonic */
const SCALE_ST = [0, 2, 4, 5, 7, 9, 11];
const idxMidi = (idx, fifths) => { const st = STEP_N[((idx % 7) + 7) % 7]; return 12 * (Math.floor(idx / 7) + 1) + SCALE_ST[STEP_I[st]] + keyAlter(fifths, st); };
function strongOnsets(beats, bt) {
  /* compound metres: a beat is a dotted quarter; 6/8 → 1 and 4, 12/8 → 1 and 7, 9/8 → 1 only */
  if (bt === 8 && beats % 3 === 0 && beats > 3) return beats % 6 === 0 ? [0, 1.5 * beats / 6] : [0];
  if (beats === 4 && bt === 4) return [0, 2];
  if (bt === 2 && beats === 2) return [0, 2];
  return [0];
}
/* the melody as events: pitch, bar, strong or weak, the bar's chord tones */
function melodyEvents(part, chords) {
  let div = 1, beats = 4, bt = 4, fifths = 0, t0 = 0; const ev = [], bi0 = barInfo(part);
  kids(part, "measure").forEach((m, bi) => {
    kids(m, "attributes").forEach(a => {
      const d = kid(a, "divisions"); if (d) div = parseFloat(d.textContent) || div;
      const t = kid(a, "time"); if (t) { beats = parseInt(txt(t, "beats"), 10) || beats; bt = parseInt(txt(t, "beat-type"), 10) || bt; }
      const k = kid(a, "key"); if (k) fifths = parseInt(txt(k, "fifths"), 10) || 0;
    });
    /* a pickup bar counts from where it really starts (its first note is not beat 1); t: time from the start */
    const strong = strongOnsets(beats, bt), unit = bt === 8 && beats % 3 === 0 ? 1.5 : 4 / bt, B = bi0[bi], off = B.pickup ? (B.full - B.len) / B.div : 0; let pos = off;
    const c = chords[bi]; let pcs = null;
    let spell = null;
    if (c) { const r = c.tonicLof + c.lof, ls = [r, r + (c.minor ? -3 : 4), r + 1, ...(c.seventh ? [r - 2] : [])].map(lofToPitch);
      pcs = ls.map(p => ((SCALE_ST[STEP_I[p.letter]] + p.alter) % 12 + 12) % 12); spell = Object.fromEntries(ls.map(p => [p.letter, p.alter])); }
    [...m.children].forEach(el => {
      if (el.tagName === "backup") { pos -= (parseFloat(txt(el, "duration")) || 0) / div; return; }
      if (el.tagName === "forward") { pos += (parseFloat(txt(el, "duration")) || 0) / div; return; }
      if (el.tagName !== "note" || kid(el, "chord") || kid(el, "grace")) return;
      if ((txt(el, "voice") || "1") !== "1") return;
      const dur = (parseFloat(txt(el, "duration")) || 0) / div, p = kid(el, "pitch");
      if (p) ev.push({ el, bar: bi, on: pos, t: t0 + pos - off, dur, strong: strong.some(s => Math.abs(s - pos) < 1e-6), beat: Math.abs(pos / unit - Math.round(pos / unit)) < 1e-6, midi: midiOf(p), idx: parseInt(txt(p, "octave"), 10) * 7 + STEP_I[txt(p, "step")], pcs, spell, fifths, tonicPc: c ? ((SCALE_ST[STEP_I[lofToPitch(c.tonicLof).letter]] + lofToPitch(c.tonicLof).alter) % 12 + 12) % 12 : null });
      pos += dur;
    });
    t0 += B.len / B.div;
  });
  return ev;
}
const IS_PERFECT = iv => iv === 0 || iv === 7;
function lineCost(prev, cur, c0, c1, ctx) {
  /* prev/cur: the upper voices' events (melody and, for a 3rd voice, the 2nd), c0/c1: candidate midi */
  let cost = 0;
  const uppers = ctx.uppers;
  for (const U of uppers) {
    const u0 = U[prev], u1 = U[cur];
    if (c1 > u1) return Infinity;                                   // crossing
    if (c1 > u0 || u1 < c0) cost += 8;                              // overlap
    const i0 = (u0 - c0) % 12, i1 = (u1 - c1) % 12, m0 = u1 - u0, m1 = c1 - c0;
    if (!ctx.allowParallel && IS_PERFECT(i1) && IS_PERFECT(i0) && i0 === i1 && m0 !== 0 && Math.sign(m0) === Math.sign(m1)) return Infinity;   // parallel 5ths/8ves
    if (IS_PERFECT(i1) && m0 && Math.sign(m0) === Math.sign(m1) && Math.abs(m0) > 2) cost += 6;    // hidden 5th/8ve, melody leaps
    if (m0 && m1 && Math.sign(m0) !== Math.sign(m1)) cost -= 1.5;    // contrary
    else if (!m0 !== !m1) cost -= 0.5;                               // oblique
  }
  const leap = Math.abs(c1 - c0);
  cost += leap <= 2 ? 0 : leap <= 4 ? 1 : leap <= 7 ? 2 : leap === 12 ? 3 : leap <= 9 ? 4 : leap < 12 ? 6 : Infinity;
  return cost;
}
function noteCost(e, c, i, n, ctx) {
  let cost = 0;
  const near = Math.min(...ctx.uppers.map(U => U[i]));
  for (const U of ctx.uppers) {
    const u = U[i], gap = u - c, iv = gap % 12;
    if (gap < 0) return Infinity;
    if (u === near) { if (gap > 19) return Infinity; if (gap > 12) cost += 5; else if (gap > 9) cost += 1.5; }     // close to the voice above, within an octave
    if (ctx.above && U === ctx.uppers[0] && iv === 7) { if (e.strong) return Infinity; cost += 3; }   // played an octave up it would be a 4th
    const cons = [3, 4, 8, 9].includes(iv) ? -3 : iv === 7 ? -1 : iv === 0 ? (gap === 0 ? (i === 0 || i === n - 1 ? 0 : 5) : -0.5) : null;
    if (cons === null) { if (e.strong) return Infinity; cost += 4; }       // dissonance only on a weak beat
    else cost += cons;
  }
  const pc = ((c % 12) + 12) % 12, mpc = ((e.midi % 12) + 12) % 12;
  /* the voices sound the bar's chord (the one the piano and bass play): on a strong beat a chord tone whenever the
     melody has one; on other beats a non-chord tone costs, between beats it is a passing note */
  if (e.pcs) {
    if (e.pcs.includes(pc)) cost += e.strong ? -1.5 : -0.5;
    else if (e.strong && e.pcs.includes(mpc) && !ctx.loose) return Infinity;
    else cost += e.strong ? 4 : e.beat ? 3 : 0.5;
  }
  if (ctx.third && e.pcs && ctx.uppers.length > 1) {                 // a 3rd voice completes the triad
    const have = ctx.uppers.map(U => ((U[i] % 12) + 12) % 12);
    if (e.strong && e.pcs.includes(pc) && !have.includes(pc)) cost -= 2;
    if (pc === ((e.pcs[1] % 12) + 12) % 12 && have.includes(pc)) cost += 2;     // no doubled 3rd
  }
  if (ctx.third && i === n - 1 && ctx.uppers.some(U => U[i] === c)) cost += 5;   // a 3rd voice does not end on the same note as the others
  if (i === n - 1 && e.tonicPc !== null) cost += pc === e.tonicPc ? -4 : (e.pcs && e.pcs.includes(pc) ? 0 : 6);
  if (c < ctx.lo) cost += 3 * Math.ceil((ctx.lo - c) / 2);           // too low to play comfortably
  return cost;
}
function bestLine(ev, ctx) {
  const n = ev.length; if (!n) return [];
  /* candidates: the key's notes up to a 10th below; a chord tone outside the key (the raised leading tone of a minor
     key in its dominant) replaces the key's note on that step */
  const cands = ev.map(e => { const out = []; for (let k = 0; k <= 9; k++) { const idx = e.idx - k; let midi = idxMidi(idx, e.fifths), alt = 0; const pc = ((midi % 12) + 12) % 12;
    const st = STEP_N[((idx % 7) + 7) % 7];       // a chord tone outside the key, spelt as the chord spells it (G♯ in E major, never F♭ for E)
    if (e.pcs && !e.pcs.includes(pc) && e.spell && st in e.spell) { const d = e.spell[st] - keyAlter(e.fifths, st); if (Math.abs(d) === 1) { midi += d; alt = d; } }
    out.push({ idx, midi, alt }); } return out; });
  const D = cands.map(c => c.map(() => ({ cost: Infinity, from: -1 })));
  cands[0].forEach((c, j) => { D[0][j].cost = noteCost(ev[0], c.midi, 0, n, ctx); });
  for (let i = 1; i < n; i++) cands[i].forEach((c, j) => {
    const nc = noteCost(ev[i], c.midi, i, n, ctx); if (nc === Infinity) return;
    cands[i - 1].forEach((p, k) => {
      if (D[i - 1][k].cost === Infinity) return;
      const aug = Math.abs(p.idx - c.idx) === 1 && Math.abs(p.midi - c.midi) === 3 ? 8 : 0;   // augmented 2nd (F–G♯ in minor)
      const t = D[i - 1][k].cost + nc + aug + lineCost(i - 1, i, p.midi, c.midi, ctx);
      if (t < D[i][j].cost) D[i][j] = { cost: t, from: k };
    });
  });
  let j = D[n - 1].reduce((b, x, k) => x.cost < D[n - 1][b].cost ? k : b, 0);
  if (D[n - 1][j].cost === Infinity) return null;
  const out = new Array(n);
  for (let i = n - 1; i >= 0; i--) { out[i] = cands[i][j]; j = D[i][j].from; }
  return out;
}

/* ---- a voice placed in its own instrument's register, against every voice already there (above or below it) ----
   Used for a 3rd voice and for a 2nd voice whose instrument cannot play under the melody. The same rules as above,
   but measured against each voice wherever it lies: consonant on strong beats (a 4th only between upper voices, never
   against the lowest), no parallel 5ths or 8ves with any voice, no crossing (each voice stays on its side), chord tones
   on strong beats, close to its nearest neighbour, inside the instrument's range and preferably its comfortable one. */
function placedCost(e, c, i, n, ctx, idx) {
  if (c < ctx.range[0] || c > ctx.range[1]) return Infinity;
  let cost = c < ctx.comf[0] ? 2 + (ctx.comf[0] - c) * 0.5 : c > ctx.comf[1] ? 2 + (c - ctx.comf[1]) * 0.5 : 0;
  if (ctx.staff !== undefined && idx !== undefined) {           // ledger lines in the instrument's clef, as written for it
    const w = idx + ctx.wShift, lo = ctx.staff, led = w < lo - 1 ? Math.floor((lo - w) / 2) : w > lo + 9 ? Math.floor((w - lo - 8) / 2) : 0;
    cost += led * led * 0.8;
  }
  const us = ctx.others.map(U => U[i]), L = Math.min(c, ...us);
  let near = Infinity;
  for (let k = 0; k < us.length; k++) {
    const u = us[k], d = ctx.sides[k] * (c - u), gap = Math.abs(c - u), iv = gap % 12;
    if (d < 0) return Infinity;
    if (d === 0) cost += i === 0 || i === n - 1 ? 1 : 6;
    near = Math.min(near, gap);
    const diss = [1, 2, 6, 10, 11].includes(iv) || (iv === 5 && Math.min(c, u) === L);
    if (diss) { if (e.strong && !ctx.loose) return Infinity; cost += 4; }
    else cost += [3, 4, 8, 9].includes(iv) ? -3 : iv === 7 ? -1 : iv === 0 && gap ? -0.5 : 0;
  }
  if (near > 12) cost += (near - 12) * 0.15;
  const pc = ((c % 12) + 12) % 12, mpc = ((e.midi % 12) + 12) % 12;
  if (e.pcs) {
    if (e.pcs.includes(pc)) cost += e.strong ? -1.5 : -0.5;
    else if (e.strong && e.pcs.includes(mpc) && !ctx.loose) return Infinity;
    else cost += e.strong ? 4 : e.beat ? 3 : 0.5;
    if (ctx.third) { const have = us.map(u => ((u % 12) + 12) % 12);
      if (us.length > 1 && pc === ((us[1] % 12) + 12) % 12 && i && i < n - 1) cost += 1.5;    // not the 2nd voice's note again
      if (e.strong && e.pcs.includes(pc) && !have.includes(pc)) cost -= 2;
      if (pc === ((e.pcs[1] % 12) + 12) % 12 && have.includes(pc)) cost += 2; }
  }
  if (i === n - 1) { if (us.includes(c)) cost += 5; if (e.tonicPc !== null) cost += pc === e.tonicPc ? -4 : (e.pcs && e.pcs.includes(pc) ? 0 : 6); }
  return cost;
}
function placedMove(i0, i1, c0, c1, ctx) {
  let cost = 0;
  for (const U of ctx.others) {
    const u0 = U[i0], u1 = U[i1], p0 = Math.abs(u0 - c0) % 12, p1 = Math.abs(u1 - c1) % 12, m0 = u1 - u0, m1 = c1 - c0;
    if (!ctx.allowParallel && IS_PERFECT(p0) && p0 === p1 && m0 && Math.sign(m0) === Math.sign(m1)) return Infinity;
    if (IS_PERFECT(p1) && m0 && Math.sign(m0) === Math.sign(m1) && Math.abs(m1) > 2) cost += 4;     // hidden 5th/8ve
    if (m0 && m1 && Math.sign(m0) !== Math.sign(m1)) cost -= 1.5; else if (!m0 !== !m1) cost -= 0.5;
  }
  const leap = Math.abs(c1 - c0);
  return cost + (leap <= 2 ? 0 : leap <= 4 ? 1 : leap <= 7 ? 2 : leap === 12 ? 3 : leap <= 9 ? 4 : leap < 12 ? 6 : Infinity);
}
function placedLine(ev, ctx) {
  const n = ev.length; if (!n) return [];
  const cands = ev.map(e => { const out = []; for (let k = -28; k <= 28; k++) { const idx = e.idx + k; let midi = idxMidi(idx, e.fifths), alt = 0; const pc = ((midi % 12) + 12) % 12;
    const st = STEP_N[((idx % 7) + 7) % 7];       // a chord tone outside the key, spelt as the chord spells it (G♯ in E major, never F♭ for E)
    if (e.pcs && !e.pcs.includes(pc) && e.spell && st in e.spell) { const d = e.spell[st] - keyAlter(e.fifths, st); if (Math.abs(d) === 1) { midi += d; alt = d; } }
    if (midi >= ctx.range[0] && midi <= ctx.range[1]) out.push({ idx, midi, alt }); } return out; });
  if (cands.some(c => !c.length)) return null;
  const D = cands.map(c => c.map(() => ({ cost: Infinity, from: -1 })));
  cands[0].forEach((c, j) => { D[0][j].cost = placedCost(ev[0], c.midi, 0, n, ctx, c.idx); });
  for (let i = 1; i < n; i++) cands[i].forEach((c, j) => {
    const nc = placedCost(ev[i], c.midi, i, n, ctx, c.idx); if (nc === Infinity) return;
    cands[i - 1].forEach((p, k) => {
      if (D[i - 1][k].cost === Infinity) return;
      const aug = Math.abs(p.idx - c.idx) === 1 && Math.abs(p.midi - c.midi) === 3 ? 8 : 0;
      const t = D[i - 1][k].cost + nc + aug + placedMove(i - 1, i, p.midi, c.midi, ctx);
      if (t < D[i][j].cost) D[i][j] = { cost: t, from: k };
    });
  });
  let j = D[n - 1].reduce((b, x, k) => x.cost < D[n - 1][b].cost ? k : b, 0);
  if (D[n - 1][j].cost === Infinity) return null;
  const out = new Array(n); out.cost = D[n - 1][j].cost;
  for (let i = n - 1; i >= 0; i--) { out[i] = cands[i][j]; j = D[i][j].from; }
  return out;
}
/* every way the new voice can sit (under all, between, above all): the cheapest; under the others is the usual
   place for a 2nd or 3rd voice and is chosen whenever the instrument can play it there */
function placedBest(ev, others, opts) {
  const k = others.length, n = ev.length; let best = null;
  for (let mask = 0; mask < 1 << k; mask++) {
    const sides = others.map((_, q) => (mask >> q) & 1 ? 1 : -1);
    // impossible orders: above a voice that lies above another one the new voice is below
    let ok = true; for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) if (sides[a] === 1 && sides[b] === -1 && others[a].some((u, i) => u >= others[b][i])) ok = false;
    if (!ok) continue;
    for (const loose of [false, true]) {
      const line = placedLine(ev, { ...opts, others, sides, loose });
      if (line) { const c = line.cost + sides.filter(x => x > 0).length * 2.5 * n + (loose ? 50 : 0); if (!best || c < best.c) best = { line, c }; break; }
    }
  }
  return best && best.line;
}
/* a 2nd (third = false) or 3rd voice under a part, following these rules; above: the 2nd voice when writing the 3rd */
function ruledVoiceXml(xml, partId, { third = false, lowMidi = 40, v2Midi = null, above = false, place = null } = {}) {
  const doc = parseXml(xml), root = doc.documentElement, src = kids(root, "part").find(p => p.getAttribute("id") === partId); if (!src) return xml;
  const chords = chordsForBars(xml, partId), ev = melodyEvents(src, chords);
  const mel = ev.map(e => e.midi);
  let uppers = [mel];
  /* the 3rd voice is written against the 2nd voice that is really in the score (any instrument, edited or not) */
  if (third) { const v2 = v2Midi && v2Midi.length === mel.length ? v2Midi : (bestLine(ev, { uppers: [mel], lo: lowMidi }) || []).map(x => x.midi); if (v2.length === mel.length) uppers = [mel, v2]; }
  const line = (place && placedBest(ev, uppers, { third, range: place.range, comf: place.comf, staff: place.staff, wShift: place.wShift })) || bestLine(ev, { uppers, lo: lowMidi, third, above }) || bestLine(ev, { uppers, lo: lowMidi - 12, third, above, loose: true }) || bestLine(ev, { uppers, lo: lowMidi - 24, third, loose: true })
    || bestLine(ev, { uppers, lo: lowMidi - 24, third, loose: true, allowParallel: true });
  if (!line) return secondVoiceXml(xml, partId, { interval: third ? 6 : 3, level: 1 });
  const ids = new Set(kids(root, "part").map(p => p.getAttribute("id"))); let n = 2; while (ids.has("P" + n)) n++;
  const id = "P" + n, part = src.cloneNode(true); part.setAttribute("id", id);
  /* same notes in the copy, in the same order: write the chosen pitches */
  const copyEv = melodyEvents(part, chords);
  copyEv.forEach((e, i) => { const p = kid(e.el, "pitch"); if (p && line[i]) { setPitch(doc, p, line[i].idx, e.fifths);
      if (line[i].alt) { let al = kid(p, "alter"); if (!al) { al = doc.createElement("alter"); p.insertBefore(al, kid(p, "octave")); al.textContent = "0"; } al.textContent = String((parseInt(al.textContent, 10) || 0) + line[i].alt); } kids(e.el, "accidental").forEach(a => a.remove()); kids(e.el, "lyric").forEach(a => a.remove()); } });
  kids(part, "measure").forEach(m => { kids(m, "direction").forEach(d => { if (!d.getElementsByTagName("sound").length) d.remove(); }); [...m.getElementsByTagName("lyric")].forEach(l => l.remove()); });
  root.appendChild(part);
  const pl = kid(root, "part-list"), sp = doc.createElement("score-part"); sp.setAttribute("id", id); sp.innerHTML = `<part-name>Głos</part-name>`; pl.appendChild(sp);
  return new XMLSerializer().serializeToString(doc);
}

/* ---------------- piano accompaniment by metre (two staves) ----------------
   3/4 waltz: bass on 1, chord on 2 and 3 · 2/4: bass on 1 and 2, chord on the offbeats · 4/4: bass on 1 and 3,
   chord on 2 and 4 · 6/8: bass on 1 and 4, chord on the other eighths · other metres: bass and chord on 1.
   Right hand in close position between C4 and C5, moving to the nearest inversion; left hand root (and fifth)
   between E2 and E3, nothing low and thick (no thirds below C3). */
function pianoPartXml(one, srcId) {
  const doc = parseXml(one), part = kids(doc.documentElement, "part")[0], chords = chordsForBars(one, srcId);
  let prev = null, prevTop = 67, first = true;
  barInfo(part).forEach(({ m, div, beats, bt, full, len, pickup }, i) => {
    kids(m, "attributes").forEach(a => {
      if (first) { kids(a, "clef").forEach(c => c.remove()); const st = doc.createElement("staves"); st.textContent = "2"; a.appendChild(st); a.insertAdjacentHTML("beforeend", `<clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>`); first = false; }
      else kids(a, "clef").forEach(c => c.remove());
    });
    const add = clearBar(m), q = div, cap = len, c = chords[i] || prev; prev = c;
    const both = (r, l) => add(r + `<backup><duration>${cap}</duration></backup>` + l);
    /* the pickup (§12): both hands wait for the first full bar */
    if (pickup) { both(valuesXml(cap / div, div, null, 1, 1), valuesXml(cap / div, div, null, 5, 2)); return; }
    if (!c) { both(`<note><rest measure="yes"/><duration>${cap}</duration><voice>1</voice><staff>1</staff></note>`, `<note><rest measure="yes"/><duration>${cap}</duration><voice>5</voice><staff>2</staff></note>`); return; }
    /* the chord's own spelling (G♯ in E major in A minor, E♯ in C♯ major), never the nearest key note */
    const r = c.tonicLof + c.lof, ls = [r, r + (c.minor ? -3 : 4), c.seventh ? r - 2 : r + 1].map(lofToPitch);   // V7 without its 5th
    const pcs = ls.map(p => ((SCALE_ST[STEP_I[p.letter]] + p.alter) % 12 + 12) % 12), spell = {}; pcs.forEach((pc, k) => (spell[pc] = ls[k]));
    const P = midi => { const x = spell[((midi % 12) + 12) % 12]; return `<pitch><step>${x.letter}</step>${x.alter ? `<alter>${x.alter}</alter>` : ""}<octave>${Math.floor((midi - x.alter) / 12) - 1}</octave></pitch>`; };
    /* right hand: the inversion whose top is nearest the previous one, inside C4–C5 */
    let best = null;
    for (let inv = 0; inv < 3; inv++) {
      const order = [pcs[inv], pcs[(inv + 1) % 3], pcs[(inv + 2) % 3]]; let lo = 60 + ((order[0] - 60) % 12 + 12) % 12; if (lo > 64) lo -= 12;
      const ch = [lo]; order.slice(1).forEach(pc => { let x = ch[ch.length - 1] + 1; while (((x % 12) + 12) % 12 !== pc) x++; ch.push(x); });
      if (ch[2] > 74) continue; const sc = Math.abs(ch[2] - prevTop); if (!best || sc < best.sc) best = { ch, sc };
    }
    const rh = best ? best.ch : [60, 64, 67]; prevTop = rh[2];
    let root = 40 + ((pcs[0] - 40) % 12 + 12) % 12, fifth = root + 7; if (fifth > 55) fifth -= 12;
    const fifthP = `<pitch><step>${lofToPitch(r + 1).letter}</step>${lofToPitch(r + 1).alter ? `<alter>${lofToPitch(r + 1).alter}</alter>` : ""}<octave>${Math.floor((fifth - lofToPitch(r + 1).alter) / 12) - 1}</octave></pitch>`;
    const chordXml = (d, t, dot = "") => rh.map((x, j) => `<note>${j ? "<chord/>" : ""}${P(x)}<duration>${d}</duration><voice>1</voice><type>${t}</type>${dot}<staff>1</staff></note>`).join("");
    const rest = (d, t, v, s, dot = "") => `<note><rest/><duration>${d}</duration><voice>${v}</voice><type>${t}</type>${dot}<staff>${s}</staff></note>`;
    const bass = (x, d, t, dot = "") => `<note>${x === fifth ? fifthP : P(x)}<duration>${d}</duration><voice>5</voice><type>${t}</type>${dot}<staff>2</staff></note>`;
    let R = "", L = "";
    const whole = cap === full;
    if (whole && beats === 3 && bt === 4) { R = rest(q, "quarter", 1, 1) + chordXml(q, "quarter") + chordXml(q, "quarter"); L = bass(root, q, "quarter") + rest(2 * q, "half", 5, 2); }
    else if (whole && beats === 2 && bt === 4) { const e = q / 2; R = rest(e, "eighth", 1, 1) + chordXml(e, "eighth") + rest(e, "eighth", 1, 1) + chordXml(e, "eighth"); L = bass(root, q, "quarter") + bass(fifth, q, "quarter"); }
    else if (whole && beats === 4 && bt === 4) { R = rest(q, "quarter", 1, 1) + chordXml(q, "quarter") + rest(q, "quarter", 1, 1) + chordXml(q, "quarter"); L = bass(root, 2 * q, "half") + bass(fifth, 2 * q, "half"); }
    else if (whole && bt === 8 && beats === 6) { const e = q / 2; R = (rest(e, "eighth", 1, 1) + chordXml(e, "eighth") + chordXml(e, "eighth")).repeat(2); L = bass(root, 3 * e, "quarter", "<dot/>") + bass(fifth, 3 * e, "quarter", "<dot/>"); }
    else {         // other metres and a short last bar: one chord over the bar (tied values when one cannot hold it)
      const rp = rh.map(P); R = valuesXml(cap / div, div, rp, 1, 1); L = valuesXml(cap / div, div, [P(root)], 5, 2);
    }
    both(R, L);
  });
  return new XMLSerializer().serializeToString(doc);
}
/* ---------------- the score as an orchestra ----------------
   Each part remembers its instrument (MusicXML <score-instrument><instrument-name>), so "Puzon III" can be a bass
   trombone. Parts of one section keep the numbers they have; a new or changed part takes the next one, the bass
   trombone (and a bass instrument of a section) is always last, an alto trombone first; the score
   follows the usual order: woodwinds, brass, percussion, harp and guitars, keyboards, voices, strings. */
const SCORE_ORDER = ["piccolo", "flet", "flet-a", "flet-p", "oboj", "rozek", "klarnet-es", "klarnet", "klarnet-a", "klarnet-bas", "fagot", "kontrafagot",
  "sax-s", "sax-a", "sax-t", "sax-b", "waltornia", "trabka", "trabka-c", "kornet", "flugelhorn", "sakshorn-a", "sakshorn-t", "puzon-alt", "puzon", "puzon-b",
  "eufonium", "baryton", "tuba", "suzafon", "dzwonki", "ksylofon", "marimba", "wibrafon", "harfa", "gitara", "ukulele", "mandolina", "gitara-bas",
  "fortepian", "organy", "akordeon", "keyboard", "sopran", "alt", "tenor", "bas", "skrzypce", "altowka", "wiolonczela", "kontrabas"];
const SECTION = { puzon: "Puzon", "puzon-alt": "Puzon", "puzon-b": "Puzon", trabka: "Trąbka", "trabka-c": "Trąbka" };
const SECTION_RANK = { "puzon-alt": 0, puzon: 1, "puzon-b": 2 };
const ROMAN = ["I", "II", "III", "IV", "V", "VI"];
function declaredInstr(sp) { const n = sp && sp.getElementsByTagName("instrument-name")[0]; return n ? INSTRUMENTS.find(i => i.name === n.textContent.trim()) || null : null; }
function setDeclared(doc, sp, instr) {
  kids(sp, "score-instrument").forEach(x => x.remove());
  const si = doc.createElement("score-instrument"); si.setAttribute("id", sp.getAttribute("id") + "-I1");
  const nm = doc.createElement("instrument-name"); nm.textContent = instr.name; si.appendChild(nm);
  const before = kids(sp, "midi-device")[0] || kids(sp, "midi-instrument")[0] || kids(sp, "player")[0];
  before ? sp.insertBefore(si, before) : sp.appendChild(si);
}
/* instrOf(sp, partEl) → the part's instrument or null; staves > 1 (piano) keep their name */
function orchestrate(xml, instrOf, newId = null) {
  const doc = parseXml(xml), root = doc.documentElement, pl = kid(root, "part-list"); if (!pl) return xml;
  const sps = kids(pl, "score-part"), partEl = id => kids(root, "part").find(p => p.getAttribute("id") === id);
  const info = sps.map((sp, k) => {
    const p = partEl(sp.getAttribute("id")), two = p && /<staves>[2-9]<\/staves>/.test(new XMLSerializer().serializeToString(p).slice(0, 4000));
    const ins = instrOf(sp, p); if (ins && !two) setDeclared(doc, sp, ins);
    const ps = p ? partPitches(p).map(m => m - (ins ? ins.tr || 0 : 0)) : [];
    const num = ROMAN.indexOf((txt(sp, "part-name").match(/ (I|II|III|IV|V|VI)$/) || [])[1]);
    return { sp, p, ins, two, k, med: ps.length ? median(ps) : 0, num: num < 0 ? 98 : num, isNew: sp.getAttribute("id") === newId };
  });
  /* sections: two or more parts of one family get numbers, highest first, the bass trombone last */
  const fam = {}; info.forEach(x => { if (!x.ins || x.two) return; const f = SECTION[x.ins.id] || x.ins.name; (fam[f] = fam[f] || []).push(x); });
  Object.entries(fam).forEach(([f, list]) => {
    list.sort((a, b) => (SECTION_RANK[a.ins.id] ?? 1) - (SECTION_RANK[b.ins.id] ?? 1) || a.isNew - b.isNew || a.num - b.num || a.k - b.k);
    list.forEach((x, i) => { x.sec = i; kid(x.sp, "part-name").textContent = list.length > 1 ? `${f} ${ROMAN[i] || i + 1}` : x.ins.name; });
  });
  /* score order */
  const rank = x => { const id = x.ins ? x.ins.id : x.two ? "fortepian" : null; const r = id ? SCORE_ORDER.indexOf(id) : -1; return r < 0 ? 999 : r; };
  const famRank = x => x.ins ? Math.min(...(fam[SECTION[x.ins.id] || x.ins.name] || [x]).map(rank)) : rank(x);
  const sorted = [...info].sort((a, b) => famRank(a) - famRank(b) || (a.sec ?? 0) - (b.sec ?? 0) || a.k - b.k);
  const groups = kids(pl, "part-group"), starts = groups.filter(g => g.getAttribute("type") === "start"), stops = groups.filter(g => g.getAttribute("type") === "stop");
  groups.forEach(g => g.remove());
  sorted.forEach(x => pl.appendChild(x.sp));
  starts.reverse().forEach(g => pl.insertBefore(g, pl.firstChild)); stops.forEach(g => pl.appendChild(g));
  sorted.forEach(x => { if (x.p) root.appendChild(x.p); });
  return new XMLSerializer().serializeToString(doc);
}
/* the clef a part is read in: of the instrument's clefs, the fewest ledger lines (its usual clef a little preferred) */
function fitClef(part, instr) {
  if (/<staves>[2-9]<\/staves>/.test(new XMLSerializer().serializeToString(part).slice(0, 4000))) return;
  const idx = partIdx(part); if (!idx.length) return;
  let best = ledgerCost(idx, instr.clef) - 0.5, name = instr.clef;
  clefsOf(instr).filter(c => c !== instr.clef).forEach(c => { const v = ledgerCost(idx, c); if (v < best) { best = v; name = c; } });
  [...part.getElementsByTagName("clef")].forEach((c, i) => { if (i === 0) c.innerHTML = PART_CLEF[name] || PART_CLEF.treble; else c.remove(); });
}
function swapPart(xml, pid, fn) {
  const doc = parseXml(xml), root = doc.documentElement, part = kids(root, "part").find(p => p.getAttribute("id") === pid); if (!part) return xml;
  const np = fn(soloScore(doc, part)); if (!np) return xml;
  const imp = doc.importNode(np, true); imp.setAttribute("id", pid); part.replaceWith(imp);
  return new XMLSerializer().serializeToString(doc);
}
/* the same notes for another instrument: same sound (its transposition, its clef); an octave moves only if the
   notes would leave the new instrument's range */
function changePartInstr(xml, pid, from, to) {
  const out = swapPart(xml, pid, one => {
    const p0 = kids(parseXml(one).documentElement, "part")[0], f = parseInt(txt(p0.getElementsByTagName("key")[0] || p0, "fifths") || "0", 10) || 0;
    const tf = TR_IV[from.tr] || TR_IV[0], tt = TR_IV[to.tr] || TR_IV[0], ps = partPitches(p0).map(m => m - (from.tr || 0));
    const oct = ps.some(m => m < to.lo || m > to.hi) ? octaveFor(ps, to, partIdx(p0).map(i => i - tf.d)) : 0;
    const w = kids(parseXml(transposeXmlString(one, fixEnharmonic({ d: tt.d - tf.d + 7 * oct, s: tt.s - tf.s + 12 * oct }, f))).documentElement, "part")[0];
    fitClef(w, to); return w;
  });
  const d = parseXml(out), sp = [...d.getElementsByTagName("score-part")].find(x => x.getAttribute("id") === pid);
  if (sp) { setDeclared(d, sp, to); kid(sp, "part-name").textContent = to.name; }
  return new XMLSerializer().serializeToString(d);
}
function shiftPartOctave(xml, pid, dir, instr) {
  return swapPart(xml, pid, one => { const w = kids(parseXml(transposeXmlString(one, { d: 7 * dir, s: 12 * dir })).documentElement, "part")[0]; if (instr) fitClef(w, instr); return w; });
}

/* ---------------- canon (round): the same tune, each voice entering a few bars after the previous one ----------------
   The distance is chosen by ear, mathematically: every 1, 2, 3 or 4 bars, the one where the voices sound together best
   (strong-beat dissonances weigh most). "Panie Janie" comes out at 2 bars. Earlier voices rest at the end, later ones
   at the start; every other part (piano) gets empty bars so the score stays aligned. */
function canonPlan(xml, srcId, n = 3) {
  const doc = parseXml(xml), src = kids(doc.documentElement, "part").find(p => p.getAttribute("id") === srcId); if (!src) return null;
  const ev = melodyEvents(src, chordsForBars(xml, srcId)); if (!ev.length) return null;
  /* voices enter whole bars apart (a pickup keeps its place before the bar line: times are real, not bar × length) */
  const bi = barInfo(src), barLen = bi.length > 1 ? bi[1].full / bi[1].div : bi[0].full / bi[0].div, B = bi.length;
  const notes = ev.map(e => ({ s: e.t, e: e.t + e.dur, m: e.midi, strong: e.strong, beat: e.beat }));
  const at = (shift, time) => { const x = notes.find(q => q.s + shift <= time + 1e-6 && time < q.e + shift - 1e-6); return x ? x.m : null; };
  let best = null;
  for (let d = 1; d <= 4 && d * (n - 1) < B; d++) {
    let bad = 0, hits = 0, sHits = 0, sBad = 0;
    for (let k = 0; k < n; k++) notes.forEach(q => {
      const time = q.s + k * d * barLen, sound = [];
      for (let j = 0; j < n; j++) { const m = at(j * d * barLen, time); if (m !== null) sound.push(m); }
      if (sound.length < 2) return;
      for (let a = 0; a < sound.length; a++) for (let b = a + 1; b < sound.length; b++) {
        const iv = Math.abs(sound[a] - sound[b]) % 12; hits++;
        if (q.strong) { sHits++; if ([1, 2, 6, 10, 11].includes(iv)) sBad++; }
        if ([1, 2, 6, 10, 11].includes(iv)) bad += q.strong ? 3 : q.beat ? 1 : 0.3;
        else if (iv === 0) bad += 0.6;                         // the same note: no harmony, the voices only double
      }
    });
    const score = hits ? bad / hits : 9;
    (canonPlan.all = canonPlan.all || {})[d] = score;
    if (!best || score < best.score - 1e-9) best = { d, score, strongBad: sHits ? sBad / sHits : 1 };
  }
  return best && { ...best, bars: B };
}
const twoStaff = part => { const s = part.getElementsByTagName("staves")[0]; return !!s && parseInt(s.textContent, 10) > 1; };
/* an empty bar (a whole-bar rest); len: a shorter bar (a pickup, or the bar that completes it), in divisions */
function restMeasure(doc, part, num, len = null) {
  let div = 1, beats = 4, bt = 4; const a = part.getElementsByTagName("attributes")[0];
  if (a) { const dv = kid(a, "divisions"); if (dv) div = parseFloat(dv.textContent) || 1; const t = kid(a, "time"); if (t) { beats = parseInt(txt(t, "beats"), 10) || 4; bt = parseInt(txt(t, "beat-type"), 10) || 4; } }
  const cap = div * 4 * beats / bt, two = twoStaff(part);
  const m = doc.createElement("measure"); m.setAttribute("number", String(num));
  if (len !== null && len < cap - 1e-6) { m.setAttribute("implicit", "yes"); m.innerHTML = valuesXml(len / div, div, null, 1, two ? 1 : "") + (two ? `<backup><duration>${len}</duration></backup>` + valuesXml(len / div, div, null, 5, 2) : ""); return m; }
  m.innerHTML = `<note><rest measure="yes"/><duration>${cap}</duration><voice>1</voice>${two ? "<staff>1</staff>" : ""}</note>` + (two ? `<backup><duration>${cap}</duration></backup><note><rest measure="yes"/><duration>${cap}</duration><voice>5</voice><staff>2</staff></note>` : "");
  return m;
}
/* rests of q quarters put into a bar: at its start (before the first note) or at its end (before the closing barline) */
function padBar(m, q, div, atStart, two = false) {
  const t = m.ownerDocument.createElement("x");
  t.innerHTML = two ? valuesXml(q, div, null, 5, 2) + `<backup><duration>${q * div}</duration></backup>` + valuesXml(q, div, null, 1, 1) : valuesXml(q, div, null);
  const ref = atStart ? [...m.children].find(c => ["note", "backup", "forward"].includes(c.tagName)) || null : kids(m, "barline").find(b => (b.getAttribute("location") || "right") === "right") || null;
  [...t.childNodes].forEach(nd => m.insertBefore(nd, ref));
  m.removeAttribute("implicit");
}
/* voices: instruments for voice 2, 3… (voice 1 is the source part); returns the new score and the new part ids.
   A pickup keeps its place: a later voice starts with a short empty bar, then whole empty bars, and its pickup sits at
   the end of a full bar; earlier voices fill their short last bar and the score ends with the short bar (§12). The
   final double bar moves to the new last bar of every part. */
function canonXml(xml, srcId, voices, d) {
  let out = xml; const ids = [];
  for (const ins of voices) { const before = new Set(kids(parseXml(out).documentElement, "part").map(p => p.getAttribute("id"))); out = makePart(out, srcId, { role: "melody", instr: ins }); ids.push(kids(parseXml(out).documentElement, "part").map(p => p.getAttribute("id")).find(id => !before.has(id))); }
  const doc = parseXml(out), root = doc.documentElement, n = voices.length + 1;
  kids(root, "part").forEach(p => {
    const k = ids.indexOf(p.getAttribute("id")) + 1;          // 0: the source and every other part
    const pre = k * d, post = (n - 1 - k) * d, ms = kids(p, "measure"), bi = barInfo(p);
    if (!ms.length) return;
    const F = bi[0].full, first = bi[0], lastI = bi[bi.length - 1], single = !twoStaff(p);
    if (pre) {
      /* the attributes (clef, key, time) and the tempo move to the first, empty bar */
      const head = [...ms[0].children].filter(c => c.tagName === "attributes" || c.tagName === "print" || (c.tagName === "direction" && c.getElementsByTagName("sound").length));
      const rests = Array.from({ length: pre }, (_, i) => restMeasure(doc, p, 0, i === 0 && first.pickup ? first.len : null));
      head.reverse().forEach(c => rests[0].insertBefore(c, rests[0].firstChild));
      rests.forEach(r => p.insertBefore(r, ms[0]));
      if (first.pickup && single) padBar(ms[0], (F - first.len) / first.div, first.div, true);
    }
    if (post) {
      const shortEnd = lastI.len < lastI.full - 1e-6;
      if (shortEnd) padBar(lastI.m, (lastI.full - lastI.len) / lastI.div, lastI.div, false, !single);
      for (let i = 0; i < post; i++) p.appendChild(restMeasure(doc, p, 0, shortEnd && i === post - 1 ? lastI.len : null));
      const fin = kids(lastI.m, "barline").find(b => (b.getAttribute("location") || "right") === "right" && /light-heavy/.test(txt(b, "bar-style")) && !kid(b, "repeat"));
      if (fin) kids(p, "measure").pop().appendChild(fin);
    }
    kids(p, "measure").forEach((m, i) => m.setAttribute("number", String(i + 1)));
  });
  return { xml: new XMLSerializer().serializeToString(doc), ids };
}
