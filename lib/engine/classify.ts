import type {
  MotorAbility,
  MovementPattern,
  MuscleGroup,
  SessionKind,
} from "@/lib/taxonomy";
import type { EngineExercise, PlannedSession, PlannedSet } from "./types";

/**
 * The classifications more than one rule depends on, defined once so that the
 * normalizer and the gate cannot disagree about what counts as heavy or as a
 * plyometric day.
 */

/** The ebook's shock-method line: ground contact under 0.15 s. */
export const SHOCK_CONTACT_LIMIT = 0.15;
/** Short SSC is under 250 ms of coupling, long SSC over. */
export const SHORT_SSC_LIMIT = 0.25;

/**
 * Sessions that are not training volume: rest and mobility carry none, a tendon
 * protocol session is load management on its own prescription, and a test is a
 * measurement protocol. None of them count toward targets, set caps or the
 * plyometric days, and the dosage rules leave their prescriptions alone.
 */
const NON_TRAINING: ReadonlySet<SessionKind> = new Set([
  "rest",
  "mobility",
  "tendon_protocol",
  "test",
]);

export function isTraining(session: Pick<PlannedSession, "kind">) {
  return !NON_TRAINING.has(session.kind);
}

export function isPlyometric(exercise: EngineExercise) {
  return exercise.couplingClass !== "not_plyometric";
}

/** A shock drill whose measured contact actually clears the 0.15 s line. */
export function isShockDrill(exercise: EngineExercise) {
  return (
    exercise.forceVelocity === "shock" &&
    exercise.typicalContactSeconds !== null &&
    exercise.typicalContactSeconds < SHOCK_CONTACT_LIMIT
  );
}

/**
 * Heavy means near-maximal strength work: 80 percent of 1RM or more, or with no
 * percentage given, 5 reps or fewer on a max-strength lift. Those are the sets
 * that need 4 to 5 minutes to be repeated at quality.
 */
export function isHeavy(exercise: EngineExercise, item: PlannedSet) {
  if (isPlyometric(exercise) || exercise.forceVelocity !== "max_strength") return false;
  if (item.loadPctOf1rm != null) return item.loadPctOf1rm >= 80;
  return item.reps != null && item.reps <= 5;
}

/** Strength work, the unit the strength frequency advisory counts sessions in. */
export function isStrengthWork(exercise: EngineExercise) {
  return !isPlyometric(exercise) && exercise.forceVelocity === "max_strength";
}

/**
 * Large muscle groups before small, and the groups back-to-back sessions must
 * not repeat. Lower is larger; the lower leg and shoulders recover faster and
 * can be trained more often, which is why they are not in `LARGE_GROUPS`.
 */
const SIZE_RANK: Record<MuscleGroup, number> = {
  full_body: 0,
  posterior_chain: 1,
  knee_extensors: 1,
  upper_pull: 2,
  upper_push: 2,
  shoulders: 3,
  lower_leg: 3,
  core: 4,
};

export function sizeRank(group: MuscleGroup) {
  return SIZE_RANK[group];
}

export const LARGE_GROUPS: ReadonlySet<MuscleGroup> = new Set([
  "full_body",
  "posterior_chain",
  "knee_extensors",
  "upper_push",
  "upper_pull",
]);

/**
 * Patterns that do not count as a coordination pattern for the back-to-back
 * rule: holds, bracing, carries and mobility are low in coordination demand and
 * recover quickly, and they would otherwise flag every pair of sessions.
 */
export const LOW_COORDINATION_PATTERNS: ReadonlySet<MovementPattern> = new Set([
  "mobility",
  "brace",
  "isometric_hold",
  "carry",
]);

/**
 * The motor abilities one set trains, for the target share advisory. A set can
 * serve two, a depth jump trains reactive strength and elastic capacity at
 * once, and counts toward both.
 */
export function abilitiesOf(exercise: EngineExercise, item: PlannedSet): MotorAbility[] {
  if (exercise.movementPattern === "sprint") return ["sprint_speed"];
  if (exercise.movementPattern === "mobility") return ["mobility"];
  if (exercise.movementPattern === "carry") return ["work_capacity"];
  switch (exercise.forceVelocity) {
    case "max_strength": {
      if (item.loadPctOf1rm != null && item.loadPctOf1rm >= 80) return ["max_strength"];
      // A hold or a set with no rep count is treated as strength work.
      const reps = item.reps ?? 0;
      if (reps <= 6) return ["max_strength"];
      if (reps <= 15) return ["hypertrophy"];
      return ["strength_endurance"];
    }
    case "speed_strength":
      return ["explosive_strength", "speed_strength", "rate_of_force_development"];
    case "reactive":
    case "shock":
      return ["reactive_strength", "elastic_capacity"];
    case "non_specific":
      return [];
  }
}

/** A session's items in the order they are performed. */
export function itemsOf(session: PlannedSession) {
  return session.blocks.flatMap((block) => block.items);
}

/** Total planned sets, the volume unit every advisory counts in. */
export function setsIn(session: PlannedSession) {
  return itemsOf(session).reduce((sum, item) => sum + item.sets, 0);
}

/** `a`, `a and b`, `a, b and c`. */
export function list(values: readonly string[]) {
  if (values.length <= 1) return values.join("");
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

/** `45 s`, `2 min`, `4 min 30 s`. */
export function formatSeconds(seconds: number) {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** `0.140` reads as `0.14 s`. */
export function formatContact(seconds: number) {
  return `${Number(seconds.toFixed(3))} s`;
}

export function percent(share: number) {
  return `${Math.round(share * 100)}%`;
}
