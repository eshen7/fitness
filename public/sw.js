/*
 * The offline shell.
 *
 * The app shell is cached so the logger opens in a gym with no signal, but
 * nothing that reads or writes training data is served stale: a wrong set count
 * on screen is worse than a spinner. The offline write queue lives in the client
 * (`lib/log/queue.ts`) rather than here, because a queued set has to survive a
 * service worker restart and has to be visible in the UI as pending.
 *
 * Three things here are load-bearing and easy to undo by accident.
 *
 * 1. Build output is cached. A cached document that cannot fetch its own
 *    JavaScript renders as bare unhydrated HTML, so caching pages without
 *    caching `/_next/static/` buys nothing on a cold launch - it only looks like
 *    it works, because Chrome's own HTTP cache covers the warm case and is
 *    evictable.
 *
 * 2. Everything stored is rebuilt as a fresh Response first. Next sends
 *    `Vary: rsc, next-router-state-tree, ...` on documents, which makes a cache
 *    hit depend on request headers a navigation does not carry, and a stored
 *    `Content-Encoding` can outlive the encoded bytes. Neither header survives
 *    `store()`, and every read passes `ignoreVary`.
 *
 * 3. The offline fallback ends in a Response built in this file. A fallback that
 *    can only come out of the cache fails exactly when it is needed - the first
 *    launch, a wiped cache, an install that happened while the app was locked -
 *    and the browser shows its own error page instead.
 */

const VERSION = "v2";
const PAGES = `pages-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const KEEP = [PAGES, ASSETS];

/*
 * The screens worth having before they are first visited: the two the app opens
 * on, and the offline notice itself. `/` is deliberately absent - it only
 * redirects to `/today`, and a redirected response cannot be stored at all.
 */
const SHELL = ["/today", "/log", "/offline"];
const OFFLINE = "/offline";

/** Content-hashed, so a URL match is an exact-bytes match and cannot go stale. */
const IMMUTABLE = ["/_next/static/", "/icons/"];

/*
 * A ceiling on the asset cache, trimmed oldest-first. Cache keys come back in
 * insertion order, so this is a FIFO. It exists because a rebuild changes every
 * hash: without it the cache grows by a whole build's worth of chunks every
 * deploy and never gives any of it back.
 */
const ASSET_LIMIT = 240;

/** The last resort. Inline, so it needs no cache, no session and no server. */
const OFFLINE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Offline</title>
<style>
  html { color-scheme: dark }
  body {
    margin: 0; min-height: 100dvh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 1rem; padding: 1.5rem;
    text-align: center; background: oklch(16.5% 0.008 255);
    color: oklch(92% 0.006 255);
    font: 400 0.875rem/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
  }
  h1 { margin: 0; font-size: 1.25rem; font-weight: 600 }
  p { margin: 0; max-width: 20rem; color: oklch(64% 0.008 255) }
  button {
    min-height: 44px; padding: 0 1.25rem; border: 0; border-radius: 0.625rem;
    background: oklch(80% 0.128 168); color: oklch(22% 0.045 168);
    font: 600 1rem/1 inherit; font-family: inherit;
  }
</style>
</head>
<body>
<h1>No connection</h1>
<p>Anything you logged is saved on this device and sends itself as soon as signal comes back.</p>
<button type="button" onclick="location.reload()">Try again</button>
</body>
</html>
`;

function offlineDocument() {
  return new Response(OFFLINE_HTML, {
    status: 503,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/**
 * A response as it goes into a cache: the bytes, the type, and nothing else.
 *
 * Dropping the headers is the point rather than a saving. `Vary` on a stored
 * response makes the match depend on request headers, and this app's documents
 * vary on the router headers a plain navigation never sends.
 */
async function normalize(response) {
  const body = await response.arrayBuffer();
  const headers = new Headers();
  const type = response.headers.get("content-type");
  if (type) headers.set("content-type", type);
  return new Response(body, { status: 200, statusText: "OK", headers });
}

/** True when a response is worth keeping at all. */
function storable(response) {
  // `redirected` matters twice over: `cache.put` throws on one, and the redirect
  // in question is the passcode gate, so caching it would pin the whole app to
  // the unlock screen for as long as the cache lived.
  return Boolean(response) && response.ok && response.type === "basic" && !response.redirected;
}

async function store(cacheName, request, response) {
  if (!storable(response)) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, await normalize(response));
}

async function trim(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}

function cached(request, cacheName) {
  return caches.match(request, { cacheName, ignoreVary: true });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // One request at a time, each allowed to fail on its own: `addAll` is
      // atomic, so under the old code a single 404 or a redirect to `/unlock`
      // meant the whole shell - including the offline page - cached nothing.
      await Promise.allSettled(
        SHELL.map(async (path) => {
          const response = await fetch(path, {
            cache: "reload",
            credentials: "same-origin",
          });
          await store(PAGES, new Request(new URL(path, self.location.origin).href), response);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => !KEEP.includes(key)).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Immutable build output: cache first, since a hit is by definition correct. */
async function assetFirst(request) {
  const hit = await cached(request, ASSETS);
  if (hit) return hit;
  const response = await fetch(request);
  if (storable(response)) {
    const copy = response.clone();
    // Not awaited: the page should not wait on bookkeeping to get its chunk.
    store(ASSETS, request, copy).then(() => trim(ASSETS, ASSET_LIMIT));
  }
  return response;
}

/**
 * Documents: network first, cache as the fallback.
 *
 * Network first rather than cache first because the cached copy of a training
 * screen is a snapshot of an earlier day. It is the right thing to show when
 * there is no signal and the wrong thing to show when there is.
 */
async function pageFirst(request) {
  try {
    const response = await fetch(request);
    if (storable(response)) {
      const copy = response.clone();
      store(PAGES, request, copy);
    }
    return response;
  } catch {
    return (
      (await cached(request, PAGES)) ??
      (await cached(OFFLINE, PAGES)) ??
      offlineDocument()
    );
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Data and auth are never served from cache, and neither is the export, which
  // says `no-store` for the same reason: a stale archive looks current.
  if (url.pathname.startsWith("/api/") || url.pathname === "/unlock") return;

  if (IMMUTABLE.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(assetFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(pageFirst(request));
    return;
  }

  /*
   * Everything else - above all the `?_rsc=` payloads behind client navigation -
   * is left to the network and allowed to fail. Serving one from cache would put
   * a stale screen behind a tap that looked live, and failing is what makes the
   * router fall back to a full navigation, which lands on the branch above.
   */
});
