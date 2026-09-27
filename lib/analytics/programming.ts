import { addDays } from "@/lib/days";
import { draft, type Insight } from "./insight";
import type { AnalyticsInputs } from "./inputs";
import {
  mean,
  meanEstimate,
  proportionEstimate,
  sampleSd,
  shrink,
  type Estimate,
} from "./stats";

/**
 * Whether the plan the app writes matches the athlete it is written for.
 *
 * This area is the app auditing itself rather than the athlete, and it is the part
 * most likely to be flattering if built carelessly. Three separate things are worth
 * knowing and they fail in different directions: whether the prescribed intensities
 * land where they were aimed, whether the sessions happen on the days they were put
 * on, and whether the generator's output survives contact with the gate and the
 * owner. A generator that writes beautiful weeks nobody trains is not a good
 * generator, and only the second of those three would notice.
 */

/** Days of history. Twelve weeks, long enough for three mesocycles of habits. */
const WINDOW_DAYS = 84;

// -----------------------------------------------------------------------------
// Prescription calibration
// -----------------------------------------------------------------------------

/** Prescribed-and-logged sets an exercise needs before it gets its own correction. */
const MIN_CALIBRATION_SETS = 5;

/** Exercises that get their own correction factor, most-logged first. */
const MAX_CALIBRATED_EXERCISES = 8;

/**
 * How many observations the global correction is worth when shrinking a per-exercise
 * one toward it.
 *
 * Six, so an exercise with six prescribed sets of its own is trusted about as far as
 * the pooled figure and one with two is mostly told what everything else does. The
 * alternative - an unshrunk per-exercise mean - produces a correction factor of
 * +2.5 RPE from a single bad Tuesday, which the generator would then apply to every
 * future prescription of that lift.
 */
const CALIBRATION_PRIOR_WEIGHT = 6;

/**
 * Actual minus target RPE, per exercise, as a correction the generator can apply.
 *
 * The sign convention is worth stating because it is the thing a reader gets
 * backwards: positive means the set was *harder* than prescribed, so the correction
 * to apply next time is to prescribe less. A consistent positive on squats and a
 * consistent negative on hip thrusts is not a discipline problem, it is the loading
 * model being wrong in two directions at once, and it is exactly the kind of thing
 * one athlete's log can establish and no general table can.
 *
 * Each exercise is shrunk toward the pooled correction, so a lift with four
 * observations contributes a hedged number rather than a loud one. The pooled
 * correction itself is reported as its own insight, because it is the one that is
 * almost always assertable and it answers a different question: whether the
 * generator's whole notion of intensity is calibrated or systematically off.
 */
export function prescriptionCalibration(inputs: AnalyticsInputs): Insight[] {
  const from = addDays(inputs.asOf, -WINDOW_DAYS);
  const targets = new Map(inputs.prescribedSets.map((set) => [set.id, set]));

  const byExercise = new Map<number, number[]>();
  const all: number[] = [];
  for (const set of inputs.loggedSets) {
    if (set.day < from || set.rpe === null || set.prescribedSetId === null) continue;
    const target = targets.get(set.prescribedSetId);
    if (!target || target.targetRpe === null) continue;
    const gap = set.rpe - target.targetRpe;
    all.push(gap);
    const held = byExercise.get(set.exerciseId) ?? [];
    held.push(gap);
    byExercise.set(set.exerciseId, held);
  }

  const pooled = meanEstimate(all);
  if (!pooled) return [];

  const overall: Insight = draft({
    key: "programming.calibration",
    family: "programming",
    tier: 1,
    subject: "Prescribed RPE against logged RPE",
    statement:
      pooled.value >= 0
        ? `Logged sets come in ${pooled.value.toFixed(2)} RPE above what was prescribed, so the plan is asking for slightly more than it thinks.`
        : `Logged sets come in ${Math.abs(pooled.value).toFixed(2)} RPE below what was prescribed, so the plan is leaving intensity on the table.`,
    value: pooled.value,
    unit: "RPE, positive means harder than prescribed",
    n: pooled.n,
    minN: 12,
    ciLow: pooled.ciLow,
    ciHigh: pooled.ciHigh,
    p: pooled.p,
    nullValue: 0,
    detail: {
      spread: round(sampleSd(all)),
      exercisesCovered: byExercise.size,
    },
  });

  const perExercise = [...byExercise.entries()]
    .filter(([, gaps]) => gaps.length >= MIN_CALIBRATION_SETS)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_CALIBRATED_EXERCISES)
    .flatMap(([exerciseId, gaps]): Insight[] => {
      const estimate = meanEstimate(gaps);
      const exercise = inputs.exercises.get(exerciseId);
      if (!estimate || !exercise) return [];

      const corrected = shrink({
        value: estimate.value,
        n: gaps.length,
        priorValue: pooled.value,
        priorWeight: CALIBRATION_PRIOR_WEIGHT,
      });
      // The interval is the raw one, not the shrunken one. Shrinkage moves the point
      // estimate toward the pool and would narrow the interval along with it, which
      // would report more certainty than the exercise's own five sets support.
      return [
        draft({
          key: `programming.calibration.${exerciseId}`,
          family: "programming",
          tier: 1,
          subject: `Prescribed RPE against logged RPE for ${exercise.name}`,
          statement: `${exercise.name} lands ${signed(corrected)} RPE from its target across ${gaps.length} prescribed sets, so prescribe ${corrected >= 0 ? "a little less" : "a little more"} of it.`,
          value: corrected,
          unit: "RPE, positive means harder than prescribed",
          n: gaps.length,
          minN: MIN_CALIBRATION_SETS,
          ciLow: estimate.ciLow,
          ciHigh: estimate.ciHigh,
          p: estimate.p,
          nullValue: 0,
          detail: {
            exerciseId,
            exerciseName: exercise.name,
            rawMean: round(estimate.value),
            shrunkTo: round(corrected),
            pooledMean: round(pooled.value),
          },
        }),
      ];
    });

  return [overall, ...perExercise];
}

