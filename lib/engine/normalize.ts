import type { CouplingClass, ForceVelocity } from "@/lib/taxonomy";
import { couplingClassLabels } from "@/lib/labels";
import {
  formatContact,
  formatSeconds,
  isHeavy,
  isPlyometric,
  isShockDrill,
  isTraining,
  itemsOf,
  SHOCK_CONTACT_LIMIT,
  SHORT_SSC_LIMIT,
  sizeRank,
} from "./classify";
import type { RuleId } from "./rules";
import type {
  Change,
  ComplexItem,
  Directory,
  EngineExercise,
  MicrocyclePlan,
  PlannedBlock,
  PlannedSession,
  PlannedSet,
} from "./types";

/**
 * Stage 3: fill in every field that has exactly one correct answer.
 *
 * The model chooses exercises, emphasis and rationale. Ordering, rest windows,
 * dosage clamps and coupling labels are computed here instead of being guessed
 * by the model and then judged by the gate. The normalizer cannot fail, only
 * fix, and every fix is recorded so the proposal shows what changed and why.
 *
 * Each rule is its own pure function over a session. They run labels first,
 * because the rest band reads the shock label, and ordering last, because it
 * only moves items and must see the final prescriptions.
 */

export type NormalizeContext = {
  directory: Directory;
  /** Exercise ids the block's complex marks as main lifts. */
  mains: ReadonlySet<number>;
};

type Step = { session: PlannedSession; changes: Change[] };
type Rule = (session: PlannedSession, context: NormalizeContext) => Step;

/**
 * Rewrites items one at a time. Items whose exercise the directory does not hold
 * are left exactly as written: the gate's closed-set check reports them, and
 * guessing at their attributes here would only hide that.
 */
function eachItem(
  session: PlannedSession,
  context: NormalizeContext,
  fix: (item: PlannedSet, exercise: EngineExercise, change: Recorder) => PlannedSet,
): Step {
  const changes: Change[] = [];
  const blocks = session.blocks.map((block) => ({
    ...block,
    items: block.items.map((item) => {
      const exercise = context.directory.get(item.exerciseId);
      if (!exercise) return item;
      const record: Recorder = (rule, field, from, to, message) =>
        changes.push({ rule, day: session.day, exerciseId: item.exerciseId, field, from, to, message });
      return fix(item, exercise, record);
    }),
  }));
  return { session: { ...session, blocks }, changes };
}

type Recorder = (
  rule: RuleId,
  field: Change["field"],
  from: Change["from"],
  to: Change["to"],
  message: string,
) => void;

// -----------------------------------------------------------------------------
// coupling-label
// -----------------------------------------------------------------------------

/** The class a drill's contact time puts it in. A static start has no coupling at all. */
export function couplingClassFor(exercise: EngineExercise): CouplingClass {
  if (!isPlyometric(exercise)) return "not_plyometric";
  if (exercise.couplingClass === "non_classical") return "non_classical";
  if (exercise.typicalContactSeconds === null) return exercise.couplingClass;
  return exercise.typicalContactSeconds < SHORT_SSC_LIMIT ? "short_ssc" : "long_ssc";
}

function couplingReason(exercise: EngineExercise, to: CouplingClass) {
  if (to === "not_plyometric") return `${exercise.name} is not a plyometric drill`;
  if (to === "non_classical") {
    return `${exercise.name} does not couple an eccentric into a concentric, so it is non-classical rather than an SSC`;
  }
  const contact = exercise.typicalContactSeconds;
  if (contact === null) {
    return `${exercise.name} has no measured contact time, so it keeps its directory class`;
  }
  return to === "short_ssc"
    ? `${exercise.name} contacts the ground for ${formatContact(contact)}, a short SSC under 250 ms`
    : `${exercise.name} contacts the ground for ${formatContact(contact)}, a long SSC at 250 ms or more`;
}

function shockReason(exercise: EngineExercise) {
  if (exercise.forceVelocity !== "shock") {
    return `${exercise.name} is not a shock-method drill, so it is not labelled shock method`;
  }
  const contact = exercise.typicalContactSeconds;
  if (contact === null) {
    return `${exercise.name} has no measured contact under ${SHOCK_CONTACT_LIMIT} s, so it is not labelled shock method`;
  }
  return `${exercise.name} contacts the ground for ${formatContact(contact)}, at or above the ${SHOCK_CONTACT_LIMIT} s shock-method line, so it is not labelled shock method`;
}

