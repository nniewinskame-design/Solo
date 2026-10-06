/* Solo: the player's profile. A few questions on the first start (benchmark: SmartMusic, Tonestro, TonalEnergy,
   Newzik, NN/g onboarding), each skippable, all editable later in Ustawienia → Profil. The answers become the
   defaults: tuner transposition and A, the instrument, clef and tempo of a new melody, the playback sound.
   The microphone is asked for only when it is needed (tuner, own sound), never here. */
"use strict";

/* clef as Solo names it; tr = semitones from the sounding note to the written one (B♭ trumpet: +2);
   lo/hi = practical sounding range (MIDI); voice = playback timbre */
const INSTRUMENTS = [
  { id: "puzon", name: "Puzon", clef: "bass", tr: 0, lo: 40, hi: 77, voice: "brass", group: "Blaszane" },
  { id: "puzon-b", name: "Puzon basowy", clef: "bass", tr: 0, lo: 34, hi: 70, voice: "brass", group: "Blaszane" },
  { id: "trabka", name: "Trąbka B", clef: "treble", tr: 2, lo: 52, hi: 82, voice: "brass", group: "Blaszane" },
  { id: "kornet", name: "Kornet B", clef: "treble", tr: 2, lo: 52, hi: 82, voice: "brass", group: "Blaszane" },
  { id: "eufonium", name: "Eufonium, baryton", clef: "bass", tr: 0, lo: 40, hi: 74, voice: "brass", group: "Blaszane" },
  { id: "tuba", name: "Tuba", clef: "bass", tr: 0, lo: 26, hi: 65, voice: "brass", group: "Blaszane" },
  { id: "waltornia", name: "Waltornia F", clef: "treble", tr: 7, lo: 35, hi: 77, voice: "brass", group: "Blaszane" },
  { id: "klarnet", name: "Klarnet B", clef: "treble", tr: 2, lo: 50, hi: 94, voice: "reed", group: "Drewniane" },
  { id: "sax-a", name: "Saksofon altowy Es", clef: "treble", tr: 9, lo: 49, hi: 80, voice: "reed", group: "Drewniane" },
  { id: "sax-t", name: "Saksofon tenorowy B", clef: "treble", tr: 14, lo: 44, hi: 75, voice: "reed", group: "Drewniane" },
  { id: "flet", name: "Flet", clef: "treble", tr: 0, lo: 60, hi: 96, voice: "flute", group: "Drewniane" },
  { id: "oboj", name: "Obój", clef: "treble", tr: 0, lo: 58, hi: 93, voice: "reed", group: "Drewniane" },
  { id: "skrzypce", name: "Skrzypce", clef: "treble", tr: 0, lo: 55, hi: 100, voice: "string", group: "Inne" },
  { id: "wiolonczela", name: "Wiolonczela", clef: "bass", tr: 0, lo: 36, hi: 81, voice: "string", group: "Inne" },
  { id: "fortepian", name: "Fortepian", clef: "treble", tr: 0, lo: 21, hi: 108, voice: "piano", group: "Inne" },
  { id: "glos", name: "Głos", clef: "treble", tr: 0, lo: 48, hi: 81, voice: "voice", group: "Inne" }
];
const instrById = id => INSTRUMENTS.find(i => i.id === id) || INSTRUMENTS[0];
const PROFILE_DEFAULT = { instruments: ["puzon"], main: "puzon", reading: "written", role: "", a4: 440, done: false };
function profile() {
  let p = null; try { p = JSON.parse(store.get("profile", "null")); } catch {}
  return { ...PROFILE_DEFAULT, ...(p || {}) };
}
function saveProfile(p) { store.set("profile", JSON.stringify(p)); applyProfile(); }
const mainInstr = () => instrById(profile().main);
/* what the tuner shows: the written note for a transposing instrument (as the player reads it) */
function applyProfile() {
  const p = profile(), m = instrById(p.main);
  if (store.get("tunerTr") == null || p.done) { tuner.tr = p.reading === "written" ? m.tr % 12 : 0; }
  tuner.a4 = p.a4 || 440;
  const s = $("#prof-sum"); if (s) s.textContent = profileSummary();
}
function profileSummary(p = profile()) {
  const m = instrById(p.main), more = p.instruments.filter(i => i !== p.main).map(i => instrById(i).name);
  const role = { teacher: "uczę", student: "uczę się", self: "gram dla siebie" }[p.role];
  return [m.name + (more.length ? ` (+ ${more.join(", ")})` : ""), m.tr ? (p.reading === "written" ? "nuty dla instrumentu" : "dźwięki rzeczywiste") : "", role, `A = ${p.a4} Hz`].filter(Boolean).join(" · ");
}

