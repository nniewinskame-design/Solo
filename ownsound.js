/* Solo: "Twój dźwięk", playback with the player's own instrument (benchmark: Logic Auto Sampler / Quick Sampler,
   GarageBand Sampler, Face ID enrolment ring, TonalEnergy). Not every note is needed: five anchor notes a fourth
   or fifth apart, so no note is shifted by more than about 3–4 semitones (beyond that a recording starts to sound
   unnatural). Each note is guided by the tuner and captured by itself once it is clean and steady for 1.5 s.
   The steady middle is looped seamlessly (whole periods, ends on zero crossings, a crossfade baked in). */
"use strict";

/* recordings per instrument: { instrumentId: [ { midi (float, measured), rate, data: Float32Array, ls, le } … ] } */
const own = { byInstr: {} };
const OWN_HOLD = 1500, OWN_TOL = 15, OWN_RATE = 24000;
/* the anchor notes (sounding MIDI): trombones on open first-position notes, others spread over their range */
function ownTargets(m = instrById(of.instr || mainInstr().id)) {
  if (["puzon", "eufonium", "baryton"].includes(m.id)) return [41, 46, 53, 58, 65];       // F, B, f, b, f1
  if (m.id === "puzon-b" || m.id === "tuba" || m.id === "suzafon") return [m.lo + 3, m.lo + 8, m.lo + 15, m.lo + 20, m.lo + 27];
  const lo = m.lo + 3, hi = m.hi - 8, step = (hi - lo) / 4;
  return [0, 1, 2, 3, 4].map(i => Math.round(lo + i * step));
}
const POS_PUZON = { 41: "6. pozycja", 46: "1. pozycja", 53: "1. pozycja", 58: "1. pozycja", 65: "1. pozycja" };
/* a note named as the recorded instrument's player reads it (its own transposition with the octave, when the
   profile shows written notes), not as the tuner happens to be set */
function ownTr() {
  const id = of.instr || mainInstr().id;
  if (ownTr.k !== id) { ownTr.k = id; ownTr.v = profile().reading === "written" ? instrById(id).tr || 0 : 0; }
  return ownTr.v;
}
function noteLabel(midi) { return writtenName(midi, ownTr()); }

/* ---------------- storage: 16-bit, 24 kHz, one IndexedDB record per instrument (five short notes ≈ 0.4 MB) ----------------
   Until 3.9 the recordings were base64 in localStorage, which holds only ~5 MB for everything: after a few
   instruments a save failed without a word. They move over once; the old copy goes only after the new one is written. */