/**
 * The coupling class follows the contact time, and nothing at or above 0.15 s
 * is shock method whatever it is called, because above that line it is not
 * shock-method plyometrics.
 */
export const couplingLabel: Rule = (session, context) =>
  eachItem(session, context, (item, exercise, record) => {
    let next = item;
    const expected = couplingClassFor(exercise);
    const labelled = item.couplingClass ?? null;
    const labelIsFine =
      expected === "not_plyometric"
        ? labelled === null || labelled === "not_plyometric"
        : labelled === expected;
    if (!labelIsFine) {
      record(
        "coupling-label",
        "couplingClass",
        labelled,
        expected,
        `${couplingReason(exercise, expected)}: labelled ${couplingClassLabels.of(expected)}${labelled ? ` rather than ${couplingClassLabels.of(labelled)}` : ""}.`,
      );
      next = { ...next, couplingClass: expected };
    }

    const shock = isShockDrill(exercise);
    const claimed = item.shockMethod ?? null;
    if (claimed === true && !shock) {
      record("coupling-label", "shockMethod", true, false, `${shockReason(exercise)}.`);
      next = { ...next, shockMethod: false };
    } else if (shock && claimed !== true) {
      record(
        "coupling-label",
        "shockMethod",
        claimed,
        true,
        `${exercise.name} contacts the ground for ${formatContact(exercise.typicalContactSeconds!)}, under the ${SHOCK_CONTACT_LIMIT} s line, so it is labelled shock method.`,
      );
      next = { ...next, shockMethod: true };
    }
    return next;
  });

// -----------------------------------------------------------------------------
// plyo-dose
// -----------------------------------------------------------------------------

export const PLYO_REPS = { min: 8, max: 12 } as const;
export const PLYO_SETS = { min: 3, max: 6 } as const;

function clamp(value: number, band: { min: number; max: number }) {
  return Math.min(band.max, Math.max(band.min, value));
}

/**
 * 8 to 12 reps and 3 to 6 sets. Tendon protocol and test sessions are left
 * alone: phase 3 prescribes 4 x 6 to 8 depth landings, and a test is a count of
 * attempts rather than a training dose.
 */
export const plyoDose: Rule = (session, context) => {
  if (!isTraining(session)) return { session, changes: [] };
  return eachItem(session, context, (item, exercise, record) => {
    if (!isPlyometric(exercise)) return item;
    let next = item;
    const reps = item.reps ?? null;
    const fixedReps = reps === null ? PLYO_REPS.min : clamp(reps, PLYO_REPS);
    if (fixedReps !== reps) {
      record(
        "plyo-dose",
        "reps",
        reps,
        fixedReps,
        reps === null
          ? `${exercise.name} had no rep count, so it is set to ${fixedReps}: plyometrics run 8 to 12 reps.`
          : `${exercise.name} ${reps > fixedReps ? "lowered" : "raised"} from ${reps} to ${fixedReps} reps: plyometrics run 8 to 12.`,
      );
      next = { ...next, reps: fixedReps };
    }
    const fixedSets = clamp(item.sets, PLYO_SETS);
    if (fixedSets !== item.sets) {
      record(
        "plyo-dose",
        "sets",
        item.sets,
        fixedSets,
        `${exercise.name} ${item.sets > fixedSets ? "lowered" : "raised"} from ${item.sets} to ${fixedSets} sets: plyometrics run 3 to 6.`,
      );
      next = { ...next, sets: fixedSets };
    }
    return next;
  });
};

// -----------------------------------------------------------------------------
// Rest bands, shared by plyo-rest and heavy-rest
// -----------------------------------------------------------------------------

type RestBand = { min: number; max: number; mid: number; why: string };

export const HEAVY_REST: RestBand = {
  min: 240,
  max: 300,
  mid: 270,
  why: "heavy sets rest 4 to 5 minutes",
};
export const PLYO_REST = {
  shock: { min: 120, max: 180, mid: 150, why: "shock-method work rests 2 to 3 minutes" },
  low: { min: 30, max: 60, mid: 45, why: "low-intensity plyometrics rest 30 to 60 seconds" },
  standard: { min: 60, max: 120, mid: 90, why: "plyometrics rest 1 to 2 minutes" },
} as const satisfies Record<string, RestBand>;

