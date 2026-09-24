import { formatDay } from "@/lib/days";
import { motorAbilityLabels } from "@/lib/labels";
import type { MotorAbility } from "@/lib/taxonomy";
import {
  abilitiesOf,
  isStrengthWork,
  isTraining,
  itemsOf,
  list,
  percent,
  setsIn,
} from "./classify";
import type { Advisory, Directory, MesocycleDeclaration, MicrocyclePlan } from "./types";

/**
 * Stage 5 notes: the ebook's figures that are general-population guidance rather
 * than tolerances. They are bands with slack, they are attached to the proposal
 * and handed to the memory layer as a signal, and they never block a plan.
 *
 * Volume is counted in sets across training sessions only; rest, mobility,
 * tendon protocol and test sessions carry no training volume.
 */

export type AdvisoryInput = {
  declaration: MesocycleDeclaration;
  directory: Directory;
  week: MicrocyclePlan;
  /** Weeks already generated in this block, oldest first. */
  priorWeeks?: readonly MicrocyclePlan[];
};

const abilityName = (ability: MotorAbility) => motorAbilityLabels.of(ability).toLowerCase();
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function trainingSessions(week: MicrocyclePlan) {
  return week.sessions.filter((session) => isTraining(session));
}

// -----------------------------------------------------------------------------
// target-share
// -----------------------------------------------------------------------------

export const TARGET_SHARE = { min: 0.65, idealMin: 0.7, idealMax: 0.8, max: 0.85 } as const;
export const EACH_TARGET_SHARE = { idealMin: 0.35, idealMax: 0.4, slack: 0.05 } as const;

/**
 * 70 to 80 percent of the block's work on its targets, 35 to 40 each with two.
 * Measured block to date rather than per week, because a single week may lean
 * one way on purpose and the ebook's figure is about the mesocycle. A set that
 * trains two abilities counts toward both.
 */
export function targetShare(input: AdvisoryInput): Advisory[] {
  const targets = [...new Set(input.declaration.targetAbilities)];
  if (targets.length === 0) return [];

  let total = 0;
  let onTargets = 0;
  const byTarget = new Map<MotorAbility, number>(targets.map((target) => [target, 0]));
  for (const week of [...(input.priorWeeks ?? []), input.week]) {
    for (const session of trainingSessions(week)) {
      for (const item of itemsOf(session)) {
        const exercise = input.directory.get(item.exerciseId);
        if (!exercise) continue;
        const abilities = abilitiesOf(exercise, item);
        total += item.sets;
        if (abilities.some((ability) => byTarget.has(ability))) onTargets += item.sets;
        for (const ability of abilities) {
          const held = byTarget.get(ability);
          if (held !== undefined) byTarget.set(ability, held + item.sets);
        }
      }
    }
  }
  if (total === 0) return [];

  const advisories: Advisory[] = [];
  const share = onTargets / total;
  const named = list(targets.map(abilityName));
  if (share < TARGET_SHARE.min || share > TARGET_SHARE.max) {
    advisories.push({
      rule: "target-share",
      scope: "mesocycle",
      message: `${percent(share)} of block volume so far is on the targets (${named}). Aim for 70 to 80%: ${share < TARGET_SHARE.min ? "below 65% the targets are diluted by everything else" : "above 85% leaves no room for supporting work"}.`,
    });
  }

  if (targets.length === 2) {
    const { idealMin, idealMax, slack } = EACH_TARGET_SHARE;
    for (const target of targets) {
      const each = (byTarget.get(target) ?? 0) / total;
      if (each >= idealMin - slack - 1e-9 && each <= idealMax + slack + 1e-9) continue;
      advisories.push({
        rule: "target-share",
        scope: "mesocycle",
        message: `${capitalize(abilityName(target))} has ${percent(each)} of block volume so far. With two targets each takes about 35 to 40%.`,
      });
    }
  }
  return advisories;
}

// -----------------------------------------------------------------------------
// rule-of-60
// -----------------------------------------------------------------------------

export const LIGHT_DAY_RATIO = { target: 0.6, slack: 0.05 } as const;

