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

/**
 * The performance tests. These are entered as a set of attempts in one sitting,
 * which is what makes the noise floor and the best-versus-mean drift computable,
 * so they are logged through the jump test form rather than one value at a time.
 */
export const TEST_KINDS = [
  "standing_vertical",
  "two_foot_approach_vertical",
  "one_foot_approach_left",
  "one_foot_approach_right",
  "broad_jump",
  "depth_jump_vertical",
] as const;
export type TestKind = (typeof TEST_KINDS)[number];

/** Body composition, one value at a time, mostly daily. */
export const BODY_KINDS = [
  "bodyweight",
  "lean_mass",
  "body_fat_pct",
  "reach_height",
] as const;
export type BodyKind = (typeof BODY_KINDS)[number];

/**
 * Display units. Everything is stored canonically in kilograms and centimetres,
 * so a series stays comparable no matter what the owner was typing in that month;
 * this only decides what the forms and charts speak.
 */
export const UNIT_SYSTEMS = ["imperial", "metric"] as const;
export type UnitSystem = (typeof UNIT_SYSTEMS)[number];

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

/**
 * The units a cached food's macros can be per.
 *
 * A closed set even though `foods.unit` is a text column, because it is what the
 * parser is allowed to answer with and the cache key is built from it: `chicken`
 * per `g` and `chicken` per `item` are two different foods, and a model free to
 * invent `breast` as a unit would make a third that never matches either. `item`
 * is the catch-all for a countable thing, which is why the household measures
 * stop at the ones a recipe actually uses.
 */
export const FOOD_UNITS = [
  "g",
  "ml",
  "item",
  "slice",
  "cup",
  "tbsp",
  "tsp",
  "scoop",
] as const;
export type FoodUnit = (typeof FOOD_UNITS)[number];

/**
 * Which way a daily calorie target departs from maintenance.
 *
 * Named rather than inferred from a signed number because the interesting case is
 * a deficit that was asked for and refused: relative strength is what predicts
 * jumping, so a cut is gated on tendon health and on the block, and "hold" then
 * has to be distinguishable from "hold, because a cut was not allowed".
 */
export const ENERGY_DIRECTIONS = ["surplus", "hold", "deficit"] as const;
export type EnergyDirection = (typeof ENERGY_DIRECTIONS)[number];

export const WHOOP_RECORD_TYPES = [
  "recovery",
  "sleep",
  "cycle",
  "workout",
  "body_measurement",
] as const;
export type WhoopRecordType = (typeof WHOOP_RECORD_TYPES)[number];
