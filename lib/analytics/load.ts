import { addDays } from "@/lib/days";
import { weekStart } from "@/lib/progress/scale";
import { draft, type Insight } from "./insight";
import {
  dailyLoads,
  weeklyLoads,
  type AnalyticsInputs,
  type DayLoad,
} from "./inputs";
import {
  correlation,
  linearFit,
  mean,
  meanEstimate,
  sampleSd,
  studentTP,
  tCritical,
} from "./stats";

/**
 * Readiness, fatigue and load: the insights that say how much work has been done
 * lately relative to what the athlete is used to.
 *
 * All of them are computed per *currency* rather than over a single load number,
 * because the ebook's position is that fatigue is specific to the type of muscular
 * work. One ratio over the sum of high-impact contacts, plyometric sets and barbell
 * tonnage would be a number that rises when any of the three rises and therefore
 * tells you about none of them. Three ratios is more screen space and more
 * multiple-comparison budget, and it is the only version that can answer the
 * question the owner actually has, which is whether to bound today.
 */

/** Acute is one week. Chronic is four, which is also a mesocycle. */
const ACUTE_WEEKS = 1;
const CHRONIC_WEEKS = 4;

/** Weeks of history before a monotony average means anything. */
const MIN_RATIO_WEEKS = 4;

/** Baseline weeks the acute week is compared against. */
const BASELINE_WEEKS = CHRONIC_WEEKS - ACUTE_WEEKS;

type Currency = {
  key: string;
  label: string;
  unit: string;
  of: (load: DayLoad) => number;
};

const CURRENCIES: readonly Currency[] = [
  {
    key: "contacts",
    label: "high-impact contacts",
    unit: "ratio",
    of: (load) => load.contacts,
  },
  {
    key: "plyo-sets",
    label: "plyometric sets",
    unit: "ratio",
    of: (load) => load.plyoSets,
  },
  { key: "tonnage", label: "barbell tonnage", unit: "ratio", of: (load) => load.tonnageKg },
];

/**
 * Acute to chronic workload ratio, one per currency.
 *
 * The ratio itself is arithmetic. The part worth getting right is the interval,
 * because a ratio of 1.4 against three quiet weeks and a ratio of 1.4 against three
 * wildly varying ones are not the same claim, and only the second is normal. So the
 * interval comes from the spread of the chronic weeks, and the p is the p for this
 * week being an unusual week *for this athlete* rather than for the ratio exceeding
 * some published threshold - which is the right test, since the published thresholds
 * come from team-sport cohorts and this is one jumper.
 *
 * The null is 1: a week exactly as hard as the three before it.
 *
 * Weeks are whole Monday-to-Sunday weeks ending on the last Sunday on or before
 * `asOf`. A week still in progress would be compared against full ones and read as
 * a deload every Tuesday.
 */