function fitRest(
  rule: RuleId,
  item: PlannedSet,
  exercise: EngineExercise,
  band: RestBand,
  record: Recorder,
): PlannedSet {
  const rest = item.restSeconds ?? null;
  const fixed = rest === null ? band.mid : clamp(rest, band);
  if (fixed === rest) return item;
  record(
    rule,
    "restSeconds",
    rest,
    fixed,
    rest === null
      ? `${exercise.name} rest set to ${formatSeconds(fixed)}: ${band.why}.`
      : `${exercise.name} rest ${rest > fixed ? "lowered" : "raised"} from ${formatSeconds(rest)} to ${formatSeconds(fixed)}: ${band.why}.`,
  );
  return { ...item, restSeconds: fixed };
}

/** Low intensity is a gentle tendon load with no shock component. */
function plyoBand(exercise: EngineExercise, item: PlannedSet): RestBand {
  if (item.shockMethod) return PLYO_REST.shock;
  if (exercise.tendonLoadRating <= 2) return PLYO_REST.low;
  return PLYO_REST.standard;
}

export const plyoRest: Rule = (session, context) => {
  if (!isTraining(session)) return { session, changes: [] };
  return eachItem(session, context, (item, exercise, record) =>
    isPlyometric(exercise)
      ? fitRest("plyo-rest", item, exercise, plyoBand(exercise, item), record)
      : item,
  );
};

// -----------------------------------------------------------------------------
// heavy-rest
// -----------------------------------------------------------------------------

export const heavyRest: Rule = (session, context) => {
  if (!isTraining(session)) return { session, changes: [] };
  return eachItem(session, context, (item, exercise, record) =>
    isHeavy(exercise, item) ? fitRest("heavy-rest", item, exercise, HEAVY_REST, record) : item,
  );
};

// -----------------------------------------------------------------------------
// demand-order and main-before-assistance
// -----------------------------------------------------------------------------

const DYNAMIC: ReadonlySet<ForceVelocity> = new Set(["shock", "reactive", "speed_strength"]);
const DYNAMIC_RANK: Partial<Record<ForceVelocity, number>> = {
  shock: 0,
  reactive: 1,
  speed_strength: 2,
};
const TIER: Record<ForceVelocity, number> = {
  shock: 0,
  reactive: 0,
  speed_strength: 0,
  max_strength: 1,
  non_specific: 2,
};

type Key = number[];

/**
 * Dynamic work before slow strength work before everything else. Among the
 * dynamic drills, the most coordination-demanding goes first, then the most
 * intense point on the force velocity curve, then the heaviest load.
 */
function demandKey(exercise: EngineExercise, item: PlannedSet): Key {
  const tier = TIER[exercise.forceVelocity];
  if (!DYNAMIC.has(exercise.forceVelocity)) return [tier, 0, 0, 0];
  return [
    tier,
    -exercise.technicalComplexity,
    DYNAMIC_RANK[exercise.forceVelocity] ?? 0,
    -(item.loadPctOf1rm ?? 0),
  ];
}

/** Within equal demand: main lifts, then larger groups, then heavier load. */
function mainKey(exercise: EngineExercise, item: PlannedSet, mains: ReadonlySet<number>): Key {
  return [
    mains.has(exercise.id) ? 0 : 1,
    sizeRank(exercise.primaryMuscleGroup),
    -(item.loadPctOf1rm ?? 0),
  ];
}

function compare(a: Key, b: Key) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function ordinal(n: number) {
  const suffix = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
  return `${n}${suffix}`;
}

/**
 * Sorts items within each block and blocks by their lead item. A complex pair
 * moves as a unit and keeps its internal order, which is the point of pairing.
 * A leading run of warm-up blocks, all mobility work, stays at the start.
 */
