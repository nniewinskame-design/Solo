/* Solo · the listening orb (design v2 §4.5; references: ChatGPT voice, Gemini Live, Siri orb).
   One canvas, Canvas 2D, one requestAnimationFrame loop. A soft blob made of layered closed curves that
   breathes when idle, swells and ripples with the input level, leans with the cents and turns green when
   in tune (a crisp ring springs out: "locked"). Cheap: no allocation in the loop (typed arrays, gradients built
   once per colour change in unit space and scaled with the transform), devicePixelRatio capped at 2, stops when
   the page or the canvas is hidden, drops to ~24 fps after 10 s of silence. Reduced motion: a still disc with a
   ring whose opacity shows the level.

   const orb = createOrb(canvas, { hue: "sky", drift: "x", hollow: true });   hollow: text sits inside
   orb.setLevel(0..1)   input loudness (raw; smoothed here: fast attack, soft release)
   orb.setTune(cents|null)  null keeps the last lean and lets it relax
   orb.setState("idle" | "listening" | "ok" | "far")
   orb.setHue(name, mix)  family hue ("amber", "green", "coral", "blue", "violet", "pink", "teal", "lime", "sky",
                          "slate", "brand") and an optional 0..1 blend towards lime ("your sound")
   orb.pulse()          a quick gulp (a note was captured)
   orb.destroy() */
"use strict";

/* spec hexes (§1.2–1.3): light solid, dark solid; the CSS variables win when the stylesheet defines them */
const ORB_HUES = {
  amber: ["#FFB21E", "#FFC75A"], green: ["#1CCB82", "#5BE3A6"], coral: ["#FF7B5C", "#FF9E86"], blue: ["#2E8DFF", "#8DB8FF"],
  violet: ["#A070FF", "#C6A8FF"], pink: ["#FF70C8", "#FF9AD8"], teal: ["#1BD3C6", "#5DE6DB"], lime: ["#B9E62E", "#C9EE5E"],
  sky: ["#4CCBFF", "#7FD6FF"], slate: ["#8E98B5", "#C3C9DC"], brand: ["#3D5BFF", "#7C8CFF"]
};
/* the second, neighbouring colour of each orb (brass glows amber and coral) */
const ORB_PAIR = { amber: "coral", green: "teal", coral: "pink", blue: "violet", violet: "blue", pink: "violet", teal: "green", lime: "green", sky: "blue", slate: "sky", brand: "violet" };
/* an instrument family (INSTR group) as its hue: one colour = one meaning, app-wide */
const FAMILY_HUE = { "Dęte blaszane": "amber", "Dęte drewniane": "green", "Smyczkowe": "coral", "Klawiszowe": "blue", "Szarpane": "violet", "Perkusyjne": "teal", "Głos": "pink" };
const orbHueOfGroup = g => FAMILY_HUE[g] || "slate";

