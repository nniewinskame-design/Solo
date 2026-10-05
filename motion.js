/* Solo · motion
   Apple's fluid-interface rules for the web (WWDC18 "Designing Fluid Interfaces",
   github.com/emilkowalski/skills/apple-design):
   - springs described by damping ratio + response, not durations;
   - motion starts from the live on-screen value and inherits the finger's velocity;
   - momentum is projected before choosing where to settle;
   - rubber-banding past edges; only transform and opacity are animated. */
"use strict";
const Motion = (() => {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const linearOK = typeof CSS !== "undefined" && CSS.supports && CSS.supports("animation-timing-function", "linear(0, 1)");

  /* displacement of a damped spring released at x0 with velocity v0 (units/s) */
  function state(t, x0, v0, damping, response) {
    const w = 2 * Math.PI / response;
    if (damping >= 1) {               // critically damped: no overshoot
      const e = Math.exp(-w * t), c = v0 + w * x0;
      return { x: (x0 + c * t) * e, v: (c - w * (x0 + c * t)) * e };
    }
    const z = damping, wd = w * Math.sqrt(1 - z * z), e = Math.exp(-z * w * t);
    const B = (v0 + z * w * x0) / wd, cos = Math.cos(wd * t), sin = Math.sin(wd * t);
    const x = e * (x0 * cos + B * sin);
    return { x, v: -z * w * x + e * (-x0 * wd * sin + B * wd * cos) };
  }

  /* A spring as a CSS easing (linear() with sampled points) so the browser runs it off the main thread. */
  const cache = new Map();
  function easing(damping = 1, response = 0.4, v0 = 0) {
    const key = damping + "|" + response + "|" + Math.round(v0 * 100);
    if (cache.has(key)) return cache.get(key);
    let out;
    if (!linearOK) out = { easing: "cubic-bezier(0.32, 0.72, 0, 1)", duration: Math.round(response * 1250) };
    else {
      const dt = 1 / 120; let t = 0, pts = [];
      for (; t < 3; t += dt) {
        const s = state(t, -1, v0, damping, response);
        pts.push(1 + s.x);
        if (t > 0.05 && Math.abs(s.x) < 0.0008 && Math.abs(s.v) < 0.01) break;
      }
      pts.push(1);
      const step = Math.max(1, Math.round(pts.length / 64));       // keep the string short
      const sampled = pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map(p => +p.toFixed(4));
      out = { easing: `linear(${sampled.join(", ")})`, duration: Math.round(t * 1000) };
    }
    cache.set(key, out);
    return out;
  }

  /* An interruptible spring driven by requestAnimationFrame (for gesture-driven values). */
  class Spring {
    constructor(value, onUpdate) { this.value = value; this.target = value; this.velocity = 0; this.onUpdate = onUpdate; this.raf = 0; this.done = null; }
    set(v) { this.stop(); this.value = this.target = v; this.velocity = 0; this.onUpdate(v); }
    stop() { if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; if (this._resolve) { const r = this._resolve; this._resolve = null; r(false); } }
    to(target, { damping = 1, response = 0.4, velocity } = {}) {
      const v0 = velocity !== undefined ? velocity : this.velocity;
      this.stop();
      if (reduce.matches) { this.value = this.target = target; this.velocity = 0; this.onUpdate(target); return Promise.resolve(true); }
      const x0 = this.value - target, t0 = performance.now();
      this.target = target;
      return new Promise(res => {
        this._resolve = res;
        const tick = now => {
          const s = state((now - t0) / 1000, x0, v0, damping, response);
          this.value = target + s.x; this.velocity = s.v;
          if (Math.abs(s.x) < 0.4 && Math.abs(s.v) < 8) {
            this.value = target; this.velocity = 0; this.raf = 0; this.onUpdate(target);
            const r = this._resolve; this._resolve = null; r && r(true); return;
          }
          this.onUpdate(this.value);
          this.raf = requestAnimationFrame(tick);
        };
        this.raf = requestAnimationFrame(tick);
      });
    }
    get running() { return !!this.raf; }
  }

  /* past a boundary the element follows less and less */
  const rubberband = (over, dim, c = 0.55) => (over * dim * c) / (dim + c * Math.abs(over));
  /* where a flick would come to rest (px), decelerationRate like UIScrollView */
  const project = (v /* px/s */, d = 0.998) => (v / 1000) * d / (1 - d);

  /* velocity from the last ~100ms of pointer samples, px/s */
  class Tracker {
    constructor() { this.s = []; }
    add(x, y) { const t = performance.now(); this.s.push({ x, y, t }); while (this.s.length > 2 && t - this.s[0].t > 100) this.s.shift(); }
    velocity() {
      const s = this.s; if (s.length < 2 || performance.now() - s[s.length - 1].t > 80) return { x: 0, y: 0 };  // finger held still
      const a = s[0], b = s[s.length - 1], dt = Math.max(1, b.t - a.t) / 1000;
      return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
    }
  }

  /* live on-screen translateX/Y of an element (works mid-animation) */
  function liveTranslate(el) {
    const tr = getComputedStyle(el).transform;
    if (!tr || tr === "none") return { x: 0, y: 0 };
    const m = new DOMMatrixReadOnly(tr); return { x: m.m41, y: m.m42 };
  }

  return { reduce, easing, Spring, rubberband, project, Tracker, liveTranslate };
})();
