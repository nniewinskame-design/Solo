/* Solo service worker: works offline after the first visit (photo reading still needs internet). */
const CACHE = "solo-v19";
const SHELL = ["./", "index.html", "styles.css", "theme.js", "core.js", "motion.js", "app.js", "clefs.js", "manifest.webmanifest",
  "prywatnosc.html", "regulamin.html", "licencje.html", "legal.js",
  "fonts/fonts.css", "fonts/geist-latin.woff2", "fonts/geist-latinext.woff2",
  "img/window.jpg", "img/brass.jpg", "img/flatlay.jpg", "img/piano.jpg",
  "icons/favicon.svg", "icons/icon-192.png", "icons/apple-touch-icon.png",
  "vendor/verovio-toolkit-wasm.js", "vendor/jszip.min.js", "vendor/pdf.min.js", "vendor/pdf.worker.min.js"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
/* Hosts that can't send headers (GitHub Pages) still get cross-origin isolation, which the
   on-device reader needs for its fast multi-threaded mode: the worker adds the headers itself. */
function isolate(r) {
  if (!r || r.status === 0 || r.type === "opaqueredirect") return r;
  const h = new Headers(r.headers);
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Embedder-Policy", "require-corp");
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  h.set("X-Content-Type-Options", "nosniff");
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/homr/models/")) return;      // the reader keeps its own model cache
  const big = /\/(vendor|fonts|img|icons|homr)\//.test(url.pathname);
  if (big) {
    e.respondWith(caches.open(CACHE).then(async c => (await c.match(e.request)) || fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; })).then(isolate));
  } else {
    /* revalidate (ETag) instead of trusting the HTTP cache: GitHub Pages lets files go stale for
       10 minutes, which right after a deploy pairs new HTML with old CSS/JS */
    e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => { if (r.ok) { const cl = r.clone(); caches.open(CACHE).then(c => c.put(e.request, cl)); } return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("index.html"))).then(isolate));
  }
});