// -----------------------------------------------------------------------------
// Schedule reality
// -----------------------------------------------------------------------------

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Planned sessions on a weekday before its own rate means anything. */
const MIN_WEEKDAY_SESSIONS = 4;

/**
 * Whether a session planned for a given weekday actually happens.
 *
 * This is the insight most likely to change what the generator writes, because it is
 * the only one that can tell it to stop putting the hardest session of the week on
 * the day the athlete reliably misses. The alternative the app has today is the
 * owner's stated availability, which is a claim about intentions; this is the record
 * of what happened.
 *
 * Wilson intervals rather than plain rates, because the numerator here is small by
 * construction - a weekday comes round twelve times in twelve weeks - and the
 * textbook interval on three out of four runs past 1.0 and reports a completion rate
 * above certainty.
 *
 * Only weekdays the profile says are trainable get an insight. A Sunday that was
 * never planned has a completion rate of zero out of zero, and reporting that as poor
 * adherence would be a slander.
 */
export function scheduleReality(inputs: AnalyticsInputs): Insight[] {
  const from = addDays(inputs.asOf, -WINDOW_DAYS);
  const planned = inputs.sessions.filter(
    (session) => session.day >= from && session.day < inputs.asOf && session.kind !== "rest",
  );
  if (planned.length === 0) return [];

  const byWeekday = new Map<number, { total: number; done: number }>();
  for (const session of planned) {
    const weekday = new Date(`${session.day}T12:00:00Z`).getUTCDay();
    const held = byWeekday.get(weekday) ?? { total: 0, done: 0 };
    held.total += 1;
    if (session.completed) held.done += 1;
    byWeekday.set(weekday, held);
  }

  const overall = proportionEstimate(
    planned.filter((session) => session.completed).length,
    planned.length,
  );
  if (!overall) return [];

  const perWeekday = [...byWeekday.entries()]
    .filter(([weekday, counts]) => {
      if (counts.total < MIN_WEEKDAY_SESSIONS) return false;
      return inputs.trainableWeekdays.length === 0
        ? true
        : inputs.trainableWeekdays.includes(weekday);
    })
    .sort((a, b) => a[0] - b[0])
    .flatMap(([weekday, counts]): Insight[] => {
      const estimate = proportionEstimate(counts.done, counts.total);
      if (!estimate) return [];
      return [
        draft({
          key: `programming.schedule.${weekday}`,
          family: "programming",
          tier: 1,
          subject: `How often ${WEEKDAY_NAMES[weekday]} sessions happen`,
          statement: `${WEEKDAY_NAMES[weekday]} sessions happen ${Math.round(estimate.value * 100)} percent of the time, ${counts.done} of ${counts.total} planned.`,
          ...percentOf(estimate),
          unit: "percent of planned sessions",
          n: counts.total,
          minN: MIN_WEEKDAY_SESSIONS,
          // A rate has no zero null worth testing - nobody wonders whether Tuesday
          // is better than never - so this one is asserted on n and its interval
          // alone. The comparison a reader makes is against the other weekdays,
          // which the intervals support directly.
          detail: {
            weekday,
            weekdayName: WEEKDAY_NAMES[weekday],
            planned: counts.total,
            completed: counts.done,
          },
        }),
      ];
    });

  return [
    draft({
      key: "programming.schedule",
      family: "programming",
      tier: 1,
      subject: "How often a planned session happens",
      statement: `${Math.round(overall.value * 100)} percent of planned sessions actually happen, ${planned.filter((session) => session.completed).length} of ${planned.length} over the last twelve weeks.`,
      ...percentOf(overall),
      unit: "percent of planned sessions",
      n: overall.n,
      minN: 12,
      detail: {
        byWeekday: [...byWeekday.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([weekday, counts]) => ({
            weekday,
            weekdayName: WEEKDAY_NAMES[weekday],
            planned: counts.total,
            completed: counts.done,
            trainable:
              inputs.trainableWeekdays.length === 0 ||
              inputs.trainableWeekdays.includes(weekday),
          })),
        skipped: planned.filter((session) => session.skipped).length,
      },
    }),
    ...perWeekday,
  ];
}

