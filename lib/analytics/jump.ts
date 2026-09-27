import { daysBetween } from "@/lib/days";
import type { JumpSitting } from "@/lib/progress/derive";
import { draft, type Insight } from "./insight";
import type { AnalyticsInputs } from "./inputs";
import { linearFit, mean, meanEstimate, sampleSd } from "./stats";

/**
 * Jump performance, and above all how much of a change in it is real.
 *
 * This area exists mostly to keep the rest of the app honest. Vertical jump is
 * expected to fall during a hard block, and the app is built so an in-block dip
 * reads as the model working; but that only holds if the dip is bigger than the
 * measurement error, and a tape-measure vertical has a lot of measurement error.
 * The noise floor here is what the progress chart draws its band from and what any
 * future alarm has to clear before it fires.
 */

/** Sittings with at least two attempts, below which there is no within-sitting spread. */
const MIN_SITTINGS = 4;

/**
 * The 95 percent minimal detectable change multiplier: 1.96 for the interval, root
 * two because the comparison is between *two* measurements each carrying the error.
 */
const MDC_MULTIPLIER = 1.96 * Math.SQRT2;

/** Tests whose attempts are directly comparable within a sitting. */
const NOISE_KINDS = [
  "standing_vertical",
  "two_foot_approach_vertical",
  "one_foot_approach_left",
  "one_foot_approach_right",
] as const;

/**
 * The measurement noise floor, and the change that has to be exceeded before a
 * difference between two test days means anything.
 *
 * Pooled from the spread *within* each sitting rather than between sittings, which
 * is the whole trick: two jumps ten minutes apart differ only by measurement error
 * and whatever the athlete's day-to-day variation is, while two jumps a month apart
 * also differ by everything the training did. Only the first is noise.
 *
 * Reported as the minimal detectable change rather than as the standard deviation
 * because that is the number a reader can use. "Your standing vertical is 2.1 cm
 * noisy" invites subtracting 2.1; "a change under 5.8 cm is not distinguishable
 * from noise" does not.
 */
export function noiseFloor(inputs: AnalyticsInputs): Insight[] {
  const sittings = inputs.tests.filter(
    (sitting) =>
      (NOISE_KINDS as readonly string[]).includes(sitting.kind) && sitting.attempts.length >= 2,
  );
  if (sittings.length < MIN_SITTINGS) return [];

  const spreads = sittings.map((sitting) => sampleSd(sitting.attempts));
  const pooled = Math.sqrt(mean(spreads.map((spread) => spread * spread)));
  // The interval is carried across from the per-sitting spreads rather than derived
  // from a chi-square on the pooled variance. Less elegant, and it is the honest
  // spread of the thing actually measured: how noisy a sitting is varies by sitting.
  const spreadEstimate = meanEstimate(spreads);
  if (!spreadEstimate) return [];

  return [
    draft({
      key: "jump.noise-floor",
      family: "jump",
      tier: 1,
      subject: "The noise floor of a jump test",
      statement: `A change smaller than ${(pooled * MDC_MULTIPLIER).toFixed(1)} cm between two test days is inside measurement noise, from a within-sitting spread of ${pooled.toFixed(1)} cm.`,
      value: pooled * MDC_MULTIPLIER,
      unit: "cm",
      n: sittings.length,
      minN: MIN_SITTINGS,
      ciLow: Math.max(0, spreadEstimate.ciLow) * MDC_MULTIPLIER,
      ciHigh: spreadEstimate.ciHigh * MDC_MULTIPLIER,
      detail: {
        withinSittingSd: round(pooled),
        byKind: Object.fromEntries(
          NOISE_KINDS.map((kind) => {
            const ofKind = sittings.filter((sitting) => sitting.kind === kind);
            return [
              kind,
              ofKind.length
                ? round(Math.sqrt(mean(ofKind.map((s) => sampleSd(s.attempts) ** 2))))
                : null,
            ];
          }),
        ),
      },
    }),
  ];
}

/**
 * Whether the gap between the best attempt and the average attempt is widening.
 *
 * The level of that gap is uninteresting - the best of several numbers is above
 * their mean by construction - so the insight is its *drift*, which is not
 * mechanical at all. A widening gap means the good jumps are getting better while
 * the typical jump is not, which is the signature of a technique change that has not
 * yet become the default, or of turning up to test days progressively more tired.
 * A narrowing gap means consistency, which is what a technical block is for.
 *
 * Tested against a zero slope, so a stable gap - the expected state - is correctly
 * reported as nothing to say.
 */