/* ---------------- onboarding: one question per screen, big tiles, always "Pomiń" ---------------- */
const onb = { step: 0, p: null };
const ONB_STEPS = ["hello", "instr", "main", "reading", "role", "done"];
function openOnboarding() {
  onb.p = profile(); onb.p.instruments = [...onb.p.instruments]; onb.step = 0;
  $("#onb").hidden = false; renderOnb();
}
function onbSkipStep(name) {
  const p = onb.p;
  if (name === "main") return p.instruments.length < 2;
  if (name === "reading") return !instrById(p.main).tr;
  return false;
}
function onbGo(d) {
  let s = onb.step + d;
  while (s > 0 && s < ONB_STEPS.length - 1 && onbSkipStep(ONB_STEPS[s])) s += d;
  onb.step = Math.max(0, Math.min(ONB_STEPS.length - 1, s)); renderOnb();
}
function finishOnb(skipped) {
  const p = skipped && !onb.p.done ? { ...PROFILE_DEFAULT, done: true } : { ...onb.p, done: true };
  if (!p.instruments.includes(p.main)) p.main = p.instruments[0] || "puzon";
  saveProfile(p); store.set("welcomed", "1");
  fadeOut($("#onb"), 220);
}
function tile(on, label, data, extra = "") { return `<button class="onb-tile${on ? " on" : ""}" ${data} aria-pressed="${on}">${extra}<span>${esc(label)}</span></button>`; }
function renderOnb() {
  const p = onb.p, name = ONB_STEPS[onb.step], box = $("#onb-body");
  $("#onb-back").hidden = onb.step === 0;
  $("#onb-dots").innerHTML = ONB_STEPS.map((_, i) => `<i class="${i === onb.step ? "on" : ""}"></i>`).join("");
  let h = "", next = "Dalej";
  if (name === "hello") {
    h = `<div class="onb-brand"><svg class="mark"><use href="#note"/></svg><span>Solo</span></div>
      <h1 class="h-xl">Kilka pytań na start</h1>
      <p class="onb-lead">Solo ustawi się pod Ciebie. Wszystko zmienisz później w zakładce „Ty”.</p>
      <p class="w-legal">Korzystając z Solo, akceptujesz <a href="regulamin.html">regulamin</a> i&nbsp;<a href="prywatnosc.html">politykę&nbsp;prywatności</a>.</p>`;
    next = "Zaczynamy";
  } else if (name === "instr") {
    h = `<h2 class="h-l">Na czym grasz?</h2><p class="onb-lead">Możesz zaznaczyć kilka.</p>` +
      ["Blaszane", "Drewniane", "Inne"].map(g => `<h3 class="lbl">${g}</h3><div class="onb-grid">` +
        INSTRUMENTS.filter(i => i.group === g).map(i => tile(p.instruments.includes(i.id), i.name, `data-instr="${i.id}"`)).join("") + `</div>`).join("");
  } else if (name === "main") {
    h = `<h2 class="h-l">Główny instrument?</h2><p class="onb-lead">Na nim Solo będzie grać i według niego stroić.</p><div class="onb-grid one">` +
      p.instruments.map(id => tile(p.main === id, instrById(id).name, `data-main="${id}"`)).join("") + `</div>`;
  } else if (name === "reading") {
    const m = instrById(p.main), w = NOTE_PL[(0 + m.tr) % 12];
    h = `<h2 class="h-l">Jak czytasz nuty?</h2><p class="onb-lead">${esc(m.name)} brzmi inaczej, niż jest zapisany.</p><div class="onb-grid one">` +
      tile(p.reading === "written", `Jak w nutach dla mojego instrumentu`, `data-read="written"`, `<b class="onb-ex">C → ${w}</b>`) +
      tile(p.reading === "concert", `Dźwięki rzeczywiste (strój C)`, `data-read="concert"`, `<b class="onb-ex">C → C</b>`) + `</div>
      <p class="note">Przykład: gdy zabrzmi C jak na fortepianie, stroik pokaże ${w} (jak w Twoich nutach) albo C.</p>`;
  } else if (name === "role") {
    h = `<h2 class="h-l">Kim jesteś?</h2><div class="onb-grid one">` +
      tile(p.role === "teacher", "Uczę gry", `data-role="teacher"`) + tile(p.role === "student", "Uczę się", `data-role="student"`) + tile(p.role === "self", "Gram dla siebie", `data-role="self"`) + `</div>
      <h3 class="lbl">Strój A</h3><div class="seg three" id="onb-a4">${[440, 442, 443].map(v => `<button data-a4="${v}" aria-pressed="${p.a4 === v}">${v} Hz</button>`).join("")}</div>
      <p class="note">Nie wiesz? Zostaw 440.</p>`;
  } else {
    const m = instrById(p.main);
    h = `<h2 class="h-l">Gotowe</h2>
      <div class="onb-sum"><b>${esc(m.name)}</b><span>${esc(profileSummary(p))}</span></div>
      <div class="onb-own"><svg class="i"><use href="#mic"/></svg><div class="grow"><b>Twój dźwięk</b><small>Nagraj jeden długi dźwięk, a Solo zagra nuty Twoim brzmieniem.</small></div><button class="btn small tinted" id="onb-own">Nagraj</button></div>`;
    next = "Zacznij";
  }
  box.innerHTML = h; box.scrollTop = 0;
  $("#onb-next span").textContent = next;
  $("#onb-next").disabled = name === "instr" && !p.instruments.length;
  $("#onb-skip").hidden = name === "done";
}
$("#onb-body").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const p = onb.p;
  if (b.dataset.instr) {
    const id = b.dataset.instr, i = p.instruments.indexOf(id);
    if (i >= 0) p.instruments.splice(i, 1); else p.instruments.push(id);
    if (!p.instruments.includes(p.main)) p.main = p.instruments[0] || "puzon";
    if (p.instruments.length === 1) p.main = p.instruments[0];
    renderOnb(); return;
  }
  if (b.dataset.main) { p.main = b.dataset.main; renderOnb(); return; }
  if (b.dataset.read) { p.reading = b.dataset.read; renderOnb(); return; }
  if (b.dataset.role) { p.role = b.dataset.role; renderOnb(); return; }
  if (b.dataset.a4) { p.a4 = +b.dataset.a4; renderOnb(); return; }
  if (b.id === "onb-own") { finishOnb(false); setTimeout(() => openSheet("tuner"), 300); }
});
$("#onb-next").addEventListener("click", () => { if (ONB_STEPS[onb.step] === "done") finishOnb(false); else onbGo(1); });
$("#onb-back").addEventListener("click", () => onbGo(-1));
$("#onb-skip").addEventListener("click", () => finishOnb(true));
$("#btn-profile").addEventListener("click", openOnboarding);

