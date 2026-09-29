import { daysBetween, formatDay } from "@/lib/days";
import { motorAbilityLabels, movementPatternLabels, muscleGroupLabels } from "@/lib/labels";
import type { MovementPattern, MuscleGroup } from "@/lib/taxonomy";
import {
  isPlyometric,
  isShockDrill,
  isTraining,
  itemsOf,
  LARGE_GROUPS,
  list,
  LOW_COORDINATION_PATTERNS,
  setsIn,
} from "./classify";
import { nameOf } from "./directory";
import type {
  Directory,
  Exclusion,
  MesocycleDeclaration,
  MicrocyclePlan,
  PlannedSession,
  Violation,
} from "./types";

/**
 * Stage 4, the gate: the five rules that need structural judgment, which code
 * cannot repair without rewriting the plan, and the two invariants in `rules.ts`.
 * Every failure is a specific message naming what to change, because it goes
 * back to the model as a repair request and a generic "invalid plan" gives it
 * nothing to repair.
 *
 * The mesocycle-scope rules run at block declaration, with no week, and again at
 * every weekly generation. Nothing here runs per session.
 */

export type GateInput = {
  declaration: MesocycleDeclaration;
  directory: Directory;
  /** The ids the pre-filter left eligible today. */
  eligible: ReadonlySet<number>;
  /** Why the rest were excluded, so a closed-set failure can say why. */
  excluded?: readonly Exclusion[];
  /** The week under review, already normalized. Absent at block declaration. */
  week?: MicrocyclePlan;
  /** Weeks already generated in this block, oldest first. */
  priorWeeks?: readonly MicrocyclePlan[];
  /** The last session before this week, so the week boundary is checked too. */
  priorSession?: PlannedSession | null;
};

const lower = (label: string) => label.toLowerCase();
const abilityName = (value: Parameters<typeof motorAbilityLabels.of>[0]) =>
  lower(motorAbilityLabels.of(value));
const groupName = (group: MuscleGroup) => lower(muscleGroupLabels.of(group));
const patternName = (pattern: MovementPattern) =>
  `"${movementPatternLabels.of(pattern)}"`;

function unique<T>(values: Iterable<T>) {
  return [...new Set(values)];
}

/** The days, in order, on which an exercise is trained in the week's training sessions. */
function daysWith(week: MicrocyclePlan, exerciseId: number) {
  return unique(
    week.sessions
      .filter((session) => isTraining(session))
      .filter((session) => itemsOf(session).some((item) => item.exerciseId === exerciseId))
      .map((session) => session.day),
  ).sort();
}

function dayList(days: readonly string[]) {
  return list(days.map(formatDay));
}

// -----------------------------------------------------------------------------
// closed-set
// -----------------------------------------------------------------------------

/**
 * Every exercise named must be in the candidate set. This is what makes the
 * pre-filter binding: a plan that names an excluded exercise, or one the
 * directory does not hold, would otherwise walk straight past the tendon rules.
 * At declaration the complex is checked; at weekly generation the sessions are,
 * because a complex exercise may since have been removed by a tendon flare.
 */
export function closedSet(input: GateInput): Violation[] {
  const reasons = new Map(input.excluded?.map((exclusion) => [exclusion.exerciseId, exclusion]));
  const named = input.week
    ? input.week.sessions.flatMap((session) =>
        itemsOf(session).map((item) => ({ id: item.exerciseId, day: session.day })),
      )
    : input.declaration.complex.map((item) => ({ id: item.exerciseId, day: undefined }));

  const seen = new Set<number>();
  const violations: Violation[] = [];
  for (const { id, day } of named) {
    if (input.eligible.has(id) || seen.has(id)) continue;
    seen.add(id);
    const exclusion = reasons.get(id);
    const message = !input.directory.has(id)
      ? `Exercise ${id} is not in the directory. The directory is a closed set, so file a suggested addition rather than inventing one.`
      : exclusion
        ? `${nameOf(input.directory, id)} is not in the candidate set. ${exclusion.message}`
        : `${nameOf(input.directory, id)} is not in the candidate set, so it cannot be prescribed.`;
    violations.push({
      rule: "closed-set",
      scope: input.week ? "session" : "mesocycle",
      message,
      day,
      exerciseIds: [id],
    });
  }
  return violations;
}

