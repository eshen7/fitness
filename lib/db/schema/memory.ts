import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";
import { stamps } from "./_shared";
import { memoryFactType, memorySource } from "./enums";

/** Dimension of the embedding model used for retrieval. */
export const EMBEDDING_DIMENSIONS = 1536;

/**
 * The knowledge that accumulates so the app stops needing to be re-explained.
 *
 * Inferred facts auto-commit after each logged session; safety comes from
 * reversibility rather than caution, which is why `supersededById` and the
 * memory feed matter more than a confirmation prompt. Two categories still
 * require confirmation before they take effect, flagged by
 * `requiresConfirmation`: anything that changes tendon behaviour, and anything
 * that would retire an exercise or movement class.
 *
 * A stated fact always outranks an inferred one and is never overwritten by it.
 */
export const memoryFacts = pgTable(
  "memory_facts",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    type: memoryFactType().notNull(),
    /** The fact itself, in one sentence, as it will appear in the prompt. */
    body: text().notNull(),
    source: memorySource().notNull(),
    /** 0 to 1. Only facts above the retrieval threshold enter the prompt. */
    confidence: numeric({ precision: 3, scale: 2 }).notNull().default("0.5"),

    /** What the reflection job saw that produced this, for the memory feed. */
    observations: jsonb().$type<string[]>().notNull().default([]),
    /** Which proposal or session the inference came from. */
    derivedFromProposalId: integer("derived_from_proposal_id"),
    derivedFromSessionId: integer("derived_from_session_id"),

    supersedesId: integer("supersedes_id"),
    supersededById: integer("superseded_by_id"),
    /** Set when the owner corrects or deletes it, which supersedes the inference. */
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    retiredReason: text("retired_reason"),

    /** True for tendon-behaviour changes and exercise retirements. */
    requiresConfirmation: boolean("requires_confirmation")
      .notNull()
      .default(false),
    /**
     * Why it is being held, in the owner's words, for the confirmation queue.
     *
     * Persisted rather than recomputed on read, for the same reason
     * `derived_insights.blocked_by` is: the decision was made from a `FactProposal`,
     * whose `tendonSites` and `retiresExerciseIds` are not columns here, so the stored
     * row cannot reconstruct it. Recomputing from the prose alone would silently lose
     * exactly the structured cases the gate exists for.
     */
    confirmationReason: text("confirmation_reason"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),

    embedding: vector({ dimensions: EMBEDDING_DIMENSIONS }),
    ...stamps,
  },
  (t) => [
    index("memory_facts_active_idx").on(t.retiredAt, t.type),
    index("memory_facts_embedding_idx").using(
      "hnsw",
      t.embedding.op("vector_cosine_ops"),
    ),
  ],
);

/**
 * Statements computed by `lib/analytics/`, never by the model. Each carries its
 * own n and interval, and only insights past the confidence threshold are
 * allowed into the cached prompt prefix or the UI.
 */
export const derivedInsights = pgTable(
  "derived_insights",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    /** Stable key, one per analytic, so a recompute replaces rather than appends. */
    key: text().notNull(),
    /** Which area it belongs to, for grouping on screen. */
    family: text().notNull().default("load"),
    /**
     * What it is about, with no number in it, so a withheld insight can still be
     * named on screen without leaking the value the gate refused.
     */
    subject: text().notNull().default(""),
    /** The insight in one sentence, as it will be asserted. */
    statement: text().notNull(),
    /** The number itself, plus units, for charting and comparison. */
    value: numeric({ precision: 12, scale: 4 }),
    unit: text(),
    /** Sample size behind the estimate. */
    n: integer().notNull(),
    /**
     * The n this insight needs, which is a property of the question rather than a
     * constant. Stored so the feed can render the shortfall on an insight that has
     * not earned the right to show its number yet.
     */
    minN: integer("min_n").notNull().default(8),
    ciLow: numeric("ci_low", { precision: 12, scale: 4 }),
    ciHigh: numeric("ci_high", { precision: 12, scale: 4 }),
    /** Raw two-sided p, kept beside the adjusted one so the correction is auditable. */
    p: numeric({ precision: 8, scale: 7 }),
    /** Benjamini-Hochberg adjusted where the analytic is part of a family. */
    pAdjusted: numeric("p_adjusted", { precision: 8, scale: 7 }),
    /** What "nothing is going on" would be. The interval has to exclude it. */
    nullValue: numeric("null_value", { precision: 12, scale: 4 }),
    /** 1 needs almost no history, 2 needs a block or two, 3 needs several. */
    tier: integer().notNull().default(1),
    /** False until it clears the threshold. Gates prompt and UI use. */
    assertable: boolean().notNull().default(false),
    /**
     * Which of the gate's conditions it failed first, in the owner's words. Null once
     * it passes. Persisted rather than recomputed on read because the gate's verdict
     * depends on the whole suite as it was at compute time, so a row read on its own
     * cannot reconstruct it.
     */
    blockedBy: text("blocked_by"),
    /** Whatever the analytic wants to keep: coefficients, curve points, lags. */
    detail: jsonb(),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Previous value, so drift monitoring can alert on a coefficient moving. */
    previousValue: numeric("previous_value", { precision: 12, scale: 4 }),
    ...stamps,
  },
  (t) => [
    // Unique, because the row *is* the insight rather than a reading of it: a
    // recompute updates in place and moves the old number into `previousValue`, which
    // is the only thing drift monitoring can be built on. A non-unique key would let
    // one bad run append a second row for every analytic and leave every later read
    // picking between them by `computedAt`.
    uniqueIndex("derived_insights_key_idx").on(t.key),
    index("derived_insights_computed_idx").on(t.computedAt),
    index("derived_insights_assertable_idx").on(t.assertable),
  ],
);