// -----------------------------------------------------------------------------
// Generation quality
// -----------------------------------------------------------------------------

/** Reviewed proposals before the generator's own numbers mean anything. */
const MIN_PROPOSALS = 6;

/**
 * How well the generator is doing: first-attempt pass rate, repair attempts,
 * acceptance, and edit magnitude.
 *
 * Four numbers rather than one score, because they move independently and a single
 * score would hide the case that matters. A generator whose first attempt always
 * passes the gate and whose output is always heavily edited is producing valid plans
 * the owner does not want; a generator that needs two repairs and is then accepted
 * untouched is producing plans the owner does want through a prompt that needs work.
 * Those call for opposite fixes, and averaging them together says neither.
 *
 * Fallbacks are counted in the denominator on purpose. A fallback plan is a
 * generation that failed, and excluding it would let the pass rate rise every time
 * the model got worse.
 */
export function generationQuality(inputs: AnalyticsInputs): Insight[] {
  const reviewed = inputs.proposals.filter((proposal) => proposal.verdict !== "pending");
  if (reviewed.length < MIN_PROPOSALS) return [];

  const firstAttempt = proportionEstimate(
    reviewed.filter((proposal) => proposal.passedFirstAttempt && !proposal.isFallback).length,
    reviewed.length,
  );
  const accepted = proportionEstimate(
    reviewed.filter(
      (proposal) => proposal.verdict === "accepted" || proposal.verdict === "edited",
    ).length,
    reviewed.length,
  );
  if (!firstAttempt || !accepted) return [];

  const repairs = reviewed.map((proposal) => proposal.repairAttempts);
  const edits = reviewed
    .filter((proposal) => proposal.verdict === "edited")
    .map((proposal) => proposal.editedFields ?? 0);

  const shared = {
    proposals: reviewed.length,
    fallbacks: reviewed.filter((proposal) => proposal.isFallback).length,
    rejected: reviewed.filter((proposal) => proposal.verdict === "rejected").length,
    repairDistribution: distribution(repairs),
    meanRepairAttempts: round(mean(repairs)),
    byScope: ["mesocycle", "microcycle", "session"].map((scope) => ({
      scope,
      count: reviewed.filter((proposal) => proposal.scope === scope).length,
    })),
  };

  const insights: Insight[] = [
    draft({
      key: "programming.generation.first-attempt",
      family: "programming",
      tier: 1,
      subject: "How often a generated plan passes the gate first time",
      statement: `${Math.round(firstAttempt.value * 100)} percent of generated plans pass the rule gate on the first attempt, over ${firstAttempt.n} proposals.`,
      ...percentOf(firstAttempt),
      unit: "percent of proposals",
      n: firstAttempt.n,
      minN: MIN_PROPOSALS,
      detail: shared,
    }),
    draft({
      key: "programming.generation.acceptance",
      family: "programming",
      tier: 1,
      subject: "How often a reviewed plan is accepted",
      statement: `${Math.round(accepted.value * 100)} percent of reviewed plans were accepted rather than rejected, over ${accepted.n} proposals.`,
      ...percentOf(accepted),
      unit: "percent of proposals",
      n: accepted.n,
      minN: MIN_PROPOSALS,
      detail: shared,
    }),
  ];

  // Edit magnitude only exists for plans that were edited, so its n is its own and
  // is usually the smallest number on this page. Reported separately rather than
  // folded into the acceptance rate, which would conflate "accepted" with "accepted
  // as written".
  const editMagnitude = meanEstimate(edits);
  if (editMagnitude) {
    insights.push(
      draft({
        key: "programming.generation.edit-magnitude",
        family: "programming",
        tier: 1,
        subject: "How much an accepted plan gets edited",
        statement: `Accepted plans that were edited had ${editMagnitude.value.toFixed(1)} fields changed on average, across ${editMagnitude.n} edited proposals.`,
        value: editMagnitude.value,
        unit: "fields changed",
        n: editMagnitude.n,
        minN: 4,
        ciLow: editMagnitude.ciLow,
        ciHigh: editMagnitude.ciHigh,
        detail: shared,
      }),
    );
  }

  return insights;
}

/** A count per distinct value, ascending. The repair-attempt distribution wants this. */
function distribution(values: readonly number[]): { value: number; count: number }[] {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([value, count]) => ({ value, count }));
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}`;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

/**
 * A 0-to-1 rate as a percentage, interval included.
 *
 * Every rate below is worded as a percentage, and the screen prints the interval
 * beside the sentence: a statement reading "90 percent of the time" over an interval
 * reading "0.6 to 0.98" asks the reader to notice that those are the same fact. The
 * scale is converted once here rather than at the point of display, because the stored
 * value is also what drift is measured against and two scales for one number is how
 * a rate ends up compared against a percentage.
 */
function percentOf(estimate: Estimate): Pick<Estimate, "value" | "ciLow" | "ciHigh"> {
  return {
    value: estimate.value * 100,
    ciLow: estimate.ciLow * 100,
    ciHigh: estimate.ciHigh * 100,
  };
}