/* ---------------- playback timbres for the main instrument (until the player records their own sound) ---------------- */
function timbreNote(kind) {
  if (kind === "brass") return synthNote;
  return (ctx, out, f, st, en) => {
    const o = ctx.createOscillator(), env = ctx.createGain(), filt = ctx.createBiquadFilter();
    const conf = {
      reed: { type: "square", cut: 5, att: 0.03, sus: 0.55, vib: 0 },
      flute: { type: "sine", cut: 8, att: 0.06, sus: 0.7, vib: 4 },
      string: { type: "sawtooth", cut: 6, att: 0.08, sus: 0.6, vib: 5 },
      voice: { type: "triangle", cut: 4, att: 0.07, sus: 0.65, vib: 5 },
      piano: { type: "triangle", cut: 10, att: 0.005, sus: 0, vib: 0 }
    }[kind] || {};
    o.type = conf.type || "triangle"; o.frequency.value = f;
    filt.type = "lowpass"; filt.frequency.value = Math.min(9000, f * (conf.cut || 5)); filt.Q.value = 0.8;
    env.gain.setValueAtTime(0, st); env.gain.linearRampToValueAtTime(0.9, st + (conf.att || 0.03));
    if (kind === "piano") env.gain.setTargetAtTime(0.0001, st + 0.01, Math.max(0.25, Math.min(1.2, 300 / f)));
    else env.gain.setTargetAtTime(conf.sus, st + conf.att, 0.12);
    env.gain.setTargetAtTime(0, en, kind === "piano" ? 0.08 : 0.05);
    if (conf.vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = conf.vib; lg.gain.value = f * 0.004; l.connect(lg); lg.connect(o.frequency); l.start(st + 0.25); l.stop(en + 0.3); }
    o.connect(filt); filt.connect(env); env.connect(out); o.start(st); o.stop(en + 0.4);
  };
}

/* the first start: questions instead of the old welcome card (people who already use Solo see them once, skippable) */
(function startProfile() {
  applyProfile();
  if (!profile().done) { $("#welcome").hidden = true; openOnboarding(); }
})();