function sortSession(
  session: PlannedSession,
  keyOf: (item: PlannedSet) => Key,
  isMobility: (item: PlannedSet) => boolean,
): PlannedSession {
  let warmUp = 0;
  while (
    warmUp < session.blocks.length &&
    session.blocks[warmUp].items.length > 0 &&
    session.blocks[warmUp].items.every(isMobility)
  ) {
    warmUp++;
  }
  const rest: PlannedBlock[] = session.blocks.slice(warmUp).map((block) =>
    block.complexPair
      ? block
      : { ...block, items: [...block.items].sort((a, b) => compare(keyOf(a), keyOf(b))) },
  );
  rest.sort((a, b) => compare(keyOf(a.items[0]), keyOf(b.items[0])));
  return { ...session, blocks: [...session.blocks.slice(0, warmUp), ...rest] };
}

/**
 * Records the items that moved earlier. Everything they overtook moved later
 * as a consequence, so listing only the promotions keeps the diff readable.
 */
function ordering(
  rule: "demand-order" | "main-before-assistance",
  session: PlannedSession,
  context: NormalizeContext,
  keyOf: (item: PlannedSet, exercise: EngineExercise) => Key,
  reason: (moved: EngineExercise, overtaken: EngineExercise[]) => string,
): Step {
  if (session.kind === "test") return { session, changes: [] };
  const before = itemsOf(session);
  const exercises = before.map((item) => context.directory.get(item.exerciseId));
  if (exercises.some((exercise) => !exercise)) return { session, changes: [] };
  const exerciseOf = new Map(before.map((item, i) => [item, exercises[i]!]));

  const sorted = sortSession(
    session,
    (item) => keyOf(item, exerciseOf.get(item)!),
    (item) => exerciseOf.get(item)!.movementPattern === "mobility",
  );
  const after = itemsOf(sorted);
  const from = new Map(before.map((item, i) => [item, i]));

  const changes: Change[] = [];
  after.forEach((item, to) => {
    const was = from.get(item)!;
    if (to >= was) return;
    const moved = exerciseOf.get(item)!;
    const overtaken = before
      .slice(0, was)
      .filter((other) => after.indexOf(other) > to)
      .map((other) => exerciseOf.get(other)!);
    changes.push({
      rule,
      day: session.day,
      exerciseId: item.exerciseId,
      field: "position",
      from: was + 1,
      to: to + 1,
      message: `${moved.name} moved from ${ordinal(was + 1)} to ${ordinal(to + 1)}: ${reason(moved, overtaken)}.`,
    });
  });
  return { session: sorted, changes };
}

/** Highest intensity, highest coordination demand and most dynamic work first, while rested. */
export const demandOrder: Rule = (session, context) =>
  ordering(
    "demand-order",
    session,
    context,
    (item, exercise) => demandKey(exercise, item),
    (moved, overtaken) =>
      overtaken.some((other) => TIER[other.forceVelocity] > TIER[moved.forceVelocity])
        ? "the most dynamic work goes first, while rested"
        : "the most coordination-demanding and intense work goes first, while rested",
  );

/** Main lifts before assistance, large muscle groups before small. */
export const mainBeforeAssistance: Rule = (session, context) =>
  ordering(
    "main-before-assistance",
    session,
    context,
    (item, exercise) => [...demandKey(exercise, item), ...mainKey(exercise, item, context.mains)],
    (moved, overtaken) =>
      context.mains.has(moved.id) && overtaken.some((other) => !context.mains.has(other.id))
        ? "main lifts go before assistance"
        : "large muscle groups go before small",
  );

// -----------------------------------------------------------------------------

export const NORMALIZE_RULES: readonly Rule[] = [
  couplingLabel,
  plyoDose,
  plyoRest,
  heavyRest,
  demandOrder,
  mainBeforeAssistance,
];

export function normalizeSession(session: PlannedSession, context: NormalizeContext): Step {
  let current = session;
  const changes: Change[] = [];
  for (const rule of NORMALIZE_RULES) {
    const step = rule(current, context);
    current = step.session;
    changes.push(...step.changes);
  }
  return { session: current, changes };
}

export function normalizeWeek(
  week: MicrocyclePlan,
  directory: Directory,
  complex: readonly ComplexItem[],
): { week: MicrocyclePlan; changes: Change[] } {
  const context: NormalizeContext = {
    directory,
    mains: new Set(complex.filter((item) => item.isMain).map((item) => item.exerciseId)),
  };
  const changes: Change[] = [];
  const sessions = week.sessions.map((session) => {
    const step = normalizeSession(session, context);
    changes.push(...step.changes);
    return step.session;
  });
  return { week: { ...week, sessions }, changes };
}
