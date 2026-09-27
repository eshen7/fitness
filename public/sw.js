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
/** The offline notice and exactly the build output it names, nothing else. */
const BUNDLE = `offline-${VERSION}`;
const KEEP = [PAGES, ASSETS, BUNDLE];

/*
 * The screens worth having before they are first visited: the two the app opens
 * on. `/` is deliberately absent - it only redirects to `/today`, and a
 * redirected response cannot be stored at all. The offline notice is kept apart
 * in BUNDLE, because it is never visited online and so has to be refreshed here.
 */
const SHELL = ["/today", "/log"];
const OFFLINE = "/offline";

/*
 * How often a working connection re-fetches the offline bundle. `/sw.js` is the
 * same bytes on every deploy, so install runs once and cannot be what keeps the
 * bundle on the current build.
 */
const REFRESH_MS = 60 * 60 * 1000;
/** How soon an attempt that did not complete the bundle may try again. */
const RETRY_MS = 5 * 60 * 1000;
/**
 * Both stamps live in the cache, since a worker is stopped whenever it idles.
 * FETCHED_AT is on the document and only a complete bundle carries it; ATTEMPT
 * is its own entry, written before every try, so a failing one still counts.
 */
const FETCHED_AT = "x-fetched-at";
const ATTEMPT = `${OFFLINE}?attempted`;
let refreshing = null;

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

/** Build output a document names: its scripts, stylesheets and preloads. */
const STATIC_REF = /\/_next\/static\/[^"'\\\s<>)]+/g;

/**
 * A shell screen and the build output it names, read out of the document itself
 * rather than listed here, since every build renames every chunk. Without them a
 * screen never visited online is stored but can never hydrate.
 */
async function precache(path) {
  const response = await fetch(path, { cache: "reload", credentials: "same-origin" });
  if (!storable(response)) return;
  const html = await response.clone().text();
  await store(PAGES, new Request(new URL(path, self.location.origin).href), response);

  const refs = new Set(html.match(STATIC_REF) ?? []);
  await Promise.allSettled(
    [...refs].map(async (ref) => {
      const request = new Request(new URL(ref, self.location.origin).href);
      if (await cached(request, ASSETS)) return;
      await store(ASSETS, request, await fetch(request));
    }),
  );
}

/**
 * Re-fetches the offline notice and the build output it names, as one bundle.
 *
 * Chunks go in before the document and stale entries leave after it, so the
 * stored document never names a chunk the cache does not hold. A refresh that
 * could not fetch every chunk keeps the bundle it had; only a first fill, with
 * nothing to fall back on, stores what it got.
 */
async function refreshOffline() {
  const origin = self.location.origin;
  const response = await fetch(OFFLINE, { cache: "reload", credentials: "same-origin" });
  if (!storable(response)) return;
  const html = await response.clone().text();
  const cache = await caches.open(BUNDLE);
  const documentHref = new URL(OFFLINE, origin).href;

  const refs = [...new Set(html.match(STATIC_REF) ?? [])].map((ref) => new URL(ref, origin).href);
  const chunks = await Promise.all(
    refs.map(async (href) => {
      if (await cache.match(href)) return { href, response: null };
      try {
        const chunk = await fetch(href);
        return storable(chunk) ? { href, response: await normalize(chunk) } : null;
      } catch {
        return null;
      }
    }),
  );
  if (chunks.includes(null) && (await cache.match(documentHref))) return;

  const kept = chunks.filter(Boolean);
  await Promise.all(
    kept.filter((chunk) => chunk.response).map((chunk) => cache.put(chunk.href, chunk.response)),
  );
  const stored = await normalize(response);
  const headers = new Headers(stored.headers);
  if (!chunks.includes(null)) headers.set(FETCHED_AT, String(Date.now()));
  await cache.put(documentHref, new Response(await stored.arrayBuffer(), { headers }));

  const live = new Set([
    documentHref,
    new URL(ATTEMPT, origin).href,
    ...kept.map((chunk) => chunk.href),
  ]);
  const keys = await cache.keys();
  await Promise.all(keys.filter((key) => !live.has(key.url)).map((key) => cache.delete(key)));
}

/** Never awaited by a response, and never allowed to throw into one. */
function refreshOfflineSoon() {
  refreshing ??= (async () => {
    const now = Date.now();
    const current = await cached(OFFLINE, BUNDLE);
    const fetchedAt = Number(current?.headers.get(FETCHED_AT) ?? 0);
    if (now - fetchedAt < REFRESH_MS) return;
    const attempt = await cached(ATTEMPT, BUNDLE);
    const attemptedAt = Number((await attempt?.text()) ?? 0);
    if (now - attemptedAt < RETRY_MS) return;
    const cache = await caches.open(BUNDLE);
    await cache.put(new URL(ATTEMPT, self.location.origin).href, new Response(String(now)));
    await refreshOffline();
  })()
    .catch(() => {})
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      // One request at a time, each allowed to fail on its own: `addAll` is
      // atomic, so under the old code a single 404 or a redirect to `/unlock`
      // meant the whole shell - including the offline page - cached nothing.
      await Promise.allSettled([...SHELL.map(precache), refreshOfflineSoon()]);
      await trim(ASSETS, ASSET_LIMIT);
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
  const hit = (await cached(request, ASSETS)) ?? (await cached(request, BUNDLE));
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
async function pageFirst(event) {
  const { request } = event;
  try {
    const response = await fetch(request);
    if (storable(response)) {
      const copy = response.clone();
      store(PAGES, request, copy);
      // A navigation that just answered is the proof of a working connection.
      event.waitUntil(refreshOfflineSoon());
    }
    return response;
  } catch {
    return (
      (await cached(request, PAGES)) ??
      (await cached(OFFLINE, BUNDLE)) ??
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
    event.respondWith(pageFirst(event));
    return;
  }

  /*
   * Everything else - above all the `?_rsc=` payloads behind client navigation -
   * is left to the network and allowed to fail. Serving one from cache would put
   * a stale screen behind a tap that looked live, and failing is what makes the
   * router fall back to a full navigation, which lands on the branch above.
   */
});