// -----------------------------------------------------------------------------
// target-rpe
// -----------------------------------------------------------------------------

/**
 * Every working set in a training session names a target RPE. It is judgment
 * rather than arithmetic, so the normalizer cannot fill it in, and a plan without
 * one is a plan whose effort can never be checked. Mobility work is not rated for
 * effort, and the non-training sessions keep their own prescriptions: a tendon
 * protocol's share of a maximal contraction, a test's count of attempts.
 *
 * One violation per session, naming every set missing one, so a single repair
 * turn can fill them all.
 */
export function targetRpe(input: GateInput): Violation[] {
  if (!input.week) return [];
  return input.week.sessions.filter(isTraining).flatMap((session): Violation[] => {
    const missing = unique(
      itemsOf(session)
        .filter((item) => item.targetRpe == null)
        .filter((item) => input.directory.get(item.exerciseId)?.movementPattern !== "mobility")
        .map((item) => item.exerciseId),
    );
    if (missing.length === 0) return [];
    return [
      {
        rule: "target-rpe",
        scope: "session",
        day: session.day,
        exerciseIds: missing,
        message: `${formatDay(session.day)} prescribes ${missing.length} exercise${missing.length === 1 ? "" : "s"} with no target RPE (${list(missing.map((id) => nameOf(input.directory, id)))}). Every working set in a training session names one, from 1 to 10, so how hard it felt can be held against how hard it was meant to be.`,
      },
    ];
  });
}

// -----------------------------------------------------------------------------
// target-count
// -----------------------------------------------------------------------------

export function targetCount(declaration: MesocycleDeclaration): Violation[] {
  const violations: Violation[] = [];
  const targets = unique(declaration.targetAbilities);
  if (targets.length === 0) {
    violations.push({
      rule: "target-count",
      scope: "mesocycle",
      message: "The block declares no target ability. A block trains 1 or 2.",
    });
  } else if (targets.length > 2) {
    violations.push({
      rule: "target-count",
      scope: "mesocycle",
      message: `The block declares ${targets.length} target abilities (${list(targets.map(abilityName))}). A block trains 1 or 2, because gains drop when several abilities are trained at once; sequence the rest across later blocks.`,
    });
  }

  const focus = unique(declaration.technicalFocus.map((item) => item.trim()).filter(Boolean));
  if (focus.length > 1) {
    violations.push({
      rule: "target-count",
      scope: "mesocycle",
      message: `The block declares ${focus.length} technical focuses (${list(focus)}). A block carries at most 1 technical feature alongside its targets.`,
    });
  }
  return violations;
}

// -----------------------------------------------------------------------------
// stable-complex
// -----------------------------------------------------------------------------

/** "Roughly ten", as a band. */
export const COMPLEX_SIZE = { min: 8, max: 12 } as const;
export const MIN_WEEKLY_FREQUENCY = 2;

