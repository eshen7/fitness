/**
 * The taxonomy: every enumerated attribute the app reasons over, as plain arrays.
 *
 * This is the single source of truth. `lib/db/schema/enums.ts` builds the Postgres
 * enums from these arrays and `lib/labels.ts` maps each value to a display name
 * with the type checker enforcing completeness, so the database, the validators,
 * and the UI cannot drift apart. It deliberately imports nothing, so the browser
 * can hold the taxonomy without pulling the database driver in behind it.
 *
 * The values are the ebook's own vocabulary rather than generic gym metadata,
 * because the rule engine filters and orders by them. Adding a value means
 * teaching the engine what to do with it, so keep the sets small and meaningful.
 */

export const MUSCLE_GROUPS = [
  "posterior_chain",
  "knee_extensors",
  "lower_leg",
  "core",
  "upper_push",
  "upper_pull",
  "shoulders",
  "full_body",
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const MOVEMENT_PATTERNS = [
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
] as const;
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

/** Where the exercise sits on the force velocity curve. */
export const FORCE_VELOCITIES = [
  "max_strength",
  "speed_strength",
  "reactive",
  "shock",
  "non_specific",
] as const;
export type ForceVelocity = (typeof FORCE_VELOCITIES)[number];

export const EQUIPMENT_TYPES = [
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
] as const;
export type Equipment = (typeof EQUIPMENT_TYPES)[number];

export const LATERALITIES = ["bilateral", "unilateral", "alternating"] as const;
export type Laterality = (typeof LATERALITIES)[number];

export const PLANES = ["sagittal", "frontal", "transverse", "multi"] as const;
export type Plane = (typeof PLANES)[number];

/**
 * Coupling time class for plyometrics. Short SSC is under 250 ms, long SSC over
 * 250 ms; shock method requires ground contact under 0.15 s, which is why the
 * normalizer refuses to label anything slower as shock work.
 */
export const COUPLING_CLASSES = [
  "short_ssc",
  "long_ssc",
  "non_classical",
  "not_plyometric",
] as const;
export type CouplingClass = (typeof COUPLING_CLASSES)[number];

/** Sites tracked on the pain continuum. Function and pain only, never structure. */
export const TENDON_SITES = [
  "patellar_left",
  "patellar_right",
  "achilles_left",
  "achilles_right",
] as const;
export type TendonSite = (typeof TENDON_SITES)[number];

export const MESOCYCLE_TYPES = [
  "accumulation",
  "transmutation",
  "realization",
] as const;
export type MesocycleType = (typeof MESOCYCLE_TYPES)[number];

/** Target motor abilities. At most 2 per mesocycle, per the gate. */
export const MOTOR_ABILITIES = [
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
] as const;
export type MotorAbility = (typeof MOTOR_ABILITIES)[number];

export const LOAD_TYPES = ["stimulating", "retaining", "detraining"] as const;
export type LoadType = (typeof LOAD_TYPES)[number];

export const MEASUREMENT_KINDS = [
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
] as const;
export type MeasurementKind = (typeof MEASUREMENT_KINDS)[number];

/** Provenance, so a manual entry never gets confused with a device import. */
export const DATA_SOURCES = ["manual", "whoop", "derived"] as const;
export type DataSource = (typeof DATA_SOURCES)[number];

export const SESSION_KINDS = [
  "strength",
  "plyometric",
  "jump_technique",
  "sprint",
  "mixed",
  "tendon_protocol",
  "mobility",
  "test",
  "rest",
] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const PROPOSAL_SCOPES = ["mesocycle", "microcycle", "session"] as const;
export type ProposalScope = (typeof PROPOSAL_SCOPES)[number];

export const PROPOSAL_VERDICTS = [
  "pending",
  "accepted",
  "edited",
  "rejected",
  "superseded",
] as const;
export type ProposalVerdict = (typeof PROPOSAL_VERDICTS)[number];

export const MEMORY_FACT_TYPES = [
  "preference",
  "constraint",
  "schedule",
  "injury_history",
  "response_pattern",
  "goal",
  "equipment",
] as const;
export type MemoryFactType = (typeof MEMORY_FACT_TYPES)[number];

/** Stated facts always outrank inferred ones. */
export const MEMORY_SOURCES = ["stated", "inferred"] as const;
export type MemorySource = (typeof MEMORY_SOURCES)[number];

export const JUMPER_TYPES = ["speed", "power", "unknown"] as const;
export type JumperType = (typeof JUMPER_TYPES)[number];

export const ARM_SWINGS = [
  "pendulum",
  "circular",
  "running",
  "unknown",
] as const;
export type ArmSwing = (typeof ARM_SWINGS)[number];

export const TAKEOFF_LEGS = ["left", "right", "unknown"] as const;
export type TakeoffLeg = (typeof TAKEOFF_LEGS)[number];

export const MEAL_SLOTS = [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
  "pre_workout",
  "post_workout",
] as const;
export type MealSlot = (typeof MEAL_SLOTS)[number];

export const WHOOP_RECORD_TYPES = [
  "recovery",
  "sleep",
  "cycle",
  "workout",
  "body_measurement",
] as const;
export type WhoopRecordType = (typeof WHOOP_RECORD_TYPES)[number];
