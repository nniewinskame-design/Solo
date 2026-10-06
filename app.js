/* Solo · interface. Logic for music lives in core.js; this file wires the screens. */
"use strict";
const VERSION = "3.9";
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
  if (from === "tunerv" && v !== "tunerv" && tuner.on) tunerStop();
  if (v === "tunerv") { $("#tuner-tab-host").appendChild($("#tuner-ui")); syncTuner(); syncOwn(); if (!tuner.on && from !== v) tunerStart(); }
  if (v === "metrov") { $("#metro-tab-host").appendChild($("#metro-ui")); buildToolsSheet(); }
  if (v === "settings" && typeof renderProfile === "function") renderProfile();
  if (v === "settings" && NEWS[VERSION]) { store.set("newsSeen", VERSION); $('#tabbar [data-tab="settings"]')?.classList.remove("dot"); }
}
/* the brass slide pill sits behind the current tab and glides to the next one (the one "you are here" mark) */
function placeSlide() {
  requestAnimationFrame(() => {                         // after the bar is laid out (it is hidden off the tabs)
    const bar = $("#tabbar"), cur = bar && bar.querySelector("[aria-current]"), pill = bar && bar.querySelector(".slide"); if (!cur || !pill || !cur.offsetWidth) return;
    if (!pill.style.width) pill.style.transition = "none";   // the first placement does not glide in from the left
    pill.style.width = cur.offsetWidth + "px"; pill.style.transform = `translateX(${cur.offsetLeft}px)`;
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
  ({ clef: buildClefSheet, key: buildKeySheet, more: buildMoreSheet, orig: buildOrigSheet, pages: preparePages, tools: buildToolsSheet, tuner: buildTunerSheet, voice: buildVoiceSheet, partfor: buildPartForSheet, bar: buildBarSheet, practice: buildPracticeSheet, new: buildNewSheet, addpart: buildAddPartSheet, part: buildPartSheet, share: buildShareSheet, instr: () => buildInstrSheet(), col: buildColSheet, addto: buildAddtoSheet, card: syncFavTile, pick: () => buildPickSheet() })[name]?.();
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
  if (openSheetId === "tuner" && tuner.on) tunerStop();
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
/* Sheet headers: title in the middle, a round ✓ (done) or ✕ (cancel) button; the words stay as labels. */
$$(".shead").forEach(h => {
  h.querySelectorAll(".done").forEach(b => {
    const label = b.textContent.trim();
    b.setAttribute("aria-label", label); b.title = label;
    b.innerHTML = icon(b.classList.contains("ghost") ? "x" : "check");
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
    if (act === "example") { hideWelcome(); openPiece({ xml: exampleXml(), sourceType: "example", title: "", composer: null, instrument: "Puzon" }); }
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
const HERO = [
  { src: "img/window.jpg", pos: "50% 42%" }, { src: "img/piano.jpg", pos: "35% 50%" },
  { src: "img/brass.jpg", pos: "30% 50%" }
];
function setupHero() {
  const h = HERO[Math.floor(Date.now() / 86400000) % HERO.length];
  const img = $("#hero-img"); if (!img) return;          // the library has a drawn masthead now
  img.addEventListener("load", () => img.classList.add("loaded"), { once: true });
  img.src = h.src; $("#hero").style.setProperty("--pos", h.pos);
  if (img.complete && img.naturalWidth) img.classList.add("loaded");
}
function shortKey(label) { if (!label) return ""; const m = label.match(/^(.+?)-(dur|moll)$/); return m ? m[1] : label; }
async function refreshLibrary(animate) {
  let all = [];
  try { all = await DB.all(); } catch {}
  const q = $("#lib-search").value.trim().toLowerCase();
  const sort = $("#lib-sort").value;
  renderCols(all);
  const list = all.filter(p => q ? ((p.title || "") + " " + (p.composer || "")).toLowerCase().includes(q) : inCol(p, all));
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
    b.querySelector(".thumb").addEventListener("click", () => { if (b._long) { b._long = false; return; } openPiece(p, p.settings); });
    b.querySelector(".more").addEventListener("click", () => openCardSheet(p, b));
    [".t", ".m"].forEach(sel => b.querySelector(sel).addEventListener("click", () => openPiece(p, p.settings)));
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
  $("#lib-none").textContent = `Nic nie pasuje do „${q}”.`;
}
/* rename from the library: the record is updated and its cover (which shows the title) redrawn */
async function renameInLibrary(p, field, v) {
  if (field === "title" && !v) v = "Bez tytułu";
  const rec = { ...p, [field]: v, updated: Date.now() };
  try { await DB.put(rec); } catch { hud("Nie udało się zapisać."); return; }
  refreshLibrary();
  try {
    const snap = { piece: S.piece, parts: S.parts, srcKey: S.srcKey, srcClef: S.srcClef, clef: S.clef, iv: S.iv, preset: S.preset, bpm: S.bpm, loadedKey: S.loadedKey };
    loadState(rec, rec.settings);
    const thumb = await makeThumb();
    Object.assign(S, snap); S.loadedKey = null;
    await DB.put({ ...rec, thumb });
    refreshLibrary();
  } catch (e) { console.warn(e); }
}
$("#lib-search").addEventListener("input", refreshLibrary);
$("#lib-sort").addEventListener("change", () => { store.set("sort", $("#lib-sort").value); refreshLibrary(); });

/* ---------------- Opening a piece ---------------- */
const OTHER_INSTR = /tr[aą]bk|klarnet|waltorn|saks|skrzyp|flet|ob[oó]j|trumpet|clarinet|horn|sax|violin|flute|oboe|głos|solo|voice/i;
function maybeTrombone() { if (!S.piece.instrument || OTHER_INSTR.test(S.piece.instrument)) S.piece.instrument = "Puzon"; }
/* the piece's state (parts, key, clef, transposition, tempo) without touching the screen */
function loadState(piece, settings) {
  const info = analyseXml(piece.xml);
  S.piece = { ...piece, title: piece.title || info.title || "Bez tytułu", composer: piece.composer ?? info.composer ?? "" };
  S.parts = info.parts; S.srcKey = info.key;
  const first = S.parts.find(p => p.keep) || S.parts[0];
  S.srcClef = first ? first.clef : "treble";
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
  if (S.piece.instrument == null) S.piece.instrument = first && !PIANO_RE.test(first.name) ? first.name : "";
}
/* the music must sit on the staff: if most notes of the part being read are far off it (an old setting, a wrong
   octave), the octave that fits is taken and the player is told */
/* the instrument a part is written for, only when its name (or the piece) says so; null when unknown */
/* the instrument a part declares (<score-instrument>, written by Solo for every part it adds or changes) */
function declaredOf(pid) {
  if (!S.piece) return null; if (declaredOf.xml !== S.piece.xml) { declaredOf.xml = S.piece.xml; declaredOf.map = {}; [...parseXml(S.piece.xml).getElementsByTagName("score-part")].forEach(sp => { const i = declaredInstr(sp); if (i) declaredOf.map[sp.getAttribute("id")] = i; }); }
  return declaredOf.map[pid] || null;
}
function namedInstr(pid) {
  const dec = declaredOf(pid); if (dec) return dec;
  const p = S.parts && S.parts.find(x => x.id === pid); if (!p || p.staves > 1 || PIANO_RE.test(p.name)) return null;
  const names = [(typeof partLabel === "function" ? partLabel(p) : p.name) || "", S.piece && S.piece.instrument || ""].map(n => n.replace(/ (I|II|III|IV|V)$/, "").trim().toLowerCase());
  for (const n of names) { const hit = n && INSTRUMENTS.find(i => i.name.toLowerCase() === n); if (hit) return hit; }
  return null;
}
/* a phone shows big notes that fit the screen: an A4 page there is under half its paper size (7.2 mm staff ≈ 13 px);
   A4 stays the view on a tablet and whenever the player picked it */
function fitPageToDevice() { if (!S.pageMine && Math.min(innerWidth, screen.width || innerWidth) < 600) S.page = "screen"; }
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
  $("#peek").hidden = true; pb.loop = null; pb.pick = false; pb.mute.clear(); pb.resumeMs = 0; $("#loopbar").hidden = true; $("#btn-loop").setAttribute("aria-pressed", "false"); S.undo = []; S.editSel = null; S.keepSel = null; S.editMode = false; $("#editbar").hidden = true; document.body.classList.remove("editing", "editmode"); $("#btn-edit").setAttribute("aria-pressed", "false");
  $("#pages").innerHTML = `<div class="loading-page"><span class="spinner"></span></div>`;
  $("#scroller").scrollTop = 0;
  if (S.view !== "score") go("score");
  render();
  if (piece.id) DB.put({ ...recordFromState(), thumb: piece.thumb || null }).catch(() => {}); // remember "opened"
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
    id: S.piece.id || ("p" + now.toString(36) + Math.random().toString(36).slice(2, 7)),
    title: S.piece.title || "Bez tytułu", composer: S.piece.composer || "", instrument: S.piece.instrument || "",
    xml: S.piece.xml, sourceType: S.piece.sourceType || "file", images: S.piece.images || [], aiJson: S.piece.aiJson || null,
    issues: S.piece.issues || [], lines: S.piece.lines || null, origXml: S.piece.origXml || null, created: S.piece.created || now, updated: S.dirty ? now : (S.piece.updated || now), opened: S.piece.opened || now,
    settings: { keep: S.parts.filter(p => p.keep).map(p => p.id), clef: (S.editView || S).clef, iv: (S.editView || S).iv, preset: (S.editView || S).preset, bpm: S.bpm, zoom: (S.editView || S).zoom, pz: S.pz, readOct: (S.editView || S).readOct || 0, pageMine: !!S.pageMine, clefMine: !!S.clefMine, layout: S.layout, page: (S.editView || S).page, under: S.under || "", swing: !!S.swing },
    keyLabel: curKeyName(), clefLabel: CLEF_PL[curClef()] || "", thumb: S.piece.thumb || null
  };
}
let saveTimer = null;
function autosave() { clearTimeout(saveTimer); saveTimer = setTimeout(savePiece, 500); }
async function savePiece() {
  clearTimeout(saveTimer);
  if (!S.piece) return;
  const rec = recordFromState();
  try { await DB.put(rec); }
  catch { hud("Brak miejsca na urządzeniu. Usuń niepotrzebne nuty.", 4000); return; }
  S.piece.id = rec.id; S.piece.created = rec.created; S.piece.updated = rec.updated; S.dirty = false;
  if (!store.get("persisted")) { try { navigator.storage?.persist?.().then(ok => ok && store.set("persisted", "1")); } catch {} }
  if (!DB.ok) hud("Ta przeglądarka nie pozwala zapisywać. Nuty znikną po zamknięciu.", 4000);
}
async function leaveScore() {
  stopPlayback();
  if (!S.piece) return;
  const needSave = S.piece.id || S.dirty;
  if (S.piece.sourceType === "example" && !S.piece.id && !S.dirty) return;
  await settle(); await idle();               // heavy work only after the screen has settled
  if (S.thumbDirty && needSave) {
    try { S.piece.thumb = await makeThumb(); S.thumbDirty = false; } catch (e) { console.warn(e); }
  }
  if (needSave) { await savePiece(); if (S.view === "home") refreshLibrary(); }
}

/* ---------------- Rendering ---------------- */
/* An A4 page. The SVG is always drawn at the page's width, so "bigger notes" means a smaller
   virtual page: the notes keep their size in Verovio units and the page shrinks around them. */
function a4Options(extra, zoom = S.zoom) {
  const z = zoom, r = v => Math.round(v / z);
  return { pageWidth: r(2100), pageHeight: r(2970), scale: 50, adjustPageHeight: false, breaks: S.layout === "orig" && S.hasLines ? "encoded" : "auto", header: "auto", footer: "none",
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
function render() { clearTimeout(renderTimer); renderTimer = setTimeout(doRender, 40); }
async function doRender() {
  if (!S.piece || S.view !== "score") return;
  if ($("#score").hidden) { renderTimer = setTimeout(doRender, 30); return; }
  await settle();                               // let the push animation finish before the heavy render
  await engineReady;
  stopPlayback();
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
    S.mode = mode; S.loadedKey = "view"; applyPageZoom(); renderPartStrip(); markRange();
    requestAnimationFrame(() => { drawLoop(); syncLoopUi(); });
    S.baseBpm = scoreBpm(); $("#tp-bpm").textContent = String(curBpm());
    if (openSheetId === "more") syncTempo();
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
  /* big notes across the screen while correcting (a finger must hit a line); the A4 page comes back after */
  if (on) {
    const moved = S.iv.d || S.iv.s || S.clef !== "keep" || S.readOct;
    S.editView = { iv: S.iv, clef: S.clef, preset: S.preset, page: S.page, zoom: S.zoom, readOct: S.readOct };
    S.iv = { d: 0, s: 0 }; S.clef = "keep"; S.preset = -1; S.readOct = 0; S.page = "screen"; S.zoom = Math.max(S.zoom, 1.5);
    S.loadedKey = null; render(); if (moved) hud("Poprawiasz nuty tak, jak są zapisane", 2500);
  }
  if (!on && S.editView) { Object.assign(S, S.editView); S.editView = null; S.loadedKey = null; changed(); }
  if (!on) S.editSel = null;
  $("#btn-edit").innerHTML = icon(on ? "check" : "pencil"); $("#btn-edit").setAttribute("aria-label", on ? "Gotowe" : "Popraw nuty");
  if (on && playState) stopPlayback(true);
  selectNote(S.editSel);
}
const LEN_PL = { whole: "cała nuta", half: "półnuta", quarter: "ćwierćnuta", eighth: "ósemka", "16th": "szesnastka" };
function edTab(name) {
  $$("#editbar [data-tab-ed]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tabEd === name)));
  $$("#editbar .ed-pane").forEach(p => (p.hidden = p.dataset.pane !== name));
  S.edTab = name;
}
function selectNote(sel) {
  S.editSel = sel; if (sel) S.editMode = true;
  const on = !!S.editMode;
  document.body.classList.toggle("editing", on); document.body.classList.toggle("editmode", on);
  $("#btn-edit").setAttribute("aria-pressed", String(on)); $("#btn-edit").innerHTML = icon(on ? "check" : "pencil");
  $("#editbar").hidden = !on;
  $$("#pages g.nsel").forEach(g => g.classList.remove("nsel"));
  $("#ed-undo").disabled = !(S.undo && S.undo.length);
  if (!S.edTab) edTab(sel ? "pitch" : "len");
  const at = sel ? xmlNoteAt(parseXml(S.piece.xml), sel) : null, n = at && at.n, isRest = !!(n && kid(n, "rest"));
  $$("#editbar .ed-pane:not([data-pane=len]) button").forEach(b => (b.disabled = !n || (isRest && !["rest", "delete", "left", "right"].includes(b.dataset.ed))));
  const cur = n ? (txt(n, "type") || "whole") : (S.inLen || "quarter");
  $$("#editbar [data-len]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.len === cur)));
  $("#ed-dot").setAttribute("aria-pressed", String(!!(n && kid(n, "dot"))));
  $("#ed-rest").innerHTML = icon(isRest ? "n-quarter" : "rest"); $("#ed-rest").setAttribute("aria-label", isRest ? "Zamień na nutę" : "Zamień na pauzę");
  if (!n) { $("#ed-info").innerHTML = `Wybierz długość <svg class="i"><use href="#n-${cur === "16th" ? "16th" : cur}"/></svg> i dotknij pięciolinii`; return; }
  const el = drawnNote(sel); if (el) el.classList.add("nsel");
  const p = kid(n, "pitch"), len = LEN_PL[txt(n, "type")] || "";
  if (p) {
    const midi = midiOf(p), oct = Math.floor(midi / 12) - 1;
    $("#ed-info").innerHTML = `<b>${NOTE_PL[((midi % 12) + 12) % 12]}</b> ${OCTAVE_NAMES[oct] || ""} · ${len}${kid(n, "dot") ? " z kropką" : ""} · takt ${sel.bar}`;
  } else $("#ed-info").innerHTML = `<b>Pauza</b> · ${len || "cały takt"} · takt ${sel.bar}`;
}
/* the sound of a note when it is placed or changed */
let previewCtx = null;
function previewNote(n) {
  const p = n && kid(n, "pitch"); if (!p) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext; previewCtx = previewCtx || new AC(); previewCtx.resume?.();
    const g = previewCtx.createGain(); g.gain.value = 0.16; g.connect(previewCtx.destination);
    const t = previewCtx.currentTime + 0.02; voiceForPart(S.editSel && S.editSel.pid)(previewCtx, g, 440 * Math.pow(2, (midiOf(p) - partTr(S.editSel && S.editSel.pid) - 69) / 12), t, t + 0.4);
  } catch {}
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
  kids(n, "dot").forEach(d => d.remove());
  fitBar(doc, at.part, at.m, n);
  /* writing in the last bar: there is always one empty bar ready after it */
  const ms = kids(at.part, "measure");
  if (at.m === ms[ms.length - 1]) [...doc.getElementsByTagName("part")].forEach(part => {
    const last = kids(part, "measure").pop(), nm = doc.createElement("measure"), rr = restNote(doc, barCap(part, last).cap, "", 1);
    kid(rr, "rest").setAttribute("measure", "yes"); nm.setAttribute("number", String(kids(part, "measure").length + 1)); nm.appendChild(rr); last.after(nm);
  });
  pushUndo(); S.piece.xml = new XMLSerializer().serializeToString(doc);
  previewNote(n); S.editSel = sel; afterEdit();
}
$$("#editbar [data-tab-ed]").forEach(b => b.addEventListener("click", () => edTab(b.dataset.tabEd)));
$$("#editbar [data-len]").forEach(b => b.addEventListener("click", () => { S.inLen = b.dataset.len; if (S.editSel) editNote("len:" + b.dataset.len); else selectNote(null); }));
/* divisions and the length of a full bar (in divisions) at a bar */
function barCap(part, m) {
  let div = 1, beats = 4, bt = 4;
  for (const mm of kids(part, "measure")) {
    kids(mm, "attributes").forEach(a => {
      const d = kid(a, "divisions"); if (d) div = parseFloat(d.textContent) || div;
      const t = kid(a, "time"); if (t) { beats = parseInt(txt(t, "beats"), 10) || beats; bt = parseInt(txt(t, "beat-type"), 10) || bt; }
    });
    if (mm === m) break;
  }
  return { div, cap: div * 4 * beats / bt };
}
const divisionsAt = (part, m) => barCap(part, m).div;
function restNote(doc, dur, type, voice) {
  const r = doc.createElement("note");
  r.innerHTML = `<rest/><duration>${dur}</duration><voice>${voice || 1}</voice>` + (type ? `<type>${type}</type>` : "");
  return r;
}
/* after a note gets shorter or longer the bar still adds up: the rests right after it are taken away
   and the gap is filled again, each rest starting on its beat (as printed music does); simple one-voice bars only */
function fitBar(doc, part, m, after) {
  if (kids(m, "backup").length) return;
  const { div, cap } = barCap(part, m), len = n => (kid(n, "chord") || kid(n, "grace")) ? 0 : (parseFloat(txt(n, "duration")) || 0);
  for (let nx = after.nextElementSibling; nx && !(nx.tagName === "note" && !kid(nx, "rest"));) {
    const next = nx.nextElementSibling; if (nx.tagName === "note" && !kid(nx, "chord")) nx.remove(); nx = next;
  }
  let total = kids(m, "note").reduce((a, n) => a + len(n), 0);
  for (let nx = after.nextElementSibling; total > cap + 1e-6 && nx;) {           // still too long: rests further on go
    const next = nx.nextElementSibling;
    if (nx.tagName === "note" && kid(nx, "rest") && !kid(nx, "chord")) { total -= len(nx); nx.remove(); }
    nx = next;
  }
  let pos = 0; for (const n of kids(m, "note")) { pos += len(n); if (n === after) break; }
  let gap = cap - total, at = after;
  /* rests show the beat (Gould): each starts where its own length divides the bar; in 6/8, 9/8, 12/8 a whole beat is
     a dotted quarter rest; in 4/4 a half rest only on beat 1 or 3 (the alignment rule gives that) */
  const t8 = (() => { let b = 4, t = 4; for (const mm of kids(part, "measure")) { kids(mm, "attributes").forEach(a => { const x = kid(a, "time"); if (x) { b = parseInt(txt(x, "beats"), 10) || b; t = parseInt(txt(x, "beat-type"), 10) || t; } }); if (mm === m) break; } return t === 8 && b % 3 === 0; })();
  const opts = [["whole", 4, false], ...(t8 ? [["half", 3, true], ["quarter", 1.5, true]] : []), ["half", 2, false], ["quarter", 1, false], ["eighth", 0.5, false], ["16th", 0.25, false]];
  while (gap > 1e-6) {
    const o = opts.find(([t, q]) => { const d = q * div; return d <= gap + 1e-6 && Math.abs(pos / d - Math.round(pos / d)) < 1e-6 && !(t8 && t === "quarter" && q === 1 && Math.abs(pos / (1.5 * div) - Math.round(pos / (1.5 * div))) < 1e-6 && gap >= 1.5 * div - 1e-6); });
    if (!o) break;
    const [t, q, dot] = o, d = q * div, r = restNote(doc, d, t, txt(after, "voice"));
    if (dot) kid(r, "type").after(doc.createElement("dot"));
    at.after(r); at = r; gap -= d; pos += d;
  }
}
function pushUndo() {
  S.undo = S.undo || []; S.undo.push(S.piece.xml); if (S.undo.length > 60) S.undo.shift();
  if (!S.piece.origXml) S.piece.origXml = S.undo[0];
}
function editNote(op) {
  if (op === "done") { setEditMode(false); return; }
  if (op.startsWith("len:") && !S.editSel) return;
  if (op === "bar") { openSheet("bar"); return; }
  if (op === "undo") { if (!S.undo || !S.undo.length) return; S.piece.xml = S.undo.pop(); refreshInfo(); afterEdit(); return; }
  const sel = S.editSel; if (!sel) return;
  const doc = parseXml(S.piece.xml), at = xmlNoteAt(doc, sel); if (!at || !at.n) return;
  const n = at.n, p = kid(n, "pitch"), fifths = keyAt(at.part, at.m);
  const dropAcc = () => kids(n, "accidental").forEach(a => a.remove());
  const setAlter = v => { if (!p) return; let al = kid(p, "alter"); if (v) { if (!al) { al = doc.createElement("alter"); p.insertBefore(al, kid(p, "octave")); } al.textContent = String(v); } else if (al) al.remove(); dropAcc(); };
  const move = d => { if (!p) return; const idx = parseInt(txt(p, "octave"), 10) * 7 + STEP_I[txt(p, "step")] + d, st = STEP_N[((idx % 7) + 7) % 7]; kid(p, "step").textContent = st; kid(p, "octave").textContent = String(Math.floor(idx / 7)); setAlter(keyAlter(fifths, st)); };
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
  if (op.startsWith("len:") || op === "dot") {
    const div = divisionsAt(at.part, at.m), r = kid(n, "rest"); if (r) r.removeAttribute("measure");
    const t = op === "dot" ? (txt(n, "type") || "quarter") : op.slice(4), dotted = op === "dot" ? !kid(n, "dot") : false;
    kids(n, "dot").forEach(d => d.remove());
    kid(n, "duration").textContent = String(ED_LEN[t] * div * (dotted ? 1.5 : 1));
    let ty = kid(n, "type"); if (!ty) { ty = doc.createElement("type"); kid(n, "voice") ? kid(n, "voice").after(ty) : kid(n, "duration").after(ty); }
    ty.textContent = t; if (dotted) ty.after(doc.createElement("dot"));
    fitBar(doc, at.part, at.m, n);
  } else if (op === "left" || op === "right") {
    /* the note changes places with its neighbour; at the bar line it goes into the next or previous bar */
    const sib = x => { let y = op === "left" ? x.previousElementSibling : x.nextElementSibling; while (y && (y.tagName !== "note" || kid(y, "chord"))) y = op === "left" ? y.previousElementSibling : y.nextElementSibling; return y; };
    let other = sib(n), bar = sel.bar;
    if (!other) {
      const ms = kids(at.part, "measure"), mi = ms.indexOf(at.m) + (op === "left" ? -1 : 1), nm = ms[mi]; if (!nm) return;
      const ns = kids(nm, "note").filter(x => !kid(x, "chord")); other = op === "left" ? ns[ns.length - 1] : ns[0]; if (!other) return; bar = mi + 1;
    }
    const ph = doc.createElement("x"); n.replaceWith(ph); other.replaceWith(n); ph.replaceWith(other);
    const i = kids(n.parentNode, "note").indexOf(n), di = bar === sel.bar ? sel.di : drawnBars(processedXml()).indexOf(bar) + (op === "left" ? 0 : 0);
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
      if (old) { old.remove(); [...at.m.getElementsByTagName("wedge")].filter(w => w.getAttribute("type") === "stop").forEach(w => w.closest("direction").remove()); }
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
    kid(n, "duration").textContent = String(ED_LEN[nt] * div);
    let ty = kid(n, "type"); if (!ty) { ty = doc.createElement("type"); kid(n, "voice") ? kid(n, "voice").after(ty) : kid(n, "duration").after(ty); }
    ty.textContent = nt;
    fitBar(doc, at.part, at.m, n);
  } else if (op === "rest") {
    if (p) { n.replaceChild(doc.createElement("rest"), p); dropAcc(); kids(n, "stem").forEach(s => s.remove()); kids(n, "beam").forEach(s => s.remove()); }
    else toNote();
  } else if (op === "add") {
    /* a rest becomes a note; a note gets a copy right after it (taking the place of the rests that follow) */
    if (kid(n, "rest")) toNote();
    else {
      const c = n.cloneNode(true); kids(c, "chord").forEach(x => x.remove()); n.after(c);
      fitBar(doc, at.part, at.m, c); S.editSel = { ...sel, i: sel.i + 1 };
    }
  } else if (op === "delete") {
    /* a note leaves a rest of the same length (the bar still adds up); a rest goes away */
    if (p) { n.replaceChild(doc.createElement("rest"), p); dropAcc(); kids(n, "stem").forEach(s => s.remove()); kids(n, "beam").forEach(s => s.remove()); }
    else if (kids(at.m, "note").length > 1) { n.remove(); S.editSel = null; }
  }
  pushUndo();
  S.piece.xml = new XMLSerializer().serializeToString(doc);
  if (["up", "down", "octup", "octdown", "flat", "sharp", "natural", "rest", "add"].includes(op)) previewNote(op === "add" ? n.nextElementSibling : n);
  afterEdit();
}
function keyAt(part, m) { let f = 0; for (const mm of kids(part, "measure")) { kids(mm, "attributes").forEach(a => { const k = kid(a, "key"); if (k) f = parseInt(txt(k, "fifths"), 10) || 0; }); if (mm === m) break; } return f; }
function clefAt(part, m) { let c = "G"; for (const mm of kids(part, "measure")) { kids(mm, "attributes").forEach(a => kids(a, "clef").forEach(x => c = clefId(x))); if (mm === m) break; } return CLEF_BOTTOM[c] != null ? c : "G"; }
function timeAt(part, m) { const { div, cap } = barCap(part, m); let t = null; for (const mm of kids(part, "measure")) { kids(mm, "attributes").forEach(a => { const x = kid(a, "time"); if (x) t = `${txt(x, "beats")}/${txt(x, "beat-type")}`; }); if (mm === m) break; } return t || (cap / div === 4 ? "4/4" : ""); }
/* key, clef and parts are read again after a change to the music itself */
function refreshInfo() {
  const info = analyseXml(S.piece.xml); S.srcKey = info.key;
  S.parts.forEach(p => { const q = info.parts.find(x => x.id === p.id); if (q) Object.assign(p, { clef: q.clef, staves: q.staves }); });
  const first = S.parts.find(p => p.keep) || S.parts[0]; if (first) S.srcClef = first.clef;
}
/* ---------------- the bar sheet: metre, clef, key signature, adding and removing bars, tempo ---------------- */
function barTarget() {
  if (S.editSel) return { bar: S.editSel.bar, pid: S.editSel.pid };
  const b = S.fromBar >= 0 ? drawnBars(processedXml())[S.fromBar] : null;
  const first = S.parts.find(p => p.keep && !(p.staves > 1)) || S.parts.find(p => p.keep);
  return { bar: b || 1, pid: first && first.id };
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
function buildBarSheet() {
  const { bar, pid } = barTarget(), doc = parseXml(S.piece.xml);
  const part = [...doc.getElementsByTagName("part")].find(p => p.getAttribute("id") === pid) || doc.getElementsByTagName("part")[0];
  const m = part && kids(part, "measure")[bar - 1]; if (!m) return;
  $("#sh-bar-t").textContent = `Takt ${bar}`;
  $("#bar-note").textContent = bar === 1 ? "Metrum, klucz i znaki zmieniają się w całym utworze." : `Metrum, klucz i znaki zmieniają się od taktu ${bar} do końca.`;
  const t = timeAt(part, m), c = clefAt(part, m), k = keyAt(part, m);
  $$("#bar-time button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === t)));
  $$("#bar-clef button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === c)));
  $("#bar-key").value = String(k);
  $("#bar-del").disabled = kids(part, "measure").length < 2;
  $("#bar-bpm").textContent = String(curBpm());
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
        const ns = kids(mm, "note"); const r = ns.length === 1 && kid(ns[0], "rest");
        if (r && r.getAttribute("measure") === "yes") kid(ns[0], "duration").textContent = String(barCap(part, mm).cap);
      });
    });
  } else if (op === "clef" || op === "key") {
    parts.filter(p => op === "key" || p.getAttribute("id") === pid).forEach(part => {
      const ms = kids(part, "measure"); if (!ms[bar - 1]) return;
      const oldClef = clefAt(part, ms[bar - 1]), shift = op === "clef" ? CLEF_BOTTOM[val] - CLEF_BOTTOM[oldClef] : 0;
      let oldKey = keyAt(part, ms[bar - 1]); const newKey = op === "key" ? +val : null;
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
      } else { const k = doc.createElement("key"); k.innerHTML = `<fifths>${val}</fifths>`; putAttr(a, k); }
    });
  } else if (op === "add" || op === "addbefore") {
    parts.forEach(part => {
      const m = kids(part, "measure")[bar - 1]; if (!m) return;
      const nm = doc.createElement("measure"), r = restNote(doc, barCap(part, m).cap, "", 1);
      kid(r, "rest").setAttribute("measure", "yes"); nm.appendChild(r);
      if (op === "add") m.after(nm);
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
  hud({ time: `Metrum ${val}`, clef: "Zmieniono klucz", key: "Zmieniono znaki przy kluczu", add: "Dodano takt", addbefore: "Dodano takt", del: "Usunięto takt" }[op], 1600);
  if (op === "del" || op === "add" || op === "addbefore") closeSheet(); else buildBarSheet();
}
$$("#bar-time button").forEach(b => b.addEventListener("click", () => barOp("time", b.dataset.v)));
$$("#bar-clef button").forEach(b => b.addEventListener("click", () => barOp("clef", b.dataset.v)));
$("#bar-key").addEventListener("change", e => barOp("key", e.target.value));
$("#bar-add").addEventListener("click", () => barOp("add"));
$("#bar-addbefore").addEventListener("click", () => barOp("addbefore"));
$("#bar-del").addEventListener("click", () => barOp("del"));
[["#bar-bpm-down", -4], ["#bar-bpm-up", 4]].forEach(([s, d]) => $(s).addEventListener("click", () => { setBpm(curBpm() + d); $("#bar-bpm").textContent = String(curBpm()); }));
$("#btn-edit").addEventListener("click", () => setEditMode(!S.editMode));
function afterEdit() {
  /* the rhythm check follows the edit: fixed bars lose their red, broken ones get it */
  const other = (S.piece.issues || []).filter(t => !/wartości rytmicznych/.test(t));
  S.piece.issues = [...barIssues(S.piece.xml), ...other].sort((a, b) => parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10));
  S.keepSel = S.editSel; changed();
  $("#ed-undo").disabled = !(S.undo && S.undo.length);
  $("#btn-restore").hidden = !S.piece.origXml;
  const nums = doubtfulBars(S.piece.issues);
  if (!$("#notice").hidden || nums.length) { $("#notice").hidden = !nums.length; if (nums.length) { $("#notice-title").textContent = `${nums.length} ${plural(nums.length, "takt", "takty", "taktów")} do sprawdzenia`; $("#notice-text").textContent = `Zaznaczone na fioletowo: ${nums.slice(0, 8).join(", ")}${nums.length > 8 ? " i inne" : ""}. Porównaj je ze zdjęciem.`; } }
}
$$("#editbar [data-ed]").forEach(b => b.addEventListener("click", () => editNote(b.dataset.ed)));
$("#btn-restore").addEventListener("click", () => {
  if (!S.piece.origXml) return;
  S.undo = []; S.piece.xml = S.piece.origXml; delete S.piece.origXml; S.editSel = null; selectNote(null);
  S.piece.issues = barIssues(S.piece.xml); afterEdit(); closeSheet(); hud("Przywrócono odczyt");
});

/* tap a note: correct it; tap a bar elsewhere: it is selected and ▶ plays from there; tap again (or outside the bars) to clear */
/* outside correcting, a tap never edits: it picks where to play from, or moves the loop (also while playing) */
$("#pages").addEventListener("click", e => {
  if (!S.piece) return;
  if (S.editMode) { editTap(e); return; }
  const m = e.target.closest("g.measure") || measureAt(e.clientX, e.clientY);
  if (!m) { if (S.fromMs) clearFromBar(); else if (e.target.closest(".page") && !playState) document.body.classList.toggle("immersive"); return; }
  const di = measureEls().indexOf(m);
  if (pb.pick || pb.loop) { setLoopBar(di); return; }
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
async function makeThumb() {
  await engineReady;
  tk.setOptions(a4Options({}, 1));
  tk.loadData(processedXml());
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
   iPhone/iPad silent switch on, through Bluetooth speakers, and after the screen locks.
   The element is "unlocked" inside the tap itself, so the later play() is allowed everywhere. */
const player = new Audio(); player.preload = "auto"; player.setAttribute("playsinline", "");
const SILENCE = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
function unlockAudio() {
  try { if (navigator.audioSession && !tuner.on && !(typeof of !== "undefined" && of.stream)) navigator.audioSession.type = "playback"; } catch {}
  if (!player.src || player.src === SILENCE || player.paused) {
    try { player.src = SILENCE; const pr = player.play(); if (pr) pr.catch(() => {}); } catch {}
  }
}
/* ---------------- 3.8 player (benchmark: Soundslice, MuseScore 4, Songsterr, Tomplay, Flat, SmartMusic) ----------------
   The cursor follows the sound itself (the audio clock, so it never drifts): a soft highlight on the bar and a thin
   line gliding through it. The page moves one line of music at a time, keeping the playing line in the upper third.
   Pause keeps the place; a one-bar count-in and the metronome click are rendered into the same sound; a loop of
   bars repeats with the count-in each time and can be changed at any moment, also while playing. */
let playState = null, playToken = 0;
const pb = { click: store.get("click", "count"), loop: null, pick: false, mute: new Set(), follow: true, resumeMs: 0 };
function setPlayUi(on) {
  const b = $("#btn-play"); b.classList.toggle("on", on);
  b.innerHTML = icon(on ? "pause" : "play");
  b.setAttribute("aria-label", on ? "Pauza" : "Posłuchaj"); b.title = on ? "Pauza" : "Posłuchaj";
  document.body.classList.toggle("playing", on);
  $("#tp-bpm").textContent = String(curBpm());
}
function stopPlayback(keepPlace) {
  playToken++;
  if (!playState) return;
  if (keepPlace) pb.resumeMs = playPos();
  try { (playState.src || player).pause(); } catch {}
  try { player.loop = false; } catch {}
  cancelAnimationFrame(playState.raf);
  const url = playState.url; if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
  $$("#pages g.playing").forEach(g => g.classList.remove("playing"));
  $$("#pages .playline, #pages .barlight").forEach(x => x.remove());
  $("#follow-pill").hidden = true; $("#tp-bar").textContent = ""; $("#tp-fill").style.width = "0";
  playState = null; setPlayUi(false);
  if (!tuner.on && !metro.on) { try { wakeLock?.release(); } catch {} wakeLock = null; }
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
function wavBlob(buf) {
  const ch = buf.getChannelData(0), n = ch.length, sr = buf.sampleRate;
  let peak = 0; for (let i = 0; i < n; i++) { const v = Math.abs(ch[i]); if (v > peak) peak = v; }
  const gain = peak > 0 ? 0.89 / peak : 1;
  const out = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); out.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt ");
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, sr, true);
  out.setUint32(28, sr * 2, true); out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, "data"); out.setUint32(40, n * 2, true);
  for (let i = 0, o = 44; i < n; i++, o += 2) out.setInt16(o, Math.max(-32767, Math.min(32767, Math.round(ch[i] * gain * 32767))), true);
  return { blob: new Blob([out.buffer], { type: "audio/wav" }), peak };
}
const LEAD = 0.06;            // seconds of silence at the start of each rendered file
const measureEls = () => [...$$("#pages g.measure")];
/* the beats a metronome gives in each drawn bar (6/8 → 2, 9/8 → 3, 12/8 → 4, 3/8 → 1) */
function beatsPerBar() {
  const xml = processedXml(), doc = parseXml(xml), part = doc.getElementsByTagName("part")[0]; if (!part) return [];
  let b = 4, bt = 4; const byBar = kids(part, "measure").map(m => {
    kids(m, "attributes").forEach(a => { const t = kid(a, "time"); if (t) { b = parseInt(txt(t, "beats"), 10) || b; bt = parseInt(txt(t, "beat-type"), 10) || bt; } });
    return bt === 8 && b % 3 === 0 ? b / 3 : b;
  });
  return drawnBars(xml).map(n => byBar[n - 1] || 4);
}
/* which part a drawn note belongs to (for "Co słychać") */
function partOfEl(el) {
  const m = el && el.closest("g.measure"), st = el && el.closest("g.staff"); if (!m || !st) return null;
  const slot = staffSlots()[staffsOf(m).indexOf(st)]; return slot ? slot.pid : null;
}
async function play(fromMs) {
  if (playState) stopPlayback();
  if (!S.piece) return;
  const token = ++playToken;
  await engineReady;
  if (S.loadedKey !== "view") await doRender();
  if (token !== playToken) return;
  let tm;
  try { tm = tk.renderToTimemap({ includeMeasures: true, includeRests: false }); } catch { hud("Nie da się odtworzyć tych nut"); return; }
  const bars = []; tm.forEach(e => { if (e.measureOn) bars.push(e.tstamp); });
  const nBars = measureEls().length;
  if (pb.loop) { pb.loop.a = Math.min(pb.loop.a, nBars - 1); pb.loop.b = Math.min(pb.loop.b, nBars - 1); }
  const A = pb.loop ? bars[pb.loop.a] ?? 0 : 0, B = pb.loop ? (bars[pb.loop.b + 1] ?? Infinity) : Infinity;
  fromMs = pb.loop ? A : Math.max(0, fromMs || 0);
  const k = (S.baseBpm || 120) / curBpm(), ev = [];
  tm.forEach(e => (e.on || []).forEach(id => {
    try {
      const v = tk.getMIDIValuesForElement(id); if (!v || !(v.pitch > 0)) return;
      if (e.tstamp >= B) return;
      const end = Math.min(e.tstamp + v.duration, B); if (end <= fromMs + 20) return;
      const start = Math.max(e.tstamp, fromMs);      // resuming mid-note: the note keeps sounding
      const el = document.getElementById(id);
      const pid = partOfEl(el);
      ev.push({ id, el, pid, t: (start - fromMs) / 1000 * k, dur: Math.max(0.08, (end - start) / 1000 * k), pitch: v.pitch - partTr(pid), silent: pb.mute.size && pb.mute.has(pid) });
    } catch {}
  }));
  if (!ev.length) { hud("Brak nut do odtworzenia"); return; }
  ev.sort((a, b) => a.t - b.t);
  if (S.swing) {         /* T29: eighths in pairs play long-short (about 2:1) */
    const beat = 60 / curBpm(), half = beat / 2, eps = beat * 0.05, third = beat / 6;
    ev.forEach(e => { const pos = ((e.t % beat) + beat) % beat; if (e.dur <= half * 1.1) { if (Math.abs(pos - half) < eps) { e.t += third; e.dur -= third; } else if (pos < eps || beat - pos < eps) e.dur += third; } });
  }
  /* bars in this range, with their beats, for the count-in and the click */
  const bpb = beatsPerBar(), first = Math.max(0, bars.findIndex((t, i) => t <= fromMs + 1 && (bars[i + 1] ?? Infinity) > fromMs + 1));
  const barSec = i => (((bars[i + 1] ?? (bars[i] + (bars[i] - (bars[i - 1] ?? bars[i] - 2000)))) - bars[i]) / 1000) * k;
  const clicks = [], useClick = pb.click !== "off";
  const countLen = useClick ? barSec(first) : 0;
  if (useClick) { const n = bpb[first] || 4; for (let j = 0; j < n; j++) clicks.push({ t: j * countLen / n, acc: j === 0 }); }
  const rangeLen = Number.isFinite(B) ? (B - fromMs) / 1000 * k : Math.max(...ev.map(e => e.t + e.dur));
  if (pb.click === "all") for (let i = first; i < bars.length && bars[i] < (Number.isFinite(B) ? B : Infinity); i++) {
    const n = bpb[i] || 4, t0 = (bars[i] - fromMs) / 1000 * k, len = barSec(i);
    for (let j = 0; j < n; j++) { const t = t0 + j * len / n; if (t >= -0.01 && t < rangeLen - 0.01) clicks.push({ t: countLen + t, acc: j === 0 }); }
  }
  ev.forEach(e => { e.t += countLen; });
  const total = countLen + rangeLen, fileLen = pb.loop ? total : total + 0.5;
  setPlayUi(true);
  let url;
  try {
    const sr = 44100, Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new Off(1, Math.ceil((fileLen + LEAD) * sr), sr);
    const bus = off.createGain(); bus.gain.value = 0.18; bus.connect(off.destination);
    const voices = {};          // every part sounds like its own instrument (its recording, or its timbre)
    ev.forEach(e => { if (!e.silent) (voices[e.pid] = voices[e.pid] || voiceForPart(e.pid))(off, bus, 440 * Math.pow(2, (e.pitch - 69) / 12), LEAD + e.t, LEAD + e.t + e.dur * 0.95); });
    clicks.forEach(c => clickNote(off, bus, LEAD + c.t, c.acc));
    const buf = await off.startRendering();
    /* private windows add noise to rendered audio against fingerprinting: then the notes are played live */
    const ch = buf.getChannelData(0); let lead = 0;
    for (let i = 0, n = Math.floor(LEAD * sr * 0.8); i < n; i++) lead = Math.max(lead, Math.abs(ch[i]));
    if (lead > 1e-4) { if (token === playToken) playLive(ev, clicks, total, token, k, fromMs, countLen); return; }
    url = URL.createObjectURL(wavBlob(buf).blob);
  } catch (e) { console.warn(e); if (token === playToken) { setPlayUi(false); hud("Nie udało się przygotować dźwięku"); } return; }
  if (token !== playToken) { URL.revokeObjectURL(url); return; }      // stopped while it was being prepared
  player.src = url; player.loop = !!pb.loop;
  try { await player.play(); }
  catch (e) {
    URL.revokeObjectURL(url); setPlayUi(false);
    hud(e && e.name === "NotAllowedError" ? "Dotknij jeszcze raz, żeby posłuchać" : "Nie udało się odtworzyć dźwięku", 3000);
    return;
  }
  if (token !== playToken) { player.pause(); URL.revokeObjectURL(url); return; }
  playState = { raf: 0, k, fromMs, url, src: player, ev, countLen, total, loopLen: pb.loop ? total + LEAD : 0, clock: { a: -1, at: 0 } };
  setPlayUi(true); keepAwake(); follow(token);
}
async function keepAwake() { try { wakeLock = wakeLock || await navigator.wakeLock?.request("screen"); } catch {} }
/* live playback through Web Audio: used when rendered audio comes back noisy (no seamless loop there: it restarts) */
async function playLive(ev, clicks, total, token, k, fromMs, countLen) {
  const AC = window.AudioContext || window.webkitAudioContext; const ctx = new AC();
  try { await ctx.resume(); } catch {}
  const bus = ctx.createGain(); bus.gain.value = 0.18; bus.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.12, voices = {};
  ev.forEach(e => { if (!e.silent) (voices[e.pid] = voices[e.pid] || voiceForPart(e.pid))(ctx, bus, 440 * Math.pow(2, (e.pitch - 69) / 12), t0 + LEAD + e.t, t0 + LEAD + e.t + e.dur * 0.95); });
  clicks.forEach(c => clickNote(ctx, bus, t0 + LEAD + c.t, c.acc));
  const src = { get currentTime() { return ctx.currentTime - t0; }, get ended() { return ctx.currentTime - t0 > total + LEAD + 0.3; }, get paused() { return false; }, pause() { try { ctx.close(); } catch {} } };
  if (token !== playToken) { src.pause(); return; }
  playState = { raf: 0, k, fromMs, url: null, src, ev, countLen, total, loopLen: 0, live: true, clock: { a: -1, at: 0 } };
  setPlayUi(true); keepAwake(); follow(token);
}
/* the audio element's clock moves in steps on some phones: between steps it is carried on by the frame clock */
function audioNow(ps) {
  const a = ps.src.currentTime, now = performance.now(), c = ps.clock;
  if (a !== c.a) { c.a = a; c.at = now; return a; }
  if (ps.src.paused) return a;
  let t = a + (now - c.at) / 1000; if (ps.loopLen && t >= ps.loopLen) t -= ps.loopLen; return t;
}
/* where playback is now, in score milliseconds (independent of tempo) */
function rangeTime(ps) { return audioNow(ps) - LEAD - ps.countLen; }
const playPos = () => playState ? playState.fromMs + Math.max(0, rangeTime(playState)) * 1000 / playState.k : 0;
/* positions of everything the cursor needs, relative to #pages (they don't change while scrolling) */
function cursorMap(ev) {
  const pg = $("#pages"), pr = pg.getBoundingClientRect(), rel = r => ({ x: r.left - pr.left, y: r.top - pr.top, w: r.width, h: r.height });
  const ons = []; let last = null;
  ev.forEach(e => {
    if (!e.el) return;
    if (last && Math.abs(e.t - last.t) < 0.005) { last.els.push(e.el); return; }
    const m = e.el.closest("g.measure"), sys = e.el.closest("g.system") || m; if (!m) return;
    /* the height comes from the staff lines only (notes above or below the staff would make it jump) */
    const staffs = staffsOf(m), lines = st => { const ls = [...(st || m).children].filter(c => c.tagName === "path").slice(0, 5).map(l => l.getBoundingClientRect()); return ls.length ? { t: Math.min(...ls.map(r => r.top)) - pr.top, b: Math.max(...ls.map(r => r.bottom)) - pr.top } : (r => ({ t: r.y, b: r.y + r.h }))(rel((st || m).getBoundingClientRect())); };
    const a = lines(staffs[0]), z = lines(staffs[staffs.length - 1]), gap = (a.b - a.t) / 4 || 8, mr = rel(m.getBoundingClientRect()), nr = rel(e.el.getBoundingClientRect());
    last = { t: e.t, els: [e.el], x: nr.x + nr.w / 2, m, sys, top: a.t - gap * 1.5, h: z.b - a.t + gap * 3, mx: mr.x, mw: mr.w, mi: measureEls().indexOf(m) };
    ons.push(last);
  });
  return ons;
}
function follow(token) {
  const ps = playState, sc = $("#scroller"), pg = $("#pages"), nBars = measureEls().length;
  let ons = cursorMap(ps.ev), mapW = pg.offsetWidth;
  if (!ons.length) return;
  const line = document.createElement("div"); line.className = "playline"; pg.appendChild(line);
  const light = document.createElement("div"); light.className = "barlight"; pg.appendChild(light);
  let cur = -1, lastSys = null, lit = [];
  const step = () => {
    if (!playState || token !== playToken) return;
    if (pg.offsetWidth !== mapW) { ons = cursorMap(ps.ev); mapW = pg.offsetWidth; cur = -1; lastSys = null; }     // zoomed: measure again
    let T = rangeTime(ps) + ps.countLen;                         // time in the file (count-in included)
    if (T < ps.countLen) {                                       // counting in: the first bar waits, lit
      const o = ons[0]; light.style.cssText = `width:${o.mw}px;height:${o.h}px;transform:translate(${o.mx}px,${o.top}px);opacity:.6`;
      line.style.opacity = "0"; $("#tp-bar").textContent = "…"; ps.raf = requestAnimationFrame(step); return;
    }
    line.style.opacity = "1";
    let i = cur < 0 || ons[cur].t > T ? 0 : cur; while (i + 1 < ons.length && ons[i + 1].t <= T) i++;
    const o = ons[i], nx = ons[i + 1];
    if (i !== cur) {
      lit.forEach(el => el.classList.remove("playing")); lit = o.els; lit.forEach(el => el.classList.add("playing")); cur = i;
      light.style.cssText = `width:${o.mw}px;height:${o.h}px;transform:translate(${o.mx}px,${o.top}px)`;
      $("#tp-bar").textContent = `${o.mi + 1} / ${nBars}`;
      if (o.sys !== lastSys) { lastSys = o.sys; if (pb.follow) scrollToLine(o); }
    }
    /* the line glides to the next note on the same line, or to the end of the bar */
    const end = nx && nx.sys === o.sys ? nx : null, span = (end ? end.t : o.t + 0.5) - o.t, f = Math.max(0, Math.min(1, (T - o.t) / (span || 1)));
    const x = o.x + ((end ? end.x : o.mx + o.mw - 4) - o.x) * (end ? f : Math.min(f, 0.6));
    line.style.height = o.h + "px"; line.style.transform = `translate(${x.toFixed(1)}px,${o.top}px)`;
    $("#tp-fill").style.width = Math.min(100, (T / ps.total) * 100).toFixed(2) + "%";
    if (!ps.loopLen && (ps.src.ended || T > ps.total + 0.3)) {
      if (ps.live && pb.loop) { play(); return; }
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
  if (pb.loop || pb.pick) { pb.loop = null; pb.pick = false; drawLoop(); syncLoopUi(); if (playState) play(playPos()); return; }
  const n = measureEls().length; if (!n) return;
  let a = S.fromBar >= 0 ? S.fromBar : 0;
  if (playState) { const cur = parseInt($("#tp-bar").textContent, 10); if (cur > 0) a = cur - 1; }
  pb.loop = { a: Math.min(a, n - 1), b: Math.min(n - 1, a + 3) }; drawLoop(); syncLoopUi();
  if (playState) play();
});
/* loop slider: two big handles that snap to bars (Flat, Tomplay); the band on the music follows at once */
(() => {
  const track = $("#lb-track"); let drag = null;
  const valAt = x => { const r = track.getBoundingClientRect(), n = measureEls().length; return Math.max(0, Math.min(n - 1, Math.round((x - r.left - 22) / Math.max(1, r.width - 44) * (n - 1)))); };
  ["lb-a", "lb-b"].forEach(id => $("#" + id).addEventListener("pointerdown", e => { drag = id; e.target.setPointerCapture?.(e.pointerId); e.preventDefault(); }));
  track.addEventListener("pointerdown", e => { if (e.target.closest(".lb-th") || !pb.loop) return; const v = valAt(e.clientX); drag = Math.abs(v - pb.loop.a) <= Math.abs(v - pb.loop.b) ? "lb-a" : "lb-b"; move(e); });
  const move = e => {
    if (!drag || !pb.loop) return; const v = valAt(e.clientX), L = pb.loop;
    if (drag === "lb-a") L.a = Math.min(v, L.b); else L.b = Math.max(v, L.a);
    drawLoop(); syncLoopUi(); navigator.vibrate?.(4);
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
/* the loop: tap the first and the last bar; afterwards a tap moves the nearer end (also while playing) */
function setLoopBar(di) {
  if (pb.pick === "first") { pb.loop = { a: di, b: di }; pb.pick = "last"; hud("Teraz ostatni takt", 2500); }
  else if (pb.pick === "last") { pb.loop = { a: Math.min(pb.loop.a, di), b: Math.max(pb.loop.a, di) }; pb.pick = false; }
  else { const L = pb.loop; if (di < L.a) L.a = di; else if (di > L.b) L.b = di; else if (di - L.a <= L.b - di) L.a = di; else L.b = di; }
  drawLoop(); syncLoopUi();
  if (playState && !pb.pick) play();
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
  $("#btn-loop").setAttribute("aria-pressed", String(!!(pb.loop || pb.pick)));
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
  if (pb.loop) { pb.loop = null; pb.pick = false; drawLoop(); syncLoopUi(); if (playState) play(playPos()); }
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
document.addEventListener("visibilitychange", () => { if (document.hidden) stopPlayback(true); });

/* ---------------- Print & export ---------------- */
async function printScore() {
  await engineReady; stopPlayback();
  tk.setOptions(a4Options());
  tk.loadData(processedXml());
  let html = "";
  for (let i = 1; i <= tk.getPageCount(); i++) html += `<div class="pg">${tk.renderToSVG(i)}</div>`;
  const pa = $("#print-area"); pa.innerHTML = html;
  const first = pa.querySelector("svg"); if (first) enlargeTitle(first, 1.9);
  S.loadedKey = null;
  setTimeout(() => window.print(), 80);
}
window.addEventListener("afterprint", () => { $("#print-area").innerHTML = ""; if (S.view === "score") render(); });
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
    S.parts.map(p => `<button class="ichip" data-p="${p.id}" aria-pressed="${exportParts.includes(p.id)}">${esc(partName(p.id))}</button>`).join("");
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
  try { xml = transposeXmlString(processedXml(), S.iv); } catch { xml = S.piece.xml; }
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
      S.clef = v; S.readOct = f.oct; S.clefMine = true;
      if (S.clef === "bass" || S.clef === "tenor") maybeTrombone();
      $("#clef-hint").textContent = f.oct < oct ? "Oktawę niżej: nuty mieszczą się na pięciolinii." : f.oct > oct ? "Oktawę wyżej: nuty mieszczą się na pięciolinii." : "";
      buildClefSheet(); changed();
    });
    L.appendChild(b);
  });
}

/* ---------------- Key sheet ---------------- */
const PRESETS = [
  { t: "Trąbka, klarnet", s: "w B", iv: { d: -8, s: -14 } },
  { t: "Waltornia", s: "w F", iv: { d: -4, s: -7 } },
  { t: "Saksofon altowy", s: "w Es", iv: { d: -12, s: -21 } },
  { t: "Skrzypce, flet", s: "oktawę niżej", iv: { d: -7, s: -12 } },
  { t: "Puzon, eufonium, baryton", s: "w B, klucz wiolinowy", iv: { d: -8, s: -14 } }
];
/* indexes are stored with each piece, so new presets are appended and only the display order changes */
const PRESET_ORDER = [4, 0, 1, 2, 3];
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
    const p = idx < 0 ? { t: "Nie" } : PRESETS[idx];
    const b = document.createElement("button"); b.className = "li tap"; b.dataset.p = idx;
    b.innerHTML = `<span class="radio"></span><span class="grow">${esc(p.t)}${p.s ? `<small>${esc(p.s)}</small>` : ""}</span>`;
    b.addEventListener("click", () => {
      if (idx < 0) { if (S.preset >= 0) S.iv = { d: 0, s: 0 }; S.preset = -1; }
      else { S.iv = fixEnharmonic(PRESETS[idx].iv, S.srcKey.fifths); S.clef = "bass"; S.preset = idx; maybeTrombone(); }
      ensureOnStaff();
      changed();
    });
    PL.appendChild(b);
  });
  const solo = S.parts.find(p => p.keep) || S.parts[0];
  const inB = solo && (solo.transp === -2 || /\b(in|w)\s*(Bb|B♭|B)(?![a-z])/i.test(solo.name) || /tr[aą]bk|trumpet|klarnet|clarinet/i.test(solo.name));
  $("#preset-hint").hidden = !inB;
  $("#preset-hint").textContent = `Nuty na „${solo ? solo.name : ""}”? Wybierz „Trąbka, klarnet”.`;
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
/* T25 sheet */
const voice = { i: 3, l: 1 };
const VOICE_DESC = { 1: "Łatwy: drugi głos idzie równolegle, zawsze ten sam odstęp. Dobry dla dzieci.", 2: "Średni: gdy melodia skacze, drugi głos często zostaje na miejscu. Mniej ruchu, łatwiej grać.", 3: "Zaawansowany: drugi głos wybiera tercję albo sekstę tak, żeby poruszać się jak najmniej. Płynna, samodzielna linia." };
function buildVoiceSheet() {
  $$("#v-int button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.i === voice.i)));
  $$("#v-lev button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.l === voice.l)));
  $("#v-int").hidden = voice.l === 3; $("#v-desc").textContent = VOICE_DESC[voice.l];
}
$$("#v-int button").forEach(b => b.addEventListener("click", () => { voice.i = +b.dataset.i; buildVoiceSheet(); }));
$$("#v-lev button").forEach(b => b.addEventListener("click", () => { voice.l = +b.dataset.l; buildVoiceSheet(); }));
$("#v-go").addEventListener("click", () => {
  const first = S.parts.find(p => p.keep); if (!first) return;
  const xml = secondVoiceXml(S.piece.xml, first.id, { interval: voice.i, level: voice.l });
  const settings = recordFromState().settings; S.piece.xml = xml; S.piece.origXml = S.piece.origXml || null;
  loadState(S.piece, { ...settings, keep: [...settings.keep, ...analyseXml(xml).parts.map(p => p.id).filter(id => !settings.keep.includes(id)).slice(-1)] });
  closeSheetThen(() => { changed(); hud("Dodano drugi głos. Odtwarzanie gra oba.", 3000); });
});
/* T27 sheet */
function buildPartForSheet() {
  const L = $("#partfor-list"); L.innerHTML = "";
  [0, 1, 2, 3].forEach(idx => {
    const p = PRESETS[idx], b = document.createElement("button"); b.className = "li tap";
    b.innerHTML = `<span class="grow"><b>${esc(p.t)}</b><small>${esc(p.s)}</small></span><svg class="i chev"><use href="#right"/></svg>`;
    b.addEventListener("click", async () => {
      const name = p.t.split(",")[0];
      const xml = partForInstrument(processedXml(), p.iv, S.srcKey.fifths);
      const piece = { xml, sourceType: "file", title: `${S.piece.title || "Nuty"} (${name})`, composer: S.piece.composer || "", instrument: name };
      closeSheetThen(() => { openPiece(piece); S.dirty = true; savePiece(); hud(`Gotowe: partia dla ${name.toLowerCase()}`, 3000); });
    });
    L.appendChild(b);
  });
}
function buildMoreSheet() {
  syncLayout(); syncArrange();
  $("#btn-restore").hidden = !(S.piece && S.piece.origXml);
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
$("#btn-report").addEventListener("click", async () => {
  const p = S.piece || {}, nums = doubtfulBars(p.issues);
  const text = [`Solo ${VERSION}${BUILD ? " · test " + BUILD : ""}: problem z utworem „${p.title || "Bez tytułu"}”.`,
    `Tonacja: ${curKeyName()}; klucz: ${CLEF_PL[curClef()] || ""}; ${cap(intervalPl(S.iv)) || "bez transpozycji"}; wielkość ${Math.round(S.zoom * 100)}%.`,
    nums.length ? `Takty do sprawdzenia: ${nums.join(", ")}.` : "", "Co jest nie tak:", ""].filter(Boolean).join("\n");
  const data = { title: "Solo: zgłoszenie", text };
  try {
    /* the original photo goes along only if the system share sheet can carry files; the person picks the app */
    if (p.images && p.images[0] && navigator.canShare) {
      const blob = dataUrlToBlob(p.images[0]), file = new File([blob], "oryginal.jpg", { type: "image/jpeg" });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ ...data, files: [file] }); return; }
    }
    if (navigator.share) { await navigator.share(data); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  location.href = "mailto:nniewinskame@gmail.com?subject=" + encodeURIComponent("Solo: zgłoszenie") + "&body=" + encodeURIComponent(text);
});
let delTarget = null;
function askDelete(p, fromLibrary) {
  delTarget = { id: p.id, fromLibrary };
  $("#confirm-t").textContent = `Usunąć „${p.title || "Bez tytułu"}”?`;
  $("#confirm-text").textContent = "Nuty i zdjęcie znikną z tego urządzenia.";
  openSheet("confirm");
}
$("#btn-delete").addEventListener("click", () => askDelete(S.piece, false));
$("#confirm-yes").addEventListener("click", async () => {
  const t = delTarget || { id: S.piece && S.piece.id }; delTarget = null;
  if (!t.id) { closeSheet(); return; }
  await DB.del(t.id);
  if (t.fromLibrary) { closeSheetThen(() => { hud("Usunięto"); refreshLibrary(); }); return; }
  S.piece = null; closeSheetThen(() => { hud("Usunięto"); go("home"); });
});
/* a long press on a piece in the library: open, send, rename, delete */
let cardPiece = null, cardEl = null;
function openCardSheet(p, el) { cardPiece = p; cardEl = el; $("#sh-card-t").textContent = p.title || "Bez tytułu"; openSheet("card"); }
$("#cd-open").addEventListener("click", () => { const p = cardPiece; closeSheetThen(() => openPiece(p, p.settings)); });
$("#cd-send").addEventListener("click", () => { const p = cardPiece; closeSheetThen(() => { openPiece(p, p.settings); whenDrawn(() => openSheet("share")); }); });
$("#cd-rename").addEventListener("click", () => { const el = cardEl, p = cardPiece; closeSheetThen(() => { const t = el && el.querySelector(".t"); if (t) inlineEdit(t, { value: p.title || "", placeholder: "Tytuł", onSave: v => renameInLibrary(p, "title", v) }); }); });
$("#cd-del").addEventListener("click", () => { const p = cardPiece; closeSheetThen(() => askDelete(p, true)); });

/* ---------------- Original photo ---------------- */
function buildOrigSheet() {
  $("#orig-imgs").innerHTML = (S.piece.images || []).map((src, i) => `<img src="${esc(src)}" alt="Oryginał, strona ${i + 1}">`).join("");
}
/* ---------------- New music: files, photos, reading ---------------- */
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
      if (!path) throw new Error("W tym pliku nie ma nut.");
      xml = await zip.file(path).async("string");
    } else xml = await f.text();
    openPiece({ xml, sourceType: "file", title: "", composer: null });
  } catch (err) { console.error(err); hud(err.message || "Nie udało się otworzyć pliku.", 4000); }
}
async function addPages(files) {
  $("#read-error").hidden = true;
  for (const f of files) {
    if (pending.length >= MAX_PAGES) { hud(`Najwyżej ${MAX_PAGES} stron naraz`); break; }
    try {
      if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js";
        const pdf = await pdfjsLib.getDocument({ data: await f.arrayBuffer(), isEvalSupported: false }).promise;
        const pick = pdf.numPages > 1 ? await pickPdfPages(pdf) : [1];
        for (const i of pick) {
          if (pending.length >= MAX_PAGES) { hud(`Najwyżej ${MAX_PAGES} stron naraz`); break; }
          pending.push(await renderPdfPage(pdf, i));
        }
      } else if (f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(f.name)) {
        const url = URL.createObjectURL(f);
        try {
          const img = await loadImage(url).catch(() => { throw new Error("Tego formatu zdjęcia nie da się otworzyć. Zrób zrzut ekranu albo zapisz zdjęcie jako JPG."); });
          pending.push({ big: canvasToJpeg(img, 2400, 0.9), keep: canvasToJpeg(img, 1600, 0.82) });
        } finally { URL.revokeObjectURL(url); }
      } else throw new Error("Solo otwiera zdjęcia, PDF i pliki MusicXML.");
    } catch (e) { console.error(e); hud(e.message || "Nie udało się otworzyć pliku.", 4000); }
  }
  drawPending();
}
async function renderPdfPage(pdf, i, edge = 2400) {
  const page = await pdf.getPage(i), vp0 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: edge / Math.max(vp0.width, vp0.height) });
  const c = document.createElement("canvas"); c.width = vp.width; c.height = vp.height;
  const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: g, viewport: vp }).promise;
  return edge < 1000 ? c.toDataURL("image/jpeg", .7) : { big: canvasToJpeg(c, 2400, 0.9), keep: canvasToJpeg(c, 1600, 0.82) };
}
/* a PDF with several pages: show them all small and let the user tick the ones to read (T13) */
function pickPdfPages(pdf) {
  return new Promise(resolve => {
    const box = $("#pdf-pages"), chosen = new Set();
    box.innerHTML = ""; $("#pdf-count").textContent = `${pdf.numPages} ${plural(pdf.numPages, "strona", "strony", "stron")}`;
    const sync = () => { $("#pdf-add").disabled = !chosen.size; $("#pdf-add span").textContent = chosen.size ? `Dodaj ${chosen.size} ${plural(chosen.size, "stronę", "strony", "stron")}` : "Wybierz strony"; };
    for (let i = 1; i <= pdf.numPages; i++) {
      const b = document.createElement("button"); b.setAttribute("aria-pressed", "false"); b.setAttribute("aria-label", `Strona ${i}`);
      b.innerHTML = `<span>${i}</span>`;
      b.addEventListener("click", () => { const on = !chosen.has(i); on ? chosen.add(i) : chosen.delete(i); b.setAttribute("aria-pressed", String(on)); sync(); });
      box.appendChild(b);
      renderPdfPage(pdf, i, 300).then(u => { const im = new Image(); im.src = u; im.alt = ""; b.prepend(im); }).catch(() => {});
    }
    sync();
    const done = list => { $("#pdf-add").onclick = null; pickPdfPages.cancel = null; resolve(list); };
    $("#pdf-add").onclick = () => { const list = [...chosen].sort((a, b) => a - b); done(list); closeSheet(); };
    $("#pdf-all").onclick = () => { for (let i = 1; i <= pdf.numPages; i++) chosen.add(i); $$("#pdf-pages button").forEach(b => b.setAttribute("aria-pressed", "true")); sync(); };
    pickPdfPages.cancel = () => done([]);
    openSheet("pdf");
  });
}
function drawPending() {
  const t = $("#pending"); t.innerHTML = "";
  pending.forEach((p, i) => {
    const f = document.createElement("figure");
    f.innerHTML = `<img src="${p.keep}" alt="Strona ${i + 1}"><figcaption>${i + 1}</figcaption><button class="del" aria-label="Usuń stronę ${i + 1}">${icon("x")}</button>`;
    f.querySelector(".del").addEventListener("click", () => { pending.splice(i, 1); drawPending(); if (!pending.length) closeSheet(); });
    t.appendChild(f);
  });
  if (pending.length && pending.length < MAX_PAGES) {
    const f = document.createElement("figure");
    f.innerHTML = `<button class="add" data-act="camera" aria-label="Dodaj stronę">${icon("plus")}</button><figcaption>&nbsp;</figcaption>`;
    t.appendChild(f);
  }
  $("#btn-read").disabled = !pending.length;
}
["#in-camera", "#in-files", "#in-gallery"].forEach(sel => $(sel).addEventListener("change", e => { const fs = Array.from(e.target.files); e.target.value = ""; handleFiles(fs); }));

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
  } catch (e) { console.warn(e); if (cam.open) camMessage(e); }
}
function stopStream() {
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
  const pages = pending.slice(); if (!pages.length) return;
  readCtl = new AbortController();
  $("#read-img").src = pages[0].keep;
  $("#read-pages").textContent = pages.length > 1 ? `${pages.length} ${plural(pages.length, "strona", "strony", "stron")}` : "";
  $("#ck1-t").textContent = "Przygotowanie";
  $("#ck2-t").textContent = "Szukanie pięciolinii";
  $("#ck3-t").textContent = "Odczytywanie nut";
  ck("ck1", "now"); ck("ck2", null); ck("ck3", null); bar(null);
  presentCover($("#reading"));
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
  try {
    const piece = await readOnDevice(pages, readCtl.signal);
    ck("ck1", "ok"); ck("ck2", "ok"); ck("ck3", "ok"); bar(1);
    pending = []; drawPending();
    dismissCover($("#reading"));
    openPiece(piece);
    if (!piece.issues.length) {
      $("#notice-title").textContent = "Porównaj ze zdjęciem";
      $("#notice-text").textContent = "Dynamika (p, f…) i napisy, np. tempo, nie są odczytywane.";
      $("#notice").hidden = false;
    }
    hud("Gotowe");
  } catch (e) {
    dismissCover($("#reading"));
    if (e.name !== "AbortError") {
      const m = e.message || "";
      const el = $("#read-error"); el.textContent = /^[A-ZĄĆĘŁŃÓŚŹŻ][a-ząćęłńóśźż]/.test(m) && /[ąćęłńóśźż]|Nie |Na /.test(m) ? m : "Nie udało się odczytać nut. Spróbuj jeszcze raz.";
      el.hidden = false; console.warn(e);
    }
    openSheet("pages");
  } finally {
    readCtl = null;
    try { await wakeLock?.release(); } catch {} wakeLock = null;
  }
}

