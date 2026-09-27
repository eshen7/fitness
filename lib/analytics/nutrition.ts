import { addDays, daysBetween } from "@/lib/days";
import { weekStart } from "@/lib/progress/scale";
import { draft, type Insight } from "./insight";
import { smoothedBodyweight, weightOn, type AnalyticsInputs } from "./inputs";
import { linearFit, mean, type Point } from "./stats";

/**
 * Bodyweight and intake, which for a jumper are a strength variable rather than a
 * vanity one.
 *
 * The ebook's claim is that relative strength is what predicts jumping and that
 * weight management is one of the two ways to raise it, so both insights here feed
 * decisions about training rather than about appearance. The rate of change is what
 * says whether a gaining block is gaining at a rate the tendons can keep up with,
 * and maintenance calories are what turn a target direction into a number of
 * kilocalories the plan can actually prescribe.
 *
 * Everything reads the Kalman trend from `inputs.ts`, never a raw morning weight.
 * A single reading carries about 0.6 kg of noise, which over a week is larger than
 * the entire effect being measured.
 */

/** Days of history. Eight weeks: long enough for a trend, short enough to be current. */
const WINDOW_DAYS = 56;

/** Readings before a rate of change is worth stating. */
const MIN_READINGS = 10;

/**
 * Rate of bodyweight change, from the trend rather than from the scale.
 *
 * Reported in kg per week *and* as a percentage of bodyweight, because the percentage
 * is the one with a defensible rule of thumb attached: something like a quarter to a
 * half percent a week is the range where a gain is mostly lean and a loss mostly
 * spares strength, and that range is the same for everyone in a way that a figure in
 * kilograms is not.
 *
 * The slope is fitted to the *raw* readings even though the trend is what is
 * reported. That is deliberate and it is the only honest option: smoothing removes
 * the noise the standard error is supposed to be measuring, so a slope fitted to
 * Kalman levels comes with an interval several times too narrow and would call a
 * fortnight of water weight a significant gaining trend.
 */
export function bodyweightTrend(inputs: AnalyticsInputs): Insight[] {
  const from = addDays(inputs.asOf, -WINDOW_DAYS);
  const readings = inputs.bodyweight
    .filter((reading) => reading.day >= from)
    .sort((a, b) => a.day.localeCompare(b.day));
  if (readings.length < MIN_READINGS) return [];

  const origin = readings[0].day;
  const fit = linearFit(
    readings.map((reading) => ({
      x: daysBetween(origin, reading.day) / 7,
      y: reading.kg,
    })),
  );
  if (!fit) return [];

  const trend = smoothedBodyweight(readings);
  const current = trend[trend.length - 1].kg;
  const percentPerWeek = current > 0 ? (fit.slope / current) * 100 : 0;
  const direction = fit.slope >= 0 ? "gaining" : "losing";

  return [
    draft({
      key: "nutrition.weight-trend",
      family: "nutrition",
      tier: 1,
      subject: "Bodyweight trend",
      statement: `Trend bodyweight is ${current.toFixed(1)} kg and ${direction} ${Math.abs(fit.slope).toFixed(2)} kg a week, which is ${Math.abs(percentPerWeek).toFixed(2)} percent of bodyweight.`,
      value: fit.slope,
      unit: "kg per week",
      n: readings.length,
      minN: MIN_READINGS,
      ciLow: fit.slopeCiLow,
      ciHigh: fit.slopeCiHigh,
      p: fit.p,
      nullValue: 0,
      detail: {
        trendKg: round(current),
        percentPerWeek: round(percentPerWeek),
        rawLatestKg: round(readings[readings.length - 1].kg),
        // The gap between the last reading and the trend is what the smoother
        // absorbed. Worth showing, because it is the number that explains why the
        // app disagrees with the scale this morning.
        smoothingGapKg: round(readings[readings.length - 1].kg - current),
        r2: round(fit.r2),
      },
    }),
  ];
}

// -----------------------------------------------------------------------------
// Maintenance calories
// -----------------------------------------------------------------------------

/** Complete weeks of paired intake and weight before maintenance is estimable. */
const MIN_INTAKE_WEEKS = 5;

/** Days a week needs logged intake on before it counts as a logged week. */
const MIN_LOGGED_DAYS_PER_WEEK = 4;

/**
 * The energy in a kilogram of bodyweight change, used only as a sanity bound.
 *
 * Roughly 7700 kcal per kg is the figure for fat; real weight change is a mix of
 * fat, lean tissue and glycogen with its water, so a personal number below it is
 * expected and one far above it means under-reported intake rather than unusual
 * metabolism.
 */
const KCAL_PER_KG = 7700;

