import { addDays, daysBetween } from "@/lib/days";

/**
 * Bodyweight against the target rate of change.
 *
 * The tracker's job here is to answer one question: is bodyweight moving at the
 * rate the target asked for? Both halves of that need care.
 *
 * The measured half is a *rate*, and a rate read off two readings is mostly the
 * difference between two bad mornings. So it is a least-squares slope through the
 * whole window of the smoothed trend, which is the same shape of estimate the
 * pre-filter uses for a rising pain score and for the same reason: the level is
 * noisy and the direction is what matters.
 *
 * The target half is a *percent* of bodyweight per week rather than an absolute
 * one, so the same target stays right as bodyweight changes, which means the
 * target path is a compound curve and not a straight line. Drawing it straight
 * would put the expected weight visibly wrong by the end of a long block.
 *
 * Pure: day keys in, numbers out, no clock and no database.
 */

export type WeightPoint = { day: string; kg: number };

/** Fewer readings than this over the window is not a rate, it is two mornings. */
export const MIN_TREND_READINGS = 4;

/**
 * Three weeks, because the smoothing has about a week of memory and a rate read
 * over one memory-length is mostly the smoother's own lag. Long enough to see a
 * quarter percent a week, short enough to notice a target being missed inside one
 * mesocycle.
 */
export const RATE_WINDOW_DAYS = 21;

/**
 * Measured weekly change as a percent of bodyweight, or null when the window is
 * too sparse to say.
 *
 * The denominator is the mean weight over the window rather than the latest one, so
 * the answer does not shift when a single reading at the end moves.
 */
export function weeklyChangePct(
  trend: readonly WeightPoint[],
  options: { asOf: string; windowDays?: number },
): number | null {
  const from = addDays(options.asOf, -(options.windowDays ?? RATE_WINDOW_DAYS));
  const points = trend.filter((point) => point.day >= from);
  if (points.length < MIN_TREND_READINGS) return null;

  const origin = points[0].day;
  const xs = points.map((point) => daysBetween(origin, point.day));
  const meanX = xs.reduce((sum, x) => sum + x, 0) / xs.length;
  const meanY = points.reduce((sum, point) => sum + point.kg, 0) / points.length;

  let numerator = 0;
  let denominator = 0;
  for (const [i, point] of points.entries()) {
    numerator += (xs[i] - meanX) * (point.kg - meanY);
    denominator += (xs[i] - meanX) ** 2;
  }
  // Every reading on one day: a level, not a rate.
  if (denominator === 0 || meanY === 0) return null;

  const kgPerDay = numerator / denominator;
  return ((kgPerDay * 7) / meanY) * 100;
}

/**
 * The weight the target implies on each day from `from` to `to`.
 *
 * Compounded weekly, since the target is a percent of the weight it is applied to.
 * One point per day so the line is smooth at any window width, and anchored on the
 * trend weight at `from` rather than on that morning's reading: the path is what the
 * trend should have done, and starting it on a noisy point offsets the whole curve.
 */
export function targetPath(input: {
  from: string;
  to: string;
  startKg: number;
  pctPerWeek: number;
}): WeightPoint[] {
  const span = daysBetween(input.from, input.to);
  if (span < 0) return [];
  const daily = (1 + input.pctPerWeek / 100) ** (1 / 7);
  return Array.from({ length: span + 1 }, (_, offset) => ({
    day: addDays(input.from, offset),
    kg: input.startKg * daily ** offset,
  }));
}

/**
 * Whether the measured rate is close enough to the target to be the same rate.
 *
 * A tolerance rather than a comparison, because a target of a quarter percent a
 * week is under 200 g on an 80 kg athlete and no measurement of bodyweight resolves
 * that in three weeks. Reported as a verdict so the UI does not have to invent its
 * own threshold: `on-target` is the common case and should look like one.
 */
export const RATE_TOLERANCE_PCT = 0.15;

export type RateVerdict = "on-target" | "faster" | "slower" | "unknown";

export function rateVerdict(
  measuredPct: number | null,
  targetPct: number | null,
): RateVerdict {
  if (measuredPct === null || targetPct === null) return "unknown";
  const delta = measuredPct - targetPct;
  if (Math.abs(delta) <= RATE_TOLERANCE_PCT) return "on-target";
  // Signed against the direction the target asked for, so "faster" means further
  // in the intended direction whether that is up or down. A hold has no direction,
  // so any drift away from zero is faster than asked for.
  const intended = targetPct === 0 ? Math.sign(delta) : Math.sign(targetPct);
  return delta * intended > 0 ? "faster" : "slower";
}
