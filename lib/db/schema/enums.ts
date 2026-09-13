import { pgEnum } from "drizzle-orm/pg-core";

/**
 * The taxonomy here is deliberately the ebook's own rather than generic gym
 * metadata: the generator reasons over these attributes, and the rule engine
 * filters and orders by them. Adding a value means teaching the engine what to
 * do with it, so keep the sets small and meaningful.
 */

export const muscleGroup = pgEnum("muscle_group", [
  "posterior_chain",
  "knee_extensors",
  "lower_leg",
  "core",
  "upper_push",
  "upper_pull",
  "shoulders",
  "full_body",
]);

export const movementPattern = pgEnum("movement_pattern", [
  "squat",
  "hinge",
  "lunge",
  "calf_raise",
  "jump_bilateral",
  "jump_unilateral",
  "bound",
  "hop",
  "depth_drop",
  "sprint",
  "throw",
  "push_horizontal",
  "push_vertical",
  "pull_horizontal",
  "pull_vertical",
  "carry",
  "brace",
  "isometric_hold",
  "mobility",
]);

/** Where the exercise sits on the force velocity curve. */
export const forceVelocity = pgEnum("force_velocity", [
  "max_strength",
  "speed_strength",
  "reactive",
  "shock",
  "non_specific",
]);

export const equipment = pgEnum("equipment", [
  "none",
  "barbell",
  "dumbbell",
  "kettlebell",
  "trap_bar",
  "machine",
  "cable",
  "band",
  "bench",
  "rack",
  "box",
  "hurdle",
  "sled",
  "medicine_ball",
  "pullup_bar",
  "dip_station",
  "ab_wheel",
  "weight_vest",
  "landmine",
  "gym_rings",
]);

export const laterality = pgEnum("laterality", [
  "bilateral",
  "unilateral",
  "alternating",
]);

export const plane = pgEnum("plane", [
  "sagittal",
  "frontal",
  "transverse",
  "multi",
]);

/**
 * Coupling time class for plyometrics. Short SSC is under 250 ms, long SSC over
 * 250 ms; shock method requires ground contact under 0.15 s, which is why the
 * normalizer refuses to label anything slower as shock work.
 */
export const couplingClass = pgEnum("coupling_class", [
  "short_ssc",
  "long_ssc",
  "non_classical",
  "not_plyometric",
]);

/** Sites tracked on the pain continuum. Function and pain only, never structure. */
export const tendonSite = pgEnum("tendon_site", [
  "patellar_left",
  "patellar_right",
  "achilles_left",
  "achilles_right",
]);

export const mesocycleType = pgEnum("mesocycle_type", [
  "accumulation",
  "transmutation",
  "realization",
]);

/** Target motor abilities. At most 2 per mesocycle, per the gate. */
export const motorAbility = pgEnum("motor_ability", [
  "max_strength",
  "explosive_strength",
  "reactive_strength",
  "speed_strength",
  "rate_of_force_development",
  "elastic_capacity",
  "strength_endurance",
  "hypertrophy",
  "sprint_speed",
  "work_capacity",
  "mobility",
]);

export const loadType = pgEnum("load_type", [
  "stimulating",
  "retaining",
  "detraining",
]);

export const measurementKind = pgEnum("measurement_kind", [
  "bodyweight",
  "standing_vertical",
  "two_foot_approach_vertical",
  "one_foot_approach_left",
  "one_foot_approach_right",
  "broad_jump",
  "depth_jump_vertical",
  "estimated_1rm",
  "lean_mass",
  "body_fat_pct",
  "reach_height",
]);

/** Provenance, so a manual entry never gets confused with a device import. */
export const dataSource = pgEnum("data_source", ["manual", "whoop", "derived"]);

export const sessionKind = pgEnum("session_kind", [
  "strength",
  "plyometric",
  "jump_technique",
  "sprint",
  "mixed",
  "tendon_protocol",
  "mobility",
  "test",
  "rest",
]);

export const proposalScope = pgEnum("proposal_scope", [
  "mesocycle",
  "microcycle",
  "session",
]);

export const proposalVerdict = pgEnum("proposal_verdict", [
  "pending",
  "accepted",
  "edited",
  "rejected",
  "superseded",
]);

export const memoryFactType = pgEnum("memory_fact_type", [
  "preference",
  "constraint",
  "schedule",
  "injury_history",
  "response_pattern",
  "goal",
  "equipment",
]);

/** Stated facts always outrank inferred ones. */
export const memorySource = pgEnum("memory_source", ["stated", "inferred"]);

export const jumperType = pgEnum("jumper_type", ["speed", "power", "unknown"]);

export const armSwing = pgEnum("arm_swing", [
  "pendulum",
  "circular",
  "running",
  "unknown",
]);

export const takeoffLeg = pgEnum("takeoff_leg", ["left", "right", "unknown"]);

export const mealSlot = pgEnum("meal_slot", [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "pre_workout",
  "post_workout",
]);

export const whoopRecordType = pgEnum("whoop_record_type", [
  "recovery",
  "sleep",
  "cycle",
  "workout",
  "body_measurement",
]);
