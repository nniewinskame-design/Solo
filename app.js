/* Solo · interface. Logic for music lives in core.js; this file wires the screens. */
"use strict";
const VERSION = "3.7";
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
  const views = ["home", "score", "settings"];
  if (from === v || opt.instant) {
    S.view = v; views.forEach(n => ($("#" + n).hidden = n !== v));
    if (v === "home") refreshLibrary(); if (v === "settings") syncSettings();
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
  if (opt.swiped) return;                      // the edge swipe already moved the screens
  navAnimate(fromEl, toEl, dir || (v === "home" ? "back" : "fwd"));
}
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
  const sw = swipedBack; swipedBack = false;
  show((e.state && e.state.v) || "home", "back", { swiped: sw });
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
edgeSwipe($("#score")); edgeSwipe($("#settings"));

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
    el.style.transform = ""; scrim.style.opacity = "";
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
  ({ clef: buildClefSheet, key: buildKeySheet, more: buildMoreSheet, orig: buildOrigSheet, pages: preparePages })[name]?.();
  openSheetId = name;
  presentSheet(el, switching);
  if (name === "key") placeHandle(true);
  const f = el.querySelector(".done, button, input"); if (f && matchMedia("(pointer:fine)").matches) f.focus({ preventScroll: true });
}
function hideSheet(instant, keepScrim) {
  if (openSheetId === "pdf" && pickPdfPages.cancel) { const c = pickPdfPages.cancel; setTimeout(c, 0); }
  if (!openSheetId) return;
  const name = openSheetId, el = $("#sh-" + name);
  openSheetId = null;
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
    if (act === "camera") { if (a.id === "w-camera") store.set("welcomed", "1"); openCamera(); }
    if (act === "print") closeSheetThen(printScore);
    if (act === "pdf") closeSheetThen(savePdf);
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
  if (e.key === " " && S.view === "score" && !openSheetId && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); if (!playState) unlockAudio(); play(); }
});