function preparePages() {
  $("#first-model").hidden = !!store.get("modelReady");
  $("#slow-read").hidden = !!navigator.gpu || store.get("homrPrefer") === "webgpu-ok";
  ["clef", "time", "key"].forEach(k => { $("#ask-" + k).value = store.get("ask-" + k, ""); });
  $("#ask").open = ["clef", "time", "key"].some(k => store.get("ask-" + k, ""));
}
["clef", "time", "key"].forEach(k => $("#ask-" + k).addEventListener("change", e => store.set("ask-" + k, e.target.value)));
const readAnswers = () => ({ clef: $("#ask-clef").value, time: $("#ask-time").value, key: $("#ask-key").value });
function dataUrlToBlob(u) {
  const [head, data] = u.split(","), type = (head.match(/data:([^;]+)/) || [])[1] || "image/jpeg";
  const bin = atob(data), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}
/* ---- Reading on the device: homr (open-source optical music recognition), free and offline ---- */
let recognizer = null;
async function getRecognizer(prefer) {
  if (recognizer && !prefer) return recognizer;
  if (recognizer) { try { await recognizer.dispose(); } catch {} recognizer = null; }
  prefer = prefer || store.get("homrPrefer", "webgpu");
  if (typeof Worker === "undefined") throw new Error("Ta przeglądarka nie potrafi czytać nut na urządzeniu. Zaktualizuj przeglądarkę albo otwórz Solo w Chrome lub Safari.");
  const mod = await import("./homr/homr.js");
  const abs = p => new URL(p, location.href).href;
  recognizer = await mod.createRecognizer({ baseUrl: abs("homr/models/"), wasmPaths: abs("homr/ort/"), prefer,
    createWorker: () => new Worker(abs("homr/worker.js"), { type: "module" }) });
  return recognizer;
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
async function readOnDevice(pages, signal) {
  let rec = await getRecognizer().catch(e => { recognizer = null; throw new Error(e && /memory|wasm|WebAssembly/i.test(e.message) ? HOMR_ERR.worker_lost : "Nie udało się uruchomić odczytu na tym urządzeniu. Odśwież stronę i spróbuj jeszcze raz."); });
  const xmls = [], lines = [], texts = [];
  for (let i = 0; i < pages.length; i++) {
    const pre = pages.length > 1 ? `Strona ${i + 1} z ${pages.length}: ` : "";
    const blob = dataUrlToBlob(pages[i].big);
    const progress = ({ stage, done, total }) => {
      if (stage === "models") {
        ck("ck1", "now");
        if (total > 1e6 && done < total) { $("#ck1-t").textContent = `Pobieranie modelu: ${Math.round(done / 1048576)} z ${Math.round(total / 1048576)} MB`; bar(done / total); }
      } else if (stage === "segment" || stage === "detect" || stage === "dewarp") {
        ck("ck1", "ok"); $("#ck1-t").textContent = "Przygotowanie"; ck("ck2", "now"); $("#ck2-t").textContent = pre + "Szukanie pięciolinii"; bar(null);
      } else if (stage === "staff") {
        ck("ck2", "ok"); ck("ck3", "now"); $("#ck3-t").textContent = `${pre}Odczytywanie nut: pięciolinia ${Math.min(done + 1, total)} z ${total}`; bar(total ? (i + done / total) / pages.length : null);
      } else if (stage === "ocr") { ck("ck3", "now"); $("#ck3-t").textContent = `${pre}Odczytywanie napisów (tempo, określenia)`; bar(total ? done / total : null); }
      else if (stage === "xml") { ck("ck3", "now"); }
    };
    /* the reader also reads the text above each staff: tempo, rit., a tempo, rehearsal letters (see attachTexts) */
    let r = await rec.recognizePage(blob, { ocr: true, signal, onProgress: progress });
    // some graphics chips give WebGPU results that are wrong rather than slow: retry once on the CPU
    if (!r.ok && rec.backend === "webgpu" && (r.error === "not_music" || r.error === "engine_failed" || r.error === "worker_lost")) {
      rec = await getRecognizer("wasm-threads");
      r = await rec.recognizePage(blob, { ocr: true, signal, onProgress: progress });
      if (r.ok) store.set("homrPrefer", "wasm-threads");
    }
    if (!r.ok) {
      if (r.error === "cancelled") { const e = new Error("cancelled"); e.name = "AbortError"; throw e; }
      if (r.error === "worker_lost") recognizer = null;
      throw new Error((pages.length > 1 ? `Strona ${i + 1}: ` : "") + (HOMR_ERR[r.error] || HOMR_ERR.engine_failed));
    }
    xmls.push(r.musicXml); texts.push({ page: i, staves: r.staves || [], texts: r.texts || [] });
    try {      /* T16: where each line sits on the photo, to show it next to the bar later */
      const im = await loadImage(pages[i].big);
      (r.staves || []).slice().sort((a, b) => a.index - b.index).forEach(s => lines.push({ page: i, cx: s.cx, cy: s.cy, w: s.w, h: s.h, W: im.naturalWidth, H: im.naturalHeight }));
    } catch {}
  }
  store.set("modelReady", "1");
  const names = new Set((await DB.all().catch(() => [])).map(p => p.title));
  let title = "Nowe nuty", n = 2; while (names.has(title)) title = "Nowe nuty " + n++;
  const checked = checkReading(attachTexts(homrToSolo(xmls, title), texts), readAnswers());
  return { title, composer: "", xml: checked.xml, sourceType: "device", images: pages.map(p => p.keep), lines, aiJson: null, issues: checked.issues, instrument: "" };
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
  if (k === "clef" || k === "key") { openSheet(k); return; }
  inlineEdit(b, { value: S.piece[k] || "", placeholder: k === "composer" ? "Kompozytor" : "Instrument", onSave: v => setPieceField(k, v) });
});

