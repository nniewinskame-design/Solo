/* Solo: "Twój dźwięk", playback with the player's own instrument (benchmark: Logic Auto Sampler / Quick Sampler,
   GarageBand Sampler, Face ID enrolment ring, TonalEnergy). Not every note is needed: five anchor notes a fourth
   or fifth apart, so no note is shifted by more than about 3–4 semitones (beyond that a recording starts to sound
   unnatural). Each note is guided by the tuner and captured by itself once it is clean and steady for 1.5 s.
   The steady middle is looped seamlessly (whole periods, ends on zero crossings, a crossfade baked in). */
"use strict";

const own = { samples: [] };          // { midi (float, measured), rate, data: Float32Array, ls, le } per anchor note
const OWN_HOLD = 1500, OWN_TOL = 15, OWN_RATE = 24000;
/* the anchor notes (sounding MIDI): trombones on open first-position notes, others spread over their range */
function ownTargets() {
  const m = mainInstr();
  if (["puzon", "puzon-alt", "eufonium", "baryton"].includes(m.id)) return [41, 46, 53, 58, 65];       // F, B, f, b, f1
  if (m.id === "puzon-b" || m.id === "tuba" || m.id === "suzafon") return [m.lo + 3, m.lo + 8, m.lo + 15, m.lo + 20, m.lo + 27];
  const lo = m.lo + 3, hi = m.hi - 8, step = (hi - lo) / 4;
  return [0, 1, 2, 3, 4].map(i => Math.round(lo + i * step));
}
const POS_PUZON = { 41: "6. pozycja", 46: "1. pozycja", 53: "1. pozycja", 58: "1. pozycja", 65: "1. pozycja" };
function noteLabel(midi) { const w = midi + (tuner.tr || 0), oct = Math.floor(w / 12) - 1; return { name: NOTE_PL[((w % 12) + 12) % 12], oct: OCTAVE_NAMES[oct] || "" }; }

/* ---------------- storage: 16-bit, 24 kHz, in IndexedDB-free localStorage (five short notes ≈ 0.5 MB) ---------------- */
function packF32(f) { const i16 = Int16Array.from(f, v => Math.max(-32767, Math.min(32767, Math.round(v * 32767)))); let s = ""; const u8 = new Uint8Array(i16.buffer); for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); }
function unpackF32(b64) { const bin = atob(b64), a = new Int16Array(bin.length / 2); for (let i = 0; i < a.length; i++) a[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); return Float32Array.from(a, v => v / 32767); }
function saveOwn() {
  try { store.set("ownSamples", JSON.stringify(own.samples.map(x => ({ midi: x.midi, rate: x.rate, ls: x.ls, le: x.le, b64: packF32(x.data) })))); }
  catch { hud("Za mało miejsca, żeby zapisać dźwięk", 3000); }
}
(function loadOwn() {
  try { const j = JSON.parse(store.get("ownSamples", "null")); if (Array.isArray(j)) own.samples = j.map(x => ({ ...x, data: unpackF32(x.b64) })); } catch {}
  try { localStorage.removeItem("solo:ownSound"); } catch {}          // the old one-note recording
})();

