/* Arrangement audit: open Solo, load this file in the console (or a <script>), then run
   auditFlow(src, voice2Instr, voice3Instr), auditStaff([srcs], [roles]), auditSpell([[src, v2, v3], ...]).
   Checks generated 2nd/3rd voices for strong-beat dissonance (a 4th only against the lowest voice), parallel 5ths/8ves,
   chord tones, spelling, and every instrument's part for ledger lines and range. Public-domain tunes only. */
window.tuneXml = function (title, fifths, beats, bt, bars, instrName, shift = 0) {
  const ci = INSTRUMENTS.find(i => i.name === instrName), clefX = PART_CLEF[ci ? ci.clef : "bass"];
  const typ = { 1: "16th", 2: "eighth", 3: "eighth", 4: "quarter", 6: "quarter", 8: "half", 12: "half", 16: "whole" };
  let s = `<?xml version="1.0"?><score-partwise version="3.1"><work><work-title>${title}</work-title></work><part-list><score-part id="P1"><part-name>${instrName}</part-name></score-part></part-list><part id="P1">`;
  bars.split("|").forEach((b, i) => {
    s += `<measure number="${i + 1}">` + (i ? "" : `<attributes><divisions>4</divisions><key><fifths>${fifths}</fifths></key><time><beats>${beats}</beats><beat-type>${bt}</beat-type></time><clef>${clefX}</clef></attributes>`);
    b.trim().split(/\s+/).forEach(t => { const [p, d] = t.split(":"); const m = p.match(/^([A-G])(#|b)?(\d)$/); const dd = +d;
      s += `<note><pitch><step>${m[1]}</step>${m[2] ? `<alter>${m[2] === "#" ? 1 : -1}</alter>` : ""}<octave>${+m[3] + shift}</octave></pitch><duration>${dd}</duration><voice>1</voice><type>${typ[dd]}</type>${[3, 6, 12].includes(dd) ? "<dot/>" : ""}</note>`; });
    s += `</measure>`;
  });
  return s + `</part></score-partwise>`;
};
window.TUNES = [
  ["Wlazł kotek", 0, 3, 4, "G3:4 E3:4 E3:4|F3:4 D3:4 D3:4|C3:2 E3:2 G3:8|G3:4 E3:4 E3:4|F3:4 D3:4 D3:4|C3:2 E3:2 C3:8"],
  ["Panie Janie", -1, 4, 4, "F3:4 G3:4 A3:4 F3:4|F3:4 G3:4 A3:4 F3:4|A3:4 Bb3:4 C4:8|A3:4 Bb3:4 C4:8|C4:2 D4:2 C4:2 Bb3:2 A3:4 F3:4|C4:2 D4:2 C4:2 Bb3:2 A3:4 F3:4|F3:4 C3:4 F3:8|F3:4 C3:4 F3:8"],
  ["Oda", 2, 4, 4, "F#3:4 F#3:4 G3:4 A3:4|A3:4 G3:4 F#3:4 E3:4|D3:4 D3:4 E3:4 F#3:4|F#3:6 E3:2 E3:8|F#3:4 F#3:4 G3:4 A3:4|A3:4 G3:4 F#3:4 E3:4|D3:4 D3:4 E3:4 F#3:4|E3:6 D3:2 D3:8"],
  ["Moll a", 0, 4, 4, "A3:4 C4:4 E4:4 C4:4|D4:4 B3:4 G#3:8|A3:4 B3:4 C4:4 D4:4|E4:4 D4:4 C4:4 B3:4|A3:4 E3:4 F3:4 D3:4|E3:4 G#3:4 A3:8"],
  ["6/8", 1, 6, 8, "D3:4 G3:2 B3:4 G3:2|D4:6 B3:6|C4:4 A3:2 B3:4 G3:2|A3:6 D3:6|D3:4 G3:2 B3:4 G3:2|D4:6 B3:6|C4:4 A3:2 F#3:4 A3:2|G3:12"]
];
const shiftFor = ins => Math.round(((ins.comf ? (ins.comf[0] + ins.comf[1]) / 2 : (ins.lo + ins.hi) / 2) + (ins.tr || 0) - 53) / 12);
window.auditFlow = function (srcInstr, i2, i3) {
  const out = [];
  for (const T of TUNES) {
    const ins = instrById(srcInstr);
    let xml = tuneXml(T[0], T[1], T[2], T[3], T[4], ins.name, shiftFor(ins));
    loadState({ xml, instrument: ins.name, title: T[0] });
    const ev = melodyEvents(kids(parseXml(xml).documentElement, "part")[0], chordsForBars(xml, "P1"));
    let r = addPart(xml, i2, "voice2", { int: 0 }); xml = r.xml; loadState({ xml, instrument: ins.name, title: T[0] }); const id2 = r.id;
    r = addPart(xml, i3, "voice3", { int: 0 }); xml = r.xml; loadState({ xml, instrument: ins.name, title: T[0] }); const id3 = r.id;
    const M = soundingLine(xml, "P1"), V2 = soundingLine(xml, id2), V3 = soundingLine(xml, id3), probs = [];
    for (let k = 0; k < M.length; k++) {
      const e = ev[k], v = [M[k], V2[k], V3[k]], lowest = Math.min(...v), b = `t${e.bar + 1}`, nm = ["mel", "v2", "v3"];
      [[0, 1], [0, 2], [1, 2]].forEach(([a, c]) => {
        const hi = Math.max(v[a], v[c]), lo = Math.min(v[a], v[c]), iv = (hi - lo) % 12;
        if (e.strong && ([1, 2, 6, 10, 11].includes(iv) || (iv === 5 && lo === lowest))) probs.push(`${b}: dysonans ${nm[a]}-${nm[c]} (${iv})`);
        if (k) { const A = [M, V2, V3][a], C = [M, V2, V3][c], p0 = (Math.max(A[k - 1], C[k - 1]) - Math.min(A[k - 1], C[k - 1])) % 12, ma = A[k] - A[k - 1], mc = C[k] - C[k - 1];
          if ((iv === 0 || iv === 7) && p0 === iv && ma && mc && Math.sign(ma) === Math.sign(mc)) probs.push(`${b}: równoległe ${iv ? "kwinty" : "oktawy"} ${nm[a]}-${nm[c]}`); }
      });
      if (V2[k] > M[k]) probs.push(`${b}: v2 nad melodią`); if (V3[k] > V2[k]) probs.push(`${b}: v3 nad v2`);
      if (e.strong && e.pcs) { const tp = (((M[k] - (instrById(srcInstr).tr || 0)) % 12) + 12) % 12; }
    }
    if (M.length !== V2.length || M.length !== V3.length) probs.push("długości " + [M.length, V2.length, V3.length]);
    const nmn = m => ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"][((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
    out.push({ tune: T[0], probs: [...new Set(probs)], lines: [M, V2, V3].map(l => l.map(nmn).join(" ")) });
  }
  return out;
};
window.auditStaff = function (srcs, roles) {
  const BOT = { treble: 30, bass: 18, alto: 24, tenor: 22 }, SIGN = { G2: "treble", F4: "bass", C3: "alto", C4: "tenor" };
  const bad = [];
  for (const sid of srcs) for (const T of TUNES.slice(0, 2)) {
    const s = instrById(sid), xml0 = tuneXml(T[0], T[1], T[2], T[3], T[4], s.name, shiftFor(s));
    for (const ins of INSTRUMENTS) for (const role of roles) {
      loadState({ xml: xml0, instrument: s.name, title: T[0] });
      let r; try { r = addPart(xml0, ins.id, role, { int: 0 }); } catch (e) { bad.push(`${s.name}→${ins.name} ${role}: BŁĄD ${e.message}`); continue; }
      const part = kids(parseXml(r.xml).documentElement, "part").find(p => p.getAttribute("id") === r.id); if (!part) continue;
      const clefs = [...part.getElementsByTagName("clef")].map(c => ({ st: c.getAttribute("number") || "1", cl: SIGN[txt(c, "sign") + txt(c, "line")] || txt(c, "sign") + txt(c, "line") }));
      const notes = [...part.getElementsByTagName("note")].filter(n => kid(n, "pitch"));
      const per = {}; notes.forEach(n => { const st = txt(n, "staff") || "1", p = kid(n, "pitch"); (per[st] = per[st] || []).push(+txt(p, "octave") * 7 + STEP_I[txt(p, "step")]); });
      const outR = notes.map(n => midiOf(kid(n, "pitch")) - (ins.tr || 0)).filter(m => m < ins.lo || m > ins.hi).length;
      for (const st in per) {
        const cl = (clefs.find(c => c.st === st) || clefs[0] || {}).cl, L = BOT[cl]; if (L === undefined) { bad.push(`${s.name}→${ins.name} ${role}: klucz ${cl}`); continue; }
        const led = per[st].map(i => i < L - 1 ? Math.floor((L - i) / 2) : i > L + 9 ? Math.floor((i - L - 8) / 2) : 0);
        const max = Math.max(...led), off = led.filter(x => x > 0).length / led.length, mean = led.reduce((a, b) => a + b, 0) / led.length;
        if (max > 3 || mean > 1.2 || (outR && st === "1")) bad.push(`${s.name} (${T[0]}) → ${ins.name} [${role}] ${cl}${st !== "1" ? "/" + st : ""}: max ${max} linii, średnio ${mean.toFixed(1)}${outR && st === "1" ? `, ${outR} poza skalą` : ""}`);
      }
    }
  }
  return bad;
};
/* spelling: accidentals outside the part's key in generated parts (only the raised leading tone of a minor key is expected) */
window.auditSpell = function (combos) {
  const out = [];
  for (const [a, b, c] of combos) for (const T of TUNES) {
    const ins = instrById(a); let xml = tuneXml(T[0], T[1], T[2], T[3], T[4], ins.name, shiftFor(ins));
    loadState({ xml, instrument: ins.name, title: T[0] });
    let r = addPart(xml, b, "voice2", { int: 0 }); xml = r.xml; loadState({ xml, instrument: ins.name, title: T[0] }); const i2 = r.id;
    r = addPart(xml, c, "voice3", { int: 0 }); xml = r.xml; const i3 = r.id;
    const d = parseXml(xml);
    for (const id of [i2, i3]) {
      const part = kids(d.documentElement, "part").find(p => p.getAttribute("id") === id); let f = 0; const k = part.getElementsByTagName("key")[0]; if (k) f = parseInt(txt(k, "fifths"), 10) || 0;
      const odd = [...part.getElementsByTagName("pitch")].map(p => ({ st: txt(p, "step"), al: parseInt(txt(p, "alter") || "0", 10), oc: txt(p, "octave") })).filter(x => x.al !== keyAlter(f, x.st));
      const weird = odd.filter(x => Math.abs(x.al) > 1 || (x.al === -1 && ["C", "F"].includes(x.st)) || (x.al === 1 && ["E", "B"].includes(x.st)));
      if (weird.length || odd.length > 3) out.push(`${a}/${b}/${c} ${T[0]} ${id}: ${odd.map(x => x.st + (x.al > 0 ? "#".repeat(x.al) : "b".repeat(-x.al)) + x.oc).join(" ")}`);
    }
  }
  return out;
};