export function bestVersusMeanDrift(inputs: AnalyticsInputs): Insight[] {
  const sittings = inputs.tests
    .filter((sitting) => sitting.attempts.length >= 3)
    .sort((a, b) => a.day.localeCompare(b.day));
  if (sittings.length < MIN_SITTINGS) return [];

  const origin = sittings[0].day;
  const points = sittings.map((sitting) => ({
    x: daysBetween(origin, sitting.day) / 7,
    y: sitting.best - mean(sitting.attempts),
  }));
  const fit = linearFit(points);
  if (!fit) return [];

  const level = meanEstimate(points.map((point) => point.y));
  const direction = fit.slope > 0 ? "widening" : "narrowing";

  return [
    draft({
      key: "jump.best-vs-mean-drift",
      family: "jump",
      tier: 1,
      subject: "Best attempt against average attempt",
      statement: `The gap between your best attempt and your average attempt is ${direction} by ${Math.abs(fit.slope).toFixed(2)} cm a week, currently averaging ${level ? level.value.toFixed(1) : "?"} cm.`,
      value: fit.slope,
      unit: "cm per week",
      n: fit.n,
      minN: MIN_SITTINGS,
      ciLow: fit.slopeCiLow,
      ciHigh: fit.slopeCiHigh,
      p: fit.p,
      nullValue: 0,
      detail: {
        meanGapCm: level ? round(level.value) : null,
        r2: round(fit.r2),
        sittings: sittings.map((sitting) => ({
          day: sitting.day,
          kind: sitting.kind,
          best: sitting.best,
          mean: round(mean(sitting.attempts)),
        })),
      },
    }),
  ];
}

/**
 * Left-right asymmetry on the one-foot approach jump.
 *
 * Expressed as a percentage of the better leg, and signed toward the right, so a
 * positive value means the right leg jumps higher. Paired within a test day rather
 * than compared across the two series' own trends, because an asymmetry measured
 * between a good day for one leg and a bad day for the other is mostly the noise
 * floor above.
 *
 * Some asymmetry is normal and expected in a jumper with a dominant takeoff leg, so
 * the null tested is zero and the interesting reading is the interval: this insight
 * earns its place by saying how *sure* the asymmetry is, not by observing that one
 * leg is better.
 */
export function asymmetryIndex(inputs: AnalyticsInputs): Insight[] {
  const left = bestPerDay(inputs.tests, "one_foot_approach_left");
  const right = bestPerDay(inputs.tests, "one_foot_approach_right");

  const indices: { day: string; index: number; left: number; right: number }[] = [];
  for (const [day, leftBest] of left) {
    const rightBest = right.get(day);
    if (rightBest === undefined) continue;
    const better = Math.max(leftBest, rightBest);
    if (better <= 0) continue;
    indices.push({
      day,
      index: ((rightBest - leftBest) / better) * 100,
      left: leftBest,
      right: rightBest,
    });
  }

  const estimate = meanEstimate(indices.map((entry) => entry.index));
  if (!estimate) return [];
  const stronger = estimate.value > 0 ? "right" : "left";

  return [
    draft({
      key: "jump.asymmetry",
      family: "jump",
      tier: 1,
      subject: "Left against right one-foot jump",
      statement: `Your ${stronger} leg one-foot jump is ${Math.abs(estimate.value).toFixed(1)} percent higher than the other, across ${estimate.n} test days that measured both.`,
      value: estimate.value,
      // Names the quantity rather than the sign convention, because the statement above
      // reads "your left leg is 11.9 percent higher" while the interval beside it reads
      // "-12.25 to -11.54". "Positive means right" leaves the reader to work out that
      // those are the same fact; "right minus left" says which subtraction it is.
      unit: "percent, right minus left",
      n: estimate.n,
      minN: 4,
      ciLow: estimate.ciLow,
      ciHigh: estimate.ciHigh,
      p: estimate.p,
      nullValue: 0,
      detail: {
        days: indices.map((entry) => ({
          day: entry.day,
          leftCm: entry.left,
          rightCm: entry.right,
          indexPct: round(entry.index),
        })),
      },
    }),
  ];
}

function bestPerDay(tests: readonly JumpSitting[], kind: string): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const sitting of tests) {
    if (sitting.kind !== kind) continue;
    byDay.set(sitting.day, Math.max(byDay.get(sitting.day) ?? 0, sitting.best));
  }
  return byDay;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