/* ---------------- Settings ---------------- */
function syncSettings() {
  syncInstall();
  const items = NEWS[VERSION] || [];
  $("#news").innerHTML = `<p class="txt"><b>Wersja ${esc(VERSION)}</b></p><ul class="news">${items.map(t => `<li>${esc(t)}</li>`).join("")}</ul>`;
  const th = ["dark", "auto"].includes(store.get("theme")) ? store.get("theme") : "light";
  $$("#themeseg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.theme === th)));
  $("#ver").textContent = BUILD ? `${VERSION} · test ${BUILD}` : VERSION;
  DB.all().then(all => {
    $("#store-count").textContent = all.length ? `${all.length} ${plural(all.length, "utwór", "utwory", "utworów")} w bibliotece` : "Biblioteka jest pusta";
  }).catch(() => {});
  navigator.storage?.estimate?.().then(e => { $("#store-size").textContent = `Zajęte: ${(e.usage / 1048576).toFixed(1).replace(".", ",")} MB${store.get("modelReady") ? ", w tym ok. 150 MB to program do czytania nut" : ""}`; }).catch(() => {});
}
$$("#themeseg button").forEach(b => b.addEventListener("click", () => {
  store.set("theme", b.dataset.theme);
  const root = document.documentElement; root.classList.add("theming"); setTimeout(() => root.classList.remove("theming"), 400);
  applyTheme(); syncSettings();
}));
/* "Auto" follows the system (and changes with it, e.g. at night) */
const darkMq = matchMedia("(prefers-color-scheme: dark)");
function applyTheme() {
  const v = store.get("theme"), t = v === "dark" || (v === "auto" && darkMq.matches) ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", t === "dark" ? "#16131C" : "#FBF6EC");
  const cs = document.querySelector('meta[name="color-scheme"]'); if (cs) cs.setAttribute("content", t);
}
darkMq.addEventListener?.("change", () => { if (store.get("theme") === "auto") applyTheme(); });
async function saveBackup() {
  const all = await DB.all();
  if (!all.length) return 0;
  download(`solo-kopia-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: "solo", version: 2, saved: Date.now(), pieces: all, cols: cols(), favs: favs() }), "application/json");
  store.set("backupAt", String(Date.now()));
  const el = $("#backup-nudge"); if (el) el.hidden = true;
  return all.length;
}
$("#btn-backup").addEventListener("click", async () => {
  const n = await saveBackup();
  $("#backup-status").textContent = n ? `Zapisano kopię: ${n} ${plural(n, "utwór", "utwory", "utworów")}.` : "Biblioteka jest pusta.";
});
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
$("#nudge-save")?.addEventListener("click", async () => { const n = await saveBackup(); if (n) hud(`Zapisano kopię: ${n} ${plural(n, "utwór", "utwory", "utworów")}`, 3000); });
$("#news-open")?.addEventListener("click", () => { store.set("newsSeen", VERSION); $("#news-nudge").hidden = true; go("settings"); setTimeout(() => $("#news").scrollIntoView({ behavior: "smooth", block: "center" }), 450); });
$("#news-x")?.addEventListener("click", () => { store.set("newsSeen", VERSION); fadeOut($("#news-nudge"), 180); });
$("#nudge-x")?.addEventListener("click", () => { store.set("nudgeLater", String(Date.now())); fadeOut($("#backup-nudge"), 180); });
$("#in-backup").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (!["solo", "pulpit-nutowy"].includes(j.app) || !Array.isArray(j.pieces)) throw new Error();
    if (Array.isArray(j.cols)) { const mine = cols(); j.cols.forEach(c => { const m = mine.find(x => x.id === c.id); if (m) m.items = [...new Set([...m.items, ...c.items])]; else mine.push(c); }); saveCols(mine); }
    if (Array.isArray(j.favs)) saveFavs([...new Set([...favs(), ...j.favs])]);
    const have = new Map((await DB.all()).map(p => [p.id, p]));
    let n = 0, newer = 0;
    for (const p of j.pieces) {
      if (!p || typeof p.id !== "string" || typeof p.xml !== "string") continue;
      const cur = have.get(p.id);                 // an older copy never overwrites newer changes
      if (cur && (cur.updated || 0) > (p.updated || 0)) { newer++; continue; }
      const clean = { ...p, title: String(p.title || ""), composer: String(p.composer || ""), images: Array.isArray(p.images) ? p.images.filter(s => typeof s === "string" && s.startsWith("data:image/")) : [],
        thumb: typeof p.thumb === "string" && p.thumb.startsWith("data:image/") ? p.thumb : null };
      await DB.put(clean); n++;
    }
    $("#backup-status").textContent = `Wczytano ${n} ${plural(n, "utwór", "utwory", "utworów")}.` +
      (newer ? ` ${newer} ${plural(newer, "utwór masz", "utwory masz", "utworów masz")} już w nowszej wersji.` : ""); syncSettings();
  } catch { $("#backup-status").textContent = "To nie jest kopia zapasowa Solo."; }
});

const NEWS = { "3.9": ["Nuty według zasad zapisu: ósemki łączone belkami według metrum, pauzy pokazują miary, znaki przypominające w następnym takcie.",
  "Drugi i trzeci głos według zasad prowadzenia głosów i akordów fortepianu.",
  "Klucz i oktawa dobrane tak, żeby nuty mieściły się na pięciolinii.",
  "Gotowe melodie, kanon, trio z trzech instrumentów, zmiana instrumentu partii i oktawy."] };
/* ---------------- T22 metronome, T23 tuner ---------------- */
const metro = { on: false, bpm: 100, beats: 4, ctx: null, next: 0, n: 0, timer: 0, raf: 0, queue: [] };
function buildToolsSheet() {
  if (S.view !== "metrov") $("#metro-sheet-host").appendChild($("#metro-ui"));
  if (!metro.on) { metro.bpm = S.piece && S.view === "score" ? curBpm() : (+store.get("metroBpm", 100) || 100); const t = S.piece && S.view === "score" ? (processedXml().match(/<beats>(\d+)<\/beats>/) || [])[1] : null; metro.beats = [2, 3, 4, 6].includes(+t) ? +t : (+store.get("metroBeats", 4) || 4); }
  syncMetro();
}
function syncMetro() {
  $("#m-bpm").textContent = metro.bpm;
  $$("#m-meter button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.b === metro.beats)));
  $("#m-beats").innerHTML = Array.from({ length: metro.beats }, (_, i) => `<i class="${i === 0 ? "one" : ""}"></i>`).join("");
  $("#m-go").innerHTML = `${icon(metro.on ? "stop" : "play")}<span>${metro.on ? "Stop" : "Start"}</span>`;
}
function metroClick(t, accent) {
  const c = metro.ctx, o = c.createOscillator(), g = c.createGain();
  o.frequency.value = accent ? 1500 : 1000; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(accent ? .9 : .55, t + .002); g.gain.exponentialRampToValueAtTime(.001, t + .06);
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + .08);
}
function metroStart() {
  const AC = window.AudioContext || window.webkitAudioContext; metro.ctx = metro.ctx || new AC();
  metro.ctx.resume?.(); metro.on = true; metro.n = 0; metro.next = metro.ctx.currentTime + .08; metro.queue = [];
  try { navigator.audioSession && !tuner.on && (navigator.audioSession.type = "playback"); } catch {}
  /* look ahead 120 ms, so the clicks stay exact even when the page is busy */
  metro.timer = setInterval(() => {
    while (metro.next < metro.ctx.currentTime + .12) {
      const beat = metro.n % metro.beats; metroClick(metro.next, beat === 0); metro.queue.push({ t: metro.next, beat });
      metro.next += (metro.beats === 6 ? 30 : 60) / metro.bpm; metro.n++;
    }
  }, 25);
  const draw = () => {
    if (!metro.on) return;
    while (metro.queue.length && metro.queue[0].t <= metro.ctx.currentTime) { const q = metro.queue.shift(); $$("#m-beats i").forEach((d, i) => d.classList.toggle("on", i === q.beat)); }
    metro.raf = requestAnimationFrame(draw);
  };
  metro.raf = requestAnimationFrame(draw); syncMetro();
}
function metroStop() { metro.on = false; clearInterval(metro.timer); cancelAnimationFrame(metro.raf); $$("#m-beats i").forEach(d => d.classList.remove("on")); syncMetro(); }
$("#m-go").addEventListener("click", () => metro.on ? metroStop() : metroStart());
const setMetroBpm = v => { metro.bpm = Math.max(30, Math.min(240, Math.round(v))); store.set("metroBpm", metro.bpm); syncMetro(); };
$("#m-down").addEventListener("click", () => setMetroBpm(metro.bpm - (metro.bpm > 120 ? 4 : 2)));
$("#m-up").addEventListener("click", () => setMetroBpm(metro.bpm + (metro.bpm >= 120 ? 4 : 2)));
$$("#m-meter button").forEach(b => b.addEventListener("click", () => { metro.beats = +b.dataset.b; store.set("metroBeats", metro.beats); metro.n = 0; syncMetro(); }));

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
  $$("#t-instr button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.tr === tuner.tr)));
  $$("#t-tol button").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.tol === tuner.tol)));
  $("#t-a").textContent = String(tuner.a4);
  const z = tuner.tol, pc = v => 50 + v;            // the meter spans −50…+50 cents
  $("#t-zones").style.background = `linear-gradient(90deg, var(--tn-far) 0%, var(--tn-far) ${pc(-15)}%, var(--tn-near) ${pc(-15)}%, var(--tn-near) ${pc(-z)}%, var(--tn-ok) ${pc(-z)}%, var(--tn-ok) ${pc(z)}%, var(--tn-near) ${pc(z)}%, var(--tn-near) ${pc(15)}%, var(--tn-far) ${pc(15)}%)`;
  $("#t-zones").style.opacity = ".28";
  $("#t-go").innerHTML = `${icon(tuner.on ? "stop" : "mic")}<span>${tuner.on ? "Wyłącz stroik" : "Włącz stroik"}</span>`;
}
/* Pitch of one sound: McLeod Pitch Method (normalised autocorrelation), the method used by good tuners.
   It does not depend on how loud the sound is (phones give a quiet signal when auto-gain is off),
   and it takes the first strong peak, so it does not jump an octave down. The signal is thinned to
   ~12 kHz first so it is quick on older phones, then the result is fine-tuned on the full signal.
   Returns Hz or -1; detectPitch.clarity is 0..1, detectPitch.rms the loudness. */
function detectPitch(buf, sr, minF = 40, maxF = 1500) {
  detectPitch.clarity = 0;
  const D = sr > 30000 ? 4 : 2, half = Math.floor(buf.length / D), x = new Float32Array(half);
  let mean = 0; for (let i = 0; i < half; i++) { let v = 0; for (let k = 0; k < D; k++) v += buf[D * i + k]; x[i] = v / D; mean += x[i]; }
  mean /= half; let rms = 0; for (let i = 0; i < half; i++) { x[i] -= mean; rms += x[i] * x[i]; }
  rms = Math.sqrt(rms / half); detectPitch.rms = rms; if (rms < 0.0008) return -1;          // silence
  const srD = sr / D;
  const maxLag = Math.min(half >> 1, Math.ceil(srD / minF)), minLag = Math.max(2, Math.floor(srD / maxF)), W = half - maxLag;
  const nsdf = new Float32Array(maxLag + 2);
  for (let tau = 0; tau <= maxLag + 1; tau++) {
    let acf = 0, m = 0;
    for (let i = 0; i < W; i++) { const a = x[i], b = x[i + tau]; acf += a * b; m += a * a + b * b; }
    nsdf[tau] = m > 0 ? 2 * acf / m : 0;
  }
  /* key maxima: the highest point of each positive region after the first zero crossing */
  const peaks = []; let tau = 1;
  while (tau < maxLag && nsdf[tau] > 0) tau++;
  while (tau < maxLag) {
    while (tau < maxLag && nsdf[tau] <= 0) tau++;
    let best = -1, bv = -Infinity;
    while (tau < maxLag && nsdf[tau] > 0) { if (nsdf[tau] > bv && tau >= minLag) { bv = nsdf[tau]; best = tau; } tau++; }
    if (best > 0) peaks.push(best);
  }
  if (!peaks.length) return -1;
  const top = Math.max(...peaks.map(p => nsdf[p])), pick = peaks.find(p => nsdf[p] >= 0.9 * top);
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
const micKeep = { stream: null, timer: 0 };
/* the tuner or a recording is done: the microphone stays ready for 3 minutes (no new permission prompt when the
   player comes back), then it is really turned off; leaving the app turns it off at once */
function releaseMic() {
  clearTimeout(micKeep.timer);
  micKeep.timer = setTimeout(() => { if (tuner.on || (typeof of !== "undefined" && of.stream)) return; try { micKeep.stream && micKeep.stream.getTracks().forEach(t => t.stop()); } catch {} micKeep.stream = null; micDone(); }, 180000);
}
document.addEventListener("visibilitychange", () => { if (document.hidden && !tuner.on && !(typeof of !== "undefined" && of.stream) && micKeep.stream) { try { micKeep.stream.getTracks().forEach(t => t.stop()); } catch {} micKeep.stream = null; } });
async function openMic() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error("Ta przeglądarka nie daje dostępu do mikrofonu."), { name: "NoMic" });
  /* iPhone: playback sets the audio session to "playback" (music with the silent switch on), and in that mode iOS
     refuses the microphone ("audio session category is not compatible with audio capture"). Recording needs
     "play-and-record"; micDone() gives the session back. */
  try { if (navigator.audioSession) navigator.audioSession.type = "play-and-record"; } catch {}
  /* one microphone for the whole visit: asking again would make the phone ask for permission again */
  clearTimeout(micKeep.timer);
  let stream = micKeep.stream && micKeep.stream.getAudioTracks().some(t => t.readyState === "live") ? micKeep.stream : null;
  if (!stream) {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } }); }
    catch (e) { if (e && e.name === "OverconstrainedError") stream = await navigator.mediaDevices.getUserMedia({ audio: true }); else throw e; }
    micKeep.stream = stream;
  }
  const AC = window.AudioContext || window.webkitAudioContext, rate = stream.getAudioTracks()[0]?.getSettings?.().sampleRate;
  let ctx; try { ctx = rate ? new AC({ sampleRate: rate }) : new AC(); } catch { ctx = new AC(); }
  try { await ctx.resume(); } catch {}
  let src; try { src = ctx.createMediaStreamSource(stream); }
  catch { try { ctx.close(); } catch {} ctx = new AC(); try { await ctx.resume(); } catch {} src = ctx.createMediaStreamSource(stream); }
  return { stream, ctx, src };
}
function micDone() { try { if (navigator.audioSession && !tuner.on && !(typeof of !== "undefined" && of.stream) && !micKeep.stream) navigator.audioSession.type = "auto"; } catch {} }
function micError(e) {
  return e && e.name === "NotAllowedError" ? (standalone() ? "Brak zgody na mikrofon. Włącz go w Ustawieniach telefonu." : "Brak zgody na mikrofon. Zezwól w ustawieniach przeglądarki.") :
    e && e.name === "NotFoundError" ? "Nie znaleziono mikrofonu." : e && e.name === "NotReadableError" ? "Mikrofon jest zajęty przez inną aplikację." :
    (e && e.message) || "Nie udało się włączyć mikrofonu.";
}
async function tunerStart() {
  $("#t-hz").textContent = "Włączam mikrofon…";
  let m; try { m = await openMic(); }
  catch (e) { $("#t-hz").textContent = micError(e); return; }      // said once, under the needle
  tuner.stream = m.stream; tuner.ctx = m.ctx;
  tuner.an = tuner.ctx.createAnalyser(); tuner.an.fftSize = 4096; tuner.buf = new Float32Array(tuner.an.fftSize);
  m.src.connect(tuner.an);
  Object.assign(tuner, { on: true, hist: [], shown: null, cand: null, candN: 0, lastOn: 0, trace: [] }); syncTuner();
  $("#t-hz").textContent = "Zagraj długi dźwięk";
  try { wakeLock = wakeLock || await navigator.wakeLock?.request("screen"); } catch {}
  tuner.raf = requestAnimationFrame(tunerLoop);
}
function tunerAnalyse(t) {
  /* the phone paused the sound (a call, the screen, another app): one tap brings it back */
  if (tuner.ctx.state !== "running") { tuner.ctx.resume?.().catch(() => {}); $("#t-hz").textContent = "Dotknij, żeby włączyć"; return; }
  tuner.an.getFloatTimeDomainData(tuner.buf);
  const f = detectPitch(tuner.buf, tuner.ctx.sampleRate, 27, 1400);
  if (!(f > 0) || detectPitch.clarity < (tuner.shown === null ? 0.9 : 0.85)) { tuner.trace.push({ t, c: null }); return; }
  tuner.hist.push(f); if (tuner.hist.length > 5) tuner.hist.shift();
  const fm = [...tuner.hist].sort((a, b) => a - b)[tuner.hist.length >> 1];
  const midi = 69 + 12 * Math.log2(fm / tuner.a4), n = Math.round(midi), c = 100 * (midi - n);
  if (n !== tuner.shown) {
    if (n === tuner.cand) tuner.candN++; else { tuner.cand = n; tuner.candN = 1; }
    if (tuner.candN < 3) { tuner.trace.push({ t, c: null }); return; }
    tuner.shown = n; tuner.ema = c; tuner.hz = fm;
  } else { tuner.ema += 0.3 * (c - tuner.ema); tuner.hz = fm; }
  tuner.lastOn = t; tuner.trace.push({ t, c: tuner.ema });
}
function tunerLoop(t) {
  if (!tuner.on) return;
  tuner.raf = requestAnimationFrame(tunerLoop);
  if (t - tuner.lastAn > 30) { tuner.lastAn = t; tunerAnalyse(t); }
  while (tuner.trace.length && t - tuner.trace[0].t > 6000) tuner.trace.shift();
  const box = $("#tuner2"), live = tuner.shown !== null && t - tuner.lastOn < 250, held = tuner.shown !== null && t - tuner.lastOn < 1500;
  if (!held && tuner.shown !== null) { tuner.shown = null; tuner.hist = []; }
  const c = tuner.ema, st = !held ? "off" : !live ? "hold" : Math.abs(c) <= tuner.tol ? "ok" : Math.abs(c) <= 15 ? "near" : "far";
  if (box.dataset.st !== st) box.dataset.st = st;
  if (tuner.shown !== null) {
    const w = tuner.shown + tuner.tr, name = NOTE_PL[((w % 12) + 12) % 12], oct = Math.floor(w / 12) - 1;
    $("#t-note").textContent = name; $("#t-oct").textContent = OCTAVE_NAMES[oct] ? `oktawa ${OCTAVE_NAMES[oct]}` : "";
    const r = Math.round(c);
    $("#t-cents").textContent = Math.abs(r) <= tuner.tol ? "✓" : r < 0 ? `−${-r} ¢` : `+${r} ¢`;
    $("#t-cents").setAttribute("aria-label", Math.abs(r) <= tuner.tol ? "Czysto" : r < 0 ? `Za nisko o ${-r} centów` : `Za wysoko o ${r} centów`);
    $("#t-hz").textContent = `${tuner.hz.toFixed(1)} Hz${tuner.tr ? " · dźwięk zapisany dla instrumentu" : ""}`;
  } else { $("#t-note").textContent = "–"; $("#t-oct").textContent = ""; $("#t-cents").textContent = ""; $("#t-hz").textContent = tuner.on ? "Zagraj długi dźwięk" : ""; }
  /* the dot glides towards its place (no jumps between readings) */
  const W = $(".tn-meter").clientWidth, target = held ? Math.max(-50, Math.min(50, c)) / 50 * (W / 2 - 23) : 0;
  tuner.x += (target - tuner.x) * 0.22; $("#t-dot").style.transform = `translateX(${tuner.x.toFixed(1)}px)`;
  drawTrace(t);
}
function drawTrace(t) {
  const cv = $("#t-trace"), dpr = window.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const cs = getComputedStyle(document.documentElement), y = c => h / 2 - Math.max(-50, Math.min(50, c)) / 50 * (h / 2 - 6);
  g.fillStyle = cs.getPropertyValue("--tn-ok").trim(); g.globalAlpha = .14; g.fillRect(0, y(tuner.tol), w, y(-tuner.tol) - y(tuner.tol)); g.globalAlpha = 1;
  g.strokeStyle = cs.getPropertyValue("--ink-3").trim() || "#999"; g.lineWidth = 1; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke(); g.setLineDash([]);
  g.strokeStyle = cs.getPropertyValue("--ink").trim() || "#222"; g.lineWidth = 2.5; g.lineJoin = "round"; g.beginPath();
  let pen = false;
  tuner.trace.forEach(p => { const x = w - (t - p.t) / 6000 * w; if (p.c === null) { pen = false; return; } pen ? g.lineTo(x, y(p.c)) : g.moveTo(x, y(p.c)); pen = true; });
  g.stroke();
}
function tunerStop() {
  tuner.on = false; cancelAnimationFrame(tuner.raf);
  try { tuner.ctx && tuner.ctx.close(); } catch {} releaseMic();
  tuner.stream = tuner.ctx = null; tuner.shown = null; tuner.trace = []; $("#tuner2").dataset.st = "off"; micDone();
  $("#t-note").textContent = "–"; $("#t-oct").textContent = ""; $("#t-cents").textContent = ""; $("#t-hz").textContent = "";
  $("#t-dot").style.transform = ""; tuner.x = 0; drawTrace(performance.now()); syncTuner();
  if (!playState && !metro.on) { try { wakeLock?.release(); } catch {} wakeLock = null; }
}
$("#t-go").addEventListener("click", () => tuner.on ? tunerStop() : tunerStart());
$("#tuner2").addEventListener("click", e => { if (tuner.on && tuner.ctx && tuner.ctx.state !== "running" && !e.target.closest("#t-go")) tuner.ctx.resume(); });
$$("#t-tol button").forEach(b => b.addEventListener("click", () => { tuner.tol = +b.dataset.tol; store.set("tunerTol", tuner.tol); syncTuner(); }));
const setA4 = v => { tuner.a4 = Math.max(430, Math.min(450, v)); store.set("tunerA4", tuner.a4); syncTuner(); };
$("#t-a-down").addEventListener("click", () => setA4(tuner.a4 - 1));
$("#t-a-up").addEventListener("click", () => setA4(tuner.a4 + 1));
function buildTunerSheet() { $("#tuner-sheet-host").appendChild($("#tuner-ui")); syncTuner(); syncOwn(); if (!tuner.on) tunerStart(); }
/* which instrument a part is: its name (Puzon II → Puzon), a piano by its two staves, the melody by the piece's instrument */
function instrOfPart(pid) {
  const dec = declaredOf(pid); if (dec) return dec.id;
  const p = S.parts && S.parts.find(x => x.id === pid); if (!p) return mainInstr().id;
  if (p.staves > 1 || PIANO_RE.test(p.name)) return "fortepian";
  const name = (typeof partLabel === "function" ? partLabel(p) : p.name || "").replace(/ (I|II|III|IV|V)$/, "").trim().toLowerCase();
  const hit = INSTRUMENTS.find(i => i.name.toLowerCase() === name) || INSTRUMENTS.find(i => name && i.name.toLowerCase().split(" ")[0] === name.split(" ")[0] && i.name.split(" ").length === 1) || INSTRUMENTS.find(i => name.startsWith(i.name.toLowerCase()));
  return hit ? hit.id : mainInstr().id;
}
/* the player's recording of exactly this instrument, otherwise this instrument's own timbre (never another's recording) */
function voiceFor(instrId) {
  if (store.get("ownUse") === "1" && typeof ownVoice === "function") { const v = ownVoice(instrId); if (v) return v; }
  return typeof timbreNote === "function" ? timbreNote(instrById(instrId).voice) : synthNote;
}
const voiceForPart = pid => voiceFor(instrOfPart(pid));
const noteVoice = () => voiceFor(mainInstr().id);
$$("#t-instr button").forEach(b => b.addEventListener("click", () => { tuner.tr = +b.dataset.tr; store.set("tunerTr", tuner.tr); syncTuner(); }));

/* ---------------- T24 tutorial: five steps over the real screen, skippable ---------------- */
const TOUR = [
  ["#pages", "Nuty", "Dotknij taktu, żeby grać od niego. Dwa palce powiększają stronę."],
  ["#btn-play", "Posłuchaj", "Takt odliczania, potem kursor idzie za muzyką, a strona przewija się sama."],
  ["#btn-loop", "Pętla", "Przesuń suwaki na pierwszy i ostatni takt. Działa też w trakcie grania."],
  ["#btn-tempo", "Tempo", "Zwolnij, przyspiesz i włącz metronom."],
  ["#btn-edit", "Popraw", "Wybierz długość i dotknij pięciolinii, albo dotknij nuty, żeby ją zmienić."],
  ["#btn-tools", "Narzędzia", "Tonacja, klucz, oryginał i wysyłanie."]
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
  if (S.piece) { go("score"); go2(); } else { openPiece({ xml: exampleXml(), sourceType: "example", title: "", composer: null, instrument: "Puzon" }); go2(); }
});

/* ---------------- Install (T9) ---------------- */
let installEvt = null;
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
function syncInstall() {
  $("#installed").hidden = !standalone(); $("#install-steps").hidden = standalone();   // the steps only while it is not installed
  $("#btn-install").hidden = standalone() || !installEvt;
  $("#install-steps").hidden = standalone();
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
async function migrateExample() {
  try {
    const all = await DB.all();
    /* an example saved by an older version (wrong 2/4 metre, "meow" as composer) is replaced by the current one */
    const olds = all.filter(p => p.sourceType === "example" && (!/<beats>3<\/beats>/.test(p.xml || "") || /<lyric\b/.test(p.xml || "")));
    if (!olds.length) return;
    await engineReady;
    for (const p of olds) {
      /* 3/4 already: only the words go (parts added by the player stay); older ones get the whole new example */
      const rec = { ...p, xml: /<beats>3<\/beats>/.test(p.xml) ? p.xml.replace(/<lyric\b[\s\S]*?<\/lyric>/g, "") : exampleXml(), title: /^(Oda do radości|Meow meow meow)$/.test(p.title) ? "Wlazł kotek na płotek" : p.title,
        composer: !p.composer || /beethoven|meow/i.test(p.composer) ? "Melodia ludowa" : p.composer, settings: /<beats>3<\/beats>/.test(p.xml) ? p.settings : { ...(p.settings || {}), iv: { d: 0, s: 0 }, preset: -1 }, thumb: null };
      if (rec.settings && rec.settings.preset === undefined) rec.settings.preset = -1;
      await DB.put(rec);
      const snap = { piece: S.piece, parts: S.parts, srcKey: S.srcKey, srcClef: S.srcClef, clef: S.clef, iv: S.iv, preset: S.preset, bpm: S.bpm };
      try { loadState(rec, rec.settings); rec.keyLabel = curKeyName(); rec.thumb = await makeThumb(); await DB.put(rec); } catch (e) { console.warn(e); }
      Object.assign(S, snap); S.loadedKey = null;
    }
    if (S.view === "home") refreshLibrary();
  } catch (e) { console.warn(e); }
}

/* T21: files shared to Solo from another app wait in a cache; open them like picked files */
async function openShared() {
  if (!/[?&]shared=1/.test(location.search)) return;
  history.replaceState(history.state, "", location.pathname);
  try {
    const c = await caches.open("solo-shared"), keys = await c.keys(), files = [];
    for (const k of keys) { const r = await c.match(k); const b = await r.blob(); files.push(new File([b], decodeURIComponent(r.headers.get("x-name") || "plik"), { type: b.type })); await c.delete(k); }
    if (files.length) handleFiles(files);
  } catch (e) { console.warn(e); }
}

/* ---------------- Boot ---------------- */
(function boot() {
  if (location.hash.startsWith("#k=")) history.replaceState(null, "", location.pathname + location.search);   // old setup links
  ["apikey", "model", "engine"].forEach(k => { try { localStorage.removeItem("solo:" + k); } catch {} });   // the old Claude reading
  const sort = store.get("sort", "opened"); if ([...$("#lib-sort").options].some(o => o.value === sort)) $("#lib-sort").value = sort;
  history.replaceState({ v: null }, "");
  setupHero(); measureGlyphs(); setPlayUi(false); drawPending();
  migrateExample(); openShared();
  show("home");
  if (!store.get("welcomed")) {
    DB.all().then(all => { if (!all.length) $("#welcome").hidden = false; else store.set("welcomed", "1"); }).catch(() => { $("#welcome").hidden = false; });
  }
  if ("serviceWorker" in navigator && (location.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) {
    // a new version takes over quietly: check when the app comes back to the screen, reload on the library screen
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("sw.js").then(reg => {
      document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
    let pendingReload = false;
    const reloadIfIdle = () => { if (S.view === "home" && !openSheetId && !readCtl && !cam.open && !pending.length) location.reload(); else pendingReload = true; };
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) reloadIfIdle(); });
    // first visit on a host without isolation headers: once the worker is in charge, reload one time to get them
    let coiTried = false; try { coiTried = !!sessionStorage.getItem("solo:coi"); } catch {}
    if (!window.crossOriginIsolated && !coiTried) {
      const go = () => { try { sessionStorage.setItem("solo:coi", "1"); } catch {} if (S.view === "home" && !openSheetId && !cam.open && !pending.length) location.reload(); };
      if (navigator.serviceWorker.controller) go(); else navigator.serviceWorker.addEventListener("controllerchange", go, { once: true });
    }
    window.addEventListener("popstate", () => { if (pendingReload) setTimeout(reloadIfIdle, 600); });
  }
})();

/* ---------------- a new melody: the basics first (benchmark: MuseScore, iReal Pro, Flat), then an empty staff ---------------- */
const nm = { instr: null, time: "4/4", key: 0, bpm: 90, title: "" };
function buildNewSheet() {
  const p = profile(); nm.instr = nm.instr || p.main;
  const ids = [...new Set([...p.instruments, nm.instr])];
  $("#new-instr").innerHTML = ids.map(id => `<button data-i="${id}" aria-pressed="${id === nm.instr}">${esc(instrById(id).name)}</button>`).join("") +
    `<button data-more aria-label="Inny instrument">${icon("plus")}</button>`;
  $$("#new-time button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === nm.time)));
  $("#new-key").value = String(nm.key); $("#new-bpm").textContent = String(nm.bpm);
  $("#new-title").value = nm.title;
  $("#new-clef").textContent = instrById(nm.instr).clef === "bass" ? "klucz basowy" : "klucz wiolinowy";
}
$("#new-instr").addEventListener("click", e => {
  const b = e.target.closest("[data-i]"); if (b) { nm.instr = b.dataset.i; buildNewSheet(); }
  /* any instrument: the same searchable picker as everywhere, then back to this sheet */
  if (e.target.closest("[data-more]")) pickInstrument("Instrument", id => { nm.instr = id; openSheet("new"); });
});
$("#new-instr").addEventListener("change", e => { if (e.target.id === "new-instr-more" && e.target.value) { nm.instr = e.target.value; buildNewSheet(); } });
$$("#new-time button").forEach(b => b.addEventListener("click", () => { nm.time = b.dataset.v; buildNewSheet(); }));
$("#new-key").addEventListener("change", e => { nm.key = +e.target.value; });
$("#new-title").addEventListener("input", e => { nm.title = e.target.value; });
[["#new-bpm-down", -5], ["#new-bpm-up", 5]].forEach(([s, d]) => $(s).addEventListener("click", () => { nm.bpm = Math.max(30, Math.min(240, nm.bpm + d)); $("#new-bpm").textContent = String(nm.bpm); }));
/* a ready tune written for the chosen instrument (its octave, transposition, clef) with the piano under it */
$("#new-ready").addEventListener("click", e => {
  const b = e.target.closest("[data-t]"); if (!b) return;
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
});
$("#new-go").addEventListener("click", () => {
  const ins = instrById(nm.instr), [beats, bt] = nm.time.split("/").map(Number);
  const xml = blankXml(4, { clef: ins.clef, beats, beatType: bt, fifths: nm.key, tempo: nm.bpm, title: nm.title || "Nowa melodia", part: ins.name });
  closeSheetThen(() => {
    openPiece({ xml, sourceType: "own", title: nm.title || "Nowa melodia", composer: "", instrument: ins.name });
    S.dirty = true; savePiece(); S.inLen = "quarter"; S.edTab = null; nm.title = "";
    whenDrawn(() => { setEditMode(true); edTab("len"); selectNote(null); });
  });
});

/* ---------------- 3.8 parts: chips under the title, "+" adds a part written automatically ----------------
   (benchmark: MuseScore, Flat, StaffPad, BandLab, Logic Session Players, Soundslice, iReal Pro) */
const ap = { instr: null, role: "voice2", int: 0, show: "staff" };
const partName = id => { const sp = [...parseXml(S.piece.xml).getElementsByTagName("score-part")].find(x => x.getAttribute("id") === id); return sp ? txt(sp, "part-name") : id; };
function renderPartStrip() {
  const box = $("#pstrip"); if (!box || !S.piece) return;
  const only = S.only;
  box.innerHTML = S.parts.map((p, k) => {
    const nm = partLabel(p);
    /* each part keeps one of the seven slide-position colours, as a dot on its chip */
    return `<button style="--pc:var(--pos-${(k % 7) + 1})" class="pchip${only === p.id ? " only" : ""}${pb.mute.has(p.id) ? " muted" : ""}${p.keep ? "" : " off"}" data-pid="${p.id}">${icon(p.staves > 1 || PIANO_RE.test(nm) ? "piano" : "trombone")}<span>${esc(nm)}</span></button>`;
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
  $("#pp-del").disabled = S.parts.length < 2; $("#pp-only").disabled = S.parts.length < 2;
  $("#pp-only span").textContent = S.only === pid ? "Wszystkie" : "Tylko ta";
  $("#pp-instr").disabled = (S.parts.find(p => p.id === pid) || {}).staves > 1;
}
$("#pp-only").addEventListener("click", () => { closeSheet(); showOnly(S.only === partSheetId ? null : partSheetId); });
$("#pp-mute").addEventListener("click", () => { const id = partSheetId; if (pb.mute.has(id)) pb.mute.delete(id); else pb.mute.add(id); buildPartSheet(); renderPartStrip(); if (playState) play(playPos()); });
async function withOnly(pid, fn) { const prev = S.only; showOnly(pid); await new Promise(r => setTimeout(r, 300)); try { await fn(); } finally { showOnly(prev); } }
$("#pp-print").addEventListener("click", () => closeSheetThen(() => withOnly(partSheetId, printScore)));
$("#pp-send").addEventListener("click", () => closeSheetThen(async () => { const keep = exportParts; exportParts = [partSheetId]; try { await savePdf(true); } finally { exportParts = keep; } }));
/* the same notes on another instrument (a bassoon line as the 2nd trombone); an octave up or down */
$("#pp-instr").addEventListener("click", () => { const pid = partSheetId; closeSheetThen(() => pickInstrument("Jaki instrument?", id => {
  pushUndo(); applyNewXml(orchestrateXml(changePartInstr(S.piece.xml, pid, instrById(instrOfPart(pid)), instrById(id)), pid), pid); hudUndo(`Teraz: ${instrById(id).name}`);
})); });
$$("#pp-up, #pp-down").forEach(b => b.addEventListener("click", () => {
  const pid = partSheetId, dir = b.id === "pp-up" ? 1 : -1, ins = S.parts.find(p => p.id === pid)?.staves > 1 ? null : instrById(instrOfPart(pid));
  pushUndo(); applyNewXml(orchestrateXml(shiftPartOctave(S.piece.xml, pid, dir, ins)), pid);   /* keeps its number */ hudUndo(dir > 0 ? "Oktawę wyżej" : "Oktawę niżej");
}));
$("#pp-del").addEventListener("click", () => {
  const id = partSheetId, doc = parseXml(S.piece.xml), root = doc.documentElement;
  kids(root, "part").forEach(p => { if (p.getAttribute("id") === id) p.remove(); });
  kids(kid(root, "part-list"), "score-part").forEach(sp => { if (sp.getAttribute("id") === id) sp.remove(); });
  pushUndo(); applyNewXml(new XMLSerializer().serializeToString(doc), null); closeSheet();
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
function hudUndo(msg) {
  hud(msg, 4000);
  const h = $("#toast"); const b = document.createElement("button"); b.className = "toast-act"; b.textContent = "Cofnij";
  b.addEventListener("click", () => { if (S.undo && S.undo.length) { applyNewXml(S.undo.pop(), null); h.classList.remove("show"); } });
  h.appendChild(b);
}
/* sections numbered and the score in orchestra order (arrange.js orchestrate); a part's instrument: the one it
   declares, else its name, else (the melody) the piece's instrument */
function orchestrateXml(xml, newId = null) {
  const plain = n => (n || "").replace(/ (I|II|III|IV|V|VI|\d)$/, "").trim().toLowerCase();
  const first = analyseXml(xml).parts.find(p => !(p.staves > 1 || PIANO_RE.test(p.name)));
  return orchestrate(xml, sp => {
    const dec = declaredInstr(sp); if (dec) return dec;
    const n = plain(txt(sp, "part-name")), hit = INSTRUMENTS.find(i => i.name.toLowerCase() === n); if (hit) return hit;
    if (first && sp.getAttribute("id") === first.id && S.piece && S.piece.instrument) return INSTRUMENTS.find(i => i.name.toLowerCase() === plain(S.piece.instrument)) || null;
    return null;
  }, newId);
}
/* parts are numbered when an instrument appears twice: Puzon → Puzon I, the new one Puzon II */
function numberParts(xml, base) {
  const doc = parseXml(xml), sps = [...doc.getElementsByTagName("score-part")];
  const same = sps.filter(sp => { const n = txt(sp, "part-name").trim(); return n === base || new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (I|II|III|IV|V)$`).test(n); });
  if (same.length > 1) same.forEach((sp, i) => { kid(sp, "part-name").textContent = `${base} ${["I", "II", "III", "IV", "V"][i] || i + 1}`; });
  if (same.length > 1 && S.piece.instrument === base) {
    const first = same[0].getAttribute("id"); kids(doc.documentElement, "part"); // the melody keeps "I"
  }
  return new XMLSerializer().serializeToString(doc);
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
  $("#ap-src").innerHTML = S.parts.map(p => `<button class="ichip" data-src="${p.id}" aria-pressed="${p.id === ap.src}">${esc(partLabel(p))}</button>`).join("");
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
/* the melody part: the first kept one that is not a piano */
const melodyPart = () => (S.parts.find(p => p.keep && !(p.staves > 1 || PIANO_RE.test(p.name))) || S.parts[0]).id;
function partLabel(p) { if (declaredOf(p.id)) return partName(p.id) || p.name; const own = partName(p.id) || p.name, solo = S.parts.find(x => !(x.staves > 1 || PIANO_RE.test(x.name))); return p === solo && S.piece.instrument && !/ (I|II|III|IV)$/.test(own) ? S.piece.instrument : own; }
/* how far a part is written above how it sounds: only for a part named for a transposing instrument */
function partTr(pid) { try { const i = namedInstr(pid); return i ? i.tr || 0 : 0; } catch { return 0; } }
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
    if (rep && r.id) r.xml = replacePart(r.xml, rep, r.id);
    pushUndo(); closeSheetThen(() => { applyNewXml(r.xml, r.id); hudUndo(rep ? "Zmieniono partię" : "Dodano partię"); });
  } catch (e) { console.error(e); hud("Nie udało się dopisać tej partii"); }
});
/* quick ensembles: duo = melody + second voice, trio = + bass; for the player's own instrument */
$$("#ap-quick [data-quick]").forEach(b => b.addEventListener("click", () => {
  if (b.dataset.quick === "canon") return quickCanon();
  try {
    const me = instrById(instrOfPart(melodyPart()));
    let r = addPart(S.piece.xml, me.id, "voice2"), xml = r.xml, ids = [r.id];
    if (b.dataset.quick === "trio") {
      /* a trio of the piece's own instrument: violins → three violins, trumpet → three trumpets; in a trombone
         section the third is the bass trombone (Puzon I–III) */
      const third = ["puzon", "puzon-alt"].includes(me.id) ? "puzon-b" : me.id;
      const r2 = addPart(xml, third, "voice3"); xml = r2.xml; ids.push(r2.id);
    }
    pushUndo(); closeSheetThen(() => { applyNewXml(xml, ids[0]); S.parts.forEach(p => { if (ids.includes(p.id)) p.keep = true; }); changed(); renderPartStrip(); hudUndo(b.dataset.quick === "trio" ? "Trio gotowe" : "Duet gotowy"); });
  } catch (e) { console.error(e); hud("Nie udało się dopisać partii"); }
}));

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
$("#pp-change").addEventListener("click", () => { ap.replace = partSheetId; closeSheetThen(() => openSheet("addpart")); });
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
const saveCols = c => store.set("cols", JSON.stringify(c));
const favs = () => { try { return JSON.parse(store.get("favs", "[]")) || []; } catch { return []; } };
const saveFavs = f => store.set("favs", JSON.stringify(f));
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
    mine.map(c => `<button class="cchip" role="tab" data-col="${c.id}" data-user aria-selected="${libCol === c.id}"><i class="cdot" style="background:${esc(c.color || "#8D8D8D")}"></i><span>${esc(c.name)}</span></button>`).join("") +
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
  saveCols(all.filter(x => x !== c)); if (libCol === c.id) { libCol = "all"; store.set("libCol", "all"); }
  closeSheetThen(() => { hud("Usunięto kolekcję. Utwory zostały.", 2500); refreshLibrary(); });
});
/* from a piece's long-press menu: ♥ and "Kolekcja" (tick the ones it belongs to) */
function syncFavTile() { const on = cardPiece && favs().includes(cardPiece.id); $("#cd-fav").innerHTML = icon(on ? "heart-fill" : "heart") + `<span>Ulubione</span>`; $("#cd-fav").setAttribute("aria-pressed", String(!!on)); }
$("#cd-fav").addEventListener("click", () => {
  const f = favs(), id = cardPiece.id, on = f.includes(id);
  saveFavs(on ? f.filter(x => x !== id) : [...f, id]); syncFavTile(); navigator.vibrate?.(8); refreshLibrary();
});
$("#cd-col").addEventListener("click", () => closeSheetThen(() => openSheet("addto")));
function buildAddtoSheet() {
  const id = cardPiece && cardPiece.id, all = cols();
  $("#addto-list").innerHTML = all.length ? all.map(c => `<label class="li"><i class="cdot" style="background:${esc(c.color || "#8D8D8D")}"></i><span class="grow"><b>${esc(c.name)}</b></span><input type="checkbox" class="switch" data-c="${c.id}" ${c.items.includes(id) ? "checked" : ""}></label>`).join("") : `<p class="note">Nie masz jeszcze kolekcji.</p>`;
}
$("#addto-list").addEventListener("change", e => {
  const cid = e.target.dataset.c, id = cardPiece && cardPiece.id; if (!cid || !id) return;
  const all = cols(), c = all.find(x => x.id === cid); if (!c) return;
  c.items = e.target.checked ? [...new Set([...c.items, id])] : c.items.filter(x => x !== id);
  saveCols(all); navigator.vibrate?.(8); refreshLibrary();
});
$("#addto-new").addEventListener("click", () => { colTarget = null; colPiece = cardPiece && cardPiece.id; closeSheetThen(() => openSheet("col")); });

/* notes the instrument cannot play are tinted (often a misread octave or clef); only for the music as written */
function markRange() {
  if (S.iv.d || S.iv.s) return;
  try {
    $$("#pages g.note").forEach(g => {
      const pid = partOfEl(g); if (!pid) return;
      const ins = instrById(instrOfPart(pid)), v = tk.getMIDIValuesForElement(g.id); if (!v || !(v.pitch > 0)) return;
      const w = v.pitch; g.classList.toggle("outrange", w < ins.lo + ins.tr - 1 || w > ins.hi + ins.tr + 1);
    });
  } catch (e) { console.warn(e); }
}