export function stableComplex(input: GateInput): Violation[] {
  const { declaration, directory, week, eligible } = input;
  const violations: Violation[] = [];
  const ids = declaration.complex.map((item) => item.exerciseId);
  const distinct = unique(ids);

  const repeated = distinct.filter((id) => ids.indexOf(id) !== ids.lastIndexOf(id));
  if (repeated.length > 0) {
    violations.push({
      rule: "stable-complex",
      scope: "mesocycle",
      message: `${list(repeated.map((id) => nameOf(directory, id)))} ${repeated.length === 1 ? "is" : "are"} listed in the complex more than once.`,
      exerciseIds: repeated,
    });
  }

  if (distinct.length < COMPLEX_SIZE.min || distinct.length > COMPLEX_SIZE.max) {
    violations.push({
      rule: "stable-complex",
      scope: "mesocycle",
      message: `The complex holds ${distinct.length} exercise${distinct.length === 1 ? "" : "s"}. A block runs one stable complex of roughly ten, ${COMPLEX_SIZE.min} to ${COMPLEX_SIZE.max}, so ${distinct.length < COMPLEX_SIZE.min ? "add" : "drop"} ${distinct.length < COMPLEX_SIZE.min ? COMPLEX_SIZE.min - distinct.length : distinct.length - COMPLEX_SIZE.max} or more.`,
    });
  }

  if (!week) return violations;
  for (const item of declaration.complex) {
    // A complex exercise the pre-filter has since removed cannot be trained, and
    // prescribing it anyway is the closed-set failure, not this one.
    if (!eligible.has(item.exerciseId)) continue;
    const floor = Math.max(MIN_WEEKLY_FREQUENCY, item.targetWeeklyFrequency ?? 0);
    const days = daysWith(week, item.exerciseId);
    if (days.length >= floor) continue;
    violations.push({
      rule: "stable-complex",
      scope: "microcycle",
      message: `${nameOf(directory, item.exerciseId)} appears on ${days.length === 0 ? "no day" : `${days.length} day${days.length === 1 ? "" : "s"} (${dayList(days)})`} this week. Each complex exercise appears at least ${floor === 2 ? "twice" : `${floor} times`} a week.`,
      exerciseIds: [item.exerciseId],
    });
  }
  return violations;
}

// -----------------------------------------------------------------------------
// load-not-complex
// -----------------------------------------------------------------------------

/** Relative load moved by at least this much, or total sets by this share. */
export const LOAD_STEP = 0.05;
export const VOLUME_STEP = 0.1;

function trainingSets(week: MicrocyclePlan) {
  return week.sessions.filter((session) => isTraining(session)).reduce((sum, s) => sum + setsIn(s), 0);
}

/**
 * Within a block the load varies and the exercises do not. The complex is the
 * fixed part, so a week may not bring in exercises from outside it, except as
 * stand-ins for complex exercises the pre-filter has removed. The load is the
 * varying part, so a week may not repeat the one before it; the rule compares
 * against the weeks already generated, because the block rolls forward weekly.
 */
export function loadNotComplex(input: GateInput): Violation[] {
  const { declaration, directory, week, eligible } = input;
  if (!week) return [];
  const violations: Violation[] = [];

  const complex = new Set(declaration.complex.map((item) => item.exerciseId));
  const removed = [...complex].filter((id) => !eligible.has(id));
  const outsiders = unique(
    week.sessions
      .filter((session) => isTraining(session))
      .flatMap((session) => itemsOf(session).map((item) => item.exerciseId)),
  ).filter(
    (id) => !complex.has(id) && directory.get(id)?.movementPattern !== "mobility",
  );
  if (outsiders.length > removed.length) {
    const names = list(outsiders.map((id) => nameOf(directory, id)));
    const allowance =
      removed.length === 0
        ? ""
        : ` Only ${removed.length} stand-in${removed.length === 1 ? " is" : "s are"} allowed, for ${list(removed.map((id) => nameOf(directory, id)))}, which the pre-filter removed.`;
    violations.push({
      rule: "load-not-complex",
      scope: "mesocycle",
      message: `${names} ${outsiders.length === 1 ? "is" : "are"} not in the block's complex. Load varies within a block, the exercises do not.${allowance}`,
      exerciseIds: outsiders,
    });
  }

  const previous = input.priorWeeks?.at(-1);
  if (previous) {
    const loadMoved = Math.abs(week.relativeLoad - previous.relativeLoad) >= LOAD_STEP - 1e-9;
    const setsNow = trainingSets(week);
    const setsBefore = trainingSets(previous);
    const volumeMoved =
      setsBefore === 0 ? setsNow !== 0 : Math.abs(setsNow - setsBefore) / setsBefore >= VOLUME_STEP;
    if (!loadMoved && !volumeMoved) {
      violations.push({
        rule: "load-not-complex",
        scope: "microcycle",
        message: `Week ${week.ordinal} repeats week ${previous.ordinal}'s load: relative load ${week.relativeLoad.toFixed(2)} against ${previous.relativeLoad.toFixed(2)}, and ${setsNow} sets against ${setsBefore}. A constant stimulus decays in effect, so move relative load by at least ${LOAD_STEP} or volume by at least ${VOLUME_STEP * 100}%.`,
      });
    }
  }
  return violations;
}

