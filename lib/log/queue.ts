import type { LoggedSetInput } from "@/lib/log/schemas";

/**
 * The offline set queue, as an external store.
 *
 * A set is written to local storage first and posted second. Gym wifi is the
 * canonical case of a connection that answers a ping and then drops a request, and
 * a logger that loses a set to it stops being used. Every item carries a
 * `clientId` that has a unique index on the table, so a flush that runs twice, or
 * from two tabs at once, writes once.
 *
 * Read it through `useSyncExternalStore` rather than copying it into component
 * state: local storage is the source of truth here, it is shared across tabs, and
 * the server render has no access to it. That hook is built for exactly this shape,
 * and it keeps the hydration render from ever reading the device.
 */

const KEY = "log-queue:v1";

export type Rejection = { clientId: string; message: string };

/**
 * The whole store, snapshotted as one object.
 *
 * The last flush's outcome lives here beside the items rather than in component
 * state, because it is a property of the queue and not of a render: it is produced
 * by a flush that may have been triggered by the `online` event with no user
 * interaction behind it at all.
 */
export type QueueState = {
  items: LoggedSetInput[];
  /** Why the last flush did not land, when the app answered and said no. */
  error: string | null;
  /**
   * The last flush could not reach the app at all.
   *
   * Held apart from `error` because it is a fact about the connection rather than
   * about these sets, and the connection bar is what says it. Folded together, a
   * screen that logs a set with no signal shows the same sentence twice: once in
   * the bar across the top and once in the form's own notice.
   */
  unreachable: boolean;
  /** Sets the server refused. Dropped from the queue, kept here to be told about. */
  rejected: Rejection[];
};

/** Stable references: a new value on each read would loop the store. */
const EMPTY: LoggedSetInput[] = [];
const NO_REJECTIONS: Rejection[] = [];

let state: QueueState = {
  items: EMPTY,
  error: null,
  unreachable: false,
  rejected: NO_REJECTIONS,
};
let loaded = false;
const listeners = new Set<() => void>();

function parse(raw: string | null): LoggedSetInput[] {
  if (!raw) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LoggedSetInput[]) : EMPTY;
  } catch {
    // Corrupt storage is not worth a crash mid-session; start clean.
    return EMPTY;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function set(next: Partial<QueueState>) {
  state = { ...state, ...next };
  emit();
}

function commit(items: LoggedSetInput[], rest: Partial<QueueState> = {}) {
  const stored = items.length ? items : EMPTY;
  localStorage.setItem(KEY, JSON.stringify(stored));
  set({ items: stored, ...rest });
}

/** Another tab logged or flushed a set, so this one's copy is stale. */
function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== KEY) return;
  loaded = true;
  set({ items: parse(localStorage.getItem(KEY)) });
}

export function subscribeQueue(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

export function getQueueSnapshot(): QueueState {
  if (!loaded) {
    loaded = true;
    state = { ...state, items: parse(localStorage.getItem(KEY)) };
  }
  return state;
}

/** The server has no device storage, so it renders an empty queue. */
const SERVER_STATE: QueueState = {
  items: EMPTY,
  error: null,
  unreachable: false,
  rejected: NO_REJECTIONS,
};

export function getServerQueueSnapshot(): QueueState {
  return SERVER_STATE;
}

export function enqueue(item: LoggedSetInput) {
  commit([...getQueueSnapshot().items, item], { error: null });
}

export function dequeue(clientIds: string[]) {
  const drop = new Set(clientIds);
  commit(getQueueSnapshot().items.filter((item) => !drop.has(item.clientId)));
}

/** Clears the last outcome once it has been read, so it is not shown forever. */
export function acknowledgeQueue() {
  set({ error: null, rejected: NO_REJECTIONS });
}

export type FlushOutcome = {
  /** Sets the server took, whether newly or as a duplicate it already had. */
  accepted: number;
  /** Sets the server refused as invalid. Dropped, since a retry cannot help. */
  rejected: Rejection[];
  /** Still queued: the request never landed. */
  remaining: number;
  /** Set when the flush could not complete. */
  error?: string;
  /** The request never reached the app, as opposed to the app refusing it. */
  unreachable: boolean;
};

/**
 * Posts everything queued. Accepted and rejected sets both leave the queue;
 * anything else stays, because "the request did not land" is the one case a retry
 * fixes.
 */
export async function flushQueue(): Promise<FlushOutcome> {
  const sets = getQueueSnapshot().items;
  if (sets.length === 0) {
    return { accepted: 0, rejected: NO_REJECTIONS, remaining: 0, unreachable: false };
  }

  const unsent = (error: string, unreachable = false): FlushOutcome => {
    set({ error: unreachable ? null : error, unreachable });
    return {
      accepted: 0,
      rejected: NO_REJECTIONS,
      remaining: sets.length,
      error,
      unreachable,
    };
  };

  let response: Response;
  try {
    response = await fetch("/api/log/sets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sets }),
    });
  } catch {
    // The only branch where nothing answered. The message is for the caller's
    // own reporting; on screen the connection bar has already said it.
    return unsent("Offline. Sets are saved on this device.", true);
  }

  if (response.status === 401) {
    return unsent("Session expired. Unlock again and these will send.");
  }
  if (!response.ok) {
    return unsent(
      `The server refused the batch (${response.status}). Sets are still saved here.`,
    );
  }

  const body = (await response.json()) as {
    accepted?: string[];
    rejected?: { clientId: string; message: string }[];
  };
  const accepted = body.accepted ?? [];
  const rejected = body.rejected ?? NO_REJECTIONS;
  const drop = new Set([
    ...accepted,
    ...rejected.map((item) => item.clientId),
  ]);
  const remaining = getQueueSnapshot().items.filter(
    (item) => !drop.has(item.clientId),
  );
  commit(remaining, { error: null, unreachable: false, rejected });

  return {
    accepted: accepted.length,
    rejected,
    remaining: remaining.length,
    unreachable: false,
  };
}