function packF32(f) { const i16 = Int16Array.from(f, v => Math.max(-32767, Math.min(32767, Math.round(v * 32767)))); let s = ""; const u8 = new Uint8Array(i16.buffer); for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); }
function unpackF32(b64) { const bin = atob(b64), a = new Int16Array(bin.length / 2); for (let i = 0; i < a.length; i++) a[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); return Float32Array.from(a, v => v / 32767); }
const toPcm = f => Int16Array.from(f, v => Math.max(-32767, Math.min(32767, Math.round(v * 32767)))).buffer;
const fromPcm = buf => Float32Array.from(new Int16Array(buf), v => v / 32767);
const ownRec = (id, list) => ({ id, list: list.map(x => ({ midi: x.midi, rate: x.rate, ls: x.ls, le: x.le, pcm: toPcm(x.data) })) });
own.saved = new Map();                          // instrument → the list as last written (only changed ones are written again)
/* a browser without IndexedDB keeps them in localStorage as before, but a failed write is now reported */
function saveLS() {
  const out = {}; Object.entries(own.byInstr).forEach(([id, list]) => { if (list && list.length) out[id] = list.map(x => ({ midi: x.midi, rate: x.rate, ls: x.ls, le: x.le, b64: packF32(x.data) })); });
  if (!store.set("ownSamples2", JSON.stringify(out))) throw Object.assign(new Error("localStorage full"), { name: "QuotaExceededError" });
}
async function saveOwnNow() {
  const put = [], dels = [];
  Object.entries(own.byInstr).forEach(([id, list]) => { if (list && list.length && own.saved.get(id) !== list) put.push([id, list]); });
  own.saved.forEach((_, id) => { if (!(own.byInstr[id] && own.byInstr[id].length)) dels.push(id); });
  if (!put.length && !dels.length) return true;
  try {
    if (DB.ok) await DB.putIn("samples", put.map(([id, list]) => ownRec(id, list)), dels); else saveLS();
    put.forEach(([id, list]) => own.saved.set(id, list)); dels.forEach(id => own.saved.delete(id));
    return true;
  } catch (e) {
    console.warn("own sound", e);
    hud(e && e.name === "QuotaExceededError" ? "Za mało miejsca, żeby zapisać dźwięk." : "Nie udało się zapisać dźwięku. Spróbuj jeszcze raz.", 4000);
    return false;
  }
}
/* writes what changed; true when it is safely stored, otherwise the person is told */
async function saveOwn() { await own.ready; return saveOwnNow(); }
own.ready = (async function loadOwn() {
  try {
    (await DB.getAllIn("samples")).forEach(r => { if (r && Array.isArray(r.list) && r.list.length) { own.byInstr[r.id] = r.list.map(x => ({ midi: x.midi, rate: x.rate, ls: x.ls, le: x.le, data: fromPcm(x.pcm) })); own.saved.set(r.id, own.byInstr[r.id]); } });
  } catch (e) { console.warn("own sound", e); return; }          // unreadable now: the old copy stays where it is
  /* the move from localStorage (3.8–3.9), and the very first format (one set, before instruments were told apart) */
  const moved = {};
  try { const j = JSON.parse(store.get("ownSamples2", "null")); if (j) Object.entries(j).forEach(([id, list]) => { if (!own.byInstr[id] && Array.isArray(list) && list.length) moved[id] = list.map(x => ({ midi: x.midi, rate: x.rate, ls: x.ls, le: x.le, data: unpackF32(x.b64) })); }); } catch (e) { console.warn(e); }
  try { const old = JSON.parse(store.get("ownSamples", "null")), id = mainInstr().id; if (Array.isArray(old) && old.length && !own.byInstr[id] && !moved[id]) moved[id] = old.map(x => ({ midi: x.midi, rate: x.rate, ls: x.ls, le: x.le, data: unpackF32(x.b64) })); } catch (e) { console.warn(e); }
  if (!DB.ok) { Object.entries(moved).forEach(([id, list]) => { own.byInstr[id] = list; own.saved.set(id, list); }); }   // they stay in localStorage
  else {
    Object.entries(moved).forEach(([id, list]) => { own.byInstr[id] = list; });
    if (Object.keys(moved).length && !(await saveOwnNow())) return;             // kept in localStorage for the next try
    store.del("ownSamples2"); store.del("ownSamples");
  }
  store.del("ownSound");
  if (typeof syncOwn === "function" && $("#own-list")) { try { syncOwn(); } catch (e) { console.warn(e); } }
})();
/* for the backup: the recordings as text; and back (an instrument already recorded on this device stays as it is) */
function ownExport() {
  const out = {}; Object.entries(own.byInstr).forEach(([id, list]) => { if (list && list.length) out[id] = list.map(x => ({ midi: x.midi, rate: x.rate, ls: x.ls, le: x.le, b64: packF32(x.data) })); });
  return out;
}
async function ownImport(sounds) {
  if (!sounds || typeof sounds !== "object") return 0;
  await own.ready;
  let n = 0;
  Object.entries(sounds).forEach(([id, list]) => {
    if (!INSTRUMENTS.some(i => i.id === id) || (own.byInstr[id] && own.byInstr[id].length) || !Array.isArray(list)) return;
    const ok = list.filter(x => x && [x.midi, x.rate, x.ls, x.le].every(Number.isFinite) && typeof x.b64 === "string" && x.b64.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(x.b64));
    if (!ok.length) return;
    try { own.byInstr[id] = ok.map(x => ({ midi: x.midi, rate: x.rate, ls: x.ls, le: x.le, data: unpackF32(x.b64) })); n++; } catch (e) { console.warn(e); }
  });
  if (n && !(await saveOwn())) return 0;
  if (n && typeof syncOwn === "function") { try { syncOwn(); } catch (e) { console.warn(e); } }
  return n;
}
/* ---------------- playback: the nearest anchor, shifted, looping its steady middle ---------------- */
function ownVoice(instrId) { const list = own.byInstr[instrId]; return list && list.length ? (ctx, out, f, st, en) => samplerNote(list, ctx, out, f, st, en) : null; }
function samplerNote(list, ctx, out, f, st, en) {
  const midi = 69 + 12 * Math.log2(f / 440);
  const smp = list.reduce((a, b) => Math.abs(b.midi - midi) < Math.abs(a.midi - midi) ? b : a);
  smp._b = smp._b || new WeakMap();
  let buf = smp._b.get(ctx); if (!buf) { buf = ctx.createBuffer(1, smp.data.length, smp.rate); buf.copyToChannel(smp.data, 0); smp._b.set(ctx, buf); }
  const s = ctx.createBufferSource(), g = ctx.createGain();
  s.buffer = buf; s.playbackRate.value = Math.pow(2, (midi - smp.midi) / 12);
  s.loop = true; s.loopStart = smp.ls; s.loopEnd = smp.le;
  g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(1, st + 0.005); g.gain.setTargetAtTime(0, en, 0.04);
  s.connect(g); g.connect(out); s.start(st); s.stop(en + 0.3);
}

