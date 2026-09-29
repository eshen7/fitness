import { z } from "zod";
import {
  COUPLING_CLASSES,
  LOAD_TYPES,
  MESOCYCLE_TYPES,
  MOTOR_ABILITIES,
  SESSION_KINDS,
  type CouplingClass,
  type Equipment,
  type ForceVelocity,
  type Laterality,
  type MovementPattern,
  type MuscleGroup,
  type TendonSite,
} from "@/lib/taxonomy";
import type { Invariant, RuleId } from "./rules";

/**
 * The shapes the rule engine reads and writes.
 *
 * The plan schemas are what the phase 5 generator is asked to produce, so they
 * check shape and nothing else. A plan with three target abilities or a single
 * plyometric day must still parse: the gate is what rejects it, with a message
 * naming the rule, and a parse error would turn that specific repair request
 * into a generic failure.
 */

/** An ISO calendar day, `2026-09-21`. */
const isoDay = z.iso.date();

export const plannedSetSchema = z.object({
  exerciseId: z.number().int().positive(),
  sets: z.number().int().min(1),
  reps: z.number().int().min(1).nullish(),
  holdSeconds: z.number().positive().nullish(),
  loadPctOf1rm: z.number().int().min(1).max(120).nullish(),
  loadKg: z.number().nonnegative().nullish(),
  boxHeightCm: z.number().nonnegative().nullish(),
  /**
   * How hard the set should feel, 1 to 10. The gate requires one on every working
   * set of a training session; mobility work and the non-training sessions may
   * leave it empty.
   */
  targetRpe: z.number().min(1).max(10).nullish(),
  tempo: z.string().nullish(),
  /** Normalizer-owned. The model may suggest one; the heavy and plyo rest rules decide. */
  restSeconds: z.number().int().nonnegative().nullish(),
  /** Normalizer-owned, derived from the drill's contact time. */
  couplingClass: z.enum(COUPLING_CLASSES).nullish(),
  /** Normalizer-owned. Only true for shock drills with contact under 0.15 s. */
  shockMethod: z.boolean().nullish(),
});
export type PlannedSet = z.infer<typeof plannedSetSchema>;

export const plannedBlockSchema = z.object({
  label: z.string(),
  /**
   * A complex-training pair: a strength exercise followed by a plyo of similar
   * movement pattern. Its internal order is deliberate, so the normalizer moves
   * the pair as a unit and never sorts inside it.
   */
  complexPair: z.boolean().nullish(),
  items: z.array(plannedSetSchema).min(1),
});
export type PlannedBlock = z.infer<typeof plannedBlockSchema>;

export const plannedSessionSchema = z.object({
  day: isoDay,
  kind: z.enum(SESSION_KINDS),
  title: z.string().nullish(),
  /** 1 to 10, read by the plyometric frequency rule. */
  plannedIntensity: z.number().int().min(1).max(10),
  blocks: z.array(plannedBlockSchema),
});
export type PlannedSession = z.infer<typeof plannedSessionSchema>;

export const microcyclePlanSchema = z.object({
  ordinal: z.number().int().min(1),
  startDate: isoDay,
  loadType: z.enum(LOAD_TYPES),
  /** 0 to 1 against the block's heaviest week. */
  relativeLoad: z.number().min(0).max(1),
  sessions: z.array(plannedSessionSchema),
});
export type MicrocyclePlan = z.infer<typeof microcyclePlanSchema>;

export const complexItemSchema = z.object({
  exerciseId: z.number().int().positive(),
  isMain: z.boolean(),
  /** At least 2, per the ebook; a higher number is a stricter floor. */
  targetWeeklyFrequency: z.number().int().min(1).nullish(),
});
export type ComplexItem = z.infer<typeof complexItemSchema>;

/**
 * The block, declared when it opens. Target count, technical focus and the
 * complex are fixed here, which is why the mesocycle-scope gate rules can run at
 * declaration and again at every weekly generation.
 *
 * `technicalFocus` is a list only so that over-declaring is representable and
 * the gate can say so; the database stores the single accepted value.
 */
export const mesocycleDeclarationSchema = z.object({
  type: z.enum(MESOCYCLE_TYPES),
  plannedMicrocycles: z.number().int().min(1),
  targetAbilities: z.array(z.enum(MOTOR_ABILITIES)),
  technicalFocus: z.array(z.string()),
  complex: z.array(complexItemSchema),
});
export type MesocycleDeclaration = z.infer<typeof mesocycleDeclarationSchema>;

/**
 * An exercise as the engine sees it: the directory row with numerics already
 * converted from the driver's strings and nothing the rules do not read.
 */
export type EngineExercise = {
  id: number;
  slug: string;
  name: string;
  primaryMuscleGroup: MuscleGroup;
  secondaryMuscleGroups: readonly MuscleGroup[];
  movementPattern: MovementPattern;
  forceVelocity: ForceVelocity;
  laterality: Laterality;
  couplingClass: CouplingClass;
  typicalContactSeconds: number | null;
  highImpact: boolean;
  equipment: readonly Equipment[];
  equipmentAnyOf: readonly Equipment[];
  loadsTendonSites: readonly TendonSite[];
  tendonLoadRating: number;
  protocolPhase: number | null;
  technicalComplexity: number;
  available: boolean;
};

export type Directory = ReadonlyMap<number, EngineExercise>;

/** One tendon check-in, as the pre-filter reads it. */
export type TendonReading = {
  site: TendonSite;
  recordedAt: Date;
  painDuringLoad: number;
  painAfterLoad: number;
  morningStiffness: number;
  protocolPhase: number | null;
};

/** An exercise the pre-filter removed, and why, in words the owner can check. */
export type Exclusion = {
  rule: RuleId;
  exerciseId: number;
  message: string;
};

/** A field the normalizer filled in or corrected. It never fails, only fixes. */
export type Change = {
  rule: RuleId;
  day: string;
  exerciseId: number;
  field: "position" | "sets" | "reps" | "restSeconds" | "couplingClass" | "shockMethod";
  from: string | number | boolean | null;
  to: string | number | boolean | null;
  message: string;
};

/**
 * A gate failure, returned to the model as a structured repair request.
 *
 * An invariant is not one of the eighteen rules; `INVARIANTS` in `rules.ts` says
 * what each one protects.
 */
export type Violation = {
  rule: RuleId | Invariant;
  scope: "mesocycle" | "microcycle" | "session";
  message: string;
  day?: string;
  exerciseIds?: number[];
};

/** A note on the proposal and a signal for the memory layer. Never blocks. */
export type Advisory = {
  rule: RuleId;
  scope: "mesocycle" | "microcycle" | "session";
  message: string;
  day?: string;
};