// -----------------------------------------------------------------------------
// plyo-frequency
// -----------------------------------------------------------------------------

export const PLYO_DAYS = { min: 2, max: 3, maxWhenIntense: 2 } as const;
/** A plyometric session planned at this intensity or above lowers the ceiling. */
export const INTENSE_PLYO_SESSION = 8;

/**
 * Plyometrics 2 to 3 days a week, inversely scaled against intensity: a week
 * with shock-method work or a plyometric session at 8 or above gets 2 at most.
 * The floor does not apply to a detraining week, or when the pre-filter has
 * removed every plyometric, because then there is nothing to schedule.
 *
 * At declaration the floor is checked against the complex: a week may not bring
 * in exercises from outside it, so a complex with no plyometric could never meet
 * the floor in any week of the block.
 */
export function plyoFrequency(input: GateInput): Violation[] {
  const { declaration, directory, week, eligible } = input;
  const plyometric = (id: number) => {
    const exercise = directory.get(id);
    return exercise !== undefined && isPlyometric(exercise);
  };
  const anyEligible = [...eligible].some(plyometric);

  if (!week) {
    if (!anyEligible || declaration.complex.some((item) => plyometric(item.exerciseId))) return [];
    return [
      {
        rule: "plyo-frequency",
        scope: "mesocycle",
        message: `The complex holds no plyometric. Plyometrics need ${PLYO_DAYS.min} to ${PLYO_DAYS.max} days a week, and a week may not bring in exercises from outside the complex, so add at least one.`,
      },
    ];
  }

  const plyoSessions = week.sessions.filter(
    (session) => isTraining(session) && itemsOf(session).some((item) => plyometric(item.exerciseId)),
  );
  const days = unique(plyoSessions.map((session) => session.day)).sort();

  const shock = plyoSessions.flatMap((session) =>
    itemsOf(session)
      .filter((item) => {
        const exercise = directory.get(item.exerciseId);
        return exercise !== undefined && isShockDrill(exercise);
      })
      .map((item) => ({ id: item.exerciseId, day: session.day })),
  );
  const intense = plyoSessions.filter(
    (session) => session.plannedIntensity >= INTENSE_PLYO_SESSION,
  );

  const floor = week.loadType === "detraining" || !anyEligible ? 0 : PLYO_DAYS.min;

  if (days.length < floor) {
    return [
      {
        rule: "plyo-frequency",
        scope: "microcycle",
        message: `Plyometrics on ${days.length === 0 ? "no day" : `1 day (${dayList(days)})`}. They need ${PLYO_DAYS.min} to ${PLYO_DAYS.max} days a week to drive adaptation.`,
      },
    ];
  }

  const ceiling = shock.length > 0 || intense.length > 0 ? PLYO_DAYS.maxWhenIntense : PLYO_DAYS.max;
  if (days.length <= ceiling) return [];
  const why =
    shock.length > 0
      ? ` in a week with shock-method work (${nameOf(directory, shock[0].id)} on ${formatDay(shock[0].day)})`
      : intense.length > 0
        ? ` in a week with a plyometric session at intensity ${intense[0].plannedIntensity} (${formatDay(intense[0].day)})`
        : "";
  return [
    {
      rule: "plyo-frequency",
      scope: "microcycle",
      message: `Plyometrics on ${days.length} days (${dayList(days)})${why}. ${why ? "At that intensity the ceiling is" : "The ceiling is"} ${ceiling} days a week, because frequency runs inverse to intensity.`,
    },
  ];
}