export function workloadRatios(inputs: AnalyticsInputs): Insight[] {
  const end = addDays(weekStart(addDays(inputs.asOf, 1)), -1);
  const weeks = weeklyLoads(dailyLoads({ ...inputs, asOf: end }, CHRONIC_WEEKS * 7));
  if (weeks.length < CHRONIC_WEEKS) return [];

  const acute = weeks.slice(-ACUTE_WEEKS);
  const chronic = weeks.slice(0, -ACUTE_WEEKS);

  return CURRENCIES.flatMap((currency): Insight[] => {
    const acuteLoad = mean(acute.map(currency.of));
    const baseline = chronic.map(currency.of);
    const chronicLoad = mean(baseline);
    // Nothing of this kind was done at all in the baseline. A ratio with a zero
    // denominator is not a large ratio, it is an undefined one, and reporting it as
    // Infinity would put the loudest possible number on the thinnest possible data.
    if (chronicLoad === 0) return [];

    const spread = sampleSd(baseline);
    // A prediction interval for one more week, not a confidence interval for the
    // baseline mean: the question is whether *this* week is unusual, and the extra
    // 1/n under the root is what accounts for the baseline itself being estimated.
    const se = spread * Math.sqrt(1 + 1 / baseline.length);
    const df = baseline.length - 1;
    const half = se === 0 ? 0 : (tCritical(df) * se) / chronicLoad;
    const ratio = acuteLoad / chronicLoad;

    return [
      draft({
        key: `load.acwr.${currency.key}`,
        family: "load",
        tier: 1,
        subject: `Acute versus chronic ${currency.label}`,
        statement: `The latest full week's ${currency.label} are ${ratio.toFixed(2)}x the average of the ${baseline.length} weeks before it.`,
        value: ratio,
        unit: currency.unit,
        n: baseline.length,
        minN: BASELINE_WEEKS,
        ciLow: ratio - half,
        ciHigh: ratio + half,
        p: se === 0 ? null : studentTP((acuteLoad - chronicLoad) / se, df),
        nullValue: 1,
        detail: {
          weekEnding: end,
          acute: round(acuteLoad),
          chronicPerWeek: round(chronicLoad),
          weeks: weeks.map((week) => ({ week: week.day, value: round(currency.of(week)) })),
        },
      }),
    ];
  });
}

/**
 * Foster's training monotony and strain.
 *
 * Monotony is a week's mean daily load over its standard deviation, and it is the
 * one load metric that says something the volume total cannot: the ebook's rule of
 * 60 percent exists because a week where every day is the same is worse than a week
 * of the same total with hard days and easy ones, and monotony is that idea as a
 * number. Strain is the week's total load times its monotony, which is the figure
 * that actually tracks with breaking down.
 *
 * The load unit is session RPE times logged sets, which is Foster's session-RPE
 * measure with sets standing in for minutes. Sets are what this app records
 * reliably and duration is what it does not, and the substitution is harmless
 * because both metrics are ratios or products of the same unit, so the unit
 * cancels out of monotony entirely.
 *
 * Reported as a mean over the recent weeks with an interval, rather than as the
 * latest week alone: one week's monotony is four or five numbers and its standard
 * deviation is accordingly terrible, so the single-week figure belongs in `detail`
 * as context for a mean that can carry an interval.
 */
export function trainingMonotony(inputs: AnalyticsInputs): Insight[] {
  const weeks = fosterWeeks(inputs, CHRONIC_WEEKS * 2);
  const monotonies = weeks.map((week) => week.monotony).filter(finite);
  const strains = weeks.map((week) => week.strain).filter(finite);
  const monotonyEstimate = meanEstimate(monotonies);
  const strainEstimate = meanEstimate(strains);
  if (!monotonyEstimate || !strainEstimate) return [];

  const detail = {
    weeks: weeks.map((week) => ({
      week: week.week,
      load: round(week.load),
      monotony: round(week.monotony),
      strain: round(week.strain),
    })),
    latestMonotony: round(weeks[weeks.length - 1]?.monotony ?? 0),
  };

  return [
    draft({
      key: "load.monotony",
      family: "load",
      tier: 1,
      subject: "Training monotony",
      statement: `Training monotony averages ${monotonyEstimate.value.toFixed(2)} over the last ${monotonyEstimate.n} weeks; Foster's caution starts around 2.0, where every day of the week carries the same load.`,
      value: monotonyEstimate.value,
      unit: "index",
      n: monotonyEstimate.n,
      minN: MIN_RATIO_WEEKS,
      ciLow: monotonyEstimate.ciLow,
      ciHigh: monotonyEstimate.ciHigh,
      detail,
    }),
    draft({
      key: "load.strain",
      family: "load",
      tier: 1,
      subject: "Weekly training strain",
      statement: `Weekly training strain averages ${Math.round(strainEstimate.value)} RPE-sets, meaning the week's load multiplied by how evenly it was spread.`,
      value: strainEstimate.value,
      unit: "RPE-sets",
      n: strainEstimate.n,
      minN: MIN_RATIO_WEEKS,
      ciLow: strainEstimate.ciLow,
      ciHigh: strainEstimate.ciHigh,
      detail,
    }),
  ];
}

