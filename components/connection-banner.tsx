"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  flushQueue,
  getQueueSnapshot,
  getServerQueueSnapshot,
  subscribeQueue,
} from "@/lib/log/queue";

/**
 * The connection bar.
 *
 * Deliberately not built on `navigator.onLine`, which answers "is there a network
 * interface" rather than "can this phone reach the app". It is true on gym wifi
 * that associated and then stopped forwarding, which is the case this whole
 * offline path exists for, and it is true for a page the service worker served
 * out of its cache with no server anywhere in reach. So the state comes from an
 * actual request, and the `online` and `offline` events are only used as hints
 * that it is worth asking again.
 *
 * The bar also carries the queued-set count, because that is the number that
 * decides whether it is safe to close the app: the sets are on the device, and
 * nothing has happened to them until it reads zero.
 */

const PROBE = "/api/health";
const PROBE_TIMEOUT_MS = 6000;
/** How often to re-check while offline. Nothing polls while the answer is yes. */
const RETRY_MS = 8000;

async function probe(): Promise<boolean> {
  const controller = new AbortController();
  // A request that hangs is the gym-wifi failure, so a timeout is part of the
  // answer rather than a nicety - without it the bar never appears at all.
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // Any answer counts, 401 and 503 included: the question is whether the app
    // is reachable, not whether it is happy. Saying "offline" because the
    // database is down would send the owner looking at their phone signal.
    await fetch(PROBE, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function ConnectionBanner() {
  const queue = useSyncExternalStore(
    subscribeQueue,
    getQueueSnapshot,
    getServerQueueSnapshot,
  );
  // Optimistic: the bar must not flash on every load of a working connection.
  const [online, setOnline] = useState(true);
  const [checking, setChecking] = useState(false);
  const mounted = useRef(false);

  const apply = useCallback((reachable: boolean) => {
    if (!mounted.current) return;
    setOnline(reachable);
    // Coming back is the moment the queue should empty itself, whether or not
    // the logger is the screen on show.
    if (reachable) void flushQueue();
  }, []);

  /** The background check. Touches no state until the probe has answered. */
  const check = useCallback(async () => {
    apply(await probe());
  }, [apply]);

  /**
   * The same check with a pending state, which only the button needs: an
   * automatic probe that flickered a label nobody asked for would be noise, and
   * setting it from an effect is a synchronous render nobody is waiting on.
   */
  const retry = useCallback(async () => {
    setChecking(true);
    apply(await probe());
    if (mounted.current) setChecking(false);
  }, [apply]);

  useEffect(() => {
    mounted.current = true;
    // One probe per full page load. The page it is on already made several, and
    // it is the only way to be right about a document served from the cache.
    void check();

    const onOffline = () => setOnline(false);
    const onOnline = () => void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };

    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      mounted.current = false;
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check]);

  // A flush that could not reach the app is harder evidence than any event, so
  // let it ask. A flush the app refused is not: that connection is fine.
  useEffect(() => {
    if (queue.unreachable) void check();
  }, [queue.unreachable, check]);

  useEffect(() => {
    if (online) return;
    const timer = setInterval(() => void check(), RETRY_MS);
    return () => clearInterval(timer);
  }, [online, check]);

  const count = queue.items.length;
  if (online && count === 0) return null;

  return (
    <div className="sticky top-0 z-30 -mx-4 mb-4 border-b border-line bg-surface-raised md:-mx-8">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-2.5 md:px-8">
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${online ? "bg-warn" : "bg-bad"}`}
        />
        <p role="status" className="min-w-0 flex-1 text-xs text-ink-muted">
          {online ? (
            <>
              <span className="font-medium text-ink">
                {count} {count === 1 ? "set" : "sets"} still to send.
              </span>{" "}
              Saved on this device until they land.
            </>
          ) : (
            <>
              <span className="font-medium text-ink">Offline.</span>{" "}
              {count > 0
                ? `${count} ${count === 1 ? "set is" : "sets are"} saved on this device and will send ${count === 1 ? "itself" : "themselves"}.`
                : "Anything you log is saved on this device until signal comes back."}
            </>
          )}
        </p>
        <button
          type="button"
          onClick={() => void retry()}
          disabled={checking}
          // Negative margin so a 44px target does not set the height of the bar.
          className="-my-2 flex min-h-11 shrink-0 items-center rounded-field px-3 text-xs font-semibold text-accent disabled:opacity-50"
        >
          {checking ? "Checking" : "Retry"}
        </button>
      </div>
    </div>
  );
}
