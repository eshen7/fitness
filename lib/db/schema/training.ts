import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { stamps } from "./_shared";
import {
  couplingClass,
  loadType,
  mesocycleType,
  motorAbility,
  proposalScope,
  proposalVerdict,
  sessionKind,
} from "./enums";
import { exercises, exerciseVariants } from "./exercises";

export const macrocycles = pgTable("macrocycles", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  /** What the macrocycle peaks for, in the owner's words. */
  objective: text(),
  ...stamps,
});

/**
 * A mesocycle is *declared* up front even though microcycles are generated
 * weekly, because the block-scope gate rules need it: type, targets, technical
 * focus and the stable exercise complex are all fixed when the block opens.
 */
export const mesocycles = pgTable(
  "mesocycles",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    macrocycleId: integer("macrocycle_id")
      .notNull()
      .references(() => macrocycles.id, { onDelete: "cascade" }),
    ordinal: smallint().notNull(),
    type: mesocycleType().notNull(),
    startDate: date("start_date").notNull(),
    /** 2 to 6 microcycles. */
    plannedMicrocycles: smallint("planned_microcycles").notNull(),
    /** At most 2, enforced by the gate. */
    targetAbilities: motorAbility("target_abilities").array().notNull(),
    /** Exactly one technical feature, per the ebook's target count guidance. */
    technicalFocus: text("technical_focus"),
    rationale: text(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    ...stamps,
  },
  (t) => [
    uniqueIndex("mesocycles_ordinal_idx").on(t.macrocycleId, t.ordinal),
    index("mesocycles_start_idx").on(t.startDate),
  ],
);

/**
 * The roughly ten-exercise stable complex that runs through a mesocycle. Load
 * varies within a block; the complex does not, which is exactly what the
 * load-variation gate rule checks each new week against.
 */
export const exerciseComplexes = pgTable("exercise_complexes", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  mesocycleId: integer("mesocycle_id")
    .notNull()
    .references(() => mesocycles.id, { onDelete: "cascade" }),
  ...stamps,
});

export const exerciseComplexItems = pgTable(
  "exercise_complex_items",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    complexId: integer("complex_id")
      .notNull()
      .references(() => exerciseComplexes.id, { onDelete: "cascade" }),
    exerciseId: integer("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    variantId: integer("variant_id").references(() => exerciseVariants.id, {
      onDelete: "set null",
    }),
    /** Whether this is one of the block's main lifts or assistance work. */
    isMain: boolean("is_main").notNull().default(false),
    /** Each complex exercise should appear at least twice per week. */
    targetWeeklyFrequency: smallint("target_weekly_frequency")
      .notNull()
      .default(2),
    ...stamps,
  },
  (t) => [uniqueIndex("complex_items_idx").on(t.complexId, t.exerciseId)],
);

/** One week. Generated on a rolling basis rather than all at block declaration. */
export const microcycles = pgTable(
  "microcycles",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    mesocycleId: integer("mesocycle_id")
      .notNull()
      .references(() => mesocycles.id, { onDelete: "cascade" }),
    ordinal: smallint().notNull(),
    startDate: date("start_date").notNull(),
    /** Stimulating, retaining, or detraining, which sets the expected response. */
    loadType: loadType("load_type").notNull().default("stimulating"),
    /** Planned relative load, 0 to 1 against the block's heaviest week. */
    relativeLoad: numeric("relative_load", { precision: 3, scale: 2 }),
    rationale: text(),
    ...stamps,
  },
  (t) => [
    uniqueIndex("microcycles_ordinal_idx").on(t.mesocycleId, t.ordinal),
    index("microcycles_start_idx").on(t.startDate),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    /**
     * Null for an ad-hoc session: training that happened without a generated
     * plan behind it. That is not only a phase-ordering convenience, it is the
     * normal case for off-plan work, and those sets still have to count toward
     * weekly volume, contact totals, and every analytic built on them.
     */
    microcycleId: integer("microcycle_id").references(() => microcycles.id, {
      onDelete: "cascade",
    }),
    day: date().notNull(),
    kind: sessionKind().notNull(),
    title: text(),
    /** Planned intensity 1 to 10, used by the plyo frequency rule. */
    plannedIntensity: smallint("planned_intensity"),
    /** Planned volume in sets, used by the rule of 60% comparison. */
    plannedSets: smallint("planned_sets"),
    /** High-impact contacts planned, the number the tendon ceiling is about. */
    plannedContacts: smallint("planned_contacts"),

    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    skippedAt: timestamp("skipped_at", { withTimezone: true }),
    /** Session RPE reported after the fact. */
    reportedRpe: numeric("reported_rpe", { precision: 3, scale: 1 }),
    notes: text(),
    ...stamps,
  },
  (t) => [index("sessions_day_idx").on(t.day)],
);

