import { relations } from "drizzle-orm";
import {
  boolean,
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
  equipment,
  forceVelocity,
  laterality,
  movementPattern,
  muscleGroup,
  plane,
  tendonSite,
} from "./enums";

/**
 * The exercise directory. This is the substrate the model reasons over, so every
 * column here exists because some rule, filter, or ordering decision reads it.
 *
 * From the model's point of view the directory is a closed set: it selects from
 * what exists and never invents an exercise. Anything it wants that is missing
 * goes to `exerciseSuggestions` for the owner to accept.
 */
export const exercises = pgTable(
  "exercises",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    slug: text().notNull(),
    name: text().notNull(),

    primaryMuscleGroup: muscleGroup("primary_muscle_group").notNull(),
    secondaryMuscleGroups: muscleGroup("secondary_muscle_groups")
      .array()
      .notNull()
      .default([]),
    movementPattern: movementPattern("movement_pattern").notNull(),
    forceVelocity: forceVelocity("force_velocity").notNull(),
    laterality: laterality().notNull(),
    plane: plane().notNull(),

    /** `not_plyometric` for everything that is not a jump or plyo drill. */
    couplingClass: couplingClass("coupling_class")
      .notNull()
      .default("not_plyometric"),
    /** Typical ground contact time in seconds, when the drill has one. */
    typicalContactSeconds: numeric("typical_contact_seconds", {
      precision: 4,
      scale: 3,
    }),
    /** Whether a rep counts as a high-impact contact for tendon load accounting. */
    highImpact: boolean("high_impact").notNull().default(false),

    /**
     * Equipment requirements, which the pre-filter matches against what is
     * actually reachable. `equipment` is needed all together, a barbell and a
     * rack; `equipmentAnyOf` is interchangeable, dumbbells or kettlebells, and
     * one of them is needed on top. `none` is always satisfied. Load that is
     * merely optional, a vest on a push-up, belongs on a variant instead,
     * because listing it here would hide the exercise from anyone without one.
     */
    equipment: equipment().array().notNull().default([]),
    equipmentAnyOf: equipment("equipment_any_of").array().notNull().default([]),

    /** Tendon sites this exercise loads. Drives the pre-filter, so be honest. */
    loadsTendonSites: tendonSite("loads_tendon_sites")
      .array()
      .notNull()
      .default([]),
    /** 1 gentle to 5 severe. Compared against the pain-trend load cap. */
    tendonLoadRating: smallint("tendon_load_rating").notNull().default(1),
    /**
     * The tendon protocol phase this exercise is the prescription for, 1 to 4,
     * and null for everything else. A site in phase 1 or 2 removes every
     * exercise loading it except the prescription for that phase or an earlier
     * one, because the protocol is load management rather than rest and the
     * pre-filter must not remove the isometrics the protocol itself calls for.
     */
    protocolPhase: smallint("protocol_phase"),

    /** 1 trivial to 5 highly technical. Drives session ordering. */
    technicalComplexity: smallint("technical_complexity").notNull().default(1),

    cues: text().array().notNull().default([]),
    notes: text(),

    progressionOfId: integer("progression_of_id"),
    regressionOfId: integer("regression_of_id"),

    /**
     * Availability, consumed by the pre-filter. A stock entry the owner cannot
     * actually do is invisible to the model rather than something it proposes
     * and the owner rejects.
     */
    available: boolean().notNull().default(true),
    /** Seeded by the stock directory rather than added by the owner. */
    isStock: boolean("is_stock").notNull().default(false),

    ...stamps,
  },
  (t) => [
    uniqueIndex("exercises_slug_idx").on(t.slug),
    index("exercises_pattern_idx").on(t.movementPattern),
    index("exercises_available_idx").on(t.available),
  ],
);

/** Load-mode variations: banded, weighted, tempo, deficit, paused. */
export const exerciseVariants = pgTable(
  "exercise_variants",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    exerciseId: integer("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    name: text().notNull(),
    slug: text().notNull(),
    /** Deltas applied on top of the parent, for example a tendon rating bump. */
    modifiers: jsonb().$type<{
      tendonLoadRatingDelta?: number;
      technicalComplexityDelta?: number;
      addedEquipment?: string[];
      note?: string;
    }>(),
    available: boolean().notNull().default(true),
    ...stamps,
  },
  (t) => [uniqueIndex("exercise_variants_slug_idx").on(t.slug)],
);

/**
 * The suggested-addition queue. When the generator wants an exercise the
 * directory does not have, it files it here instead of inventing one inline.
 */
export const exerciseSuggestions = pgTable("exercise_suggestions", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: text().notNull(),
  rationale: text().notNull(),
  /** Partial attribute set the model proposed, validated on acceptance. */
  proposedAttributes: jsonb("proposed_attributes").notNull(),
  acceptedExerciseId: integer("accepted_exercise_id").references(
    () => exercises.id,
    { onDelete: "set null" },
  ),
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  ...stamps,
});

export const exercisesRelations = relations(exercises, ({ many }) => ({
  variants: many(exerciseVariants),
}));

export const exerciseVariantsRelations = relations(
  exerciseVariants,
  ({ one }) => ({
    exercise: one(exercises, {
      fields: [exerciseVariants.exerciseId],
      references: [exercises.id],
    }),
  }),
);
