/* Solo: the player's profile. A few questions on the first start (benchmark: SmartMusic, Tonestro, TonalEnergy,
   Newzik, NN/g onboarding), each skippable, all editable later in Ustawienia → Profil. The answers become the
   defaults: tuner transposition and A, the instrument, clef and tempo of a new melody, the playback sound.
   The microphone is asked for only when it is needed (tuner, own sound), never here. */
"use strict";

/* clef as Solo names it; tr = semitones from the sounding note to the written one (B♭ trumpet: +2);
   lo/hi = practical sounding range (MIDI); voice = playback timbre */
const INSTRUMENTS = [
  /* Dęte blaszane */
  { id: "puzon", name: "Puzon", clef: "bass", tr: 0, lo: 40, hi: 77, comf: [44, 63], clefs: ["bass", "tenor"], voice: "brass", group: "Dęte blaszane" },
  { id: "puzon-alt", name: "Puzon altowy", clef: "alto", tr: 0, lo: 45, hi: 79, comf: [50, 70], clefs: ["alto", "tenor", "treble"], voice: "brass", group: "Dęte blaszane" },
  { id: "puzon-b", name: "Puzon basowy", clef: "bass", tr: 0, lo: 34, hi: 70, comf: [36, 58], clefs: ["bass"], voice: "brass", group: "Dęte blaszane" },
  { id: "trabka", name: "Trąbka B", clef: "treble", tr: 2, lo: 52, hi: 82, comf: [55, 74], clefs: ["treble"], voice: "brass", group: "Dęte blaszane" },
  { id: "trabka-c", name: "Trąbka C", clef: "treble", tr: 0, lo: 54, hi: 84, comf: [57, 76], clefs: ["treble"], voice: "brass", group: "Dęte blaszane" },
  { id: "kornet", name: "Kornet B", clef: "treble", tr: 2, lo: 52, hi: 82, comf: [55, 74], clefs: ["treble"], voice: "brass", group: "Dęte blaszane" },
  { id: "flugelhorn", name: "Flugelhorn B", clef: "treble", tr: 2, lo: 52, hi: 79, comf: [55, 72], clefs: ["treble"], voice: "brass", group: "Dęte blaszane" },
  { id: "waltornia", name: "Waltornia F", clef: "treble", tr: 7, lo: 35, hi: 77, comf: [48, 67], clefs: ["treble", "bass"], voice: "brass", group: "Dęte blaszane" },
  { id: "sakshorn-a", name: "Sakshorn altowy Es", clef: "treble", tr: 9, lo: 43, hi: 74, comf: [48, 67], clefs: ["treble"], voice: "brass", group: "Dęte blaszane" },
  { id: "sakshorn-t", name: "Sakshorn tenorowy B", clef: "treble", tr: 14, lo: 40, hi: 72, comf: [43, 63], clefs: ["treble"], voice: "brass", group: "Dęte blaszane" },
  { id: "eufonium", name: "Eufonium", clef: "bass", tr: 0, lo: 40, hi: 74, comf: [43, 65], clefs: ["bass", "tenor", "treble"], voice: "brass", group: "Dęte blaszane" },
  { id: "baryton", name: "Baryton B", clef: "treble", tr: 14, lo: 40, hi: 72, comf: [43, 63], clefs: ["treble"], voice: "brass", group: "Dęte blaszane" },
  { id: "tuba", name: "Tuba", clef: "bass", tr: 0, lo: 26, hi: 65, comf: [32, 51], clefs: ["bass"], voice: "brass", group: "Dęte blaszane" },
  { id: "suzafon", name: "Suzafon", clef: "bass", tr: 0, lo: 28, hi: 62, comf: [32, 51], clefs: ["bass"], voice: "brass", group: "Dęte blaszane" },
  /* Dęte drewniane */
  { id: "flet", name: "Flet", clef: "treble", tr: 0, lo: 60, hi: 96, comf: [70, 87], clefs: ["treble"], voice: "flute", group: "Dęte drewniane" },
  { id: "piccolo", name: "Flet piccolo", clef: "treble", tr: -12, lo: 74, hi: 108, voice: "flute", group: "Dęte drewniane" },
  { id: "flet-a", name: "Flet altowy G", clef: "treble", tr: 5, lo: 55, hi: 86, voice: "flute", group: "Dęte drewniane" },
  { id: "flet-p", name: "Flet prosty", clef: "treble", tr: -12, lo: 72, hi: 98, voice: "flute", group: "Dęte drewniane" },
  { id: "oboj", name: "Obój", clef: "treble", tr: 0, lo: 58, hi: 93, voice: "reed", group: "Dęte drewniane" },
  { id: "rozek", name: "Rożek angielski F", clef: "treble", tr: 7, lo: 52, hi: 81, voice: "reed", group: "Dęte drewniane" },
  { id: "klarnet", name: "Klarnet B", clef: "treble", tr: 2, lo: 50, hi: 94, comf: [51, 77], clefs: ["treble"], voice: "reed", group: "Dęte drewniane" },
  { id: "klarnet-a", name: "Klarnet A", clef: "treble", tr: 3, lo: 49, hi: 93, voice: "reed", group: "Dęte drewniane" },
  { id: "klarnet-es", name: "Klarnet Es", clef: "treble", tr: -3, lo: 55, hi: 98, voice: "reed", group: "Dęte drewniane" },
  { id: "klarnet-bas", name: "Klarnet basowy B", clef: "treble", tr: 14, lo: 38, hi: 77, voice: "reed", group: "Dęte drewniane" },
  { id: "fagot", name: "Fagot", clef: "bass", tr: 0, lo: 34, hi: 75, comf: [38, 65], clefs: ["bass", "tenor"], voice: "reed", group: "Dęte drewniane" },
  { id: "kontrafagot", name: "Kontrafagot", clef: "bass", tr: 12, lo: 22, hi: 53, voice: "reed", group: "Dęte drewniane" },
  { id: "sax-s", name: "Saksofon sopranowy B", clef: "treble", tr: 2, lo: 56, hi: 87, voice: "reed", group: "Dęte drewniane" },
  { id: "sax-a", name: "Saksofon altowy Es", clef: "treble", tr: 9, lo: 49, hi: 80, comf: [53, 75], clefs: ["treble"], voice: "reed", group: "Dęte drewniane" },
  { id: "sax-t", name: "Saksofon tenorowy B", clef: "treble", tr: 14, lo: 44, hi: 75, comf: [46, 67], clefs: ["treble"], voice: "reed", group: "Dęte drewniane" },
  { id: "sax-b", name: "Saksofon barytonowy Es", clef: "treble", tr: 21, lo: 36, hi: 68, comf: [39, 60], clefs: ["treble"], voice: "reed", group: "Dęte drewniane" },
  /* Smyczkowe */
  { id: "skrzypce", name: "Skrzypce", clef: "treble", tr: 0, lo: 55, hi: 100, comf: [55, 88], clefs: ["treble"], voice: "string", group: "Smyczkowe" },
  { id: "altowka", name: "Altówka", clef: "alto", tr: 0, lo: 48, hi: 88, comf: [48, 79], clefs: ["alto", "treble"], voice: "string", group: "Smyczkowe" },
  { id: "wiolonczela", name: "Wiolonczela", clef: "bass", tr: 0, lo: 36, hi: 81, comf: [36, 69], clefs: ["bass", "tenor", "treble"], voice: "string", group: "Smyczkowe" },
  { id: "kontrabas", name: "Kontrabas", clef: "bass", tr: 12, lo: 28, hi: 67, comf: [28, 55], clefs: ["bass"], voice: "string", group: "Smyczkowe" },
  /* Klawiszowe */
  { id: "fortepian", name: "Fortepian", clef: "treble", tr: 0, lo: 21, hi: 108, clefs: ["treble", "bass"], voice: "piano", group: "Klawiszowe" },
  { id: "organy", name: "Organy", clef: "treble", tr: 0, lo: 36, hi: 96, clefs: ["treble", "bass"], voice: "reed", group: "Klawiszowe" },
  { id: "akordeon", name: "Akordeon", clef: "treble", tr: 0, lo: 28, hi: 93, clefs: ["treble", "bass"], voice: "reed", group: "Klawiszowe" },
  { id: "keyboard", name: "Keyboard", clef: "treble", tr: 0, lo: 36, hi: 96, clefs: ["treble", "bass"], voice: "piano", group: "Klawiszowe" },
  /* Szarpane */
  { id: "gitara", name: "Gitara", clef: "treble", tr: 12, lo: 40, hi: 83, voice: "piano", group: "Szarpane" },
  { id: "gitara-bas", name: "Gitara basowa", clef: "bass", tr: 12, lo: 28, hi: 67, voice: "piano", group: "Szarpane" },
  { id: "ukulele", name: "Ukulele", clef: "treble", tr: 0, lo: 60, hi: 81, voice: "piano", group: "Szarpane" },
  { id: "mandolina", name: "Mandolina", clef: "treble", tr: 0, lo: 55, hi: 88, voice: "piano", group: "Szarpane" },
  { id: "harfa", name: "Harfa", clef: "treble", tr: 0, lo: 24, hi: 103, clefs: ["treble", "bass"], voice: "piano", group: "Szarpane" },
  /* Perkusyjne (melodyczne) */
  { id: "dzwonki", name: "Dzwonki", clef: "treble", tr: -24, lo: 79, hi: 108, voice: "piano", group: "Perkusyjne" },
  { id: "ksylofon", name: "Ksylofon", clef: "treble", tr: -12, lo: 65, hi: 108, voice: "piano", group: "Perkusyjne" },
  { id: "marimba", name: "Marimba", clef: "treble", tr: 0, lo: 45, hi: 96, clefs: ["treble", "bass"], voice: "piano", group: "Perkusyjne" },
  { id: "wibrafon", name: "Wibrafon", clef: "treble", tr: 0, lo: 53, hi: 89, voice: "piano", group: "Perkusyjne" },
  /* Głos */
  { id: "sopran", name: "Sopran", clef: "treble", tr: 0, lo: 60, hi: 84, voice: "voice", group: "Głos" },
  { id: "alt", name: "Alt", clef: "treble", tr: 0, lo: 53, hi: 77, voice: "voice", group: "Głos" },
  { id: "tenor", name: "Tenor", clef: "treble", tr: 12, lo: 48, hi: 72, voice: "voice", group: "Głos" },
  { id: "bas", name: "Bas", clef: "bass", tr: 0, lo: 40, hi: 64, voice: "voice", group: "Głos" }
];
const INSTR_GROUPS = ["Dęte blaszane", "Dęte drewniane", "Smyczkowe", "Klawiszowe", "Szarpane", "Perkusyjne", "Głos"];
/* the instrument picker (benchmark: MuseScore, StaffPad, Dorico, BandLab): search, "yours" first, then families */
function instrPicker(box, { selected = [], multi = false, onPick }) {
  const p = profile(), mine = [...new Set([...(p.instruments || []), ...JSON.parse(store.get("recentInstr", "[]"))])].filter(id => INSTRUMENTS.some(i => i.id === id)).slice(0, 8);
  const chip = i => `<button class="ichip" data-i="${i.id}" aria-pressed="${selected.includes(i.id)}">${esc(i.name)}</button>`;
  const draw = q => {
    const f = fold((q || "").trim()), hit = i => !f || fold(i.name).includes(f);          // "trabka" finds "Trąbka"
    let h = "";
    if (!f && mine.length) h += `<h3 class="lbl">Twoje</h3><div class="ichips">${mine.map(id => chip(instrById(id))).join("")}</div>`;
    INSTR_GROUPS.forEach(g => { const list = INSTRUMENTS.filter(i => i.group === g && hit(i)); if (list.length) h += `<h3 class="lbl">${g}</h3><div class="ichips">${list.map(chip).join("")}</div>`; });
    box.querySelector(".ip-list").innerHTML = h || `<p class="note">Brak takiego instrumentu.</p>`;
  };
  box.innerHTML = `<label class="search ip-search">${icon("search")}<input type="search" placeholder="Szukaj instrumentu" autocomplete="off"></label><div class="ip-list"></div>`;
  box.querySelector("input").addEventListener("input", e => draw(e.target.value));
  box.querySelector(".ip-list").addEventListener("click", e => {
    const b = e.target.closest("[data-i]"); if (!b) return;
    if (multi) { const i = selected.indexOf(b.dataset.i); if (i >= 0) selected.splice(i, 1); else selected.push(b.dataset.i); $$(`[data-i="${b.dataset.i}"]`, box).forEach(x => x.setAttribute("aria-pressed", String(selected.includes(b.dataset.i)))); }
    onPick(b.dataset.i);
  });
  draw("");
}
function rememberInstr(id) { const r = JSON.parse(store.get("recentInstr", "[]")).filter(x => x !== id); r.unshift(id); store.set("recentInstr", JSON.stringify(r.slice(0, 6))); }
const instrById = id => INSTRUMENTS.find(i => i.id === id) || INSTRUMENTS[0];
/* the range a pupil plays comfortably (sounding MIDI): from the tables, otherwise the middle 70% of the full range */
const comfOf = i => i.comf || [Math.round(i.lo + (i.hi - i.lo) * 0.15), Math.round(i.hi - (i.hi - i.lo) * 0.15)];
const clefsOf = i => i.clefs || [i.clef];
const PROFILE_DEFAULT = { instruments: ["puzon"], main: "puzon", reading: "written", role: "", a4: 440, done: false };
function profile() {
  let p = null; try { p = JSON.parse(store.get("profile", "null")); } catch {}
  return { ...PROFILE_DEFAULT, ...(p || {}) };
}
function saveProfile(p) { if (!store.set("profile", JSON.stringify(p))) hud("Nie udało się zapisać ustawień. Pamięć urządzenia może być pełna.", 4000); applyProfile(); }
/* the written note of C for a transposing instrument, within an octave (piccolo, guitar: none; E♭ clarinet: A) */
const trPc = m => ((m.tr % 12) + 12) % 12;
const mainInstr = () => instrById(profile().main);
/* what the tuner shows: the written note for a transposing instrument (as the player reads it) */
function applyProfile() {
  const p = profile(), m = instrById(p.main);
  if (store.get("tunerTr") == null || p.done) { tuner.tr = p.reading === "written" ? ((m.tr % 12) + 12) % 12 : 0; }
  tuner.a4 = p.a4 || 440;
  const s = $("#prof-sum"); if (s) s.textContent = profileSummary();
}
function profileSummary(p = profile()) {
  const m = instrById(p.main), more = p.instruments.filter(i => i !== p.main).map(i => instrById(i).name);
  const role = { teacher: "uczę", student: "uczę się", self: "gram dla siebie" }[p.role];
  return [m.name + (more.length ? ` (+ ${more.join(", ")})` : ""), trPc(m) ? (p.reading === "written" ? "nuty dla instrumentu" : "dźwięki rzeczywiste") : "", role, `A = ${p.a4} Hz`].filter(Boolean).join(" · ");
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
  if (name === "reading") return !trPc(instrById(p.main));          // an octave apart only: C is still C
  return false;
}
function onbGo(d) {
  let s = onb.step + d;
  while (s > 0 && s < ONB_STEPS.length - 1 && onbSkipStep(ONB_STEPS[s])) s += d;
  onb.step = Math.max(0, Math.min(ONB_STEPS.length - 1, s)); renderOnb();
}
function finishOnb() {
  const p = { ...onb.p, done: true };             // "Pomiń" keeps what was already chosen
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
      <p class="onb-lead">Solo ustawi się pod Ciebie. Wszystko zmienisz później w zakładce „Ja”.</p>
      <p class="w-legal">Korzystając z Solo, akceptujesz <a href="regulamin.html">regulamin</a> i&nbsp;<a href="prywatnosc.html">politykę&nbsp;prywatności</a>.</p>`;
    next = "Zaczynamy";
  } else if (name === "instr") {
    h = `<h2 class="h-l">Na czym grasz?</h2><div id="onb-picker"></div>`;
  } else if (name === "main") {
    h = `<h2 class="h-l">Główny instrument</h2><div class="onb-grid one">` +
      p.instruments.map(id => tile(p.main === id, instrById(id).name, `data-main="${id}"`)).join("") + `</div>`;
  } else if (name === "reading") {
    const m = instrById(p.main), w = NOTE_PL[trPc(m)];
    h = `<h2 class="h-l">Stroik pokazuje</h2><div class="onb-grid one">` +
      tile(p.reading === "written", `Zapis dla instrumentu`, `data-read="written"`, `<b class="onb-ex">C → ${w}</b>`) +
      tile(p.reading === "concert", `Dźwięki rzeczywiste`, `data-read="concert"`, `<b class="onb-ex">C → C</b>`) + `</div>`;
  } else if (name === "role") {
    h = `<h2 class="h-l">Kim jesteś?</h2><div class="onb-grid one">` +
      tile(p.role === "teacher", "Uczę gry", `data-role="teacher"`) + tile(p.role === "student", "Uczę się", `data-role="student"`) + tile(p.role === "self", "Gram dla siebie", `data-role="self"`) + `</div>
      <h3 class="lbl">Strój A</h3><div class="seg three" id="onb-a4">${[440, 442, 443].map(v => `<button data-a4="${v}" aria-pressed="${p.a4 === v}">${v} Hz</button>`).join("")}</div>
      `;
  } else {
    const m = instrById(p.main);
    h = `<h2 class="h-l">Gotowe</h2>
      <div class="onb-sum"><b>${esc(m.name)}</b><span>${esc(profileSummary(p))}</span></div>
      <div class="onb-own"><svg class="i"><use href="#mic"/></svg><div class="grow"><b>Twój dźwięk</b><small>Solo zagra nuty Twoim brzmieniem.</small></div><button class="btn small tinted" id="onb-own">Nagraj</button></div>`;
    next = "Zacznij";
  }
  box.innerHTML = h; box.scrollTop = 0;
  if (name === "instr") instrPicker($("#onb-picker"), { selected: p.instruments, multi: true, onPick: () => { if (!p.instruments.includes(p.main)) p.main = p.instruments[0] || "puzon"; if (p.instruments.length === 1) p.main = p.instruments[0]; $("#onb-next").disabled = !p.instruments.length; } });
  $("#onb-next span").textContent = next;
  $("#onb-next").disabled = name === "instr" && !p.instruments.length;
  $("#onb-skip").hidden = name === "done";
}
$("#onb-body").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const p = onb.p;
  if (b.dataset.instr && false) {
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
/* the instrument is the one answer everything else follows (clef, tuner, playback): "Pomiń" on the greeting leads
   to it instead of making everyone a trombonist */
$("#onb-skip").addEventListener("click", () => { if (ONB_STEPS[onb.step] === "hello") onbGo(1); else finishOnb(); });

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

/* "Ja": the same answers, changed in place (the questions are only for the very first start) */
function renderProfile() {
  const box = $("#prof"); if (!box) return;
  const p = profile(), m = instrById(p.main);
  box.innerHTML = `<div class="ichips">${p.instruments.map(id => `<button class="ichip" data-main="${id}" aria-pressed="${id === p.main}">${esc(instrById(id).name)}</button>`).join("")}<button class="ichip" data-edit aria-label="Zmień instrumenty">${icon("plus")}</button></div>
    ${p.instruments.length > 1 ? `<p class="sub">Główny: ${esc(m.name)}</p>` : ""}
    ${trPc(m) ? `<h3 class="lbl">Stroik pokazuje</h3><div class="seg"><button data-read="written" aria-pressed="${p.reading === "written"}">Zapis dla instrumentu</button><button data-read="concert" aria-pressed="${p.reading === "concert"}">Dźwięki rzeczywiste</button></div>` : ""}
    <h3 class="lbl">Rola</h3><div class="seg three"><button data-role="teacher" aria-pressed="${p.role === "teacher"}">Uczę</button><button data-role="student" aria-pressed="${p.role === "student"}">Uczę się</button><button data-role="self" aria-pressed="${p.role === "self"}">Dla siebie</button></div>
    <h3 class="lbl">Strój A</h3><div class="seg three">${[440, 442, 443].map(v => `<button data-a4="${v}" aria-pressed="${p.a4 === v}">${v} Hz</button>`).join("")}</div>
    <button class="btn tinted wide" data-again>Pytania na start jeszcze raz</button>`;
}
$("#prof").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  const p = profile();
  if (b.hasAttribute("data-edit")) { openSheet("instr"); return; }
  if (b.hasAttribute("data-again")) { openOnboarding(); return; }
  if (b.dataset.main) p.main = b.dataset.main;
  if (b.dataset.read) p.reading = b.dataset.read;
  if (b.dataset.role) p.role = b.dataset.role;
  if (b.dataset.a4) p.a4 = +b.dataset.a4;
  saveProfile({ ...p, done: true }); renderProfile();
});
function buildInstrSheet() {
  const p = profile(), sel = [...p.instruments];
  instrPicker($("#instr-picker"), { selected: sel, multi: true, onPick: () => {
    if (!sel.length) return;
    saveProfile({ ...p, instruments: [...sel], main: sel.includes(p.main) ? p.main : sel[0], done: true }); renderProfile();
  } });
}