/**
 * A named part of a session, ordered. The normalizer owns `position`: highest
 * intensity and most coordination-demanding work first, main before assistance,
 * large muscle groups before small.
 */
export const sessionBlocks = pgTable(
  "session_blocks",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    position: smallint().notNull(),
    label: text().notNull(),
    /** Set when this block is a complex-training pair. */
    pairedWithBlockId: integer("paired_with_block_id"),
    ...stamps,
  },
  (t) => [uniqueIndex("session_blocks_position_idx").on(t.sessionId, t.position)],
);

export const prescribedSets = pgTable(
  "prescribed_sets",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    blockId: integer("block_id")
      .notNull()
      .references(() => sessionBlocks.id, { onDelete: "cascade" }),
    position: smallint().notNull(),
    exerciseId: integer("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    variantId: integer("variant_id").references(() => exerciseVariants.id, {
      onDelete: "set null",
    }),

    sets: smallint().notNull(),
    reps: smallint(),
    /** For isometric holds and tempo work. */
    holdSeconds: numeric("hold_seconds", { precision: 5, scale: 1 }),
    loadKg: numeric("load_kg", { precision: 6, scale: 2 }),
    loadPctOf1rm: smallint("load_pct_of_1rm"),
    /** Depth or drop height for plyometrics. */
    boxHeightCm: numeric("box_height_cm", { precision: 5, scale: 1 }),
    targetRpe: numeric("target_rpe", { precision: 3, scale: 1 }),
    /** Normalizer-owned, from the plyo and heavy-set rest rules. */
    restSeconds: smallint("rest_seconds"),
    /** Normalizer-owned label, never above 0.15 s contact for shock work. */
    couplingClass: couplingClass("coupling_class"),
    tempo: text(),
    cueOverride: text("cue_override"),
    ...stamps,
  },
  (t) => [uniqueIndex("prescribed_sets_position_idx").on(t.blockId, t.position)],
);