// -----------------------------------------------------------------------------
// back-to-back
// -----------------------------------------------------------------------------

/**
 * Sessions on consecutive days, or on the same day, are back to back. Neither
 * may repeat a large muscle group as a primary mover or a coordination pattern,
 * because two similar sessions in a row superpose their fatigue.
 */
export function backToBack(input: GateInput): Violation[] {
  const { directory, week } = input;
  if (!week) return [];
  const sessions = [...(input.priorSession ? [input.priorSession] : []), ...week.sessions]
    .filter((session) => isTraining(session))
    .sort((a, b) => a.day.localeCompare(b.day));

  const profile = (session: PlannedSession) => {
    const groups = new Map<MuscleGroup, number[]>();
    const patterns = new Map<MovementPattern, number[]>();
    for (const item of itemsOf(session)) {
      const exercise = directory.get(item.exerciseId);
      if (!exercise) continue;
      if (LARGE_GROUPS.has(exercise.primaryMuscleGroup)) {
        groups.set(exercise.primaryMuscleGroup, [...(groups.get(exercise.primaryMuscleGroup) ?? []), exercise.id]);
      }
      if (!LOW_COORDINATION_PATTERNS.has(exercise.movementPattern)) {
        patterns.set(exercise.movementPattern, [...(patterns.get(exercise.movementPattern) ?? []), exercise.id]);
      }
    }
    return { groups, patterns };
  };

  const repeated = (a: PlannedSession, b: PlannedSession): Violation | null => {
    const first = profile(a);
    const second = profile(b);
    const groups = [...second.groups.keys()].filter((group) => first.groups.has(group));
    const patterns = [...second.patterns.keys()].filter((pattern) => first.patterns.has(pattern));
    if (groups.length === 0 && patterns.length === 0) return null;

    const repeats = [
      groups.length > 0 ? `train the ${list(groups.map(groupName))}` : null,
      patterns.length > 0
        ? `repeat the ${list(patterns.map(patternName))} pattern${patterns.length === 1 ? "" : "s"}`
        : null,
    ].filter(Boolean);
    const ids = unique([
      ...groups.flatMap((group) => second.groups.get(group)!),
      ...patterns.flatMap((pattern) => second.patterns.get(pattern)!),
    ]);
    const when = a.day === b.day ? `The two sessions on ${formatDay(a.day)}` : `${formatDay(a.day)} and ${formatDay(b.day)}`;
    return {
      rule: "back-to-back",
      scope: "microcycle",
      day: b.day,
      exerciseIds: ids,
      message: `${when} are back to back. Both ${repeats.join(", and both ")} (${list(ids.map((id) => nameOf(directory, id)))} on ${formatDay(b.day)}). Back-to-back sessions must not repeat a large muscle group or a coordination pattern.`,
    };
  };

  const violations: Violation[] = [];
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const [a, b] = [sessions[i], sessions[j]];
      if (daysBetween(a.day, b.day) > 1) break;
      const violation = repeated(a, b);
      if (violation) violations.push(violation);
    }
  }
  return violations;
}

// -----------------------------------------------------------------------------

/**
 * Every gate failure for a declaration, or for a week within it. The closed-set
 * check runs first and alone: the other rules reason about attributes, and an
 * exercise outside the candidate set is not one they can reason about.
 */
export function gate(input: GateInput): Violation[] {
  const outside = closedSet(input);
  if (outside.length > 0) return outside;
  return [
    ...targetCount(input.declaration),
    ...stableComplex(input),
    ...loadNotComplex(input),
    ...plyoFrequency(input),
    ...backToBack(input),
    ...targetRpe(input),
  ];
}
