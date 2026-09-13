import { pgEnum } from "drizzle-orm/pg-core";
import {
  ARM_SWINGS,
  COUPLING_CLASSES,
  DATA_SOURCES,
  EQUIPMENT_TYPES,
  FORCE_VELOCITIES,
  JUMPER_TYPES,
  LATERALITIES,
  LOAD_TYPES,
  MEAL_SLOTS,
  MEASUREMENT_KINDS,
  MEMORY_FACT_TYPES,
  MEMORY_SOURCES,
  MESOCYCLE_TYPES,
  MOTOR_ABILITIES,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
  PLANES,
  PROPOSAL_SCOPES,
  PROPOSAL_VERDICTS,
  SESSION_KINDS,
  TAKEOFF_LEGS,
  TENDON_SITES,
  UNIT_SYSTEMS,
  WHOOP_RECORD_TYPES,
} from "@/lib/taxonomy";

/**
 * Postgres enums, built from the taxonomy in `lib/taxonomy.ts` so the database and
 * the UI cannot disagree about what the legal values are. What each set means is
 * documented alongside the values there.
 */

export const muscleGroup = pgEnum("muscle_group", MUSCLE_GROUPS);
export const movementPattern = pgEnum("movement_pattern", MOVEMENT_PATTERNS);
export const forceVelocity = pgEnum("force_velocity", FORCE_VELOCITIES);
export const equipment = pgEnum("equipment", EQUIPMENT_TYPES);
export const laterality = pgEnum("laterality", LATERALITIES);
export const plane = pgEnum("plane", PLANES);
export const couplingClass = pgEnum("coupling_class", COUPLING_CLASSES);
export const tendonSite = pgEnum("tendon_site", TENDON_SITES);
export const mesocycleType = pgEnum("mesocycle_type", MESOCYCLE_TYPES);
export const motorAbility = pgEnum("motor_ability", MOTOR_ABILITIES);
export const loadType = pgEnum("load_type", LOAD_TYPES);
export const measurementKind = pgEnum("measurement_kind", MEASUREMENT_KINDS);
export const dataSource = pgEnum("data_source", DATA_SOURCES);
export const sessionKind = pgEnum("session_kind", SESSION_KINDS);
export const proposalScope = pgEnum("proposal_scope", PROPOSAL_SCOPES);
export const proposalVerdict = pgEnum("proposal_verdict", PROPOSAL_VERDICTS);
export const memoryFactType = pgEnum("memory_fact_type", MEMORY_FACT_TYPES);
export const memorySource = pgEnum("memory_source", MEMORY_SOURCES);
export const jumperType = pgEnum("jumper_type", JUMPER_TYPES);
export const armSwing = pgEnum("arm_swing", ARM_SWINGS);
export const takeoffLeg = pgEnum("takeoff_leg", TAKEOFF_LEGS);
export const unitSystem = pgEnum("unit_system", UNIT_SYSTEMS);
export const mealSlot = pgEnum("meal_slot", MEAL_SLOTS);
export const whoopRecordType = pgEnum("whoop_record_type", WHOOP_RECORD_TYPES);
