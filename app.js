/* Solo · interface. Logic for music lives in core.js; this file wires the screens. */
"use strict";
const VERSION = "4.0";
const BUILD = document.documentElement.dataset.build || "";
const icon = id => `<svg class="i"><use href="#${id}"/></svg>`;
const plural = (n, one, few, many) => n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14)) ? few : many;
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

/* ---------------- Engine (Verovio) ---------------- */
let tk = null;
const engineReady = new Promise(resolve => {
  const boot = () => {
    const go = () => { if (tk) return; tk = new verovio.toolkit(); resolve(tk); };
    /* this Verovio build never sets calledRun; once the wasm exports exist the runtime is up
       (or will be within the same task), so a cached, already-started engine isn't missed */
    const m = verovio.module;
    m.onRuntimeInitialized = go;
    if (m.calledRun || typeof m._vrvToolkit_constructor === "function") setTimeout(go, 0);
  };
  const s = document.getElementById("verovio-script");
  if (window.verovio) boot(); else s.addEventListener("load", boot);
  s.addEventListener("error", () => { $("#pages").innerHTML = `<div class="page-msg">Nie udało się wczytać silnika nut. Sprawdź internet i odśwież stronę.</div>`; });
});

/* ---------------- State ---------------- */
const S = {
  view: "home", piece: null, parts: [], srcKey: { fifths: 0, mode: "major" }, srcClef: "treble",
  clef: "keep", iv: { d: 0, s: 0 }, preset: -1,
  zoom: Math.max(.5, Math.min(2, Number(store.get("zoom2", 0.8)) || 0.8)), tempo: 100,
  dirty: false, thumbDirty: false, loadedKey: null, mode: null
};
const CLEF_PL = { treble: "wiolinowy", bass: "basowy", tenor: "tenorowy", alto: "altowy" };
const OCT_PL = { "-2": "Dwie oktawy niżej", "-1": "Oktawę niżej", "0": "Bez zmian", "1": "Oktawę wyżej", "2": "Dwie oktawy wyżej" };

/* ---------------- Views & history ----------------
   Screens and open sheets are history entries, so the phone's Back button
   closes a sheet first, then returns from the score to the library.
   Screens move like iOS navigation: the new one slides over from the right while the
   old one shifts a third of the way left under a dimming layer. Every transition starts
   from what is on screen right now, so it can be reversed mid-way. */
const reducedMotion = Motion.reduce;
const canAnimate = () => !reducedMotion.matches && !document.hidden;
const NAV = { damping: 1, response: 0.42 };
const navDim = $("#navdim");
let navRun = null;
const settle = () => (navRun ? navRun.done : Promise.resolve());
const idle = () => new Promise(r => (window.requestIdleCallback || setTimeout)(r, { timeout: 600 }));
function clearNav(els) {
  els.forEach(el => { el.style.zIndex = ""; el.style.transform = ""; el.classList.remove("nav-top", "navigating"); });
  navDim.hidden = true; navDim.style.opacity = "";
}
function navAnimate(fromEl, toEl, dir, velocity = 0, fromLive) {
  const W = window.innerWidth;
  const live = el => (el.hidden ? null : Motion.liveTranslate(el).x);
  let fx = fromLive ? fromLive.top : live(fromEl), tx = fromLive ? fromLive.under : live(toEl);
  const dim0 = navDim.hidden ? (dir === "fwd" ? 0 : 1) : parseFloat(getComputedStyle(navDim).opacity) || 0;
  if (navRun) navRun.cancel();
  if (fx === null) fx = 0;
  if (tx === null) tx = dir === "fwd" ? W : -0.3 * W;
  toEl.hidden = false;
  const top = dir === "fwd" ? toEl : fromEl, under = dir === "fwd" ? fromEl : toEl;
  top.style.zIndex = 3; under.style.zIndex = 1; navDim.hidden = false;
  top.classList.add("nav-top"); fromEl.classList.add("navigating"); toEl.classList.add("navigating");
  if (!canAnimate()) {
    const o = { duration: 200, easing: "ease", fill: "both" };
    const a = toEl.animate([{ opacity: 0 }, { opacity: 1 }], o);
    navDim.hidden = true;
    const run = { cancel: () => a.cancel() };
    run.done = a.finished.then(() => { if (navRun !== run) return; fromEl.hidden = true; a.cancel(); clearNav([fromEl, toEl]); navRun = null; }).catch(() => {});
    navRun = run; return run.done;
  }
  const f = Motion.easing(NAV.damping, NAV.response, velocity);
  const o = { duration: f.duration, easing: f.easing, fill: "both" };
  const fEnd = dir === "fwd" ? -0.3 * W : W;
  const anims = [
    toEl.animate([{ transform: `translate3d(${tx}px,0,0)` }, { transform: "translate3d(0,0,0)" }], o),
    fromEl.animate([{ transform: `translate3d(${fx}px,0,0)` }, { transform: `translate3d(${fEnd}px,0,0)` }], o),
    navDim.animate([{ opacity: dim0 }, { opacity: dir === "fwd" ? 1 : 0 }], o)
  ];
  fromEl.style.transform = toEl.style.transform = "";
  const run = { cancel: () => anims.forEach(a => a.cancel()) };
  run.done = Promise.all(anims.map(a => a.finished)).then(() => {
    if (navRun !== run) return;
    fromEl.hidden = true; anims.forEach(a => a.cancel()); clearNav([fromEl, toEl]); navRun = null;
  }).catch(() => {});
  navRun = run;
  return run.done;
}
function show(v, dir, opt = {}) {
  const from = S.view;
  const views = ["home", "score", "settings", "tunerv", "metrov"];
  if (from === v || opt.instant) {
    S.view = v; views.forEach(n => ($("#" + n).hidden = n !== v));
    if (v === "home") refreshLibrary(); if (v === "settings") syncSettings();
    tabShown(v, from);
    return;
  }
  if (from === "score") leaveScore();
  S.view = v;
  hideSheet(true);
  document.body.classList.remove("immersive");
  if (v === "home") refreshLibrary();
  if (v === "settings") syncSettings();
  const fromEl = $("#" + from), toEl = $("#" + v);
  views.forEach(n => { if (n !== v && n !== from) $("#" + n).hidden = true; });
  if (v !== "home") { const sc = v === "score" ? $("#scroller") : toEl; sc.scrollTop = 0; }
  tabShown(v, from);
  if (opt.swiped) return;                      // the edge swipe already moved the screens
  navAnimate(fromEl, toEl, dir || (v === "home" ? "back" : "fwd"));
}
/* ---------------- tabs: Nuty, Stroik, Metronom, Ty. A piece opens full screen above them ---------------- */
const TABS = ["home", "tunerv", "metrov", "settings"];
function tabShown(v, from) {
  document.body.classList.toggle("tabs", TABS.includes(v)); document.body.classList.toggle("onhome", v === "home");
  $$("#tabbar [data-tab]").forEach(b => b.toggleAttribute("aria-current", b.dataset.tab === v));
  placeSlide();
  if (from === "tunerv" && v !== "tunerv" && (tuner.on || tuner.starting)) tunerStop();
  if (v === "tunerv") { $("#tuner-tab-host").appendChild($("#tuner-ui")); syncTuner(); tnOrb(); if (!tuner.on && from !== v) tunerAuto(); }
  if (v === "metrov") { $("#metro-tab-host").appendChild($("#metro-ui")); buildToolsSheet(); }
  if (v === "settings" && typeof renderProfile === "function") renderProfile();
  if (v === "settings" && typeof syncOwn === "function") syncOwn();
  if (v === "settings" && NEWS[VERSION]) { store.set("newsSeen", VERSION); $('#tabbar [data-tab="settings"]')?.classList.remove("dot"); }
}
/* the brass slide pill sits behind the current tab and glides to the next one (the one "you are here" mark) */
function placeSlide() {
  requestAnimationFrame(() => {                         // after the bar is laid out (it is hidden off the tabs)
    const bar = $("#tabbar"), cur = bar && bar.querySelector("[aria-current]"), pill = bar && bar.querySelector(".slide"); if (!cur || !pill || !cur.offsetWidth) return;
    if (!pill.style.width) pill.style.transition = "none";   // the first placement does not glide in from the left
    /* the pill takes the button's own box, so it can never sit lower or higher than the tab it marks */
    pill.style.width = cur.offsetWidth + "px"; pill.style.height = cur.offsetHeight + "px"; pill.style.top = cur.offsetTop + "px";
    pill.style.transform = `translateX(${cur.offsetLeft}px)`;
    if (pill.style.transition) requestAnimationFrame(() => (pill.style.transition = ""));
  });
}
addEventListener("resize", () => placeSlide());
function goTab(v) {
  if (v === S.view) { const el = $("#" + v); el && el.scrollTo({ top: 0, behavior: "smooth" }); return; }
  if (openSheetId) closeSheet();
  if (v === "home") { if (history.state && history.state.v) history.back(); else show("home", null, { instant: true }); return; }
  if (S.view === "home") history.pushState({ v }, ""); else history.replaceState({ v }, "");
  show(v, null, { instant: true });
}
$$("#tabbar [data-tab]").forEach(b => b.addEventListener("click", () => goTab(b.dataset.tab)));
function go(v) {
  if (openSheetId) { closeSheetThen(() => go(v)); return; }
  if (v === S.view) return;
  if (v === "home") { if (history.state && history.state.v) history.back(); else show("home"); return; }
  history.pushState({ v }, "");
  show(v);
}
let skipPop = 0, afterPop = null, swipedBack = false;
window.addEventListener("popstate", e => {
  if (skipPop) { skipPop--; const f = afterPop; afterPop = null; if (f) f(); return; }
  if (cam.open) { closeCamera(true); return; }
  if (openSheetId) { hideSheet(); return; }
  const sw = swipedBack, to = (e.state && e.state.v) || "home"; swipedBack = false;
  show(to, "back", { swiped: sw, instant: TABS.includes(S.view) && TABS.includes(to) });
});

/* Swipe from the left edge to go back (score, settings), tracked 1:1 with the finger. */
function edgeSwipe(view) {
  let x0 = null, dx = 0, on = false, tr = null, under = null, W = 0;
  view.addEventListener("pointerdown", e => {
    if (e.pointerType === "mouse" || e.clientX > 24 || openSheetId || S.view !== view.id || !canAnimate()) return;
    x0 = e.clientX; dx = 0; on = false; tr = new Motion.Tracker(); tr.add(e.clientX, 0);
  });
  view.addEventListener("pointermove", e => {
    if (x0 === null) return;
    dx = e.clientX - x0; tr.add(e.clientX, 0);
    if (!on) {
      if (Math.abs(dx) < 10) return;
      if (dx < 0) { x0 = null; return; }
      on = true; view.setPointerCapture(e.pointerId);
      if (navRun) navRun.cancel();
      W = window.innerWidth; under = $("#home"); under.hidden = false;
      under.style.zIndex = 1; view.style.zIndex = 3; navDim.hidden = false;
      view.classList.add("nav-top", "navigating"); under.classList.add("navigating");
      stopPlayback();
    }
    const x = dx < 0 ? -Motion.rubberband(-dx, W) : dx;
    view.style.transform = `translate3d(${x}px,0,0)`;
    under.style.transform = `translate3d(${-0.3 * W + 0.3 * Math.max(0, x)}px,0,0)`;
    navDim.style.opacity = String(Math.max(0, 1 - Math.max(0, x) / W));
  });
  const end = () => {
    if (x0 === null) return; x0 = null;
    if (!on) return; on = false;
    const v = tr.velocity().x, x = Math.max(0, dx);
    const commit = Math.abs(v) > 250 ? v > 0 : x + Motion.project(v, 0.99) > W / 2;
    const live = { top: x, under: -0.3 * W + 0.3 * x };
    if (commit) {
      navAnimate(view, under, "back", Math.max(0, v) / Math.max(1, W - x), live);
      swipedBack = true; history.back();
    } else {
      // spring back to where it was
      const f = Motion.easing(1, 0.36, Math.max(0, -v) / Math.max(1, x));
      const o = { duration: f.duration, easing: f.easing, fill: "both" };
      const a = [view.animate([{ transform: `translate3d(${x}px,0,0)` }, { transform: "translate3d(0,0,0)" }], o),
        under.animate([{ transform: `translate3d(${live.under}px,0,0)` }, { transform: `translate3d(${-0.3 * W}px,0,0)` }], o),
        navDim.animate([{ opacity: navDim.style.opacity || 1 }, { opacity: 1 }], o)];
      view.style.transform = under.style.transform = "";
      Promise.all(a.map(z => z.finished)).then(() => { a.forEach(z => z.cancel()); if (S.view === view.id) under.hidden = true; clearNav([view, under]); }).catch(() => {});
    }
  };
  view.addEventListener("pointerup", end); view.addEventListener("pointercancel", end);
}
edgeSwipe($("#score"));

/* ---------------- Sheets ----------------
   Phones: a bottom sheet that follows the finger, keeps the flick's velocity and settles
   with a spring. Tablets and computers: a centred card that scales in (modal recipe). */
let openSheetId = null, sheetVelocity;
const scrim = $("#scrim");
const isWide = () => matchMedia("(min-width:700px)").matches;
const SHEET_OPEN = { damping: 1, response: 0.36 }, SHEET_CLOSE = { damping: 1, response: 0.3 };
const sheetCtl = new Map();
function ctl(el) {
  let c = sheetCtl.get(el);
  if (!c) {
    c = { h: 0, linkScrim: true };
    c.spring = new Motion.Spring(0, y => {
      el.style.transform = `translate3d(0,${y}px,0)`;
      if (c.linkScrim && c.h) scrim.style.opacity = String(Math.max(0, Math.min(1, 1 - y / c.h)));
    });
    sheetCtl.set(el, c);
  }
  return c;
}
function presentSheet(el, switching) {
  scrim.hidden = false; el.hidden = false;
  if (isWide() || !canAnimate()) {
    /* a phone without animation (page in the background, reduced motion): the sheet still has to come up */
    const c = sheetCtl.get(el); if (c) c.spring.stop();
    el.style.transform = isWide() ? "" : "translate3d(0,0,0)"; scrim.style.opacity = "";
    el.classList.remove("out"); el.classList.add("pre");
    if (!switching) { scrim.classList.remove("out"); scrim.classList.add("pre"); }
    void el.offsetWidth;
    el.classList.remove("pre"); scrim.classList.remove("pre");
    return;
  }
  el.classList.remove("pre", "out"); scrim.classList.remove("pre", "out");
  const c = ctl(el); c.h = el.offsetHeight; c.linkScrim = !switching;
  if (switching) scrim.style.opacity = "1";
  c.spring.set(c.h); c.spring.to(0, SHEET_OPEN).then(() => { c.linkScrim = true; });
}
function dismissSheet(el, name, velocity) {
  const finish = () => {
    if (openSheetId === name) return;                 // reopened meanwhile
    el.hidden = true; el.classList.remove("out"); el.style.transform = "";
    if (!openSheetId) { scrim.hidden = true; scrim.classList.remove("out"); scrim.style.opacity = ""; }
  };
  if (isWide() || !canAnimate()) {
    el.classList.add("out"); scrim.classList.add("out");
    setTimeout(finish, 200); return;
  }
  const c = ctl(el); c.h = el.offsetHeight || c.h; c.linkScrim = true;
  c.spring.to(c.h, velocity !== undefined ? { damping: 1, response: 0.3, velocity } : SHEET_CLOSE).then(done => { if (done) finish(); });
}
function openSheet(name) {
  const el = $("#sh-" + name); if (!el) return;
  const switching = !!openSheetId;
  if (switching) hideSheet(true, true); else history.pushState({ v: S.view, sheet: true }, "");
  ({ clef: buildClefSheet, key: buildKeySheet, more: buildMoreSheet, orig: buildOrigSheet, pages: preparePages, tools: buildToolsSheet, tuner: buildTunerSheet, bar: buildBarSheet, practice: buildPracticeSheet, new: buildNewSheet, addpart: buildAddPartSheet, part: buildPartSheet, share: buildShareSheet, instr: () => buildInstrSheet(), col: buildColSheet, addto: buildAddtoSheet, card: syncFavTile, pick: () => buildPickSheet() })[name]?.();
  openSheetId = name; document.body.classList.toggle("sheet-add", name === "add");
  presentSheet(el, switching);
  if (name === "key") placeHandle(true);
  /* focus goes into the sheet on every device (VoiceOver read the page behind before), on its title rather than a
     button, so Enter can never delete; the page behind is inert until the sheet closes, then focus returns */
  if (!switching) sheetOpener = document.activeElement;
  setBehindInert(el, true);
  const h = el.querySelector("h2, h1, .h-m") || el; h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true });
}
let sheetOpener = null;
function setBehindInert(sheet, on) {
  [...document.body.children].forEach(c => {
    if (c === sheet || c.id === "scrim" || c.id === "toast" || c.classList.contains("sheet") || c.tagName === "SCRIPT") return;
    if (on) { if (!c.inert) { c.inert = true; c.dataset.sheetInert = "1"; } } else if (c.dataset.sheetInert) { c.inert = false; delete c.dataset.sheetInert; }
  });
}
function hideSheet(instant, keepScrim) {
  if (openSheetId === "tuner" && (tuner.on || tuner.starting)) tunerStop();
  if (openSheetId === "pdf" && pickPdfPages.cancel) { const c = pickPdfPages.cancel; setTimeout(c, 0); }
  if (!openSheetId) return;
  const name = openSheetId, el = $("#sh-" + name);
  openSheetId = null; setBehindInert(el, false);
  if (!keepScrim && sheetOpener && sheetOpener.isConnected) { const o = sheetOpener; sheetOpener = null; setTimeout(() => o.focus?.({ preventScroll: true }), 0); } document.body.classList.remove("sheet-add"); if (name === "addpart" && typeof ap !== "undefined") setTimeout(() => { if (openSheetId !== "addpart") ap.replace = null; }, 400);
  const v = sheetVelocity; sheetVelocity = undefined;
  if (instant) {
    ctl(el).spring.stop(); el.hidden = true; el.style.transform = ""; el.classList.remove("out", "pre");
    if (!keepScrim) { scrim.hidden = true; scrim.style.opacity = ""; scrim.classList.remove("out", "pre"); }
    return;
  }
  dismissSheet(el, name, v);
}
/* fade an overlay out (exit faster than enter), then hide it */
function fadeOut(el, ms = 200) {
  if (el.hidden) return;
  if (!canAnimate()) { el.hidden = true; return; }
  const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" });
  a.finished.then(() => { el.hidden = true; a.cancel(); }).catch(() => {});
}
/* full-screen cover (reading): rises from the bottom, leaves the same way */
function presentCover(el) {
  el.hidden = false;
  if (!canAnimate()) { el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease" }); return; }
  const f = Motion.easing(1, 0.42);
  el.animate([{ transform: "translate3d(0,100%,0)" }, { transform: "translate3d(0,0,0)" }], { duration: f.duration, easing: f.easing });
}
function dismissCover(el) {
  if (el.hidden) return;
  if (!canAnimate()) { fadeOut(el); return; }
  const f = Motion.easing(1, 0.32);
  const a = el.animate([{ transform: "translate3d(0,0,0)" }, { transform: "translate3d(0,100%,0)" }], { duration: f.duration, easing: f.easing, fill: "forwards" });
  a.finished.then(() => { el.hidden = true; a.cancel(); }).catch(() => {});
}
/* Sheet headers: title in the middle, "Gotowe" as a word or a round ✕ (cancel). */
$$(".shead").forEach(h => {
  h.querySelectorAll(".done").forEach(b => {
    const label = b.textContent.trim();
    b.setAttribute("aria-label", label); b.title = label;
    /* ✕ for "close without a choice"; "Gotowe" stays a word (a lone ✓ left people guessing what it confirms) */
    b.innerHTML = b.classList.contains("ghost") ? icon("x") : `<span>${esc(label)}</span>`;
  });
});
/* Sheet dragging: header and grab handle always; the body only when it is scrolled to the top. */
$$(".sheet").forEach(sh => {
  // wrap content below the header in a scrolling body so the sheet itself never scrolls
  const body = document.createElement("div"); body.className = "sheet-body";
  [...sh.children].forEach(ch => { if (!ch.classList.contains("grab") && !ch.classList.contains("shead")) body.appendChild(ch); });
  sh.appendChild(body);
  let y0 = null, off = 0, y = 0, dragging = false, tr = null, pid = null;
  const begin = (cy) => {
    const c = ctl(sh); c.h = sh.offsetHeight; c.linkScrim = true;
    c.spring.stop(); off = cy - c.spring.value; dragging = true; tr = new Motion.Tracker(); tr.add(0, cy);
  };
  const move = (cy) => {
    const c = ctl(sh); tr.add(0, cy);
    let ny = cy - off;
    if (ny < 0) ny = -Motion.rubberband(-ny, c.h);
    y = ny; c.spring.set(ny);
  };
  const end = () => {
    if (!dragging) return; dragging = false;
    const c = ctl(sh), v = tr.velocity().y;
    const projected = y + Motion.project(v, 0.99);
    const close = Math.abs(v) > 500 ? v > 0 : projected > c.h * 0.5;
    if (close && openSheetId) { sheetVelocity = v; closeSheet(); }
    else c.spring.to(0, { damping: Math.abs(v) > 300 ? 0.85 : 1, response: 0.34, velocity: v });
  };
  const canDrag = () => openSheetId && !isWide() && canAnimate();
  // header / handle: pointer events (touch-action: none there)
  sh.addEventListener("pointerdown", e => {
    if (!canDrag() || !e.target.closest(".grab,.shead") || e.target.closest("button")) return;
    pid = e.pointerId; sh.setPointerCapture(pid); y0 = e.clientY; begin(e.clientY);
  });
  sh.addEventListener("pointermove", e => { if (pid === e.pointerId && dragging) move(e.clientY); });
  const pend = e => { if (pid !== e.pointerId) return; pid = null; end(); };
  sh.addEventListener("pointerup", pend); sh.addEventListener("pointercancel", pend);
  // body: pull down when already at the top
  let ty = null, armed = false;
  body.addEventListener("touchstart", e => {
    if (!canDrag() || e.touches.length !== 1 || e.target.closest("input,textarea,select,.slide,.thumbs")) { ty = null; return; }
    ty = e.touches[0].clientY; armed = false;
  }, { passive: true });
  body.addEventListener("touchmove", e => {
    if (ty === null) return;
    const cy = e.touches[0].clientY, d = cy - ty;
    if (!armed) {
      if (Math.abs(d) < 8) return;
      if (d < 0 || body.scrollTop > 0) { ty = null; return; }
      armed = true; begin(cy);
    }
    e.preventDefault(); move(cy);
  }, { passive: false });
  const tend = () => { if (ty === null) return; ty = null; if (armed) end(); armed = false; };
  body.addEventListener("touchend", tend); body.addEventListener("touchcancel", tend);
});
/* close the open sheet (and its history entry), then run fn */
function closeSheetThen(fn) {
  if (!openSheetId) { fn && fn(); return; }
  hideSheet();
  if (history.state && history.state.sheet) { skipPop++; afterPop = fn || null; history.back(); }
  else if (fn) fn();
}
function closeSheet() { closeSheetThen(null); }
document.addEventListener("click", e => {
  const g = e.target.closest("[data-go]"); if (g) { e.preventDefault(); go(g.dataset.go); return; }
  const d = e.target.closest("[data-doc]"); if (d && !e.metaKey && !e.ctrlKey) { e.preventDefault(); openDoc(d.dataset.doc); return; }
  if (e.target.closest("[data-close]")) { closeSheet(); return; }
  const sh = e.target.closest("[data-sheet]"); if (sh) { openSheet(sh.dataset.sheet); return; }
  const a = e.target.closest("[data-act]");
  if (a) {
    const act = a.dataset.act;
    if (act === "example") { hideWelcome(); openPiece(examplePiece()); }
    if (act === "blank") { hideWelcome(); if (openSheetId) closeSheetThen(() => openSheet("new")); else openSheet("new"); }
    if (act === "camera") { if (a.id === "w-camera") store.set("welcomed", "1"); if (openSheetId) closeSheetThen(openCamera); else openCamera(); }
    if (act === "print") closeSheetThen(() => exportParts.length === 1 ? withOnly(exportParts[0], printScore) : exportParts.length ? hud("Do druku wybierz jedną partię albo pobierz PDF", 3500) : printScore());
    if (act === "pdf") closeSheetThen(savePdf);
    if (act === "send-pdf") closeSheetThen(() => savePdf(true));
    if (act === "send-img") closeSheetThen(sendImage);
    if (act === "xml") closeSheetThen(shareXml);
  }
});
$("#scrim").addEventListener("click", () => closeSheet());
/* Legal pages are ordinary pages (shareable links); inside the app they open in a sheet. */
async function openDoc(name) {
  try {
    const r = await fetch(name + ".html"); if (!r.ok) throw new Error();
    const doc = new DOMParser().parseFromString(await r.text(), "text/html");
    const art = doc.querySelector("article.doc"); if (!art) throw new Error();
    $("#sh-doc-t").textContent = art.dataset.title || "";
    const body = $("#doc-body"); body.innerHTML = ""; body.appendChild(document.importNode(art, true));
    body.querySelectorAll('a[href$=".html"]').forEach(a => { const n = a.getAttribute("href").replace(/\.html$/, ""); if (/^(prywatnosc|regulamin|licencje)$/.test(n)) a.dataset.doc = n; });
    body.querySelectorAll('a[href^="http"]').forEach(a => { a.target = "_blank"; a.rel = "noopener"; });
    openSheet("doc");
    const sb = $("#sh-doc .sheet-body"); if (sb) sb.scrollTop = 0;
  } catch { location.href = name + ".html"; }
}
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && cam.open) { closeCamera(); return; }
  if (e.key === "Escape" && openSheetId) closeSheet();
  if (e.key === "Escape" && tourI >= 0) { tourEnd(); return; }
  /* Space plays, except on a focused button (it presses the button) or a field (K40) */
  if (e.key === " " && S.view === "score" && !openSheetId && !/INPUT|TEXTAREA|SELECT|BUTTON|A/.test(document.activeElement.tagName)) { e.preventDefault(); $("#btn-play").click(); }
});

/* ---------------- Home / library ---------------- */
/* the welcome screen has the flat-lay photo; the library uses the others, so no photo appears twice */
const HERO = [];          /* no stock photos: the masthead and the welcome screen are drawn (a staff, coloured notes) */
function setupHero() {
  const st = $("#w-stage"); if (st && !st.innerHTML && typeof STAGE_SVG === "string") st.innerHTML = STAGE_SVG;
  if (!HERO.length) return;
  const h = HERO[Math.floor(Date.now() / 86400000) % HERO.length];
  const img = $("#hero-img"); if (!img) return;          // the library has a drawn masthead now
  img.addEventListener("load", () => img.classList.add("loaded"), { once: true });
  img.src = h.src; $("#hero").style.setProperty("--pos", h.pos);
  if (img.complete && img.naturalWidth) img.classList.add("loaded");
}
function shortKey(label) { if (!label) return ""; const m = label.match(/^(.+?)-(dur|moll)$/); return m ? m[1] : label; }
/* a library that cannot be read is never shown as empty ("Tu będą Twoje nuty" would look like everything is gone) */
function libError(e) {
  let el = $("#lib-err");
  if (!e) { if (el) el.hidden = true; return; }
  console.warn("library", e);
  if (!el) {
    el = document.createElement("section"); el.className = "empty"; el.id = "lib-err";
    el.innerHTML = `<div class="empty-copy"><h2 class="h-l">Nie udało się otworzyć biblioteki</h2><p class="txt">Nuty są w pamięci urządzenia. Spróbuj jeszcze raz. Jeśli to nie pomoże, zamknij Solo i otwórz je ponownie.</p><div class="row-btns"><button class="btn primary" id="lib-retry"><span>Spróbuj jeszcze raz</span></button></div></div>`;
    $("#lib-empty").after(el); $("#lib-retry").addEventListener("click", () => refreshLibrary());
  }
  el.hidden = false; $("#lib").hidden = true; $("#lib-empty").hidden = true;
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && S.view === "home" && $("#lib-err") && !$("#lib-err").hidden) refreshLibrary(); });
async function refreshLibrary(animate) {
  const my = refreshLibrary.n = (refreshLibrary.n || 0) + 1;     // fast typing: an older, slower read never draws over a newer one
  let all;
  try { all = await DB.all(); } catch (e) { if (my === refreshLibrary.n) libError(e); return; }
  if (my !== refreshLibrary.n) return;
  libError(null);
  const q = fold($("#lib-search").value.trim());
  const sort = $("#lib-sort").value;
  renderCols(all);
  const list = all.filter(p => q ? fold((p.title || "") + " " + (p.composer || "")).includes(q) : inCol(p, all));
  const by = { title: (a, b) => (a.title || "").localeCompare(b.title || "", "pl"), composer: (a, b) => (a.composer || "￿").localeCompare(b.composer || "￿", "pl"),
    created: (a, b) => (b.created || 0) - (a.created || 0), opened: (a, b) => (b.opened || b.updated || 0) - (a.opened || a.updated || 0) };
  list.sort(by[sort] || by.opened);
  const uc = cols().find(c => c.id === libCol);
  if (uc && !q) list.sort((a, b) => uc.items.indexOf(a.id) - uc.items.indexOf(b.id));     // a collection keeps its own order
  $("#col-empty").hidden = !!(list.length || q || libCol === "all");
  const fav = new Set(favs());
  const G = $("#lib-grid"); G.innerHTML = "";
  G.classList.toggle("stagger", !refreshLibrary.done && canAnimate()); refreshLibrary.done = true;
  list.forEach((p, idx) => {
    const b = document.createElement("div"); b.className = "card"; b.style.setProperty("--i", Math.min(idx, 14));
    const meta = p.composer || (p.sourceType === "ai" || p.sourceType === "device" ? "Ze zdjęcia" : p.sourceType === "example" ? "Przykład" : p.sourceType === "own" ? "Własne" : "Z pliku");
    /* the whole card opens the piece (a tap on the title used to start renaming it); renaming and everything else
       is in the "⋯" menu, which a long press also opens */
    b.innerHTML = `<button class="thumb" aria-label="Otwórz: ${esc(p.title || "Bez tytułu")}">${p.thumb ? `<img src="${esc(p.thumb)}" alt="">` : `<span class="ph">${esc(p.title || "Bez tytułu")}</span>`}${fav.has(p.id) ? `<i class="fav-badge" aria-hidden="true">${icon("heart-fill")}</i>` : ""}</button>
      <button class="more" aria-label="Więcej: ${esc(p.title || "Bez tytułu")}">${icon("more")}</button>
      <div class="t">${esc(p.title || "Bez tytułu")}</div><div class="m"><span class="c${p.composer ? "" : " ph"}">${esc(meta)}</span>${p.keyLabel ? `<span class="key" aria-label="Tonacja: ${esc(p.keyLabel)}">${esc(shortKey(p.keyLabel))}</span>` : ""}</div>`;
    b.querySelector(".thumb").addEventListener("click", () => { if (b._long) { b._long = false; return; } openFromLibrary(p); });
    b.querySelector(".more").addEventListener("click", () => openCardSheet(p, b));
    [".t", ".m"].forEach(sel => b.querySelector(sel).addEventListener("click", () => openFromLibrary(p)));
    { let t = 0; const th = b.querySelector(".thumb");
      /* Haptic Touch: the card sinks while pressed, lifts when the menu comes, settles back with a spring */
      const up = () => { clearTimeout(t); b.classList.remove("pressing"); };
      th.addEventListener("pointerdown", () => { b._long = false; b.classList.add("pressing"); t = setTimeout(() => { b._long = true; b.classList.remove("pressing"); b.classList.add("lifted"); navigator.vibrate?.(10); openCardSheet(p, b); setTimeout(() => b.classList.remove("lifted"), 420); }, 480); });
      ["pointerup", "pointerleave", "pointercancel"].forEach(ev => th.addEventListener(ev, up));
      th.addEventListener("pointermove", e => { if (Math.abs(e.movementY) > 4 || Math.abs(e.movementX) > 4) up(); });
      th.addEventListener("contextmenu", e => { e.preventDefault(); openCardSheet(p, b); }); }
    G.appendChild(b);
  });
  const has = all.length > 0;
  nudgeBackup(all);
  /* news: a quiet dot on the "Ja" tab instead of a card between the search and the music */
  const nn = $("#news-nudge"); if (nn) nn.hidden = true;
  document.querySelector('#tabbar [data-tab="settings"]')?.classList.toggle("dot", !!(all.length && NEWS[VERSION] && store.get("newsSeen") !== VERSION));
  $("#lib").hidden = !has; $("#lib-empty").hidden = has;
  $("#lib-count").textContent = has ? String(list.length) : "";      // what is shown (filter, search), not everything
  $("#lib-none").hidden = !(has && q && !list.length);
  $("#lib-none").textContent = `Nic nie pasuje do „${$("#lib-search").value.trim()}”.`;
  safariNotice(all);
}
/* rename from the library: the newest record is read again (a save of that piece may have landed since the cards
   were drawn), then its cover (which shows the title) is redrawn without touching the open piece */
async function renameInLibrary(p, field, v) {
  if (field === "title" && !v) v = "Bez tytułu";
  let rec;
  try { const cur = await DB.get(p.id); if (!cur) { refreshLibrary(); return; } rec = { ...cur, [field]: v, updated: Date.now() }; await DB.put(rec); }
  catch (e) { console.warn(e); hud(saveErrorText(e), 4000); return; }
  if (S.piece && S.piece.id === p.id) { S.piece[field] = v; updateTitles(); }
  refreshLibrary();
  try { const thumb = await makeThumb(thumbXml(rec)); await saveThumb(p.id, thumb); refreshLibrary(); } catch (e) { console.warn(e); }
}
$("#lib-search").addEventListener("input", refreshLibrary);
$("#lib-sort").addEventListener("change", () => { store.set("sort", $("#lib-sort").value); refreshLibrary(); });

/* ---------------- Opening a piece ---------------- */
/* the example ("Wlazł kotek" with piano) for the player's own instrument: its octave, transposition and clef */
function examplePiece() {
  const me = mainInstr();
  if (me.id === "puzon") return { xml: exampleXml(), sourceType: "example", title: "", composer: null, instrument: me.name };
  let xml = makePart(readyTuneXml("kotek"), "P1", { role: "melody", instr: me });
  xml = makePart(xml, "P1", { role: "chords", instr: instrById("fortepian") });
  const d = parseXml(xml), root = d.documentElement;
  kids(root, "part").find(p => p.getAttribute("id") === "P1").remove(); kids(kid(root, "part-list"), "score-part").find(p => p.getAttribute("id") === "P1").remove();
  return { xml: new XMLSerializer().serializeToString(d), sourceType: "example", title: "", composer: null, instrument: me.name };
}
/* the piece's state (parts, key, clef, transposition, tempo) without touching the screen */
function loadState(piece, settings) {
  /* "Melodia ludowa" was written in by Solo for its own folk tunes; the composer field stays empty when unknown */
  if (piece && piece.composer === "Melodia ludowa" && /^(example|own)$/.test(piece.sourceType || "")) piece = { ...piece, composer: "" };
  const info = analyseXml(piece.xml);
  S.piece = { ...piece, title: piece.title || info.title || "Bez tytułu", composer: piece.composer ?? info.composer ?? "" };
  S.parts = info.parts; S.srcKey = info.key;
  S.melody = settings && settings.melody && S.parts.some(p => p.id === settings.melody) ? settings.melody : guessMelody(piece.xml, S.parts, piece.instrument);
  const first = S.parts.find(p => p.id === S.melody) || S.parts.find(p => p.keep) || S.parts[0];
  S.srcClef = first ? first.clef : "treble";
  if (first && first.id !== (info.parts.find(p => p.keep) || {}).id) S.srcKey = analyseXml(piece.xml, first.id).key;
  S.clef = "keep"; S.iv = { d: 0, s: 0 }; S.preset = -1; S.bpm = null; S.clefMine = false;
  /* T12: a scanned piece keeps the bars per line of the paper ("Jak w oryginale"), others fit the screen */
  S.hasLines = /<print[^>]*new-system="yes"/.test(piece.xml || "");
  S.layout = S.hasLines ? "orig" : "fit"; S.page = "a4"; S.pageMine = false; S.pz = 1; S.readOct = 0; S.under = ""; S.swing = false;
  if (settings) {
    if (Array.isArray(settings.keep)) S.parts.forEach(p => (p.keep = settings.keep.includes(p.id)));
    if (!S.parts.some(p => p.keep)) S.parts.forEach(p => (p.keep = true));
    if (settings.clef) S.clef = settings.clef;
    S.clefMine = !!settings.clefMine;                                   // chosen by hand in the Klucz sheet: kept as it is
    if (settings.iv) S.iv = { d: settings.iv.d | 0, s: settings.iv.s | 0 };
    if (Number.isInteger(settings.preset)) S.preset = settings.preset;
    if (settings.bpm >= 20 && settings.bpm <= 300) S.bpm = Math.round(settings.bpm);
    if (settings.zoom >= .5 && settings.zoom <= 2) S.zoom = settings.zoom;
    if (settings.pz >= .5 && settings.pz <= 3) S.pz = settings.pz;
    if (Number.isInteger(settings.readOct)) S.readOct = Math.max(-2, Math.min(2, settings.readOct));
    /* settings saved before 3.9: the octave picked for the reading clef sat inside the transposition and moved every
       part; it now belongs to the part being read only */
    else if (S.iv && (S.iv.d || S.iv.s)) { const s12 = S.iv.s, oc = Math.trunc(s12 / 12); if (oc && Math.abs(s12 % 12) <= 6) { S.iv = { d: S.iv.d - 7 * oc, s: s12 - 12 * oc }; S.readOct = oc; } }
    if (settings.layout === "orig" || settings.layout === "fit") S.layout = settings.layout;
    if (settings.page === "a4" || settings.page === "screen") S.page = settings.page;
    S.pageMine = !!settings.pageMine;
    S.under = settings.under === "chord" || settings.under === "fn" ? settings.under : ""; S.swing = !!settings.swing;
  }
  /* clef and key chosen by hand for the view (before 4.0 test 44) are dropped: they are edited in the music now;
     the automatic clef/octave for the instrument (ensureOnStaff) still applies */
  if (S.preset >= 0 || S.iv.d || S.iv.s || S.clefMine) { S.iv = { d: 0, s: 0 }; S.preset = -1; S.clef = "keep"; S.clefMine = false; S.readOct = 0; }
  if (S.piece.instrument == null) S.piece.instrument = first && !PIANO_RE.test(first.name) ? first.name : "";
  const rp = S.parts.find(p => p.id === readingPartId()); if (rp) S.srcClef = rp.clef;     // the clef of the part being read
}
/* the music must sit on the staff: if most notes of the part being read are far off it (an old setting, a wrong
   octave), the octave that fits is taken and the player is told */
/* the instrument a part is written for, only when its name (or the piece) says so; null when unknown */
/* the instrument a part declares (<score-instrument>, written by Solo for every part it adds or changes) */
function declaredOf(pid) {
  if (!S.piece) return null; if (declaredOf.xml !== S.piece.xml) { declaredOf.xml = S.piece.xml; declaredOf.map = {}; [...parseXml(S.piece.xml).getElementsByTagName("score-part")].forEach(sp => { const i = declaredInstr(sp); if (i) declaredOf.map[sp.getAttribute("id")] = i; }); }
  return declaredOf.map[pid] || null;
}
function namedInstr(pid) { return partInstr(pid).ins; }
/* One decision per part, used by playback (concert pitch, timbre), the range tint and the clef check:
   the declared instrument → the part's name (Polish or English, with or without Polish letters) → the piece's
   instrument. The transposition comes from the file's own <transpose> when it has one (Verovio's MIDI values are
   the written notes: it ignores <transpose>), else from the instrument. Cached per score, so a render or a play
   parses the score once, not once per note. */
const plain = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l").replace(/\s+/g, " ").trim();
const EN_INSTR = [[/piccolo/, "piccolo"], [/alto flute/, "flet-a"], [/recorder/, "flet-p"], [/flute|flauto/, "flet"], [/english horn|cor anglais/, "rozek"], [/oboe/, "oboj"],
  [/bass clarinet/, "klarnet-bas"], [/clarinet (in )?a\b/, "klarnet-a"], [/clarinet (in )?(e♭|eb|es)\b/, "klarnet-es"], [/clarinet/, "klarnet"], [/contrabassoon/, "kontrafagot"], [/bassoon/, "fagot"],
  [/soprano sax/, "sax-s"], [/alto sax/, "sax-a"], [/tenor sax/, "sax-t"], [/bari(tone)? sax/, "sax-b"], [/flugel/, "flugelhorn"], [/cornet/, "kornet"], [/trumpet (in )?c\b/, "trabka-c"], [/trumpet/, "trabka"],
  [/horn/, "waltornia"], [/bass trombone/, "puzon-b"], [/alto trombone/, "puzon-alt"], [/trombone/, "puzon"], [/euphonium/, "eufonium"], [/baritone/, "baryton"], [/tuba/, "tuba"], [/sousaphone/, "suzafon"],
  [/violin/, "skrzypce"], [/viola/, "altowka"], [/cello/, "wiolonczela"], [/double bass|contrabass|string bass/, "kontrabas"], [/bass guitar|electric bass/, "gitara-bas"], [/guitar/, "gitara"],
  [/glockenspiel/, "dzwonki"], [/xylophone/, "ksylofon"], [/vibraphone/, "wibrafon"]];
function instrByName(name) {
  const n = plain(String(name || "").replace(/ (I|II|III|IV|V|VI|\d)$/, "")); if (!n) return null;
  const en = EN_INSTR.find(([re]) => re.test(n));
  return INSTRUMENTS.find(i => plain(i.name) === n) || INSTRUMENTS.find(i => n.length >= 4 && plain(i.name).startsWith(n)) ||
    INSTRUMENTS.find(i => n.startsWith(plain(i.name) + " ")) || (en && INSTRUMENTS.find(i => i.id === en[1])) || null;
}
/* the score's part names and <transpose> elements, read once per score */
function scoreParts() {
  const xml = S.piece ? S.piece.xml : "", c = scoreParts.c; if (c && c.xml === xml) return c;
  const out = { xml, names: {}, tr: {} };
  try {
    const doc = parseXml(xml);
    [...doc.getElementsByTagName("score-part")].forEach(sp => { out.names[sp.getAttribute("id")] = txt(sp, "part-name"); });
    [...doc.getElementsByTagName("part")].forEach(p => {
      const t = p.getElementsByTagName("transpose")[0]; if (!t) return;
      /* written = sounding + tr (B♭ trumpet: chromatic −2 → tr 2; tenor sax: −2 and octave −1 → 14) */
      out.tr[p.getAttribute("id")] = -((parseInt(txt(t, "chromatic"), 10) || 0) + 12 * (parseInt(txt(t, "octave-change"), 10) || 0));
    });
  } catch (e) { console.warn(e); }
  return (scoreParts.c = out);
}
function partInstr(pid) {
  const xml = S.piece ? S.piece.xml : "", instr = S.piece ? S.piece.instrument : "";
  let c = partInstr.c; if (!c || c.xml !== xml || c.instr !== instr || c.parts !== S.parts) c = partInstr.c = { xml, instr, parts: S.parts, m: new Map() };
  if (c.m.has(pid)) return c.m.get(pid);
  let r = { ins: null, tr: 0, piano: false };
  const dec = declaredOf(pid), p = S.parts && S.parts.find(x => x.id === pid);
  if (dec) r.ins = dec;
  else if (p && (p.staves > 1 || PIANO_RE.test(p.name))) r.piano = true;
  else if (p) {
    const label = typeof partLabel === "function" ? partLabel(p) : p.name;
    /* a part nothing names is not the player's instrument; the piece's instrument names only the melody */
    r.ins = (typeof instrFromName === "function" && instrFromName(label)) || instrByName(label) ||
      (pid === melodyPart() ? (typeof instrFromName === "function" && instrFromName(instr)) || instrByName(instr) : null);
  }
  const xt = scoreParts().tr[pid];
  r.tr = !r.piano && xt !== undefined ? xt : r.ins ? r.ins.tr || 0 : 0;
  c.m.set(pid, r); return r;
}
/* A4 is the view everywhere (Nat, 7 Oct): the page fills the screen's width, four bars a line; "Dopasuj do ekranu"
   stays a choice the player makes */
function fitPageToDevice() { if (!S.pageMine) S.page = "a4"; }
function ensureOnStaff() {
  try {
    /* a clef the instrument is never written in (trombone in treble, left by an older version) becomes its own clef;
       a clef picked by hand in the Klucz sheet stays */
    const ins = namedInstr(readingPartId()), own = ins && clefsOf(ins);
    let swapped = false;
    if (own && !S.clefMine && CLEF_LINES[curClef()] && !own.includes(curClef())) { S.clef = own[0]; S.readOct = fitFor(own[0]).oct; swapped = true; }
    const clef = curClef(), idx = partIndexes(S.piece.xml, [readingPartId()]); if (!idx.length || !CLEF_LINES[clef]) return;
    const cur = ledgerCost(idx.map(x => x + S.iv.d + 7 * (S.readOct || 0)), clef), f = fitFor(clef);
    const curScore = cur + Math.abs(S.readOct || 0) * 0.35;
    if (swapped) return true;
    if (cur > 0.8 && f.oct !== (S.readOct || 0) && f.cost < curScore - 0.6) { const up = f.oct > (S.readOct || 0); S.readOct = f.oct; setTimeout(() => hud(up ? "Oktawę wyżej: nuty mieszczą się na pięciolinii" : "Oktawę niżej: nuty mieszczą się na pięciolinii", 3000), 900); return true; }
  } catch (e) { console.warn(e); }
}
function openPiece(piece, settings) {
  stopPlayback();
  if (saveTimer && S.piece) savePiece();          // the last edit of the piece on screen is saved (its record is taken now)
  /* nothing of the previous piece's view carries over: "only this part", the correcting view, the input length */
  S.only = null; S.keepBefore = null; S.editView = null; S.edTab = null; S.inLen = null;
  try { loadState(piece, settings); } catch (e) { hud(e.message || "Nie udało się otworzyć nut.", 4000); return; }
  fitPageToDevice();
  const refit = !!ensureOnStaff();
  S.dirty = refit && !!S.piece.id; S.thumbDirty = !piece.thumb || refit; S.loadedKey = null;
  S.piece.opened = Date.now();
  if (!store.get("tourDone")) setTimeout(() => { if (S.view === "score" && !openSheetId && !store.get("tourDone")) tourStart(); }, 1600);
  $("#notice").hidden = !(S.piece.issues && S.piece.issues.length);
  if (S.piece.issues && S.piece.issues.length) {
    const nums = doubtfulBars(S.piece.issues), n = nums.length;
    $("#notice-title").textContent = n ? `${n} ${plural(n, "takt", "takty", "taktów")} do sprawdzenia` : "Sprawdź ze zdjęciem";
    $("#notice-text").textContent = n ? `Zaznaczone na fioletowo: ${nums.slice(0, 8).join(", ")}${n > 8 ? " i inne" : ""}. Porównaj je ze zdjęciem.` : "Odczyt może zawierać błędy.";
  }
  updateTitles();
  S.only = null; S.keepBefore = null;              // "Tylko ta" belongs to the piece it was used in
  $("#peek").hidden = true; pb.loop = null; pb.trainer = null; pb.mute.clear(); pb.resumeMs = 0; $("#loopbar").hidden = true; $("#btn-loop").setAttribute("aria-pressed", "false"); S.undo = []; S.redo = []; S.editSel = null; S.keepSel = null; S.barSel = null; S.editMode = false; $("#editbar").hidden = true; document.body.classList.remove("editing", "editmode"); $("#btn-edit").setAttribute("aria-pressed", "false");
  $("#pages").innerHTML = `<div class="loading-page"><span class="spinner"></span></div>`;
  $("#scroller").scrollTop = 0;
  if (S.view !== "score") go("score");
  render();
  if (piece.id) DB.put({ ...recordFromState(), thumb: piece.thumb || null }).catch(e => console.warn(e)); // remember "opened"
  else if (piece.sourceType !== "example") savePiece();
}
function curKeyName() { return keyName(S.srcKey.fifths + intervalFifths(S.iv), S.srcKey.mode); }
function curClef() { return S.clef === "keep" ? S.srcClef : S.clef; }
function updateTitles() {
  $("#s-title").textContent = S.piece.title || "Bez tytułu";
  const seg = (k, text, ph) => `<button class="seg-t${text ? "" : " ph"}" data-edit="${k}">${esc(text || ph)}</button>`;
  $("#s-sub").innerHTML = [
    seg("composer", S.piece.composer, "Kompozytor"),
    S.parts.filter(p => p.keep).length > 1 ? "" : seg("instrument", S.piece.instrument, "Instrument"),
    CLEF_PL[curClef()] ? seg("clef", "klucz " + CLEF_PL[curClef()]) : "",
    seg("key", curKeyName())
  ].filter(Boolean).join('<span class="dot" aria-hidden="true">·</span>');
  document.title = (S.piece.title || "Nuty") + " · Solo";
}
function changed() {
  S.dirty = true; S.thumbDirty = true;
  updateTitles(); render(); autosave();
  if (openSheetId === "key") syncKeySheet();
}
$("#notice-x").addEventListener("click", () => fadeOut($("#notice"), 180));

/* ---------------- Saving ---------------- */
function recordFromState() {
  const now = Date.now();
  return {
    /* the id is given at once, before the first save finishes: a second save meanwhile (the thumbnail, the clef fitted
       to the instrument) wrote the same new piece again under its own new id, so it appeared twice (Nat, 7 Oct) */
    id: S.piece.id || (S.piece.id = "p" + now.toString(36) + Math.random().toString(36).slice(2, 7)),
    title: S.piece.title || "Bez tytułu", composer: S.piece.composer || "", instrument: S.piece.instrument || "",
    xml: S.piece.xml, sourceType: S.piece.sourceType || "file", images: S.piece.images || [], aiJson: S.piece.aiJson || null,
    issues: S.piece.issues || [], lines: S.piece.lines || null, origXml: S.piece.origXml || null, trShift: S.piece.trShift || 0, partRoles: S.piece.partRoles || null, created: S.piece.created || now, updated: S.dirty ? now : (S.piece.updated || now), opened: S.piece.opened || now,
    settings: { melody: S.melody || null, keep: S.parts.filter(p => p.keep).map(p => p.id), clef: (S.editView || S).clef, iv: (S.editView || S).iv, preset: (S.editView || S).preset, bpm: S.bpm, zoom: (S.editView || S).zoom, pz: S.pz, readOct: (S.editView || S).readOct || 0, pageMine: !!S.pageMine, clefMine: !!S.clefMine, layout: S.layout, page: (S.editView || S).page, under: S.under || "", swing: !!S.swing },
    keyLabel: curKeyName(), clefLabel: CLEF_PL[curClef()] || "", thumb: S.piece.thumb || null
  };
}
let saveTimer = null, saving = null;
/* a card drawn before the last save of its piece landed shows an older record: open the saved one */
async function openFromLibrary(p) {
  if (saving) { await saving; p = (await DB.get(p.id).catch(() => null)) || p; }
  openPiece(p, p.settings);
}
function autosave() { clearTimeout(saveTimer); saveTimer = setTimeout(savePiece, 500); }
/* the record is taken before any wait: by the time the database answers another piece may be open */
async function savePiece() {
  clearTimeout(saveTimer); saveTimer = null;
  if (!S.piece) return false;
  /* the example, once changed, is the player's own piece: nothing may ever replace it again */
  if (S.piece.sourceType === "example" && S.dirty) S.piece.sourceType = "own";
  const piece = S.piece, rec = recordFromState(), job = putRecord(rec);
  saving = job; job.finally(() => { if (saving === job) saving = null; });
  if (!(await job)) return false;
  piece.id = rec.id; piece.created = rec.created; piece.updated = rec.updated; if (S.piece === piece) S.dirty = false;
  if (!store.get("persisted")) { try { navigator.storage?.persist?.().then(ok => ok && store.set("persisted", "1")); } catch {} }
  if (!DB.ok) hud("Ta przeglądarka nie pozwala zapisywać. Nuty znikną po zamknięciu.", 4000);
  return true;
}
async function putRecord(rec) {
  try { await DB.put(rec); return true; }
  catch (e) { console.warn("save", e); hud(saveErrorText(e), 4500); return false; }
}
/* the cover of a piece from its record, without leaving that piece in S: the music for it is prepared in one go
   (nothing can run in between), the slow drawing works from that text */
const thumbSrc = () => ({ xml: processedXml(), opts: a4Options({}, 1), key: curKeyName() });
function thumbXml(rec) {
  const keys = Object.keys(S), saved = { ...S };
  try { loadState(rec, rec.settings); return thumbSrc(); }
  finally { keys.forEach(k => (S[k] = saved[k])); Object.keys(S).forEach(k => { if (!(k in saved)) delete S[k]; }); S.loadedKey = null; }
}
/* only the cover changes: the newest record is read again, so a rename or a later save is never undone */
async function saveThumb(id, thumb, more) {
  try { const cur = await DB.get(id); if (!cur) return; await DB.put({ ...cur, ...more, thumb }); }      // deleted meanwhile: stays deleted
  catch (e) { console.warn(e); }
}
async function leaveScore() {
  stopPlayback();
  if (!S.piece) return;
  /* left while correcting (back arrow instead of ✓): the view the player chose goes back before saving */
  if (S.editView) { Object.assign(S, S.editView); S.editView = null; S.editMode = false; S.loadedKey = null; }
  const needSave = S.piece.id || S.dirty;
  if (S.piece.sourceType === "example" && !S.piece.id && !S.dirty) { clearTimeout(saveTimer); saveTimer = null; return; }
  if (!needSave) return;
  const piece = S.piece, wantThumb = S.thumbDirty, rec = recordFromState();
  if (!(await savePiece())) return;               // at once: an edit made just before leaving is kept
  if (S.view === "home") refreshLibrary();
  if (!wantThumb) return;
  await settle(); await idle();                   // heavy drawing only after the screen has settled
  try {
    /* another piece may be open by now: the cover is made from the record taken when leaving */
    const thumb = await makeThumb(S.piece === piece ? thumbSrc() : thumbXml({ ...rec, id: piece.id }));
    if (S.piece === piece) { piece.thumb = thumb; S.thumbDirty = false; }
    await saveThumb(piece.id, thumb);
    if (S.view === "home") refreshLibrary();
  } catch (e) { console.warn(e); }
}

/* ---------------- Rendering ---------------- */
/* An A4 page. The SVG is always drawn at the page's width, so "bigger notes" means a smaller
   virtual page: the notes keep their size in Verovio units and the page shrinks around them. */
function a4Options(extra, zoom = S.zoom) {
  const z = zoom, r = v => Math.round(v / z);
  return { pageWidth: r(2100), pageHeight: r(2970), scale: 50, adjustPageHeight: false, breaks: castsOff() ? "line" : S.layout === "orig" && S.hasLines ? "encoded" : "auto", header: "auto", footer: "none",
    pageMarginTop: r(110), pageMarginBottom: r(110), pageMarginLeft: r(150), pageMarginRight: r(150), spacingSystem: 6, svgViewBox: true,
    transpose: intervalString(S.iv), justifyVertically: false, breaksNoWidow: true, ...extra };
}
function enlargeTitle(root, factor, shift = 1.25) {
  const head = root.querySelector(".pgHead"); if (!head || !S.piece) return;
  const rends = [...head.querySelectorAll("tspan.rend")];
  const ys = rends.filter(r => r.getAttribute("text-anchor") === "middle").map(r => parseFloat(r.getAttribute("y"))).filter(Number.isFinite).sort((a, b) => a - b);
  const title = (S.piece.title || "Bez tytułu").trim();
  const tr = rends.find(r => r.textContent.trim() === title);
  if (!tr || ys.length < 2) return;
  const gap = ys[1] - ys[0];
  tr.setAttribute("y", String(Math.round(ys[0] + gap * shift)));
  tr.querySelectorAll("tspan[font-size]").forEach(t => { const v = parseFloat(t.getAttribute("font-size")); if (v) t.setAttribute("font-size", Math.round(v * factor) + "px"); });
}
let renderTimer = null;
/* while the key slider is being dragged the music is drawn at most every 250 ms (a full drawing per key step made
   the drag stutter); the last key is drawn when the finger stops */
function render() { clearTimeout(renderTimer); let drag = false; try { drag = slider.dragging; } catch {} renderTimer = setTimeout(doRender, drag ? 250 : 40); }
async function doRender() {
  if (!S.piece || S.view !== "score") return;
  if ($("#score").hidden) { renderTimer = setTimeout(doRender, 30); return; }
  await settle();                               // let the push animation finish before the heavy render
  await engineReady;
  /* a rotation, a zoom or a new key re-draws the music: playing carries on from the same place (no count-in) */
  const resumeAt = playState && !S.editMode ? playPos() : null;
  if (playState || pb.preparing) stopPlayback();
  const box = $("#pages");
  const width = Math.min(960, box.parentElement.clientWidth) - 28;
  /* A4 pages, as on paper on every screen; "Dopasuj do ekranu" is the option for bigger notes */
  const mode = S.page === "screen" ? "reflow" : "pages";
  try {
    const xml = processedXml();
    let opts;
    if (mode === "pages") opts = a4Options({}, 1);
    else {
      const px = 38 * S.zoom;
      opts = { pageWidth: Math.round(width * 100 / px), pageHeight: 60000, adjustPageHeight: true, scale: Math.round(px), breaks: S.layout === "orig" && S.hasLines ? "encoded" : "auto", header: "auto", footer: "none",
        pageMarginLeft: 50, pageMarginRight: 50, pageMarginTop: 60, pageMarginBottom: 60, spacingSystem: 8, svgViewBox: false, transpose: intervalString(S.iv), justifyVertically: false, breaksNoWidow: true };
    }
    tk.setOptions(opts);
    if (!tk.loadData(xml)) throw new Error("Nie udało się narysować nut.");
    let html = "";
    for (let i = 1; i <= tk.getPageCount(); i++) html += `<div class="page${mode === "reflow" ? " reflow" : ""}">${tk.renderToSVG(i)}</div>`;
    const firstShow = S.loadedKey !== "view";
    box.innerHTML = html;
    box.classList.remove("fresh"); if (firstShow && canAnimate()) { void box.offsetWidth; box.classList.add("fresh"); }
    const first = box.querySelector(".page svg"); if (first) { if (mode === "pages") enlargeTitle(first, 1.9); else enlargeTitle(first, 1.3, 0.75); }
    const doubt = new Set(doubtfulBars(S.piece.issues));
    if (doubt.size) { const order = drawnBars(xml); $$("#pages g.measure").forEach((g, i) => g.classList.toggle("doubt", doubt.has(order[i]))); }
    S.fromMs = 0; S.fromBar = -1;
    if (S.keepSel) { const k = S.keepSel; S.keepSel = null; selectNote(k); } else if (S.editSel) selectNote(null);
    S.mode = mode; S.loadedKey = "view"; applyPageZoom(); renderPartStrip(); markRange(); markBarSel();
    requestAnimationFrame(() => { drawLoop(); syncLoopUi(); });
    S.baseBpm = scoreBpm(); $("#tp-bpm").textContent = String(curBpm());
    if (openSheetId === "more") syncTempo();
    if (resumeAt !== null) setTimeout(() => { if (!playState && !pb.preparing && S.view === "score") play(resumeAt, { noCount: true }); }, 0);
  } catch (e) {
    console.error(e);
    box.innerHTML = `<div class="page-msg">${esc(e.message || "Nie udało się narysować nut.")}</div>`;
  }
}
let lastW = window.innerWidth;
window.addEventListener("resize", () => { if (Math.abs(window.innerWidth - lastW) > 40) { lastW = window.innerWidth; render(); } });
/* ---------------- T18: correcting notes by tapping ---------------- */
const ED_TYPES = ["16th", "eighth", "quarter", "half", "whole"], ED_LEN = { "16th": .25, eighth: .5, quarter: 1, half: 2, whole: 4 };
/* the drawn note -> the MusicXML <note>: same bar, same staff (= part), same position among notes and rests.
   Any part can be corrected, except a piano (two staves: its notes are not in drawing order). */
const NOTE_SEL = "g.note, g.rest, g.mRest";
function staffSlots() {
  const out = [];
  S.parts.filter(p => p.keep).forEach(p => { const n = p.staves || 1; for (let k = 0; k < n; k++) out.push({ pid: p.id, multi: n > 1 }); });
  return out;
}
const staffsOf = m => [...m.children].filter(c => c.classList && c.classList.contains("staff"));
function locateNote(el) {
  const m = el.closest("g.measure"); if (!m) return null;
  const di = [...$$("#pages g.measure")].indexOf(m), bar = drawnBars(processedXml())[di];
  const st = el.closest("g.staff"), si = Math.max(0, staffsOf(m).indexOf(st)), slot = staffSlots()[si];
  if (!slot) return null;
  if (slot.multi) return { piano: true };
  const i = [...(st || m).querySelectorAll(NOTE_SEL)].indexOf(el);
  return bar && i >= 0 ? { bar, i, di, si, pid: slot.pid } : null;
}
function drawnNote(sel) {
  const m = $$("#pages g.measure")[sel.di], st = m && (staffsOf(m)[sel.si] || m);
  return st ? [...st.querySelectorAll(NOTE_SEL)][sel.i] : null;
}
/* in correcting mode a finger does not have to hit the note head: the closest note or rest is taken */
function nearestNote(x, y, max = 90, sel = NOTE_SEL) {
  let best = null, bd = Infinity;
  $$("#pages " + sel.split(", ").join(", #pages ")).forEach(g => {
    const r = g.getBoundingClientRect(); if (!r.width && !r.height) return;
    const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom), d = dx * dx + 2 * dy * dy;
    if (d < bd) { bd = d; best = g; }
  });
  return bd < max * max ? best : null;
}
/* "Belka": the chosen note and the next one are joined by a beam, or parted when they already are */
function beamJoined(doc, at) {
  const auto = at.m.getElementsByTagName("beam").length ? doc : autoBeam(parseXml(new XMLSerializer().serializeToString(doc)));
  const a2 = auto === doc ? at : xmlNoteAt(auto, S.editSel);
  const b = a2 && a2.n && [...a2.n.getElementsByTagName("beam")].find(y => (y.getAttribute("number") || "1") === "1");
  return !!b && ["begin", "continue"].includes(b.textContent.trim());
}
function beamTap() {
  const sel = S.editSel; if (!sel) return;
  const doc = parseXml(S.piece.xml), at = xmlNoteAt(doc, sel); if (!at || !at.n) return;
  const join = !beamJoined(doc, at), r = setBeamJoin(doc, at.m, at.n, join);
  if (r === "last") { hud("To ostatnia nuta w takcie: belka łączy nuty w jednym takcie"); return; }
  if (r === "long") { hud("Belką łączy się ósemki i krótsze nuty"); return; }
  pushUndo(); S.piece.xml = new XMLSerializer().serializeToString(doc); S.keepSel = sel;
  afterEdit(); hud(join ? "Połączone belką z następną" : "Rozdzielone");
}
function xmlNoteAt(doc, sel) {
  const part = [...doc.getElementsByTagName("part")].find(p => p.getAttribute("id") === sel.pid); if (!part) return null;
  const m = kids(part, "measure")[sel.bar - 1]; if (!m) return null;
  return { part, m, n: kids(m, "note")[sel.i] || null };
}
/* run once the music is on the screen (the first drawing loads the engine and can take a few seconds) */
function whenDrawn(fn, tries = 40) { if ($("#pages g.measure")) setTimeout(fn, 250); else if (tries) setTimeout(() => whenDrawn(fn, tries - 1), 200); }
/* Correcting mode shows the notes as written (no transposition or other clef), so a tap on a line is that note */
function setEditMode(on) {
  on = !!on; if (on === !!S.editMode && on) return;
  S.editMode = on;
  /* editing keeps the page as it is (Nat, 7 Oct: no zoom when editing starts); only the notes are shown as written */
  if (on) {
    const moved = S.iv.d || S.iv.s || S.clef !== "keep" || S.readOct;
    S.editView = { iv: S.iv, clef: S.clef, preset: S.preset, page: S.page, zoom: S.zoom, readOct: S.readOct };
    S.iv = { d: 0, s: 0 }; S.clef = "keep"; S.preset = -1; S.readOct = 0;
    S.loadedKey = null; render(); if (moved) hud("Poprawiasz nuty tak, jak są zapisane", 2500);
  }
  if (!on && S.editView) { Object.assign(S, S.editView); S.editView = null; S.loadedKey = null; changed(); }
  if (!on) S.editSel = null;
  syncEditButton(on);
  if (on && playState) stopPlayback(true);
  selectNote(S.editSel);
}
const LEN_PL = { whole: "cała nuta", half: "półnuta", quarter: "ćwierćnuta", eighth: "ósemka", "16th": "szesnastka" };
function edTab(name) {
  $$("#editbar [data-tab-ed]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tabEd === name)));
  $$("#editbar .ed-pane").forEach(p => (p.hidden = p.dataset.pane !== name));
  S.edTab = name;
  if (name === "bar") buildBarSheet(); else markBarSel();          // Takt sits in the tool panel like the other tools (the music stays in view)
}
function selectNote(sel) {
  S.editSel = sel; if (sel) S.editMode = true;
  const on = !!S.editMode;
  document.body.classList.toggle("editing", on); document.body.classList.toggle("editmode", on);
  syncEditButton(on);
  $("#editbar").hidden = !on;
  $$("#pages g.nsel").forEach(g => g.classList.remove("nsel"));
  $("#ed-undo").disabled = !(S.undo && S.undo.length); syncRedo();
  if (S.edTab == null) edTab(null);          // editing opens with no tool open (Nat, 7 Oct); a tool opens when tapped
  const at = sel ? xmlNoteAt(parseXml(S.piece.xml), sel) : null, n = at && at.n, isRest = !!(n && kid(n, "rest"));
  $$("#editbar .ed-pane:not([data-pane=len]):not([data-pane=bar]) button").forEach(b => (b.disabled = !n || (isRest && !["rest", "delete", "left", "right"].includes(b.dataset.ed))));
  const cur = n ? (txt(n, "type") || "whole") : (S.inLen || "quarter");
  $$("#editbar [data-len]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.len === cur)));
  $("#ed-dot").setAttribute("aria-pressed", String(!!(n && kid(n, "dot"))));
  if (n) { const docB = parseXml(S.piece.xml), atB = xmlNoteAt(docB, sel), on = !!atB && beamJoined(docB, atB); $("#ed-beam").setAttribute("aria-pressed", String(on)); $("#ed-beam").setAttribute("aria-label", on ? "Rozdziel belkę z następną nutą" : "Połącz belką z następną nutą"); $("#ed-beam").disabled = isRest || !BEAMABLE[txt(n, "type")]; }
  $("#ed-rest").innerHTML = icon(isRest ? "n-quarter" : "rest"); $("#ed-rest").setAttribute("aria-label", isRest ? "Zamień na nutę" : "Zamień na pauzę");
  if (!n) { $("#ed-info").innerHTML = `Dotknij pięciolinii, żeby dopisać nutę <svg class="i"><use href="#n-${cur === "16th" ? "16th" : cur}"/></svg>, albo wybierz narzędzie`; return; }
  const el = drawnNote(sel); if (el) el.classList.add("nsel");
  const p = kid(n, "pitch"), len = LEN_PL[txt(n, "type")] || "";
  if (p) {
    /* the name as written (Dis is not Es, Ces is not H), Polish style; the octave of the written letter (his małe) */
    const oct = parseInt(txt(p, "octave"), 10);
    $("#ed-info").innerHTML = `<b>${plName(txt(p, "step"), Math.round(parseFloat(txt(p, "alter")) || 0))}</b> ${OCTAVE_NAMES[oct] || ""} · ${len}${kid(n, "dot") ? " z kropką" : ""} · takt ${sel.bar}`;
  } else $("#ed-info").innerHTML = `<b>Pauza</b> · ${len || "cały takt"} · takt ${sel.bar}`;
}
/* the sound of a note when it is placed or changed: exactly as the player will play it (children hear what is
   written). The pitch as written (its alter: the key and the accidentals in effect), in the key and reading octave
   chosen for the view (correcting shows the notes as written, the chosen view waits in S.editView), as concert
   pitch for its instrument (a B♭ trumpet sounds a tone lower), at the tuning A; its length at the playing tempo with
   dots and ties; its dynamic, hairpin and articulation; its part's instrument or own sound. A new note cuts the one
   before with a short fade (no click). */
const pv = { g: null };
function previewNote(n) {
  const p = n && kid(n, "pitch"); if (!p) return;
  try {
    let part = n.parentNode; while (part && part.tagName !== "part") part = part.parentNode;
    const pid = part ? part.getAttribute("id") : S.editSel && S.editSel.pid, v = S.editView || S, info = S.parts.find(x => x.id === pid);
    const oct = pid === readingPartId() && !(info && info.staves > 1) ? 12 * (v.readOct || 0) : 0;
    const pitch = midiOf(p) + ((v.iv && v.iv.s) || 0) + oct - partTr(pid);
    const sh = (part && partShapes(part).get(n)) || NOTE_PLAIN, sec = Math.max(0.12, Math.min(8, sh.q * 60 / playBpm()));
    const ctx = fxCtx();                                              // the shared context (asleep when quiet)
    if (pv.g) { const old = pv.g; try { old.gain.setTargetAtTime(0, ctx.currentTime, 0.008); } catch {} setTimeout(() => { try { old.disconnect(); } catch {} }, 120); }
    const g = pv.g = ctx.createGain(); g.gain.value = 0.16; g.connect(ctx.destination);
    playShaped(ctx, g, voiceForPart(pid), (tuner.a4 || 440) * Math.pow(2, (pitch - 69) / 12), ctx.currentTime + 0.01, sec, sh);
    fxIdle(Math.max(8000, sec * 1000 + 3000));
    setTimeout(() => { if (pv.g === g) pv.g = null; try { g.disconnect(); } catch {} }, sec * 1000 + 1500);
  } catch (e) { console.warn(e); }
}
/* which written note a height on the staff means: the five lines of the tapped staff give the steps */
function pitchAtY(staff, y, part, m) {
  const lines = [...staff.children].filter(c => c.tagName === "path").slice(0, 5).map(l => l.getBoundingClientRect().top).sort((a, b) => a - b);
  if (lines.length < 5) return null;
  const gap = (lines[4] - lines[0]) / 4, steps = Math.round((lines[4] - y) / (gap / 2));
  return (CLEF_BOTTOM[clefAt(part, m)] ?? 18) + Math.max(-8, Math.min(16, steps));
}
/* a tap in correcting mode: on (or right next to) a note → that note; elsewhere on a staff → a new note of the
   chosen length at that height, in place of the rest there (the bar keeps adding up) */
function editTap(e) {
  /* with Takt open a tap chooses the bar (and the part) Takt works on; it never writes a note */
  if (S.edTab === "bar") {
    const m = e.target.closest("g.measure") || measureAt(e.clientX, e.clientY); if (!m) return;
    const di = measureEls().indexOf(m), bar = drawnBars(processedXml())[di]; if (!bar) return;
    const any = [...m.querySelectorAll("g.note, g.rest, g.mRest")].sort((a, b) => { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); return Math.abs(ra.top + ra.height / 2 - e.clientY) - Math.abs(rb.top + rb.height / 2 - e.clientY); })[0];
    const loc = any && locateNote(any);
    S.editSel = null; S.barSel = { bar, pid: loc && !loc.piano ? loc.pid : readingPartId() };
    buildBarSheet(); return;
  }
  const near = e.target.closest("g.note") || nearestNote(e.clientX, e.clientY, 22, "g.note");
  if (near) { const sel = locateNote(near); if (sel && sel.piano) { hud("Partii fortepianu nie poprawisz tutaj.", 3000); return; } if (sel) { selectNote(sel); previewNote(xmlNoteAt(parseXml(S.piece.xml), sel)?.n); } return; }
  const restEl = e.target.closest("g.rest, g.mRest") || nearestNote(e.clientX, e.clientY, 60, "g.rest, g.mRest");
  if (!restEl) { const any = nearestNote(e.clientX, e.clientY, 90); if (any) selectNote(locateNote(any)); else selectNote(null); return; }
  const sel = locateNote(restEl); if (!sel || sel.piano) return;
  const doc = parseXml(S.piece.xml), at = xmlNoteAt(doc, sel); if (!at || !at.n) return;
  const staff = restEl.closest("g.staff"), idx = staff && pitchAtY(staff, e.clientY, at.part, at.m); if (idx == null) return;
  const n = at.n, r = kid(n, "rest"), st = STEP_N[((idx % 7) + 7) % 7], oct = Math.floor(idx / 7), alt = keyAlter(keyAt(at.part, at.m), st);
  const np = doc.createElement("pitch"); np.innerHTML = `<step>${st}</step>${alt ? `<alter>${alt}</alter>` : ""}<octave>${oct}</octave>`;
  n.replaceChild(np, r);
  const { div, cap } = barCap(at.part, at.m), want = S.inLen || "quarter";
  const room = parseFloat(txt(n, "duration")) || cap, len = ED_LEN[want] * div <= room + 1e-6 ? want : ED_TYPES.slice().reverse().find(t => ED_LEN[t] * div <= room + 1e-6) || "16th";
  kid(n, "duration").textContent = String(ED_LEN[len] * div);
  let ty = kid(n, "type"); if (!ty) { ty = doc.createElement("type"); kid(n, "voice") ? kid(n, "voice").after(ty) : kid(n, "duration").after(ty); } ty.textContent = len;
  kids(n, "dot").forEach(d => d.remove()); plainLen(n);
  fitBar(doc, at.part, at.m, n);
  /* writing your own melody in its last bar: one empty bar is ready after it (the final double bar moves with it);
     a scan or a file keeps its bars */
  const ms = kids(at.part, "measure");
  if (at.m === ms[ms.length - 1] && S.piece.sourceType === "own") [...doc.getElementsByTagName("part")].forEach(part => {
    const last = kids(part, "measure").pop(), nm = emptyBar(doc, part, last);
    nm.setAttribute("number", String(kids(part, "measure").length + 1)); last.after(nm);
    const fin = kids(last, "barline").find(b => (b.getAttribute("location") || "right") === "right" && !kid(b, "repeat")); if (fin) nm.appendChild(fin);
  });
  pushUndo(); S.piece.xml = new XMLSerializer().serializeToString(doc);
  previewNote(n); S.editSel = sel; afterEdit();
}
$$("#editbar [data-tab-ed]").forEach(b => b.addEventListener("click", () => edTab(S.edTab === b.dataset.tabEd ? null : b.dataset.tabEd)));     // a second tap closes the tool
$$("#editbar [data-len]").forEach(b => b.addEventListener("click", () => { S.inLen = b.dataset.len; if (S.editSel) editNote("len:" + b.dataset.len); else selectNote(null); }));
/* divisions and the length of a full bar (in divisions) at a bar */
function barCap(part, m) {
  let div = 1, beats = 4, bt = 4;
  for (const mm of kids(part, "measure")) {
    kids(mm, "attributes").forEach(a => {
      const d = kid(a, "divisions"); if (d) div = parseFloat(d.textContent) || div;
      const t = kid(a, "time"); if (t) { beats = beatsOf(txt(t, "beats")) || beats; bt = parseInt(txt(t, "beat-type"), 10) || bt; }
    });
    if (mm === m) break;
  }
  return { div, cap: div * 4 * beats / bt };
}
const divisionsAt = (part, m) => barCap(part, m).div;
function restNote(doc, dur, type, voice, staff) {
  const r = doc.createElement("note");
  r.innerHTML = `<rest/><duration>${dur}</duration><voice>${voice || 1}</voice>` + (type ? `<type>${type}</type>` : "") + (staff ? `<staff>${staff}</staff>` : "");
  return r;
}
/* an empty bar after m (a whole-bar rest; both staves of a piano part) */
function emptyBar(doc, part, m) {
  const { cap } = barCap(part, m), two = twoStaff(part), nm = doc.createElement("measure");
  nm.innerHTML = `<note><rest measure="yes"/><duration>${cap}</duration><voice>1</voice>${two ? "<staff>1</staff>" : ""}</note>` + (two ? `<backup><duration>${cap}</duration></backup><note><rest measure="yes"/><duration>${cap}</duration><voice>5</voice><staff>2</staff></note>` : "");
  return nm;
}
/* a length set by hand is a plain length: no triplet mark left on it (its sound and its look would disagree) */
function plainLen(n) {
  kids(n, "time-modification").forEach(x => x.remove());
  const no = kid(n, "notations"); if (no) { kids(no, "tuplet").forEach(x => x.remove()); if (!no.children.length) no.remove(); }
}
/* after a note gets shorter or longer the bar still adds up: the rests right after it are taken away
   and the gap is filled again, each rest starting on its beat (as printed music does). In a bar with two voices
   (<backup>) only the edited note's own voice is fitted. */
function fitBar(doc, part, m, after) {
  const { div, cap } = barCap(part, m), len = n => (kid(n, "chord") || kid(n, "grace")) ? 0 : (parseFloat(txt(n, "duration")) || 0);
  const all = [...m.children], i0 = all.indexOf(after), voice = txt(after, "voice") || "1", staff = txt(after, "staff");
  let a = i0, b = i0; while (a > 0 && all[a - 1].tagName !== "backup") a--; while (b < all.length - 1 && all[b + 1].tagName !== "backup") b++;
  const seg = new Set(all.slice(a, b + 1)), mine = el => seg.has(el) && el.tagName === "note" && (txt(el, "voice") || "1") === voice;
  const notes = () => [...m.children].filter(mine);
  for (let nx = after.nextElementSibling; nx && seg.has(nx) && !(mine(nx) && !kid(nx, "rest"));) {
    const next = nx.nextElementSibling; if (mine(nx) && !kid(nx, "chord")) nx.remove(); nx = next;
  }
  let total = notes().reduce((s, n) => s + len(n), 0), later = false;
  for (let nx = after.nextElementSibling; total > cap + 1e-6 && nx && seg.has(nx);) {           // still too long: rests further on go
    const next = nx.nextElementSibling;
    if (mine(nx) && kid(nx, "rest") && !kid(nx, "chord")) { total -= len(nx); nx.remove(); later = true; }
    nx = next;
  }
  /* what is left over after rests further on went is filled at the end of the bar (after the voice's last note) */
  const end = later ? notes().filter(x => !kid(x, "chord")).pop() : after;
  let pos = 0; for (const n of notes()) { pos += len(n); if (n === end) break; }
  let gap = cap - total, at = end;
  /* rests show the beat (Gould): each starts where its own length divides the bar; in 6/8, 9/8, 12/8 a whole beat is
     a dotted quarter rest; in 4/4 a half rest only on beat 1 or 3 (the alignment rule gives that) */
  const t8 = (() => { let b = 4, t = 4; for (const mm of kids(part, "measure")) { kids(mm, "attributes").forEach(a => { const x = kid(a, "time"); if (x) { b = beatsOf(txt(x, "beats")) || b; t = parseInt(txt(x, "beat-type"), 10) || t; } }); if (mm === m) break; } return t === 8 && b % 3 === 0; })();
  const opts = [["whole", 4, false], ...(t8 ? [["half", 3, true], ["quarter", 1.5, true]] : []), ["half", 2, false], ["quarter", 1, false], ["eighth", 0.5, false], ["16th", 0.25, false]];
  while (gap > 1e-6) {
    /* in 6/8 a quarter rest also fills the rest of a beat after its first eighth (♪ 𝄽) */
    const endsBeat = q => t8 && q === 1 && Math.abs((pos / div + 1) / 1.5 - Math.round((pos / div + 1) / 1.5)) < 1e-6;
    const o = opts.find(([t, q]) => { const d = q * div; return d <= gap + 1e-6 && (Math.abs(pos / d - Math.round(pos / d)) < 1e-6 || endsBeat(q)) && !(t8 && t === "quarter" && q === 1 && Math.abs(pos / (1.5 * div) - Math.round(pos / (1.5 * div))) < 1e-6 && gap >= 1.5 * div - 1e-6); });
    if (!o) break;
    const [t, q, dot] = o, d = q * div, r = restNote(doc, d, t, voice, staff);
    if (dot) kid(r, "type").after(doc.createElement("dot"));
    while (at.nextElementSibling && kid(at.nextElementSibling, "chord")) at = at.nextElementSibling;    // after a chord's last note
    at.after(r); seg.add(r); at = r; gap -= d; pos += d;
  }
  return total <= cap + 1e-6;
}
/* a note longer than the room left in its bar is tied over the barline (Gould: never hide the barline), taking the
   place of rests at the start of the next bar; false when it cannot (notes there, two voices, a chord) */
function tieOver(doc, part, m, n) {
  const { div, cap } = barCap(part, m), len = x => (kid(x, "chord") || kid(x, "grace")) ? 0 : (parseFloat(txt(x, "duration")) || 0);
  const notes = kids(m, "note"), over = notes.reduce((s, x) => s + len(x), 0) - cap; if (over <= 1e-6) return true;
  if (kids(m, "backup").length || !kid(n, "pitch") || (n.nextElementSibling && kid(n.nextElementSibling, "chord"))) return false;
  if (notes.slice(notes.indexOf(n) + 1).some(x => !kid(x, "chord") && len(x) > 0)) return false;
  const ms = kids(part, "measure"), nx = ms[ms.indexOf(m) + 1]; if (!nx || kids(nx, "backup").length) return false;
  let room = 0; for (const e of kids(nx, "note")) { if (kid(e, "chord")) continue; if (!kid(e, "rest")) break; room += len(e); }
  if (room + 1e-6 < over || len(n) - over < div / 4 - 1e-6) return false;
  const tieIn = [...n.getElementsByTagName("tie")].some(t => t.getAttribute("type") === "stop"), tieOut = [...n.getElementsByTagName("tie")].some(t => t.getAttribute("type") === "start");
  const piece = (q, val, first, last) => {
    const c = n.cloneNode(true);
    [...c.getElementsByTagName("tie")].forEach(x => x.remove()); [...c.getElementsByTagName("tied")].forEach(x => x.remove()); kids(c, "dot").forEach(x => x.remove()); plainLen(c);
    if (!first) { kids(c, "accidental").forEach(x => x.remove()); kids(c, "lyric").forEach(x => x.remove()); const no = kid(c, "notations"); if (no) no.remove(); }
    kid(c, "duration").textContent = String(val[0] * div); kid(c, "type").textContent = val[1]; if (val[2]) kid(c, "type").after(doc.createElement("dot"));
    const ties = [...(first ? (tieIn ? ["stop"] : []) : ["stop"]), ...(last ? (tieOut ? ["start"] : []) : ["start"])];
    ties.slice().reverse().forEach(t => { const e = doc.createElement("tie"); e.setAttribute("type", t); kid(c, "duration").after(e); });
    if (ties.length) { let no = kid(c, "notations"); if (!no) { no = doc.createElement("notations"); c.insertBefore(no, kid(c, "lyric") || null); } ties.forEach(t => { const e = doc.createElement("tied"); e.setAttribute("type", t); no.insertBefore(e, no.firstChild); }); }
    return c;
  };
  const v1 = noteValues((len(n) - over) / div), v2 = noteValues(over / div), all = [...v1.map(v => [v, "a"]), ...v2.map(v => [v, "b"])];
  const made = all.map(([v, w], i) => ({ w, el: piece(0, v, i === 0, i === all.length - 1) }));
  made.filter(x => x.w === "a").forEach(x => n.before(x.el));
  const firstNote = kids(nx, "note")[0], bs = made.filter(x => x.w === "b").map(x => x.el);
  bs.forEach(el => nx.insertBefore(el, firstNote));
  n.remove(); kids(nx, "note").forEach(e => { const r = kid(e, "rest"); if (r) r.removeAttribute("measure"); });
  fitBar(doc, part, nx, bs[bs.length - 1]);
  return true;
}
/* undo and redo: whole scores (notes, bars, parts); a part added or removed is read again */
function pushUndo() {
  S.undo = S.undo || []; S.undo.push(S.piece.xml); if (S.undo.length > 60) S.undo.shift(); S.redo = [];
  /* "Przywróć odczyt" is for a reading from a photo only (never the player's own work or a file) */
  if (!S.piece.origXml && fromPhoto()) S.piece.origXml = S.undo[0];
}
const fromPhoto = () => !!S.piece && (S.piece.sourceType === "device" || S.piece.sourceType === "ai");
const canRestore = () => fromPhoto() && !!S.piece.origXml && S.piece.origXml !== S.piece.xml;
function syncRedo() { const b = $("#ed-redo"); if (b) b.disabled = !(S.redo && S.redo.length); }
function restoreXml(xml) {
  const ids = x => analyseXml(x).parts.map(p => p.id).join();
  if (ids(xml) === ids(S.piece.xml)) { S.piece.xml = xml; refreshInfo(); }
  else { applyNewXml(xml, null); if (S.editMode) Object.assign(S, { iv: { d: 0, s: 0 }, clef: "keep", preset: -1, readOct: 0 }); }
  afterEdit();
}
function undo() { if (!S.undo || !S.undo.length) return false; (S.redo = S.redo || []).push(S.piece.xml); restoreXml(S.undo.pop()); return true; }
function redo() { if (!S.redo || !S.redo.length) return false; S.undo.push(S.piece.xml); restoreXml(S.redo.pop()); return true; }
function editNote(op) {
  if (op === "done") { setEditMode(false); return; }
  if (op.startsWith("len:") && !S.editSel) return;
  if (op === "bar") { edTab("bar"); return; }
  if (op === "beam") { beamTap(); return; }
  if (op === "undo") { undo(); return; }
  if (op === "redo") { redo(); return; }
  const sel = S.editSel; if (!sel) return;
  const doc = parseXml(S.piece.xml), at = xmlNoteAt(doc, sel); if (!at || !at.n) return;
  const n = at.n, p = kid(n, "pitch"), fifths = keyAt(at.part, at.m);
  const dropAcc = () => kids(n, "accidental").forEach(a => a.remove());
  const setAlter = v => { if (!p) return; let al = kid(p, "alter"); if (v) { if (!al) { al = doc.createElement("alter"); p.insertBefore(al, kid(p, "octave")); } al.textContent = String(v); } else if (al) al.remove(); dropAcc(); };
  /* a tie joins two equal notes: when one of them changes pitch (or becomes a rest) the tie goes from both */
  const pitched = () => [...at.part.getElementsByTagName("note")].filter(x => kid(x, "pitch") && !kid(x, "grace"));
  const untie = x => {
    const has = t => [...x.getElementsByTagName("tie")].some(e => e.getAttribute("type") === t), all = pitched(), k = all.indexOf(x);
    const drop = (el, t) => { if (!el) return; [...el.getElementsByTagName("tie"), ...el.getElementsByTagName("tied")].filter(e => e.getAttribute("type") === t).forEach(e => e.remove()); const no = kid(el, "notations"); if (no && !no.children.length) no.remove(); };
    if (has("start")) { drop(all.slice(k + 1).find(y => txt(kid(y, "pitch"), "step") === txt(kid(x, "pitch"), "step") && txt(kid(y, "pitch"), "octave") === txt(kid(x, "pitch"), "octave") && !kid(y, "chord") === !kid(x, "chord")), "stop"); drop(x, "start"); }
    if (has("stop")) { drop(all.slice(0, k).reverse().find(y => txt(kid(y, "pitch"), "step") === txt(kid(x, "pitch"), "step") && txt(kid(y, "pitch"), "octave") === txt(kid(x, "pitch"), "octave")), "start"); drop(x, "stop"); }
  };
  /* a slur on a note that leaves (a rest, a deleted chord note) goes with its other end */
  const unslur = x => {
    const no = kid(x, "notations"); if (!no) return; const all = pitched(), k = all.indexOf(x);
    kids(no, "slur").forEach(s => { const num = s.getAttribute("number") || "1", t = s.getAttribute("type"), other = t === "start" ? all.slice(k + 1) : all.slice(0, k).reverse();
      for (const y of other) { const z = [...y.getElementsByTagName("slur")].find(e => (e.getAttribute("number") || "1") === num && e.getAttribute("type") === (t === "start" ? "stop" : "start")); if (z) { const yn = z.parentNode; z.remove(); if (!yn.children.length) yn.remove(); break; } }
      s.remove(); });
  };
  const toRest = x => {        // a note becomes a rest of the same length: its chord notes, tie, slur, accidental, lyric go
    let nx = x.nextElementSibling; while (nx && kid(nx, "chord")) { const nn = nx.nextElementSibling; nx.remove(); nx = nn; }
    untie(x); unslur(x);
    const q = kid(x, "pitch"); x.replaceChild(doc.createElement("rest"), q);
    ["accidental", "stem", "beam", "notehead", "lyric", "tie"].forEach(t => kids(x, t).forEach(e => e.remove()));
    const no = kid(x, "notations"); if (no) { ["tied", "articulations", "ornaments", "technical"].forEach(t => kids(no, t).forEach(e => e.remove())); if (!no.children.length) no.remove(); }
  };
  const move = d => { if (!p) return; untie(n); const idx = parseInt(txt(p, "octave"), 10) * 7 + STEP_I[txt(p, "step")] + d, st = STEP_N[((idx % 7) + 7) % 7]; kid(p, "step").textContent = st; kid(p, "octave").textContent = String(Math.floor(idx / 7)); setAlter(keyAlter(fifths, st)); };
  const toNote = () => {
    const r = kid(n, "rest"), prev = [...at.part.getElementsByTagName("pitch")].filter(x => x.compareDocumentPosition(n) & 4).pop();
    const np = doc.createElement("pitch"), clef = clefAt(at.part, at.m), mid = (CLEF_BOTTOM[clef] ?? 18) + 4;
    np.innerHTML = prev ? prev.innerHTML : `<step>${STEP_N[mid % 7]}</step><octave>${Math.floor(mid / 7)}</octave>`;
    if (!prev) { const a = keyAlter(fifths, STEP_N[mid % 7]); if (a) np.insertBefore(Object.assign(doc.createElement("alter"), { textContent: String(a) }), np.lastChild); }
    const whole = r.getAttribute("measure") === "yes";
    n.replaceChild(np, r);
    if (whole) {        // an empty bar: the new note is a quarter note, rests fill the bar
      const { div } = barCap(at.part, at.m); kid(n, "duration").textContent = String(div);
      let ty = kid(n, "type"); if (!ty) { ty = doc.createElement("type"); kid(n, "voice") ? kid(n, "voice").after(ty) : kid(n, "duration").after(ty); }
      ty.textContent = "quarter"; fitBar(doc, at.part, at.m, n);
    }
  };
  /* a length set on a note: the bar is fitted; a note too long for what is left of the bar is tied into the next */
  const setLen = (t, dotted) => {
    const div = divisionsAt(at.part, at.m), r = kid(n, "rest"); if (r) r.removeAttribute("measure");
    kids(n, "dot").forEach(d => d.remove()); plainLen(n);
    kid(n, "duration").textContent = String(ED_LEN[t] * div * (dotted ? 1.5 : 1));
    let ty = kid(n, "type"); if (!ty) { ty = doc.createElement("type"); kid(n, "voice") ? kid(n, "voice").after(ty) : kid(n, "duration").after(ty); }
    ty.textContent = t; if (dotted) ty.after(doc.createElement("dot"));
    for (let c = n.nextElementSibling; c && kid(c, "chord"); c = c.nextElementSibling) { kid(c, "duration").textContent = kid(n, "duration").textContent; kids(c, "dot").forEach(d => d.remove()); plainLen(c); const ct = kid(c, "type"); if (ct) { ct.textContent = t; if (dotted) ct.after(doc.createElement("dot")); } }
    if (fitBar(doc, at.part, at.m, n)) return true;
    if (!kid(n, "rest") && tieOver(doc, at.part, at.m, n)) { hud("Nuta przechodzi do następnego taktu (z łukiem)", 2200); S.editSel = null; return true; }
    hud("To się nie mieści w takcie", 2500); return false;
  };
  if (op.startsWith("len:") || op === "dot") {
    if (kid(n, "chord")) return;               // a chord note has the length of the chord's first note
    const t = op === "dot" ? (txt(n, "type") || "quarter") : op.slice(4), dotted = op === "dot" ? !kid(n, "dot") : false;
    if (!setLen(t, dotted)) return;
  } else if (op === "left" || op === "right") {
    /* the note (with its chord) changes places with its neighbour; at the bar line it goes into the next or previous
       bar, only for a neighbour of the same length (both bars still add up) */
    const sib = x => { let y = op === "left" ? x.previousElementSibling : x.nextElementSibling; while (y && (y.tagName !== "note" || kid(y, "chord"))) y = op === "left" ? y.previousElementSibling : y.nextElementSibling; return y; };
    const group = x => { const g = [x]; for (let c = x.nextElementSibling; c && kid(c, "chord"); c = c.nextElementSibling) g.push(c); return g; };
    if (kid(n, "chord")) return;
    let other = sib(n), bar = sel.bar;
    if (other && (txt(other, "voice") || "1") !== (txt(n, "voice") || "1")) other = null;
    if (!other) {
      const ms = kids(at.part, "measure"), mi = ms.indexOf(at.m) + (op === "left" ? -1 : 1), nm = ms[mi]; if (!nm) return;
      const ns = kids(nm, "note").filter(x => !kid(x, "chord")); other = op === "left" ? ns[ns.length - 1] : ns[0]; if (!other) return; bar = mi + 1;
      if (Math.abs((parseFloat(txt(other, "duration")) || 0) - (parseFloat(txt(n, "duration")) || 0)) > 1e-6 || kids(at.m, "backup").length || kids(nm, "backup").length) { hud("Przez kreskę taktową przejdzie tylko nuta tej samej długości", 3000); return; }
      kids(other, "rest").forEach(r => r.removeAttribute("measure"));
    }
    const ga = group(n), gb = group(other), pa = doc.createElement("x"), pb2 = doc.createElement("x");
    ga[0].before(pa); gb[0].before(pb2); ga.forEach(x => pb2.before(x)); gb.forEach(x => pa.before(x)); pa.remove(); pb2.remove();
    const i = kids(n.parentNode, "note").indexOf(n);
    S.editSel = { ...sel, bar, i, di: bar === sel.bar ? sel.di : Math.max(0, sel.di + (op === "left" ? -1 : 1)) };
  } else if (op.startsWith("dyn:") || op.startsWith("wedge:") || op.startsWith("art:") || op === "fermata" || op === "slur") {
    /* markings on the selected note, as in printed parts: dynamics and hairpins below the staff, articulations
       on the note, a slur to the next note; the same button again takes the mark away */
    const nots = () => { let x = kid(n, "notations"); if (!x) { x = doc.createElement("notations"); n.insertBefore(x, kid(n, "lyric") || null); } return x; };
    const before = n.previousElementSibling, dirBefore = t => before && before.tagName === "direction" && before.getElementsByTagName(t)[0] ? before : null;
    if (op.startsWith("dyn:")) {
      const v = op.slice(4), old = dirBefore("dynamics"), same = old && old.getElementsByTagName(v)[0];
      if (old) old.remove();
      if (!same) { const d = doc.createElement("direction"); d.setAttribute("placement", "below"); d.innerHTML = `<direction-type><dynamics><${v}/></dynamics></direction-type>`; n.before(d); }
    } else if (op.startsWith("wedge:")) {
      const kind = op.slice(6), old = dirBefore("wedge");
      if (old) {
        /* the hairpin's own end goes with it (the next stop of the same number), not every end in the bar */
        const num = old.getElementsByTagName("wedge")[0].getAttribute("number") || "1", dirs = [...at.part.getElementsByTagName("direction")], k = dirs.indexOf(old);
        const stop = dirs.slice(k + 1).find(d => [...d.getElementsByTagName("wedge")].some(w => w.getAttribute("type") === "stop" && (w.getAttribute("number") || "1") === num));
        old.remove(); if (stop) stop.remove();
      }
      else {
        const d = doc.createElement("direction"); d.setAttribute("placement", "below"); d.innerHTML = `<direction-type><wedge type="${kind}"/></direction-type>`; n.before(d);
        const e = doc.createElement("direction"); e.setAttribute("placement", "below"); e.innerHTML = `<direction-type><wedge type="stop"/></direction-type>`;
        const last = kids(at.m, "note").pop(); last.after(e);                 // to the end of the bar
      }
    } else if (op.startsWith("art:")) {
      const v = op.slice(4), x = nots(); let a = kid(x, "articulations"); if (!a) { a = doc.createElement("articulations"); x.appendChild(a); }
      const ex = kid(a, v); if (ex) ex.remove(); else a.appendChild(doc.createElement(v));
      if (!a.children.length) a.remove(); if (!x.children.length) x.remove();
    } else if (op === "fermata") {
      const x = nots(), ex = kid(x, "fermata"); if (ex) ex.remove(); else x.appendChild(doc.createElement("fermata")); if (!x.children.length) x.remove();
    } else {
      const notes = [...at.part.getElementsByTagName("note")].filter(x => !kid(x, "chord") && !kid(x, "grace") && kid(x, "pitch")), k = notes.indexOf(n), nx = notes[k + 1];
      const x = nots(), ex = [...x.getElementsByTagName("slur")].find(sl => sl.getAttribute("type") === "start");
      if (ex) { ex.remove(); const stop = nx && [...nx.getElementsByTagName("slur")].find(sl => sl.getAttribute("type") === "stop"); if (stop) stop.remove(); if (!x.children.length) x.remove(); }
      else if (nx) { const st = doc.createElement("slur"); st.setAttribute("type", "start"); st.setAttribute("number", "1"); x.appendChild(st); let y = kid(nx, "notations"); if (!y) { y = doc.createElement("notations"); nx.insertBefore(y, kid(nx, "lyric") || null); } const sp = doc.createElement("slur"); sp.setAttribute("type", "stop"); sp.setAttribute("number", "1"); y.appendChild(sp); }
    }
  } else if (op === "up") move(1); else if (op === "down") move(-1);
  else if (op === "octup") move(7); else if (op === "octdown") move(-7);
  else if (op === "flat") setAlter(-1); else if (op === "sharp") setAlter(1); else if (op === "natural") setAlter(0);
  else if (op === "shorter" || op === "longer") {
    const div = divisionsAt(at.part, at.m), r = kid(n, "rest");
    let cur = txt(n, "type") || ED_TYPES.find(t => Math.abs(ED_LEN[t] * div - parseFloat(txt(n, "duration"))) < .01) || "quarter";
    if (r && r.getAttribute("measure") === "yes") cur = "whole";
    const ni = Math.max(0, Math.min(ED_TYPES.length - 1, ED_TYPES.indexOf(cur) + (op === "longer" ? 1 : -1))), nt = ED_TYPES[ni];
    kids(n, "dot").forEach(d => d.remove());
    if (r) r.removeAttribute("measure");
    if (kid(n, "chord")) return;
    if (!setLen(nt, false)) return;
  } else if (op === "rest") {
    if (p) { if (kid(n, "chord")) { untie(n); unslur(n); n.remove(); S.editSel = null; } else toRest(n); }
    else toNote();
  } else if (op === "add") {
    /* a rest becomes a note; a note gets a copy right after it (taking the place of the rests that follow) */
    if (kid(n, "rest")) toNote();
    else {
      if (kid(n, "chord")) return;
      let last = n; while (last.nextElementSibling && kid(last.nextElementSibling, "chord")) last = last.nextElementSibling;
      const c = n.cloneNode(true); kids(c, "chord").forEach(x => x.remove());
      /* the copy is a plain note: no tie, slur or lyric carried over */
      ["tie", "lyric"].forEach(t => kids(c, t).forEach(x => x.remove())); const cn = kid(c, "notations"); if (cn) { ["tied", "slur"].forEach(t => kids(cn, t).forEach(x => x.remove())); if (!cn.children.length) cn.remove(); }
      last.after(c);
      if (!fitBar(doc, at.part, at.m, c)) { hud("To się nie mieści w takcie", 2500); return; }
      S.editSel = { ...sel, i: kids(at.m, "note").indexOf(c) };
    }
  } else if (op === "delete") {
    /* a note leaves a rest of the same length (the bar still adds up); a chord note just goes (the head's next note
       takes its place); a rest goes away */
    if (p && kid(n, "chord")) { untie(n); unslur(n); n.remove(); S.editSel = null; }
    else if (p && n.nextElementSibling && kid(n.nextElementSibling, "chord")) { untie(n); unslur(n); const nx = n.nextElementSibling; kids(nx, "chord").forEach(x => x.remove()); n.remove(); }
    else if (p) toRest(n);
    else if (kids(at.m, "note").length > 1) { n.remove(); S.editSel = null; }
  }
  pushUndo();
  S.piece.xml = new XMLSerializer().serializeToString(doc);
  /* a change you can hear is heard: pitch, length, dot, dynamic, hairpin, articulation */
  if (["up", "down", "octup", "octdown", "flat", "sharp", "natural", "rest", "add", "dot", "shorter", "longer"].includes(op) || /^(len|dyn|wedge|art):/.test(op)) previewNote(op === "add" ? kids(at.m, "note")[S.editSel ? S.editSel.i : 0] : n);
  afterEdit();
}
function keyAt(part, m) { let f = 0; for (const mm of kids(part, "measure")) { kids(mm, "attributes").forEach(a => { const k = kid(a, "key"); if (k) f = parseInt(txt(k, "fifths"), 10) || 0; }); if (mm === m) break; } return f; }
function clefAt(part, m) { let c = "G"; for (const mm of kids(part, "measure")) { kids(mm, "attributes").forEach(a => kids(a, "clef").forEach(x => c = clefId(x))); if (mm === m) break; } return CLEF_BOTTOM[c] != null ? c : "G"; }
function timeAt(part, m) { const { div, cap } = barCap(part, m); let t = null; for (const mm of kids(part, "measure")) { kids(mm, "attributes").forEach(a => { const x = kid(a, "time"); if (x) t = `${txt(x, "beats")}/${txt(x, "beat-type")}`; }); if (mm === m) break; } return t || (cap / div === 4 ? "4/4" : ""); }
/* key, clef and parts are read again after a change to the music itself */
function refreshInfo() {
  const info = analyseXml(S.piece.xml, melodyId()); S.srcKey = info.key;
  S.parts.forEach(p => { const q = info.parts.find(x => x.id === p.id); if (q) Object.assign(p, { clef: q.clef, staves: q.staves, name: q.name }); });
  const first = S.parts.find(p => p.id === readingPartId()) || S.parts[0]; if (first) S.srcClef = first.clef;
}
/* ---------------- the bar sheet: metre, clef, key signature, adding and removing bars, tempo ---------------- */
function barTarget() {
  if (S.editSel) return { bar: S.editSel.bar, pid: S.editSel.pid };
  if (S.editMode && S.barSel) return S.barSel;          // a bar tapped while Takt is open
  const b = S.fromBar >= 0 ? drawnBars(processedXml())[S.fromBar] : null;
  return { bar: b || 1, pid: readingPartId() };
}
function attrsOf(doc, m) {
  let a = kid(m, "attributes");
  if (!a) { a = doc.createElement("attributes"); const pr = kid(m, "print"); pr ? pr.after(a) : m.insertBefore(a, m.firstChild); }
  return a;
}
const ATTR_ORDER = ["footnote", "level", "divisions", "key", "time", "staves", "part-symbol", "instruments", "clef"];
function putAttr(a, el) {
  kids(a, el.tagName).forEach(x => x.remove());
  const after = ATTR_ORDER.indexOf(el.tagName), nx = [...a.children].find(c => ATTR_ORDER.indexOf(c.tagName) > after);
  a.insertBefore(el, nx || null);
}
function markBarSel() {
  $$("#pages g.measure.bsel").forEach(g => g.classList.remove("bsel"));
  if (!S.editMode || S.edTab !== "bar") return;
  const { bar } = barTarget(), di = drawnBars(processedXml()).indexOf(bar), g = measureEls()[di]; if (g) g.classList.add("bsel");
}
function buildBarSheet() {
  const { bar, pid } = barTarget(), doc = parseXml(S.piece.xml);
  const part = [...doc.getElementsByTagName("part")].find(p => p.getAttribute("id") === pid) || doc.getElementsByTagName("part")[0];
  const m = part && kids(part, "measure")[bar - 1]; if (!m) return;
  $("#sh-bar-t").textContent = "";
  /* the bar Takt works on is marked in the music */
  markBarSel();
  $("#bar-note").textContent = bar === 1 ? "Metrum, klucz i znaki zmieniają się w całym utworze." : `Metrum, klucz i znaki zmieniają się od taktu ${bar} do końca.`;
  const t = timeAt(part, m), c = clefAt(part, m), k = keyAt(part, m);
  /* the metre is written when the choice settles (one change, one undo step), not at every tap */
  meterInline($("#bar-time"), t, v => { clearTimeout(buildBarSheet.t); buildBarSheet.t = setTimeout(() => barOp("time", v), 800); });
  $$("#bar-clef button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === c)));
  $("#bar-clef-t").textContent = `Klucz · ${partLabel(S.parts.find(x => x.id === pid) || { id: pid, name: "" }) || "ta partia"}`;
  const mode = (() => { const k1 = kids(part, "measure")[0]?.getElementsByTagName("key")[0]; return k1 && txt(k1, "mode") === "minor" ? "minor" : S.srcKey?.mode || "major"; })();
  const k1 = keyAt(part, kids(part, "measure")[0]), n = Math.abs(k1);
  $("#bar-keyname").textContent = keyName(k1, mode);
  $("#bar-keysig").textContent = !n ? "Bez znaków" : `${n} ${k1 > 0 ? plural(n, "krzyżyk", "krzyżyki", "krzyżyków") : plural(n, "bemol", "bemole", "bemoli")}`;
  $$("#bar-keypick [data-kd]").forEach(b => (b.disabled = Math.abs(k1 + +b.dataset.kd) > 7));
  $("#bar-key").value = String(k);
  $("#bar-del").disabled = kids(part, "measure").length < 2;
  $("#bar-bpm").textContent = String(curBpm());
}
/* any metre (Nat, 7 Oct): four common ones one tap away, and a small field shaped like a chip to type any other:
   the top number 1-32 (an additive 3+2+2 too: the phone keypad has "+"), the bottom one 1, 2, 4, 8, 16 or 32 */
const METERS = ["4/4", "3/4", "2/4", "6/8"], METER_BT = [1, 2, 4, 8, 16, 32];
function meterPicker(box, cur, pick) { beatPicker(box, cur, pick); }
/* the metre as beats (Nat, 7 Oct, Soundbrenner-like), the same everywhere: − / + set how many beats, the note value
   says what one beat is (half, quarter, eighth, 16th). In the notes the dots also group the beats: a dot tapped on
   starts a group, so 7 eighths with groups at 1, 4 and 6 are written 3+2+2/8. The metronome uses the same controls;
   its dots are its accents. */
const METER_UNITS = [[2, "n-half", "Półnuta"], [4, "n-quarter", "Ćwierćnuta"], [8, "n-eighth", "Ósemka"], [16, "n-16th", "Szesnastka"]];
function meterControls(box, beats, unit, onBeats, onUnit) {
  box.innerHTML = `<div class="mc-row"><button type="button" class="pill round" data-mc="-1" aria-label="Mniej uderzeń"><svg class="i"><use href="#minus"/></svg></button>
      <b class="mc-n" aria-live="polite">${beats} ${plural(beats, "uderzenie", "uderzenia", "uderzeń")}</b>
      <button type="button" class="pill round" data-mc="1" aria-label="Więcej uderzeń"><svg class="i"><use href="#plus"/></svg></button></div>
    <div class="seg mc-unit" role="group" aria-label="Jedno uderzenie to">${METER_UNITS.map(([u, ic, nm]) => `<button type="button" data-u="${u}" aria-pressed="${u === unit}" aria-label="${nm}"><svg class="i"><use href="#${ic}"/></svg></button>`).join("")}</div>`;
  box.querySelectorAll("[data-mc]").forEach(b => { b.disabled = beats + +b.dataset.mc < 1 || beats + +b.dataset.mc > 16; b.onclick = () => onBeats(beats + +b.dataset.mc); });
  box.querySelectorAll("[data-u]").forEach(b => (b.onclick = () => onUnit(+b.dataset.u)));
}
/* the metre in one line for the editor: "4/4", − / + for the beats, the note value */
function meterInline(box, cur, pick) {
  const [top, bt] = String(cur || "4/4").split("/");
  let beats = Math.max(1, Math.min(16, beatsOf(top) || 4)), unit = [2, 4, 8, 16].includes(+bt) ? +bt : 4, shown = String(cur || "4/4");
  const draw = () => {
    box.innerHTML = `<b class="mi-val">${esc(shown)}</b>
      <button type="button" class="pill round sm" data-d="-1" aria-label="Mniej uderzeń" ${beats <= 1 ? "disabled" : ""}><svg class="i"><use href="#minus"/></svg></button>
      <button type="button" class="pill round sm" data-d="1" aria-label="Więcej uderzeń" ${beats >= 16 ? "disabled" : ""}><svg class="i"><use href="#plus"/></svg></button>
      <div class="seg mi-unit" role="group" aria-label="Jedno uderzenie to">${METER_UNITS.map(([u, ic, nm]) => `<button type="button" data-u="${u}" aria-pressed="${u === unit}" aria-label="${nm}"><svg class="i"><use href="#${ic}"/></svg></button>`).join("")}</div>`;
    box.querySelectorAll("[data-d]").forEach(b => (b.onclick = () => { beats = Math.max(1, Math.min(16, beats + +b.dataset.d)); shown = `${beats}/${unit}`; draw(); pick(shown); }));
    box.querySelectorAll("[data-u]").forEach(b => (b.onclick = () => { unit = +b.dataset.u; shown = `${beats}/${unit}`; draw(); pick(shown); }));
  };
  draw();
}
function beatPicker(box, cur, pick) {
  const [top, bt] = String(cur || "4/4").split("/");
  let unit = [2, 4, 8, 16].includes(+bt) ? +bt : 4, beats = Math.max(1, Math.min(16, beatsOf(top) || 4));
  const starts = new Set([0]); String(top).split("+").reduce((acc, g) => { starts.add(acc); return acc + (parseInt(g, 10) || 0); }, 0);
  const value = () => { const st = [...starts].filter(i => i < beats).sort((a, b) => a - b), g = st.map((x, i) => (st[i + 1] ?? beats) - x); return `${g.length > 1 ? g.join("+") : beats}/${unit}`; };
  const draw = () => {
    box.classList.add("bpick");
    box.innerHTML = `<div class="bp-dots" role="group" aria-label="Uderzenia: dotknij, żeby zacząć grupę">${Array.from({ length: beats }, (_, i) => `<button type="button" class="bp-dot" data-i="${i}" aria-pressed="${starts.has(i)}" ${i ? "" : "disabled"} aria-label="Uderzenie ${i + 1}${starts.has(i) ? ", początek grupy" : ""}"></button>`).join("")}</div>
      <div class="bp-ctl"></div><p class="note bp-val">${esc(value())}${starts.size > 1 ? "" : " · dotknij kropki, żeby podzielić na grupy"}</p>`;
    box.querySelectorAll(".bp-dot").forEach(d => (d.onclick = () => { const i = +d.dataset.i; if (starts.has(i)) starts.delete(i); else starts.add(i); draw(); pick(value()); }));
    meterControls($(".bp-ctl", box), beats, unit, n => { beats = n; [...starts].forEach(i => { if (i >= n) starts.delete(i); }); draw(); pick(value()); }, u => { unit = u; draw(); pick(value()); });
  };
  draw();
}
function barOp(op, val) {
  const { bar, pid } = barTarget(), doc = parseXml(S.piece.xml), parts = [...doc.getElementsByTagName("part")];
  const later = (part, from) => kids(part, "measure").slice(from);          // this bar and all after it
  if (op === "time") {
    const [b, bt] = val.split("/");
    parts.forEach(part => {
      const ms = kids(part, "measure"); if (!ms[bar - 1]) return;
      later(part, bar).forEach(mm => kids(mm, "attributes").forEach(a => kids(a, "time").forEach(x => x.remove())));
      const t = doc.createElement("time"); t.innerHTML = `<beats>${b}</beats><beat-type>${bt}</beat-type>`; putAttr(attrsOf(doc, ms[bar - 1]), t);
      later(part, bar - 1).forEach(mm => {                       // empty bars take the new length
        const ns = kids(mm, "note"), vs = new Set(ns.map(n => (txt(n, "voice") || "1") + "/" + (txt(n, "staff") || "1")));
        if (!ns.length || vs.size > 1 || !ns.every(n => kid(n, "rest"))) return;     // one voice of rests only (not a piano bar)
        const { div } = barCap(part, mm), keep = ["voice", "staff"].map(k => kid(ns[0], k)).filter(Boolean).map(e => e.outerHTML).join("") || "<voice>1</voice>";
        const tmp = parseXml(`<m>${emptyBarXml(b, +bt, div, keep)}</m>`).documentElement;
        ns.forEach(n => n.remove()); const after = kids(mm, "barline").find(x => x.getAttribute("location") === "right");
        kids(tmp, "note").forEach(n => mm.insertBefore(doc.importNode(n, true), after || null));
      });
    });
  } else if (op === "clef" || op === "key") {
    /* the key is chosen as the part being read is written; a transposing part gets it moved by its own transposition
       (concert F major: a B♭ trumpet part in G major) */
    const trF = id => intervalFifths(trIv(partTr(id)));
    parts.filter(p => op === "key" || p.getAttribute("id") === pid).forEach(part => {
      const ms = kids(part, "measure"); if (!ms[bar - 1]) return;
      /* a clef change keeps the sound (the notes move on the staff) unless "Nuty zostają na liniach" (a misread clef) */
      const oldClef = clefAt(part, ms[bar - 1]), shift = op === "clef" && barClefMode === "lines" ? CLEF_BOTTOM[val] - CLEF_BOTTOM[oldClef] : 0;
      let oldKey = keyAt(part, ms[bar - 1]); const newKey = op === "key" ? +val - trF(pid) + trF(part.getAttribute("id")) : null;
      later(part, bar - 1).forEach((mm, j) => {
        kids(mm, "attributes").forEach(a => {
          const k = kid(a, "key"); if (k) oldKey = parseInt(txt(k, "fifths"), 10) || 0;
          if (j > 0) kids(a, op).forEach(x => x.remove());
        });
        const nk = newKey ?? oldKey;
        kids(mm, "note").forEach(n => {
          const p = kid(n, "pitch"); if (!p) return;
          const st = txt(p, "step"), off = (parseFloat(txt(p, "alter")) || 0) - keyAlter(oldKey, st);
          const idx = parseInt(txt(p, "octave"), 10) * 7 + STEP_I[st] + shift, ns = STEP_N[((idx % 7) + 7) % 7];
          kid(p, "step").textContent = ns; kid(p, "octave").textContent = String(Math.floor(idx / 7));
          const al = keyAlter(nk, ns) + off; let a = kid(p, "alter");
          if (al) { if (!a) { a = doc.createElement("alter"); p.insertBefore(a, kid(p, "octave")); } a.textContent = String(al); } else if (a) a.remove();
          kids(n, "accidental").forEach(x => x.remove());
        });
      });
      const a = attrsOf(doc, ms[bar - 1]);
      if (op === "clef") {
        const c = doc.createElement("clef"); c.innerHTML = val.startsWith("C") ? `<sign>C</sign><line>${val.slice(1)}</line>` : `<sign>${val}</sign><line>${val === "F" ? 4 : 2}</line>`;
        putAttr(a, c);
      } else { const k = doc.createElement("key"); k.innerHTML = `<fifths>${newKey}</fifths>`; putAttr(a, k); }
    });
  } else if (op === "add" || op === "addbefore") {
    parts.forEach(part => {
      const m = kids(part, "measure")[bar - 1]; if (!m) return;
      const nm = emptyBar(doc, part, m);
      if (op === "add") { m.after(nm); const fin = m === kids(part, "measure").slice(-2)[0] && kids(m, "barline").find(b => (b.getAttribute("location") || "right") === "right" && /light-heavy/.test(txt(b, "bar-style")) && !kid(b, "repeat")); if (fin) nm.appendChild(fin); }
      else {          // the new first bar takes over the key, metre and clef
        const a = kid(m, "attributes"); if (a) nm.insertBefore(a, nm.firstChild);
        const pr = kid(m, "print"); if (pr) nm.insertBefore(pr, nm.firstChild);
        m.before(nm);
      }
    });
  } else if (op === "del") {
    parts.forEach(part => {
      const ms = kids(part, "measure"), m = ms[bar - 1], nx = ms[bar]; if (!m || ms.length < 2) return;
      kids(m, "attributes").forEach(a => {            // what was set in the removed bar carries on in the next one
        if (!nx) return; const na = attrsOf(doc, nx);
        [...a.children].forEach(c => { if (!kid(na, c.tagName)) putAttr(na, c.cloneNode(true)); });
      });
      m.remove();
    });
    S.editSel = null;
  }
  parts.forEach(part => kids(part, "measure").forEach((m, i) => m.setAttribute("number", String(i + 1))));
  pushUndo();
  S.piece.xml = new XMLSerializer().serializeToString(doc);
  if (op !== "time" && op !== "clef" && op !== "key") S.editSel = null;
  refreshInfo(); afterEdit();
  /* a new metre re-sizes only empty bars; written bars that no longer add up are said, not silently left red */
  const red = op === "time" ? doubtfulBars(barIssues(S.piece.xml)).filter(b => b >= bar).length : 0;
  hud(red ? `Metrum ${val}. ${red} ${plural(red, "takt trzeba", "takty trzeba", "taktów trzeba")} poprawić (na czerwono)` : { time: `Metrum ${val}`, clef: "Zmieniono klucz", key: "Zmieniono znaki przy kluczu", add: "Dodano takt", addbefore: "Dodano takt", del: "Usunięto takt" }[op], red ? 4000 : 1600);
  buildBarSheet();
}
let barClefMode = "sound";
$$("#bar-clef button").forEach(b => b.addEventListener("click", () => barOp("clef", b.dataset.v)));
/* "Tonacja utworu": the whole piece (every part) moves to the key one fifth up or down the circle, by the nearest
   interval (at most a tritone); the part being edited names the key */
function transposeScore(df) {
  const { pid } = barTarget(), doc = parseXml(S.piece.xml);
  const part = [...doc.getElementsByTagName("part")].find(p => p.getAttribute("id") === pid) || doc.getElementsByTagName("part")[0];
  const k1 = keyAt(part, kids(part, "measure")[0]); if (Math.abs(k1 + df) > 7) return;
  /* of the two ways (up or down), the one that keeps the piece nearest where it was written (no drifting down step by step) */
  const kk = Math.round(7 * df / 12), base = { d: 4 * df - 7 * kk, s: 7 * df - 12 * kk }, tot = S.piece.trShift || 0;
  const iv = [base, { d: base.d + 7, s: base.s + 12 }, { d: base.d - 7, s: base.s - 12 }].reduce((a, b) => Math.abs(tot + b.s) < Math.abs(tot + a.s) ? b : a);
  S.piece.trShift = tot + iv.s;
  pushUndo();
  S.piece.xml = transposeXmlString(S.piece.xml, iv, true);
  refreshInfo(); afterEdit(); buildBarSheet();
  hud(`Tonacja: ${$("#bar-keyname").textContent}`, 1600);
}
$("#bar-keypick").addEventListener("click", e => { const b = e.target.closest("[data-kd]"); if (b && !b.disabled) transposeScore(+b.dataset.kd); });
$("#bar-key").addEventListener("change", e => barOp("key", e.target.value));
$("#bar-add").addEventListener("click", () => barOp("add"));
$("#bar-addbefore").addEventListener("click", () => barOp("addbefore"));
$("#bar-del").addEventListener("click", () => barOp("del"));
[["#bar-bpm-down", -4], ["#bar-bpm-up", 4]].forEach(([s, d]) => $(s).addEventListener("click", () => { setBpm(curBpm() + d); $("#bar-bpm").textContent = String(curBpm()); }));
$("#btn-edit").addEventListener("click", () => setEditMode(!S.editMode));
/* a labelled mode, like forScore/Freeform: "Edytuj" opens it, "Gotowe" closes it (every change is already saved);
   undo/redo sit in the top bar while editing */
function syncEditButton(on) { const b = $("#btn-edit"); b.setAttribute("aria-pressed", String(on)); b.innerHTML = `<span>${on ? "Gotowe" : "Edytuj"}</span>`; }
$$("#ed-undo, #ed-redo").forEach(b => b.addEventListener("click", () => editNote(b.dataset.ed)));
function afterEdit() {
  /* the rhythm check follows the edit: fixed bars lose their red, broken ones get it */
  const other = (S.piece.issues || []).filter(t => !/wartości rytmicznych/.test(t));
  S.piece.issues = [...barIssues(S.piece.xml), ...other].sort((a, b) => parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10));
  S.keepSel = S.editSel; changed();
  $("#ed-undo").disabled = !(S.undo && S.undo.length); syncRedo();
  $("#btn-restore").hidden = !canRestore();
  const nums = doubtfulBars(S.piece.issues);
  if (!$("#notice").hidden || nums.length) { $("#notice").hidden = !nums.length; if (nums.length) { $("#notice-title").textContent = `${nums.length} ${plural(nums.length, "takt", "takty", "taktów")} do sprawdzenia`; $("#notice-text").textContent = `Zaznaczone na fioletowo: ${nums.slice(0, 8).join(", ")}${nums.length > 8 ? " i inne" : ""}. Porównaj je ze zdjęciem.`; } }
}
$$("#editbar [data-ed]").forEach(b => b.addEventListener("click", () => editNote(b.dataset.ed)));
/* asked first, and undoable: the corrections are one tap away from being gone */
$("#btn-restore").addEventListener("click", () => {
  if (!canRestore()) return;
  closeSheetThen(() => askConfirm("Przywrócić odczyt ze zdjęcia?", "Twoje poprawki i dodane partie znikną. Możesz to cofnąć.", "Przywróć", () => {
    if (!canRestore()) return;
    const orig = S.piece.origXml, other = (S.piece.issues || []).filter(t => !/wartości rytmicznych/.test(t));
    pushUndo(); S.editSel = null; selectNote(null);
    S.piece.issues = [...barIssues(orig), ...other];
    applyNewXml(orig, null); hudUndo("Przywrócono odczyt");
  }));
});
/* ⌘Z / Ctrl+Z and ⇧⌘Z / Ctrl+Y while correcting */
document.addEventListener("keydown", e => {
  if (!S.editMode || openSheetId || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || !(e.metaKey || e.ctrlKey)) return;
  const k = e.key.toLowerCase();
  if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); } else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); redo(); }
});

/* tap a note: correct it; tap a bar elsewhere: it is selected and ▶ plays from there; tap again (or outside the bars) to clear */
/* outside correcting, a tap never edits: it picks where to play from, or moves the loop (also while playing) */
$("#pages").addEventListener("click", e => {
  if (!S.piece) return;
  if (S.editMode) { editTap(e); return; }
  /* full screen (the bars hidden): any tap brings them back first; with a loop on, a tap anywhere near the music moves
     the loop, so full screen could never be left (Nat: "the page hangs, only the notes and the loop line") */
  if (document.body.classList.contains("immersive")) { document.body.classList.remove("immersive"); return; }
  const m = e.target.closest("g.measure") || measureAt(e.clientX, e.clientY);
  if (!m) { if (S.fromMs) clearFromBar(); else if (e.target.closest(".page") && !playState && !pb.loop) document.body.classList.add("immersive"); return; }
  const di = measureEls().indexOf(m);
  if (pb.loop) { setLoopBar(di); return; }
  if (m.classList.contains("sel") && !playState) { clearFromBar(); return; }
  const firstNote = m.querySelector("g.note, g.rest, g.mRest"); if (!firstNote) return;
  let ms = 0; try { ms = tk.getTimeForElement(firstNote.id) || 0; } catch {}
  $$("#pages g.measure.sel").forEach(g => g.classList.remove("sel")); m.classList.add("sel");
  S.fromMs = ms; S.fromBar = di; pb.resumeMs = 0;
  if (playState) { pb.follow = true; play(ms); return; }
  const bar = drawnBars(processedXml())[S.fromBar]; if (bar) showPeek(bar);
});
function clearFromBar() { S.fromMs = 0; S.fromBar = -1; $$("#pages g.measure.sel").forEach(g => g.classList.remove("sel")); $("#peek").hidden = true; }
/* T16: the line of the photo where this bar was printed, shown above the music */
async function showPeek(bar) {
  const L = S.piece && S.piece.lines, imgs = S.piece && S.piece.images;
  if (!L || !L.length || !imgs || !imgs.length) return;
  const ms = kids(parseXml(S.piece.xml).getElementsByTagName("part")[0] || parseXml("<x/>").documentElement, "measure");
  let sys = -1; for (let i = 0; i < Math.min(bar, ms.length); i++) if (i === 0 || ms[i].getElementsByTagName("print")[0]?.getAttribute("new-system") === "yes") sys++;
  const ln = L[Math.max(0, Math.min(sys, L.length - 1))];
  try {
    /* the reader gives positions as fractions of the photo (0-1) */
    const im = await loadImage(imgs[ln.page] || imgs[0]), IW = im.naturalWidth, IH = im.naturalHeight;
    const pad = ln.h * 1.1, x = Math.max(0, (ln.cx - ln.w / 2) * IW - 12), y = Math.max(0, (ln.cy - ln.h / 2 - pad) * IH);
    const w = Math.min(IW - x, ln.w * IW + 24), h = Math.min(IH - y, (ln.h + 2 * pad) * IH);
    const c = $("#peek-c"); c.width = Math.round(w); c.height = Math.round(h);
    c.getContext("2d").drawImage(im, x, y, w, h, 0, 0, c.width, c.height);
    $("#peek-t").textContent = `Oryginał: linia ${sys + 1}, takt ${bar}`;
    $("#peek").hidden = false;
  } catch (e) { console.warn(e); }
}
$("#peek-x").addEventListener("click", () => { $("#peek").hidden = true; });

/* Thumbnail: top of page one, as the library cover */
async function makeThumb(src = thumbSrc()) {          // src from thumbSrc(): taken before any wait
  await engineReady;
  tk.setOptions(src.opts);
  tk.loadData(src.xml);
  const doc = new DOMParser().parseFromString(tk.renderToSVG(1), "image/svg+xml");
  const svg = doc.documentElement;
  enlargeTitle(svg, 1.9);
  svg.setAttribute("width", "1050"); svg.setAttribute("height", "1485");
  const str = new XMLSerializer().serializeToString(svg);
  S.loadedKey = null;
  const url = URL.createObjectURL(new Blob([str], { type: "image/svg+xml" }));
  try {
    const img = await loadImage(url);
    const c = document.createElement("canvas"); c.width = 485; c.height = 364;
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 40, 40, 970, 728, 0, 0, 485, 364);
    return c.toDataURL("image/jpeg", 0.82);
  } finally { URL.revokeObjectURL(url); }
}

/* ---------------- Playback ---------------- */
/* the written tempo, in quarter notes per minute (Verovio uses 120 when the score gives none) */
function scoreBpm() {
  try {
    const tm = tk.renderToTimemap({ includeMeasures: false, includeRests: true });
    const e = tm.find(x => x.qstamp > 0 && x.tstamp > 0);
    if (e) { const b = 60000 * e.qstamp / e.tstamp; if (b >= 10 && b <= 400) return Math.round(b); }
  } catch {}
  return 120;
}
/* Playback is drawn into a WAV file first (OfflineAudioContext) and played by an ordinary
   <audio> element. Media elements are what browsers treat most kindly: they play with the
   iPhone/iPad silent switch on, through Bluetooth speakers, and on with the screen locked (play and pause
   then sit on the lock screen). The element is "unlocked" inside the tap itself, so the later play() is
   allowed everywhere. The file is drawn at 24 kHz (half the memory of 44.1 kHz, plenty for these sounds)
   and written out in slices, so the page never freezes while the sound is being prepared. */
const player = new Audio(); player.preload = "auto"; player.setAttribute("playsinline", "");
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
/* the microphone is in use (tuner or a recording): iOS must then stay in "play-and-record" */
const micBusy = () => (typeof tuner !== "undefined" && tuner.on) || (typeof of !== "undefined" && !!of.stream);
/* The audio session type is set only at the moment a sound starts (playback) or the microphone opens
   (play-and-record), never when things go quiet: on iPhone every change of the session's category re-routes the
   audio hardware, which can be heard as a soft tick or buzz, and a change made by a timer comes "for no reason".
   The type alone does not hold the phone's audio: iOS gives it back to other apps once nothing plays. */
function setSession(type) { try { if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type; } catch {} }
/* nothing sounds and nothing listens: the session is left as it is (see above) */
function sessionIdle() {}
function unlockAudio() {
  if (!micBusy()) setSession("playback");
  if (!player.src || player.src === SILENCE || player.paused) {
    try { player.src = SILENCE; const pr = player.play(); if (pr) pr.catch(() => {}); } catch {}
  }
}
/* one audio context for the short sounds (note preview, metronome, listening to a recording): iOS allows only a
   few, and a running one keeps the phone's audio busy (a running, silent context can also be heard as a faint hum
   on some iPhones), so it is suspended a few seconds after its last sound has ended, and at once when the app is
   left */
const fx = { ctx: null, idle: 0 };
function fxCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!fx.ctx || fx.ctx.state === "closed") fx.ctx = new AC();
  if (!micBusy()) setSession("playback");                          // silent switch on: still heard (iOS 17+)
  if (fx.ctx.state !== "running") { const r = fx.ctx.resume?.(); if (r) r.catch(() => {}); }
  fxIdle(); return fx.ctx;
}
/* no sleep on a timer (Nat, 7 Oct: "the phone vibrates slightly for no reason"): on iPhone every suspend of the
   context re-routes the audio hardware, felt as a soft tick some seconds after the last sound. The context now
   sleeps only when Solo is left (hidden), when nothing can be felt */
function fxIdle() { clearTimeout(fx.idle); }
function fxSleep() { clearTimeout(fx.idle); if (metro.on || !fx.ctx || fx.ctx.state !== "running") return; const r = fx.ctx.suspend?.(); if (r) r.catch(() => {}); }
document.addEventListener("visibilitychange", () => { if (document.hidden) fxSleep(); });
const yieldNow = () => (globalThis.scheduler && typeof scheduler.yield === "function") ? scheduler.yield() : new Promise(r => setTimeout(r, 0));
/* ---------------- 3.8 player (benchmark: Soundslice, MuseScore 4, Songsterr, Tomplay, Flat, SmartMusic) ----------------
   The cursor follows the sound itself (the audio clock, so it never drifts): a soft highlight on the bar and a thin
   line gliding through it. The page moves one line of music at a time, keeping the playing line in the upper third.
   Pause keeps the place; a count-in and the metronome click are rendered into the same sound; a loop of
   bars repeats with the count-in each time and can be changed at any moment, also while playing.
   Repeats and 1st/2nd endings are played as written: Verovio's timemap unrolls them ("…-rend2" is the second
   time through a bar), and every id is mapped back to the drawn note for the cursor. */
let playState = null, playToken = 0;
/* lag: headphone delay in seconds (Bluetooth ≈ 0.2), store "avLag" in ms; the cursor waits for the sound */
const pb = { click: store.get("click", "count"), loop: null, mute: new Set(), follow: true, resumeMs: 0, preparing: 0, trainer: null, lag: (+store.get("avLag", 0) || 0) / 1000 };
function setAvLag(ms) { pb.lag = Math.max(0, Math.min(500, +ms || 0)) / 1000; store.set("avLag", String(Math.round(pb.lag * 1000))); }
/* the tempo actually played: the piece's tempo, times the speed trainer's step */
const playBpm = () => Math.round(curBpm() * (pb.trainer ? pb.trainer.pct / 100 : 1));
function setPlayUi(on) {
  const b = $("#btn-play"); b.classList.toggle("on", on);
  b.innerHTML = icon(on ? "pause" : "play");
  b.setAttribute("aria-label", on ? "Pauza" : "Posłuchaj"); b.title = on ? "Pauza" : "Posłuchaj";
  document.body.classList.toggle("playing", on);
  $("#tp-bpm").textContent = String(playBpm());
}
/* "Przygotowuję dźwięk…" only when preparing takes long enough to be noticed */
const PREP = "Przygotowuję dźwięk…";
function prepHud(on) {
  clearTimeout(prepHud.t);
  if (on) prepHud.t = setTimeout(() => hud(PREP, 30000), 350);
  else { const h = $("#toast"); if (h && h.textContent === PREP) h.classList.remove("show"); }
}
function stopPlayback(keepPlace) {
  playToken++;
  prepHud(false);
  if (pb.preparing) { pb.preparing = 0; if (!playState) setPlayUi(false); }
  if (!playState) { sessionIdle(); return; }
  if (keepPlace) pb.resumeMs = playPos();
  playState.stopping = true;
  try { (playState.src || player).pause(); } catch {}
  try { player.loop = false; } catch {}
  cancelAnimationFrame(playState.raf);
  const url = playState.url; if (url && url !== wavCache.url) setTimeout(() => URL.revokeObjectURL(url), 1000);
  $$("#pages g.playing").forEach(g => g.classList.remove("playing"));
  $$("#pages .playline, #pages .barlight").forEach(x => x.remove());
  $("#follow-pill").hidden = true; $("#tp-bar").textContent = ""; $("#tp-fill").style.width = "0";
  playState = null; setPlayUi(false); mediaState("paused");
  if (!tuner.on && !metro.on) { try { wakeLock?.release(); } catch {} wakeLock = null; }
  sessionIdle();
}
/* one note of the brass-like synth, into any audio context */
function synthNote(ctx, out, f, st, en) {
  const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), filt = ctx.createBiquadFilter(), env = ctx.createGain();
  o1.type = "sawtooth"; o2.type = "triangle"; o1.frequency.value = f; o2.frequency.value = f; o2.detune.value = 4;
  filt.type = "lowpass"; filt.Q.value = 1.2;
  filt.frequency.setValueAtTime(f * 1.5, st); filt.frequency.linearRampToValueAtTime(Math.min(8000, f * 5), st + 0.06); filt.frequency.linearRampToValueAtTime(f * 3, en);
  env.gain.setValueAtTime(0, st); env.gain.linearRampToValueAtTime(0.9, st + 0.03); env.gain.setTargetAtTime(0.6, st + 0.05, 0.1); env.gain.setTargetAtTime(0, en, 0.04);
  o1.connect(filt); o2.connect(filt); filt.connect(env); env.connect(out);
  o1.start(st); o2.start(st); o1.stop(en + 0.3); o2.stop(en + 0.3);
}
/* a short wooden click, accented on the first beat */
function clickNote(ctx, out, t, accent) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.frequency.value = accent ? 1760 : 1175; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(accent ? 2.2 : 1.4, t + .002); g.gain.exponentialRampToValueAtTime(.001, t + .05);
  o.connect(g); g.connect(out); o.start(t); o.stop(t + .07);
}
/* How a written note is played: one helper for the player and for the sound of a note while correcting, so both
   always agree. The dynamic in effect (ppp…fff; mf when nothing is written), a hairpin as a gain curve towards the
   next dynamic (or one step up/down when none follows), sf/sfz/fz/fp as a stronger start (fp, sfp then piano),
   accents as a stronger start, staccato (½), staccatissimo (⅓), tenuto (full length), otherwise 95 %. q is the length
   in quarter notes with dots and ties. Read from the MusicXML part, so a mark just added is heard at once. */
const DYN_LV = { ppp: .22, pp: .3, p: .42, mp: .56, mf: .7, f: .85, ff: 1, fff: 1.12 };
const DYN_SF = { sf: null, sfz: null, sffz: null, fz: null, rfz: null, rf: null, fp: "p", sfp: "p", sfzp: "p" };
const NOTE_PLAIN = { g0: DYN_LV.mf, g1: DYN_LV.mf, acc: 0, len: .95, q: 1 };
function partShapes(part) {
  const dyn = [], wedges = [], notes = [], sfAt = []; let pos = 0, div = 1, open = null, last = 0;
  kids(part, "measure").forEach(m => {
    for (const c of m.children) {
      const t = c.tagName;
      if (t === "attributes") { const d = parseFloat(txt(c, "divisions")); if (d > 0) div = d; }
      else if (t === "backup") pos -= (parseFloat(txt(c, "duration")) || 0) / div;
      else if (t === "forward") pos += (parseFloat(txt(c, "duration")) || 0) / div;
      else if (t === "direction") {
        const at = pos + (parseFloat(txt(c, "offset")) || 0) / div;
        for (const d of c.getElementsByTagName("dynamics")) for (const x of d.children) {
          const k = x.tagName;
          if (k in DYN_LV) dyn.push({ at, lv: DYN_LV[k] });
          else if (k in DYN_SF) { sfAt.push(at); if (DYN_SF[k]) dyn.push({ at, lv: DYN_LV[DYN_SF[k]] }); }
        }
        for (const w of c.getElementsByTagName("wedge")) {
          const ty = w.getAttribute("type");
          if (ty === "crescendo" || ty === "diminuendo") open = { a: at, up: ty === "crescendo" };
          else if (ty === "stop" && open) { wedges.push({ a: open.a, up: open.up, b: at }); open = null; }
        }
      } else if (t === "note" && !kid(c, "grace")) {
        const q = (parseFloat(txt(c, "duration")) || 0) / div, chord = !!kid(c, "chord");
        const st = chord ? last : pos; if (!chord) { last = pos; pos += q; }
        notes.push({ n: c, at: st, q });
      }
    }
  });
  const byTime = () => dyn.sort((x, y) => x.at - y.at);
  const lvAt = t => { let v = NOTE_PLAIN.g0; for (const d of dyn) { if (d.at > t + 1e-6) break; v = d.lv; } return v; };
  const steps = Object.values(DYN_LV), step = (v, up) => { let i = steps.findIndex(x => x >= v - 1e-6); if (i < 0) i = steps.length - 1; return steps[Math.max(0, Math.min(steps.length - 1, i + (up ? 1 : -1)))]; };
  byTime();
  wedges.sort((x, y) => x.a - y.a).forEach(w => {
    w.from = lvAt(w.a);
    const nx = dyn.find(d => d.at >= w.b - 1e-3 && d.at <= w.b + 4);
    if (nx && (w.up ? nx.lv > w.from : nx.lv < w.from)) w.to = nx.lv;
    else { w.to = step(w.from, w.up); dyn.push({ at: w.b, lv: w.to }); byTime(); }        // the level reached stays
  });
  const gAt = t => { for (const w of wedges) if (w.b > w.a && t >= w.a - 1e-6 && t <= w.b + 1e-6) return w.from + (w.to - w.from) * Math.min(1, (t - w.a) / (w.b - w.a)); return lvAt(t); };
  const tied = (n, ty) => [...n.getElementsByTagName("tie")].some(e => e.getAttribute("type") === ty);
  const map = new Map();
  notes.forEach((x, i) => {
    const arts = x.n.getElementsByTagName("articulations")[0], has = k => !!(arts && arts.getElementsByTagName(k).length);
    const len = has("staccatissimo") ? .33 : has("staccato") || has("spiccato") ? .5 : has("detached-legato") ? .75 : has("tenuto") ? 1 : .95;
    const acc = sfAt.some(a => Math.abs(a - x.at) < 2e-3) ? 2 : has("accent") || has("strong-accent") ? 1 : 0;      // 2: sf, sfz, fp (at least forte-fortissimo at the start)
    /* a tie carries the sound on into the next note of the same pitch */
    let q = x.q, cur = x;
    for (let guard = 0; guard < 16 && tied(cur.n, "start") && kid(cur.n, "pitch"); guard++) {
      const mi = midiOf(kid(cur.n, "pitch")), end = cur.at + cur.q;
      const nx = notes.slice(i + 1, i + 40).find(y => Math.abs(y.at - end) < 1e-3 && kid(y.n, "pitch") && tied(y.n, "stop") && midiOf(kid(y.n, "pitch")) === mi);
      if (!nx) break; q += nx.q; cur = nx;
    }
    map.set(x.n, { g0: gAt(x.at), g1: gAt(x.at + x.q), acc, len, q });
  });
  return map;
}
/* one note through its shape: the voice (instrument, own sound) inside a gain that carries the dynamic; mf is the
   level the sounds always had, so a piece without marks sounds as before */
function playShaped(ctx, out, voice, f, st, dur, sh) {
  sh = sh || NOTE_PLAIN;
  const en = st + Math.max(0.05, dur * sh.len), g = ctx.createGain(), a = sh.g0 / NOTE_PLAIN.g0, b = sh.g1 / NOTE_PLAIN.g0;
  const settle = Math.min(st + 0.15, (st + en) / 2);
  g.gain.setValueAtTime(sh.acc ? Math.max(a * 1.5, sh.acc > 1 ? DYN_LV.ff / NOTE_PLAIN.g0 : 0) : a, st);
  if (sh.acc) g.gain.linearRampToValueAtTime(a, settle);
  if (Math.abs(b - a) > 1e-3) { if (!sh.acc) g.gain.setValueAtTime(a, settle); g.gain.linearRampToValueAtTime(b, en); }
  g.connect(out); voice(ctx, g, f, st, en);
}
/* the drawn note (from the player's timemap) → its shape: same bar, staff and place as a tap in correcting mode
   (locateNote), but with the bar list and each staff's notes read once for the whole piece */
function playShapes(slots) {
  try {
    const doc = parseXml(S.piece.xml), bars = drawnBars(processedXml()), mIdx = new Map(), stNotes = new Map(), byPart = new Map(), meas = new Map();
    measureEls().forEach((m, i) => mIdx.set(m, i));
    const parts = new Map([...doc.getElementsByTagName("part")].map(p => [p.getAttribute("id"), p]));
    return el => {
      try {
        const m = el && el.closest("g.measure"), st = el && el.closest("g.staff"); if (!m || !st) return null;
        const slot = slots[staffsOf(m).indexOf(st)]; if (!slot || slot.multi) return null;
        const part = parts.get(slot.pid), bar = bars[mIdx.get(m)]; if (!part || !bar) return null;
        let list = stNotes.get(st); if (!list) { list = [...st.querySelectorAll(NOTE_SEL)]; stNotes.set(st, list); }
        let sh = byPart.get(part); if (!sh) { sh = partShapes(part); byPart.set(part, sh); meas.set(part, kids(part, "measure")); }
        const xm = meas.get(part)[bar - 1], n = xm && kids(xm, "note")[list.indexOf(el)];
        return (n && sh.get(n)) || null;
      } catch { return null; }
    };
  } catch (e) { console.warn(e); return () => null; }
}
/* 16-bit WAV, written in slices with a breath between them (no long task). Int16Array is little-endian on every
   phone and computer Solo runs on, as WAV wants. */
async function wavBlob(buf) {
  const ch = buf.getChannelData(0), n = ch.length, sr = buf.sampleRate, SL = 1 << 19;
  let peak = 0;
  for (let s = 0; s < n; s += SL) { const e = Math.min(n, s + SL); for (let i = s; i < e; i++) { const v = ch[i] < 0 ? -ch[i] : ch[i]; if (v > peak) peak = v; } if (e < n) await yieldNow(); }
  const gain = (peak > 0 ? 0.89 / peak : 1) * 32767, ab = new ArrayBuffer(44 + n * 2), h = new DataView(ab, 0, 44), pcm = new Int16Array(ab, 44, n);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) h.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); h.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt ");
  h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true); h.setUint32(24, sr, true);
  h.setUint32(28, sr * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true); str(36, "data"); h.setUint32(40, n * 2, true);
  for (let s = 0; s < n; s += SL) {
    const e = Math.min(n, s + SL);
    for (let i = s; i < e; i++) { const v = Math.round(ch[i] * gain); pcm[i] = v > 32767 ? 32767 : v < -32767 ? -32767 : v; }
    if (e < n) await yieldNow();
  }
  return { blob: new Blob([ab], { type: "audio/wav" }), peak };
}
const LEAD = 0.06;            // seconds of silence at the start of each rendered file
const PLAY_SR = 24000;
const measureEls = () => [...$$("#pages g.measure")];
const baseId = id => String(id).replace(/-rend\d+$/, "");
/* the metre of each drawn bar: metronome beats (6/8 → 2, 9/8 → 3, 12/8 → 4, 3/8 → 1), quarters in a full bar,
   compound or not. Read once per score and set of shown parts. */
function barMeters() {
  const key = (S.piece && S.piece.xml) + "|" + S.parts.map(p => (p.keep ? 1 : 0)).join("");
  if (barMeters.key === key) return barMeters.val;
  const xml = processedXml(), doc = parseXml(xml), part = doc.getElementsByTagName("part")[0]; if (!part) return [];
  let b = 4, bt = 4; const byBar = kids(part, "measure").map(m => {
    kids(m, "attributes").forEach(a => { const t = kid(a, "time"); if (t) { b = beatsOf(txt(t, "beats")) || b; bt = parseInt(txt(t, "beat-type"), 10) || bt; } });
    const comp = bt === 8 && b % 3 === 0;
    return { n: comp ? b / 3 : b, q: b * 4 / bt, comp };
  });
  barMeters.key = key; return (barMeters.val = drawnBars(xml).map(n => byBar[n - 1] || { n: 4, q: 4, comp: false }));
}
/* the tempo as a musician writes it: 6/8 → dotted quarter (♩.=80 for ♩=120), 2/2 → half; for the tempo label */
function tempoBeat(bpm = playBpm()) {
  const m = S.piece ? barMeters()[0] : null;
  if (m && m.comp && m.n > 1) return { unit: "q.", bpm: Math.round(bpm / 1.5) };
  if (m && m.q === m.n * 2) return { unit: "h", bpm: Math.round(bpm / 2) };
  return { unit: "q", bpm };
}
/* bars as they are played (repeats unrolled), each with its drawn bar index (di) and its place in quarters */
function playBars(tm) {
  const idx = new Map(); measureEls().forEach((m, i) => idx.set(m.id, i));
  const bars = []; let end = { t: 0, q: 0 };
  tm.forEach(e => {
    if (e.measureOn) { const id = baseId(e.measureOn); bars.push({ t: e.tstamp, q: e.qstamp || 0, di: idx.has(id) ? idx.get(id) : -1 }); }
    if (e.tstamp >= end.t) end = { t: e.tstamp, q: e.qstamp || 0 };
  });
  bars.end = end; return bars;
}
/* which part a drawn note belongs to (for "Co słychać") */
function partOfEl(el, slots = staffSlots()) {
  const m = el && el.closest("g.measure"), st = el && el.closest("g.staff"); if (!m || !st) return null;
  const slot = slots[staffsOf(m).indexOf(st)]; return slot ? slot.pid : null;
}
/* the last rendered file is kept: playing the same thing again (from the start, the same loop) starts at once */
const wavCache = { key: "", url: null };
function wavKey(ev, clicks, len, a4) {
  let h = 2166136261 >>> 0; const mix = v => { h = Math.imul(h ^ (Math.round(v * 1000) | 0), 16777619) >>> 0; };
  const mixS = s => { for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i) / 1000); };
  ev.forEach(e => { mix(e.t); mix(e.dur); mix(e.pitch); mix(e.silent ? 1 : 0); mixS(e.vk); const s = e.shape; if (s) { mix(s.g0); mix(s.g1); mix(s.len); mix(s.acc); } });
  clicks.forEach(c => { mix(c.t); mix(c.acc ? 1 : 0); });
  mix(len); mix(a4); mixS(store.get("ownUse") || "");
  if (typeof own !== "undefined") mixS(Object.entries(own.byInstr).map(([id, l]) => id + l.map(x => x.midi.toFixed(3)).join()).join());
  return `${ev.length}:${clicks.length}:${h}`;
}
async function renderWav(ev, clicks, fileLen, freq, token) {
  const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  let sr = PLAY_SR, off;
  try { off = new Off(1, Math.ceil((fileLen + LEAD) * sr), sr); } catch { sr = 44100; off = new Off(1, Math.ceil((fileLen + LEAD) * sr), sr); }
  const bus = off.createGain(); bus.gain.value = 0.18; bus.connect(off.destination);
  for (let i = 0; i < ev.length; i++) {
    const e = ev[i]; if (!e.silent) playShaped(off, bus, e.voice, freq(e.pitch), LEAD + e.t, e.dur, e.shape);
    if (i % 300 === 299) { await yieldNow(); if (token !== playToken) return null; }
  }
  clicks.forEach(c => clickNote(off, bus, LEAD + c.t, c.acc));
  /* older Safari gives the result only through oncomplete */
  const buf = await new Promise((res, rej) => { off.oncomplete = e => res(e.renderedBuffer); const p = off.startRendering(); if (p && p.then) p.then(res, rej); });
  if (token !== playToken) return null;
  /* private windows add noise to rendered audio against fingerprinting: then the notes are played live */
  const ch = buf.getChannelData(0); let lead = 0;
  for (let i = 0, n = Math.floor(LEAD * sr * 0.8); i < n; i++) lead = Math.max(lead, Math.abs(ch[i]));
  if (lead > 1e-4) return { live: true };
  const { blob } = await wavBlob(buf);
  if (token !== playToken) return null;
  return { url: URL.createObjectURL(blob) };
}
async function play(fromMs, opt = {}) {
  if (playState || pb.preparing) stopPlayback();
  if (!S.piece) return;
  if (metro.on) metroStop();                                   // never two clicks at two tempi
  const token = ++playToken; pb.preparing = token; setPlayUi(true); prepHud(true);
  const fail = msg => { if (token !== playToken) return; pb.preparing = 0; prepHud(false); setPlayUi(false); sessionIdle(); if (msg) hud(msg, 3000); };
  await engineReady;
  if (S.loadedKey !== "view") { pb.preparing = 0; await doRender(); if (token !== playToken) return; pb.preparing = token; }
  let tm;
  try { tm = tk.renderToTimemap({ includeMeasures: true, includeRests: true }); } catch (e) { console.warn(e); fail("Nie da się odtworzyć tych nut"); return; }
  const bars = playBars(tm), meters = barMeters(), nb = bars.length;
  if (!nb) { fail("Brak nut do odtworzenia"); return; }
  /* the bar grid: ms per quarter, a full bar of the metre, and where a bar's beats start (a pickup bar's first beats
     lie before its notes) */
  const barEnd = i => (bars[i + 1] || bars.end).t;
  const mpq = i => { for (let j = i; j >= 0; j--) { const a = bars[j], b = bars[j + 1] || bars.end, dq = b.q - a.q; if (dq > 0) return (b.t - a.t) / dq; } return 60000 / (S.baseBpm || 120); };
  const meter = i => meters[bars[i].di] || { n: 4, q: 4, comp: false };
  const full = i => meter(i).q * mpq(i);
  const gridStart = i => { const L = barEnd(i) - bars[i].t, F = full(i); return i === 0 && L < F - 2 ? bars[i].t - (F - L) : bars[i].t; };
  let A = 0, B = Infinity;
  if (pb.loop) {
    const nd = measureEls().length; pb.loop.a = Math.min(pb.loop.a, nd - 1); pb.loop.b = Math.min(pb.loop.b, nd - 1);
    let ia = bars.findIndex(b => b.di === pb.loop.a); if (ia < 0) ia = 0;
    let ib = bars.findIndex((b, i) => i >= ia && b.di === pb.loop.b); if (ib < 0) ib = nb - 1;
    A = bars[ia].t; B = barEnd(ib);
  }
  fromMs = pb.loop ? A : Math.max(0, fromMs || 0);
  const k = (S.baseBpm || 120) / playBpm(), sec = ms => ms / 1000 * k, ev = [];
  /* one look-up per part: concert pitch (partTr), its sound, muted or not */
  const slots = staffSlots(), parts = new Map(), shapeOf = playShapes(slots);
  const partOf = pid => { let p = parts.get(pid); if (!p) { const vk = instrOfPart(pid); p = { tr: partTr(pid), voice: voiceFor(vk), vk, mute: pb.mute.has(pid) }; parts.set(pid, p); } return p; };
  tm.forEach(e => (e.on || []).forEach(id => {
    if (e.tstamp >= B) return;
    let v; try { v = tk.getMIDIValuesForElement(id); } catch { return; }
    if (!v || !(v.pitch > 0)) return;
    const end = Math.min(e.tstamp + v.duration, B); if (end <= fromMs + 20) return;
    const start = Math.max(e.tstamp, fromMs);      // resuming mid-note: the note keeps sounding
    const el = document.getElementById(baseId(id)), pid = partOfEl(el, slots), p = partOf(pid);
    ev.push({ id, el, pid, q0: e.tstamp, t: sec(start - fromMs), dur: Math.max(0.08, sec(end - start)), pitch: v.pitch - p.tr, voice: p.voice, vk: p.vk, silent: p.mute, shape: p.mute ? null : shapeOf(el) });
  }));
  if (!ev.length) { fail("Brak nut do odtworzenia"); return; }
  ev.sort((a, b) => a.q0 - b.q0);
  if (S.swing) {         /* T29: eighths in pairs play long-short (about 2:1), counted from the bar's own beats; not in 6/8 */
    let bi = 0;
    ev.forEach(e => {
      while (bi + 1 < nb && bars[bi + 1].t <= e.q0 + 1) bi++;
      if (meter(bi).comp) return;
      const qd = mpq(bi), pos = (((e.q0 - gridStart(bi)) % qd) + qd) % qd, eps = qd * 0.05, third = sec(qd / 6);
      if (e.dur > sec(qd / 2) * 1.1) return;
      if (Math.abs(pos - qd / 2) < eps) { if (e.q0 >= fromMs) e.t += third; e.dur = Math.max(0.05, e.dur - third); }
      else if (pos < eps || qd - pos < eps) e.dur += third;
    });
  }
  ev.sort((a, b) => a.t - b.t);
  const rangeLen = Number.isFinite(B) ? sec(B - fromMs) : ev.reduce((m, e) => Math.max(m, e.t + e.dur), 0);
  /* count-in: one full bar of the metre (also before a pickup), and the music starts on its own beat: a pickup of
     one beat in 3/4 hears "1, 2" and comes in on 3; from the middle of a bar the clicks run on the bar's beats */
  const first = Math.max(0, bars.findIndex((b, i) => b.t <= fromMs + 1 && barEnd(i) > fromMs + 1));
  const clicks = [];
  let countLen = 0;
  if (pb.click !== "off" && !opt.noCount) {
    const F = full(first), n = meter(first).n, bt = F / n, p = Math.max(0, fromMs - gridStart(first)), cl = p + (p < 2 * bt - 1 ? F : 0);
    countLen = sec(cl);
    for (let j = 0; j * bt < cl - 1; j++) clicks.push({ t: sec(j * bt), acc: j % n === 0 });
  }
  if (pb.click === "all") for (let i = first; i < nb && bars[i].t < B; i++) {
    const m = meter(i), bt = full(i) / m.n, g = gridStart(i), e = Math.min(barEnd(i), B);
    for (let j = 0; j < m.n * 2; j++) { const t = g + j * bt; if (t >= e - 1) break; if (t < bars[i].t - 1 || t < fromMs - 1) continue; clicks.push({ t: countLen + sec(t - fromMs), acc: j === 0 }); }
  }
  ev.forEach(e => { e.t += countLen; });
  const total = countLen + rangeLen, fileLen = pb.loop ? total : total + 0.5, a4 = tuner.a4 || 440;
  const freq = p => a4 * Math.pow(2, (p - 69) / 12);         // the tuner's A: play-along matches the band's tuning
  const key = wavKey(ev, clicks, fileLen, a4);
  let url = wavCache.key === key ? wavCache.url : null;
  if (!url) {
    let r;
    try { r = await renderWav(ev, clicks, fileLen, freq, token); } catch (e) { console.warn(e); fail("Nie udało się przygotować dźwięku"); return; }
    if (!r || token !== playToken) { if (r && r.url) URL.revokeObjectURL(r.url); return; }      // stopped while it was being prepared
    if (r.live) { pb.preparing = 0; prepHud(false); playLive(ev, clicks, total, token, k, fromMs, countLen, freq); return; }
    if (wavCache.url) URL.revokeObjectURL(wavCache.url);
    wavCache.key = key; wavCache.url = url = r.url;
  }
  pb.preparing = 0; prepHud(false);
  player.src = url; player.loop = !!pb.loop;
  try { await player.play(); }
  catch (e) {
    if (token !== playToken) return;
    setPlayUi(false); sessionIdle();
    hud(e && e.name === "NotAllowedError" ? "Dotknij jeszcze raz, żeby posłuchać" : "Nie udało się odtworzyć dźwięku", 3000);
    return;
  }
  if (token !== playToken) { player.pause(); return; }
  playState = { raf: 0, k, fromMs, url, src: player, ev, countLen, total, loopLen: pb.loop ? total + LEAD : 0, clock: { a: -1, at: 0 }, di: -1 };
  setPlayUi(true); keepAwake(); mediaState("playing"); follow(token);
}
async function keepAwake() { try { wakeLock = wakeLock || await navigator.wakeLock?.request("screen"); } catch {} }
/* live playback through Web Audio: used when rendered audio comes back noisy (no seamless loop there: it restarts).
   Notes are handed to the audio clock 8 s ahead, not all at once (a long piece would be thousands of nodes). */
async function playLive(ev, clicks, total, token, k, fromMs, countLen, freq) {
  const AC = window.AudioContext || window.webkitAudioContext; const ctx = new AC();
  try { await ctx.resume(); } catch {}
  const bus = ctx.createGain(); bus.gain.value = 0.18; bus.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.12, cl = [...clicks].sort((a, b) => a.t - b.t);
  let i = 0, c = 0;
  const pump = () => {
    if (ctx.state === "closed") return;
    const until = ctx.currentTime - t0 + 8;
    for (; i < ev.length && ev[i].t < until; i++) { const e = ev[i]; if (!e.silent) playShaped(ctx, bus, e.voice, freq(e.pitch), t0 + LEAD + e.t, e.dur, e.shape); }
    for (; c < cl.length && cl[c].t < until; c++) clickNote(ctx, bus, t0 + LEAD + cl[c].t, cl[c].acc);
  };
  pump(); const timer = setInterval(pump, 1000);
  const src = { get currentTime() { return ctx.currentTime - t0; }, get ended() { return ctx.currentTime - t0 > total + LEAD + 0.3; }, get paused() { return ctx.state !== "running"; }, pause() { clearInterval(timer); try { bus.gain.setTargetAtTime(0, ctx.currentTime, 0.008); } catch {} setTimeout(() => { try { ctx.close(); } catch {} }, 80); } };
  if (token !== playToken) { src.pause(); return; }
  playState = { raf: 0, k, fromMs, url: null, src, ev, countLen, total, loopLen: 0, live: true, clock: { a: -1, at: 0 }, di: -1 };
  setPlayUi(true); keepAwake(); mediaState("playing"); follow(token);
}
/* the audio element's clock moves in steps on some phones: between steps it is carried on by the frame clock */
function audioNow(ps) {
  const a = ps.src.currentTime, now = performance.now(), c = ps.clock;
  if (a !== c.a) { c.a = a; c.at = now; return a; }
  if (ps.src.paused) return a;
  let t = a + (now - c.at) / 1000; if (ps.loopLen && t >= ps.loopLen) t -= ps.loopLen; return t;
}
/* where playback is now, in score milliseconds (independent of tempo) */
function rangeTime(ps) { return audioNow(ps) - LEAD - ps.countLen - pb.lag; }
const playPos = () => playState ? playState.fromMs + Math.max(0, rangeTime(playState)) * 1000 / playState.k : 0;
/* the lock screen and headphones: title, play and pause */
function mediaState(st) {
  const ms = navigator.mediaSession; if (!ms) return;
  try {
    if (st === "playing" && S.piece && typeof MediaMetadata === "function") ms.metadata = new MediaMetadata({ title: S.piece.title || "Nuty", artist: S.piece.composer || "", album: "Solo" });
    ms.playbackState = st;
  } catch {}
}
if (navigator.mediaSession) {
  try {
    navigator.mediaSession.setActionHandler("play", () => { if (!playState && !pb.preparing && S.piece && S.view === "score") { unlockAudio(); play(pb.resumeMs || 0); } });
    navigator.mediaSession.setActionHandler("pause", () => stopPlayback(true));
    navigator.mediaSession.setActionHandler("stop", () => stopPlayback(true));
  } catch {}
}
/* a call, Siri, unplugged headphones or the lock screen paused the sound: the button follows and the place is kept
   (one tap plays on, not two) */
player.addEventListener("pause", () => {
  const ps = playState; if (!ps || ps.src !== player || ps.stopping) return;
  if (player.ended || (!ps.loopLen && player.currentTime >= ps.total + LEAD - 0.1)) return;      // the end: follow() finishes
  stopPlayback(true);
});
/* speed trainer (Soundslice): the loop starts slower and speeds up by itself, e.g. 60 % → 100 %, +5 % every 2 passes.
   Logic only, for the lead's controls: speedTrainer({ from: 60, to: 100, step: 5, every: 2 }) turns it on (a loop
   must be set; pb.trainer.pct is the current %), speedTrainer(null) turns it off. */
function speedTrainer(o) {
  pb.trainer = o ? { from: o.from || 60, to: o.to || 100, step: o.step || 5, every: o.every || 2, pct: o.from || 60, pass: 0 } : null;
  setPlayUi(!!playState || !!pb.preparing);
  if (playState) play(pb.loop ? undefined : playPos());
  return pb.trainer;
}
function trainerPass() {
  const tr = pb.trainer; if (!tr || !pb.loop) return;
  tr.pass++; if (tr.pass % tr.every || tr.pct >= tr.to) return;
  tr.pct = Math.min(tr.to, tr.pct + tr.step); hud(`Tempo ${tr.pct}%`, 1500); play();
}
/* positions of everything the cursor needs, relative to #pages (they don't change while scrolling); each bar and
   its staff lines are measured once, not once per note */
function cursorMap(ev) {
  const pg = $("#pages"), pr = pg.getBoundingClientRect(), rel = r => ({ x: r.left - pr.left, y: r.top - pr.top, w: r.width, h: r.height });
  const mIndex = new Map(); measureEls().forEach((m, i) => mIndex.set(m, i));
  const bars = new Map(), barOf = m => {
    let b = bars.get(m); if (b) return b;
    /* the height comes from the staff lines only (notes above or below the staff would make it jump) */
    const staffs = staffsOf(m), lines = st => { const ls = [...(st || m).children].filter(c => c.tagName === "path").slice(0, 5).map(l => l.getBoundingClientRect()); return ls.length ? { t: Math.min(...ls.map(r => r.top)) - pr.top, b: Math.max(...ls.map(r => r.bottom)) - pr.top } : (r => ({ t: r.y, b: r.y + r.h }))(rel((st || m).getBoundingClientRect())); };
    const a = lines(staffs[0]), z = lines(staffs[staffs.length - 1]), gap = (a.b - a.t) / 4 || 8, mr = rel(m.getBoundingClientRect());
    b = { sys: m.closest("g.system") || m, top: a.t - gap * 1.5, h: z.b - a.t + gap * 3, mx: mr.x, mw: mr.w, mi: mIndex.has(m) ? mIndex.get(m) : -1 };
    bars.set(m, b); return b;
  };
  const ons = []; let last = null;
  ev.forEach(e => {
    if (!e.el) return;
    if (last && Math.abs(e.t - last.t) < 0.005) { last.els.push(e.el); return; }
    const m = e.el.closest("g.measure"); if (!m) return;
    const b = barOf(m), nr = rel(e.el.getBoundingClientRect());
    last = { t: e.t, els: [e.el], x: nr.x + nr.w / 2, m, ...b };
    ons.push(last);
  });
  return ons;
}
function follow(token) {
  const ps = playState, pg = $("#pages"), nBars = measureEls().length, tpBar = $("#tp-bar"), tpFill = $("#tp-fill");
  let ons = cursorMap(ps.ev), resized = false;
  if (!ons.length) return;
  /* zoom or rotation: measure again (noticed by an observer, not by reading the layout every frame) */
  const ro = window.ResizeObserver ? new ResizeObserver(() => { resized = true; }) : null; if (ro) ro.observe(pg);
  const line = document.createElement("div"); line.className = "playline"; pg.appendChild(line);
  const light = document.createElement("div"); light.className = "barlight"; pg.appendChild(light);
  let cur = -1, lastSys = null, lit = [], counting = false, lastT = 0, lastPct = "";
  const quit = () => { if (ro) ro.disconnect(); };
  const step = () => {
    if (!playState || token !== playToken || playState !== ps) { quit(); return; }
    if (resized) { resized = false; ons = cursorMap(ps.ev); cur = -1; lastSys = null; counting = false; if (!ons.length) { quit(); return; } }
    const T = rangeTime(ps) + ps.countLen;                       // time in the file (count-in included)
    if (ps.loopLen && T < lastT - 0.5) { trainerPass(); if (playState !== ps) { quit(); return; } }    // the loop came round again
    lastT = T;
    if (T < ps.countLen) {                                       // counting in: the first bar waits, lit
      if (!counting) { counting = true; cur = -1; const o = ons[0]; light.style.cssText = `width:${o.mw}px;height:${o.h}px;transform:translate(${o.mx}px,${o.top}px);opacity:.6`; line.style.opacity = "0"; tpBar.textContent = "…"; ps.di = -1; }
      ps.raf = requestAnimationFrame(step); return;
    }
    if (counting) { counting = false; line.style.opacity = "1"; }
    let i = cur < 0 || ons[cur].t > T ? 0 : cur; while (i + 1 < ons.length && ons[i + 1].t <= T) i++;
    const o = ons[i], nx = ons[i + 1];
    if (i !== cur) {
      lit.forEach(el => el.classList.remove("playing")); lit = o.els; lit.forEach(el => el.classList.add("playing")); cur = i;
      light.style.cssText = `width:${o.mw}px;height:${o.h}px;transform:translate(${o.mx}px,${o.top}px)`;
      line.style.height = o.h + "px";
      if (ps.di !== o.mi) { ps.di = o.mi; tpBar.textContent = `${o.mi + 1} / ${nBars}`; }
      if (o.sys !== lastSys) { lastSys = o.sys; if (pb.follow) scrollToLine(o); }
    }
    /* the line glides to the next note on the same line, or to the end of the bar */
    const end = nx && nx.sys === o.sys ? nx : null, span = (end ? end.t : o.t + 0.5) - o.t, f = Math.max(0, Math.min(1, (T - o.t) / (span || 1)));
    const x = o.x + ((end ? end.x : o.mx + o.mw - 4) - o.x) * (end ? f : Math.min(f, 0.6));
    line.style.transform = `translate(${x.toFixed(1)}px,${o.top}px)`;
    const pct = Math.min(100, (T / ps.total) * 100).toFixed(1); if (pct !== lastPct) { lastPct = pct; tpFill.style.width = pct + "%"; }
    if (!ps.loopLen && (ps.src.ended || T > ps.total + 0.3)) {
      quit();
      if (ps.live && pb.loop) { trainerPass(); if (playState === ps) play(); return; }
      stopPlayback(); pb.resumeMs = 0; return;
    }
    ps.raf = requestAnimationFrame(step);
  };
  ps.raf = requestAnimationFrame(step);
}
/* the page glides so the playing line sits in the upper third (and the next line is already in view) */
let scrollAnim = 0, autoScrolling = false;
function scrollToLine(o) {
  const sc = $("#scroller"), pg = $("#pages"), pr = pg.getBoundingClientRect(), sr = sc.getBoundingClientRect();
  const top = pr.top + o.top, want = sr.top + Math.max(70, sc.clientHeight * 0.2);
  const d = top - want; if (Math.abs(d) < 8) return;
  const from = sc.scrollTop, to = Math.max(0, Math.min(sc.scrollHeight - sc.clientHeight, from + d)), t0 = performance.now(), dur = canAnimate() ? 420 : 0;
  cancelAnimationFrame(scrollAnim); autoScrolling = true;
  const ease = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  const tick = now => { const f = dur ? Math.min(1, (now - t0) / dur) : 1; sc.scrollTop = from + (to - from) * ease(f); if (f < 1) scrollAnim = requestAnimationFrame(tick); else setTimeout(() => { autoScrolling = false; }, 60); };
  scrollAnim = requestAnimationFrame(tick);
}
/* the finger moves the page while playing: stop following until "Wróć" */
(() => {
  const sc = $("#scroller"), off = () => { if (playState && pb.follow && !autoScrolling) { pb.follow = false; $("#follow-pill").hidden = false; } };
  sc.addEventListener("touchmove", off, { passive: true }); sc.addEventListener("wheel", off, { passive: true });
})();
$("#follow-pill").addEventListener("click", () => {
  pb.follow = true; $("#follow-pill").hidden = true;
  const line = $("#pages .playline"); if (line) { const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(line.style.transform); if (m) scrollToLine({ top: +m[2] }); }
});
/* transport */
$("#btn-play").addEventListener("click", () => {
  if (playState) { stopPlayback(true); return; }
  unlockAudio(); pb.follow = true;
  play(S.fromMs || pb.resumeMs || 0);
});
$("#btn-restart").addEventListener("click", () => {
  pb.resumeMs = 0; clearFromBar(); $("#scroller").scrollTo({ top: 0, behavior: canAnimate() ? "smooth" : "auto" });
  if (playState) { unlockAudio(); play(0); }
});
/* the loop button turns a 4-bar loop on (from the bar being played or chosen); the slider above the bar moves its ends */
$("#btn-loop").addEventListener("click", () => {
  if (pb.loop) { pb.loop = null; drawLoop(); syncLoopUi(); if (playState) play(playPos()); return; }
  const n = measureEls().length; if (!n) return;
  let a = S.fromBar >= 0 ? S.fromBar : 0;
  if (playState && playState.di >= 0) a = playState.di;
  /* nothing chosen: the bars looped last time in this piece come back */
  const mem = !playState && S.fromBar < 0 ? loopMemory() : null;
  pb.loop = mem && mem.b < n ? mem : { a: Math.min(a, n - 1), b: Math.min(n - 1, a + 3) }; drawLoop(); syncLoopUi();
  if (playState) play();
});
/* the last loop of each piece (per device), so practice can pick up where it was */
function loopMemory(set) {
  const id = S.piece && S.piece.id; if (!id) return null;
  let all = {}; try { all = JSON.parse(store.get("loops", "{}")) || {}; } catch {}
  if (set === undefined) { const l = all[id]; return l && Number.isInteger(l.a) && Number.isInteger(l.b) && l.a <= l.b ? { a: l.a, b: l.b } : null; }
  if (all[id] && all[id].a === set.a && all[id].b === set.b) return;
  delete all[id]; all[id] = { a: set.a, b: set.b };
  const ids = Object.keys(all); if (ids.length > 300) delete all[ids[0]];
  store.set("loops", JSON.stringify(all));
}
/* loop slider: two big handles that snap to bars (Flat, Tomplay); the band on the music follows at once */
(() => {
  const track = $("#lb-track"); let drag = null;
  const valAt = x => { const r = track.getBoundingClientRect(), n = measureEls().length; return Math.max(0, Math.min(n - 1, Math.round((x - r.left - 22) / Math.max(1, r.width - 44) * (n - 1)))); };
  ["lb-a", "lb-b"].forEach(id => $("#" + id).addEventListener("pointerdown", e => { drag = id; e.target.setPointerCapture?.(e.pointerId); e.preventDefault(); }));
  track.addEventListener("pointerdown", e => { if (e.target.closest(".lb-th") || !pb.loop) return; const v = valAt(e.clientX); drag = Math.abs(v - pb.loop.a) <= Math.abs(v - pb.loop.b) ? "lb-a" : "lb-b"; move(e); });
  const move = e => {
    if (!drag || !pb.loop) return; const v = valAt(e.clientX), L = pb.loop, a = L.a, b = L.b;
    if (drag === "lb-a") L.a = Math.min(v, L.b); else L.b = Math.max(v, L.a);
    if (L.a === a && L.b === b) return;                        // same bar: nothing to redraw
    drawLoop(); syncLoopUi();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", () => { if (!drag) return; drag = null; const m = measureEls()[pb.loop.a]; if (m && !playState) scrollToBar(m); if (playState) play(); });
})();
function scrollToBar(m) { const pg = $("#pages"), pr = pg.getBoundingClientRect(), r = m.getBoundingClientRect(); scrollToLine({ top: r.top - pr.top }); }
/* a tap anywhere on a line of music finds the nearest bar (no need to hit the bar itself) */
function measureAt(x, y) {
  let best = null, bd = Infinity;
  measureEls().forEach(m => { const r = m.getBoundingClientRect(); const dx = Math.max(r.left - x, 0, x - r.right), dy = Math.max(r.top - y, 0, y - r.bottom), d = dy + dx * 2; if (d < bd) { bd = d; best = m; } });
  return bd < 120 ? best : null;
}
/* with a loop on, a tap on a bar moves the nearer end of the loop there (also while playing) */
function setLoopBar(di) {
  const L = pb.loop; if (!L || di < 0) return;
  if (di < L.a) L.a = di; else if (di > L.b) L.b = di; else if (di - L.a <= L.b - di) L.a = di; else L.b = di;
  drawLoop(); syncLoopUi();
  if (playState) play();
}
function drawLoop() {
  $$("#pages .loopband").forEach(x => x.remove());
  if (!pb.loop) return;
  const ms = measureEls(), pg = $("#pages"), pr = pg.getBoundingClientRect(), rows = new Map();
  ms.slice(pb.loop.a, pb.loop.b + 1).forEach(m => {
    const sys = m.closest("g.system") || m, r = m.getBoundingClientRect(), row = rows.get(sys) || { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity };
    row.l = Math.min(row.l, r.left); row.r = Math.max(row.r, r.right); row.t = Math.min(row.t, r.top); row.b = Math.max(row.b, r.bottom); rows.set(sys, row);
  });
  /* in % of the pages, so zooming in and out keeps the band on its bars */
  const W = pr.width || 1, H = pr.height || 1, pc = v => (v * 100).toFixed(3) + "%";
  rows.forEach(r => { const d = document.createElement("div"); d.className = "loopband"; d.style.cssText = `left:${pc((r.l - pr.left) / W)};top:${pc((r.t - pr.top - 4) / H)};width:${pc((r.r - r.l) / W)};height:${pc((r.b - r.t + 8) / H)}`; pg.appendChild(d); });
}
function syncLoopUi() {
  $("#btn-loop").setAttribute("aria-pressed", String(!!pb.loop));
  if (pb.loop) loopMemory(pb.loop);
  const lb = $("#loopbar"), n = measureEls().length; lb.hidden = !pb.loop || n < 2;
  if (pb.loop && n > 1) {
    const pa = pb.loop.a / (n - 1), pbb = pb.loop.b / (n - 1);
    $("#lb-a").style.left = `calc(${pa * 100}% - ${pa * 44}px)`; $("#lb-b").style.left = `calc(${pbb * 100}% - ${pbb * 44}px)`;
    $("#lb-fill").style.left = `calc(${pa * 100}% - ${pa * 44}px + 22px)`; $("#lb-fill").style.right = `calc(${(1 - pbb) * 100}% - ${(1 - pbb) * 44}px + 22px)`;
    $("#lb-av").textContent = String(pb.loop.a + 1); $("#lb-bv").textContent = String(pb.loop.b + 1);
  }
  $("#loop-t").textContent = pb.loop ? `Pętla: takty ${pb.loop.a + 1}–${pb.loop.b + 1}` : "Powtarzaj kilka taktów";
  $("#loop-s").textContent = "";
}
$("#loop-row").addEventListener("click", () => {
  if (pb.loop) { pb.loop = null; drawLoop(); syncLoopUi(); if (playState) play(playPos()); }
  else closeSheetThen(() => $("#btn-loop").click());
});
/* practice sheet: speed, click, parts */
function buildPracticeSheet() {
  syncTempo(); syncLoopUi();
  const base = S.baseBpm || 120, pct = Math.round(curBpm() / base * 100);
  $$("#speedseg button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.pct === pct)));
  $$("#clickseg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.c === pb.click)));
  $("#swing").checked = !!S.swing;
  const M = $("#mix"); M.innerHTML = "";
  S.parts.filter(p => p.keep).forEach(p => {
    const name = p.name || "Partia", l = document.createElement("label"); l.className = "li";
    l.innerHTML = `<span class="ic">${icon(p.staves > 1 || PIANO_RE.test(p.name) ? "piano" : "trombone")}</span><span class="grow"><b>${esc(name)}</b></span><input type="checkbox" class="switch" ${pb.mute.has(p.id) ? "" : "checked"} aria-label="Słychać: ${esc(name)}">`;
    l.querySelector("input").addEventListener("change", e => { if (e.target.checked) pb.mute.delete(p.id); else pb.mute.add(p.id); if (playState) play(playPos()); });
    M.appendChild(l);
  });
}
$$("#speedseg button").forEach(b => b.addEventListener("click", () => { setBpm(Math.round((S.baseBpm || 120) * +b.dataset.pct / 100)); buildPracticeSheet(); }));
$$("#clickseg button").forEach(b => b.addEventListener("click", () => { pb.click = b.dataset.c; store.set("click", pb.click); buildPracticeSheet(); if (playState) play(playPos()); }));
(() => {
  const sc = $("#scroller"), pg = $("#pages"); let d0 = 0, ratio = 1;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  sc.addEventListener("touchstart", e => { if (e.touches.length === 2) { d0 = dist(e.touches); ratio = 1; } }, { passive: true });
  sc.addEventListener("touchmove", e => {
    if (e.touches.length !== 2 || !d0) return;
    e.preventDefault();
    ratio = Math.max(.5 / zoomNow(), Math.min(zoomMax() / zoomNow(), dist(e.touches) / d0));
    pg.style.transformOrigin = "50% 0"; pg.style.transform = `scale(${ratio})`;
  }, { passive: false });
  sc.addEventListener("touchend", e => {
    if (!d0 || e.touches.length) return;
    pg.style.transform = ""; d0 = 0;
    if (Math.abs(ratio - 1) > .04) setZoom(zoomNow() * ratio);
  });
})();
/* nothing may hide the last line: the space under the music is the dock's real height */
if (window.ResizeObserver) new ResizeObserver(([e]) => $("#score").style.setProperty("--dock-h", Math.round(e.target.offsetHeight) + "px")).observe($("#dock"));
/* the score scrolls under the floating header: keep its real height as padding */
if (window.ResizeObserver) new ResizeObserver(([e]) => $("#score").style.setProperty("--sbar-h", Math.round(e.target.offsetHeight) + "px")).observe($("#score .sbar"));
/* the dock gets smaller while reading downwards and returns on the way back up */
(() => {
  const sc = $("#scroller"), dock = $("#dock"); let last = 0, acc = 0;
  sc.addEventListener("scroll", () => {
    const y = sc.scrollTop, d = y - last; last = y;
    if (y < 40 || y + sc.clientHeight > sc.scrollHeight - 40) { dock.classList.remove("min"); acc = 0; return; }
    acc = Math.sign(d) === Math.sign(acc) ? acc + d : d;
    if (acc > 24) dock.classList.add("min"); else if (acc < -24) dock.classList.remove("min");
  }, { passive: true });
})();
/* the screen locks or another app comes up: the sound file plays on (pause sits on the lock screen); live playback
   cannot, so it stops and keeps its place. Back again: the screen stays awake and the cursor carries on. */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { if (playState && playState.live) stopPlayback(true); else if (pb.preparing) stopPlayback(); }
  else if (playState) keepAwake();
});

/* ---------------- Print & export ---------------- */
async function printScore() {
  await engineReady; stopPlayback();
  tk.setOptions(a4Options({}, 1));                 // the paper size, as the PDF (not the screen's zoom)
  tk.loadData(processedXml());
  let html = "";
  for (let i = 1; i <= tk.getPageCount(); i++) html += `<div class="pg">${tk.renderToSVG(i)}</div>`;
  const pa = $("#print-area"); pa.innerHTML = html;
  const first = pa.querySelector("svg"); if (first) enlargeTitle(first, 1.9);
  S.loadedKey = null;
  setTimeout(() => { window.print(); clearPrintOnTouch(); }, 80);
}
function clearPrint() { const pa = $("#print-area"); if (!pa.innerHTML) return; pa.innerHTML = ""; if (S.view === "score") render(); }
window.addEventListener("afterprint", clearPrint);
/* iOS Safari fires afterprint unreliably: the pages of SVG would stay and the next render be skipped, so the first
   touch after the print sheet has closed clears them too (the page gets no touches while the sheet is open), H4 */
function clearPrintOnTouch() { setTimeout(() => document.addEventListener("pointerdown", clearPrint, { once: true, capture: true }), 1000); }
/* ---- PDF: each A4 page drawn at 300 dpi and packed into a small PDF written right here ---- */
const PDF_DPI = 300, PDF_W = 2480, PDF_H = 3508;
async function pageCanvas(svgStr) {
  const doc = new DOMParser().parseFromString(svgStr, "image/svg+xml");
  return doc.documentElement;
}
async function rasterPage(svgEl) {
  svgEl.setAttribute("width", String(PDF_W)); svgEl.setAttribute("height", String(PDF_H));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svgEl)], { type: "image/svg+xml" }));
  try {
    const img = await loadImage(url);
    const c = document.createElement("canvas"); c.width = PDF_W; c.height = PDF_H;
    const g = c.getContext("2d", { willReadFrequently: true }); g.fillStyle = "#fff"; g.fillRect(0, 0, PDF_W, PDF_H); g.drawImage(img, 0, 0, PDF_W, PDF_H);
    return c;
  } finally { URL.revokeObjectURL(url); }
}
async function deflate(bytes) {
  const cs = new CompressionStream("deflate");
  const out = new Response(new Blob([bytes]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(await out);
}
/* one image per page: lossless grey (Flate) where the browser can compress, JPEG otherwise */
async function pageImage(c) {
  if (typeof CompressionStream !== "undefined") {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data, n = c.width * c.height, gray = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) gray[i] = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8;
    return { data: await deflate(gray), dict: `/ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode` };
  }
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.9));
  return { data: new Uint8Array(await blob.arrayBuffer()), dict: `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode` };
}
function buildPdf(images, w, h, title) {
  const enc = s => { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; };
  const u16 = s => "<FEFF" + [...s].map(ch => { const cp = ch.codePointAt(0); return cp > 0xffff ? "003F" : cp.toString(16).padStart(4, "0"); }).join("").toUpperCase() + ">";
  const parts = [], offs = []; let len = 0;
  const push = b => { parts.push(b); len += b.length; };
  const obj = (n, body, stream) => {
    offs[n] = len; push(enc(`${n} 0 obj\n${body}\n`));
    if (stream) { push(enc("stream\n")); push(stream); push(enc("\nendstream\n")); }
    push(enc("endobj\n"));
  };
  const pw = 595.28, ph = 841.89, n = images.length;
  push(enc("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"));
  const kids = images.map((_, i) => `${4 + i * 3} 0 R`).join(" ");
  obj(1, `<< /Type /Catalog /Pages 2 0 R >>`);
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  obj(3, `<< /Title ${u16(title)} /Producer (Solo) /Creator (Solo) >>`);
  images.forEach((im, i) => {
    const p = 4 + i * 3, content = enc(`q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`);
    obj(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`);
    obj(p + 1, `<< /Length ${content.length} >>`, content);
    obj(p + 2, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} ${im.dict} /Length ${im.data.length} >>`, im.data);
  });
  const total = 4 + n * 3, xref = len;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, "0") + " 00000 n \n";
  push(enc(x + `trailer\n<< /Size ${total} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
  return new Blob(parts, { type: "application/pdf" });
}
let pdfBusy = false;
/* the score (or one part of it) as PDF pages */
async function pdfBlob(xml, title) {
  tk.setOptions(a4Options({}, 1)); tk.loadData(xml);
  const svgs = []; for (let i = 1; i <= tk.getPageCount(); i++) svgs.push(tk.renderToSVG(i));
  S.loadedKey = null;
  const images = [];
  for (let i = 0; i < svgs.length; i++) {
    const el = await pageCanvas(svgs[i]); if (i === 0) enlargeTitle(el, 1.9);
    const c = await rasterPage(el); images.push(await pageImage(c)); c.width = c.height = 1;    // free the memory before the next page
  }
  return buildPdf(images, PDF_W, PDF_H, title);
}
/* parts chosen in the share sheet: one PDF per part, its name on top ("Puzon II") */
let exportParts = [];
async function savePdf(send) {
  if (!S.piece || pdfBusy) return;
  pdfBusy = true; stopPlayback();
  hud("Przygotowuję PDF…", 60000);
  try {
    await engineReady;
    const title = S.piece.title || "Nuty", files = [];
    if (exportParts.length) {
      const keep = S.parts.map(p => p.keep), instr = S.piece.instrument;
      try {
        for (const id of exportParts) {
          const nm = partName(id); S.parts.forEach(p => (p.keep = p.id === id)); S.piece.instrument = nm;
          files.push(new File([await pdfBlob(processedXml(), title)], `${safeName(title)} - ${safeName(nm)}.pdf`, { type: "application/pdf" }));
        }
      } finally { S.parts.forEach((p, i) => (p.keep = keep[i])); S.piece.instrument = instr; }
    } else files.push(new File([await pdfBlob(processedXml(), title)], safeName(title) + ".pdf", { type: "application/pdf" }));
    // iPhone and iPad: the share sheet (Save to Files, AirDrop…); everywhere else a normal download
    const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    let shared = false;
    if ((apple || send) && navigator.canShare && navigator.canShare({ files })) {
      try { await navigator.share({ files, title }); shared = true; } catch (e) { if (e && e.name === "AbortError") shared = true; }
    }
    if (!shared) {
      files.forEach(f => download(f.name, f, "application/pdf"));
      if (send) { location.href = `mailto:?subject=${encodeURIComponent(title)}`; hud("Pobrano. Dołącz plik do wiadomości.", 4000); }
      else hud(files.length > 1 ? `Pobrano ${files.length} ${plural(files.length, "plik", "pliki", "plików")} PDF` : "Pobrano " + files[0].name, 3000);
    }
    else hud("Gotowe", 1200);
  } catch (e) { console.error(e); hud("Nie udało się zapisać PDF. Spróbuj jeszcze raz.", 4000); }
  finally { pdfBusy = false; if (S.view === "score") render(); }
}
function buildShareSheet() {
  const many = S.parts.length > 1; $("#share-parts").hidden = !many; if (!many) { exportParts = []; return; }
  exportParts = exportParts.filter(id => S.parts.some(p => p.id === id));
  $("#share-chips").innerHTML = `<button class="ichip" data-all aria-pressed="${!exportParts.length}">Partytura</button>` +
    S.parts.map(p => `<button class="ichip" ${hueStyle(instrOfPart(p.id))} data-p="${p.id}" aria-pressed="${exportParts.includes(p.id)}">${esc(partName(p.id))}</button>`).join("");
}
$("#share-chips").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.hasAttribute("data-all")) exportParts = [];
  else { const i = exportParts.indexOf(b.dataset.p); if (i >= 0) exportParts.splice(i, 1); else exportParts.push(b.dataset.p); }
  buildShareSheet();
});
/* T20: the first page as a picture, for chats that show images better than PDFs */
async function sendImage() {
  if (!S.piece || pdfBusy) return;
  pdfBusy = true; stopPlayback(); hud("Przygotowuję obraz…", 30000);
  try {
    await engineReady;
    tk.setOptions(a4Options()); tk.loadData(processedXml());
    const el = await pageCanvas(tk.renderToSVG(1)); enlargeTitle(el, 1.9);
    const c = await rasterPage(el); S.loadedKey = null;
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.9));
    const name = safeName(S.piece.title || "Nuty") + ".jpg", file = new File([blob], name, { type: "image/jpeg" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: S.piece.title }); hud("Gotowe", 1200); return; } catch (e) { if (e && e.name === "AbortError") return; } }
    download(name, blob, "image/jpeg"); hud("Pobrano " + name, 3000);
  } catch (e) { console.error(e); hud("Nie udało się przygotować obrazu.", 4000); }
  finally { pdfBusy = false; if (S.view === "score") render(); }
}
async function shareXml() {
  if (!S.piece) return;
  const name = safeName(S.piece.title) + ".musicxml";
  let xml;
  try {
    xml = transposeXmlString(processedXml(), S.iv);
    /* every transposing part says how it sounds (<transpose>), so other programs play it in tune: its instrument's
       transposition (a key change moves written and sounding notes alike); a part read for another instrument (a
       preset) is written for the player's instrument */
    const doc = parseXml(xml), read = readingPartId();
    kids(doc.documentElement, "part").forEach(p => { const pid = p.getAttribute("id"); setTranspose(doc, p, trIv(S.preset >= 0 && pid === read ? mainInstr().tr || 0 : partTr(pid))); });
    xml = new XMLSerializer().serializeToString(doc);
  } catch (e) { console.warn(e); xml = S.piece.xml; }
  const type = "application/vnd.recordare.musicxml+xml";
  try {
    const file = new File([xml], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: S.piece.title }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  download(name, xml, type);
}
$("#btn-share").addEventListener("click", () => openSheet("share"));
$("#btn-print").addEventListener("click", () => closeSheetThen(printScore));


/* ---------------- Clef sheet ---------------- */
const glyphBox = {};
function measureGlyphs() {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("style", "position:absolute;left:-9999px;top:0;width:100px;height:100px");
  document.body.appendChild(svg);
  for (const k in window.CLEF_PATHS || {}) {
    const p = document.createElementNS(ns, "path"); p.setAttribute("d", CLEF_PATHS[k]); p.setAttribute("transform", "scale(1,-1)");
    const g = document.createElementNS(ns, "g"); g.appendChild(p); svg.appendChild(g);
    const b = g.getBBox(); glyphBox[k] = `${b.x - 20} ${b.y - 20} ${b.width + 40} ${b.height + 40}`;
  }
  svg.remove();
}
const glyph = k => `<span class="clefg"><svg viewBox="${glyphBox[k] || "-100 -1100 900 2000"}"><path transform="scale(1,-1)" d="${CLEF_PATHS[k] || ""}"/></svg></span>`;
function octForClef(from, to) {
  const g = c => (c === "treble" ? "G" : c === "bass" ? "F" : c === "tenor" ? "T" : c === "alto" ? "A" : "G");
  const t = { "G>F": -1, "G>T": -1, "G>A": 0, "F>G": 1, "T>G": 1, "A>G": 0 };
  return t[g(from) + ">" + g(to)] || 0;
}
/* reading clef: the octave is chosen by the real notes (fewest ledger lines), and the clef that reads easiest is marked */
function fitFor(clef) {
  /* only the part being read; the key transposition (S.iv) stays as chosen, the octave is its own */
  const idx = partIndexes(S.piece.xml, [readingPartId()]), cur = S.readOct || 0;
  let best = { oct: cur, cost: Infinity };
  /* one or two ledger lines are normal (Gould): every octave away from the real pitch costs more than that */
  for (let o = -2; o <= 2; o++) { const c = ledgerCost(idx.map(x => x + S.iv.d + 7 * o), clef) + Math.abs(o) * 0.35 + Math.abs(o - cur) * 0.02; if (c < best.cost) best = { oct: o, cost: c }; }
  return best;
}
function buildClefSheet() {
  const opts = [["bass", "Basowy", "F"], ["tenor", "Tenorowy", "C"], ["alto", "Altowy", "C"], ["treble", "Wiolinowy", "G"]];
  const fits = Object.fromEntries(opts.map(([v]) => [v, fitFor(v)])), easiest = opts.map(o => o[0]).reduce((a, b) => fits[b].cost < fits[a].cost ? b : a);
  const L = $("#clef-list"); L.innerHTML = "";
  opts.forEach(([v, label, gl]) => {
    const b = document.createElement("button"); b.className = "li tap" + (S.clef === v || (S.clef === "keep" && S.srcClef === v) ? " on" : "");
    b.innerHTML = `${glyph(gl)}<span class="grow"><b>${esc(label)}</b>${v === easiest ? `<small>Najmniej linii dodanych</small>` : ""}</span><span class="radio"></span>`;
    b.addEventListener("click", () => {
      const oct = S.readOct || 0, f = fitFor(v);
      S.clef = v; S.readOct = f.oct; S.clefMine = true;          // the piece's instrument stays what it is
      $("#clef-hint").textContent = f.oct < oct ? "Oktawę niżej: nuty mieszczą się na pięciolinii." : f.oct > oct ? "Oktawę wyżej: nuty mieszczą się na pięciolinii." : "";
      buildClefSheet(); changed();
    });
    L.appendChild(b);
  });
}

/* ---------------- Key sheet ---------------- */
/* "Nuty na inny instrument": music written for `from`, read by the player on their own instrument (profile): the
   interval is the difference of the two transpositions, the octave the one that suits the player's instrument (range,
   comfort, ledger lines), the clef the player's own. Indexes are stored with each piece, so new presets are appended
   and only the display order changes. */
const PRESETS = [
  { t: "Trąbka, klarnet", s: "w B", from: "trabka" },
  { t: "Waltornia", s: "w F", from: "waltornia" },
  { t: "Saksofon altowy", s: "w Es", from: "sax-a" },
  { t: "Skrzypce, flet", s: "w C", from: "flet" },
  { t: "Puzon, eufonium, baryton", s: "w B, klucz wiolinowy", from: "baryton" },
  { t: "Klarnet A", s: "w A", from: "klarnet-a" }
];
const PRESET_ORDER = [4, 0, 1, 2, 5, 3];
function presetRead(idx) {
  const X = instrById(PRESETS[idx].from), Y = mainInstr(), tx = trIv(X.tr), ty = trIv(Y.tr);
  const doc = parseXml(S.piece.xml), part = kids(doc.documentElement, "part").find(p => p.getAttribute("id") === readingPartId());
  let oct = 0, clef = Y.clef;
  if (part) {
    const ps = partPitches(part).map(m => m - (X.tr || 0)), idx = partIdx(part).map(i => i - tx.d);
    if (ps.length) oct = octaveFor(ps, Y, idx);
    const w = partIdx(part).map(i => i + ty.d - tx.d + 7 * oct); let best = ledgerCost(w, Y.clef) - 0.5;
    clefsOf(Y).filter(c => c !== Y.clef && CLEF_LINES[c] != null).forEach(c => { const v = ledgerCost(w, c); if (v < best) { best = v; clef = c; } });
  }
  return { iv: fixEnharmonic({ d: ty.d - tx.d + 7 * oct, s: (Y.tr || 0) - (X.tr || 0) + 12 * oct }, S.srcKey.fifths), clef: CLEF_LINES[clef] != null ? clef : "treble" };
}
function dstFForK(k) { let f = S.srcKey.fifths + 7 * k; while (f > 6) f -= 12; while (f < -6) f += 12; return f === 6 ? -6 : f; }
function kOct() {
  const s = S.iv.s; let k = ((s % 12) + 12) % 12; if (k > 6) k -= 12;
  if (k === 6 && s < 0) k = -6;
  return { k, oct: Math.round((s - k) / 12) };
}
function ivForK(k) {
  if (!k) return { d: 0, s: 0 };
  const off = S.srcKey.mode === "minor" ? 3 : 0;
  const ia = LETTERS.indexOf(lofToPitch(S.srcKey.fifths + off).letter), ib = LETTERS.indexOf(lofToPitch(dstFForK(k) + off).letter);
  return { d: k > 0 ? (ib - ia + 7) % 7 : -((ia - ib + 7) % 7), s: k };
}
function setKOct(k, oct) {
  k = Math.max(-6, Math.min(6, k)); oct = Math.max(-2, Math.min(2, oct));
  const base = ivForK(k), same = kOct().oct === oct;
  S.iv = { d: base.d + 7 * oct, s: base.s + 12 * oct };
  S.preset = -1; if (same) ensureOnStaff(); changed();          // a new key keeps the notes on the staff; an octave the player chose is kept
}
function buildKeySheet() {
  const T = $("#ticks"); T.innerHTML = "";
  for (let k = -6; k <= 6; k++) {
    const t = document.createElement("div"); t.className = "tick" + (k === 0 ? " orig" : "");
    t.style.left = ((k + 6) / 12 * 100) + "%";
    const nm = keyName(dstFForK(k), S.srcKey.mode).replace(/-(dur|moll)$/, "");
    t.innerHTML = `<i></i><span>${esc(k % 2 === 0 || k === -6 || k === 6 ? nm : "")}</span>`;
    T.appendChild(t);
  }
  const PL = $("#preset-list"); PL.innerHTML = "";
  [-1, ...PRESET_ORDER].forEach(idx => {
    const p = idx < 0 ? { t: "Nie" } : PRESETS[idx], r = idx < 0 ? null : presetRead(idx);
    const b = document.createElement("button"); b.className = "li tap"; b.dataset.p = idx;
    b.innerHTML = `<span class="radio"></span><span class="grow">${esc(p.t)}${p.s ? `<small>${esc(p.s)} · ${esc(intervalPl(r.iv))}</small>` : ""}</span>`;
    b.addEventListener("click", () => {
      if (idx < 0) { if (S.preset >= 0) { S.iv = { d: 0, s: 0 }; S.readOct = 0; } S.preset = -1; }
      else { const q = presetRead(idx); S.iv = q.iv; S.clef = q.clef; S.readOct = 0; S.clefMine = true; S.preset = idx; }
      ensureOnStaff();
      changed();
    });
    PL.appendChild(b);
  });
  /* the part is written for a transposing instrument the player does not play: say which preset reads it */
  const solo = S.parts.find(p => p.id === readingPartId()) || S.parts[0], pc = t => (((t || 0) % 12) + 12) % 12;
  const tr = solo ? (partTr(solo.id) || -solo.transp || 0) : 0, hint = tr && pc(tr) !== pc(mainInstr().tr) ? PRESET_ORDER.map(i => PRESETS[i]).find(p => pc(instrById(p.from).tr) === pc(tr)) : null;
  $("#preset-hint").hidden = !hint;
  $("#preset-hint").textContent = hint ? `Nuty na „${partLabel(solo)}”? Wybierz „${hint.t}”.` : "";
  syncKeySheet();
}
/* quick named intervals: a second, third, fourth or fifth up or down */
const IVS = [["sekunda", 1, 2], ["tercja", 2, 4], ["kwarta", 3, 5], ["kwinta", 4, 7]];
(() => {
  const box = $("#ivs");
  [1, -1].forEach(dir => IVS.forEach(([name, d, s]) => {
    const b = document.createElement("button"); b.dataset.d = d * dir; b.dataset.s = s * dir;
    b.innerHTML = `${name}<small>${dir > 0 ? "w górę ↑" : "w dół ↓"}</small>`;
    b.setAttribute("aria-label", `O ${name.replace(/a$/, "ę")} ${dir > 0 ? "w górę" : "w dół"}`);
    b.addEventListener("click", () => { S.iv = { d: d * dir, s: s * dir }; S.preset = -1; ensureOnStaff(); changed(); });
    box.appendChild(b);
  }));
})();
function syncKeySheet() {
  const { k, oct } = kOct();
  const moved = !(S.iv.d === 0 && S.iv.s === 0);
  const kn = $("#key-name"), nk = curKeyName();
  if (kn.textContent && kn.textContent !== nk && canAnimate()) { kn.classList.remove("bump"); void kn.offsetWidth; kn.classList.add("bump"); }
  kn.textContent = nk;
  $("#key-desc").textContent = moved ? `${cap(intervalPl(S.iv))} · oryginał: ${keyName(S.srcKey.fifths, S.srcKey.mode)}` : "Jak w oryginale";
  $("#key-range").value = String(k); $("#key-range").setAttribute("aria-valuetext", nk);   // a screen reader says "F-dur", not "-1"
  if (!slider.dragging) placeHandle();
  const h = $("#handle");
  h.textContent = keyName(S.srcKey.fifths + intervalFifths(S.iv), S.srcKey.mode).replace(/-(dur|moll)$/, "");
  $("#oct-val").textContent = OCT_PL[String(oct)] || "";
  $("#oct-down").disabled = oct <= -2; $("#oct-up").disabled = oct >= 2;
  $("#key-down").disabled = k <= -6; $("#key-up").disabled = k >= 6;
  $$("#preset-list .li").forEach(b => b.classList.toggle("on", Number(b.dataset.p) === S.preset));
  $$("#ivs button").forEach(b => b.classList.toggle("on", S.preset < 0 && +b.dataset.d === S.iv.d && +b.dataset.s === S.iv.s));
}
/* Key slider: the handle follows the finger 1:1, then snaps to the nearest key with a spring.
   A flick carries on: the landing key is chosen from the projected position. */
const slider = { dragging: false, spring: null, step: 0, span: 0 };
function sliderGeom() { const t = $("#ticks"); slider.span = t.clientWidth; slider.step = slider.span / 12; }
function placeHandle(now) {
  const h = $("#handle");
  if (!slider.spring) slider.spring = new Motion.Spring(0, x => { h.style.transform = `translate3d(${x}px,0,0)`; });
  sliderGeom();
  const x = (kOct().k + 6) * slider.step;
  if (now || !slider.span) slider.spring.set(x); else slider.spring.to(x, { damping: 1, response: 0.3 });
}
(function () {
  const sl = $("#slide"); let tr = null, pid = null, off = 0, x = 0;
  const kAt = px => Math.max(-6, Math.min(6, Math.round(px / slider.step) - 6));
  sl.addEventListener("pointerdown", e => {
    if (e.button > 0) return;
    sliderGeom(); pid = e.pointerId; sl.setPointerCapture(pid);
    const left = $("#ticks").getBoundingClientRect().left, px = e.clientX - left;
    const onHandle = !!e.target.closest("#handle") || Math.abs(px - slider.spring.value) < 32;
    slider.spring.stop(); off = onHandle ? px - slider.spring.value : 0;
    slider.dragging = true; tr = new Motion.Tracker(); tr.add(e.clientX, 0);
    x = px - off; slider.spring.set(Math.max(0, Math.min(slider.span, x)));
    const k = kAt(slider.spring.value); if (k !== kOct().k) setKOct(k, kOct().oct);
  });
  sl.addEventListener("pointermove", e => {
    if (pid !== e.pointerId || !slider.dragging) return;
    tr.add(e.clientX, 0);
    const left = $("#ticks").getBoundingClientRect().left;
    x = e.clientX - left - off;
    const shown = x < 0 ? -Motion.rubberband(-x, slider.span) : x > slider.span ? slider.span + Motion.rubberband(x - slider.span, slider.span) : x;
    slider.spring.set(shown);
    const k = kAt(Math.max(0, Math.min(slider.span, x)));
    if (k !== kOct().k) setKOct(k, kOct().oct);
  });
  const end = e => {
    if (pid !== e.pointerId) return; pid = null;
    if (!slider.dragging) return; slider.dragging = false;
    const v = tr.velocity().x;
    const k = kAt(Math.max(0, Math.min(slider.span, x + Motion.project(v, 0.99))));
    if (k !== kOct().k) setKOct(k, kOct().oct);
    slider.spring.to((k + 6) * slider.step, { damping: Math.abs(v) > 300 ? 0.8 : 1, response: 0.3, velocity: v });
  };
  sl.addEventListener("pointerup", end); sl.addEventListener("pointercancel", end);
  window.addEventListener("resize", () => { if (openSheetId === "key") placeHandle(true); });
})();
$("#key-range").addEventListener("input", e => { const { oct } = kOct(); setKOct(Number(e.target.value), oct); });
$("#key-down").addEventListener("click", () => { const { k, oct } = kOct(); setKOct(k - 1, oct); });
$("#key-up").addEventListener("click", () => { const { k, oct } = kOct(); setKOct(k + 1, oct); });
$("#oct-down").addEventListener("click", () => { const { k, oct } = kOct(); setKOct(k, oct - 1); });
$("#oct-up").addEventListener("click", () => { const { k, oct } = kOct(); setKOct(k, oct + 1); });

/* ---------------- More sheet ---------------- */
$$("#layoutseg button").forEach(b => b.addEventListener("click", () => { S.layout = b.dataset.layout; syncLayout(); S.loadedKey = null; changed(); }));
function syncLayout() {
  $("#layout-box").hidden = !S.hasLines; $$("#layoutseg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.layout === S.layout)));
  $$("#pageseg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.page === S.page)));
}
$$("#pageseg button").forEach(b => b.addEventListener("click", () => { S.page = b.dataset.page; S.pageMine = true; syncLayout(); S.loadedKey = null; changed(); }));
$$("#underseg button").forEach(b => b.addEventListener("click", () => { S.under = b.dataset.u; syncArrange(); changed(); }));
$("#swing").addEventListener("change", e => { S.swing = e.target.checked; S.dirty = true; autosave(); if (playState) play(playPos()); });
function syncArrange() { $$("#underseg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.u === (S.under || "")))); $("#swing").checked = !!S.swing; }
function buildMoreSheet() {
  syncLayout(); syncArrange();
  $("#btn-restore").hidden = !canRestore();
  const P = $("#parts"); P.innerHTML = "";
  const isPiano = p => p.staves > 1 || PIANO_RE.test(p.name);
  const solo = S.parts.find(p => !isPiano(p));
  S.parts.forEach(p => {
    const name = p === solo && S.piece.instrument ? S.piece.instrument : p.name;
    const l = document.createElement("label"); l.className = "li";
    l.innerHTML = `<span class="ic">${icon(isPiano(p) ? "piano" : "trombone")}</span><span class="grow"><b>${esc(name)}</b></span><input type="checkbox" class="tog" ${p.keep ? "checked" : ""} aria-label="Pokaż: ${esc(name)}">`;
    l.querySelector("input").addEventListener("change", e => {
      p.keep = e.target.checked;
      if (!S.parts.some(x => x.keep)) { p.keep = true; e.target.checked = true; hud("Jedna partia musi zostać"); return; }
      buildMoreSheet(); changed();
    });
    P.appendChild(l);
  });
  syncTempo();
  $("#zoom-val").textContent = Math.round(zoomNow() * 100) + "%";
  $("#f-title").value = S.piece.title || ""; $("#f-composer").value = S.piece.composer || ""; $("#f-instrument").value = S.piece.instrument || "";
  const imgs = S.piece.images || [];
  $("#row-orig").hidden = !imgs.length;
    $("#btn-delete").hidden = !S.piece.id;
}
/* Tempo in quarter notes per minute, like a metronome. Exact: type it, or step with − and +
   (hold to repeat). It applies at once: if the music is playing, it carries on from the same place. */
const curBpm = () => S.bpm || S.baseBpm || 120;
function syncTempo() {
  const base = Math.round(S.baseBpm || 120), inp = $("#tempo");
  if (document.activeElement !== inp) inp.value = String(curBpm());
  const r = $("#tempo-reset"); r.hidden = !(S.bpm && S.bpm !== base); r.textContent = `Przywróć ${base}`;
  $("#tp-bpm").textContent = String(curBpm());
}
let tempoTimer = null;
function setBpm(v, opt = {}) {
  v = Math.round(Math.max(20, Math.min(300, v)));
  if (!Number.isFinite(v)) return;
  const base = Math.round(S.baseBpm || 120);
  S.bpm = v === base ? null : v;
  if (!opt.typing) $("#tempo").value = String(v);
  syncTempo();
  if (S.piece && S.piece.sourceType !== "example") { S.dirty = true; autosave(); }
  clearTimeout(tempoTimer);
  if (playState) tempoTimer = setTimeout(() => { if (playState) play(playPos()); }, 150);
}
$("#tempo").addEventListener("input", e => {
  const v = parseInt(e.target.value, 10);
  if (v >= 20 && v <= 300) setBpm(v, { typing: true });
});
$("#tempo").addEventListener("change", e => { const v = parseInt(e.target.value, 10); if (Number.isFinite(v)) setBpm(v); else syncTempo(); });
$("#tempo").addEventListener("keydown", e => { if (e.key === "Enter") e.target.blur(); });
$("#tempo").addEventListener("focus", e => setTimeout(() => e.target.select(), 0));
$("#tempo-reset").addEventListener("click", () => setBpm(Math.round(S.baseBpm || 120)));
[["#tempo-down", -1], ["#tempo-up", 1]].forEach(([sel, d]) => {
  const b = $(sel); let t = null, n = 0;
  const stop = () => { clearTimeout(t); t = null; };
  const tick = () => { setBpm(curBpm() + d * (n > 12 ? 5 : 1)); n++; t = setTimeout(tick, n > 12 ? 110 : 75); };
  b.addEventListener("pointerdown", e => { if (e.button) return; n = 0; setBpm(curBpm() + d); stop(); t = setTimeout(tick, 420); });
  ["pointerup", "pointerleave", "pointercancel"].forEach(ev => b.addEventListener(ev, stop));
  b.addEventListener("click", e => { if (e.detail === 0) setBpm(curBpm() + d); });   // keyboard
  b.addEventListener("contextmenu", e => e.preventDefault());
});
/* note size: 50-200 %, remembered for the piece (and as the default for new pieces) */
/* A4 pages zoom like a PDF: the sheet itself grows (and can be moved sideways), its lines stay as on paper.
   "Dopasuj do ekranu" zooms the music instead, and the lines are laid out again. */
const zoomNow = () => S.page === "screen" ? S.zoom : (S.pz || 1), zoomMax = () => S.page === "screen" ? 2 : 3;
function applyPageZoom() {
  const pg = $("#pages"), a4 = S.mode === "pages";
  pg.classList.toggle("a4", a4); pg.style.width = a4 ? `calc(min(960px, 100%) * ${S.pz || 1})` : "";
  requestAnimationFrame(drawLoop);
}
const setZoom = z => {
  z = Math.round(Math.max(.5, Math.min(zoomMax(), z)) * 10) / 10;
  if (S.page === "screen") { S.zoom = z; store.set("zoom2", z); if (S.piece) S.piece.zoom = z; render(); }
  else { S.pz = z; applyPageZoom(); }
  $("#zoom-val").textContent = Math.round(z * 100) + "%"; if (S.piece) { S.dirty = true; autosave(); }
};
$("#zoom-in").addEventListener("click", () => setZoom(zoomNow() + .1));
$("#zoom-out").addEventListener("click", () => setZoom(zoomNow() - .1));
[["#f-title", "title"], ["#f-composer", "composer"], ["#f-instrument", "instrument"]].forEach(([sel, k]) => {
  $(sel).addEventListener("change", e => { S.piece[k] = e.target.value.trim(); if (k === "title" && !S.piece.title) S.piece.title = "Bez tytułu"; changed(); if (k === "instrument" && openSheetId === "more") buildMoreSheet(); });
});
/* the photo of the notes goes along only when the person says so (it can show more than the music) */
$("#btn-report").addEventListener("click", () => {
  const p = S.piece || {}, nums = doubtfulBars(p.issues);
  const text = [`Solo ${VERSION}${BUILD ? " · test " + BUILD : ""}: problem z utworem „${p.title || "Bez tytułu"}”.`,
    `Tonacja: ${curKeyName()}; klucz: ${CLEF_PL[curClef()] || ""}; ${cap(intervalPl(S.iv)) || "bez transpozycji"}; wielkość ${Math.round(S.zoom * 100)}%.`,
    nums.length ? `Takty do sprawdzenia: ${nums.join(", ")}.` : "", "Co jest nie tak:", ""].filter(Boolean).join("\n");
  const data = { title: "Solo: zgłoszenie", text };
  const send = async withPhoto => {
    try {
      /* the share call stays inside the tap: no waiting before it */
      if (withPhoto && navigator.canShare) {
        const file = new File([dataUrlBlob(p.images[0])], "oryginal.jpg", { type: "image/jpeg" });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ ...data, files: [file] }); return; }
      }
      if (navigator.share) { await navigator.share(data); return; }
    } catch (e) { if (e && e.name === "AbortError") return; console.warn(e); }
    location.href = "mailto:nniewinskame@gmail.com?subject=" + encodeURIComponent("Solo: zgłoszenie") + "&body=" + encodeURIComponent(text);
  };
  if (p.images && p.images[0] && navigator.canShare) askConfirm("Dołączyć zdjęcie nut?", "Zdjęcie pomaga znaleźć błąd odczytu. Wyślesz je tylko tam, gdzie wybierzesz.", "Dołącz zdjęcie", () => send(true), "Bez zdjęcia", () => send(false));
  else send(false);
});
/* one question sheet for every "are you sure": delete, restore the reading, attach the photo */
let delTarget = null, confirmFn = null, confirmAlt = null;
function askConfirm(title, text, yes, fn, alt, altFn) {
  delTarget = null; confirmFn = fn; confirmAlt = altFn || null;
  $("#confirm-t").textContent = title; $("#confirm-text").textContent = text; $("#confirm-yes").textContent = yes;
  let b = $("#confirm-alt");
  if (!b) { b = document.createElement("button"); b.id = "confirm-alt"; b.className = "btn tinted wide"; $("#confirm-yes").after(b);
    b.addEventListener("click", () => { const f = confirmAlt; confirmFn = confirmAlt = null; closeSheet(); if (f) f(); }); }
  b.textContent = alt || ""; b.hidden = !alt;
  $("#confirm-yes").classList.toggle("danger", !alt); $("#confirm-yes").classList.toggle("primary", !!alt);   // a choice of two harmless ways is not red
  openSheet("confirm");
}
function askDelete(p, fromLibrary) {
  askConfirm(`Usunąć „${p.title || "Bez tytułu"}”?`, "Nuty i zdjęcie znikną z tego urządzenia.", "Usuń", null);
  delTarget = { id: p.id, fromLibrary };
}
$("#btn-delete").addEventListener("click", () => askDelete(S.piece, false));
$("#confirm-yes").addEventListener("click", async () => {
  if (confirmFn) { const f = confirmFn; confirmFn = confirmAlt = null; closeSheet(); f(); return; }     // in the same tap (share needs it)
  const t = delTarget || { id: S.piece && S.piece.id }; delTarget = null;
  if (!t.id) { closeSheet(); return; }
  /* kept in memory for "Cofnij"; the piece also leaves its collections and the favourites */
  let rec = null; try { rec = await DB.get(t.id); } catch (e) { console.warn(e); }
  try { await DB.del(t.id); } catch (e) { console.warn(e); closeSheet(); hud("Nie udało się usunąć. Spróbuj jeszcze raz.", 3500); return; }
  const inCols = cols().filter(c => c.items.includes(t.id)).map(c => c.id), wasFav = favs().includes(t.id);
  saveCols(cols().map(c => ({ ...c, items: c.items.filter(x => x !== t.id) }))); saveFavs(favs().filter(x => x !== t.id));
  const undo = rec && (async () => {
    if (!(await putRecord(rec))) return;
    saveCols(cols().map(c => inCols.includes(c.id) ? { ...c, items: [...new Set([...c.items, t.id])] } : c));
    if (wasFav) saveFavs([...new Set([...favs(), t.id])]);
    hud("Przywrócono", 1800); if (S.view === "home") refreshLibrary();
  });
  const done = () => { hudAct("Usunięto", "Cofnij", undo, 6000); refreshLibrary(); };
  if (t.fromLibrary) { closeSheetThen(done); return; }
  clearTimeout(saveTimer); saveTimer = null; S.piece = null; closeSheetThen(() => { done(); go("home"); });
});
/* a short message with one action ("Cofnij"); the action works once */
function hudAct(msg, label, fn, ms = 4000) {
  hud(msg, ms); if (!fn) return;
  const h = $("#toast"), b = document.createElement("button"); b.className = "toast-act"; b.textContent = label;
  b.addEventListener("click", () => { h.classList.remove("show"); b.remove(); fn(); }, { once: true });
  h.appendChild(b);
}
/* a long press on a piece in the library: open, send, rename, delete */
let cardPiece = null, cardEl = null;
function openCardSheet(p, el) { cardPiece = p; cardEl = el; $("#sh-card-t").textContent = p.title || "Bez tytułu"; openSheet("card"); }
$("#cd-open")?.addEventListener("click", () => { const p = cardPiece; closeSheetThen(() => openFromLibrary(p)); });
$("#cd-send").addEventListener("click", () => { const p = cardPiece; closeSheetThen(async () => { await openFromLibrary(p); whenDrawn(() => openSheet("share")); }); });
$("#cd-rename").addEventListener("click", () => { const el = cardEl, p = cardPiece; closeSheetThen(() => { const t = el && el.querySelector(".t"); if (t) inlineEdit(t, { value: p.title || "", placeholder: "Tytuł", onSave: v => renameInLibrary(p, "title", v) }); }); });
$("#cd-del").addEventListener("click", () => { const p = cardPiece; closeSheetThen(() => askDelete(p, true)); });
/* a full copy (notes, parts, photos, settings) under the next free title: "Etiuda 2" */
$("#cd-dup").addEventListener("click", () => { const p = cardPiece; closeSheetThen(() => duplicatePiece(p)); });
async function duplicatePiece(p) {
  try {
    const src = (await DB.get(p.id)) || p, all = await DB.all(), names = new Set(all.map(x => x.title));
    const base = (src.title || "Bez tytułu").replace(/ \d+$/, ""); let k = 2, title = `${base} ${k}`; while (names.has(title)) title = `${base} ${++k}`;
    const now = Date.now(), rec = { ...src, id: "p" + now.toString(36) + Math.random().toString(36).slice(2, 7), title, created: now, updated: now, opened: now };
    await DB.put(rec); refreshLibrary(); hud(`Kopia: ${title}`, 2500);
  } catch (e) { console.warn(e); hud(saveErrorText(e), 4000); }
}

/* ---------------- Original photo ---------------- */
function buildOrigSheet() {
  $("#orig-imgs").innerHTML = (S.piece.images || []).map((src, i) => `<img src="${esc(src)}" alt="Oryginał, strona ${i + 1}">`).join("");
}
/* ---------------- New music: files, photos, reading ---------------- */
/* A page waiting to be read: the photo for the reader (a Blob, not a 3 MB data URL), its size, a smaller copy kept
   with the piece, an optional top/bottom cut, and once read, its result. A result is kept when a later page fails,
   so "Czytaj dalej" reads only what is left (B-15). */
let pending = [];
const MAX_PAGES = 12;
const isXmlFile = f => /\.(musicxml|xml|mxl)$/i.test(f.name) || /musicxml/.test(f.type);
async function handleFiles(files) {
  files = Array.from(files || []); if (!files.length) return;
  if (cam.open) await closeCamera();
  hideWelcome();
  const xmlF = files.find(isXmlFile);
  if (xmlF) { await openXmlFile(xmlF); return; }
  await addPages(files);
  if (pending.length && openSheetId !== "pages") { if (S.view !== "home") go("home"); openSheet("pages"); }
}
async function openXmlFile(f) {
  try {
    let xml;
    if (/\.mxl$/i.test(f.name) || f.type === "application/vnd.recordare.musicxml") {
      const zip = await JSZip.loadAsync(f);
      let path = null;
      const cont = zip.file("META-INF/container.xml");
      if (cont) { const m = (await cont.async("string")).match(/full-path="([^"]+)"/); if (m) path = m[1]; }
      if (!path) path = Object.keys(zip.files).find(n => /\.(xml|musicxml)$/i.test(n) && !n.startsWith("META-INF"));
      if (!path || !zip.file(path)) throw new Error("W tym pliku nie ma nut.");
      xml = await zip.file(path).async("string");
    } else xml = await f.text();
    if (!/<(score-partwise|score-timewise)\b/.test(xml)) throw new Error("W tym pliku nie ma nut.");
    /* the same file opened again: the piece already in the library, not a copy (B-80) */
    const same = (await DB.all().catch(() => [])).find(p => p.xml === xml);
    if (same) { await openFromLibrary(same); hud("Ten utwór już masz w bibliotece."); return; }
    /* no title in the file: its name ("Hay Burner.musicxml" → "Hay Burner"), H3 */
    const named = /<(work-title|movement-title)>\s*[^<\s]/.test(xml);
    const title = named ? "" : f.name.replace(/\.(musicxml|xml|mxl)$/i, "").replace(/[_]+/g, " ").trim();
    openPiece({ xml, sourceType: "file", title, composer: null });
  } catch (err) { console.error(err); hud(err.message || "Nie udało się otworzyć pliku.", 4000); }
}
const newPageId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
async function makePage(src) {
  const { blob, W, H } = await canvasToJpegBlob(src, 2400, 0.9);
  return { id: newPageId(), big: blob, W, H, keep: canvasToJpeg(src, 1600, 0.82), crop: null, res: null };
}
/* PlayScore's advice, without a live camera: a dark photo, or one half much darker than the other (a shadow of the
   phone or a hand), reads worse; say so when the page is added */
function lightHint(src) {
  try {
    const w = 24, h = 32, c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(src, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data; c.width = c.height = 0;
    const lum = []; for (let i = 0; i < d.length; i += 4) lum.push(0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]);
    const avg = f => { let s = 0, k = 0; lum.forEach((v, i) => { if (f(i % w, Math.floor(i / w))) { s += v; k++; } }); return k ? s / k : 0; };
    if (avg(() => true) < 90) return "Zdjęcie jest ciemne. Lepiej zrobić je przy dobrym świetle.";
    const halves = [avg(x => x < w / 2), avg(x => x >= w / 2), avg((x, y) => y < h / 2), avg((x, y) => y >= h / 2)];
    if (Math.max(...halves) - Math.min(...halves) > 55) return "Na zdjęciu jest cień. Lepiej zrobić je przy równym świetle.";
  } catch (e) { console.warn(e); }
  return "";
}
async function addPages(files) {
  $("#read-error").hidden = true;
  let hint = "";
  for (const f of files) {
    if (pending.length >= MAX_PAGES) { hud(`Najwyżej ${MAX_PAGES} stron naraz`); break; }
    try {
      if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
        const pdf = await pdfjsLib.getDocument({ data: await f.arrayBuffer(), isEvalSupported: false }).promise;
        try {
          const pick = pdf.numPages > 1 ? await pickPdfPages(pdf, MAX_PAGES - pending.length) : [1];
          for (const i of pick) {
            if (pending.length >= MAX_PAGES) { hud(`Najwyżej ${MAX_PAGES} stron naraz`); break; }
            pending.push(await renderPdfPage(pdf, i));
          }
        } finally { pdf.destroy().catch(e => console.warn(e)); }
      } else if (f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(f.name)) {
        const url = URL.createObjectURL(f);
        try {
          const img = await loadImage(url).catch(() => { throw new Error("Tego formatu zdjęcia nie da się otworzyć. Zrób zrzut ekranu albo zapisz zdjęcie jako JPG."); });
          pending.push(await makePage(img));
          hint = hint || lightHint(img);
        } finally { URL.revokeObjectURL(url); }
      } else throw new Error("Solo otwiera zdjęcia, PDF i pliki MusicXML.");
    } catch (e) { console.error(e); hud(e.message || "Nie udało się otworzyć pliku.", 4000); }
  }
  drawPending();
  if (hint) hud(hint, 5000);
}
async function renderPdfPage(pdf, i, edge = 2400) {
  const page = await pdf.getPage(i), vp0 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: edge / Math.max(vp0.width, vp0.height) });
  const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
  try {
    const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    return edge < 1000 ? c.toDataURL("image/jpeg", .7) : await makePage(c);
  } finally { c.width = c.height = 0; try { page.cleanup(); } catch (e) { console.warn(e); } }      // canvas memory back at once (R21)
}
/* a PDF with several pages: show them all small and let the user tick the ones to read (T13). Thumbnails are drawn
   one at a time as they scroll into view (a 30-page PDF no longer renders 30 pages at once), and no more pages can
   be ticked than still fit (B-22). */
function pickPdfPages(pdf, cap = MAX_PAGES) {
  return new Promise(resolve => {
    const box = $("#pdf-pages"), chosen = new Set();
    box.innerHTML = ""; $("#pdf-count").textContent = `${pdf.numPages} ${plural(pdf.numPages, "strona", "strony", "stron")}`;
    const sync = () => { $("#pdf-add").disabled = !chosen.size; $("#pdf-add span").textContent = chosen.size ? `Dodaj ${chosen.size} ${plural(chosen.size, "stronę", "strony", "stron")}` : "Wybierz strony"; };
    const full = () => hud(`Można dodać najwyżej ${cap} ${plural(cap, "stronę", "strony", "stron")}`);
    let queue = Promise.resolve(), closed = false;
    const thumb = (b, i) => { queue = queue.then(() => closed ? null : renderPdfPage(pdf, i, 300).then(u => { const im = new Image(); im.src = u; im.alt = ""; b.prepend(im); }).catch(e => console.warn(e))); };
    const io = "IntersectionObserver" in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); thumb(e.target, +e.target.dataset.page); } }), { rootMargin: "300px" }) : null;
    for (let i = 1; i <= pdf.numPages; i++) {
      const b = document.createElement("button"); b.setAttribute("aria-pressed", "false"); b.setAttribute("aria-label", `Strona ${i}`); b.dataset.page = String(i);
      b.innerHTML = `<span>${i}</span>`;
      b.addEventListener("click", () => {
        const on = !chosen.has(i); if (on && chosen.size >= cap) { full(); return; }
        on ? chosen.add(i) : chosen.delete(i); b.setAttribute("aria-pressed", String(on)); sync();
      });
      box.appendChild(b);
      if (io) io.observe(b); else thumb(b, i);
    }
    sync();
    const done = list => { closed = true; if (io) io.disconnect(); $("#pdf-add").onclick = null; pickPdfPages.cancel = null; resolve(list); };
    $("#pdf-add").onclick = () => { const list = [...chosen].sort((a, b) => a - b); done(list); closeSheet(); };
    $("#pdf-all").onclick = () => {
      chosen.clear(); for (let i = 1; i <= Math.min(pdf.numPages, cap); i++) chosen.add(i);
      $$("#pdf-pages button").forEach(b => b.setAttribute("aria-pressed", String(chosen.has(+b.dataset.page)))); sync();
      if (pdf.numPages > cap) full();
    };
    pickPdfPages.cancel = () => done([]);
    openSheet("pdf");
  });
}
function drawPending() {
  const t = $("#pending"); t.innerHTML = "";
  pending.forEach((p, i) => {
    const f = document.createElement("figure"); if (p.res) f.classList.add("done");
    f.innerHTML = `<img src="${p.keep}" alt="Strona ${i + 1}${p.res ? ", odczytana" : ""}. Dotknij, żeby przyciąć." role="button" tabindex="0"><figcaption>${p.res ? "✓ " : ""}${i + 1}</figcaption><button class="del" aria-label="Usuń stronę ${i + 1}">${icon("x")}</button>`;
    const im = f.querySelector("img");
    if (p.crop) im.style.clipPath = `inset(${(p.crop.t * 100).toFixed(1)}% 0 ${(p.crop.b * 100).toFixed(1)}% 0)`;
    im.addEventListener("click", () => openCrop(p));
    im.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCrop(p); } });
    f.querySelector(".del").addEventListener("click", () => { const k = pending.indexOf(p); if (k >= 0) pending.splice(k, 1); $("#read-error").hidden = true; drawPending(); if (!pending.length) closeSheet(); });
    t.appendChild(f);
  });
  if (pending.length && pending.length < MAX_PAGES) {
    const f = document.createElement("figure");
    f.innerHTML = `<button class="add" data-act="camera" aria-label="Dodaj stronę">${icon("plus")}</button><figcaption>&nbsp;</figcaption>`;
    t.appendChild(f);
  }
  $("#btn-read").disabled = !pending.length;
  $("#btn-read span").textContent = pending.some(p => p.res) && pending.some(p => !p.res) ? "Czytaj dalej" : "Odczytaj nuty";
  $("#crop-hint").hidden = !pending.length;
  savePendingSoon();
}
["#in-camera", "#in-files", "#in-gallery"].forEach(sel => $(sel).addEventListener("change", e => { const fs = Array.from(e.target.files); e.target.value = ""; handleFiles(fs); }));
/* the "Z galerii" and "Z pliku" rows are labels of hidden inputs: reachable with Tab, opened with Enter or Space (K15) */
document.addEventListener("keydown", e => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const l = e.target && e.target.closest ? e.target.closest("label[for][tabindex]") : null; if (!l) return;
  const inp = document.getElementById(l.htmlFor); if (!inp || inp.type !== "file") return;
  e.preventDefault(); inp.click();
});

/* ---- Pages wait in the browser's cache until they are read: closing Solo or a crash loses nothing (B-15) ---- */
const PENDING_CACHE = "solo-pending";
let pendingSaveT = 0, pendingSaving = Promise.resolve(), pendingRestored = false;
function savePendingSoon() { if (!pendingRestored) return; clearTimeout(pendingSaveT); pendingSaveT = setTimeout(() => { pendingSaving = pendingSaving.then(savePending); }, 400); }
async function savePending() {
  if (!("caches" in window)) return;
  try {
    if (!pending.length) { await caches.delete(PENDING_CACHE); return; }
    const c = await caches.open(PENDING_CACHE), have = await c.keys(), idOf = k => k.url.split("/pending/")[1];
    for (const k of have) { const id = idOf(k); if (id && id !== "list" && !pending.some(p => p.id === id)) await c.delete(k); }
    for (const p of pending) if (!have.some(k => idOf(k) === p.id)) await c.put(new Request("pending/" + p.id), new Response(p.big, { headers: { "content-type": "image/jpeg" } }));
    const list = pending.map(({ id, W, H, keep, crop, res }) => ({ id, W, H, keep, crop, res }));
    await c.put(new Request("pending/list"), new Response(JSON.stringify(list), { headers: { "content-type": "application/json" } }));
  } catch (e) { console.warn("pending pages not kept", e); }
}
async function restorePending() {
  try { await restorePending1(); } finally { pendingRestored = true; if (pending.length) savePendingSoon(); }
}
async function restorePending1() {
  try {
    if (!("caches" in window) || !(await caches.has(PENDING_CACHE))) return;
    const c = await caches.open(PENDING_CACHE), r = await c.match("pending/list"); if (!r) return;
    const list = await r.json(), got = [];
    for (const p of list) { const b = await c.match("pending/" + p.id); if (b && p.keep) got.push({ ...p, big: await b.blob() }); }
    if (!got.length) { await caches.delete(PENDING_CACHE); return; }
    pending = [...got, ...pending.filter(p => !got.some(g => g.id === p.id))].slice(0, MAX_PAGES); drawPending();
    const n = got.length;
    hudAct(`${n} ${plural(n, "strona czeka", "strony czekają", "stron czeka")} na odczyt`, "Pokaż", () => { hideWelcome(); if (S.view !== "home") go("home"); if (openSheetId !== "pages") openSheet("pages"); }, 8000);
  } catch (e) { console.warn(e); }
}

/* ---- Cutting off the top and bottom of a page (the next page's staves, a title, a hand), K10 ----
   The cut is painted white on the photo for the reader, so the size and every position on it stay as they were. */
let cropPage = null, cropT = 0, cropB = 0;
const CROP_MIN = 0.1;                        // at least a tenth of the page stays
function openCrop(p) {
  if (!pending.includes(p)) return;
  cropPage = p; cropT = p.crop ? p.crop.t : 0; cropB = p.crop ? p.crop.b : 0;
  $("#crop-img").src = p.keep; $("#sh-crop-t").textContent = `Przytnij stronę ${pending.indexOf(p) + 1}`;
  drawCrop(); openSheet("crop");
}
function drawCrop() {
  const pc = v => (v * 100).toFixed(2) + "%";
  $("#crop-cut-t").style.height = pc(cropT); $("#crop-cut-b").style.height = pc(cropB);
  $("#crop-top").style.top = pc(cropT); $("#crop-bot").style.bottom = pc(cropB);
  $("#crop-top").setAttribute("aria-valuenow", String(Math.round(cropT * 100)));
  $("#crop-bot").setAttribute("aria-valuenow", String(Math.round(cropB * 100)));
}
function setCrop(edge, v) {
  v = Math.max(0, Math.min(1 - CROP_MIN - (edge === "t" ? cropB : cropT), v));
  if (edge === "t") cropT = v; else cropB = v;
  drawCrop();
}
(function cropDrag() {
  const box = $("#crop-box"); let edge = null, pid = null;
  box.addEventListener("touchstart", e => e.stopPropagation(), { passive: true });     // not the sheet's pull-to-close
  box.addEventListener("pointerdown", e => {
    const r = box.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
    edge = e.target.id === "crop-top" ? "t" : e.target.id === "crop-bot" ? "b" : Math.abs(y - cropT) <= Math.abs(1 - cropB - y) ? "t" : "b";
    pid = e.pointerId; box.setPointerCapture(pid); e.preventDefault();
    setCrop(edge, edge === "t" ? y : 1 - y);
  });
  box.addEventListener("pointermove", e => {
    if (e.pointerId !== pid) return;
    const r = box.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
    setCrop(edge, edge === "t" ? y : 1 - y);
  });
  const end = e => { if (e.pointerId === pid) { pid = null; edge = null; } };
  box.addEventListener("pointerup", end); box.addEventListener("pointercancel", end);
  [["#crop-top", "t"], ["#crop-bot", "b"]].forEach(([sel, ed]) => $(sel).addEventListener("keydown", e => {
    const step = e.shiftKey ? 0.1 : 0.02, dir = { ArrowDown: 1, ArrowUp: -1 }[e.key]; if (!dir) return;
    e.preventDefault(); setCrop(ed, (ed === "t" ? cropT : cropB) + (ed === "t" ? dir : -dir) * step);
  }));
  $("#crop-all").addEventListener("click", () => { cropT = cropB = 0; drawCrop(); });
  $("#crop-done").addEventListener("click", () => {
    const p = cropPage; cropPage = null;
    if (p && pending.includes(p)) {
      const crop = cropT > 0.005 || cropB > 0.005 ? { t: cropT, b: cropB } : null;
      if (JSON.stringify(crop) !== JSON.stringify(p.crop)) { p.crop = crop; p.res = null; }      // a new cut is read again
      drawPending();
    }
    openSheet("pages");
  });
})();
/* the photo the reader gets: the page with its cut-off bands painted white */
async function pageBlob(p) {
  if (!p.crop) return p.big;
  const url = URL.createObjectURL(p.big);
  try {
    const im = await loadImage(url), c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight;
    const g = c.getContext("2d"); g.drawImage(im, 0, 0); g.fillStyle = "#fff";
    const t = Math.round(p.crop.t * c.height), b = Math.round(p.crop.b * c.height);
    g.fillRect(0, 0, c.width, t); g.fillRect(0, c.height - b, c.width, b);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.9)); c.width = c.height = 0;
    if (!blob) throw new Error("Za mało pamięci na to zdjęcie. Zamknij inne karty i spróbuj jeszcze raz.");
    return blob;
  } finally { URL.revokeObjectURL(url); }
}

/* ---- Camera ---- */
const cam = { open: false, stream: null, track: null, busy: false, torch: false };
const camEl = $("#cam"), camVideo = $("#cam-video");
const CAM_ERR = {
  NotAllowedError: ["Brak dostępu do aparatu", "Zezwól na aparat w ustawieniach albo wybierz zdjęcie z galerii."],
  NotFoundError: ["Nie znaleziono aparatu", "Wybierz zdjęcie z galerii."],
  NotReadableError: ["Aparat jest zajęty", "Zamknij inne aplikacje, które z niego korzystają, i spróbuj jeszcze raz."],
  OverconstrainedError: ["Nie udało się włączyć aparatu", "Spróbuj jeszcze raz albo wybierz zdjęcie z galerii."]
};
function camMessage(err) {
  const [t, p] = CAM_ERR[err && err.name] || CAM_ERR.OverconstrainedError;
  $("#cam-msg-t").textContent = t; $("#cam-msg-p").textContent = p;
  $("#cam-msg").hidden = false; $("#cam-tip").hidden = true; camEl.querySelector(".cam-frame").hidden = true;
  $("#cam-shot").disabled = true;
}
async function startStream() {
  $("#cam-msg").hidden = true; $("#cam-tip").hidden = false; camEl.querySelector(".cam-frame").hidden = false;
  $("#cam-shot").disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } } });
    if (!cam.open) { stream.getTracks().forEach(t => t.stop()); return; }
    cam.stream = stream; cam.track = stream.getVideoTracks()[0];
    camVideo.srcObject = stream;
    await camVideo.play().catch(() => {});
    const caps = cam.track.getCapabilities ? cam.track.getCapabilities() : {};
    if (caps.focusMode && caps.focusMode.includes("continuous")) cam.track.applyConstraints({ advanced: [{ focusMode: "continuous" }] }).catch(() => {});
    $("#cam-torch").hidden = !caps.torch; cam.torch = false; $("#cam-torch").setAttribute("aria-pressed", "false");
    $("#cam-shot").disabled = false;
    watchLight();
  } catch (e) { console.warn(e); if (cam.open) camMessage(e); }
}
/* PlayScore's live hint: too dark or a shadow across the page reads badly, so the tip says so while aiming */
const CAM_TIP = "Cała strona w kadrze, prosto z góry";
function watchLight() {
  clearInterval(cam.lightT);
  cam.lightT = setInterval(() => {
    if (!cam.stream || !camVideo.videoWidth) return;
    const hint = lightHint(camVideo);
    $("#cam-tip").textContent = hint ? hint.replace("Zdjęcie jest ciemne. Lepiej zrobić je", "Za ciemno. Lepiej").replace("Na zdjęciu jest cień. Lepiej zrobić je", "Cień na kartce. Lepiej") : CAM_TIP;
  }, 1200);
}
function stopStream() {
  clearInterval(cam.lightT); $("#cam-tip").textContent = CAM_TIP;
  if (cam.stream) cam.stream.getTracks().forEach(t => t.stop());
  cam.stream = cam.track = null; camVideo.srcObject = null;
}
/* Phones and tablets: the device's own camera app. Computers can't open it from a web page,
   so there Solo shows its own viewfinder. */
const hasNativeCamera = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
function openCamera() {
  if (hasNativeCamera() || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $("#in-camera").click(); return; }
  if (cam.open) return;
  cam.open = true; cam.busy = false; camEl.classList.remove("busy");
  history.pushState({ v: S.view, cam: true, sheet: !!openSheetId }, "");
  presentCover(camEl);
  startStream();
}
/* closes the viewfinder; resolves once the history entry is gone */
function closeCamera(fromPop) {
  if (!cam.open) return Promise.resolve();
  cam.open = false; stopStream(); dismissCover(camEl);
  if (fromPop) return Promise.resolve();
  return new Promise(res => { skipPop++; afterPop = res; history.back(); });
}
async function takePhoto() {
  if (!cam.track || cam.busy) return;
  cam.busy = true; camEl.classList.add("busy"); $("#cam-shot").disabled = true;
  if (canAnimate()) $("#cam-flash").animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 320, easing: "cubic-bezier(0.23, 1, 0.32, 1)" });
  let blob = null;
  // full sensor resolution where the browser offers it; otherwise the sharpest video frame
  if ("ImageCapture" in window && !cam.torch) {
    try { blob = await Promise.race([new ImageCapture(cam.track).takePhoto(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000))]); } catch { blob = null; }
  }
  if (!blob) {
    const w = camVideo.videoWidth, h = camVideo.videoHeight;
    if (w && h) {
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(camVideo, 0, 0, w, h);
      blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.92));
    }
  }
  cam.busy = false; camEl.classList.remove("busy");
  if (!blob) { $("#cam-shot").disabled = false; hud("Nie udało się zrobić zdjęcia. Spróbuj jeszcze raz."); return; }
  handleFiles([new File([blob], "zdjecie.jpg", { type: blob.type || "image/jpeg" })]);
}
$("#cam-shot").addEventListener("click", takePhoto);
$("#cam-close").addEventListener("click", () => closeCamera());
$("#cam-retry").addEventListener("click", startStream);
$("#cam-torch").addEventListener("click", () => {
  if (!cam.track) return;
  cam.torch = !cam.torch;
  cam.track.applyConstraints({ advanced: [{ torch: cam.torch }] }).catch(() => { cam.torch = false; });
  $("#cam-torch").setAttribute("aria-pressed", String(cam.torch));
});
document.addEventListener("visibilitychange", () => {
  if (!cam.open) return;
  if (document.hidden) stopStream(); else startStream();
});
document.addEventListener("paste", e => {
  if (S.view !== "home") return;
  const files = Array.from(e.clipboardData?.files || []).filter(f => f.type.startsWith("image/"));
  if (files.length) handleFiles(files);
});
document.addEventListener("dragover", e => { if (S.view === "home") e.preventDefault(); });
document.addEventListener("drop", e => { if (S.view !== "home") return; e.preventDefault(); handleFiles(e.dataTransfer?.files); });

$("#btn-read").addEventListener("click", () => startReading());

let readCtl = null, wakeLock = null;
function ck(id, state) { const el = $("#" + id); el.classList.remove("now", "ok"); if (state) el.classList.add(state); }
function bar(frac) {               // determinate when we know how far along we are
  const b = $("#read-bar"), i = b.firstElementChild;
  if (frac == null) { b.classList.remove("det"); i.style.transform = ""; return; }
  b.classList.add("det"); i.style.transform = `scaleX(${Math.max(0.02, Math.min(1, frac))})`;
}
async function startReading() {
  if (openSheetId) { closeSheetThen(startReading); return; }
  const pages = pending.slice(); if (!pages.length || readCtl) return;
  readCtl = new AbortController();
  $("#read-img").src = (pages.find(p => !p.res) || pages[0]).keep;
  $("#read-pages").textContent = pages.length > 1 ? `${pages.length} ${plural(pages.length, "strona", "strony", "stron")}` : "";
  $("#ck1-t").textContent = "Przygotowanie";
  $("#ck2-t").textContent = "Szukanie pięciolinii";
  $("#ck3-t").textContent = "Odczytywanie nut";
  ck("ck1", "now"); ck("ck2", null); ck("ck3", null); bar(null);
  presentCover($("#reading"));
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch (e) { console.warn(e); }
  try {
    const piece = await readOnDevice(pages, readCtl.signal), skipped = piece.skipped; delete piece.skipped;
    ck("ck1", "ok"); ck("ck2", "ok"); ck("ck3", "ok"); bar(1);
    pending = []; drawPending();
    /* the answers belonged to these notes: the next piece starts from "Nie wiem" (B-16) */
    ["clef", "time", "key"].forEach(k => store.del("ask-" + k));
    dismissCover($("#reading"));
    openPiece(piece);
    if (!piece.issues.length) {
      $("#notice-title").textContent = "Porównaj ze zdjęciem";
      $("#notice-text").textContent = "Dynamika (p, f…) i napisy, np. tempo, nie są odczytywane.";
      $("#notice").hidden = false;
    }
    hud(skipped.length ? `Gotowe. Pominięto ${plural(skipped.length, "stronę", "strony", "strony")} bez nut: ${skipped.join(", ")}` : "Gotowe", skipped.length ? 5000 : 2400);
  } catch (e) {
    dismissCover($("#reading"));
    drawPending();                                   // pages read so far are marked and kept
    if (e.name !== "AbortError") {
      const m = e.message || "";
      showReadError(/^[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]/.test(m) && /[ąćęłńóśźż]|Nie |Na /.test(m) ? m : "Nie udało się odczytać nut. Spróbuj jeszcze raz.", e.page);
      console.warn(e);
    }
    openSheet("pages");
  } finally {
    readCtl = null;
    try { await wakeLock?.release(); } catch (e) { console.warn(e); } wakeLock = null;
  }
}
/* a page that failed: the others stay read; "Pomiń stronę n" leaves it out, "Czytaj dalej" tries it again */
function showReadError(msg, page) {
  const el = $("#read-error"); el.textContent = msg;
  if (page && pending.length > 1 && pending.includes(page)) {
    const b = document.createElement("button"); b.type = "button"; b.className = "link";
    b.textContent = `Pomiń stronę ${pending.indexOf(page) + 1}`;
    b.addEventListener("click", () => {
      const k = pending.indexOf(page); if (k >= 0) pending.splice(k, 1);
      el.hidden = true; drawPending();
      if (pending.length && pending.every(p => p.res)) startReading();      // nothing left to read: put it together
    });
    el.append(" ", b);
  }
  el.hidden = false;
}

function preparePages() {
  $("#first-model").hidden = !!store.get("modelReady");
  $("#slow-read").hidden = !!navigator.gpu && readerBackend() === "webgpu";
  ["clef", "time", "key"].forEach(k => { $("#ask-" + k).value = store.get("ask-" + k, ""); });
  $("#ask").open = ["clef", "time", "key"].some(k => store.get("ask-" + k, ""));
}
["clef", "time", "key"].forEach(k => $("#ask-" + k).addEventListener("change", e => store.set("ask-" + k, e.target.value)));
const readAnswers = () => ({ clef: $("#ask-clef").value, time: $("#ask-time").value, key: $("#ask-key").value });

/* ---- Reading on the device: homr (open-source optical music recognition), free and offline ----
   The engine runs in a worker. Solo never waits on it forever: a page with no progress for 150 s is stopped,
   and an engine that was cancelled, stopped, lost or failed (a wasm out-of-memory on a phone) is terminated and
   started afresh, so one bad page never blocks the next read (R1, R2). */
const abortError = () => { const e = new Error("cancelled"); e.name = "AbortError"; return e; };
const STALL_MS = 150000;
let recognizer = null, recognizerP = null;
/* WebGPU unless it gave wrong results here: then the CPU, for 30 days, then WebGPU gets another chance (R7) */
function readerBackend() {
  const p = store.get("homrPrefer", "webgpu");
  if (p !== "wasm-threads" && p !== "wasm") return "webgpu";
  const at = +store.get("homrPreferAt", 0);
  if (!at) { store.set("homrPreferAt", String(Date.now())); return p; }
  if (navigator.gpu && Date.now() - at > 30 * 864e5) { store.del("homrPrefer"); store.del("homrPreferAt"); return "webgpu"; }
  return p;
}
/* a promise that gives up when the read is cancelled (the first model download is 150 MB: "Anuluj" works there too, H1) */
function untilAborted(p, signal, onAbort) {
  if (!signal) return p;
  return new Promise((res, rej) => {
    const ab = () => { onAbort(); rej(abortError()); };
    if (signal.aborted) { ab(); return; }
    signal.addEventListener("abort", ab, { once: true });
    p.then(v => { signal.removeEventListener("abort", ab); if (signal.aborted) { if (v && v.dispose) v.dispose().catch(e => console.warn(e)); return; } res(v); },
      e => { signal.removeEventListener("abort", ab); rej(e); });
  });
}
async function startRecognizer(prefer, signal) {
  if (typeof Worker === "undefined") throw new Error("Ta przeglądarka nie potrafi czytać nut na urządzeniu. Zaktualizuj przeglądarkę albo otwórz Solo w Chrome lub Safari.");
  const mod = await import("./homr/homr.js");
  const abs = p => new URL(p, location.href).href;
  let w = null;
  const term = () => { try { if (w) w.terminate(); } catch (e) { console.warn(e); } };
  const r = await untilAborted(mod.createRecognizer({ baseUrl: abs("homr/models/"), wasmPaths: abs("homr/ort/"), prefer,
    createWorker: () => (w = new Worker(abs("homr/worker.js"), { type: "module" })) }), signal, term);
  r.prefer = prefer;
  r.kill = () => { term(); r.dispose().catch(e => console.warn(e)); };    // at once: a hung worker never answers "close"
  return r;
}
/* one engine at a time; two calls at once share it (R32) */
function getRecognizer(prefer, signal) {
  prefer = prefer || readerBackend();
  if (recognizer && recognizer.prefer === prefer) return Promise.resolve(recognizer);
  if (recognizerP && recognizerP.prefer === prefer) return recognizerP;
  dropRecognizer();
  const p = (async () => {
    try { return await startRecognizer(prefer, signal); }
    catch (e) {
      if (e.name === "AbortError") throw e;
      console.warn(e);
      /* no shared memory or no WebGPU device after all: the plain single-threaded engine, once (R13) */
      if (prefer !== "wasm") { try { const r = await startRecognizer("wasm", signal); r.prefer = prefer; return r; } catch (e2) { if (e2.name === "AbortError") throw e2; console.warn(e2); } }
      throw new Error(/memory|wasm|WebAssembly/i.test(e.message || "") ? HOMR_ERR.worker_lost : "Nie udało się uruchomić odczytu na tym urządzeniu. Odśwież stronę i spróbuj jeszcze raz.");
    }
  })();
  p.prefer = prefer; recognizerP = p;
  p.then(r => { if (recognizerP === p) { recognizer = r; recognizerP = null; } else r.kill(); }, () => { if (recognizerP === p) recognizerP = null; });
  return p;
}
function dropRecognizer() {
  const r = recognizer; recognizer = null; recognizerP = null;
  if (r) r.kill();
}
/* the reader's own files (worker 11 MB, runtime 28 MB) are fetched first, with progress, so the engine's start
   never includes a slow download (R6) and "Anuluj" works during it; once here they come from the cache */
const READER_FILES = ["homr/worker.js", "homr/ort/ort-wasm-simd-threaded.jsep.mjs", "homr/ort/ort-wasm-simd-threaded.jsep.wasm"];
let readerFetched = false;
async function prefetchReader(signal) {
  if (readerFetched) return;
  const need = [];
  for (const u of READER_FILES.map(p => new URL(p, location.href).href)) {
    let hit = null; try { hit = "caches" in window ? await caches.match(u) : null; } catch (e) { console.warn(e); }
    if (!hit) need.push(u);
  }
  if (need.length) {
    let got = 0, total = 0;
    const show = () => { const t = Math.max(total, got); $("#ck1-t").textContent = `Pobieranie czytnika: ${Math.round(got / 1048576)} z ${Math.round(t / 1048576) || "?"} MB`; if (total) bar(got / t); };
    let res;
    try { res = await Promise.all(need.map(u => fetch(u, { signal }))); }
    catch (e) { if (e.name === "AbortError") throw abortError(); throw new Error("Nie udało się pobrać czytnika nut. Sprawdź internet i spróbuj jeszcze raz."); }
    if (res.some(r => !r.ok)) throw new Error("Nie udało się pobrać czytnika nut. Odśwież stronę i spróbuj jeszcze raz.");
    res.forEach(r => { total += +r.headers.get("content-length") || 0; });
    try {
      await Promise.all(res.map(async r => {
        const rd = r.body && r.body.getReader ? r.body.getReader() : null;
        if (!rd) { got += (await r.arrayBuffer()).byteLength; show(); return; }
        for (;;) { const { done, value } = await rd.read(); if (done) break; got += value.length; show(); }
      }));
    } catch (e) { if (signal.aborted) throw abortError(); throw new Error("Nie udało się pobrać czytnika nut. Sprawdź internet i spróbuj jeszcze raz."); }
    $("#ck1-t").textContent = "Przygotowanie"; bar(null);
  }
  readerFetched = true;
}
const HOMR_ERR = {
  not_music: "Na zdjęciu nie widać pięciolinii. Zrób zdjęcie z bliska, prosto nad kartką i przy dobrym świetle.",
  bad_input: "Tego zdjęcia nie da się odczytać. Spróbuj innego zdjęcia lub zrzutu ekranu.",
  engine_missing: "Nie udało się pobrać modelu nut. Sprawdź internet i spróbuj jeszcze raz.",
  engine_failed: "Odczyt się nie udał. Spróbuj jeszcze raz albo zrób wyraźniejsze zdjęcie.",
  worker_lost: "Zabrakło pamięci w urządzeniu. Zamknij inne karty i aplikacje, potem spróbuj jeszcze raz.",
  timeout: "Odczyt trwał za długo. Spróbuj jeszcze raz.",
  busy: "Trwa już inny odczyt. Poczekaj chwilę."
};
/* what went wrong, in words that fit the cause (R22, B-20) */
function readErrText(code, log, ctx) {
  const mem = /memory|Aborted\(|allocat|RangeError|OOM/i.test(log);
  if (code === "worker_lost" || (code === "engine_failed" && mem)) {
    if (ctx.hidden) return "Odczyt przerwał się, bo Solo było w tle. Zostaw Solo na ekranie i spróbuj jeszcze raz.";
    if (!mem && /did not load|import|fetch|404|protocol|could not be read/i.test(log)) return "Nie udało się uruchomić odczytu. Odśwież stronę i spróbuj jeszcze raz.";
    return HOMR_ERR.worker_lost;
  }
  if (code === "timeout" && ctx.stage === "models") return "Pobieranie modelu się zatrzymało. Sprawdź internet i spróbuj jeszcze raz.";
  return HOMR_ERR[code] || HOMR_ERR.engine_failed;
}
/* the extra CPU models (about 110 MB) are not fetched over mobile data without asking (R7) */
const metered = () => { const c = navigator.connection; return !!c && (!!c.saveData || c.type === "cellular"); };
/* one page, with a watchdog: no progress for STALL_MS stops it as "timeout" */
function recognizeWatched(rec, blob, signal, onProgress) {
  const ctl = new AbortController(); let dog = 0;
  const pet = () => { clearTimeout(dog); dog = setTimeout(() => ctl.abort(Object.assign(new Error("no progress"), { name: "TimeoutError" })), STALL_MS); };
  const stop = () => ctl.abort(signal.reason);
  if (signal.aborted) stop(); else signal.addEventListener("abort", stop, { once: true });
  pet();
  return rec.recognizePage(blob, { ocr: true, signal: ctl.signal, onProgress: p => { pet(); onProgress(p); } })
    .finally(() => { clearTimeout(dog); signal.removeEventListener("abort", stop); });
}
async function readPage(pg, i, n, signal, ctx) {
  const pre = n > 1 ? `Strona ${i + 1} z ${n}: ` : "";
  const fail = msg => { const e = new Error((n > 1 ? `Strona ${i + 1}: ` : "") + msg); e.page = pg; return e; };
  let lastUi = 0;
  const progress = ({ stage, done, total }) => {
    ctx.stage = stage;
    if (stage === "models") {
      const now = Date.now(); if (now - lastUi < 100 && done < total) return; lastUi = now;      // at most 10 a second (R15)
      ck("ck1", "now");
      if (total > 1e6 && done < total) { $("#ck1-t").textContent = `${store.get("modelReady") ? "Wczytywanie" : "Pobieranie"} modelu: ${Math.round(done / 1048576)} z ${Math.round(total / 1048576)} MB`; bar(done / total); }
    } else if (stage === "segment" || stage === "detect" || stage === "dewarp") {
      ck("ck1", "ok"); $("#ck1-t").textContent = "Przygotowanie"; ck("ck2", "now"); $("#ck2-t").textContent = pre + "Szukanie pięciolinii"; bar(null);
    } else if (stage === "staff") {
      $("#ck1-t").textContent = "Przygotowanie"; ck("ck2", "ok"); ck("ck3", "now"); $("#ck3-t").textContent = `${pre}Odczytywanie nut: pięciolinia ${Math.min(done + 1, total)} z ${total}`; bar(total ? (i + done / total) / n : null);
    } else if (stage === "ocr") { $("#ck1-t").textContent = "Przygotowanie"; ck("ck3", "now"); $("#ck3-t").textContent = `${pre}Odczytywanie napisów (tempo, określenia)`; bar(total ? done / total : null); }
    else if (stage === "xml") { ck("ck3", "now"); }
  };
  const blob = await pageBlob(pg);
  let again = 0;
  for (;;) {
    const rec = await getRecognizer(ctx.prefer, signal);
    /* the reader also reads the text above each staff: tempo, rit., a tempo, rehearsal letters (see attachTexts) */
    const r = await recognizeWatched(rec, blob, signal, progress);
    if (r.ok) {
      if (rec.backend === "webgpu") store.set("homrGpuOk", "1");
      if (ctx.prefer) { store.set("homrPrefer", ctx.prefer); store.set("homrPreferAt", String(Date.now())); }
      const xml = r.musicXml || "";
      return { xml, staves: r.staves || [], texts: r.texts || [], empty: !/<note\b/.test(xml) };
    }
    if (r.error === "cancelled") { dropRecognizer(); throw abortError(); }        // the worker may still be busy: a new one next time
    const log = String(r.log || "");
    if (r.error !== "not_music" && r.error !== "bad_input") dropRecognizer();     // stuck, lost or failed: never used again
    /* some graphics chips give WebGPU results that are wrong rather than slow: the CPU, once. A "no staves" from a
       WebGPU that has read well here before is believed. */
    const gpuDoubt = rec.backend === "webgpu" && !ctx.prefer && r.error === "not_music" && !store.get("homrGpuOk");
    /* several pages: a cover is the likelier cause; the CPU only if no page reads on WebGPU (readOnDevice) */
    if (gpuDoubt && n > 1 && !ctx.retryDoubts) return { xml: "", staves: [], texts: [], empty: true, gpuDoubt: true };
    if (rec.backend === "webgpu" && !ctx.prefer && (r.error === "engine_failed" || gpuDoubt)) {
      if (metered()) throw fail("Na tym urządzeniu odczyt potrzebuje jeszcze ok. 110 MB. Połącz się z Wi-Fi i spróbuj jeszcze raz.");
      ctx.prefer = "wasm-threads"; continue;
    }
    /* a failed engine (often out of memory after several pages) gets one more go, started afresh */
    if ((r.error === "engine_failed" || r.error === "worker_lost" || r.error === "busy") && again++ < 1) continue;
    if (r.error === "not_music" && n > 1) return { xml: "", staves: [], texts: [], empty: true };    // a cover or a page of text (B-14)
    throw fail(readErrText(r.error, log, ctx));
  }
}
async function readOnDevice(pages, signal) {
  const ctx = { prefer: null, hidden: document.hidden, stage: "", retryDoubts: false };
  const onVis = () => { if (document.hidden) ctx.hidden = true; };
  document.addEventListener("visibilitychange", onVis);
  try {
    await prefetchReader(signal);
    let fresh = 0;
    for (let i = 0; i < pages.length; i++) {
      const pg = pages[i]; if (pg.res) continue;
      /* phones: a new engine every 4 pages gives its memory back (all models stay loaded otherwise, R8) */
      if (fresh >= 4 && hasNativeCamera()) { dropRecognizer(); fresh = 0; }
      $("#read-img").src = pg.keep;
      pg.res = await readPage(pg, i, pages.length, signal, ctx); fresh++;
      savePendingSoon();
      /* every page so far "without staves" on a WebGPU that never read well here: try them again on the CPU */
      if (i === pages.length - 1 && !ctx.retryDoubts && pages.every(p => p.res && p.res.empty) && pages.some(p => p.res.gpuDoubt) && !store.get("homrGpuOk")) {
        ctx.retryDoubts = true; pages.forEach(p => { if (p.res.gpuDoubt) p.res = null; }); i = -1;
      }
    }
  } finally { document.removeEventListener("visibilitychange", onVis); }
  store.set("modelReady", "1");
  const used = pages.filter(p => p.res && !p.res.empty), skipped = pages.map((p, i) => p.res && p.res.empty ? i + 1 : 0).filter(Boolean);
  if (!used.length) { const e = new Error(HOMR_ERR.not_music); if (pages.length === 1) e.page = pages[0]; throw e; }
  const lines = [], texts = [];
  used.forEach((p, k) => {
    texts.push({ page: k, staves: p.res.staves, texts: p.res.texts });
    /* T16: where each line sits on the photo, to show it next to the bar later */
    p.res.staves.slice().sort((a, b) => a.index - b.index).forEach(s => lines.push({ page: k, cx: s.cx, cy: s.cy, w: s.w, h: s.h, W: p.W, H: p.H }));
  });
  const names = new Set((await DB.all().catch(() => [])).map(p => p.title));
  let title = "Nowe nuty", k = 2; while (names.has(title)) title = "Nowe nuty " + k++;
  const checked = checkReading(attachTexts(homrToSolo(used.map(p => p.res.xml), title), texts), readAnswers());
  /* the instrument from the profile (not "Instrument" with nothing chosen), unless it is a keyboard (B-17) */
  const ins = mainInstr();
  return { title, composer: "", xml: checked.xml, sourceType: "device", images: used.map(p => p.keep), lines, aiJson: null, issues: checked.issues,
    instrument: ins && !PIANO_RE.test(ins.name) ? ins.name : "", skipped };
}
$("#btn-cancel-read").addEventListener("click", () => readCtl && readCtl.abort());

/* ---------------- Score navigation ---------------- */
$("#btn-back").addEventListener("click", () => go("home"));
/* Edit a line of text right where it is: tap, type, Enter (or tap elsewhere) to keep, Esc to undo. */
function inlineEdit(el, { value, placeholder, label, onSave }) {
  if (el.querySelector("input.inl")) return;
  const old = el.innerHTML;
  const inp = document.createElement("input");
  inp.className = "inl"; inp.type = "text"; inp.value = value || ""; inp.placeholder = placeholder || ""; inp.setAttribute("aria-label", label || placeholder || "");
  inp.autocomplete = "off"; inp.enterKeyHint = "done"; inp.spellcheck = false;
  const clr = document.createElement("button");
  clr.type = "button"; clr.className = "inl-clear"; clr.tabIndex = -1; clr.setAttribute("aria-label", "Wyczyść"); clr.innerHTML = icon("x");
  clr.addEventListener("pointerdown", e => e.preventDefault());           // keep the keyboard open
  clr.addEventListener("click", e => { e.stopPropagation(); inp.value = ""; inp.focus(); clr.hidden = true; });
  inp.addEventListener("input", () => { clr.hidden = !inp.value; });
  const box = document.createElement("span"); box.className = "inl-box"; box.append(inp, clr); clr.hidden = !inp.value;
  el.innerHTML = ""; el.appendChild(box); el.classList.add("editing");
  inp.focus(); inp.select();
  let done = false;
  const finish = save => {
    if (done) return; done = true;
    el.classList.remove("editing");
    const v = inp.value.trim();
    el.innerHTML = old;
    if (save && v !== (value || "")) onSave(v);
  };
  inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); finish(true); } if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); } });
  inp.addEventListener("blur", () => finish(true));
  ["click", "pointerdown"].forEach(t => inp.addEventListener(t, e => e.stopPropagation()));
}
function setPieceField(k, v) {
  S.piece[k] = v; if (k === "title" && !v) S.piece.title = "Bez tytułu";
  changed();
}
$("#s-title").addEventListener("click", () => inlineEdit($("#s-title"), { value: S.piece.title === "Bez tytułu" ? "" : S.piece.title, placeholder: "Tytuł", onSave: v => setPieceField("title", v) }));
$("#s-sub").addEventListener("click", e => {
  const b = e.target.closest("[data-edit]"); if (!b) return;
  const k = b.dataset.edit;
  /* the clef and the key are changed in editing (Takt), not in the view (Nat, 7 Oct) */
  if (k === "clef" || k === "key") { const go = () => { S.editSel = null; S.fromBar = -1; edTab("bar"); }; if (S.editMode) go(); else { setEditMode(true); whenDrawn(go); } return; }
  inlineEdit(b, { value: S.piece[k] || "", placeholder: k === "composer" ? "Kompozytor" : "Instrument", onSave: v => setPieceField(k, v) });
});

/* ---------------- Settings ---------------- */
function syncSettings() {
  syncInstall();
  const items = NEWS[VERSION] || [];
  $("#news").innerHTML = `<ul class="news">${items.map(t => `<li>${esc(t)}</li>`).join("")}</ul>`; $("#news-ver").textContent = `Wersja ${VERSION}`;
  $("#ver").textContent = BUILD ? `${VERSION} · test ${BUILD}` : VERSION;
  DB.all().then(all => {
    $("#store-count").textContent = all.length ? `${all.length} ${plural(all.length, "utwór", "utwory", "utworów")} w bibliotece` : "Biblioteka jest pusta";
  }).catch(() => {});
  navigator.storage?.estimate?.().then(async e => {
    /* "persisted": the browser promised not to clear Solo's data when the device runs low on space */
    const kept = await (navigator.storage.persisted ? navigator.storage.persisted().catch(() => false) : false);
    $("#store-size").textContent = `Zajęte: ${(e.usage / 1048576).toFixed(1).replace(".", ",")} MB${store.get("modelReady") ? ", w tym ok. 150 MB to program do czytania nut" : ""}${kept ? ". Chronione przed usunięciem" : ""}`;
  }).catch(e => console.warn(e));
}
/* Solo is light only (Nat, 7 Oct); "t" stays for the test build's theme-colour overlay (tools/deploy.py) */
function applyTheme() {
  const t = "light";
  document.documentElement.setAttribute("data-theme", t);
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", t === "dark" ? "#0B0E1A" : "#F5F7FD");
}
/* The backup: one JSON file (older versions of Solo read it too) with the pieces and their photos, collections,
   favourites, the profile and settings, and "Twój dźwięk". It is put together piece by piece as a Blob, so the
   library is never one giant string in memory. */
const BACKUP_PREFS = ["profile", "recentInstr", "sort", "libCol", "click", "metroBeats", "metroBpm", "ownUse", "tunerA4", "tunerTol", "tunerTr", "zoom2", "homrPrefer", "tourDone", "welcomed"];
async function saveBackup() {
  let chunks, cur, size, n;
  const reset = () => { chunks = []; cur = []; size = 0; n = 0; }, flush = () => { if (cur.length) { chunks.push(new Blob(cur)); cur = []; size = 0; } };
  reset();
  try {
    await DB.each(p => { const j = JSON.stringify(p); cur.push((n++ ? "," : "") + j); size += j.length; if (size > 4e6) flush(); }, reset);
  } catch (e) { console.warn(e); return { n: 0, how: "error" }; }
  flush();
  if (!n) return { n: 0, how: "empty" };
  const prefs = {}; BACKUP_PREFS.forEach(k => { const v = store.get(k); if (v != null) prefs[k] = v; });
  let sounds = {}; try { sounds = typeof ownExport === "function" ? ownExport() : {}; } catch (e) { console.warn(e); }
  const head = JSON.stringify({ app: "solo", version: 3, saved: Date.now(), cols: cols(), favs: favs(), prefs, sounds });
  const blob = new Blob([head.slice(0, -1), ',"pieces":[', ...chunks, "]}"], { type: "application/json" });
  const name = `solo-kopia-${new Date().toISOString().slice(0, 10)}.json`;
  const how = await saveFile(name, blob);
  if (how === "blocked") hudAct("Kopia jest gotowa", "Zapisz", () => saveFile(name, blob).then(h => { if (h === "shared") backupDone(n); }), 10000);
  if (how === "shared" || how === "downloaded") backupDone(n);
  return { n, how };
}
function backupDone(n) {
  store.set("backupAt", String(Date.now()));
  const el = $("#backup-nudge"); if (el) el.hidden = true;
  $("#backup-status").textContent = `Zapisano kopię: ${n} ${plural(n, "utwór", "utwory", "utworów")}.`;
}
function backupText({ n, how }) {
  return how === "empty" ? "Biblioteka jest pusta." : how === "error" ? "Nie udało się odczytać biblioteki. Spróbuj jeszcze raz." : how === "cancelled" ? "Nie zapisano kopii." :
    how === "blocked" ? "Kopia jest gotowa: dotknij „Zapisz” na dole ekranu." : `Zapisano kopię: ${n} ${plural(n, "utwór", "utwory", "utworów")}.`;
}
$("#btn-backup").addEventListener("click", async () => { $("#backup-status").textContent = backupText(await saveBackup()); });
/* A gentle reminder in the library: a few days after the first pieces, then at most monthly,
   and only when something changed since the last copy. Browsers may clear a site's storage. */
const DAY = 864e5;
function nudgeBackup(all) {
  const now = Date.now(), el = $("#backup-nudge");
  if (!el) return;                              // a stale cached page without the reminder
  const mine = all.filter(p => p.sourceType !== "example");
  if (!mine.length) { el.hidden = true; return; }
  if (!store.get("libSince")) store.set("libSince", String(now));
  const last = Math.max(+store.get("backupAt", 0), +store.get("nudgeLater", 0));
  const changed = mine.some(p => Math.max(p.updated || 0, p.created || 0) > +store.get("backupAt", 0));
  const due = last ? now - last > 30 * DAY : now - +store.get("libSince") > 3 * DAY;
  el.hidden = !(changed && due);
}
$("#nudge-save")?.addEventListener("click", async () => { const r = await saveBackup(); if (r.how !== "blocked") hud(backupText(r), 3000); });
$("#news-open")?.addEventListener("click", () => { store.set("newsSeen", VERSION); $("#news-nudge").hidden = true; go("settings"); $("#news-det").open = true; setTimeout(() => $("#news-det").scrollIntoView({ behavior: "smooth", block: "center" }), 450); });
$("#news-x")?.addEventListener("click", () => { store.set("newsSeen", VERSION); fadeOut($("#news-nudge"), 180); });
$("#nudge-x")?.addEventListener("click", () => { store.set("nudgeLater", String(Date.now())); fadeOut($("#backup-nudge"), 180); });
/* Reading a backup back: everything is checked first (nothing is written from a damaged file), an older copy never
   overwrites newer changes, and the person is told what came in and what was left out. */
const PIECE_FIELDS = { title: "string", composer: "string", instrument: "string", xml: "string", sourceType: "string", origXml: "string", keyLabel: "string", clefLabel: "string", created: "number", updated: "number", opened: "number" };
const DATA_IMG = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
function cleanPiece(p) {
  if (!p || typeof p !== "object" || typeof p.id !== "string" || !/^[\w-]{1,64}$/.test(p.id) || typeof p.xml !== "string" || !/<score-(partwise|timewise)\b/.test(p.xml)) return null;
  const out = { id: p.id };
  Object.entries(PIECE_FIELDS).forEach(([k, t]) => { if (typeof p[k] === t) out[k] = p[k]; });
  out.title = out.title || ""; out.composer = out.composer || "";
  if (!["device", "ai", "file", "own", "example"].includes(out.sourceType)) out.sourceType = "file";
  out.images = Array.isArray(p.images) ? p.images.filter(x => typeof x === "string" && DATA_IMG.test(x)) : [];
  out.thumb = typeof p.thumb === "string" && DATA_IMG.test(p.thumb) ? p.thumb : null;
  out.issues = Array.isArray(p.issues) ? p.issues.filter(x => typeof x === "string").slice(0, 1000) : [];
  out.lines = Array.isArray(p.lines) ? p.lines.filter(l => l && typeof l === "object").map(l => { const o = {}; ["page", "cx", "cy", "w", "h", "W", "H"].forEach(k => (o[k] = Number.isFinite(+l[k]) ? +l[k] : 0)); return o; }) : null;
  out.settings = p.settings && typeof p.settings === "object" && !Array.isArray(p.settings) ? JSON.parse(JSON.stringify(p.settings)) : null;
  return out;
}
function cleanCol(c) {
  if (!c || typeof c.id !== "string" || !/^[\w-]{1,40}$/.test(c.id) || typeof c.name !== "string") return null;
  return { id: c.id, name: c.name.slice(0, 60), color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : "#8D8D8D", items: Array.isArray(c.items) ? c.items.filter(x => typeof x === "string") : [] };
}
$("#in-backup").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  const st = $("#backup-status"); st.textContent = "Wczytuję kopię…";
  let j;
  try { j = JSON.parse(await f.text()); }
  catch (err) { console.warn(err); st.textContent = err instanceof RangeError ? "Ta kopia jest za duża dla tego urządzenia." : "To nie jest kopia zapasowa Solo albo plik jest uszkodzony."; return; }
  if (!j || !["solo", "pulpit-nutowy"].includes(j.app) || !Array.isArray(j.pieces)) { st.textContent = "To nie jest kopia zapasowa Solo."; return; }
  const pieces = j.pieces.map(cleanPiece), bad = pieces.filter(p => !p).length;
  let have;
  try { have = new Map((await DB.all()).map(p => [p.id, p])); }
  catch (err) { console.warn(err); st.textContent = "Nie udało się otworzyć biblioteki. Spróbuj jeszcze raz."; return; }
  const fresh = !have.size;                     // a new phone: the profile and settings come from the copy as well
  let n = 0, newer = 0;
  for (const p of pieces) {
    if (!p) continue;
    const cur = have.get(p.id);                 // an older copy never overwrites newer changes
    if (cur && (cur.updated || 0) > (p.updated || 0)) { newer++; continue; }
    try { await DB.put(p); n++; } catch (err) { console.warn(err); st.textContent = saveErrorText(err) + ` Wczytano ${n} z ${pieces.length}.`; syncSettings(); refreshLibrary(); return; }
  }
  if (Array.isArray(j.cols)) { const mine = cols(); j.cols.map(cleanCol).filter(Boolean).forEach(c => { const m = mine.find(x => x.id === c.id); if (m) m.items = [...new Set([...m.items, ...c.items])]; else mine.push(c); }); saveCols(mine); }
  if (Array.isArray(j.favs)) saveFavs([...new Set([...favs(), ...j.favs.filter(x => typeof x === "string")])]);
  let prefs = 0;
  if (j.prefs && typeof j.prefs === "object") BACKUP_PREFS.forEach(k => {
    const v = j.prefs[k]; if (typeof v !== "string" || v.length > 20000) return;
    if (k === "profile") { try { const o = JSON.parse(v); if (!o || !Array.isArray(o.instruments)) return; } catch { return; } }
    if ((fresh || store.get(k) == null) && store.set(k, v)) prefs++;
  });
  if (prefs && typeof applyProfile === "function") applyProfile();
  let snd = 0; if (j.sounds && typeof ownImport === "function") { try { snd = await ownImport(j.sounds); } catch (err) { console.warn(err); } }
  st.textContent = [`Wczytano ${n} ${plural(n, "utwór", "utwory", "utworów")}.`,
    newer ? `${newer} ${plural(newer, "utwór masz", "utwory masz", "utworów masz")} już w nowszej wersji.` : "",
    bad ? `Pominięte, bo uszkodzone: ${bad}.` : "",
    snd ? `Twoje brzmienia: ${snd} ${plural(snd, "instrument", "instrumenty", "instrumentów")}.` : "",
    prefs && fresh ? "Profil i ustawienia też." : ""].filter(Boolean).join(" ");
  syncSettings(); if (prefs && typeof renderProfile === "function") renderProfile();
});

const NEWS = { "4.0": ["Nowy, jasny wygląd, ekran startowy i nowa ikona Solo.",
  "Nuty jako strona A4, cztery takty w linii.",
  "Edytuj i Gotowe, cofnij i ponów na górze. Edycja zaczyna się od Taktu: metrum, klucz każdej partii, tonacja utworu.",
  "Dowolne metrum (np. 5/4, 7/8, 3+2+2/8) w nowej melodii, w edycji i w metronomie.",
  "Belki ósemek: Nuta → Belka łączy z następną nutą albo rozdziela.",
  "Odsłuch przy edycji gra jak w zapisie: tonacja, długość, dynamika, instrument.",
  "Partia (dotknij nazwy instrumentu): ukryj, wycisz, zmień instrument, oktawa, co gra.",
  "Duplikuj utwór. W „⋯” tylko widok i udostępnianie.",
  "Stroik z delikatną kulą; mikrofon włącza się dopiero, gdy go potrzebujesz.",
  "Twoje brzmienia i Twoje imię w zakładce Ja.",
  "Naprawione: nowy utwór zapisywał się dwa razy; po pętli znikały przyciski."],
  "3.9": ["Nuty według zasad zapisu: ósemki łączone belkami według metrum, pauzy pokazują miary, znaki przypominające w następnym takcie.",
  "Drugi i trzeci głos według zasad prowadzenia głosów i akordów fortepianu.",
  "Klucz i oktawa dobrane tak, żeby nuty mieściły się na pięciolinii.",
  "Gotowe melodie, kanon, trio z trzech instrumentów, zmiana instrumentu partii i oktawy."] };
/* ---------------- T22 metronome, T23 tuner ---------------- */
const metro = { on: false, bpm: 100, beats: 4, unit: 4, meter: "4/4", ctx: null, next: 0, n: 0, timer: 0, raf: 0, queue: [], acc: null, dots: [], taps: [], ramp: null };
/* accents: one flag per beat (the first beat by default); tapping a dot changes it */
function metroAcc() {
  if (!metro.acc || metro.acc.length !== metro.beats) {
    /* accents: the first beat, and in an additive metre (3+2+2) the start of every group */
    const s = store.get("metroAcc" + metro.meter, ""), starts = new Set([0]);
    String(metro.meter.split("/")[0]).split("+").reduce((a, g) => { starts.add(a); return a + (parseInt(g, 10) || 0); }, 0);
    metro.acc = Array.from({ length: metro.beats }, (_, i) => s.length === metro.beats ? s[i] === "1" : starts.has(i));
  }
  return metro.acc;
}
/* the Italian tempo word for a tempo (shown under the number) */
function tempoName(bpm) {
  return bpm < 40 ? "Grave" : bpm < 60 ? "Largo" : bpm < 66 ? "Larghetto" : bpm < 76 ? "Adagio" : bpm < 108 ? "Andante" :
    bpm < 120 ? "Moderato" : bpm < 156 ? "Allegro" : bpm < 176 ? "Vivace" : bpm < 200 ? "Presto" : "Prestissimo";
}
function buildToolsSheet() {
  if (S.view !== "metrov") $("#metro-sheet-host").appendChild($("#metro-ui"));
  if (!metro.on) { metro.bpm = S.piece && S.view === "score" ? curBpm() : (+store.get("metroBpm", 100) || 100); const x = S.piece && S.view === "score" ? processedXml().match(/<beats>([\d+]+)<\/beats>\s*<beat-type>(\d+)<\/beat-type>/) : null; setMetroMeter(x ? `${x[1]}/${x[2]}` : store.get("metroMeter", "") || (+store.get("metroBeats", 4) === 6 ? "6/8" : `${+store.get("metroBeats", 4) || 4}/4`), false); }
  syncMetro();
}
function syncMetro() {
  syncTempoUi();
  meterControls($("#m-meter"), metro.beats, metro.unit || 4, n => setMetroMeter(`${n}/${metro.unit || 4}`, true), u => setMetroMeter(`${metro.beats}/${u}`, true));
  const acc = metroAcc();
  $("#m-beats").innerHTML = acc.map((a, i) => `<button type="button" class="${i === 0 ? "one" : ""}" data-i="${i}" data-acc="${a ? 1 : 0}" aria-pressed="${a}" aria-label="Akcent na ${i + 1}"></button>`).join("");
  metro.dots = $$("#m-beats > *");
  $("#m-go").innerHTML = `${icon(metro.on ? "stop" : "play")}<span>${metro.on ? "Stop" : "Start"}</span>`;
}
$("#m-beats").addEventListener("click", e => {
  const b = e.target.closest("[data-i]"); if (!b) return;
  const acc = metroAcc(), i = +b.dataset.i; acc[i] = !acc[i];
  store.set("metroAcc" + metro.meter, acc.map(a => (a ? "1" : "0")).join(""));
  b.dataset.acc = acc[i] ? "1" : "0"; b.setAttribute("aria-pressed", String(acc[i]));
});
function metroClick(t, accent) {
  const c = metro.ctx, o = c.createOscillator(), g = c.createGain();
  o.frequency.value = accent ? 1500 : 1000; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(accent ? .9 : .55, t + .002); g.gain.exponentialRampToValueAtTime(.001, t + .06);
  o.connect(g); g.connect(metro.out || c.destination); o.start(t); o.stop(t + .08);
}
/* one click per beat of the metre: a quarter in x/4, an eighth in x/8, a half in x/2 (the tempo counts quarters) */
const metroBeatLen = () => 60 / metro.bpm * 4 / (metro.unit || 4);
/* any metre, as in the editor: 2/4 … 12/8, 5/4, 7/8 or 3+2+2/8; at most 32 clicks a bar */
function setMetroMeter(v, mine) {
  const [t, b] = String(v || "4/4").split("/"), beats = beatsOf(t), unit = +b;
  if (!(beats >= 1 && beats <= 32) || ![1, 2, 4, 8, 16, 32].includes(unit)) return;
  if (metro.meter === `${t}/${b}`) return;
  metro.meter = `${t}/${b}`; metro.beats = beats; metro.unit = unit; metro.n = 0; metro.acc = null;
  if (mine) { store.set("metroMeter", metro.meter); syncMetro(); }
}
/* look ahead 120 ms, so the clicks stay exact even when the page is busy. When the page was held up (a phone call,
   a long task), the missed clicks are skipped: the next one comes on its beat, never a burst of them. */
function metroTick() {
  const c = metro.ctx; if (!metro.on || !c) return;
  if (c.state !== "running") {             // a call or Siri interrupted the sound: try again twice a second
    const t = performance.now(); if (t - (metro.retry || 0) > 500) { metro.retry = t; const r = c.resume?.(); if (r) r.catch(() => {}); }
    return;
  }
  const now = c.currentTime, len = metroBeatLen();
  if (metro.next < now) { const skip = Math.ceil((now - metro.next) / len); metro.next += skip * len; metro.n += skip; }
  while (metro.next < now + .12) {
    const beat = metro.n % metro.beats, acc = metroAcc();
    if (beat === 0 && metro.ramp && metro.n > 0) metroRampBar();
    metroClick(metro.next, !!acc[beat]); metro.queue.push({ t: metro.next, beat });
    metro.next += metroBeatLen(); metro.n++;
  }
}
function metroStart() {
  if (playState || pb.preparing) stopPlayback(true);                 // never two clicks at two tempi
  unlockAudio();
  metro.ctx = fxCtx(); clearTimeout(fx.idle);
  metro.out = metro.ctx.createGain(); metro.out.connect(metro.ctx.destination);      // clicks already queued are faded at stop
  metro.on = true; metro.n = 0; metro.next = metro.ctx.currentTime + .08; metro.queue = [];
  metro.timer = setInterval(metroTick, 25);
  const draw = () => {
    if (!metro.on) return;
    let q = null; while (metro.queue.length && metro.queue[0].t <= metro.ctx.currentTime) q = metro.queue.shift();
    if (q) metro.dots.forEach((d, i) => d.classList.toggle("on", i === q.beat));
    metro.raf = requestAnimationFrame(draw);
  };
  metro.raf = requestAnimationFrame(draw); syncMetro();
  keepAwake();
}
function metroStop() {
  metro.on = false; clearInterval(metro.timer); cancelAnimationFrame(metro.raf); metro.queue = [];
  metro.dots.forEach(d => d.classList.remove("on")); syncMetro();
  /* the clicks handed ahead to the audio clock (up to 120 ms) are not heard after Stop */
  const out = metro.out; metro.out = null;
  if (out) { try { out.gain.setTargetAtTime(0, metro.ctx.currentTime, 0.005); } catch {} setTimeout(() => { try { out.disconnect(); } catch {} }, 300); }
  if (document.hidden) fxSleep(); else fxIdle();
  if (!playState && !tuner.on) { try { wakeLock?.release(); } catch {} wakeLock = null; }
}
$("#m-go").addEventListener("click", () => metro.on ? metroStop() : metroStart());
/* any tempo by typing: tap the number, type, Enter (or tap away) */
$("#m-bpm").addEventListener("click", () => {
  const b = $("#m-bpm"); if (b.querySelector("input")) return;
  const inp = document.createElement("input"); inp.type = "text"; inp.inputMode = "numeric"; inp.enterKeyHint = "done"; inp.maxLength = 3; inp.value = String(metro.bpm); inp.setAttribute("aria-label", "Tempo, uderzenia na minutę");
  b.textContent = ""; b.appendChild(inp); inp.focus(); inp.select();
  const done = ok => { const v = parseInt(inp.value, 10); inp.remove(); if (ok && v >= 1) { if (v < 30 || v > 240) hud("Tempo od 30 do 240"); setMetroBpm(v); } else syncMetro(); };
  inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); done(true); } if (e.key === "Escape") done(false); });
  inp.addEventListener("blur", () => { if (inp.isConnected) done(true); });
});
const setMetroBpm = v => { metro.bpm = Math.max(30, Math.min(240, Math.round(v))); store.set("metroBpm", metro.bpm); syncMetro(); };
/* the slider: the number follows the finger at once, the tempo is kept when the finger lifts */
$("#m-range").addEventListener("input", e => { metro.bpm = +e.target.value; syncTempoUi(); });
$("#m-range").addEventListener("change", e => setMetroBpm(+e.target.value));
$("#m-names").addEventListener("click", e => { const b = e.target.closest("[data-bpm]"); if (b) setMetroBpm(+b.dataset.bpm); });
/* the tempo name chip that covers the current tempo is marked */
const TEMPO_CHIPS = [["Largo", 0, 66], ["Adagio", 66, 76], ["Andante", 76, 108], ["Moderato", 108, 120], ["Allegro", 120, 156], ["Presto", 156, 999]];
function syncTempoUi() {
  $("#m-bpm").textContent = metro.bpm; const nm = $("#m-name"); if (nm) nm.textContent = tempoName(metro.bpm);
  const r = $("#m-range"); if (r) { if (+r.value !== metro.bpm) r.value = metro.bpm; r.style.setProperty("--p", ((metro.bpm - 30) / 210 * 100).toFixed(1) + "%"); }
  const on = TEMPO_CHIPS.find(([, a, b]) => metro.bpm >= a && metro.bpm < b);
  $$("#m-names [data-bpm]").forEach(b => b.setAttribute("aria-pressed", String(!!on && b.textContent === on[0])));
}
/* tap tempo: the average of the last 4 taps; a pause of 2 s starts again */
function tapTempo(now = performance.now()) {
  const t = metro.taps; if (t.length && now - t[t.length - 1] > 2000) t.length = 0;
  t.push(now); if (t.length > 4) t.shift();
  if (t.length < 2) return null;
  const bpm = 60000 / ((t[t.length - 1] - t[0]) / (t.length - 1));
  setMetroBpm(bpm * 4 / (metro.unit || 4)); return metro.bpm;
}
{ const tap = $("#m-tap"); if (tap) tap.addEventListener("pointerdown", e => { e.preventDefault(); tapTempo(); }); }
/* the metronome speeds up by itself (Pro Metronome's "Automator"): metroRamp({ to: 120, step: 4, bars: 4 }) adds
   4 BPM every 4 bars up to 120; metroRamp(null) stops it. Logic only, for the lead's controls. */
function metroRamp(o) { metro.ramp = o ? { to: Math.min(240, o.to || 120), step: o.step || 4, bars: o.bars || 4, bar: 0 } : null; return metro.ramp; }
function metroRampBar() {
  const r = metro.ramp; r.bar++;
  if (r.bar % r.bars === 0 && metro.bpm < r.to) setMetroBpm(Math.min(r.to, metro.bpm + r.step));
}
/* the screen locks or another app comes up: the metronome stops (timers there run late and would stutter) */
document.addEventListener("visibilitychange", () => { if (document.hidden && metro.on) metroStop(); });

/* T23 tuner, rebuilt after the benchmark (TonalEnergy, Pano, Cleartune, Peterson): it listens ~30 times a second
   (McLeod pitch method), a note is shown only after 3 readings agree, cents are smoothed, the dot glides at 60 fps,
   the last note is held 1.5 s after the sound stops, and a trace shows the last 6 seconds (steadiness, vibrato). */
const tuner = { on: false, stream: null, ctx: null, an: null, raf: 0, buf: null,
  tr: +store.get("tunerTr", 0) || 0, a4: +store.get("tunerA4", 440) || 440, tol: +store.get("tunerTol", 5) || 5,
  hist: [], shown: null, cand: null, candN: 0, ema: 0, lastOn: 0, lastAn: 0, x: 0, trace: [] };
const NOTE_PL = ["C", "Cis", "D", "Es", "E", "F", "Fis", "G", "As", "A", "B", "H"];
/* Polish octave names: C2–H2 wielka, C3 mała, C4 razkreślna … */
const OCTAVE_NAMES = ["subkontra", "kontra", "wielka", "mała", "razkreślna", "dwukreślna", "trzykreślna", "czterokreślna"];
function syncTuner() {
  $$("#t-instr button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.tr === ((tuner.tr % 12) + 12) % 12)));
  $$("#t-tol button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.tol === tuner.tol)));
  $("#t-a").textContent = String(tuner.a4);
  const z = tuner.tol, pc = v => 50 + v;            // the meter spans −50…+50 cents
  /* one smooth gradient (no hard bands): coral far off, amber near, green inside the tolerance */
  $("#t-zones").style.background = `linear-gradient(90deg, #EEF1FA ${pc(-15)}%, rgb(42 98 240/.07) ${pc(-15)}%, rgb(42 98 240/.07) ${pc(-z)}%, #CFF1E2 ${pc(-z)}%, #CFF1E2 ${pc(z)}%, rgb(42 98 240/.07) ${pc(z)}%, rgb(42 98 240/.07) ${pc(15)}%, #EEF1FA ${pc(15)}%)`;
  $("#t-zones").style.setProperty("background", $("#t-zones").style.background, "important"); $("#t-zones").style.opacity = "1";
  $("#t-go").innerHTML = `${icon(tuner.on ? "stop" : "mic")}<span>${tuner.on ? "Wyłącz stroik" : "Włącz stroik"}</span>`;
  const letterPc = ((tuner.tr % 12) + 12) % 12, sum = $("#t-set-sum");
  if (sum) sum.textContent = `Strój ${({ 0: "C", 2: "B", 9: "Es", 7: "F" })[letterPc] || "C"} · ±${tuner.tol} ¢ · A ${tuner.a4} Hz`;
}
/* Pitch of one sound: McLeod Pitch Method (normalised autocorrelation), the method used by good tuners.
   It does not depend on how loud the sound is (phones give a quiet signal when auto-gain is off),
   and it takes the first strong peak, so it does not jump an octave down. The signal is thinned to
   ~12 kHz first so it is quick on older phones, then the result is fine-tuned on the full signal.
   Returns Hz or -1; detectPitch.clarity is 0..1, detectPitch.rms the loudness. */
const scratch = {};
function scratchF32(k, n) { let a = scratch[k]; if (!a || a.length < n) a = scratch[k] = new Float32Array(Math.max(n, 4096)); return a.subarray(0, n); }
function detectPitch(buf, sr, minF = 40, maxF = 1500) {
  detectPitch.clarity = 0;
  /* working arrays are kept between calls (30 calls a second: no garbage for the collector) */
  const D = sr > 30000 ? 4 : 2, half = Math.floor(buf.length / D), x = scratchF32("x", half);
  let mean = 0; for (let i = 0; i < half; i++) { let v = 0; for (let k = 0; k < D; k++) v += buf[D * i + k]; x[i] = v / D; mean += x[i]; }
  mean /= half; let rms = 0; for (let i = 0; i < half; i++) { x[i] -= mean; rms += x[i] * x[i]; }
  rms = Math.sqrt(rms / half); detectPitch.rms = rms; if (rms < 0.0008) return -1;          // silence
  const srD = sr / D;
  const maxLag = Math.min(half >> 1, Math.ceil(srD / minF)), minLag = Math.max(2, Math.floor(srD / maxF)), W = half - maxLag;
  const nsdf = scratchF32("n", maxLag + 2);
  for (let tau = 0; tau <= maxLag + 1; tau++) {
    let acf = 0, m = 0;
    for (let i = 0; i < W; i++) { const a = x[i], b = x[i + tau]; acf += a * b; m += a * a + b * b; }
    nsdf[tau] = m > 0 ? 2 * acf / m : 0;
  }
  /* key maxima: the highest point of each positive region after the first zero crossing */
  const peaks = detectPitch.peaks || (detectPitch.peaks = []); peaks.length = 0; let tau = 1;
  while (tau < maxLag && nsdf[tau] > 0) tau++;
  while (tau < maxLag) {
    while (tau < maxLag && nsdf[tau] <= 0) tau++;
    let best = -1, bv = -Infinity;
    while (tau < maxLag && nsdf[tau] > 0) { if (nsdf[tau] > bv && tau >= minLag) { bv = nsdf[tau]; best = tau; } tau++; }
    if (best > 0) peaks.push(best);
  }
  if (!peaks.length) return -1;
  let top = -Infinity; for (const p of peaks) if (nsdf[p] > top) top = nsdf[p];
  const pick = peaks.find(p => nsdf[p] >= 0.9 * top);
  const y1 = nsdf[pick - 1], y2 = nsdf[pick], y3 = nsdf[pick + 1], den = y1 - 2 * y2 + y3;
  const shift = den ? (y1 - y3) / (2 * den) : 0;
  detectPitch.clarity = Math.min(1, y2 - 0.25 * (y1 - y3) * shift);
  /* fine tuning on the full signal, only around the peak found (a few lags: cheap) */
  const t0 = Math.round((pick + shift) * D), Wf = buf.length - (t0 + D + 2) * 2, f = t => {
    let acf = 0, m = 0; for (let i = 0; i < Wf; i++) { const a = buf[i], b = buf[i + t]; acf += a * b; m += a * a + b * b; } return m > 0 ? 2 * acf / m : 0;
  };
  if (Wf > 256) {
    let bt = t0, bv = f(t0);
    for (let t = Math.max(1, t0 - D); t <= t0 + D; t++) { const v = f(t); if (v > bv) { bv = v; bt = t; } }
    /* a high note with a weak fundamental can look like the octave below: if half the period fits as well, take it */
    const minFull = Math.floor(sr / maxF);
    for (let h = Math.round(bt / 2); h >= minFull && h >= 4;) {
      let hb = h, hv = f(h); for (let t = h - 2; t <= h + 2; t++) { const v = f(t); if (v > hv) { hv = v; hb = t; } }
      if (hv < 0.9 * bv) break; bt = hb; bv = hv; h = Math.round(bt / 2);
    }
    const a1 = f(bt - 1), a3 = f(bt + 1), dn = a1 - 2 * bv + a3;
    return sr / (bt + (dn ? (a1 - a3) / (2 * dn) : 0));
  }
  return srD / (pick + shift);
}
/* The microphone first, then an audio context at the microphone's own rate. The other order fails on phones:
   iPhone switches its audio mode when the mic starts and an earlier context hears silence; Chrome and Firefox
   refuse to connect a mic running at another rate. Every failure is said on screen, not swallowed. */
/* Microphone permission (iOS research, see fixlog-audio2): Safari and a home-screen app remember an "Allow" only for
   the open page; reopening the app asks again unless Safari's microphone setting is "Zezwalaj". So the microphone is
   never opened just because a screen was shown: the first time it needs a tap ("Włącz stroik", "Zaczynamy"); later it
   starts by itself only when the browser says permission is already "granted" (no prompt possible). One stream serves
   the whole visit while the tuner or a recording uses it; leaving the tuner, closing a recording or leaving the app
   stops it at once (the orange dot goes off), with no timers. */
const micKeep = { stream: null, pending: null, hinted: false };
/* "granted" | "prompt" | "denied" | "" (the browser does not say) */
async function micPermission() {
  try { const s = await navigator.permissions.query({ name: "microphone" }); return (s && s.state) || ""; } catch { return ""; }
}
/* opened by itself only when no prompt can come up: once allowed here, and the browser reports "granted" */
async function micAutoOk() { return store.get("micOk") === "1" && (await micPermission()) === "granted"; }
/* the tuner or a recording is done: the microphone is turned off now (keep: it is handed straight to the next user,
   e.g. the tuner passing it to "Nagraj swój dźwięk") */
function releaseMic(keep) {
  if (keep || tuner.on || tuner.starting || (typeof of !== "undefined" && (of.stream || of.starting))) return;
  if (micKeep.stream) { try { micKeep.stream.getTracks().forEach(t => t.stop()); } catch {} micKeep.stream = null; }
}
/* leaving the app turns the microphone off at once (no orange dot, no battery): the tuner stops ("Włącz stroik"
   brings it back), a guided recording pauses and listens again on return (by itself only when no prompt can come) */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (tuner.on || tuner.starting) tunerStop();
    if (typeof of !== "undefined" && (of.stream || of.starting)) { of.resumeOnShow = of.state === "listen"; stopListening(); }
    if (micKeep.stream) { try { micKeep.stream.getTracks().forEach(t => t.stop()); } catch {} micKeep.stream = null; }
  } else if (typeof of !== "undefined" && of.resumeOnShow) {
    of.resumeOnShow = false;
    if (of.state === "listen" && !$("#ownf").hidden) micAutoOk().then(ok => {
      if (!ok) { of.tapToListen = true; drawRing(0, null, "Dotknij, żeby słuchać"); return; }
      startListening().then(ok2 => { if (ok2 && of.state === "listen") { cancelAnimationFrame(of.raf); of.raf = requestAnimationFrame(listenLoop); } });
    });
  }
});
/* one short line, only after the phone has asked a second time: how to make iOS remember */
function micRememberHint() {
  if (micKeep.hinted) return; micKeep.hinted = true;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  hud(ios ? "Żeby iPhone nie pytał o mikrofon: Ustawienia → Aplikacje → Safari → Mikrofon → Zezwalaj" : "Żeby nie pytać o mikrofon: zezwól na niego tej stronie w ustawieniach przeglądarki", 7000);
}
async function openMic() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error("Ta przeglądarka nie daje dostępu do mikrofonu."), { name: "NoMic" });
  /* iPhone: playback sets the audio session to "playback" (music with the silent switch on), and in that mode iOS
     refuses the microphone ("audio session category is not compatible with audio capture"). Recording needs
     "play-and-record"; the next sound sets "playback" again just as it starts. */
  setSession("play-and-record");
  /* one microphone for the whole visit while it is in use: asking again could make the phone ask for permission again */
  let stream = micKeep.stream && micKeep.stream.getAudioTracks().some(t => t.readyState === "live") ? micKeep.stream : null;
  if (!stream) {
    /* two quick taps during the permission prompt share one request (no second, never-closed microphone) */
    micKeep.pending = micKeep.pending || (async () => {
      const before = await micPermission(), t0 = performance.now();
      let s;
      try { s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } }); }
      catch (e) { if (e && e.name === "OverconstrainedError") s = await navigator.mediaDevices.getUserMedia({ audio: true }); else throw e; }
      /* was the person asked? The browser says so (not "granted" before), or, when it does not say, a slow answer */
      const asked = before ? before !== "granted" : performance.now() - t0 > 900;
      if (asked) { const n = (+store.get("micAsks", 0) || 0) + 1; store.set("micAsks", String(n)); if (n >= 2) setTimeout(micRememberHint, 600); }
      store.set("micOk", "1");
      return s;
    })();
    try { stream = await micKeep.pending; } finally { micKeep.pending = null; }
    micKeep.stream = stream;
  }
  const AC = window.AudioContext || window.webkitAudioContext, rate = stream.getAudioTracks()[0]?.getSettings?.().sampleRate;
  let ctx; try { ctx = rate ? new AC({ sampleRate: rate }) : new AC(); } catch { ctx = new AC(); }
  try { await ctx.resume(); } catch {}
  let src; try { src = ctx.createMediaStreamSource(stream); }
  catch { try { ctx.close(); } catch {} ctx = new AC(); try { await ctx.resume(); } catch {} src = ctx.createMediaStreamSource(stream); }
  return { stream, ctx, src };
}
function micError(e) {
  return e && e.name === "NotAllowedError" ? (standalone() ? "Brak zgody na mikrofon. Włącz go w Ustawieniach telefonu." : "Brak zgody na mikrofon. Zezwól w ustawieniach przeglądarki.") :
    e && e.name === "NotFoundError" ? "Nie znaleziono mikrofonu." : e && e.name === "NotReadableError" ? "Mikrofon jest zajęty przez inną aplikację." :
    (e && e.message) || "Nie udało się włączyć mikrofonu.";
}
async function tunerStart() {
  if (tuner.on || tuner.starting) return;                          // a second tap while the phone asks: one microphone
  const gen = tuner.gen = (tuner.gen || 0) + 1; tuner.starting = true;
  $("#t-hz").textContent = "Włączam mikrofon…";
  let m; try { m = await openMic(); }
  catch (e) { tuner.starting = false; if (gen === tuner.gen) $("#t-hz").textContent = micError(e); return; }      // said once, under the needle
  tuner.starting = false;
  if (gen !== tuner.gen) { try { m.ctx.close(); } catch {} releaseMic(); return; }      // stopped while starting
  tuner.stream = m.stream; tuner.ctx = m.ctx;
  tuner.an = tuner.ctx.createAnalyser(); tuner.an.fftSize = 4096; tuner.buf = new Float32Array(tuner.an.fftSize);
  m.src.connect(tuner.an);
  Object.assign(tuner, { on: true, hist: [], shown: null, cand: null, candN: 0, lastOn: 0, trace: [], paused: false }); tn.txt.clear(); tn.sized = false; syncTuner();
  $("#t-hz").textContent = "Zagraj długi dźwięk";
  try { wakeLock = wakeLock || await navigator.wakeLock?.request("screen"); } catch {}
  tuner.raf = requestAnimationFrame(tunerLoop);
}
function tunerAnalyse(t) {
  /* the phone paused the sound (a call, the screen, another app): one tap brings it back */
  if (tuner.ctx.state !== "running") {
    if (t - (tuner.retry || 0) > 500) { tuner.retry = t; const r = tuner.ctx.resume?.(); if (r) r.catch(() => {}); }
    tuner.paused = true; tnText(tnEls().hz, "Dotknij, żeby włączyć"); return;
  }
  tuner.paused = false;
  tuner.an.getFloatTimeDomainData(tuner.buf);
  /* loudness for the orb: RMS in dB, −60 dB → 0, −10 dB → 1 */
  let sq = 0; const b = tuner.buf; for (let i = 0; i < b.length; i++) sq += b[i] * b[i];
  tuner.lvl = Math.min(1, Math.max(0, (20 * Math.log10(Math.sqrt(sq / b.length) + 1e-9) + 60) / 50));
  const f = detectPitch(tuner.buf, tuner.ctx.sampleRate, 27, 1400);
  if (!(f > 0) || detectPitch.clarity < (tuner.shown === null ? 0.9 : 0.85)) { tuner.trace.push({ t, c: null }); return; }
  tuner.hist.push(f); if (tuner.hist.length > 5) tuner.hist.shift();
  const srt = tuner.srt || (tuner.srt = []); srt.length = 0; for (const v of tuner.hist) srt.push(v); srt.sort((a, b) => a - b);
  const fm = srt[srt.length >> 1];
  const midi = 69 + 12 * Math.log2(fm / tuner.a4), n = Math.round(midi), c = 100 * (midi - n);
  if (n !== tuner.shown) {
    if (n === tuner.cand) tuner.candN++; else { tuner.cand = n; tuner.candN = 1; }
    if (tuner.candN < 3) { tuner.trace.push({ t, c: null }); return; }
    tuner.shown = n; tuner.ema = c; tuner.hz = fm;
  } else { tuner.ema += 0.3 * (c - tuner.ema); tuner.hz = fm; }
  tuner.lastOn = t; tuner.trace.push({ t, c: tuner.ema });
}
/* the tuner's screen parts, looked up once; sizes and colours are re-read only when they can have changed
   (an observer, every 2 s for the theme), never by a layout read in every frame */
const tn = { els: null, W: 0, sized: false, cs: null, csAt: 0, txt: new Map() };
function tnEls() {
  if (tn.els) return tn.els;
  tn.els = { box: $("#tuner2"), note: $("#t-note"), oct: $("#t-oct"), cents: $("#t-cents"), hz: $("#t-hz"), dot: $("#t-dot"), meter: $(".tn-meter"), cv: $("#t-trace") };
  tnOrb();
  if (window.ResizeObserver) new ResizeObserver(() => { tn.sized = false; }).observe(tn.els.box);
  return tn.els;
}
const tnText = (el, v) => { if (tn.txt.get(el) !== v) { tn.txt.set(el, v); el.textContent = v; } };
/* the note a player of this transposition reads, with its Polish octave name (the full transposition counts:
   tenor sax and bass clarinet +14, guitar and double bass +12, piccolo −12, glockenspiel −24) */
function writtenName(midi, tr = tuner.tr) {
  const w = midi + tr, oct = Math.floor(w / 12) - 1;
  return { name: NOTE_PL[((w % 12) + 12) % 12], oct: OCTAVE_NAMES[oct] || "" };
}
/* the listening orb behind the note (orb.js): sky, leaning flat/sharp, green with a ring once in tune
   (enter at the chosen accuracy, leave 3 cents wider, "locked" after 300 ms, so it does not flicker) */
function tnOrb() {
  if (!tn.orb && typeof createOrb === "function" && $("#t-orb")) tn.orb = createOrb($("#t-orb"), { hue: "brand", drift: "x", hollow: true });
  return tn.orb;
}
function tnOrbFrame(t, held, live, c) {
  const o = tnOrb(); if (!o) return;
  o.setLevel(tuner.on && !tuner.paused ? tuner.lvl || 0 : 0);
  o.setTune(held ? c : null);
  const inTune = live && Math.abs(c) <= (tuner.inTune ? tuner.tol + 3 : tuner.tol);
  if (inTune !== !!tuner.inTune) { tuner.inTune = inTune; tuner.inTuneAt = t; }
  o.setState(!tuner.on || !held ? "idle" : inTune && t - tuner.inTuneAt >= 300 ? "ok" : Math.abs(c) > 15 ? "far" : "listening");
}
function tunerLoop(t) {
  if (!tuner.on) return;
  tuner.raf = requestAnimationFrame(tunerLoop);
  if (t - tuner.lastAn > 30) { tuner.lastAn = t; tunerAnalyse(t); }
  while (tuner.trace.length && t - tuner.trace[0].t > 6000) tuner.trace.shift();
  const E = tnEls(), live = tuner.shown !== null && t - tuner.lastOn < 250, held = tuner.shown !== null && t - tuner.lastOn < 1500;
  if (!held && tuner.shown !== null) { tuner.shown = null; tuner.hist = []; }
  const c = tuner.ema, st = !held ? "off" : !live ? "hold" : Math.abs(c) <= tuner.tol ? "ok" : Math.abs(c) <= 15 ? "near" : "far";
  if (E.box.dataset.st !== st) E.box.dataset.st = st;
  if (tuner.shown !== null) {
    const wn = writtenName(tuner.shown);
    tnText(E.note, wn.name); tnText(E.oct, wn.oct ? `oktawa ${wn.oct}` : "");
    const r = Math.round(c), ok = Math.abs(r) <= tuner.tol;
    tnText(E.cents, ok ? "✓" : r < 0 ? `−${-r} ¢` : `+${r} ¢`);
    const al = ok ? "Czysto" : r < 0 ? `Za nisko o ${-r} centów` : `Za wysoko o ${r} centów`; if (E.cents.getAttribute("aria-label") !== al) E.cents.setAttribute("aria-label", al);
    tnText(E.hz, `${tuner.hz.toFixed(1)} Hz${tuner.tr ? " · dźwięk zapisany dla instrumentu" : ""}`);
  } else if (!tuner.paused) { tnText(E.note, "–"); tnText(E.oct, ""); tnText(E.cents, ""); tnText(E.hz, tuner.on ? "Zagraj długi dźwięk" : ""); }
  /* the dot glides towards its place (no jumps between readings) */
  if (!tn.sized) { tn.sized = true; tn.W = E.meter ? E.meter.clientWidth : 0; }
  const target = held ? Math.max(-50, Math.min(50, c)) / 50 * (tn.W / 2 - 23) : 0, nx = tuner.x + (target - tuner.x) * 0.22;
  if (Math.abs(nx - tuner.x) > 0.05 || !held) { tuner.x = nx; E.dot.style.transform = `translateX(${tuner.x.toFixed(1)}px)`; }
  tnOrbFrame(t, held, live, c);
  drawTrace(t);
}
function drawTrace(t) {
  const E = tnEls(), cv = E.cv, dpr = window.devicePixelRatio || 1;
  if (!tn.cvW || !tn.sized) { tn.cvW = cv.clientWidth; tn.cvH = cv.clientHeight; }
  const w = tn.cvW, h = tn.cvH; if (!w) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  if (!tn.cs || t - tn.csAt > 2000 || t < tn.csAt) {
    const cs = getComputedStyle(document.documentElement); tn.csAt = t;
    tn.cs = { ok: cs.getPropertyValue("--tn-ok").trim(), ink3: cs.getPropertyValue("--ink-3").trim() || "#999", ink: cs.getPropertyValue("--ink").trim() || "#222" };
  }
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const y = c => h / 2 - Math.max(-50, Math.min(50, c)) / 50 * (h / 2 - 6);
  g.fillStyle = tn.cs.ok; g.globalAlpha = .14; g.fillRect(0, y(tuner.tol), w, y(-tuner.tol) - y(tuner.tol)); g.globalAlpha = 1;
  g.strokeStyle = tn.cs.ink3; g.lineWidth = 1; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke(); g.setLineDash([]);
  g.strokeStyle = tn.cs.ink; g.lineWidth = 2.5; g.lineJoin = "round"; g.beginPath();
  let pen = false;
  for (const p of tuner.trace) { const x = w - (t - p.t) / 6000 * w; if (p.c === null) { pen = false; continue; } if (pen) g.lineTo(x, y(p.c)); else g.moveTo(x, y(p.c)); pen = true; }
  g.stroke();
}
function tunerStop(keepMic) {
  tuner.gen = (tuner.gen || 0) + 1; tuner.starting = false;
  tuner.on = false; cancelAnimationFrame(tuner.raf);
  try { tuner.ctx && tuner.ctx.close(); } catch {} releaseMic(keepMic);
  tuner.stream = tuner.ctx = null; tuner.shown = null; tuner.trace = []; tuner.paused = false; tn.txt.clear(); $("#tuner2").dataset.st = "off";
  $("#t-note").textContent = "–"; $("#t-oct").textContent = ""; $("#t-cents").textContent = ""; $("#t-hz").textContent = "";
  $("#t-dot").style.transform = ""; tuner.x = 0; tuner.lvl = 0; tuner.inTune = false; drawTrace(performance.now()); syncTuner();
  if (tn.orb) { tn.orb.setLevel(0); tn.orb.setTune(null); tn.orb.setState("idle"); }
  if (!playState && !metro.on) { try { wakeLock?.release(); } catch {} wakeLock = null; }
}
$("#t-go").addEventListener("click", () => (tuner.on || tuner.starting) ? tunerStop() : tunerStart());
$("#tuner2").addEventListener("click", e => { if (tuner.on && tuner.ctx && tuner.ctx.state !== "running" && !e.target.closest("#t-go")) tuner.ctx.resume(); });
$$("#t-tol button").forEach(b => b.addEventListener("click", () => { tuner.tol = +b.dataset.tol; store.set("tunerTol", tuner.tol); syncTuner(); }));
const setA4 = v => { tuner.a4 = Math.max(430, Math.min(450, v)); store.set("tunerA4", tuner.a4); syncTuner(); };
$("#t-a-down").addEventListener("click", () => setA4(tuner.a4 - 1));
$("#t-a-up").addEventListener("click", () => setA4(tuner.a4 + 1));
function buildTunerSheet() { $("#tuner-sheet-host").appendChild($("#tuner-ui")); syncTuner(); tnOrb(); if (!tuner.on) tunerAuto(); }
/* the tuner shown: it listens by itself only when that cannot bring up a permission prompt; otherwise one tap on
   "Włącz stroik" (the person decides when the phone asks) */
async function tunerAuto() {
  if (tuner.on || tuner.starting) return;
  if (await micAutoOk()) { if (!tuner.on && (S.view === "tunerv" || openSheetId === "tuner")) tunerStart(); }
  else if (!tuner.on && !tuner.starting) $("#t-hz").textContent = "Dotknij „Włącz stroik”";
}
/* which instrument a part is: its name (Puzon II → Puzon), a piano by its two staves, the melody by the piece's instrument */
/* the instrument for sound and new parts: as namedInstr; a piano part is a piano; unknown: the player's own */
function instrOfPart(pid) {
  const r = partInstr(pid);
  return r.ins ? r.ins.id : r.piano ? "fortepian" : mainInstr().id;
}
/* the player's recording of exactly this instrument, otherwise this instrument's own timbre (never another's recording) */
function voiceFor(instrId) {
  if (store.get("ownUse") === "1" && typeof ownVoice === "function") { const v = ownVoice(instrId); if (v) return v; }
  return typeof timbreNote === "function" ? timbreNote(instrById(instrId).voice) : synthNote;
}
const voiceForPart = pid => voiceFor(instrOfPart(pid));
const noteVoice = () => voiceFor(mainInstr().id);
/* the tuner's instrument letter (C, B, Es, F): the player's own instrument when it is in that letter, with its octave
   (B for a tenor sax is +14, not +2) */
$$("#t-instr button").forEach(b => b.addEventListener("click", () => {
  const v = +b.dataset.tr, m = mainInstr(), own = m.tr || 0;
  setTunerTr(((own % 12) + 12) % 12 === v ? own : v);
}));
/* any instrument's transposition for the tuner (for a picker in the redesigned tuner): setTunerTr(instrById(id).tr) */
function setTunerTr(tr) { tuner.tr = tr | 0; store.set("tunerTr", tuner.tr); tn.txt.clear(); syncTuner(); }

/* ---------------- T24 tutorial: five steps over the real screen, skippable ---------------- */
const TOUR = [
  ["#pages", "Nuty", "Dotknij taktu, żeby grać od niego. Dwa palce powiększają stronę."],
  ["#btn-play", "Posłuchaj", "Takt odliczania, potem kursor idzie za muzyką, a strona przewija się sama."],
  ["#btn-loop", "Pętla", "Powtarza 4 takty. Przesuń uchwyty albo dotknij taktu, także w trakcie grania."],
  ["#btn-tempo", "Tempo", "Zwolnij, przyspiesz i włącz metronom."],
  ["#btn-edit", "Edytuj", "Wybierz długość i dotknij pięciolinii, albo dotknij nuty, żeby ją zmienić. Gotowe kończy."],
  ["#btn-tools", "Więcej", "Tonacja, klucz, oryginał i wysyłanie."]
];
let tourI = -1;
function tourShow() {
  const [sel, t, p] = TOUR[tourI], el = $(sel); if (!el) { tourEnd(); return; }
  const r = el.getBoundingClientRect(), pad = 6, hole = $("#tour-hole");
  const top = Math.max(8, r.top - pad), h = Math.min(innerHeight - 16, r.height + 2 * pad);
  Object.assign(hole.style, { left: r.left - pad + "px", top: top + "px", width: r.width + 2 * pad + "px", height: Math.min(h, innerHeight * .45) + "px" });
  $("#tour-n").textContent = `${tourI + 1} z ${TOUR.length}`; $("#tour-t").textContent = t; $("#tour-p").textContent = p;
  $("#tour-next").textContent = tourI === TOUR.length - 1 ? "Gotowe" : "Dalej";
  const card = $("#tour-card"); card.style.top = card.style.bottom = "";
  if (r.top > innerHeight / 2) card.style.top = Math.max(16, top - card.offsetHeight - 16) + "px"; else card.style.top = Math.min(innerHeight - card.offsetHeight - 16, top + Math.min(h, innerHeight * .45) + 16) + "px";
}
function tourStart() { if (S.view !== "score") return; tourI = 0; $("#tour").hidden = false; tourShow(); $("#tour-next").focus(); }
function tourEnd() { tourI = -1; $("#tour").hidden = true; store.set("tourDone", "1"); }
$("#tour-next").addEventListener("click", () => { if (++tourI >= TOUR.length) tourEnd(); else tourShow(); });
$("#tour-skip").addEventListener("click", tourEnd);
$("#btn-tour").addEventListener("click", () => {
  const go2 = () => setTimeout(tourStart, 700);
  if (S.piece) { go("score"); go2(); } else { openPiece(examplePiece()); go2(); }
});

/* ---------------- Install (T9) ---------------- */
let installEvt = null;
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
/* "Na ekranie początkowym" only while Solo is not installed, with the steps for this device only */
const deviceOs = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ? "ios" : /Android/.test(navigator.userAgent) ? "android" : "desktop";
function syncInstall() {
  $("#install-sec").hidden = standalone();
  $("#installed").hidden = true;
  $("#btn-install").hidden = standalone() || !installEvt;
  $("#install-steps").hidden = standalone();
  const os = deviceOs(); $$("#install-steps [data-os]").forEach(p => (p.hidden = p.dataset.os !== os));
}
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; syncInstall(); });
window.addEventListener("appinstalled", () => { installEvt = null; syncInstall(); hud("Solo jest na ekranie początkowym", 3000); });
$("#btn-install").addEventListener("click", async () => {
  if (!installEvt) return;
  installEvt.prompt(); try { await installEvt.userChoice; } catch {}
  installEvt = null; syncInstall();
});

/* ---------------- Welcome ---------------- */
function hideWelcome() { if (!$("#welcome").hidden) { fadeOut($("#welcome"), 220); store.set("welcomed", "1"); } }

/* Earlier versions saved another tune as the example; swap it for the current one, keeping clef and parts. */
/* (migrateExample, which rewrote saved examples, is gone: it overwrote melodies people had built from the example) */

/* T21: files shared to Solo from another app wait in a cache; open them like picked files */
async function openShared() {
  const m = location.search.match(/[?&]shared=(1|err)/); if (!m) return;
  history.replaceState(history.state, "", location.pathname);
  if (m[1] === "err") { setTimeout(() => hud("Nie udało się odebrać pliku. Spróbuj jeszcze raz albo zapisz go w Plikach.", 5000), 800); return; }
  try {
    const c = await caches.open("solo-shared"), keys = await c.keys(), files = [];
    for (const k of keys) { const r = await c.match(k); const b = await r.blob(); files.push(new File([b], decodeURIComponent(r.headers.get("x-name") || "plik"), { type: b.type })); await c.delete(k); }
    if (files.length) handleFiles(files); else hud("Nie udało się odebrać pliku.", 4000);
  } catch (e) { console.warn(e); hud("Nie udało się odebrać pliku.", 4000); }
}

/* ---------------- Boot ---------------- */
(function boot() {
  if (location.hash.startsWith("#k=")) history.replaceState(null, "", location.pathname + location.search);   // old setup links
  ["apikey", "model", "engine"].forEach(k => { try { localStorage.removeItem("solo:" + k); } catch {} });   // the old Claude reading
  const sort = store.get("sort", "opened"); if ([...$("#lib-sort").options].some(o => o.value === sort)) $("#lib-sort").value = sort;
  history.replaceState({ v: null }, "");
  setupHero(); measureGlyphs(); setPlayUi(false); drawPending();
  restorePending().finally(openShared);          // pages left unread last time first, then a shared file
  show("home");
  if (!store.get("welcomed")) {
    DB.all().then(all => { if (!all.length) $("#welcome").hidden = false; else store.set("welcomed", "1"); }).catch(e => console.warn(e));   // unreadable is not "new here"
  }
  if ("serviceWorker" in navigator && (location.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) setupUpdates();
  /* "Open with Solo" on a computer (manifest file_handlers) */
  if ("launchQueue" in window) launchQueue.setConsumer(async lp => { try { const files = await Promise.all((lp.files || []).map(h => h.getFile())); if (files.length) handleFiles(files); } catch (e) { console.warn(e); } });
})();

/* A new version waits until the person says so ("Odśwież"), or until Solo is started again: it never reloads the
   page in the middle of something. The check runs when Solo comes back to the screen (an iPhone app is resumed,
   not restarted), at most every 30 minutes. */
function setupUpdates() {
  const sw = navigator.serviceWorker, bootAt = Date.now();
  let reloading = false, lastCheck = 0;
  const busy = () => S.view !== "home" || !!openSheetId || !!readCtl || cam.open || pending.length || [$("#onb"), $("#welcome"), $("#ownf")].some(el => el && !el.hidden);
  const reload = async () => {
    if (reloading) return; reloading = true;
    try { if (saveTimer) await savePiece(); else if (saving) await saving; } catch (e) { console.warn(e); }      // the last edit first
    location.reload();
  };
  const offer = w => {
    if (!w || !sw.controller) return;          // the very first install needs no reload
    /* just started and nothing touched yet: take the new version at once (a blink instead of a question) */
    if (Date.now() - bootAt < 2500 && !busy()) { w.postMessage({ type: "SKIP_WAITING" }); return; }
    const ask = () => { if (S.view === "home" && !reloading) hudAct("Jest nowa wersja Solo", "Odśwież", () => w.postMessage({ type: "SKIP_WAITING" }), 12000); };
    ask(); offer.ask = ask;
  };
  sw.register("sw.js").then(reg => {
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener("updatefound", () => { const w = reg.installing; if (w) w.addEventListener("statechange", () => { if (w.state === "installed") offer(w); }); });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden || Date.now() - lastCheck < 30 * 60e3) return;
      lastCheck = Date.now(); reg.update().catch(e => console.warn(e));
    });
  }).catch(e => console.warn(e));
  const hadController = !!sw.controller;
  sw.addEventListener("controllerchange", () => { if (hadController) reload(); });
  /* the update question comes back each time the library is shown again */
  window.addEventListener("popstate", () => { if (offer.ask) setTimeout(offer.ask, 700); });
  // first visit on a host without isolation headers: once the worker is in charge, reload one time to get them,
  // but never in the middle of the first questions or anything else
  let coiTried = false; try { coiTried = !!sessionStorage.getItem("solo:coi"); } catch {}
  if (!window.crossOriginIsolated && !coiTried) {
    const once = () => {
      if (busy()) { setTimeout(once, 3000); return; }
      try { sessionStorage.setItem("solo:coi", "1"); } catch {}
      reload();
    };
    if (sw.controller) once(); else sw.addEventListener("controllerchange", once, { once: true });
  }
}

/* Safari in a tab (not the icon on the home screen) deletes a site's data after 7 days without a visit, and the
   installed app has its own, separate storage: say so once in a while, with what to do */
function safariNotice(all) {
  const want = !isStandalone() && (isIOS() || /^((?!chrome|chromium|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent))
    && all.some(p => p.sourceType !== "example") && Date.now() - +store.get("safariLater", 0) > 3 * DAY;
  let el = $("#safari-nudge");
  if (!want) { if (el) el.hidden = true; return; }
  if (!el) {
    el = document.createElement("div"); el.className = "notice"; el.id = "safari-nudge";
    el.innerHTML = `<svg class="i"><use href="#info"/></svg><div class="grow"><b>Dodaj Solo do ekranu</b><span>W Safari nuty mogą zniknąć po tygodniu przerwy.</span></div><button class="link" id="safari-how">Jak?</button><button class="x" id="safari-x" aria-label="Później"><svg class="i"><use href="#x"/></svg></button>`;
    $("#lib").insertBefore(el, $("#backup-nudge") || $("#cols"));
    $("#safari-how").addEventListener("click", () => { go("settings"); setTimeout(() => { const st = $("#install-steps"); if (st) st.scrollIntoView({ behavior: "smooth", block: "center" }); }, 450); });
    $("#safari-x").addEventListener("click", () => { store.set("safariLater", String(Date.now())); fadeOut(el, 180); });
  }
  el.hidden = false;
}

/* ---------------- a new melody: the basics first (benchmark: MuseScore, iReal Pro, Flat), then an empty staff ---------------- */
const nm = { instr: null, time: "4/4", key: 0, mode: "major", clef: null, bpm: 90, title: "" };
function buildNewSheet() {
  const p = profile(); nm.instr = nm.instr || p.main;
  const ids = [...new Set([...p.instruments, nm.instr])];
  $("#new-instr").innerHTML = ids.map(id => `<button class="ichip" ${hueStyle(id)} data-i="${id}" aria-pressed="${id === nm.instr}">${esc(instrById(id).name)}</button>`).join("") +
    `<button data-more aria-label="Inny instrument">${icon("plus")}</button>`;
  meterPicker($("#new-time"), nm.time, v => { nm.time = v; });
  $("#new-bpm").textContent = String(nm.bpm);
  $("#new-title").value = nm.title;
  /* the clefs this instrument is written in (trombone: bass, tenor; viola: alto, treble), its usual one first */
  const ins = instrById(nm.instr), clefs = [...new Set([ins.clef, ...(typeof clefsOf === "function" ? clefsOf(ins) : [])])].filter(c => CLEF_PL[c]);
  if (!clefs.includes(nm.clef)) nm.clef = ins.clef;
  $("#new-clefs").innerHTML = clefs.map(c => `<button type="button" data-clef="${c}" aria-pressed="${c === nm.clef}">${cap(CLEF_PL[c])}</button>`).join("");
  syncNewKey();
}
/* the key by its name (F-dur, d-moll) with its signature under it; − / + walk the circle of fifths (7♭ … 7♯) */
function syncNewKey() {
  $("#new-keyname").textContent = keyName(nm.key, nm.mode); const n = Math.abs(nm.key); $("#new-keysig").textContent = !n ? "Bez znaków" : `${n} ${nm.key > 0 ? plural(n, "krzyżyk", "krzyżyki", "krzyżyków") : plural(n, "bemol", "bemole", "bemoli")}`;
  $$("#new-keypick [data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === nm.mode)));
  $$("#new-keypick [data-kd]").forEach(b => (b.disabled = Math.abs(nm.key + +b.dataset.kd) > 7));
}
$("#new-keypick").addEventListener("click", e => {
  const d = e.target.closest("[data-kd]"), m = e.target.closest("[data-mode]");
  if (d) nm.key = Math.max(-7, Math.min(7, nm.key + +d.dataset.kd)); if (m) nm.mode = m.dataset.mode; syncNewKey();
});
$("#new-clefs").addEventListener("click", e => { const b = e.target.closest("[data-clef]"); if (b) { nm.clef = b.dataset.clef; buildNewSheet(); } });
$("#new-instr").addEventListener("click", e => {
  const b = e.target.closest("[data-i]"); if (b) { nm.instr = b.dataset.i; buildNewSheet(); }
  /* any instrument: the same searchable picker as everywhere, then back to this sheet */
  if (e.target.closest("[data-more]")) pickInstrument("Instrument", id => { nm.instr = id; openSheet("new"); });
});
$("#new-instr").addEventListener("change", e => { if (e.target.id === "new-instr-more" && e.target.value) { nm.instr = e.target.value; buildNewSheet(); } });
$("#new-title").addEventListener("input", e => { nm.title = e.target.value; });
[["#new-bpm-down", -5], ["#new-bpm-up", 5]].forEach(([s, d]) => $(s).addEventListener("click", () => { nm.bpm = Math.max(30, Math.min(240, nm.bpm + d)); $("#new-bpm").textContent = String(nm.bpm); }));
/* a ready tune written for the chosen instrument (its octave, transposition, clef) with the piano under it */
$("#new-ready")?.addEventListener("click", e => { const b = e.target.closest("[data-t]"); if (b) openReadyTune(b.dataset.t); });
/* straight from "+": for the player's main instrument */
$("#add-ready").addEventListener("click", e => { const b = e.target.closest("[data-t]"); if (b) { nm.instr = nm.instr || profile().main; openReadyTune(b.dataset.t); } });
function openReadyTune(tid) {
  const b = { dataset: { t: tid } };
  const ins = instrById(nm.instr), t = READY_TUNES[b.dataset.t], base = readyTuneXml(b.dataset.t);
  let xml = makePart(base, "P1", { role: "melody", instr: ins });
  xml = makePart(xml, "P1", { role: "chords", instr: instrById("fortepian") });
  const d = parseXml(xml), root = d.documentElement;
  kids(root, "part").find(p => p.getAttribute("id") === "P1").remove(); kids(kid(root, "part-list"), "score-part").find(p => p.getAttribute("id") === "P1").remove();
  xml = new XMLSerializer().serializeToString(d);
  closeSheetThen(async () => {
    const names = new Set((await DB.all().catch(() => [])).map(p => p.title)); let title = t.title, k = 2; while (names.has(title)) title = `${t.title} ${k++}`;
    openPiece({ xml, sourceType: "own", title, composer: t.composer, instrument: ins.name }); S.dirty = true; savePiece();
  });
}
$("#new-go").addEventListener("click", () => {
  const ins = instrById(nm.instr), [beats, bt] = nm.time.split("/");
  /* the new part declares its instrument (and <transpose> for a transposing one), in its own clef */
  const d = parseXml(blankXml(4, { clef: nm.clef || ins.clef, beats, beatType: bt, fifths: nm.key, mode: nm.mode, tempo: nm.bpm, title: nm.title || "Nowa melodia", part: ins.name }));
  setDeclared(d, d.getElementsByTagName("score-part")[0], ins); setTranspose(d, d.getElementsByTagName("part")[0], trIv(ins.tr));
  const xml = new XMLSerializer().serializeToString(d);
  closeSheetThen(() => {
    openPiece({ xml, sourceType: "own", title: nm.title || "Nowa melodia", composer: "", instrument: ins.name });
    S.dirty = true; savePiece(); S.inLen = "quarter"; S.edTab = null; nm.title = "";
    whenDrawn(() => { setEditMode(true); edTab("len"); selectNote(null); });
  });
});

/* ---------------- 3.8 parts: chips under the title, "+" adds a part written automatically ----------------
   (benchmark: MuseScore, Flat, StaffPad, BandLab, Logic Session Players, Soundslice, iReal Pro) */
const ap = { instr: null, role: "voice2", int: 0, show: "staff" };
const partName = id => { const n = scoreParts().names; return id in n ? n[id] : id; };      // read once per score (was a parse per call)
function renderPartStrip() {
  const box = $("#pstrip"); if (!box || !S.piece) return;
  const only = S.only;
  box.innerHTML = S.parts.map((p, k) => {
    const nm = partLabel(p);
    /* the chip wears its instrument family's colour (brass amber, strings coral…); no icon: the name says it */
    return `<button ${hueStyle(instrOfPart(p.id))} class="pchip${only === p.id ? " only" : ""}${pb.mute.has(p.id) ? " muted" : ""}${p.keep ? "" : " off"}" data-pid="${p.id}" aria-pressed="${p.keep}"><span>${esc(nm)}</span></button>`;
  }).join("") + `<button class="pchip add" data-sheet="addpart" aria-label="Dodaj partię">${icon("plus")}</button>`;
}
/* a tap shows only that part (again: all of them); a long press opens what can be done with it */
(() => {
  let t = 0, long = false;
  $("#pstrip").addEventListener("pointerdown", e => { const c = e.target.closest("[data-pid]"); if (!c) return; long = false; t = setTimeout(() => { long = true; openPartSheet(c.dataset.pid); }, 500); });
  ["pointerup", "pointerleave", "pointercancel"].forEach(ev => $("#pstrip").addEventListener(ev, () => clearTimeout(t)));
  $("#pstrip").addEventListener("contextmenu", e => e.preventDefault());
  $("#pstrip").addEventListener("click", e => {
    const c = e.target.closest("[data-pid]"); if (!c || long) return;
    const part = S.parts.find(p => p.id === c.dataset.pid);
    if (part && !part.keep && !S.only) { part.keep = true; changed(); renderPartStrip(); return; }     // a hidden part comes back
    openPartSheet(c.dataset.pid);
  });
})();
function showOnly(pid) {
  if (pid) { S.keepBefore = S.keepBefore || S.parts.filter(p => p.keep).map(p => p.id); S.parts.forEach(p => (p.keep = p.id === pid)); }
  else if (S.keepBefore) { S.parts.forEach(p => (p.keep = S.keepBefore.includes(p.id))); S.keepBefore = null; }
  S.only = pid; changed(); renderPartStrip();
}
let partSheetId = null;
function openPartSheet(pid) { partSheetId = pid; openSheet("part"); }
function buildPartSheet() {
  const pid = partSheetId, pp = S.parts.find(p => p.id === pid); $("#sh-part-t").textContent = pp ? partLabel(pp) : partName(pid);
  $("#pp-mute").setAttribute("aria-pressed", String(pb.mute.has(pid)));
  $("#pp-only").setAttribute("aria-pressed", String(S.only === pid));
  $("#pp-del").disabled = S.parts.length < 2; $("#pp-only").disabled = S.parts.length < 2; $("#pp-hide").disabled = S.parts.filter(p => p.keep).length < 2;
  $("#pp-only span").textContent = S.only === pid ? "Wszystkie" : "Tylko ta";
  $("#pp-instr").disabled = (S.parts.find(p => p.id === pid) || {}).staves > 1;
  $("#pp-instr-now").textContent = instrById(instrOfPart(pid)).name;
  $("#pp-rolebox").hidden = pid === melodyPart();          // the melody is what the others are written from
  /* only what this part really plays is marked (known when Solo wrote it); nothing marked for a scanned part */
  const role = (S.piece.partRoles || {})[pid];
  $$("#pp-role [data-role]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.role === role)));
  $("#pp-rolenote").textContent = role ? "Wybierz inną, a Solo napisze tę partię od nowa z melodii." : "Wybierz, a Solo napisze tę partię od nowa z melodii.";
}
const setPartRole = (id, role) => { if (!id) return; S.piece.partRoles = { ...(S.piece.partRoles || {}), [id]: role }; };
/* what this part plays, rewritten from the melody in one tap (its instrument stays) */
$("#pp-role").addEventListener("click", e => {
  const b = e.target.closest("[data-role]"); if (!b) return;
  const pid = partSheetId;
  try {
    const r = addPart(S.piece.xml, instrOfPart(pid), b.dataset.role, { src: melodyPart(), int: 0 }); if (!r.id) return;
    if (b.getAttribute("aria-pressed") === "true") return;
    pushUndo(); setPartRole(r.id, b.dataset.role); closeSheetThen(() => { applyNewXml(orchestrateXml(replacePart(r.xml, pid, r.id), r.id), r.id); hudUndo(`Teraz: ${b.textContent}`); });
  } catch (err) { console.error(err); hud("Nie udało się zmienić partii"); }
});
$("#pp-only").addEventListener("click", () => { closeSheet(); showOnly(S.only === partSheetId ? null : partSheetId); });
/* "Ukryj": the part leaves the page (its chip stays, faded; a tap brings it back); the last shown part stays */
$("#pp-hide").addEventListener("click", () => {
  const pid = partSheetId, part = S.parts.find(p => p.id === pid); if (!part) return;
  if (S.parts.filter(p => p.keep).length < 2) { hud("To jedyna widoczna partia"); return; }
  if (S.only) { S.only = null; S.keepBefore = null; }
  part.keep = false; closeSheet(); changed(); renderPartStrip(); hud("Ukryta. Dotknij jej nazwy, żeby wróciła");
});
$("#pp-mute").addEventListener("click", () => { const id = partSheetId; if (pb.mute.has(id)) pb.mute.delete(id); else pb.mute.add(id); buildPartSheet(); renderPartStrip(); if (playState) play(playPos()); });
async function withOnly(pid, fn) { const prev = S.only; showOnly(pid); await new Promise(r => setTimeout(r, 300)); try { await fn(); } finally { showOnly(prev); } }
$("#pp-print").addEventListener("click", () => closeSheetThen(() => withOnly(partSheetId, printScore)));
$("#pp-send").addEventListener("click", () => closeSheetThen(async () => { const keep = exportParts; exportParts = [partSheetId]; try { await savePdf(true); } finally { exportParts = keep; } }));
/* the same notes on another instrument (a bassoon line as the 2nd trombone); an octave up or down */
$("#pp-instr").addEventListener("click", () => { const pid = partSheetId; closeSheetThen(() => pickInstrument("Jaki instrument?", id => {
  pushUndo(); applyNewXml(orchestrateXml(changePartInstr(S.piece.xml, pid, instrById(instrOfPart(pid)), instrById(id), partTr(pid)), pid), pid); hudUndo(`Teraz: ${instrById(id).name}`);
})); });
$$("#pp-up, #pp-down").forEach(b => b.addEventListener("click", () => {
  const pid = partSheetId, dir = b.id === "pp-up" ? 1 : -1, ins = S.parts.find(p => p.id === pid)?.staves > 1 ? null : instrById(instrOfPart(pid));
  const out = shiftPartOctave(S.piece.xml, pid, dir, ins), known = ins && namedInstr(pid), tr = partTr(pid);
  /* an octave the instrument cannot play is refused (the notes stay where they were) */
  if (known && outOfRange(out, pid, known, tr) > 0.2 && outOfRange(out, pid, known, tr) > outOfRange(S.piece.xml, pid, known, tr)) { hud(`${dir > 0 ? "Wyżej" : "Niżej"} ${known.name.toLowerCase()} nie zagra`, 3000); return; }
  pushUndo(); applyNewXml(orchestrateXml(out), pid);   /* keeps its number */ hudUndo(dir > 0 ? "Oktawę wyżej" : "Oktawę niżej");
}));
$("#pp-del").addEventListener("click", () => {
  const id = partSheetId, doc = parseXml(S.piece.xml), root = doc.documentElement;
  kids(root, "part").forEach(p => { if (p.getAttribute("id") === id) p.remove(); });
  kids(kid(root, "part-list"), "score-part").forEach(sp => { if (sp.getAttribute("id") === id) sp.remove(); });
  /* the section is numbered again (Puzon I, III → Puzon I, II; one left: Puzon) */
  pushUndo(); applyNewXml(orchestrateXml(new XMLSerializer().serializeToString(doc)), null); closeSheet();
  hudUndo("Usunięto partię");
});
/* the score changed shape (a part added or removed): parts are read again, the view keeps its settings */
function applyNewXml(xml, addId) {
  const settings = recordFromState().settings; S.piece.xml = xml; S.only = null; S.keepBefore = null;
  const ids = analyseXml(xml).parts.map(p => p.id);
  loadState(S.piece, { ...settings, keep: [...settings.keep.filter(id => ids.includes(id)), ...(addId ? [addId] : [])] });
  S.parts.forEach(p => { if (p.id === addId) p.keep = true; });
  S.loadedKey = null; changed(); renderPartStrip();
}
/* the toast's "Cofnij" undoes its own change only: after another edit it does nothing (the editor's Cofnij does) */
function hudUndo(msg) {
  hud(msg, 8000);
  const h = $("#toast"); const b = document.createElement("button"); b.className = "toast-act"; b.textContent = "Cofnij";
  const mine = S.piece && S.piece.xml, depth = S.undo ? S.undo.length : 0;
  b.addEventListener("click", () => { h.classList.remove("show"); if (S.piece && S.piece.xml === mine && S.undo && S.undo.length === depth) undo(); });
  h.appendChild(b);
}
/* sections numbered and the score in orchestra order (arrange.js orchestrate); a part's instrument: the one it
   declares, else its name, else (the melody) the piece's instrument */
function orchestrateXml(xml, newId = null) {
  const mel = S.piece && S.parts ? melodyPart() : null;
  return orchestrate(xml, (sp, p) => {
    const dec = declaredInstr(sp); if (dec) return dec;
    /* a name is trusted when the part's own <transpose> agrees with it (no <transpose> = not transposed: a "Trumpet"
       in a concert-pitch score is not a B♭ part), or when it is one of Solo's own Polish names */
    const nm = txt(sp, "part-name"), hit = instrFromName(nm), own = INSTRUMENTS.some(i => i.name.toLowerCase() === nm.replace(ROMAN_RE, "").trim().toLowerCase());
    if (hit && (own || (p ? trOfTranspose(p) ?? 0 : 0) === (hit.tr || 0))) return hit;
    if (sp.getAttribute("id") === mel && S.piece.instrument) return instrFromName(S.piece.instrument);
    return null;
  }, newId);
}

function buildAddPartSheet() {
  instrPicker($("#ap-instr"), { onPick: id => { rememberInstr(id); apStep2(id); } });
  $("#ap-step1").hidden = false; $("#ap-step2").hidden = true; $("#ap-back").hidden = true; $("#sh-addpart-t").textContent = ap.replace ? "Zmień partię" : "Dodaj partię";
  $("#ap-quick").parentElement.querySelector(".lbl").hidden = $("#ap-quick").hidden = !!ap.replace;
}
function apStep2(id) {
  ap.instr = id; const ins = instrById(id), melodyName = S.piece.instrument || "";
  const srcP = S.parts.find(p => p.id === (ap.src || melodyPart())), sameInstr = !!srcP && instrOfPart(srcP.id) === id;
  ap.role = ["Klawiszowe", "Szarpane"].includes(ins.group) && !["ukulele", "mandolina"].includes(id) ? "chords" : ins.lo < 36 ? "bass" : "voice2";
  ap.show = "staff";
  $("#ap-for").textContent = ins.name; $("#sh-addpart-t").textContent = "Co ma grać?";
  $("#ap-showbox").hidden = !sameInstr;
  /* with several parts: which one the new part follows */
  ap.src = ap.src && S.parts.some(p => p.id === ap.src) ? ap.src : melodyPart();
  $("#ap-srcbox").hidden = S.parts.length < 2;
  $("#ap-src").innerHTML = S.parts.map(p => `<button class="ichip" ${hueStyle(instrOfPart(p.id))} data-src="${p.id}" aria-pressed="${p.id === ap.src}">${esc(partLabel(p))}</button>`).join("");
  $("#ap-step1").hidden = true; $("#ap-step2").hidden = false; $("#ap-back").hidden = false;
  syncAp();
}
function syncAp() {
  $$("#ap-role [data-role]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.role === ap.role)));
  $$("#ap-int button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.int === ap.int)));
  $$("#ap-show button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.show === ap.show)));
  $("#ap-v2opts").hidden = ap.role !== "voice2" && ap.role !== "voice3";
}
$("#ap-back").addEventListener("click", buildAddPartSheet);
$$("#ap-role [data-role]").forEach(b => b.addEventListener("click", () => { ap.role = b.dataset.role; syncAp(); }));
$("#ap-src").addEventListener("click", e => { const b = e.target.closest("[data-src]"); if (!b) return; ap.src = b.dataset.src; $$("#ap-src [data-src]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); });
$$("#ap-int button").forEach(b => b.addEventListener("click", () => { ap.int = +b.dataset.int; syncAp(); }));
$$("#ap-show button").forEach(b => b.addEventListener("click", () => { ap.show = b.dataset.show; syncAp(); }));
/* the melody part (core.js melodyId: kept with the piece, not "whichever part is first") */
const melodyPart = () => melodyId();
const isMelodic = pid => { const p = S.parts.find(x => x.id === pid); return !!p && !(p.staves > 1 || PIANO_RE.test(p.name)); };
function partLabel(p) { if (declaredOf(p.id)) return partName(p.id) || p.name; const own = partName(p.id) || p.name; return p.id === melodyId() && isMelodic(p.id) && S.piece.instrument && !ROMAN_RE.test(own) ? S.piece.instrument : own; }
/* how far a part is written above how it sounds (declared instrument → the file's <transpose> → its name); Verovio's
   MIDI values are the written notes, so playback subtracts this once */
function partTr(pid) { try { return partInstr(pid).tr; } catch (e) { console.warn(e); return 0; } }
/* the notes of one voice of a part as they sound (written pitch minus the instrument's transposition) */
function soundingLine(xml, pid, voice = "1") {
  const part = kids(parseXml(xml).documentElement, "part").find(p => p.getAttribute("id") === pid); if (!part) return [];
  const tr = partTr(pid);
  return [...part.getElementsByTagName("note")].filter(n => kid(n, "pitch") && !kid(n, "chord") && !kid(n, "grace") && (txt(n, "voice") || "1") === voice).map(n => midiOf(kid(n, "pitch")) - tr);
}
/* the 2nd voice already in the score under this melody (its own part, or voice 2 on the melody's staff), in the
   melody's written pitch, so a 3rd voice is written against it; null when there is none */
function secondVoiceIn(xml, src) {
  const trS = partTr(src), mel = soundingLine(xml, src);
  const cands = [soundingLine(xml, src, "2"), ...S.parts.filter(p => p.id !== src && p.staves < 2).map(p => soundingLine(xml, p.id))]   // a one-line piano or harp voice counts too
    .filter(l => l.length === mel.length && l.length && l.some((m, i) => m !== mel[i]))
    /* the same tune in another octave (a trombone doubling the violins) is the melody, not a 2nd voice */
    .filter(l => l.filter((m, i) => (((m - mel[i]) % 12) + 12) % 12 === 0).length < 0.7 * l.length);
  if (!cands.length) return null;
  /* the nearest line to the melody (below it, or above it when a higher instrument plays it) */
  const dist = l => l.reduce((x, m, i) => x + Math.abs(mel[i] - m), 0), top = cands.reduce((a, b) => dist(b) < dist(a) ? b : a);
  return top.map(m => m + trS);
}
function addPart(xml, instrId, role, opts = {}) {
  const ins = instrById(instrId), src = opts.src || melodyPart();
  const before = new Set(analyseXml(xml).parts.map(p => p.id));
  const sameInstr = instrOfPart(src) === instrId;          // the very same instrument (Puzon ≠ Puzon altowy)
  const v2Midi = role === "voice3" ? secondVoiceIn(xml, src) : null;
  let out = makePart(xml, src, { role, instr: ins, interval: opts.int || 0, keepClef: sameInstr && ["voice2", "voice3", "melody"].includes(role), v2Midi, srcTr: partTr(src) });
  const newId = analyseXml(out).parts.map(p => p.id).find(id => !before.has(id));
  if (opts.same && newId) return { xml: mergeAsVoice2(out, src, newId), id: null };
  return { xml: orchestrateXml(out, newId), id: newId };
}
$("#ap-go").addEventListener("click", () => {
  try {
    const r = addPart(S.piece.xml, ap.instr, ap.role, { int: ap.int, src: ap.src, same: (ap.role === "voice2" || ap.role === "voice3") && ap.show === "same" && !$("#ap-showbox").hidden });
    const rep = ap.replace; ap.replace = null;
    if (rep && r.id) { r.xml = replacePart(r.xml, rep, r.id); if (rep === S.melody) S.melody = r.id; }
    pushUndo(); setPartRole(r.id, ap.role); closeSheetThen(() => { applyNewXml(r.xml, r.id); hudUndo(rep ? "Zmieniono partię" : "Dodano partię"); });
  } catch (e) { console.error(e); hud("Nie udało się dopisać tej partii"); }
});
/* quick ensembles: duo = melody + second voice, trio = + bass; for the player's own instrument */
$$("#ap-quick [data-quick]").forEach(b => b.addEventListener("click", () => {
  if (!isMelodic(melodyPart())) { hud("Najpierw potrzebna jest melodia (jeden głos)", 3000); return; }
  if (b.dataset.quick === "canon") return quickCanon();
  try {
    const me = instrById(instrOfPart(melodyPart()));
    let r = addPart(S.piece.xml, me.id, "voice2"), xml = r.xml, ids = [r.id];
    if (b.dataset.quick === "trio") {
      /* a trio of the piece's own instrument: violins → three violins, trumpet → three trumpets; in a trombone
         section the third is the bass trombone (Puzon I–III). When the instrument cannot go a fifth under the tune's
         lowest note, the section's lower instrument plays the third voice (violin → viola, alto sax → tenor sax) */
      const low = Math.min(...soundingLine(S.piece.xml, melodyPart()));
      const third = ["puzon", "puzon-alt"].includes(me.id) ? "puzon-b" : me.lo <= low - 7 || !SECTION_BASS[me.id] ? me.id : SECTION_BASS[me.id];
      const r2 = addPart(xml, third, "voice3"); xml = r2.xml; ids.push(r2.id);
    }
    pushUndo(); setPartRole(ids[0], "voice2"); setPartRole(ids[1], "voice3"); closeSheetThen(() => { applyNewXml(xml, ids[0]); S.parts.forEach(p => { if (ids.includes(p.id)) p.keep = true; }); changed(); renderPartStrip(); hudUndo(b.dataset.quick === "trio" ? "Trio gotowe" : "Duet gotowy"); });
  } catch (e) { console.error(e); hud("Nie udało się dopisać partii"); }
}));

/* the lower instrument of a section, for a third voice the instrument itself cannot reach */
const SECTION_BASS = { trabka: "puzon", "trabka-c": "puzon", kornet: "puzon", flugelhorn: "eufonium", waltornia: "puzon", "sakshorn-a": "sakshorn-t", skrzypce: "altowka", altowka: "wiolonczela",
  piccolo: "flet", flet: "klarnet", oboj: "fagot", rozek: "fagot", "klarnet-es": "klarnet", klarnet: "klarnet-bas", "klarnet-a": "klarnet-bas", "sax-s": "sax-t", "sax-a": "sax-t", "sax-t": "sax-b",
  sopran: "alt", alt: "tenor", tenor: "bas", mandolina: "gitara", ukulele: "gitara", dzwonki: "marimba", ksylofon: "marimba", wibrafon: "marimba" };
/* Kanon: three voices of the piece's instrument (trombones: Puzon I–III, the third a bass trombone), entering at
   the distance where they sound best; a tune that does not work as a canon is said so, not written badly */
function quickCanon() {
  try {
    const src = melodyPart(), me = instrById(instrOfPart(src)), plan = canonPlan(S.piece.xml, src, 3);
    if (!plan) { hud("Ta melodia jest za krótka na kanon", 3000); return; }
    if (plan.strongBad > 0.1) { hud("Ta melodia nie brzmi dobrze jako kanon", 3500); return; }
    const third = ["puzon", "puzon-alt"].includes(me.id) ? "puzon-b" : me.id;
    const r = canonXml(S.piece.xml, src, [me, instrById(third)], plan.d);
    const xml = orchestrateXml(r.xml);
    pushUndo(); closeSheetThen(() => { applyNewXml(xml, r.ids[0]); S.parts.forEach(p => { if (r.ids.includes(p.id)) p.keep = true; }); changed(); renderPartStrip(); hudUndo(`Kanon: wejścia co ${plan.d} ${plural(plan.d, "takt", "takty", "taktów")}`); });
  } catch (e) { console.error(e); hud("Nie udało się zrobić kanonu"); }
}
/* "Zmień" a part: pick another instrument or what it plays; the new part takes the old one's place */

function replacePart(xml, oldId, newId) {
  const doc = parseXml(xml), root = doc.documentElement, parts = kids(root, "part"), pl = kid(root, "part-list");
  const o = parts.find(p => p.getAttribute("id") === oldId), n = parts.find(p => p.getAttribute("id") === newId);
  const osp = kids(pl, "score-part").find(x => x.getAttribute("id") === oldId), nsp = kids(pl, "score-part").find(x => x.getAttribute("id") === newId);
  if (!o || !n) return xml;
  o.replaceWith(n); if (osp && nsp) osp.replaceWith(nsp);
  return new XMLSerializer().serializeToString(doc);
}

/* ---------------- collections (benchmark: Newzik, forScore, Spotify, iOS Photos, Apple Notes) ----------------
   Chips under the search; a piece can be in several; automatic ones: Ulubione, Ostatnie, Moje, Ze zdjęć. */
const COL_COLORS = ["#E5484D", "#F76B15", "#FFC53D", "#30A46C", "#12A594", "#0090FF", "#6E56CF", "#D6409F", "#8D8D8D", "#A18072", "#3E63DD", "#29A383"];
const cols = () => { try { return JSON.parse(store.get("cols", "[]")) || []; } catch { return []; } };
const saveCols = c => store.set("cols", JSON.stringify(c)) || hud("Nie udało się zapisać kolekcji. Pamięć urządzenia może być pełna.", 4000);
const favs = () => { try { return JSON.parse(store.get("favs", "[]")) || []; } catch { return []; } };
const saveFavs = f => store.set("favs", JSON.stringify(f)) || hud("Nie udało się zapisać ulubionych. Pamięć urządzenia może być pełna.", 4000);
let libCol = store.get("libCol", "all");
function inCol(p, all) {
  if (libCol === "all") return true;
  if (libCol === "fav") return favs().includes(p.id);
  if (libCol === "recent") return all.slice().sort((a, b) => (b.opened || b.updated || 0) - (a.opened || a.updated || 0)).slice(0, 12).some(x => x.id === p.id);
  if (libCol === "own") return p.sourceType === "own";
  if (libCol === "photo") return p.sourceType === "device" || p.sourceType === "ai";
  const c = cols().find(x => x.id === libCol); return !!(c && c.items.includes(p.id));
}
function renderCols(all) {
  const box = $("#cols"); if (!box) return;
  const auto = [["all", "Wszystko", ""], ["fav", "Ulubione", "heart"]];
  if (all.some(p => p.sourceType === "own")) auto.push(["own", "Moje", "pencil"]);
  if (all.some(p => p.sourceType === "device" || p.sourceType === "ai")) auto.push(["photo", "Ze zdjęć", "camera"]);
  const mine = cols();
  if (![...auto.map(a => a[0]), ...mine.map(c => c.id)].includes(libCol)) libCol = "all";
  box.innerHTML = auto.map(([id, name, ic]) => `<button class="cchip" role="tab" data-col="${id}" aria-selected="${libCol === id}">${ic ? icon(ic) : ""}<span>${name}</span></button>`).join("") +
    mine.map(c => `<button class="cchip" role="tab" data-col="${esc(c.id)}" data-user aria-selected="${libCol === c.id}"><i class="cdot" style="background:${esc(c.color || "#8D8D8D")}"></i><span>${esc(c.name)}</span></button>`).join("") +
    `<button class="cchip add" id="col-add" aria-label="Nowa kolekcja">${icon("plus")}</button>`;
}
(() => {
  const box = $("#cols"); let t = 0, long = false;
  box.addEventListener("pointerdown", e => { const c = e.target.closest("[data-user]"); if (!c) return; long = false; t = setTimeout(() => { long = true; navigator.vibrate?.(10); editCol(c.dataset.col); }, 480); });
  ["pointerup", "pointerleave", "pointercancel"].forEach(ev => box.addEventListener(ev, () => clearTimeout(t)));
  box.addEventListener("contextmenu", e => e.preventDefault());
  box.addEventListener("click", e => {
    if (e.target.closest("#col-add")) { colTarget = null; colPiece = null; openSheet("col"); return; }
    const c = e.target.closest("[data-col]"); if (!c || long) return;
    libCol = c.dataset.col; store.set("libCol", libCol); refreshLibrary();
  });
})();
let colTarget = null, colPiece = null, colColor = COL_COLORS[5];
function editCol(id) { colTarget = id; colPiece = null; openSheet("col"); }
function buildColSheet() {
  const c = cols().find(x => x.id === colTarget);
  $("#sh-col-t").textContent = c ? "Kolekcja" : "Nowa kolekcja"; $("#col-name").value = c ? c.name : ""; colColor = c ? (c.color || COL_COLORS[5]) : COL_COLORS[cols().length % COL_COLORS.length];
  $("#col-del").hidden = !c;
  $("#col-emoji").innerHTML = COL_COLORS.map(c => `<button data-e="${c}" aria-pressed="${c === colColor}" aria-label="Kolor"><i style="background:${c}"></i></button>`).join("");
}
$("#col-emoji").addEventListener("click", e => { const b = e.target.closest("[data-e]"); if (!b) return; colColor = b.dataset.e; $$("#col-emoji button").forEach(x => x.setAttribute("aria-pressed", String(x === b))); });
$("#col-save").addEventListener("click", () => {
  const name = $("#col-name").value.trim(); if (!name) { $("#col-name").focus(); return; }
  const all = cols(); let c = all.find(x => x.id === colTarget);
  if (c) Object.assign(c, { name, color: colColor });
  else { c = { id: "c" + Date.now().toString(36), name, color: colColor, items: colPiece ? [colPiece] : [] }; all.push(c); }
  saveCols(all); closeSheetThen(() => { hud(colPiece ? `Dodano do: ${name}` : "Gotowe", 1800); refreshLibrary(); });
});
$("#col-del").addEventListener("click", () => {
  const all = cols(), c = all.find(x => x.id === colTarget); if (!c) return;
  const at = all.indexOf(c);
  saveCols(all.filter(x => x !== c)); if (libCol === c.id) { libCol = "all"; store.set("libCol", "all"); }
  /* the pieces stay; the collection itself (its name, colour and order) can come back */
  const undo = () => { const now = cols(); if (now.some(x => x.id === c.id)) return; now.splice(Math.min(at, now.length), 0, c); saveCols(now); refreshLibrary(); };
  closeSheetThen(() => { hudAct("Usunięto kolekcję. Utwory zostały.", "Cofnij", undo, 6000); refreshLibrary(); });
});
/* from a piece's long-press menu: ♥ and "Kolekcja" (tick the ones it belongs to) */
function syncFavTile() { const on = cardPiece && favs().includes(cardPiece.id); $("#cd-fav").innerHTML = icon(on ? "heart-fill" : "heart") + `<span>Ulubione</span>`; $("#cd-fav").setAttribute("aria-pressed", String(!!on)); }
$("#cd-fav").addEventListener("click", () => {
  const f = favs(), id = cardPiece.id, on = f.includes(id);
  saveFavs(on ? f.filter(x => x !== id) : [...f, id]); syncFavTile(); refreshLibrary();
});
$("#cd-col").addEventListener("click", () => closeSheetThen(() => openSheet("addto")));
function buildAddtoSheet() {
  const id = cardPiece && cardPiece.id, all = cols();
  $("#addto-list").innerHTML = all.length ? all.map(c => `<label class="li"><i class="cdot" style="background:${esc(c.color || "#8D8D8D")}"></i><span class="grow"><b>${esc(c.name)}</b></span><input type="checkbox" class="switch" data-c="${esc(c.id)}" ${c.items.includes(id) ? "checked" : ""}></label>`).join("") : `<p class="note">Nie masz jeszcze kolekcji.</p>`;
}
$("#addto-list").addEventListener("change", e => {
  const cid = e.target.dataset.c, id = cardPiece && cardPiece.id; if (!cid || !id) return;
  const all = cols(), c = all.find(x => x.id === cid); if (!c) return;
  c.items = e.target.checked ? [...new Set([...c.items, id])] : c.items.filter(x => x !== id);
  saveCols(all); refreshLibrary();
});
$("#addto-new").addEventListener("click", () => { colTarget = null; colPiece = cardPiece && cardPiece.id; closeSheetThen(() => openSheet("col")); });

/* notes the instrument cannot play are tinted (often a misread octave or clef); only for the music as written */
function markRange() {
  if (S.iv.d || S.iv.s) return;
  try {
    const slots = staffSlots(), known = new Map();     // one instrument lookup per part; a part nothing names is not tinted
    $$("#pages g.note").forEach(g => {
      const pid = partOfEl(g, slots); if (!pid) return;
      if (!known.has(pid)) { const pi = partInstr(pid); known.set(pid, pi.ins ? { ins: pi.ins, tr: pi.tr } : null); }
      const k = known.get(pid); if (!k) return;
      const v = tk.getMIDIValuesForElement(g.id); if (!v || !(v.pitch > 0)) return;
      const w = v.pitch - k.tr - (pid === readingPartId() ? 12 * (S.readOct || 0) : 0);
      g.classList.toggle("outrange", w < k.ins.lo - 1 || w > k.ins.hi + 1);
    });
  } catch (e) { console.warn(e); }
}

/* the start screen: stays at least 0.9 s from launch (long enough to read, short enough not to wait), then lifts away */
(() => {
  const sp = $("#splash"); if (!sp) return;
  const t0 = performance.timeOrigin ? Date.now() - performance.timeOrigin : performance.now();
  setTimeout(() => { sp.classList.add("out"); setTimeout(() => sp.remove(), 600); }, Math.max(0, 900 - t0));
})();
