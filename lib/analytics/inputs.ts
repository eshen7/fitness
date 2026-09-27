import { addDays, daysBetween } from "@/lib/days";
import type { BlockBand, JumpSitting } from "@/lib/progress/derive";
import { weekStart } from "@/lib/progress/scale";
import type {
  CouplingClass,
  ForceVelocity,
  MesocycleType,
  MovementPattern,
  MuscleGroup,
  ProposalScope,
  ProposalVerdict,
  SessionKind,
  TendonSite,
  TestKind,
} from "@/lib/taxonomy";
import { kalmanLevel } from "./stats";

/**
 * Everything the insight suite reads, and the few derivations more than one
 * insight needs.
 *
 * One input object rather than a query per insight, for a reason that is about
 * correctness rather than convenience: the suite runs as a unit, the correction in
 * `insight.ts` is across the whole of it, and an insight that fetched its own rows
 * would be computed over a different window than the insight it is being corrected
 * alongside. Loading once also makes the whole suite a pure function of a plain
 * value, which is what lets `suite.test.ts` run it over fixtures with no database.
 *
 * Every field is a flat, day-keyed, chronologically ordered list. Nothing here is
 * pre-aggregated by week or by exercise, because different insights want different
 * groupings of the same rows and an input shaped for one of them quietly rules the
 * others out.
 */

export type AnalyticsExercise = {
  id: number;
  name: string;
  primaryMuscleGroup: MuscleGroup;
  movementPattern: MovementPattern;
  forceVelocity: ForceVelocity;
  couplingClass: CouplingClass;
  highImpact: boolean;
  loadsTendonSites: TendonSite[];
  tendonLoadRating: number;
};

export type LoggedSetRow = {
  day: string;
  sessionId: number;
  exerciseId: number;
  reps: number | null;
  loadKg: number | null;
  holdSeconds: number | null;
  boxHeightCm: number | null;
  rpe: number | null;
  qualityRating: number | null;
  /** Null for a set logged off-plan, which is the normal case for extra work. */
  prescribedSetId: number | null;
};

export type PrescribedSetRow = {
  id: number;
  sessionId: number;
  exerciseId: number;
  sets: number;
  reps: number | null;
  targetRpe: number | null;
  loadKg: number | null;
};

export type SessionRow = {
  id: number;
  day: string;
  kind: SessionKind;
  plannedSets: number | null;
  plannedContacts: number | null;
  plannedIntensity: number | null;
  reportedRpe: number | null;
  completed: boolean;
  skipped: boolean;
  /** Null for an ad-hoc session with no generated week behind it. */
  microcycleId: number | null;
};

export type TendonRow = {
  day: string;
  site: TendonSite;
  painDuringLoad: number;
  painAfterLoad: number;
  morningStiffness: number;
  protocolPhase: number | null;
};

export type ReadinessRow = {
  day: string;
  recoveryScore: number | null;
  hrvMs: number | null;
  restingHeartRate: number | null;
  sleepMinutes: number | null;
  sleepPerformancePct: number | null;
  slowWaveMinutes: number | null;
  remMinutes: number | null;
  dayStrain: number | null;
  motivation: number | null;
  sorenessByRegion: Record<string, number>;
};

export type ProposalRow = {
  id: number;
  scope: ProposalScope;
  verdict: ProposalVerdict;
  repairAttempts: number;
  isFallback: boolean;
  /** True when the gate found nothing wrong with the model's first answer. */
  passedFirstAttempt: boolean;
  /** How many fields the owner changed before accepting. Null when untouched. */
  editedFields: number | null;
};

export type AnalyticsInputs = {
  /** The day the suite is being computed for. Every window is measured back from it. */
  asOf: string;
  /** 0 is Sunday, matching `profile.trainable_weekdays`. */
  trainableWeekdays: number[];
  exercises: Map<number, AnalyticsExercise>;
  loggedSets: LoggedSetRow[];
  prescribedSets: PrescribedSetRow[];
  sessions: SessionRow[];
  tests: JumpSitting[];
  bodyweight: { day: string; kg: number }[];
  intake: { day: string; kcal: number }[];
  tendon: TendonRow[];
  readiness: ReadinessRow[];
  blocks: BlockBand[];
  proposals: ProposalRow[];
};

/** An empty history, for tests and for the first run against a fresh database. */
export function emptyInputs(asOf: string): AnalyticsInputs {
  return {
    asOf,
    trainableWeekdays: [],
    exercises: new Map(),
    loggedSets: [],
    prescribedSets: [],
    sessions: [],
    tests: [],
    bodyweight: [],
    intake: [],
    tendon: [],
    readiness: [],
    blocks: [],
    proposals: [],
  };
}

// -----------------------------------------------------------------------------
// Daily load
// -----------------------------------------------------------------------------

