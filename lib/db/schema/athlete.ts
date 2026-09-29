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
  uuid,
} from "drizzle-orm/pg-core";
import { stamps } from "./_shared";
import {
  armSwing,
  dataSource,
  jumperType,
  measurementKind,
  takeoffLeg,
  tendonSite,
  unitSystem,
} from "./enums";
import { exercises } from "./exercises";

/**
 * Single-user app, so the profile is one row pinned at id 1. It gates technique
 * guidance: the ebook is explicit that a trained jumper's strategy should not be
 * switched, so jumperType and armSwing constrain what the generator may suggest.
 */
export const profile = pgTable("profile", {
  id: integer().primaryKey().default(1),
  displayName: text("display_name"),
  heightCm: numeric("height_cm", { precision: 5, scale: 1 }),
  /** Standing reach, needed to turn a touch height into a vertical. */
  reachCm: numeric("reach_cm", { precision: 5, scale: 1 }),
  /** Femur and tibia lengths, since longer limbs demand more torque. */
  femurCm: numeric("femur_cm", { precision: 4, scale: 1 }),
  tibiaCm: numeric("tibia_cm", { precision: 4, scale: 1 }),
  trainingAgeYears: numeric("training_age_years", { precision: 3, scale: 1 }),
  dominantTakeoffLeg: takeoffLeg("dominant_takeoff_leg")
    .notNull()
    .default("unknown"),
  jumperType: jumperType("jumper_type").notNull().default("unknown"),
  /** Display only. Measurements are stored in kilograms and centimetres. */
  unitSystem: unitSystem("unit_system").notNull().default("imperial"),
  preferredArmSwing: armSwing("preferred_arm_swing").notNull().default("unknown"),
  goals: text().array().notNull().default([]),
  /** Equipment actually reachable, intersected with per-exercise availability. */
  availableEquipment: text("available_equipment").array().notNull().default([]),
  /** Days of week normally trainable, 0 Sunday to 6 Saturday. */
  trainableWeekdays: smallint("trainable_weekdays").array().notNull().default([]),
  ...stamps,
});

/**
 * One row per measured value. Attempts within a single test share a `testGroup`,
 * which is what makes the measurement noise floor and the best-versus-mean
 * attempt drift computable rather than guessed.
 */
export const measurements = pgTable(
  "measurements",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    kind: measurementKind().notNull(),
    /** Set for `tested_1rm` rows so the lift is identifiable. */
    exerciseId: integer("exercise_id").references(() => exercises.id, {
      onDelete: "set null",
    }),
    value: numeric({ precision: 8, scale: 2 }).notNull(),
    unit: text().notNull(),
    /**
     * Drop height for a depth jump attempt. A first-class column rather than a
     * note, because the calibration insight fits jump height against box height
     * and takes the vertex, which needs both numbers in the same row.
     */
    boxHeightCm: numeric("box_height_cm", { precision: 5, scale: 1 }),
    measuredAt: timestamp("measured_at", { withTimezone: true }).notNull(),
    testGroup: uuid("test_group"),
    attempt: smallint(),
    source: dataSource().notNull().default("manual"),
    notes: text(),
    ...stamps,
  },
  (t) => [
    index("measurements_kind_time_idx").on(t.kind, t.measuredAt),
    index("measurements_group_idx").on(t.testGroup),
  ],
);

/**
 * Pain continuum tracking, per site. Function and pain only: nothing here
 * implies structural damage, because the ebook is explicit that structure does
 * not equal pain and that telling an athlete otherwise makes outcomes worse.
 *
 * `protocolPhase` 1 to 4 is the load-management protocol. Phase 1 or 2 on a site
 * removes every exercise loading it from the candidate set entirely.
 */
export const tendonStatus = pgTable(
  "tendon_status",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    site: tendonSite().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    /** 0 to 10 during load. */
    painDuringLoad: smallint("pain_during_load").notNull(),
    /** 0 to 10 in the 24 hours after load. */
    painAfterLoad: smallint("pain_after_load").notNull(),
    /** 0 to 10 on waking, the most sensitive early signal. */
    morningStiffness: smallint("morning_stiffness").notNull(),
    /** null means not on a protocol. */
    protocolPhase: smallint("protocol_phase"),
    notes: text(),
    ...stamps,
  },
  (t) => [index("tendon_status_site_time_idx").on(t.site, t.recordedAt)],
);

/**
 * Daily check-in. Sleep, recovery, HRV, resting heart rate and day strain are
 * auto-filled from WHOOP, so the form only asks what the device cannot read.
 */
export const readinessCheckins = pgTable(
  "readiness_checkins",
  {
    id: integer().primaryKey().generatedAlwaysAsIdentity(),
    day: date().notNull(),

    /** Self-reported, keyed by muscle group, 0 to 10. */
    sorenessByRegion: jsonb("soreness_by_region")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    motivation: smallint(),
    /** RPE of the previous session, 1 to 10. */
    priorSessionRpe: numeric("prior_session_rpe", { precision: 3, scale: 1 }),
    /** Free text the reflection job reads. */
    notes: text(),

    // WHOOP-filled. Null until the connection exists or the night is missing.
    recoveryScore: smallint("recovery_score"),
    hrvMs: numeric("hrv_ms", { precision: 6, scale: 2 }),
    restingHeartRate: smallint("resting_heart_rate"),
    sleepMinutes: integer("sleep_minutes"),
    sleepPerformancePct: smallint("sleep_performance_pct"),
    sleepEfficiencyPct: smallint("sleep_efficiency_pct"),
    slowWaveMinutes: integer("slow_wave_minutes"),
    remMinutes: integer("rem_minutes"),
    dayStrain: numeric("day_strain", { precision: 4, scale: 2 }),
    /** Which fields came from the device rather than the form. */
    whoopFilled: boolean("whoop_filled").notNull().default(false),

    ...stamps,
  },
  (t) => [uniqueIndex("readiness_checkins_day_idx").on(t.day)],
);