/** The lightest day's volume near 60 percent of the heaviest day's, within 5 points. */
export function ruleOf60(input: AdvisoryInput): Advisory[] {
  const days = trainingSessions(input.week)
    .map((session) => ({ day: session.day, sets: setsIn(session) }))
    .filter((day) => day.sets > 0);
  if (days.length < 2) return [];

  const heaviest = days.reduce((a, b) => (b.sets > a.sets ? b : a));
  const lightest = days.reduce((a, b) => (b.sets < a.sets ? b : a));
  const ratio = lightest.sets / heaviest.sets;
  const { target, slack } = LIGHT_DAY_RATIO;
  if (Math.abs(ratio - target) <= slack + 1e-9) return [];
  return [
    {
      rule: "rule-of-60",
      scope: "microcycle",
      message: `The lightest day (${formatDay(lightest.day)}, ${lightest.sets} sets) is ${percent(ratio)} of the heaviest (${formatDay(heaviest.day)}, ${heaviest.sets} sets). The rule of 60% puts it near 60%, so ${ratio > target ? "lighten the light day or load the heavy one" : "the light day is lighter than it needs to be"}.`,
    },
  ];
}

// -----------------------------------------------------------------------------
// strength-frequency
// -----------------------------------------------------------------------------

export const GAIN_SESSIONS = 3;
export const RETAIN_SESSIONS = 2;
/** "About 30 minutes", with slack. */
export const RETAIN_MINUTES = 25;
/** Seconds of work per set, for the duration estimate. */
const WORK_SECONDS = 40;
/** Rest assumed when a strength set has none, which is typical of assistance work. */
const DEFAULT_REST = 120;

const GAIN_TARGETS: ReadonlySet<MotorAbility> = new Set(["max_strength", "hypertrophy"]);

/**
 * Gaining strength takes heavy resistance training at least 3 times a week, and
 * holding it takes 2 sessions of about 30 minutes. Gaining is the bar when the
 * block targets strength and the week is stimulating; otherwise it is retention.
 */
export function strengthFrequency(input: AdvisoryInput): Advisory[] {
  const gaining =
    input.week.loadType === "stimulating" &&
    input.declaration.targetAbilities.some((ability) => GAIN_TARGETS.has(ability));

  const sessions = trainingSessions(input.week)
    .map((session) => {
      const strength = itemsOf(session).filter((item) => {
        const exercise = input.directory.get(item.exerciseId);
        return exercise !== undefined && isStrengthWork(exercise);
      });
      const seconds = strength.reduce(
        (sum, item) => sum + item.sets * ((item.restSeconds ?? DEFAULT_REST) + WORK_SECONDS),
        0,
      );
      return { day: session.day, count: strength.length, minutes: seconds / 60 };
    })
    .filter((session) => session.count > 0);

  const days = (found: typeof sessions) =>
    found.length === 0
      ? "no day"
      : `${found.length} day${found.length === 1 ? "" : "s"} (${list(found.map((s) => formatDay(s.day)))})`;

  if (gaining) {
    if (sessions.length >= GAIN_SESSIONS) return [];
    return [
      {
        rule: "strength-frequency",
        scope: "microcycle",
        message: `Strength work on ${days(sessions)}. The block targets strength, and gaining it takes heavy resistance training at least ${GAIN_SESSIONS} times a week.`,
      },
    ];
  }

  const substantial = sessions.filter((session) => session.minutes >= RETAIN_MINUTES);
  if (substantial.length >= RETAIN_SESSIONS) return [];
  return [
    {
      rule: "strength-frequency",
      scope: "microcycle",
      message: `Strength work of about 30 minutes on ${days(substantial)}. Retaining strength takes at least ${RETAIN_SESSIONS} such sessions a week.`,
    },
  ];
}

// -----------------------------------------------------------------------------
// session-set-cap
// -----------------------------------------------------------------------------

export const SESSION_SETS = { cap: 20, slack: 2 } as const;

/** The most intense THP sessions run about 20 sets. */
export function sessionSetCap(input: AdvisoryInput): Advisory[] {
  return trainingSessions(input.week)
    .map((session) => ({ day: session.day, sets: setsIn(session) }))
    .filter((session) => session.sets > SESSION_SETS.cap + SESSION_SETS.slack)
    .map((session) => ({
      rule: "session-set-cap",
      scope: "session",
      day: session.day,
      message: `${formatDay(session.day)} runs ${session.sets} sets. The most intense sessions run about ${SESSION_SETS.cap}, because the aim is as much work as possible while staying as fresh as possible.`,
    }));
}

// -----------------------------------------------------------------------------

export function advise(input: AdvisoryInput): Advisory[] {
  return [
    ...targetShare(input),
    ...ruleOf60(input),
    ...strengthFrequency(input),
    ...sessionSetCap(input),
  ];
}
