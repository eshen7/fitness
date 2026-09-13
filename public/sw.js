/*
 * Deliberately small. The app shell is cached so the logger opens in a gym with
 * no signal, but nothing that reads or writes training data is served stale:
 * a wrong set count on screen is worse than a spinner.
 *
 * The offline write queue lives in the client (IndexedDB, phase 3) rather than
 * here, because a queued set needs to survive a service worker restart and needs
 * to be visible in the UI as pending.
 */
const CACHE = "shell-v1";
const SHELL = ["/", "/today", "/log", "/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never serve data or auth from cache.
  if (url.pathname.startsWith("/api/") || url.pathname === "/unlock") return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && request.mode === "navigate") {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") {
          const offline = await caches.match("/offline");
          if (offline) return offline;
        }
        return new Response("Offline", {
          status: 503,
          headers: { "content-type": "text/plain" },
        });
      }),
  );
});