/**
 * Maintenance calories, as the intake at which the weight trend goes flat.
 *
 * Measured rather than predicted, which is the whole point: a
 * Mifflin-St Jeor number times an activity guess is a population average wearing
 * the athlete's height, and it is routinely out by several hundred kilocalories for
 * someone doing this much plyometric work. `lib/nutrition/targets.ts` needs an
 * anchor and this is the only one grounded in this athlete's own data.
 *
 * Two construction choices matter.
 *
 * Intake is the *dependent* variable and weight change is the predictor, which looks
 * backwards. It is the right way round because ordinary least squares assumes the
 * predictor is measured without error, and of these two variables the Kalman weight
 * trend is by far the cleaner: logged intake is self-reported, systematically
 * under-counted, and missing on the days it would most have mattered. Putting the
 * noisier variable on the y axis is what keeps the slope from being attenuated toward
 * zero, which in this model would drag the estimated maintenance figure toward the
 * average intake and make it agree with whatever the athlete happens to be eating.
 *
 * The interval comes from the interval on the fitted line at zero weight change
 * rather than from the slope, because the quantity read off is a point on the line.
 * When the observed weeks are all gaining weeks, zero sits outside the data and that
 * interval widens accordingly, which is the correct report: maintenance has been
 * extrapolated to, not observed.
 */
export function maintenanceCalories(inputs: AnalyticsInputs): Insight[] {
  const from = addDays(inputs.asOf, -WINDOW_DAYS * 2);
  const trend = smoothedBodyweight(
    inputs.bodyweight.filter((reading) => reading.day >= addDays(from, -14)),
  );
  if (trend.length < MIN_READINGS) return [];

  const intakeByWeek = new Map<string, number[]>();
  for (const day of inputs.intake) {
    if (day.day < from || day.kcal <= 0) continue;
    const week = weekStart(day.day);
    const held = intakeByWeek.get(week) ?? [];
    held.push(day.kcal);
    intakeByWeek.set(week, held);
  }

  const weeks: { week: string; kcal: number; kgPerDay: number }[] = [];
  for (const [week, kcals] of [...intakeByWeek].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (kcals.length < MIN_LOGGED_DAYS_PER_WEEK) continue;
    const start = weightOn(trend, week);
    const end = weightOn(trend, addDays(week, 6));
    if (start === null || end === null || start === end) continue;
    weeks.push({ week, kcal: mean(kcals), kgPerDay: (end - start) / 7 });
  }
  if (weeks.length < MIN_INTAKE_WEEKS) return [];

  const points: Point[] = weeks.map((week) => ({ x: week.kgPerDay, y: week.kcal }));
  const fit = linearFit(points);
  if (!fit) return [];

  const maintenance = fit.at(0);
  if (!Number.isFinite(maintenance) || maintenance <= 0) return [];
  const bounds = fit.interval(0);
  const observed = mean(weeks.map((week) => week.kcal));

  return [
    draft({
      key: "nutrition.maintenance",
      family: "nutrition",
      tier: 1,
      subject: "Maintenance calories",
      statement: `Your weight holds steady at about ${Math.round(maintenance)} kcal a day, from ${weeks.length} weeks of logged intake against the weight trend.`,
      value: maintenance,
      unit: "kcal per day",
      n: weeks.length,
      minN: MIN_INTAKE_WEEKS,
      ciLow: bounds.low,
      ciHigh: bounds.high,
      // Two independent conditions, and the insight has to clear both.
      //
      // The p is the slope's: whether logged intake relates to the weight trend at
      // all. Without that there is no line to read a maintenance figure off, however
      // tight the arithmetic looks.
      //
      // The null is the athlete's own average intake rather than zero, so the gate
      // additionally demands that maintenance be distinguishable from what they are
      // already eating. That is the version of the claim that changes the target; a
      // maintenance figure equal to current intake is correct and useless.
      p: fit.p,
      nullValue: round(observed),
      detail: {
        meanLoggedIntake: Math.round(observed),
        // Intake per kilogram of weight change, which should land somewhere under
        // 7700. Far above it means the logged intake is short of the real intake by
        // that factor, and it is what the under-reporting correction will be built
        // from.
        impliedKcalPerKg: round(fit.slope),
        energyBalanceReference: KCAL_PER_KG,
        plausible: fit.slope > 0 && fit.slope < KCAL_PER_KG * 3,
        r2: round(fit.r2),
        weeks: weeks.map((week) => ({
          week: week.week,
          meanKcal: Math.round(week.kcal),
          kgPerWeek: round(week.kgPerDay * 7),
        })),
      },
    }),
  ];
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