export const loggedSets = pgTable(
  "logged_sets",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** Null when the owner added work that was not prescribed. */
    prescribedSetId: integer("prescribed_set_id").references(
      () => prescribedSets.id,
      { onDelete: "set null" },
    ),
    exerciseId: integer("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "restrict" }),
    setIndex: smallint("set_index").notNull(),
    reps: smallint(),
    holdSeconds: numeric("hold_seconds", { precision: 5, scale: 1 }),
    loadKg: numeric("load_kg", { precision: 6, scale: 2 }),
    boxHeightCm: numeric("box_height_cm", { precision: 5, scale: 1 }),
    rpe: numeric({ precision: 3, scale: 1 }),
    /** Only well-executed reps count toward adaptation, so quality is logged. */
    qualityRating: smallint("quality_rating"),
    performedAt: timestamp("performed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    notes: text(),
    /** Idempotency key from the offline queue, so a replay does not duplicate. */
    clientId: text("client_id"),
    ...stamps,
  },
  (t) => [
    index("logged_sets_session_idx").on(t.sessionId),
    index("logged_sets_exercise_time_idx").on(t.exerciseId, t.performedAt),
    uniqueIndex("logged_sets_client_id_idx").on(t.clientId),
  ],
);

/**
 * Every generated plan, with the model's rationale, the exact inputs it saw, the
 * normalizer diff, the gate report, the advisories, and the owner's verdict.
 *
 * This is both the audit trail and the primary training signal for the memory
 * layer, so a regenerated week is stored as its own row rather than overwriting.
 */
export const planProposals = pgTable(
  "plan_proposals",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    scope: proposalScope().notNull(),
    mesocycleId: integer("mesocycle_id").references(() => mesocycles.id, {
      onDelete: "set null",
    }),
    microcycleId: integer("microcycle_id").references(() => microcycles.id, {
      onDelete: "set null",
    }),
    sessionId: integer("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),

    /** The candidate set and state snapshot handed to the model, verbatim. */
    inputs: jsonb().notNull(),
    /** The model's structured proposal before normalization. */
    proposal: jsonb().notNull(),
    /** The plan after the normalizer ran, which is what gets written on accept. */
    normalized: jsonb(),
    /** Field-level record of what the normalizer changed and why. */
    normalizerDiff: jsonb("normalizer_diff"),
    gateReport: jsonb("gate_report"),
    advisories: jsonb().$type<string[]>().notNull().default([]),
    rationale: text(),
    /** Constraints the model believes it satisfied, for comparison with the gate. */
    claimedConstraints: text("claimed_constraints").array().notNull().default([]),

    /** 0 for a first-attempt pass, 1 to 3 for repairs. Drives the pass rate metric. */
    repairAttempts: smallint("repair_attempts").notNull().default(0),
    /** Set when the repair loop never converged and a fallback shipped instead. */
    isFallback: boolean("is_fallback").notNull().default(false),
    supersedesId: integer("supersedes_id"),

    verdict: proposalVerdict().notNull().default("pending"),
    verdictReason: text("verdict_reason"),
    verdictAt: timestamp("verdict_at", { withTimezone: true }),
    /** What the owner changed on an edit, mined for stable preference patterns. */
    ownerEdits: jsonb("owner_edits"),

    model: text(),
    /**
     * Token counts as the provider reported them, summed across every attempt.
     * `cachedInputTokens` is the caching exit criterion, so it is stored rather
     * than only logged: a silent prefix invalidator shows up here as a run of
     * zeroes long after the log has rotated away.
     */
    usage: jsonb().$type<{
      inputTokens?: number;
      outputTokens?: number;
      cachedInputTokens?: number;
      reasoningTokens?: number;
    }>(),
    ...stamps,
  },
  (t) => [
    index("plan_proposals_scope_idx").on(t.scope, t.createdAt),
    index("plan_proposals_verdict_idx").on(t.verdict),
  ],
);

export const mesocyclesRelations = relations(mesocycles, ({ one, many }) => ({
  macrocycle: one(macrocycles, {
    fields: [mesocycles.macrocycleId],
    references: [macrocycles.id],
  }),
  microcycles: many(microcycles),
  complex: one(exerciseComplexes),
}));

export const microcyclesRelations = relations(microcycles, ({ one, many }) => ({
  mesocycle: one(mesocycles, {
    fields: [microcycles.mesocycleId],
    references: [mesocycles.id],
  }),
  sessions: many(sessions),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  microcycle: one(microcycles, {
    fields: [sessions.microcycleId],
    references: [microcycles.id],
  }),
  blocks: many(sessionBlocks),
  loggedSets: many(loggedSets),
}));

export const sessionBlocksRelations = relations(
  sessionBlocks,
  ({ one, many }) => ({
    session: one(sessions, {
      fields: [sessionBlocks.sessionId],
      references: [sessions.id],
    }),
    prescribedSets: many(prescribedSets),
  }),
);

export const prescribedSetsRelations = relations(prescribedSets, ({ one }) => ({
  block: one(sessionBlocks, {
    fields: [prescribedSets.blockId],
    references: [sessionBlocks.id],
  }),
  exercise: one(exercises, {
    fields: [prescribedSets.exerciseId],
    references: [exercises.id],
  }),
}));

export const exerciseComplexesRelations = relations(
  exerciseComplexes,
  ({ one, many }) => ({
    mesocycle: one(mesocycles, {
      fields: [exerciseComplexes.mesocycleId],
      references: [mesocycles.id],
    }),
    items: many(exerciseComplexItems),
  }),
);

export const exerciseComplexItemsRelations = relations(
  exerciseComplexItems,
  ({ one }) => ({
    complex: one(exerciseComplexes, {
      fields: [exerciseComplexItems.complexId],
      references: [exerciseComplexes.id],
    }),
    exercise: one(exercises, {
      fields: [exerciseComplexItems.exerciseId],
      references: [exercises.id],
    }),
  }),
);
