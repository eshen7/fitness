import { addDays } from "@/lib/days";
import { DIRECTORY, FULL_GYM, idOf, STOCK } from "./directory";
import { prefilter } from "../prefilter";
import type {
  MesocycleDeclaration,
  MicrocyclePlan,
  PlannedSession,
  PlannedSet,
} from "../types";

/**
 * A valid plan: the second week of an accumulation block, which every invalid
 * fixture is one deliberate edit away from.
 *
 * It is valid on every rule at once, and the fixture suite asserts that it
 * produces no normalizer change, no gate violation and no advisory, so that a
 * finding on an edited copy can only have come from the edit.
 *
 * The shape: two targets, max strength and reactive strength, with one
 * technical focus; an eight-exercise complex; plyometrics on Monday and Friday
 * only, because depth jumps put shock work in the week; heavy lifting on all
 * three days; the light day at 60% of the heavy one. Block to date that puts
 * about 77% of the volume on the targets, 40% reactive and 38% max strength.
 */

export const APPROACH = idOf("two-foot-approach-jump");
export const DEPTH_JUMP = idOf("depth-jump");
export const BOUND = idOf("alternate-leg-bound");
export const BACK_SQUAT = idOf("back-squat");
export const TRAP_BAR = idOf("trap-bar-deadlift");
export const BENCH = idOf("bench-press");
export const PULL_UP = idOf("pull-up");
export const PLANK = idOf("plank");

export const DECLARATION: MesocycleDeclaration = {
  type: "accumulation",
  plannedMicrocycles: 4,
  targetAbilities: ["max_strength", "reactive_strength"],
  technicalFocus: ["Penultimate step: low and long, rolling through"],
  complex: [
    { exerciseId: APPROACH, isMain: false },
    { exerciseId: DEPTH_JUMP, isMain: false },
    { exerciseId: BOUND, isMain: false },
    { exerciseId: BACK_SQUAT, isMain: true },
    { exerciseId: TRAP_BAR, isMain: true },
    { exerciseId: BENCH, isMain: true },
    { exerciseId: PULL_UP, isMain: false },
    { exerciseId: PLANK, isMain: false },
  ],
};

/** Monday of the week under review. */
export const WEEK_START = "2026-09-21";

const approach = (sets: number): PlannedSet => ({
  exerciseId: APPROACH,
  sets,
  reps: 8,
  targetRpe: 7,
  restSeconds: 90,
  couplingClass: "short_ssc",
});
const depthJump = (sets: number): PlannedSet => ({
  exerciseId: DEPTH_JUMP,
  sets,
  reps: 8,
  boxHeightCm: 45,
  targetRpe: 8,
  restSeconds: 150,
  couplingClass: "short_ssc",
  shockMethod: true,
});
const bound = (sets: number): PlannedSet => ({
  exerciseId: BOUND,
  sets,
  reps: 8,
  targetRpe: 7,
  restSeconds: 90,
  couplingClass: "short_ssc",
});
const lift = (
  exerciseId: number,
  sets: number,
  reps: number,
  loadPctOf1rm: number | null,
  restSeconds: number,
  targetRpe: number,
): PlannedSet => ({ exerciseId, sets, reps, loadPctOf1rm, targetRpe, restSeconds });
const plank = (sets: number): PlannedSet => ({
  exerciseId: PLANK,
  sets,
  holdSeconds: 45,
  targetRpe: 6,
  restSeconds: 60,
});

export function baselineSessions(start = WEEK_START): PlannedSession[] {
  return [
    {
      day: start,
      kind: "mixed",
      title: "Jumps and heavy lower",
      plannedIntensity: 8,
      blocks: [
        { label: "Jumps", items: [approach(3), depthJump(4), bound(3)] },
        {
          label: "Strength",
          items: [lift(BACK_SQUAT, 5, 3, 87, 270, 8.5), lift(BENCH, 3, 5, 82, 270, 8)],
        },
        { label: "Core", items: [plank(2)] },
      ],
    },
    {
      day: addDays(start, 2),
      kind: "strength",
      title: "Light strength",
      plannedIntensity: 5,
      blocks: [
        {
          label: "Strength",
          items: [
            lift(BACK_SQUAT, 3, 3, 80, 270, 7),
            lift(TRAP_BAR, 3, 5, 75, 180, 7),
            lift(BENCH, 2, 8, 70, 120, 7),
            lift(PULL_UP, 2, 8, null, 120, 7),
          ],
        },
        { label: "Core", items: [plank(2)] },
      ],
    },
    {
      day: addDays(start, 4),
      kind: "mixed",
      title: "Jumps and pull",
      plannedIntensity: 7,
      blocks: [
        { label: "Jumps", items: [approach(3), depthJump(3), bound(3)] },
        {
          label: "Strength",
          items: [lift(TRAP_BAR, 4, 4, 85, 270, 8.5), lift(PULL_UP, 3, 8, null, 120, 7.5)],
        },
      ],
    },
  ];
}

export function baselineWeek(): MicrocyclePlan {
  return {
    ordinal: 2,
    startDate: WEEK_START,
    loadType: "stimulating",
    relativeLoad: 0.9,
    sessions: baselineSessions(),
  };
}

/** Week 1 of the block: the same complex at a lower relative load. */
export function priorWeek(): MicrocyclePlan {
  const start = addDays(WEEK_START, -7);
  return {
    ordinal: 1,
    startDate: start,
    loadType: "stimulating",
    relativeLoad: 0.8,
    sessions: baselineSessions(start),
  };
}

/** Friday of week 1, the session before the week boundary. */
export function priorSession(): PlannedSession {
  return priorWeek().sessions.at(-1)!;
}

export const AS_OF = new Date(`${WEEK_START}T06:00:00Z`);

/** A candidate set with nothing removed: full gym, no tendon history. */
export const EVERYTHING = prefilter({
  exercises: STOCK,
  tendon: [],
  availableEquipment: FULL_GYM,
  asOf: AS_OF,
});

/** Everything `reviewWeek` needs, for the baseline. */
export function baselineReview() {
  return {
    declaration: DECLARATION,
    directory: DIRECTORY,
    prefiltered: EVERYTHING,
    week: baselineWeek(),
    priorWeeks: [priorWeek()],
    priorSession: priorSession(),
  };
}