/* ---------------- playback: the nearest anchor, shifted, looping its steady middle ---------------- */
function ownNote(ctx, out, f, st, en) {
  const midi = 69 + 12 * Math.log2(f / 440);
  const smp = own.samples.reduce((a, b) => Math.abs(b.midi - midi) < Math.abs(a.midi - midi) ? b : a);
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
  let midi = f > 0 ? 69 + 12 * Math.log2(f / 440) : targetMidi; if (Math.abs(midi - targetMidi) > 1.5) midi = targetMidi;
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
const of = { step: 0, targets: [], done: [], ctx: null, stream: null, proc: null, ring: null, rp: 0, sr: 48000, raf: 0, holdFrom: 0, reads: [], hint: "", state: "idle", last: null };
function syncOwn() {
  const n = own.samples.length;
  $("#own-st").textContent = n ? `${n} ${plural(n, "dźwięk", "dźwięki", "dźwięków")} nagrane` : "Nagraj kilka dźwięków swojego instrumentu";
  $("#own-rec span").textContent = n ? "Nagraj od nowa" : "Nagraj";
  $("#own-play").hidden = !n; $("#own-use").disabled = !n; $("#own-use").checked = !!n && store.get("ownUse") === "1";
}
$("#own-use").addEventListener("change", e => store.set("ownUse", e.target.checked ? "1" : "0"));
$("#own-rec").addEventListener("click", () => { if (tuner.on) tunerStop(); openOwnFlow(); });
$("#own-play").addEventListener("click", () => playScale());
function openOwnFlow() {
  of.targets = ownTargets(); of.done = of.targets.map(() => null); of.step = 0; of.state = "intro";
  $("#ownf").hidden = false; renderOwn();
}
async function closeOwnFlow() { stopListening(); cancelAnimationFrame(of.raf); fadeOut($("#ownf"), 220); syncOwn(); }
$("#ownf-x").addEventListener("click", closeOwnFlow);
$("#ownf-body").addEventListener("click", () => { if (of.ctx && of.ctx.state !== "running") of.ctx.resume(); });
async function startListening() {
  if (of.stream) return true;
  let m; try { m = await openMic(); } catch (e) { hud(micError(e), 4500); return false; }
  of.stream = m.stream; of.ctx = m.ctx; const src0 = m.src;
  of.sr = of.ctx.sampleRate; of.ring = new Float32Array(Math.ceil(of.sr * 4)); of.rp = 0;
  const src = src0, proc = of.ctx.createScriptProcessor(2048, 1, 1), mute = of.ctx.createGain(); mute.gain.value = 0;
  proc.onaudioprocess = e => { const d = e.inputBuffer.getChannelData(0); for (let i = 0; i < d.length; i++) { of.ring[of.rp] = d[i]; of.rp = (of.rp + 1) % of.ring.length; } };
  src.connect(proc); proc.connect(mute); mute.connect(of.ctx.destination); of.proc = proc;
  return true;
}
function stopListening() {
  try { of.proc && of.proc.disconnect(); } catch {} try { of.stream && of.stream.getTracks().forEach(t => t.stop()); } catch {} try { of.ctx && of.ctx.close(); } catch {}
  of.proc = of.stream = of.ctx = null;
}
/* the last `sec` seconds from the rolling buffer */
function lastAudio(sec) { const n = Math.min(of.ring.length, Math.floor(sec * of.sr)), out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = of.ring[(of.rp - n + i + of.ring.length) % of.ring.length]; return out; }
function listenLoop(t) {
  if (of.state !== "listen") return;
  of.raf = requestAnimationFrame(listenLoop);
  if (t - (of.lastT || 0) < 33) return; of.lastT = t;
  if (of.ctx && of.ctx.state !== "running") { of.ctx.resume().catch(() => {}); drawRing(0, null, "Dotknij, żeby włączyć"); return; }
  const target = of.targets[of.step], buf = lastAudio(0.09);
  let peak = 0; for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const f = detectPitch(buf.length >= 4096 ? buf.subarray(buf.length - 4096) : buf, of.sr, 30, 1500), ok = f > 0 && detectPitch.clarity > 0.88;
  let cents = null, hint = "Zagraj i trzymaj";
  if (peak > 0.97) hint = "Za głośno, odsuń telefon";
  else if (ok) {
    const midi = 69 + 12 * Math.log2(f / tuner.a4), d = midi - target;
    if (Math.abs(d) > 0.6) { const l = noteLabel(Math.round(midi)), want = noteLabel(target); hint = `To ${l.name}. Zagraj ${want.name}`; }
    else { cents = d * 100; hint = Math.abs(cents) <= OWN_TOL ? "Trzymaj…" : cents > 0 ? "Trochę za wysoko" : "Trochę za nisko"; }
  }
  /* the ring fills while the note stays clean and steady; it empties as soon as it wobbles */
  if (cents !== null && Math.abs(cents) <= OWN_TOL) { of.reads.push(cents); if (!of.holdFrom) of.holdFrom = t; }
  else { of.holdFrom = 0; of.reads = []; }
  if (of.reads.length > 8) { const m = of.reads.reduce((a, b) => a + b, 0) / of.reads.length, sd = Math.sqrt(of.reads.reduce((a, b) => a + (b - m) ** 2, 0) / of.reads.length); if (sd > 8) { of.holdFrom = t; of.reads = of.reads.slice(-3); } }
  const prog = of.holdFrom ? Math.min(1, (t - of.holdFrom) / OWN_HOLD) : 0;
  drawRing(prog, cents, hint);
  if (prog >= 1) capture();
}
function capture() {
  of.state = "got"; navigator.vibrate?.(15);
  const smp = makeSample(lastAudio(OWN_HOLD / 1000 + 0.15), of.sr, of.targets[of.step]);
  of.done[of.step] = smp; renderOwn();
}
function drawRing(prog, cents, hint) {
  const r = $("#of-ring"); if (!r) return;
  r.style.strokeDashoffset = String(691 * (1 - prog));
  const dot = $("#of-dot"), state = cents === null ? "off" : Math.abs(cents) <= OWN_TOL ? "ok" : Math.abs(cents) <= 30 ? "near" : "far";
  $("#of-note").dataset.st = state;
  if (dot) dot.style.transform = `translateX(${cents === null ? 0 : Math.max(-50, Math.min(50, cents)) * 1.2}px)`;
  $("#of-hint").textContent = hint;
}
/* ---------------- screens ---------------- */
function renderOwn() {
  const body = $("#ownf-body"), acts = $("#ownf-acts"), n = of.targets.length, m = mainInstr();
  $("#ownf-dots").innerHTML = of.targets.map((_, i) => `<i class="${of.state !== "intro" && of.state !== "sum" && i === of.step ? "on" : of.done[i] ? "done" : ""}"></i>`).join("");
  if (of.state === "intro") {
    body.innerHTML = `<div class="of-hero">${icon("mic")}</div><h1 class="h-xl">Twój ${esc(m.name.toLowerCase())}</h1><p class="onb-lead">${n} dźwięków · cichy pokój · telefon metr od instrumentu</p>`;
    acts.innerHTML = `<button class="btn primary wide" id="of-go"><span>Zaczynamy</span></button>`;
    $("#of-go").addEventListener("click", async () => { if (!(await startListening())) return; of.state = "listen"; renderOwn(); });
  } else if (of.state === "listen" || of.state === "got") {
    const tg = of.targets[of.step], l = noteLabel(tg), pos = m.id.startsWith("puzon") && POS_PUZON[tg] ? POS_PUZON[tg] : "";
    body.innerHTML = `<p class="of-step">${of.step + 1} z ${n}</p>
      <div class="of-ringbox"><svg viewBox="0 0 240 240" class="of-svg"><circle cx="120" cy="120" r="110" class="of-track"/><circle cx="120" cy="120" r="110" class="of-fill" id="of-ring" style="stroke-dasharray:691;stroke-dashoffset:${of.state === "got" ? 0 : 691}"/></svg>
        <div class="of-note" id="of-note" data-st="${of.state === "got" ? "ok" : "off"}">${of.state === "got" ? icon("check") : `<b>${l.name}</b><span>${esc(l.oct)}</span>`}</div></div>
      <div class="of-meter"><i class="of-zone"></i><i class="of-dot" id="of-dot"></i></div>
      <p class="of-hint" id="of-hint">${of.state === "got" ? "Czysto!" : "Zagraj i trzymaj"}</p>${pos && of.state !== "got" ? `<p class="of-pos">${pos}</p>` : ""}`;
    if (of.state === "got") {
      acts.innerHTML = `<div class="of-row"><button class="btn tinted" id="of-again">${icon("undo")}<span>Jeszcze raz</span></button><button class="btn tinted" id="of-hear">${icon("play")}<span>Posłuchaj</span></button></div><button class="btn primary wide" id="of-next"><span>${of.step + 1 < n ? "Dalej" : "Gotowe"}</span></button>`;
      $("#of-again").addEventListener("click", () => { of.done[of.step] = null; of.holdFrom = 0; of.reads = []; of.state = "listen"; renderOwn(); });
      $("#of-hear").addEventListener("click", () => hearSample(of.done[of.step]));
      $("#of-next").addEventListener("click", () => { of.holdFrom = 0; of.reads = []; if (of.step + 1 < n) { of.step++; of.state = "listen"; } else { of.state = "sum"; stopListening(); } renderOwn(); });
    } else {
      acts.innerHTML = `<button class="btn ghost wide" id="of-skip"><span>Pomiń ten dźwięk</span></button>`;
      $("#of-skip").addEventListener("click", () => { of.holdFrom = 0; of.reads = []; if (of.step + 1 < n) of.step++; else { of.state = "sum"; stopListening(); } renderOwn(); });
      cancelAnimationFrame(of.raf); of.raf = requestAnimationFrame(listenLoop);
    }
  } else if (of.state === "sum") {
    const got = of.done.filter(Boolean).length;
    body.innerHTML = `<h1 class="h-l">${got ? "Gotowe" : "Nic nie nagrano"}</h1>
      <div class="of-tiles">${of.targets.map((tg, i) => { const l = noteLabel(tg); return `<button class="of-tile${of.done[i] ? " ok" : ""}" data-i="${i}"><b>${l.name}</b><small>${of.done[i] ? icon("check") : "–"}</small></button>`; }).join("")}</div>
      <p class="note">Dotknij dźwięku, żeby nagrać go jeszcze raz.</p>`;
    acts.innerHTML = got ? `<div class="of-row"><button class="btn tinted" id="of-scale">${icon("play")}<span>Posłuchaj gamy</span></button></div><button class="btn primary wide" id="of-save"><span>Zapisz mój dźwięk</span></button>` : `<button class="btn primary wide" id="of-close"><span>Zamknij</span></button>`;
    body.querySelectorAll(".of-tile").forEach(b => b.addEventListener("click", async () => { if (!(await startListening())) return; of.step = +b.dataset.i; of.state = "listen"; renderOwn(); }));
    if (got) {
      $("#of-scale").addEventListener("click", () => playScale(of.done.filter(Boolean)));
      $("#of-save").addEventListener("click", () => { own.samples = of.done.filter(Boolean).sort((a, b) => a.midi - b.midi); saveOwn(); store.set("ownUse", "1"); closeOwnFlow(); hud("Solo zagra Twoim dźwiękiem", 2500); });
    } else $("#of-close").addEventListener("click", closeOwnFlow);
  }
}
/* listening back: one note, or a B♭ major scale over the recorded notes */
function withSamples(list, fn) { const keep = own.samples; own.samples = list; try { fn(); } finally { own.samples = keep; } }
function hearSample(smp) {
  const AC = window.AudioContext || window.webkitAudioContext, ctx = new AC(), out = ctx.createGain(); out.gain.value = 0.5; out.connect(ctx.destination);
  withSamples([smp], () => ownNote(ctx, out, 440 * Math.pow(2, (Math.round(smp.midi) - 69) / 12), ctx.currentTime + 0.05, ctx.currentTime + 1.2));
  setTimeout(() => ctx.close(), 1800);
}
function playScale(list = own.samples) {
  if (!list.length) return;
  const AC = window.AudioContext || window.webkitAudioContext, ctx = new AC(), out = ctx.createGain(); out.gain.value = 0.5; out.connect(ctx.destination);
  const lo = Math.round(Math.min(...list.map(x => x.midi))), base = lo + ((46 - lo) % 12 + 12) % 12 - (((46 - lo) % 12 + 12) % 12 > 6 ? 12 : 0);
  const steps = [0, 2, 4, 5, 7, 9, 11, 12], t0 = ctx.currentTime + 0.1;
  withSamples(list, () => steps.forEach((s, i) => ownNote(ctx, out, 440 * Math.pow(2, (Math.max(lo, base) + s - 69) / 12), t0 + i * 0.42, t0 + i * 0.42 + 0.38)));
  setTimeout(() => ctx.close(), 4500);
}
syncOwn();
