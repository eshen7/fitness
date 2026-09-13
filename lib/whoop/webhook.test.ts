import { describe, expect, it } from "vitest";
import {
  parseWhoopEventType,
  verifyWhoopSignature,
  whoopSignature,
  whoopWebhookPayload,
  WHOOP_TIMESTAMP_TOLERANCE_MS,
} from "./webhook";

const SECRET = "test-client-secret";
const NOW = 1_757_800_000_000;

function signed(body: string, at = NOW) {
  const timestamp = String(at);
  return {
    signature: whoopSignature(timestamp, body, SECRET),
    timestamp,
    rawBody: body,
    clientSecret: SECRET,
    now: NOW,
  };
}

describe("verifyWhoopSignature", () => {
  const body = JSON.stringify({
    user_id: 12345,
    id: "9f1c0f6e-2a3b-4c5d-8e9f-0a1b2c3d4e5f",
    type: "sleep.updated",
    trace_id: "trace-1",
  });

  it("accepts a correctly signed, fresh delivery", () => {
    expect(verifyWhoopSignature(signed(body))).toEqual({ ok: true });
  });

  it("rejects a delivery with no signature or timestamp", () => {
    expect(
      verifyWhoopSignature({ ...signed(body), signature: null }),
    ).toEqual({ ok: false, reason: "missing" });
    expect(verifyWhoopSignature({ ...signed(body), timestamp: null })).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("rejects a signature computed over a different body", () => {
    const tampered = { ...signed(body), rawBody: body.replace("12345", "99999") };
    expect(verifyWhoopSignature(tampered)).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });

  it("rejects a signature computed with the wrong secret", () => {
    expect(
      verifyWhoopSignature({ ...signed(body), clientSecret: "other-secret" }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects a valid signature outside the freshness window", () => {
    const stale = signed(body, NOW - WHOOP_TIMESTAMP_TOLERANCE_MS - 1000);
    expect(verifyWhoopSignature(stale)).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects a timestamp far in the future", () => {
    const skewed = signed(body, NOW + WHOOP_TIMESTAMP_TOLERANCE_MS + 1000);
    expect(verifyWhoopSignature(skewed)).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects a signature that is not the expected length", () => {
    expect(verifyWhoopSignature({ ...signed(body), signature: "c2hvcnQ=" })).toEqual(
      { ok: false, reason: "mismatch" },
    );
  });

  it("signs the timestamp prepended to the body, not the body alone", () => {
    const timestamp = String(NOW);
    expect(whoopSignature(timestamp, body, SECRET)).not.toEqual(
      whoopSignature("", body, SECRET),
    );
  });
});

describe("whoopWebhookPayload", () => {
  it("accepts a v2 uuid id and a v1 numeric id alike", () => {
    expect(
      whoopWebhookPayload.parse({ user_id: 1, id: "abc-def", type: "sleep.updated" })
        .id,
    ).toBe("abc-def");
    expect(
      whoopWebhookPayload.parse({ user_id: 1, id: 987654, type: "recovery.updated" })
        .id,
    ).toBe("987654");
  });
});

describe("parseWhoopEventType", () => {
  it("splits the entity from the action", () => {
    expect(parseWhoopEventType("sleep.updated")).toEqual({
      record: "sleep",
      deleted: false,
    });
    expect(parseWhoopEventType("recovery.deleted")).toEqual({
      record: "recovery",
      deleted: true,
    });
    expect(parseWhoopEventType("workout.updated")).toEqual({
      record: "workout",
      deleted: false,
    });
  });

  it("returns null for an entity the app does not store", () => {
    expect(parseWhoopEventType("nutrition.updated")).toBeNull();
  });
});