/**
 * One day's training load, in the three currencies that have to be tracked apart.
 *
 * They are separate because the ebook is explicit that fatigue is specific to the
 * type of muscular work, so a single load number is not a simplification of this,
 * it is a contradiction of it. An athlete can be too tired to bound and perfectly
 * able to squat, and an acute-to-chronic ratio computed over the sum of the two
 * would report neither.
 */
export type DayLoad = {
  day: string;
  /** Reps of high-impact work, which is what the tendon ceiling is denominated in. */
  contacts: number;
  /** Sets of reactive or shock work, plyometric volume in the ebook's sense. */
  plyoSets: number;
  /** Load times reps, summed. The strength currency. */
  tonnageKg: number;
  sets: number;
  /** WHOOP day strain, an external cross-check that owes nothing to what was logged. */
  strain: number | null;
};

const PLYOMETRIC_VELOCITIES: ReadonlySet<ForceVelocity> = new Set([
  "reactive",
  "shock",
  "speed_strength",
]);

/**
 * Daily loads over the whole window, including the days nothing happened.
 *
 * The zero days are the point. A workload ratio, a monotony figure and a
 * days-since-rest count are all averages over calendar time, and skipping the rest
 * days turns "four hard sessions and three off" into "four hard sessions", which
 * reads as a far more monotonous week than it was.
 */
