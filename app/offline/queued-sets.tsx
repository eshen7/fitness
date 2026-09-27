"use client";

import { useSyncExternalStore } from "react";
import {
  getQueueSnapshot,
  getServerQueueSnapshot,
  subscribeQueue,
} from "@/lib/log/queue";

/**
 * What the offline screen is actually for: telling you your sets are not lost.
 *
 * The queue lives in local storage, so this page can read it with no server and
 * no session - which is the only reason it is worth having a real route here
 * rather than only the flat fallback the service worker builds itself.
 */
export function QueuedSets() {
  const queue = useSyncExternalStore(
    subscribeQueue,
    getQueueSnapshot,
    getServerQueueSnapshot,
  );
  const count = queue.items.length;

  return (
    <p className="mt-2 max-w-xs text-sm text-ink-muted text-balance">
      {count > 0 ? (
        <>
          <span className="tnum font-medium text-ink">{count}</span>{" "}
          {count === 1 ? "set is" : "sets are"} waiting on this device and will
          send {count === 1 ? "itself" : "themselves"} as soon as signal comes
          back. Keep training.
        </>
      ) : (
        <>
          Anything you log while offline is kept on this device and sent as soon
          as signal comes back. Keep training.
        </>
      )}
    </p>
  );
}