function createOrb(canvas, opt = {}) {
  const g = canvas.getContext("2d", { alpha: true });
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const N = 64, COS = new Float32Array(N), SIN = new Float32Array(N), P = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) { const a = i / N * Math.PI * 2; COS[i] = Math.cos(a); SIN[i] = Math.sin(a); }
  /* three layers, each with its own random phases (k = 2, 3, 5) */
  const PH = new Float32Array(9); for (let i = 0; i < 9; i++) PH[i] = Math.random() * Math.PI * 2;
  const st = {
    hue: opt.hue || "brand", mix: 0, drift: opt.drift || null,
    raw: 0, lvl: 0, cents: 0, centsOn: 0, rawCents: null, state: "idle",
    s: 1, v: 0, ring: 0, rv: 0, ok: 0, t: 0, last: 0, loud: 0, raf: 0, visible: true, inView: true,
    w: 0, h: 0, dpr: 1, dark: false, grads: null, dead: false, lastDraw: 0, still: false
  };

  /* ---- colours: read once per hue/theme change ---- */
  const probe = document.createElement("canvas").getContext("2d");
  function rgb(css, fb) {
    probe.fillStyle = "#000"; probe.fillStyle = css || fb; const v = probe.fillStyle;
    if (v[0] === "#") return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
    const m = v.match(/[\d.]+/g); return m ? [+m[0], +m[1], +m[2]] : [128, 128, 128];
  }
  function hueRGB(name) {
    const cs = getComputedStyle(canvas), tbl = ORB_HUES[name] || ORB_HUES.brand;
    const v = name === "brand" ? cs.getPropertyValue("--brand") : (cs.getPropertyValue(`--${name}-solid`) || cs.getPropertyValue(`--${name}`));
    return rgb(v.trim(), tbl[st.dark ? 1 : 0]);
  }
  const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
  /* palette v3: soft pastels as in Copilot: every colour 40 % towards white, every alpha at most ~0.45 */
  const SOFT = opt.soft ?? 0.48, PALE = opt.pale ?? 0.4, pale = v => Math.round(v + (255 - v) * PALE);
  const rgba = (c, a) => `rgba(${pale(c[0])},${pale(c[1])},${pale(c[2])},${(a * SOFT).toFixed(3)})`;
  /* gradients in unit space (radius 1 around 0,0); the transform scales them to the orb */
  function body(c, a0, a1, ox, oy) {
    const gr = g.createRadialGradient(ox, oy, 0, 0, 0, 1.12);
    if (opt.hollow) { gr.addColorStop(0, rgba(c, a0)); gr.addColorStop(0.55, rgba(c, a0 + (a1 - a0) * 0.35)); gr.addColorStop(0.86, rgba(c, a1)); gr.addColorStop(1, rgba(c, a1 * 0.35)); return gr; }   // a soft rim
    gr.addColorStop(0, rgba(c, a0)); gr.addColorStop(0.7, rgba(c, (a0 + a1) / 2)); gr.addColorStop(1, rgba(c, a1)); return gr;
  }
  function build() {
    st.dark = isDark();
    const A = hueRGB(st.hue), B = hueRGB(ORB_PAIR[st.hue] || "pink"), L = hueRGB("lime"), G = hueRGB("green"), F = hueRGB("blue"), S = hueRGB("coral");
    const halo = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    halo.addColorStop(0, rgba(A, opt.hollow ? (st.dark ? 0.14 : 0.18) : st.dark ? 0.42 : 0.30)); halo.addColorStop(0.45, rgba(A, st.dark ? 0.16 : 0.12)); halo.addColorStop(1, rgba(A, 0));   // hollow: a calm middle for the text
    const core = g.createRadialGradient(-0.32, -0.38, 0, -0.2, -0.25, 0.9);
    /* hollow (text inside, the tuner): a light centre and a saturated rim, so the note name stays readable */
    const hol = !!opt.hollow;
    core.addColorStop(0, `rgba(255,255,255,${hol ? (st.dark ? 0.08 : 0.5) : st.dark ? 0.55 : 0.9})`); core.addColorStop(1, "rgba(255,255,255,0)");
    st.grads = {
      halo, core,
      a: hol ? body(A, 0.14, 0.9, 0, 0) : body(A, 0.95, 0.55, 0.1, 0.15), b: hol ? body(B, 0, 0.6, 0, 0) : body(B, 0.85, 0.0, -0.1, -0.1),
      lime: body(L, 0.95, 0.5, 0.1, 0.15), ok: hol ? body(G, 0.16, 0.95, 0, 0) : body(G, 0.95, 0.55, 0.1, 0.15),
      flat: hol ? body(F, 0.08, 0.8, 0, 0) : body(F, 0.9, 0.2, 0, 0), sharp: hol ? body(S, 0.08, 0.8, 0, 0) : body(S, 0.9, 0.2, 0, 0),
      ringOk: rgba(G, 1), ringLvl: rgba(A, 1), disc: rgba(A, 1)
    };
  }

  /* ---- size ---- */
  function size() {
    /* layout size (not the bounding box: an entrance scale must not shrink the backing store) */
    const cw = canvas.clientWidth, ch = canvas.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    st.w = cw; st.h = ch; st.dpr = dpr;
    const W = Math.max(1, Math.round(cw * dpr)), H = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    wake();
  }

  /* ---- the blob: a closed curve through N points, quadratic Béziers through the midpoints ---- */
  function blob(j, t, amp, spd) {
    const p2 = PH[j * 3], p3 = PH[j * 3 + 1], p5 = PH[j * 3 + 2];
    const A2 = 0.022 + 0.04 * amp, A3 = 0.012 + 0.032 * amp, A5 = 0.003 + 0.022 * amp;      // a little calmer than §4.5: tidy, not wobbly
    const w2 = (0.6 + spd) * t, w3 = (0.9 + spd) * t * (j === 1 ? -1 : 1), w5 = (1.4 + spd) * t;
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2;
      const r = 1 + A2 * Math.sin(2 * a + p2 + w2) + A3 * Math.sin(3 * a + p3 + w3) + A5 * Math.sin(5 * a + p5 + w5);
      P[i * 2] = COS[i] * r; P[i * 2 + 1] = SIN[i] * r;
    }
    g.beginPath();
    const lx = P[(N - 1) * 2], ly = P[(N - 1) * 2 + 1];
    g.moveTo((lx + P[0]) / 2, (ly + P[1]) / 2);
    for (let i = 0; i < N; i++) {
      const x = P[i * 2], y = P[i * 2 + 1], k = ((i + 1) % N) * 2;
      g.quadraticCurveTo(x, y, (x + P[k]) / 2, (y + P[k + 1]) / 2);
    }
    g.closePath();
  }
  const ease = (cur, target, dt, tau) => cur + (target - cur) * (1 - Math.exp(-dt / tau));

  function frame(now) {
    st.raf = 0;
    if (st.dead || !st.visible || !st.inView) return;
    const dt = Math.min(0.05, st.last ? (now - st.last) / 1000 : 1 / 60); st.last = now;
    if (st.raw > 0.06) st.loud = now;
    /* silence for 10 s: ~24 fps breathing is enough */
    const sleepy = now - st.loud > 10000;
    if (sleepy && now - st.lastDraw < 41) { st.raf = requestAnimationFrame(frame); return; }
    st.t += dt;
    st.lvl = ease(st.lvl, st.raw, dt, st.raw > st.lvl ? 0.04 : 0.18);
    if (st.rawCents !== null) { st.cents = ease(st.cents, st.rawCents, dt, 0.12); st.centsOn = ease(st.centsOn, 1, dt, 0.12); }
    else st.centsOn = ease(st.centsOn, 0, dt, 0.6);
    st.ok = ease(st.ok, st.state === "ok" ? 1 : 0, dt, 0.12);
    /* scale spring (k 170, c 26), sub-stepped */
    const breathe = st.state === "idle" || st.lvl < 0.05 ? 0.03 * Math.sin(st.t * Math.PI / 2) : 0;
    const target = 1 + 0.18 * st.lvl + breathe;
    for (let n = 0, steps = Math.ceil(dt * 120); n < steps; n++) {
      const h = dt / steps;
      st.v += (170 * (target - st.s) - 26 * st.v) * h; st.s += st.v * h;
      st.rv += (260 * ((st.state === "ok" ? 1 : 0) - st.ring) - 18 * st.rv) * h; st.ring += st.rv * h;
    }
    draw();
    st.lastDraw = now;
    st.raf = requestAnimationFrame(frame);
  }

  function draw() {
    if (!st.grads) build();
    const G = st.grads, d = st.dpr, w = st.w, h = st.h; if (!w || !h) return;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
    const R = Math.min(w, h) * 0.3, c = Math.max(-50, Math.min(50, st.cents)) / 50 * st.centsOn;
    let cx = w / 2, cy = h / 2;
    if (st.drift === "x") cx += c * R * 0.28; else if (st.drift === "y") cy -= c * R * 0.2;
    const lv = st.lvl, s = st.s, amp = Math.min(1, lv * 1.2), spd = 2.5 * lv;
    /* the halo, breathing with the level */
    g.setTransform(d * R * 1.75 * (0.85 + 0.35 * lv) * s, 0, 0, d * R * 1.75 * (0.85 + 0.35 * lv) * s, d * cx, d * cy);
    g.globalAlpha = 0.55 + 0.45 * lv; g.fillStyle = G.halo; g.fillRect(-1, -1, 2, 2);
    /* layer A: the hue, with "your sound" (lime) and "in tune" (green) laid over it */
    g.globalAlpha = 1;
    g.setTransform(d * R * s, 0, 0, d * R * s, d * cx, d * cy);
    blob(0, st.t, amp, spd);
    g.fillStyle = G.a; g.fill();
    if (st.mix > 0.01) { g.globalAlpha = st.mix; g.fillStyle = G.lime; g.fill(); }
    if (st.ok > 0.01) { g.globalAlpha = st.ok; g.fillStyle = G.ok; g.fill(); }
    /* layer B: the neighbouring hue, offset (cents lean it: flat cool, sharp warm) */
    const ox = 0.06 * Math.sin(st.t * 0.5), oy = 0.06 * Math.cos(st.t * 0.37);
    g.setTransform(d * R * s * 0.92, 0, 0, d * R * s * 0.92, d * (cx + ox * R), d * (cy + oy * R));
    blob(1, st.t, amp, spd);
    g.globalCompositeOperation = st.dark ? "lighter" : "source-over";
    g.globalAlpha = 0.55 * (1 - st.ok); g.fillStyle = G.b; g.fill();
    const lean = Math.abs(c) * (1 - st.ok);
    if (lean > 0.02) { g.globalAlpha = Math.min(0.7, lean); g.fillStyle = c < 0 ? G.flat : G.sharp; g.fill(); }
    /* layer C: the lit core, up-left */
    g.setTransform(d * R * s * 0.8, 0, 0, d * R * s * 0.8, d * (cx - 0.04 * R), d * (cy - 0.04 * R));
    blob(2, st.t, amp * 0.6, spd);
    g.globalAlpha = 1; g.fillStyle = G.core; g.fill();
    g.globalCompositeOperation = "source-over";
    /* the "locked" ring */
    if (st.ring > 0.02) {
      const rr = R * s * (1 + 0.12 * st.ring);
      g.setTransform(d, 0, 0, d, 0, 0); g.globalAlpha = Math.max(0, Math.min(1, st.ring));
      g.strokeStyle = G.ringOk; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.stroke();
    }
    g.globalAlpha = 1;
  }

  /* reduced motion: a still disc, the level as a ring's opacity, in tune as green */
  function drawStill() {
    st.raf = 0; if (st.dead) return;
    if (!st.grads) build();
    const G = st.grads, d = st.dpr, w = st.w, h = st.h; if (!w || !h) return;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
    const R = Math.min(w, h) * 0.3, cx = w / 2, cy = h / 2, ok = st.state === "ok" ? 1 : 0;
    g.setTransform(d * R, 0, 0, d * R, d * cx, d * cy);
    g.beginPath(); g.arc(0, 0, 1, 0, Math.PI * 2);
    g.fillStyle = G.a; g.fill();
    if (st.mix > 0.01) { g.globalAlpha = st.mix; g.fillStyle = G.lime; g.fill(); }
    if (ok) { g.globalAlpha = 1; g.fillStyle = G.ok; g.fill(); }
    g.globalAlpha = 1; g.fillStyle = G.core; g.fill();
    g.setTransform(d, 0, 0, d, 0, 0);
    g.globalAlpha = Math.max(0.12, Math.min(1, st.raw)); g.strokeStyle = ok ? G.ringOk : G.ringLvl; g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, R * 1.14, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
  }

  function wake() {
    if (st.dead || st.raf) return;
    if (reduce.matches) { st.raf = requestAnimationFrame(drawStill); return; }
    if (!st.visible || !st.inView) return;
    st.last = 0; st.raf = requestAnimationFrame(frame);
  }
  const onVis = () => { st.visible = !document.hidden; if (st.visible) wake(); };
  document.addEventListener("visibilitychange", onVis);
  const ro = window.ResizeObserver ? new ResizeObserver(size) : null; if (ro) ro.observe(canvas);
  const io = window.IntersectionObserver ? new IntersectionObserver(es => { st.inView = es[es.length - 1].isIntersecting; if (st.inView) wake(); }) : null; if (io) io.observe(canvas);
  /* the theme switched: colours again */
  const mo = new MutationObserver(() => { st.grads = null; wake(); });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const onMotion = () => { st.grads = null; cancelAnimationFrame(st.raf); st.raf = 0; wake(); };
  reduce.addEventListener ? reduce.addEventListener("change", onMotion) : reduce.addListener(onMotion);
  st.loud = performance.now();
  size();

  return {
    setLevel(v) { v = +v || 0; st.raw = v < 0 ? 0 : v > 1 ? 1 : v; if (reduce.matches) wake(); },
    setTune(c) { st.rawCents = c === null || c === undefined || !isFinite(c) ? null : +c; if (reduce.matches) wake(); },
    setState(s) { if (st.state !== s) { st.state = s; st.loud = performance.now(); wake(); } },
    setHue(name, mix) { const m = Math.max(0, Math.min(1, +mix || 0)); if (name && name !== st.hue) { st.hue = name; st.grads = null; } st.mix = m; wake(); },
    pulse() { st.v += 2.2; st.loud = performance.now(); wake(); },
    resize: size,
    destroy() {
      st.dead = true; cancelAnimationFrame(st.raf);
      document.removeEventListener("visibilitychange", onVis);
      if (ro) ro.disconnect(); if (io) io.disconnect(); mo.disconnect();
      reduce.removeEventListener ? reduce.removeEventListener("change", onMotion) : reduce.removeListener(onMotion);
    }
  };
}