type FosterWeek = { week: string; load: number; monotony: number; strain: number };

function fosterWeeks(inputs: AnalyticsInputs, windowWeeks: number): FosterWeek[] {
  const from = addDays(inputs.asOf, -windowWeeks * 7 + 1);
  const setsBySession = new Map<number, number>();
  for (const set of inputs.loggedSets) {
    setsBySession.set(set.sessionId, (setsBySession.get(set.sessionId) ?? 0) + 1);
  }

  // Every calendar day in the window, so a rest day contributes a zero and lowers
  // monotony the way it should rather than being left out of the denominator.
  const byDay = new Map<string, number>();
  for (const load of dailyLoads(inputs, windowWeeks * 7)) byDay.set(load.day, 0);
  for (const session of inputs.sessions) {
    if (session.day < from || session.reportedRpe === null) continue;
    if (!byDay.has(session.day)) continue;
    const sets = setsBySession.get(session.id) ?? 0;
    byDay.set(session.day, (byDay.get(session.day) ?? 0) + session.reportedRpe * sets);
  }

  const weeks = new Map<string, number[]>();
  for (const [day, load] of byDay) {
    const week = weekStart(day);
    const held = weeks.get(week) ?? [];
    held.push(load);
    weeks.set(week, held);
  }

  return [...weeks.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    // Partial weeks at either end of the window would report a monotony computed
    // over three days, which is not the same quantity.
    .filter(([, loads]) => loads.length === 7)
    .map(([week, loads]) => {
      const total = loads.reduce((sum, load) => sum + load, 0);
      const spread = sampleSd(loads);
      const monotony = spread === 0 ? Number.NaN : mean(loads) / spread;
      return { week, load: total, monotony, strain: total * monotony };
    });
}

/**
 * How much of WHOOP's day strain the logged training accounts for.
 *
 * The decision this serves is one the app cannot otherwise make: a session that
 * went badly after a day of moving house and a session that went badly because
 * last week was too hard call for opposite responses, and only an external load
 * signal can tell them apart. So the insight is the correlation between logged sets
 * and day strain, and the number that makes it actionable sits in `detail`: the mean
 * strain on days with no training at all, which is this athlete's life-load floor.
 */
export function externalLoadCrossCheck(inputs: AnalyticsInputs): Insight[] {
  const loads = dailyLoads(inputs, 90).filter((load) => load.strain !== null);
  if (loads.length < 10) return [];

  const pairs = loads.map((load) => ({ x: load.sets, y: load.strain as number }));
  const fit = correlation(pairs);
  const line = linearFit(pairs);
  if (!fit) return [];

  const restStrains = loads
    .filter((load) => load.sets === 0)
    .map((load) => load.strain as number);

  return [
    draft({
      key: "load.external-cross-check",
      family: "load",
      tier: 1,
      subject: "How much of WHOOP day strain the plan explains",
      statement: `Logged training explains ${Math.round(fit.r * fit.r * 100)} percent of the variation in WHOOP day strain, so the rest of a day's strain came from life rather than from the plan.`,
      value: fit.r * fit.r,
      unit: "r squared",
      n: fit.n,
      minN: 10,
      // The interval is on r squared, so both ends of the r interval are squared
      // and re-sorted: an r interval spanning zero has its smallest square at zero,
      // not at either end.
      ciLow: fit.ciLow * fit.ciHigh < 0 ? 0 : Math.min(fit.ciLow ** 2, fit.ciHigh ** 2),
      ciHigh: Math.max(fit.ciLow ** 2, fit.ciHigh ** 2),
      p: fit.p,
      nullValue: 0,
      detail: {
        r: round(fit.r),
        strainPerSet: line ? round(line.slope) : null,
        restDayStrain: restStrains.length ? round(mean(restStrains)) : null,
        restDays: restStrains.length,
      },
    }),
  ];
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