/* ---------------- turning a captured stretch into a playable sample ---------------- */
function makeSample(raw, sr, targetMidi) {
  /* 24 kHz is plenty for a brass sound and halves the size */
  const k = Math.max(1, Math.round(sr / OWN_RATE)), n = Math.floor(raw.length / k), x = new Float32Array(n);
  for (let i = 0; i < n; i++) { let v = 0; for (let j = 0; j < k; j++) v += raw[i * k + j]; x[i] = v / k; }
  const rate = sr / k;
  /* the pitch as actually played (its small error is kept, so playback is tuned exactly) */
  const mid = Math.floor(n / 2), f = detectPitch(x.subarray(Math.max(0, mid - 2048), mid + 2048), rate, 30, 1500);
  let midi = f > 0 ? 69 + 12 * Math.log2(f / 440) : targetMidi;
  midi -= 12 * Math.round((midi - targetMidi) / 12);                 // an octave mistake of the detector is not the player's
  if (Math.abs(midi - targetMidi) > 1) midi = targetMidi;
  /* same loudness for every note: RMS to about −18 dBFS */
  let rms = 0; for (let i = 0; i < n; i++) rms += x[i] * x[i]; rms = Math.sqrt(rms / n) || 1;
  const g = 0.125 / rms; for (let i = 0; i < n; i++) x[i] = Math.max(-1, Math.min(1, x[i] * g));
  /* the loop: whole periods in the steady part, both ends on upward zero crossings, a 50 ms crossfade written in */
  const per = rate / (440 * Math.pow(2, (midi - 69) / 12)), want = Math.max(per * 4, rate * 0.45);
  const up = i => { while (i < n - 1 && !(x[i] <= 0 && x[i + 1] > 0)) i++; return i; };
  let ls = up(Math.floor(n * 0.35)), le = up(Math.floor(ls + Math.round(want / per) * per) - 2);
  if (le >= n - 2) le = up(Math.floor(n * 0.85));
  const fade = Math.min(Math.floor(rate * 0.05), Math.floor((le - ls) / 3));
  for (let i = 0; i < fade; i++) { const w = i / fade, a = Math.cos(w * Math.PI / 2), b = Math.sin(w * Math.PI / 2); x[le - fade + i] = x[le - fade + i] * a + x[ls - fade + i] * b; }
  return { midi, rate, data: x, ls: ls / rate, le: le / rate };
}

/* ---------------- the guided recording ---------------- */
const of = { instr: null, step: 0, targets: [], done: [], ctx: null, stream: null, proc: null, ring: null, rp: 0, sr: 48000, raf: 0, holdFrom: 0, reads: [], hint: "", state: "idle", last: null };
/* "Ja" → BRZMIENIA: one tile per recorded instrument (family colour, its initial, "Twoje brzmienie") and a dashed
   "+" tile. A tile opens a small sheet: listen, record again, use in playback, change instrument, delete. */
