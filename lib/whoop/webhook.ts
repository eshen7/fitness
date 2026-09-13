import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Webhook signature verification, kept pure so it can be tested without a
 * request. This endpoint is the one path into the app that no session protects,
 * so the check is the whole of its authentication.
 */

export const WHOOP_SIGNATURE_HEADER = "x-whoop-signature";
export const WHOOP_TIMESTAMP_HEADER = "x-whoop-signature-timestamp";

/**
 * How stale a delivery may be and still be accepted.
 *
 * A signature with no freshness window is replayable forever, and a replayed
 * `sleep.updated` would re-fetch and overwrite a night that has since been
 * corrected. Five minutes is far longer than a delivery takes and far shorter
 * than a useful replay.
 */
export const WHOOP_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * The payload carries identifiers only, never the measurements themselves, so
 * every event is followed by a fetch of that record from the v2 API.
 */
export const whoopWebhookPayload = z.object({
  user_id: z.number(),
  id: z.union([z.string(), z.number()]).transform(String),
  type: z.string(),
  trace_id: z.string().optional(),
});

export type WhoopWebhookPayload = z.infer<typeof whoopWebhookPayload>;

export function whoopSignature(
  timestamp: string,
  rawBody: string,
  clientSecret: string,
) {
  return createHmac("sha256", clientSecret)
    .update(timestamp + rawBody)
    .digest("base64");
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "stale" | "mismatch" };

/**
 * `now` is injected rather than read so the staleness branch is testable without
 * faking the clock globally.
 */
export function verifyWhoopSignature({
  signature,
  timestamp,
  rawBody,
  clientSecret,
  now = Date.now(),
}: {
  signature: string | null;
  timestamp: string | null;
  rawBody: string;
  clientSecret: string;
  now?: number;
}): VerifyResult {
  if (!signature || !timestamp) return { ok: false, reason: "missing" };

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return { ok: false, reason: "missing" };
  if (Math.abs(now - sentAt) > WHOOP_TIMESTAMP_TOLERANCE_MS) {
    return { ok: false, reason: "stale" };
  }

  const expected = Buffer.from(
    whoopSignature(timestamp, rawBody, clientSecret),
    "base64",
  );
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64");
  } catch {
    return { ok: false, reason: "mismatch" };
  }
  // Length has to match before the constant-time compare, which throws on
  // mismatched lengths rather than returning false.
  if (received.length !== expected.length) return { ok: false, reason: "mismatch" };
  return timingSafeEqual(received, expected)
    ? { ok: true }
    : { ok: false, reason: "mismatch" };
}

/**
 * WHOOP event types map onto the record types the app stores. Deletes arrive as
 * their own event rather than as an update carrying a flag.
 */
export function parseWhoopEventType(type: string) {
  const [entity, action] = type.split(".");
  const known = ["recovery", "sleep", "workout", "cycle"] as const;
  const record = known.find((k) => k === entity);
  if (!record) return null;
  return { record, deleted: action === "deleted" };
}
