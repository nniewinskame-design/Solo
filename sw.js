/* Solo service worker: everything works offline after the first visit (photo reading too, once its files are here).
   Two caches: the app's own files ("solo-vNN", bump on every deploy) and the big libraries ("solo-libs": Verovio,
   pdf.js, fonts, the reader's runtime, tens of MB) which survive an update and are checked against the server in
   the background, so a changed library still arrives without the version being bumped. The reader's models
   ("homr-web-models", ~150 MB) and files shared to Solo ("solo-shared") are never touched here. */
const CACHE = "solo-v61";
const LIBS = "solo-libs";
const SHELL = ["./", "index.html", "styles.css", "listen.css", "theme.js", "core.js", "arrange.js", "motion.js", "orb.js", "app.js", "profile.js", "ownsound.js", "clefs.js", "manifest.webmanifest",
  "prywatnosc.html", "regulamin.html", "licencje.html", "legal.js",
  "icons/favicon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];
const LIB_FILES = ["fonts/fonts.css", "fonts/geist-latin.woff2", "fonts/geist-latinext.woff2",
  
  "vendor/verovio-toolkit-wasm.js", "vendor/jszip.min.js", "vendor/pdf.min.js", "vendor/pdf.worker.min.js"];
/* "reload": past the browser's HTTP cache (GitHub Pages keeps files 10 minutes), so a new version is not filled
   with the old files. Libraries already here are not downloaded again. */
self.addEventListener("install", e => {
  e.waitUntil(Promise.all([
    caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))),
    caches.open(LIBS).then(async c => { await adoptOldLibs(c); for (const u of LIB_FILES) if (!(await c.match(u))) { try { await c.add(new Request(u, { cache: "reload" })); } catch (err) { console.warn(u, err); } } })
  ]));
});
/* up to 3.9 the libraries and the reader's runtime lived in "solo-vNN" and went with every update: take them over
   once instead of downloading tens of MB again */
async function adoptOldLibs(c) {
  for (const k of await caches.keys()) {
    if (!/^solo-v\d+$/.test(k)) continue;
    const old = await caches.open(k);
    for (const req of await old.keys()) {
      const u = new URL(req.url);
      if (!/\/(vendor|fonts|homr)\//.test(u.pathname) || u.pathname.includes("/homr/models/")) continue;
      const key = u.origin + u.pathname;
      if (!(await c.match(key))) { const r = await old.match(req); if (r && r.status === 200) await c.put(key, r); }
    }
  }
}
/* the new version waits until the page says so ("Odśwież", or right after a fresh start): never in the middle of
   something, never new files under an old page */
self.addEventListener("message", e => { if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting(); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => /^solo-v\d+$/.test(k) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
/* Hosts that can't send headers (GitHub Pages) still get cross-origin isolation, which the
   on-device reader needs for its fast multi-threaded mode: the worker adds the headers itself. */
function isolate(r) {
  if (!r || r.status === 0 || r.type === "opaqueredirect" || r.type === "error") return r;
  const h = new Headers(r.headers);
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  h.set("Cross-Origin-Embedder-Policy", "require-corp");
  h.set("Cross-Origin-Resource-Policy", "same-origin");
  h.set("X-Content-Type-Options", "nosniff");
  return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
}
/* T21: files shared to Solo (e.g. a PDF attachment from Gmail): keep them, then open the app; a failure is said */
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    e.respondWith((async () => {
      let ok = true;
      try {
        const fd = await e.request.formData(), files = fd.getAll("file").filter(f => f && f.size);
        const c = await caches.open("solo-shared"); await Promise.all((await c.keys()).map(k => c.delete(k)));
        await Promise.all(files.map((f, i) => c.put(new Request("shared/" + i), new Response(f, { headers: { "content-type": f.type || "application/octet-stream", "x-name": encodeURIComponent(f.name || "plik") } }))));
      } catch (err) { console.warn(err); ok = false; }
      return Response.redirect(new URL(ok ? "./?shared=1" : "./?shared=err", self.registration.scope).href, 303);
    })());
  }
});
const keyOf = url => url.origin + url.pathname;          // ?shared=1 and the like are not cached as separate pages
const checked = new Set();                               // libraries compared with the server once per run of the worker
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url), req = e.request;
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.pathname.includes("/homr/models/")) return;      // the reader keeps its own model cache
  if (req.headers.has("range")) return;                    // a part of a file: the browser handles it
  if (/\/(vendor|fonts|homr)\//.test(url.pathname)) { e.respondWith(lib(e, req, keyOf(url)).then(isolate)); return; }
  e.respondWith(fresh(e, req, url).then(isolate));
});
/* app files: the network first (a deploy shows up at once), the stored copy after 3 s (a school's weak Wi-Fi) or offline */
function fresh(e, req, url) {
  const key = keyOf(url), cachedP = caches.match(key, { ignoreSearch: true });
  const net = fetch(req, { cache: "no-cache" });
  e.waitUntil(net.then(r => { if (r.status === 200) { const cl = r.clone(); return caches.open(CACHE).then(c => c.put(key, cl)); } }).catch(() => {}));
  return new Promise(resolve => {
    let done = false;
    const fallback = async () => {
      const c = await cachedP;
      if (c) return c;
      return req.mode === "navigate" ? (await caches.match("./")) || (await caches.match("index.html")) || Response.error() : Response.error();
    };
    const t = setTimeout(async () => { const c = await cachedP; if (c && !done) { done = true; resolve(c); } }, 3000);
    net.then(r => { if (!done) { done = true; clearTimeout(t); resolve(r); } },
      async () => { clearTimeout(t); const r = await fallback(); if (!done) { done = true; resolve(r); } });
  });
}
/* libraries: the stored copy at once; once per run its ETag is checked and a changed file is fetched for next time */
async function lib(e, req, key) {
  const c = await caches.open(LIBS), hit = await c.match(key);
  if (!hit) {
    const r = await fetch(req);
    if (r.status === 200) e.waitUntil(c.put(key, r.clone()).catch(err => console.warn(err)));
    return r;
  }
  if (!checked.has(key)) {
    checked.add(key);
    const tag = hit.headers.get("etag"), mod = hit.headers.get("last-modified"), h = {};
    if (tag) h["If-None-Match"] = tag; else if (mod) h["If-Modified-Since"] = mod;
    e.waitUntil(fetch(key, { cache: "no-store", headers: h }).then(r => { if (r.status === 200) return c.put(key, r); }).catch(() => {}));
  }
  return hit;
}