const WAVE = `<svg class="snd-wave" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 5v2M4.5 3v6M7 4v4M9.5 5.5v1"/></svg>`;
let ownSel = null;                               // the instrument whose sheet is open
function syncOwn() {
  const row = $("#own-list"); if (!row) return;
  const rec = Object.entries(own.byInstr).filter(([, l]) => l && l.length);
  row.innerHTML = rec.map(([id, l]) => {
    const m = instrById(id), h = typeof orbHueOfGroup === "function" ? orbHueOfGroup(m.group) : "slate";
    return `<button class="snd-tile" data-id="${id}" data-h="${h}" aria-label="${esc(m.name)}: Twoje brzmienie, ${l.length} ${plural(l.length, "dźwięk", "dźwięki", "dźwięków")}"><span class="snd-sq"><b>${esc(m.name.charAt(0))}</b>${WAVE}</span><span class="snd-name">${esc(m.name)}</span><small class="snd-st">Twoje brzmienie</small></button>`;
  }).join("") + `<button class="snd-tile add" data-add><span class="snd-sq">${icon("plus")}</span><span class="snd-name">Dodaj brzmienie</span></button>`;
  const st = $("#own-st"); if (st) { st.textContent = rec.length ? "" : "Nagraj 5 dźwięków, a Solo zagra Twoim brzmieniem."; st.hidden = !!rec.length; }
  const use = $("#own-use"); if (use) { use.disabled = !rec.length; use.checked = !!rec.length && store.get("ownUse") === "1"; }
}
$("#own-list").addEventListener("click", e => {
  const t = e.target.closest(".snd-tile"); if (!t) return;
  if (t.hasAttribute("data-add")) { if (typeof tuner !== "undefined" && tuner.on) tunerStop(true); openOwnFlow(firstUnrecorded()); return; }
  openOwnSheet(t.dataset.id);
});
/* "+" starts with the player's instrument that has no recording yet (else the main one) */
function firstUnrecorded() { const p = profile(); return [p.main, ...p.instruments].find(id => !(own.byInstr[id] && own.byInstr[id].length)) || p.main; }
function openOwnSheet(id) {
  ownSel = id; const l = own.byInstr[id] || [];
  $("#sh-own-t").textContent = instrById(id).name;
  $("#own-sheet-st").textContent = `Twoje brzmienie · ${l.length} ${plural(l.length, "dźwięk", "dźwięki", "dźwięków")}`;
  syncOwn(); openSheet("own");
}
$("#sh-own").addEventListener("click", e => {
  const b = e.target.closest("[data-own]"), id = ownSel; if (!b || !id) return;
  const act = b.dataset.own;
  if (act === "play") playScale(own.byInstr[id]);
  if (act === "again") closeSheetThen(() => openOwnFlow(id));
  if (act === "del") closeSheetThen(() => { const keep = own.byInstr[id]; delete own.byInstr[id]; ownSel = null; saveOwn(); syncOwn(); hudUndoOwn(id, keep); });
  if (act === "re") pickInstrument("Jaki instrument?", nid => { if (nid === id) return; const other = own.byInstr[nid]; own.byInstr[nid] = own.byInstr[id]; if (other) own.byInstr[id] = other; else delete own.byInstr[id]; /* two recordings swap, nothing is lost */ ownSel = null; saveOwn(); syncOwn();  });
});
function hudUndoOwn(id, list) {
  const b = document.createElement("button"); b.className = "toast-act"; b.textContent = "Cofnij";
  b.addEventListener("click", () => { own.byInstr[id] = list; saveOwn(); syncOwn(); $("#toast").classList.remove("show"); });
  $("#toast").appendChild(b);
}
/* any instrument, with search and "Twoje" first (the same picker as everywhere) */
let pickCb = null;
function pickInstrument(title, cb) { pickCb = cb; $("#sh-pick-t").textContent = title; openSheet("pick"); }
function buildPickSheet() { instrPicker($("#pick-box"), { onPick: id => { const f = pickCb; pickCb = null; closeSheetThen(() => f && f(id)); } }); }
$("#own-use").addEventListener("change", e => store.set("ownUse", e.target.checked ? "1" : "0"));
/* the orb of the recording screen (orb.js): the instrument's family colour, turning lime as the notes are captured */
function ownOrb() {
  if (!of.orb && typeof createOrb === "function" && $("#of-orb")) of.orb = createOrb($("#of-orb"), { hue: "brand", drift: "y" });
  if (of.orb) of.orb.setHue(orbHueOfGroup(instrById(of.instr || mainInstr().id).group), of.targets.length ? of.done.filter(Boolean).length / of.targets.length * 0.7 : 0);
  return of.orb;
}
function openOwnFlow(id) {
  of.instr = id && INSTRUMENTS.some(i => i.id === id) ? id : of.instr && profile().instruments.includes(of.instr) ? of.instr : mainInstr().id;
  of.targets = ownTargets(); of.done = of.targets.map(() => null); of.step = 0; of.state = "intro";
  $("#ownf").hidden = false; renderOwn();
}
async function closeOwnFlow() { stopListening(); cancelAnimationFrame(of.raf); if (of.orb) { of.orb.setLevel(0); of.orb.setTune(null); of.orb.setState("idle"); } fadeOut($("#ownf"), 220); syncOwn(); }
$("#ownf-x").addEventListener("click", closeOwnFlow);
$("#ownf-body").addEventListener("click", () => {
  if (of.ctx && of.ctx.state !== "running") of.ctx.resume();
  /* back in the app while recording: a tap listens again (never a permission prompt by itself) */
  if (of.tapToListen && of.state === "listen") { of.tapToListen = false; startListening().then(ok => { if (ok && of.state === "listen") { cancelAnimationFrame(of.raf); of.raf = requestAnimationFrame(listenLoop); } }); }
});
/* a second tap while the phone asks for the microphone waits for the same answer (no second context left open) */
function startListening() {
  if (of.stream) return Promise.resolve(true);
  return (of.starting = of.starting || openListening().finally(() => { of.starting = null; }));
}
async function openListening() {
  let m; try { m = await openMic(); } catch (e) { hud(micError(e), 4500); return false; }
  if ($("#ownf").hidden) { try { m.ctx.close(); } catch {} of.starting = null; releaseMic(); return false; }      // closed meanwhile
  of.stream = m.stream; of.ctx = m.ctx; const src0 = m.src;
  of.sr = of.ctx.sampleRate; of.ring = new Float32Array(Math.ceil(of.sr * 4)); of.rp = 0;
  const src = src0, proc = of.ctx.createScriptProcessor(2048, 1, 1), mute = of.ctx.createGain(); mute.gain.value = 0;
  proc.onaudioprocess = e => { const d = e.inputBuffer.getChannelData(0); for (let i = 0; i < d.length; i++) { of.ring[of.rp] = d[i]; of.rp = (of.rp + 1) % of.ring.length; } };
  src.connect(proc); proc.connect(mute); mute.connect(of.ctx.destination); of.proc = proc;
  return true;
}
function stopListening() {
  try { of.proc && of.proc.disconnect(); } catch {} try { of.ctx && of.ctx.close(); } catch {}
  of.proc = of.stream = of.ctx = null; releaseMic();
}
/* the last `sec` seconds from the rolling buffer */
function lastAudio(sec, reuse) { const n = Math.min(of.ring.length, Math.floor(sec * of.sr)), out = reuse && reuse.length === n ? reuse : new Float32Array(n); for (let i = 0; i < n; i++) out[i] = of.ring[(of.rp - n + i + of.ring.length) % of.ring.length]; return out; }
function listenLoop(t) {
  if (of.state !== "listen") return;
  of.raf = requestAnimationFrame(listenLoop);
  if (t - (of.lastT || 0) < 33) return; of.lastT = t;
  if (!of.stream) { drawRing(0, null, of.tapToListen ? "Dotknij, żeby słuchać" : "Włączam mikrofon…"); return; }      // the microphone is off (the app was left)
  if (of.ctx && of.ctx.state !== "running") { of.ctx.resume().catch(() => {}); drawRing(0, null, "Dotknij, żeby włączyć"); return; }
  const target = of.targets[of.step], buf = (of.lbuf = lastAudio(0.09, of.lbuf));      // one buffer reused 30 times a second
  let peak = 0, sq = 0; for (let i = 0; i < buf.length; i++) { const v = buf[i]; sq += v * v; if (v > peak) peak = v; else if (-v > peak) peak = -v; }
  /* loudness for the orb: RMS in dB, −60 dB → 0, −10 dB → 1 */
  const lvl = Math.min(1, Math.max(0, (20 * Math.log10(Math.sqrt(sq / buf.length) + 1e-9) + 60) / 50));
  const f = detectPitch(buf.length >= 4096 ? buf.subarray(buf.length - 4096) : buf, of.sr, 30, 1500), ok = f > 0 && detectPitch.clarity > 0.88;
  let cents = null, hint = "Zagraj i trzymaj", played = null;
  if (peak > 0.97) hint = "Za głośno, odsuń telefon";
  else if (ok) {
    /* the tuner: what is being played. The octave does not count (a phone mic often hears a low
       trombone note an octave up), the step does. */
    const midi = 69 + 12 * Math.log2(f / tuner.a4), near = Math.round(midi), d = midi - target, dm = d - 12 * Math.round(d / 12);
    played = { midi: near, c: (midi - near) * 100 };
    if (Math.abs(dm) > 0.5) { const l = noteLabel(near), want = noteLabel(target); hint = `Grasz ${l.name}. Zagraj ${want.name}`; }
    else { cents = dm * 100; hint = Math.abs(cents) <= OWN_TOL ? "Trzymaj…" : cents > 0 ? "Trochę niżej" : "Trochę wyżej"; }
  }
  /* the ring fills while the note stays clean and steady; it empties as soon as it wobbles */
  if (cents !== null && Math.abs(cents) <= OWN_TOL) { of.reads.push(cents); if (!of.holdFrom) of.holdFrom = t; }
  else { of.holdFrom = 0; of.reads = []; }
  if (of.reads.length > 8) { const m = of.reads.reduce((a, b) => a + b, 0) / of.reads.length, sd = Math.sqrt(of.reads.reduce((a, b) => a + (b - m) ** 2, 0) / of.reads.length); if (sd > 8) { of.holdFrom = t; of.reads = of.reads.slice(-3); } }
  const prog = of.holdFrom ? Math.min(1, (t - of.holdFrom) / OWN_HOLD) : 0;
  drawRing(prog, cents, hint, played, lvl);
  if (prog >= 1) capture();
}
function capture() {
  of.state = "got";
  const smp = makeSample(lastAudio(OWN_HOLD / 1000 + 0.15), of.sr, of.targets[of.step]);
  of.done[of.step] = smp; of.pop = of.step;
  if (of.orb) of.orb.pulse();
  try { navigator.vibrate && navigator.vibrate(12); } catch {}
  renderOwn();
}
/* after a note: the next one not recorded yet (notes already recorded are never asked again), else the summary */
function goNextMissing() {
  const n = of.targets.length; let i = of.step + 1;
  while (i < n && of.done[i]) i++;
  if (i < n && !of.revisit) { of.step = i; of.state = "listen"; } else { of.state = "sum"; of.revisit = false; stopListening(); }
  renderOwn();
}
/* one listening frame: the hold ring, the orb (level, lean towards the target, green when clean), one hint line */
function drawRing(prog, cents, hint, played, lvl = 0) {
  const r = $("#of-ring"); if (!r) return;
  r.style.strokeDashoffset = String(691 * (1 - prog));
  const state = !played ? "off" : cents === null ? "far" : Math.abs(cents) <= OWN_TOL ? "ok" : Math.abs(cents) <= 30 ? "near" : "far";
  const stage = $("#of-stage"); if (stage.dataset.st !== state) stage.dataset.st = state;
  if (of.orb) {
    of.orb.setLevel(lvl); of.orb.setTune(cents);
    of.orb.setState(state === "off" ? (lvl > 0.08 ? "listening" : "idle") : state === "ok" ? "ok" : state === "near" ? "listening" : "far");
  }
  const h = $("#of-hint"); if (h && h.textContent !== hint) h.textContent = hint;
}
/* ---------------- screens: one function each, centred around the orb ---------------- */
function renderOwn() {
  const head = $("#of-head"), foot = $("#of-foot"), stage = $("#of-stage"), acts = $("#ownf-acts"), n = of.targets.length, m = instrById(of.instr || mainInstr().id);
  const got = of.done.filter(Boolean).length, listening = of.state === "listen" || of.state === "got";
  $("#ownf").dataset.st = of.state;
  $("#ownf-dots").innerHTML = of.targets.map((_, i) => `<i class="${listening && i === of.step && !of.done[i] ? "on" : of.done[i] ? "done" : ""}${of.pop === i ? " pop" : ""}">${of.done[i] ? icon("check") : ""}</i>`).join("");
  of.pop = -1;
  $("#ownf-count").textContent = listening ? `${of.step + 1} z ${n}` : of.state === "sum" ? `${got} z ${n}` : "";
  stage.hidden = of.state === "sum"; stage.classList.remove("small");
  ownOrb();
  if (of.orb) { of.orb.setLevel(0); of.orb.setTune(null); of.orb.setState(of.state === "got" ? "ok" : "idle"); }
  $("#of-ring").style.strokeDashoffset = of.state === "got" ? "0" : "691";
  $("#of-note").innerHTML = of.state === "got" ? icon("check") : "";
  if (of.state === "intro") {
    /* which instrument: yours first, "+" opens every instrument (search, families) right here */
    const mine = [...new Set([...profile().instruments, of.instr])], has = own.byInstr[of.instr];
    head.innerHTML = `<p class="lx-kicker">Twoje brzmienie</p><h1 class="lx-title">${esc(m.name)}</h1>`;
    foot.innerHTML = `<div class="ichips of-instr">${mine.map(id => `<button class="ichip" data-oi="${id}" aria-pressed="${id === of.instr}">${esc(instrById(id).name)}</button>`).join("")}<button class="ichip" data-more aria-label="Inny instrument">${icon("plus")}</button></div>
      <div id="of-picker" class="of-picker" hidden></div>
      <p class="lx-lead">${n} dźwięków · cichy pokój · telefon metr od instrumentu</p>${has ? `<p class="lx-note">Nowe nagranie zastąpi obecne.</p>` : ""}`;
    const setI = id => { of.instr = id; of.targets = ownTargets(); of.done = of.targets.map(() => null); renderOwn(); };
    foot.querySelectorAll("[data-oi]").forEach(b => b.addEventListener("click", () => setI(b.dataset.oi)));
    foot.querySelector("[data-more]").addEventListener("click", () => { const pk = $("#of-picker"); pk.hidden = !pk.hidden; stage.classList.toggle("small", !pk.hidden); if (!pk.hidden) instrPicker(pk, { onPick: id => setI(id) }); });
    acts.innerHTML = `<button class="btn primary wide" id="of-go">${icon("mic")}<span>Zaczynamy</span></button>`;
    $("#of-go").addEventListener("click", async () => { if (!(await startListening())) return; of.state = "listen"; renderOwn(); });
  } else if (listening) {
    const tg = of.targets[of.step], l = noteLabel(tg), pos = m.id === "puzon" && POS_PUZON[tg] ? POS_PUZON[tg] : "";
    head.innerHTML = `<p class="lx-kicker">${of.state === "got" ? "Mamy to" : "Zagraj"}</p><p class="lx-target"><b>${l.name}</b></p><p class="lx-sub">${esc([l.oct ? `oktawa ${l.oct}` : "", pos].filter(Boolean).join(" · "))}</p>`;
    foot.innerHTML = `<p class="of-hint" id="of-hint" aria-live="polite">${of.state === "got" ? "Czysto!" : "Zagraj i trzymaj"}</p>`;
    stage.dataset.st = of.state === "got" ? "ok" : "off";
    if (of.state === "got") {
      acts.innerHTML = `<div class="of-row"><button class="btn tinted" id="of-again">${icon("undo")}<span>Jeszcze raz</span></button><button class="btn tinted" id="of-hear">${icon("play")}<span>Posłuchaj</span></button></div><button class="btn primary wide" id="of-next"><span>${of.step + 1 < n ? "Dalej" : "Gotowe"}</span></button>`;
      $("#of-again").addEventListener("click", () => { of.done[of.step] = null; of.holdFrom = 0; of.reads = []; of.state = "listen"; renderOwn(); });
      $("#of-hear").addEventListener("click", () => hearSample(of.done[of.step]));
      $("#of-next").addEventListener("click", () => { of.holdFrom = 0; of.reads = []; goNextMissing(); });
    } else {
      acts.innerHTML = `<button class="btn ghost wide" id="of-skip"><span>Pomiń ten dźwięk</span></button>`;
      $("#of-skip").addEventListener("click", () => { of.holdFrom = 0; of.reads = []; goNextMissing(); });
      cancelAnimationFrame(of.raf); of.raf = requestAnimationFrame(listenLoop);
    }
  } else if (of.state === "sum") {
    head.innerHTML = `<p class="lx-kicker">${esc(m.name)}</p><h1 class="lx-title">${got ? "Gotowe" : "Nic nie nagrano"}</h1>`;
    foot.innerHTML = `<div class="of-tiles">${of.targets.map((tg, i) => { const l = noteLabel(tg); return `<button class="of-tile${of.done[i] ? " ok" : ""}" data-i="${i}" aria-label="${esc(l.name)}${of.done[i] ? ", nagrany" : ", brak"}. Nagraj jeszcze raz"><b>${l.name}</b><small>${of.done[i] ? icon("check") : "–"}</small></button>`; }).join("")}</div>
      <p class="lx-note">Dotknij dźwięku, żeby nagrać go jeszcze raz.</p>`;
    acts.innerHTML = got ? `<div class="of-row one"><button class="btn tinted" id="of-scale">${icon("play")}<span>Posłuchaj gamy</span></button></div><button class="btn primary wide" id="of-save"><span>Zapisz brzmienie</span></button>` : `<button class="btn primary wide" id="of-close"><span>Zamknij</span></button>`;
    foot.querySelectorAll(".of-tile").forEach(b => b.addEventListener("click", async () => { if (!(await startListening())) return; of.step = +b.dataset.i; of.revisit = true; of.state = "listen"; renderOwn(); }));
    if (got) {
      $("#of-scale").addEventListener("click", () => playScale(of.done.filter(Boolean)));
      $("#of-save").addEventListener("click", () => { own.byInstr[of.instr] = of.done.filter(Boolean).sort((a, b) => a.midi - b.midi); store.set("ownUse", "1"); closeOwnFlow(); saveOwn(); });   // said only once it is stored
    } else $("#of-close").addEventListener("click", closeOwnFlow);
  }
}
/* listening back: one note, or a major scale over the recorded notes */
/* the shared audio context (fxCtx in app.js), not a new one per tap: iOS allows only a few */
function hearOut() {
  const ctx = fxCtx(), out = ctx.createGain(); out.gain.value = 0.5; out.connect(ctx.destination); return { ctx, out };
}
function hearSample(smp) {
  const { ctx, out } = hearOut();
  samplerNote([smp], ctx, out, 440 * Math.pow(2, (Math.round(smp.midi) - 69) / 12), ctx.currentTime + 0.05, ctx.currentTime + 1.2);
  setTimeout(() => { try { out.disconnect(); } catch {} }, 1800);
}
function playScale(list) {
  if (!list || !list.length) return;
  const { ctx, out } = hearOut();
  const lo = Math.round(Math.min(...list.map(x => x.midi))), steps = [0, 2, 4, 5, 7, 9, 11, 12], t0 = ctx.currentTime + 0.1;
  steps.forEach((s, i) => samplerNote(list, ctx, out, 440 * Math.pow(2, (lo + 5 + s - 69) / 12), t0 + i * 0.42, t0 + i * 0.42 + 0.38));
  setTimeout(() => { try { out.disconnect(); } catch {} }, 4500);
}
syncOwn();
