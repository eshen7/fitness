import {
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { stamps } from "./_shared";
import { mealSlot } from "./enums";

/**
 * Resolved food cache. The point is consistency as much as speed: the same meal
 * logged twice must resolve to the same macros rather than being re-estimated
 * slightly differently by the model each time.
 */
export const foods = pgTable(
  "foods",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    /** Normalised lookup key derived from the owner's own phrasing. */
    key: text().notNull(),
    name: text().notNull(),
    /** The unit the macros below are per: "g", "ml", "item", "cup". */
    unit: text().notNull(),
    /** Grams per unit when the unit is not itself a mass, for display math. */
    gramsPerUnit: numeric("grams_per_unit", { precision: 8, scale: 2 }),

    kcalPerUnit: numeric("kcal_per_unit", { precision: 8, scale: 2 }).notNull(),
    proteinGPerUnit: numeric("protein_g_per_unit", {
      precision: 7,
      scale: 2,
    }).notNull(),
    carbsGPerUnit: numeric("carbs_g_per_unit", {
      precision: 7,
      scale: 2,
    }).notNull(),
    fatGPerUnit: numeric("fat_g_per_unit", { precision: 7, scale: 2 }).notNull(),
    fiberGPerUnit: numeric("fiber_g_per_unit", { precision: 7, scale: 2 }),

    /** "model" when the model estimated it, "owner" when corrected by hand. */
    provenance: text().notNull().default("model"),
    ...stamps,
  },
  (t) => [uniqueIndex("foods_key_idx").on(t.key)],
);

export const foodLogEntries = pgTable(
  "food_log_entries",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    foodId: integer("food_id")
      .notNull()
      .references(() => foods.id, { onDelete: "restrict" }),
    quantity: numeric({ precision: 8, scale: 2 }).notNull(),
    meal: mealSlot().notNull(),
    day: date().notNull(),
    /**
     * One instant for every entry a single sentence resolved into, set explicitly
     * rather than defaulted, because it is what groups them back together: the
     * phrase cache replays the newest logging of a phrase, and "newest" has to
     * mean one resolution and not the last row of one.
     */
    loggedAt: timestamp("logged_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** The raw sentence the owner typed, kept for re-parsing and audit. */
    rawText: text("raw_text"),
    /**
     * `rawText` normalised by `lib/nutrition/normalize.ts`, which is the sentence
     * cache: a phrase logged before is replayed from its own prior entries with no
     * model call at all. Written from TypeScript rather than derived in SQL so the
     * one normaliser cannot drift from a second copy of itself.
     */
    phraseKey: text("phrase_key"),
    ...stamps,
  },
  (t) => [
    index("food_log_entries_day_idx").on(t.day),
    index("food_log_entries_phrase_idx").on(t.phraseKey, t.loggedAt),
  ],
);

/**
 * Phase-aware daily targets with an effective range. A cut is only permitted
 * when tendon sites are healthy and the block is not a realization phase, since
 * jumping tracks relative rather than absolute strength.
 */
export const nutritionTargets = pgTable(
  "nutrition_targets",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    kcal: integer().notNull(),
    proteinG: integer("protein_g").notNull(),
    carbsG: integer("carbs_g").notNull(),
    fatG: integer("fat_g").notNull(),
    fluidMl: integer("fluid_ml"),
    /** Target weekly bodyweight change as a percent, signed. */
    targetWeeklyChangePct: numeric("target_weekly_change_pct", {
      precision: 4,
      scale: 2,
    }),
    rationale: text(),
    ...stamps,
  },
  (t) => [index("nutrition_targets_from_idx").on(t.effectiveFrom)],
);
