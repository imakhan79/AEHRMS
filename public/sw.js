// AE HRMS service worker: lets the attendance page open offline (ATT-08 / ESS-11).
// Punches captured offline are queued in IndexedDB by the page itself.
const CACHE = "ae-hrms-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Immutable build assets: cache-first.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // The attendance page: network-first, last good copy when offline.
  if (req.mode === "navigate" && url.pathname === "/attendance") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put("/attendance", copy));
          }
          return res;
        })
        .catch(() => caches.match("/attendance").then((hit) => hit || Response.error())),
    );
  }
});

// Sign-out clears cached pages so the next user of a shared device sees nothing.
self.addEventListener("message", (event) => {
  if (event.data === "clear-cache") event.waitUntil(caches.delete(CACHE));
});