export function dailyLoads(inputs: AnalyticsInputs, windowDays: number): DayLoad[] {
  const from = addDays(inputs.asOf, -windowDays + 1);
  const byDay = new Map<string, DayLoad>();
  for (let offset = 0; offset < windowDays; offset += 1) {
    const day = addDays(from, offset);
    byDay.set(day, { day, contacts: 0, plyoSets: 0, tonnageKg: 0, sets: 0, strain: null });
  }

  for (const set of inputs.loggedSets) {
    const load = byDay.get(set.day);
    if (!load) continue;
    const exercise = inputs.exercises.get(set.exerciseId);
    load.sets += 1;
    if (exercise?.highImpact) load.contacts += set.reps ?? 1;
    if (exercise && PLYOMETRIC_VELOCITIES.has(exercise.forceVelocity)) load.plyoSets += 1;
    if (set.loadKg !== null && set.reps !== null) load.tonnageKg += set.loadKg * set.reps;
  }
  for (const day of inputs.readiness) {
    const load = byDay.get(day.day);
    if (load) load.strain = day.dayStrain;
  }

  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Loads rolled into Monday-started weeks, oldest first. */
export function weeklyLoads(loads: readonly DayLoad[]): DayLoad[] {
  const byWeek = new Map<string, DayLoad>();
  for (const load of loads) {
    const week = weekStart(load.day);
    const held = byWeek.get(week) ?? {
      day: week,
      contacts: 0,
      plyoSets: 0,
      tonnageKg: 0,
      sets: 0,
      strain: null,
    };
    held.contacts += load.contacts;
    held.plyoSets += load.plyoSets;
    held.tonnageKg += load.tonnageKg;
    held.sets += load.sets;
    if (load.strain !== null) held.strain = (held.strain ?? 0) + load.strain;
    byWeek.set(week, held);
  }
  return [...byWeek.values()].sort((a, b) => a.day.localeCompare(b.day));
}

// -----------------------------------------------------------------------------
// Bodyweight
// -----------------------------------------------------------------------------

/**
 * How much the true weight is allowed to move per day against how noisy one
 * morning is, in kg².
 *
 * A standard deviation of about 0.6 kg on a single reading - hydration, gut
 * content, when the scale was stood on - against a true level that moves maybe
 * 60 g a day even during a deliberate gain. That ratio is what makes the filter
 * ignore a two-kilo Sunday and still follow a real month-long drift.
 */
const WEIGHT_PROCESS_VARIANCE = 0.0036;
const WEIGHT_OBSERVATION_VARIANCE = 0.36;

/**
 * Bodyweight with the noise taken out, one point per reading.
 *
 * A Kalman filter with a backward smoothing pass rather than the exponentially
 * weighted mean `lib/progress/derive.ts` draws. Both are right for their jobs: the
 * EWMA is what a live readout should show, because it only ever uses the past, and
 * it lags by about its own memory length. That lag is the same size as the effect
 * the maintenance-calorie and rate-of-change insights are trying to measure, so
 * here the whole series is available and the smoother should use it.
 */
export function smoothedBodyweight(
  readings: readonly { day: string; kg: number }[],
): { day: string; kg: number }[] {
  if (readings.length === 0) return [];
  const ordered = [...readings].sort((a, b) => a.day.localeCompare(b.day));

  // Scaled by the gap, so a fortnight with no readings is not treated as one step:
  // the level is allowed to have moved fourteen days' worth across it.
  const levels = kalmanLevel(
    ordered.map((reading) => reading.kg),
    {
      processVariance: WEIGHT_PROCESS_VARIANCE * averageGap(ordered),
      observationVariance: WEIGHT_OBSERVATION_VARIANCE,
    },
  );
  return ordered.map((reading, index) => ({ day: reading.day, kg: levels[index] }));
}

function averageGap(ordered: readonly { day: string }[]): number {
  if (ordered.length < 2) return 1;
  const span = daysBetween(ordered[0].day, ordered[ordered.length - 1].day);
  return Math.max(1, span / (ordered.length - 1));
}

/** The smoothed weight on a day, carried forward from the last reading before it. */
export function weightOn(
  trend: readonly { day: string; kg: number }[],
  day: string,
): number | null {
  let held: number | null = null;
  for (const point of trend) {
    if (point.day > day) break;
    held = point.kg;
  }
  return held;
}

// -----------------------------------------------------------------------------
// Estimated one-rep max
// -----------------------------------------------------------------------------

/**
 * Above this many reps an estimate stops being an estimate.
 *
 * Every rep-max formula is fit near the top of the curve, and a set of fifteen is
 * limited by how long the muscle can keep going rather than by how much force it
 * can make. Including those sets does not add data to a strength trend, it adds a
 * different measurement wearing the same units.
 */
export const MAX_REPS_FOR_ONE_RM = 10;

/**
 * Epley. One formula rather than an average of several, because the absolute
 * number matters far less here than its comparability over time: every insight
 * built on this reads a *trend*, and a systematic bias cancels in a slope while a
 * formula that changed between months would not.
 */
export function epley(loadKg: number, reps: number): number {
  return loadKg * (1 + reps / 30);
}

export type OneRmPoint = {
  day: string;
  exerciseId: number;
  exerciseName: string;
  oneRmKg: number;
};

/**
 * The best estimated one-rep max per exercise per day, from logged reps at load.
 *
 * The daily maximum rather than the mean of the day's sets: back-off sets and
 * warm-ups are in the log too, and averaging them in would make a session's
 * estimate a function of how the session was structured rather than of how strong
 * the athlete was.
 */
export function oneRmSeries(inputs: AnalyticsInputs): OneRmPoint[] {
  const best = new Map<string, OneRmPoint>();
  for (const set of inputs.loggedSets) {
    if (set.loadKg === null || set.loadKg <= 0) continue;
    if (set.reps === null || set.reps < 1 || set.reps > MAX_REPS_FOR_ONE_RM) continue;
    const exercise = inputs.exercises.get(set.exerciseId);
    if (!exercise) continue;
    // Jumps and throws carry load and reps too; a one-rep max of a depth jump is
    // not a quantity, so only the slow strength end of the curve is estimated.
    if (exercise.forceVelocity !== "max_strength") continue;

    const oneRmKg = epley(set.loadKg, set.reps);
    const key = `${set.day}:${set.exerciseId}`;
    const held = best.get(key);
    if (!held || oneRmKg > held.oneRmKg) {
      best.set(key, { day: set.day, exerciseId: set.exerciseId, exerciseName: exercise.name, oneRmKg });
    }
  }
  return [...best.values()].sort((a, b) => a.day.localeCompare(b.day));
}

// -----------------------------------------------------------------------------
// Day-keyed series, the shape the lag analyses want
// -----------------------------------------------------------------------------

/** The worst pain reported on each day, across all sites and all three questions. */
export function worstPainByDay(tendon: readonly TendonRow[]): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const row of tendon) {
    const worst = Math.max(row.painDuringLoad, row.painAfterLoad, row.morningStiffness);
    byDay.set(row.day, Math.max(byDay.get(row.day) ?? 0, worst));
  }
  return byDay;
}

/**
 * Which mesocycle a day falls inside, or null for a day between blocks.
 *
 * `endDay` is exclusive, matching `BlockBand`. A block's last day belongs to it and
 * its `endDay` belongs to whatever comes next, so `<=` here would put every boundary
 * day in two blocks at once and double-count it in any per-block aggregate.
 */
export function blockTypeOn(
  blocks: readonly BlockBand[],
  day: string,
): MesocycleType | null {
  for (const block of blocks) {
    if (day >= block.startDay && day < block.endDay) return block.type;
  }
  return null;
}

/** The best attempt of each sitting of one test kind, as a day-keyed series. */
export function bestByDay(
  tests: readonly JumpSitting[],
  kind: TestKind,
): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const sitting of tests) {
    if (sitting.kind !== kind) continue;
    byDay.set(sitting.day, Math.max(byDay.get(sitting.day) ?? 0, sitting.best));
  }
  return byDay;
}
