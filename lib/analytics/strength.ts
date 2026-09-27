import { addDays, daysBetween } from "@/lib/days";
import { weekStart } from "@/lib/progress/scale";
import { draft, holdOut, type Insight } from "./insight";
import {
  bestByDay,
  oneRmSeries,
  smoothedBodyweight,
  weightOn,
  type AnalyticsInputs,
  type OneRmPoint,
} from "./inputs";
import { correlation, linearFit, theilSen, type Point } from "./stats";

/**
 * Strength, and whether it is transferring.
 *
 * The ebook's claim that the app has to encode is that *relative* strength predicts
 * jumping and absolute strength does not, and that transfer is asymmetric: max
 * strength buys power, power does not buy max strength. Both of those turn into
 * concrete analytics. The relative trend is the one to act on, and the per-lift
 * correlation with the jump is the one that decides which lifts stay in the complex.
 *
 * Every fit here is robust rather than least squares, for an unglamorous reason: a
 * strength log contains typos. One set entered as 155 kg instead of 55 moves a
 * least-squares slope through fifteen sessions by a visible amount and moves a median
 * of pairwise slopes not at all.
 */

/** Days of history read. Six months covers a macrocycle without reaching into a different athlete. */
const WINDOW_DAYS = 180;

/** Distinct days a lift needs before it gets a trend of its own. */
const MIN_LIFT_DAYS = 6;

/**
 * How many lifts get their own insights.
 *
 * A cap rather than all of them, and it is about the correction rather than about
 * screen space: every extra lift is two more statements in the
 * Benjamini-Hochberg denominator, which makes every *other* insight in the suite
 * harder to assert. The lifts kept are the ones with the most logged days, which are
 * the lifts the program is actually built on.
 */
const MAX_LIFTS = 6;

/** Weeks in an average calendar month, for turning a weekly slope into a monthly one. */
const WEEKS_PER_MONTH = 365.25 / 12 / 7;

/**
 * Estimated one-rep max per lift, robust-fit, with an interval on the slope.
 *
 * The value is kilograms per week, which is small - a good barbell squat trend is
 * well under a kilo a week - so the statement gives the monthly figure as well. A
 * rate per week with four-week blocks around it is the unit the periodisation thinks
 * in; a rate per month is the unit a person thinks in.
 */
export function oneRmTrends(inputs: AnalyticsInputs): Insight[] {
  return topLifts(inputs).flatMap(([exerciseId, points]): Insight[] => {
    const origin = points[0].day;
    const fit = theilSen(
      points.map((point) => ({ x: daysBetween(origin, point.day) / 7, y: point.oneRmKg })),
    );
    // The p comes from the least-squares fit over the same points, because Theil-Sen
    // has no standard error to test. The estimate reported is still the robust one:
    // the two disagree only when there is an outlier, and in that case the robust
    // slope is the right number and the ordinary p is the conservative test of it.
    const ols = linearFit(
      points.map((point) => ({ x: daysBetween(origin, point.day) / 7, y: point.oneRmKg })),
    );
    if (!fit || !ols) return [];

    const name = points[0].exerciseName;
    return [
      draft({
        key: `strength.e1rm.${exerciseId}`,
        family: "strength",
        tier: 1,
        subject: `Estimated ${name} one-rep max`,
        statement: `Estimated ${name} one-rep max is moving ${signed(fit.slope * WEEKS_PER_MONTH)} kg a month, from ${points.length} days of logged reps at load.`,
        value: fit.slope,
        unit: "kg per week",
        n: points.length,
        minN: MIN_LIFT_DAYS,
        ciLow: fit.slopeCiLow,
        ciHigh: fit.slopeCiHigh,
        p: ols.p,
        nullValue: 0,
        detail: {
          exerciseId,
          exerciseName: name,
          latestKg: round(points[points.length - 1].oneRmKg),
          robustSlopeKgPerWeek: round(fit.slope),
          leastSquaresSlopeKgPerWeek: round(ols.slope),
          days: points.map((point) => ({ day: point.day, oneRmKg: round(point.oneRmKg) })),
        },
      }),
    ];
  });
}

/**
 * Estimated one-rep max over smoothed bodyweight, per lift.
 *
 * The one that matters, and it can point the other way from the absolute trend,
 * which is the reason it is computed separately rather than mentioned as a footnote.
 * A lift going up while bodyweight goes up faster is a jumper getting worse, and the
 * absolute trend above would call that progress.
 *
 * Bodyweight is the Kalman level rather than the morning reading, so a ratio is never
 * moved by a single heavy Sunday.
 */
export function relativeStrengthTrends(inputs: AnalyticsInputs): Insight[] {
  const trend = smoothedBodyweight(inputs.bodyweight);
  if (trend.length === 0) return [];

  return topLifts(inputs).flatMap(([exerciseId, points]): Insight[] => {
    const ratios: { day: string; value: number }[] = [];
    for (const point of points) {
      const kg = weightOn(trend, point.day);
      if (kg === null || kg <= 0) continue;
      ratios.push({ day: point.day, value: point.oneRmKg / kg });
    }
    if (ratios.length < MIN_LIFT_DAYS) return [];

    const origin = ratios[0].day;
    const asPoints = ratios.map((ratio) => ({
      x: daysBetween(origin, ratio.day) / 7,
      y: ratio.value,
    }));
    const fit = theilSen(asPoints);
    const ols = linearFit(asPoints);
    if (!fit || !ols) return [];

    const name = points[0].exerciseName;
    const latest = ratios[ratios.length - 1].value;
    return [
      draft({
        key: `strength.relative.${exerciseId}`,
        family: "strength",
        tier: 1,
        subject: `Relative ${name} strength`,
        statement: `Relative ${name} strength is ${latest.toFixed(2)}x bodyweight and moving ${signed(fit.slope * WEEKS_PER_MONTH)}x a month, which is the strength figure the jump follows rather than the absolute load.`,
        value: fit.slope,
        unit: "bodyweight multiples per week",
        n: ratios.length,
        minN: MIN_LIFT_DAYS,
        ciLow: fit.slopeCiLow,
        ciHigh: fit.slopeCiHigh,
        p: ols.p,
        nullValue: 0,
        detail: {
          exerciseId,
          exerciseName: name,
          latestMultiple: round(latest),
          days: ratios.map((ratio) => ({ day: ratio.day, multiple: round(ratio.value) })),
        },
      }),
    ];
  });
}

