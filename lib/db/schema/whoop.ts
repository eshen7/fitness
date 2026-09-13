import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { stamps } from "./_shared";
import { whoopRecordType } from "./enums";

/**
 * The OAuth token pair, as a single row pinned at id 1.
 *
 * Refreshing rotates the refresh token and invalidates the previous access
 * token, so the pair must be replaced in one transaction. A partial write leaves
 * a refresh token that WHOOP has already retired and silently kills the
 * connection until it is re-authorized by hand.
 */
export const whoopConnection = pgTable("whoop_connection", {
  id: integer().primaryKey().default(1),
  whoopUserId: text("whoop_user_id"),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  /** Access tokens last one hour. */
  accessTokenExpiresAt: timestamp("access_token_expires_at", {
    withTimezone: true,
  }).notNull(),
  scopes: text().array().notNull().default([]),
  lastRefreshedAt: timestamp("last_refreshed_at", { withTimezone: true }),
  /** Set when a refresh fails terminally, so the UI can prompt a reconnect. */
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  invalidatedReason: text("invalidated_reason"),
  ...stamps,
});

/**
 * Raw WHOOP payloads, kept verbatim and keyed by WHOOP's own id. Normalised
 * values are projected out of here into `measurements` and `readinessCheckins`,
 * so a projection bug or a schema change is replayable without refetching.
 */
export const whoopRecords = pgTable(
  "whoop_records",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    type: whoopRecordType().notNull(),
    /** WHOOP's record id. UUID for v2 sleep and workout, integer for cycles. */
    whoopId: text("whoop_id").notNull(),
    /** Start of the record's own window, used to align it to a training day. */
    recordStart: timestamp("record_start", { withTimezone: true }),
    recordEnd: timestamp("record_end", { withTimezone: true }),
    payload: jsonb().notNull(),
    /** Cleared when the projection runs, set again when the record updates. */
    projectedAt: timestamp("projected_at", { withTimezone: true }),
    /** WHOOP sends deletes as their own event type. */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...stamps,
  },
  (t) => [
    uniqueIndex("whoop_records_type_id_idx").on(t.type, t.whoopId),
    index("whoop_records_start_idx").on(t.type, t.recordStart),
    index("whoop_records_unprojected_idx").on(t.projectedAt),
  ],
);

/**
 * Webhook receipts, so a replayed or duplicated delivery is a no-op and a
 * failed projection is visible rather than lost.
 */
export const whoopWebhookEvents = pgTable(
  "whoop_webhook_events",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    eventType: text("event_type").notNull(),
    whoopId: text("whoop_id").notNull(),
    traceId: text("trace_id"),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    handledAt: timestamp("handled_at", { withTimezone: true }),
    error: text(),
    ...stamps,
  },
  (t) => [
    index("whoop_webhook_events_lookup_idx").on(t.eventType, t.whoopId),
    index("whoop_webhook_events_unhandled_idx").on(t.handledAt),
  ],
);