/* ---------------- Home / library ---------------- */
/* the welcome screen has the flat-lay photo; the library uses the others, so no photo appears twice */
const HERO = [
  { src: "img/window.jpg", pos: "50% 42%" }, { src: "img/piano.jpg", pos: "35% 50%" },
  { src: "img/brass.jpg", pos: "30% 50%" }
];
function setupHero() {
  const h = HERO[Math.floor(Date.now() / 86400000) % HERO.length];
  const img = $("#hero-img");
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
  const list = all.filter(p => !q || ((p.title || "") + " " + (p.composer || "")).toLowerCase().includes(q));
  const by = { title: (a, b) => (a.title || "").localeCompare(b.title || "", "pl"), composer: (a, b) => (a.composer || "￿").localeCompare(b.composer || "￿", "pl"),
    created: (a, b) => (b.created || 0) - (a.created || 0), opened: (a, b) => (b.opened || b.updated || 0) - (a.opened || a.updated || 0) };
  list.sort(by[sort] || by.opened);
  const latest = all.length > 1 ? all.slice().sort(by.opened)[0].id : null;
  const G = $("#lib-grid"); G.innerHTML = "";
  G.classList.toggle("stagger", !refreshLibrary.done && canAnimate()); refreshLibrary.done = true;
  list.forEach((p, idx) => {
    const b = document.createElement("div"); b.className = "card"; b.style.setProperty("--i", Math.min(idx, 14));
    const meta = p.composer || (p.sourceType === "ai" || p.sourceType === "device" ? "Ze zdjęcia" : p.sourceType === "example" ? "Przykład" : "Z pliku");
    b.innerHTML = `<button class="thumb" aria-label="Otwórz: ${esc(p.title || "Bez tytułu")}">${p.thumb ? `<img src="${esc(p.thumb)}" alt="">` : `<span class="ph">${esc(p.title || "Bez tytułu")}</span>`}${p.id === latest ? `<i class="ribbon" title="Ostatnio grane"></i>` : ""}</button>
      <div class="t" role="button" tabindex="0" aria-label="Zmień tytuł">${esc(p.title || "Bez tytułu")}</div><div class="m"><span class="c${p.composer ? "" : " ph"}" role="button" tabindex="0" aria-label="Zmień kompozytora">${esc(meta)}</span>${p.keyLabel ? `<button class="key" aria-label="Tonacja: ${esc(p.keyLabel)}">${esc(shortKey(p.keyLabel))}</button>` : ""}</div>`;
    b.querySelector(".thumb").addEventListener("click", () => openPiece(p, p.settings));
    const k = b.querySelector(".key"); if (k) k.addEventListener("click", () => { openPiece(p, p.settings); setTimeout(() => S.view === "score" && openSheet("key"), 520); });
    const edit = (el, field, ph) => inlineEdit(el, { value: p[field] || "", placeholder: ph, onSave: v => renameInLibrary(p, field, v) });
    const tEl = b.querySelector(".t"), cEl = b.querySelector(".c");
    tEl.addEventListener("click", () => edit(tEl, "title", "Tytuł"));
    cEl.addEventListener("click", () => edit(cEl, "composer", "Kompozytor"));
    [tEl, cEl].forEach(el => el.addEventListener("keydown", e => { if (e.key === "Enter" && e.target === el) { e.preventDefault(); el.click(); } }));
    G.appendChild(b);
  });
  const has = all.length > 0;
  nudgeBackup(all);
  const nn = $("#news-nudge"); if (nn) nn.hidden = !(all.length && NEWS[VERSION] && store.get("newsSeen") !== VERSION);
  $("#lib").hidden = !has; $("#lib-empty").hidden = has;
  $("#lib-count").textContent = has ? String(all.length) : "";
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
  S.clef = "keep"; S.iv = { d: 0, s: 0 }; S.preset = -1; S.bpm = null;
  if (settings) {
    if (Array.isArray(settings.keep)) S.parts.forEach(p => (p.keep = settings.keep.includes(p.id)));
    if (!S.parts.some(p => p.keep)) S.parts.forEach(p => (p.keep = true));
    if (settings.clef) S.clef = settings.clef;
    if (settings.iv) S.iv = { d: settings.iv.d | 0, s: settings.iv.s | 0 };
    if (Number.isInteger(settings.preset)) S.preset = settings.preset;
    if (settings.bpm >= 20 && settings.bpm <= 300) S.bpm = Math.round(settings.bpm);
    if (settings.zoom >= .5 && settings.zoom <= 2) S.zoom = settings.zoom;
  }
  if (S.piece.instrument == null) S.piece.instrument = first && !PIANO_RE.test(first.name) ? first.name : "";
}
function openPiece(piece, settings) {
  stopPlayback();
  try { loadState(piece, settings); } catch (e) { hud(e.message || "Nie udało się otworzyć nut.", 4000); return; }
  S.dirty = false; S.thumbDirty = !piece.thumb; S.loadedKey = null;
  S.piece.opened = Date.now();
  $("#notice").hidden = !(S.piece.issues && S.piece.issues.length);
  if (S.piece.issues && S.piece.issues.length) {
    const nums = doubtfulBars(S.piece.issues), n = nums.length;
    $("#notice-title").textContent = n ? `${n} ${plural(n, "takt", "takty", "taktów")} do sprawdzenia` : "Sprawdź ze zdjęciem";
    $("#notice-text").textContent = n ? `Zaznaczone na czerwono: ${nums.slice(0, 8).join(", ")}${n > 8 ? " i inne" : ""}. Porównaj je ze zdjęciem.` : "Odczyt może zawierać błędy.";
  }
  updateTitles();
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
    seg("instrument", S.piece.instrument, "Instrument"),
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
    issues: S.piece.issues || [], created: S.piece.created || now, updated: S.dirty ? now : (S.piece.updated || now), opened: S.piece.opened || now,
    settings: { keep: S.parts.filter(p => p.keep).map(p => p.id), clef: S.clef, iv: S.iv, preset: S.preset, bpm: S.bpm, zoom: S.zoom },
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
  return { pageWidth: r(2100), pageHeight: r(2970), scale: 50, adjustPageHeight: false, breaks: "auto", header: "auto", footer: "none",
    pageMarginTop: r(110), pageMarginBottom: r(110), pageMarginLeft: r(150), pageMarginRight: r(150), spacingSystem: 6, svgViewBox: true,
    transpose: intervalString(S.iv), justifyVertically: false, ...extra };
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
  const mode = width >= 600 ? "pages" : "reflow";
  try {
    const xml = processedXml();
    let opts;
    if (mode === "pages") opts = a4Options();
    else {
      const px = 38 * S.zoom;
      opts = { pageWidth: Math.round(width * 100 / px), pageHeight: 60000, adjustPageHeight: true, scale: Math.round(px), breaks: "auto", header: "auto", footer: "none",
        pageMarginLeft: 50, pageMarginRight: 50, pageMarginTop: 60, pageMarginBottom: 60, spacingSystem: 8, svgViewBox: false, transpose: intervalString(S.iv), justifyVertically: false };
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
    S.mode = mode; S.loadedKey = "view";
    S.baseBpm = scoreBpm();
    if (openSheetId === "more") syncTempo();
  } catch (e) {
    console.error(e);
    box.innerHTML = `<div class="page-msg">${esc(e.message || "Nie udało się narysować nut.")}</div>`;
  }
}
let lastW = window.innerWidth;
window.addEventListener("resize", () => { if (Math.abs(window.innerWidth - lastW) > 40) { lastW = window.innerWidth; render(); } });
/* tap a bar: it is selected and ▶ plays from there; tap it again (or outside the bars) to clear */
$("#pages").addEventListener("click", e => {
  const m = e.target.closest("g.measure");
  if (!m) { if (S.fromMs) clearFromBar(); else if (e.target.closest(".page")) document.body.classList.toggle("immersive"); return; }
  if (m.classList.contains("sel")) { clearFromBar(); return; }
  const firstNote = m.querySelector("g.note, g.rest"); if (!firstNote) return;
  let ms = 0; try { ms = tk.getTimeForElement(firstNote.id) || 0; } catch {}
  $$("#pages g.measure.sel").forEach(g => g.classList.remove("sel")); m.classList.add("sel");
  S.fromMs = ms; S.fromBar = [...$$("#pages g.measure")].indexOf(m);
  hud("Graj od tego taktu: dotknij ▶", 2200);
  if (playState) { stopPlayback(); play(ms); }
});
function clearFromBar() { S.fromMs = 0; S.fromBar = -1; $$("#pages g.measure.sel").forEach(g => g.classList.remove("sel")); }

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
  try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch {}
  if (!player.src || player.src === SILENCE || player.paused) {
    try { player.src = SILENCE; const pr = player.play(); if (pr) pr.catch(() => {}); } catch {}
  }
}
let playState = null, playToken = 0;
function setPlayUi(on) {
  const b = $("#btn-play"); b.classList.toggle("on", on);
  b.innerHTML = icon(on ? "stop" : "play");
  b.setAttribute("aria-label", on ? "Zatrzymaj" : "Posłuchaj"); b.title = on ? "Zatrzymaj" : "Posłuchaj";
}
function stopPlayback() {
  playToken++;
  if (!playState) return;
  try { (playState.src || player).pause(); } catch {}
  cancelAnimationFrame(playState.raf);
  const url = playState.url; if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
  $$("#pages g.playing").forEach(g => g.classList.remove("playing"));
  const pl = $("#pages .playline"); if (pl) pl.remove();
  playState = null; setPlayUi(false);
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
async function play(fromMs = 0) {
  if (playState) { stopPlayback(); if (!(fromMs > 0)) return; }
  if (!S.piece) return;
  const token = ++playToken;
  await engineReady;
  if (S.loadedKey !== "view") await doRender();
  let tm;
  try { tm = tk.renderToTimemap({ includeMeasures: false, includeRests: false }); } catch { hud("Nie da się odtworzyć tych nut"); return; }
  const k = (S.baseBpm || 120) / curBpm(), ev = [];
  tm.forEach(e => (e.on || []).forEach(id => {
    try {
      const v = tk.getMIDIValuesForElement(id); if (!v || !(v.pitch > 0)) return;
      const end = e.tstamp + v.duration; if (end <= fromMs + 20) return;
      const start = Math.max(e.tstamp, fromMs);      // resuming mid-note (tempo change): the note keeps sounding
      ev.push({ id, t: (start - fromMs) / 1000 * k, dur: Math.max(0.08, (end - start) / 1000 * k), pitch: v.pitch });
    } catch {}
  }));
  if (!ev.length) { hud("Brak nut do odtworzenia"); return; }
  const end = Math.max(...ev.map(e => e.t + e.dur));
  setPlayUi(true);
  let url, peak;
  try {
    const sr = 44100, Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new Off(1, Math.ceil((end + LEAD + 0.5) * sr), sr);
    const bus = off.createGain(); bus.gain.value = 0.18; bus.connect(off.destination);
    ev.forEach(e => synthNote(off, bus, 440 * Math.pow(2, (e.pitch - 69) / 12), LEAD + e.t, LEAD + e.t + e.dur * 0.95));
    const buf = await off.startRendering();
    /* private windows (Safari, Firefox, Brave) add random noise to rendered audio against fingerprinting:
       the lead-in must be silent, and if it isn't, play the notes live instead of from the rendered file */
    const ch = buf.getChannelData(0); let lead = 0;
    for (let i = 0, n = Math.floor(LEAD * sr * 0.8); i < n; i++) lead = Math.max(lead, Math.abs(ch[i]));
    if (lead > 1e-4) { if (token === playToken) playLive(ev, end, token, k, fromMs); return; }
    const w = wavBlob(buf); peak = w.peak; url = URL.createObjectURL(w.blob);
  } catch (e) { console.warn(e); if (token === playToken) { setPlayUi(false); hud("Nie udało się przygotować dźwięku"); } return; }
  if (token !== playToken) { URL.revokeObjectURL(url); return; }      // stopped while it was being prepared
  player.src = url;
  try { await player.play(); }
  catch (e) {
    URL.revokeObjectURL(url); setPlayUi(false);
    hud(e && e.name === "NotAllowedError" ? "Dotknij jeszcze raz, żeby posłuchać" : "Nie udało się odtworzyć dźwięku", 3000);
    return;
  }
  if (token !== playToken) { player.pause(); URL.revokeObjectURL(url); return; }
  playState = { raf: 0, k, fromMs, url, peak, src: player }; setPlayUi(true);
  follow(ev, end, token);
}
/* live playback through Web Audio: used when rendered audio comes back noisy */
async function playLive(ev, end, token, k, fromMs) {
  const AC = window.AudioContext || window.webkitAudioContext; const ctx = new AC();
  try { await ctx.resume(); } catch {}
  const bus = ctx.createGain(); bus.gain.value = 0.18; bus.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.12;
  ev.forEach(e => synthNote(ctx, bus, 440 * Math.pow(2, (e.pitch - 69) / 12), t0 + LEAD + e.t, t0 + LEAD + e.t + e.dur * 0.95));
  const src = { get currentTime() { return ctx.currentTime - t0; }, get ended() { return ctx.currentTime - t0 > end + LEAD + 0.3; }, pause() { try { ctx.close(); } catch {} } };
  if (token !== playToken) { src.pause(); return; }
  playState = { raf: 0, k, fromMs, url: null, peak: 1, src }; setPlayUi(true);
  follow(ev, end, token);
}
/* highlight the playing notes, move the line, keep the music in view */
function follow(ev, end, token) {
  const sc = $("#scroller"); let lastScroll = 0;
  const step = () => {
    if (!playState || token !== playToken) return;
    const now = playState.src.currentTime - LEAD;
    ev.forEach(e => {
      const on = now >= e.t && now < e.t + e.dur;
      const el = e.el || (e.el = document.getElementById(e.id)); if (!el) return;
      if (on && !e.lit) {
        el.classList.add("playing"); e.lit = true;
        /* a line follows the music: it stands at the playing note, as tall as its staff line */
        const pgs = $("#pages"), sys = el.closest("g.system") || el.closest("g.measure");
        if (pgs && sys) {
          let line = pgs.querySelector(".playline"); if (!line) { line = document.createElement("div"); line.className = "playline"; pgs.appendChild(line); }
          const pr = pgs.getBoundingClientRect(), nr = el.getBoundingClientRect(), sr = sys.getBoundingClientRect();
          line.style.height = Math.round(sr.height + 12) + "px";
          line.style.transform = `translate(${Math.round(nr.left - pr.left + nr.width / 2 - 1)}px, ${Math.round(sr.top - pr.top - 6)}px)`;
        }
        if (performance.now() - lastScroll > 700) {
          const r = el.getBoundingClientRect(), b = sc.getBoundingClientRect();
          if (r.top < b.top + 70 || r.bottom > b.bottom - 150) { sc.scrollBy({ top: r.top - b.top - b.height / 3, behavior: "smooth" }); lastScroll = performance.now(); }
        }
      } else if (!on && e.lit) { el.classList.remove("playing"); e.lit = false; }
    });
    if (playState.src.ended || now > end + 0.3) { stopPlayback(); return; }
    playState.raf = requestAnimationFrame(step);
  };
  playState.raf = requestAnimationFrame(step);
}
$("#btn-play").addEventListener("click", () => { if (playState) { stopPlayback(); return; } unlockAudio(); play(S.fromMs || 0); });
(() => {
  const sc = $("#scroller"), pg = $("#pages"); let d0 = 0, ratio = 1;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  sc.addEventListener("touchstart", e => { if (e.touches.length === 2) { d0 = dist(e.touches); ratio = 1; } }, { passive: true });
  sc.addEventListener("touchmove", e => {
    if (e.touches.length !== 2 || !d0) return;
    e.preventDefault();
    ratio = Math.max(.5 / S.zoom, Math.min(2 / S.zoom, dist(e.touches) / d0));
    pg.style.transformOrigin = "50% 0"; pg.style.transform = `scale(${ratio})`;
  }, { passive: false });
  sc.addEventListener("touchend", e => {
    if (!d0 || e.touches.length) return;
    pg.style.transform = ""; d0 = 0;
    if (Math.abs(ratio - 1) > .04) setZoom(S.zoom * ratio);
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
/* where playback is now, in score milliseconds (independent of tempo) */
const playPos = () => playState ? playState.fromMs + Math.max(0, playState.src.currentTime - LEAD) * 1000 / playState.k : 0;
document.addEventListener("visibilitychange", () => { if (document.hidden) stopPlayback(); });

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
async function savePdf() {
  if (!S.piece || pdfBusy) return;
  pdfBusy = true; stopPlayback();
  hud("Przygotowuję PDF…", 60000);
  try {
    await engineReady;
    tk.setOptions(a4Options());
    tk.loadData(processedXml());
    const svgs = []; for (let i = 1; i <= tk.getPageCount(); i++) svgs.push(tk.renderToSVG(i));
    S.loadedKey = null;
    const images = [];
    for (let i = 0; i < svgs.length; i++) {
      const el = await pageCanvas(svgs[i]); if (i === 0) enlargeTitle(el, 1.9);
      const c = await rasterPage(el);
      images.push(await pageImage(c));
      c.width = c.height = 1;                      // free the memory before the next page
    }
    const title = S.piece.title || "Nuty", name = safeName(title) + ".pdf";
    const blob = buildPdf(images, PDF_W, PDF_H, title);
    const file = new File([blob], name, { type: "application/pdf" });
    // iPhone and iPad: the share sheet (Save to Files, AirDrop…); everywhere else a normal download
    const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
    let shared = false;
    if (apple && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title }); shared = true; } catch (e) { if (e && e.name === "AbortError") shared = true; }
    }
    if (!shared) { download(name, blob, "application/pdf"); hud("Pobrano " + name, 3000); }
    else hud("Gotowe", 1200);
  } catch (e) { console.error(e); hud("Nie udało się zapisać PDF. Spróbuj jeszcze raz.", 4000); }
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
$("#btn-pdf").addEventListener("click", () => closeSheetThen(savePdf));
$("#btn-xml").addEventListener("click", () => closeSheetThen(shareXml));

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
function buildClefSheet() {
  const opts = [["bass", "Basowy", "F"], ["tenor", "Tenorowy", "C"], ["alto", "Altowy", "C"], ["treble", "Wiolinowy", "G"], ["keep", `Jak w oryginale (${CLEF_PL[S.srcClef] || "bez zmian"})`, null]];
  const L = $("#clef-list"); L.innerHTML = "";
  opts.forEach(([v, label, gl]) => {
    const b = document.createElement("button"); b.className = "li tap" + (S.clef === v ? " on" : "");
    b.innerHTML = `${gl ? glyph(gl) : `<span class="clefg">${icon("left")}</span>`}<span class="grow"><b>${esc(label)}</b></span><span class="radio"></span>`;
    b.addEventListener("click", () => {
      const prev = curClef(), next = v === "keep" ? S.srcClef : v;
      const dOct = octForClef(prev, next);
      S.clef = v;
      if (dOct) S.iv = { d: S.iv.d + 7 * dOct, s: S.iv.s + 12 * dOct };
      if (S.clef === "bass" || S.clef === "tenor") maybeTrombone();
      $("#clef-hint").textContent = dOct < 0 ? "O oktawę niżej, żeby nuty zmieściły się na pięciolinii." : dOct > 0 ? "O oktawę wyżej, żeby nuty zmieściły się na pięciolinii." : "";
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
  const base = ivForK(k);
  S.iv = { d: base.d + 7 * oct, s: base.s + 12 * oct };
  S.preset = -1; changed();
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
/* quick named intervals (Tata: "o sekundę, tercję albo kwartę w górę lub w dół") */
const IVS = [["sekunda", 1, 2], ["tercja", 2, 4], ["kwarta", 3, 5], ["kwinta", 4, 7]];
(() => {
  const box = $("#ivs");
  [1, -1].forEach(dir => IVS.forEach(([name, d, s]) => {
    const b = document.createElement("button"); b.dataset.d = d * dir; b.dataset.s = s * dir;
    b.innerHTML = `${name}<small>${dir > 0 ? "w górę ↑" : "w dół ↓"}</small>`;
    b.setAttribute("aria-label", `O ${name.replace(/a$/, "ę")} ${dir > 0 ? "w górę" : "w dół"}`);
    b.addEventListener("click", () => { S.iv = { d: d * dir, s: s * dir }; S.preset = -1; changed(); });
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
  $("#key-range").value = String(k);
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
function buildMoreSheet() {
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
  $("#zoom-val").textContent = Math.round(S.zoom * 100) + "%";
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
const setZoom = z => { S.zoom = Math.round(Math.max(.5, Math.min(2, z)) * 10) / 10; store.set("zoom2", S.zoom); $("#zoom-val").textContent = Math.round(S.zoom * 100) + "%"; if (S.piece) { S.piece.zoom = S.zoom; autosave(); } render(); };
$("#zoom-in").addEventListener("click", () => setZoom(S.zoom + .1));
$("#zoom-out").addEventListener("click", () => setZoom(S.zoom - .1));
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
      const blob = await (await fetch(p.images[0])).blob(), file = new File([blob], "oryginal.jpg", { type: "image/jpeg" });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ ...data, files: [file] }); return; }
    }
    if (navigator.share) { await navigator.share(data); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  location.href = "mailto:nniewinskame@gmail.com?subject=" + encodeURIComponent("Solo: zgłoszenie") + "&body=" + encodeURIComponent(text);
});
$("#btn-delete").addEventListener("click", () => {
  $("#confirm-t").textContent = `Usunąć „${S.piece.title || "Bez tytułu"}”?`;
  $("#confirm-text").textContent = "Nuty i zdjęcie oryginału znikną z tego urządzenia.";
  openSheet("confirm");
});
$("#confirm-yes").addEventListener("click", async () => {
  const id = S.piece && S.piece.id;
  if (!id) { closeSheet(); return; }
  await DB.del(id); S.piece = null;
  closeSheetThen(() => { hud("Usunięto"); go("home"); });
});

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
    if (pending.length >= MAX_PAGES) { hud(`Najwyżej ${MAX_PAGES} strony naraz`); break; }
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
["#in-camera", "#in-files"].forEach(sel => $(sel).addEventListener("change", e => { const fs = Array.from(e.target.files); e.target.value = ""; handleFiles(fs); }));

/* ---- Camera ---- */
const cam = { open: false, stream: null, track: null, busy: false, torch: false };
const camEl = $("#cam"), camVideo = $("#cam-video");
const CAM_ERR = {
  NotAllowedError: ["Brak dostępu do aparatu", "Zezwól na aparat w ustawieniach przeglądarki (ikona obok adresu strony) albo wybierz zdjęcie z galerii."],
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
  const xmls = [];
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
      } else if (stage === "xml") { ck("ck3", "now"); }
    };
    let r = await rec.recognizePage(blob, { ocr: false, signal, onProgress: progress });
    // some graphics chips give WebGPU results that are wrong rather than slow: retry once on the CPU
    if (!r.ok && rec.backend === "webgpu" && (r.error === "not_music" || r.error === "engine_failed" || r.error === "worker_lost")) {
      rec = await getRecognizer("wasm-threads");
      r = await rec.recognizePage(blob, { ocr: false, signal, onProgress: progress });
      if (r.ok) store.set("homrPrefer", "wasm-threads");
    }
    if (!r.ok) {
      if (r.error === "cancelled") { const e = new Error("cancelled"); e.name = "AbortError"; throw e; }
      if (r.error === "worker_lost") recognizer = null;
      throw new Error((pages.length > 1 ? `Strona ${i + 1}: ` : "") + (HOMR_ERR[r.error] || HOMR_ERR.engine_failed));
    }
    xmls.push(r.musicXml);
  }
  store.set("modelReady", "1");
  const names = new Set((await DB.all().catch(() => [])).map(p => p.title));
  let title = "Nowe nuty", n = 2; while (names.has(title)) title = "Nowe nuty " + n++;
  const checked = checkReading(homrToSolo(xmls, title), readAnswers());
  return { title, composer: "", xml: checked.xml, sourceType: "device", images: pages.map(p => p.keep), aiJson: null, issues: checked.issues, instrument: "" };
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
  const th = store.get("theme") === "dark" ? "dark" : "light";
  $$("#themeseg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.theme === th)));
  $("#ver").textContent = BUILD ? `${VERSION} · test ${BUILD}` : VERSION;
  DB.all().then(all => {
    $("#store-count").textContent = all.length ? `${all.length} ${plural(all.length, "utwór", "utwory", "utworów")} w bibliotece` : "Biblioteka jest pusta";
  }).catch(() => {});
  navigator.storage?.estimate?.().then(e => { $("#store-size").textContent = `Zajęte: ${(e.usage / 1048576).toFixed(1).replace(".", ",")} MB${store.get("modelReady") ? ", w tym ok. 150 MB to program do czytania nut" : ""}`; }).catch(() => {});
}
$$("#themeseg button").forEach(b => b.addEventListener("click", () => {
  const t = b.dataset.theme; store.set("theme", t);
  const root = document.documentElement; root.classList.add("theming"); setTimeout(() => root.classList.remove("theming"), 400);
  document.documentElement.setAttribute("data-theme", t);
  const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute("content", t === "dark" ? "#170B0F" : "#F4EEE4");
  syncSettings();
}));
async function saveBackup() {
  const all = await DB.all();
  if (!all.length) return 0;
  download(`solo-kopia-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ app: "solo", version: 2, saved: Date.now(), pieces: all }), "application/json");
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

const NEWS = { "3.7": ["Kilka pytań przed czytaniem: klucz, metrum i znaki przy kluczu poprawiają odczyt.",
  "Takty, które się nie zgadzają, są zaznaczone na czerwono, z licznikiem do sprawdzenia.",
  "Pauzy wielotaktowe nie zasłaniają już kolejnych taktów.",
  "Nuty od 50 do 200%, rozciąganie dwoma palcami, wielkość zapamiętana dla utworu.",
  "Grana nuta jest wyraźna, a linia idzie za muzyką. Dotknij taktu, żeby grać od niego.",
  "Szybkie interwały w Tonacji: sekunda, tercja, kwarta, kwinta w górę i w dół.",
  "Z PDF-u wybierasz strony; do 12 stron naraz.",
  "Przypomnienie o kopii zapasowej i bezpieczne wczytywanie kopii.",
  "Odtwarzanie działa też w oknie prywatnym (incognito)."] };
/* ---------------- Install (T9) ---------------- */
let installEvt = null;
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
function syncInstall() {
  $("#installed").hidden = !standalone();
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
    const olds = all.filter(p => p.sourceType === "example" && !/<work-title>Wlazł kotek na płotek</.test(p.xml || ""));
    if (!olds.length) return;
    await engineReady;
    for (const p of olds) {
      const rec = { ...p, xml: exampleXml(), title: /^(Oda do radości|Meow meow meow)$/.test(p.title) ? "Wlazł kotek na płotek" : p.title,
        composer: /beethoven/i.test(p.composer || "") ? "meow" : p.composer, settings: { ...(p.settings || {}), iv: { d: 0, s: 0 }, preset: -1 }, thumb: null };
      if (rec.settings && rec.settings.preset === undefined) rec.settings.preset = -1;
      await DB.put(rec);
      const snap = { piece: S.piece, parts: S.parts, srcKey: S.srcKey, srcClef: S.srcClef, clef: S.clef, iv: S.iv, preset: S.preset, bpm: S.bpm };
      try { loadState(rec, rec.settings); rec.keyLabel = curKeyName(); rec.thumb = await makeThumb(); await DB.put(rec); } catch (e) { console.warn(e); }
      Object.assign(S, snap); S.loadedKey = null;
    }
    if (S.view === "home") refreshLibrary();
  } catch (e) { console.warn(e); }
}

/* ---------------- Boot ---------------- */
(function boot() {
  if (location.hash.startsWith("#k=")) history.replaceState(null, "", location.pathname + location.search);   // old setup links
  ["apikey", "model", "engine"].forEach(k => { try { localStorage.removeItem("solo:" + k); } catch {} });   // the old Claude reading
  const sort = store.get("sort", "opened"); if ([...$("#lib-sort").options].some(o => o.value === sort)) $("#lib-sort").value = sort;
  history.replaceState({ v: null }, "");
  setupHero(); measureGlyphs(); setPlayUi(false); drawPending();
  migrateExample();
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