/** Lags examined when looking for transfer, in weeks. */
const TRANSFER_LAGS = 4;

/** Weeks of paired data before a transfer claim is worth making. */
const MIN_TRANSFER_WEEKS = 8;

/**
 * Which lifts actually correlate with the jump, and at what lag.
 *
 * Tier 2, and in the starting set because of what it decides: the mesocycle complex
 * is about ten exercises held stable for a block, and this is the evidence for which
 * ten. It is also the insight most able to fool its reader, so three separate
 * defences are stacked on it.
 *
 * - **Weekly resolution.** Strength and jump tests do not happen on the same days,
 *   and pairing by nearest day would manufacture correlation out of which days
 *   happened to be busy.
 * - **A Bonferroni penalty inside the insight.** Five lags are examined and the best
 *   one is reported, so its p is multiplied by five before it ever reaches the
 *   suite's false-discovery correction. Taking the maximum of five correlations and
 *   reporting its own p is the single most common way to manufacture a finding.
 * - **A held-out check on the later weeks.** A relationship that only existed during
 *   one accumulation block will still show a clean pooled p; a sign that flips on the
 *   most recent third of the history is how that shows up.
 */
export function transferCorrelations(inputs: AnalyticsInputs): Insight[] {
  const jumps = weekly(bestByDay(inputs.tests, "two_foot_approach_vertical"));
  if (jumps.size < MIN_TRANSFER_WEEKS) return [];

  return topLifts(inputs).flatMap(([exerciseId, points]): Insight[] => {
    const lifts = weekly(
      new Map(points.map((point) => [point.day, point.oneRmKg] as const)),
    );

    let best: { lag: number; r: number; p: number; n: number; ciLow: number; ciHigh: number } | null =
      null;
    let bestPairs: Point[] = [];
    for (let lag = 0; lag <= TRANSFER_LAGS; lag += 1) {
      const pairs: Point[] = [];
      for (const [week, oneRm] of [...lifts].sort((a, b) => a[0].localeCompare(b[0]))) {
        const jump = jumps.get(shiftWeeks(week, lag));
        if (jump === undefined) continue;
        pairs.push({ x: oneRm, y: jump });
      }
      const fit = correlation(pairs);
      if (!fit) continue;
      if (!best || Math.abs(fit.r) > Math.abs(best.r)) {
        best = { lag, ...fit };
        bestPairs = pairs;
      }
    }
    if (!best) return [];

    const check = holdOut(bestPairs);
    const name = points[0].exerciseName;
    const lagText = best.lag === 0 ? "in the same week" : `${best.lag} week${best.lag === 1 ? "" : "s"} later`;

    return [
      draft({
        key: `strength.transfer.${exerciseId}`,
        family: "strength",
        tier: 2,
        subject: `How ${name} strength tracks the jump`,
        statement: `${name} strength tracks your two-foot approach vertical at r = ${best.r.toFixed(2)}, strongest ${lagText}.`,
        value: best.r,
        unit: "r",
        n: best.n,
        minN: MIN_TRANSFER_WEEKS,
        ciLow: best.ciLow,
        ciHigh: best.ciHigh,
        // Penalised for having looked at every lag before choosing this one.
        p: Math.min(1, best.p * (TRANSFER_LAGS + 1)),
        nullValue: 0,
        detail: {
          exerciseId,
          exerciseName: name,
          lagWeeks: best.lag,
          lagsExamined: TRANSFER_LAGS + 1,
          rawP: round(best.p),
          holdOut: check,
          // A failed held-out check does not suppress the insight; the corrected p
          // and the interval already decide that. It is recorded because a
          // relationship that reverses on recent weeks is the thing a reader most
          // needs to see next to the coefficient.
          holdOutHolds: check?.holds ?? null,
        },
      }),
    ];
  });
}

// -----------------------------------------------------------------------------

/** The lifts with the most logged days, at most `MAX_LIFTS` of them. */
function topLifts(inputs: AnalyticsInputs): [number, OneRmPoint[]][] {
  const from = addDays(inputs.asOf, -WINDOW_DAYS);
  const byExercise = new Map<number, OneRmPoint[]>();
  for (const point of oneRmSeries(inputs)) {
    if (point.day < from) continue;
    const held = byExercise.get(point.exerciseId) ?? [];
    held.push(point);
    byExercise.set(point.exerciseId, held);
  }
  return [...byExercise.entries()]
    .filter(([, points]) => points.length >= MIN_LIFT_DAYS)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_LIFTS);
}

/** Day-keyed values rolled into weeks, keeping the week's maximum. */
function weekly(series: ReadonlyMap<string, number>): Map<string, number> {
  const byWeek = new Map<string, number>();
  for (const [day, value] of series) {
    const week = weekStart(day);
    byWeek.set(week, Math.max(byWeek.get(week) ?? Number.NEGATIVE_INFINITY, value));
  }
  return byWeek;
}

function shiftWeeks(week: string, weeks: number): string {
  return addDays(week, weeks * 7);
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}`;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
