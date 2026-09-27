import { addDays, daysBetween } from "@/lib/days";
import { tendonSiteLabels } from "@/lib/labels";
import { weekStart } from "@/lib/progress/scale";
import type { TendonSite } from "@/lib/taxonomy";
import { draft, type Insight } from "./insight";
import {
  dailyLoads,
  weeklyLoads,
  worstPainByDay,
  type AnalyticsInputs,
} from "./inputs";
import {
  laggedCorrelations,
  linearFit,
  logisticFit,
  logisticThreshold,
  mean,
  median,
  quadraticFit,
  tCritical,
  type Point,
} from "./stats";

/**
 * Plyometrics and tendon risk: the part of the suite with real consequences.
 *
 * Everything else here informs a plan. These four decide whether to keep jumping,
 * and the ebook is emphatic that plyometrics are the hardest part of jump training
 * to get right and can make some athletes jump lower. So the defaults are
 * conservative in a specific direction: every estimate here shrinks toward doing
 * less, the load ceiling is penalised rather than optimistic, and none of it
 * describes structure. Function and pain only.
 */

/** Days of history for the lag and ceiling analyses. */
const WINDOW_DAYS = 180;

/**
 * A flare is a day whose worst reported pain sits this far above the athlete's own
 * median.
 *
 * Their own median, not a fixed number on the 0 to 10 scale, because a jumper who
 * lives at 3 and a jumper who lives at 0 are both normal and a threshold of 4 would
 * mean "most days" for one of them and "never" for the other. Two points is about
 * the smallest change a person reliably distinguishes on a subjective scale.
 */
const FLARE_MARGIN = 2;

// -----------------------------------------------------------------------------
// Depth jump calibration
// -----------------------------------------------------------------------------

/** Distinct drop heights before a curve can be fitted through them. */
const MIN_DROP_HEIGHTS = 3;

/**
 * The drop height where the depth jump peaks, by fitting a quadratic and taking
 * the vertex.
 *
 * This is the ebook's protocol turned into an estimate rather than a procedure. The
 * procedure is to raise the box until measured vertical falls below the standing
 * jump and train at the last height before it did, which `lib/progress/derive.ts`
 * implements exactly and which the calibration flow walks the owner through. The
 * procedure answers with one of the heights that happened to be tested; the curve
 * answers with the height where the peak actually is, which is usually between two
 * of them.
 *
 * Both are kept because they fail differently. The protocol rule is robust and
 * coarse. The fit is precise and can be nonsense - three heights and a flat response
 * put the vertex anywhere - which is why the interval comes from the leave-one-out
 * jackknife's standard error and the insight is discarded outright when that interval escapes the range of
 * heights actually jumped from. A recommendation to drop from a box nobody has
 * dropped from is extrapolation, and this is the one insight in the suite where
 * acting on extrapolation means landing on it.
 */
export function depthJumpVertex(inputs: AnalyticsInputs): Insight[] {
  const points: Point[] = [];
  for (const sitting of inputs.tests) {
    if (sitting.kind !== "depth_jump_vertical") continue;
    if (sitting.boxHeightCm === null) continue;
    points.push({ x: sitting.boxHeightCm, y: sitting.best });
  }
  const heights = [...new Set(points.map((point) => point.x))];
  if (heights.length < MIN_DROP_HEIGHTS) return [];

  const fit = quadraticFit(points);
  if (!fit || fit.vertexX === null) return [];

  const lowest = Math.min(...heights);
  const highest = Math.max(...heights);
  if (fit.vertexX < lowest || fit.vertexX > highest) return [];

  // Leave-one-out: refit without each attempt and collect the vertices. A vertex
  // that moves 40 cm when one jump is dropped has not been measured.
  const jackknife: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const without = quadraticFit(points.filter((_, i) => i !== index));
    if (without?.vertexX != null) jackknife.push(without.vertexX);
  }
  if (jackknife.length < points.length - 1) return [];
  const m = jackknife.length;
  const centre = mean(jackknife);
  const se = Math.sqrt(
    ((m - 1) / m) * jackknife.reduce((sum, vertex) => sum + (vertex - centre) ** 2, 0),
  );
  const ciLow = fit.vertexX - tCritical(m - 1) * se;
  const ciHigh = fit.vertexX + tCritical(m - 1) * se;
  if (ciLow < lowest || ciHigh > highest) return [];

  return [
    draft({
      key: "plyo.depth-jump-height",
      family: "plyometrics",
      tier: 1,
      subject: "The drop height your depth jump peaks at",
      statement: `Your depth jump peaks at a drop height of about ${Math.round(fit.vertexX)} cm, from ${heights.length} heights tested between ${Math.round(lowest)} and ${Math.round(highest)} cm.`,
      value: fit.vertexX,
      unit: "cm",
      n: points.length,
      minN: 6,
      ciLow,
      ciHigh,
      detail: {
        heightsTested: heights.sort((a, b) => a - b),
        r2: round(fit.r2),
        curvature: round(fit.a),
        peakJumpCm: round(fit.at(fit.vertexX)),
      },
    }),
  ];
}

// -----------------------------------------------------------------------------
// Protocol progression
// -----------------------------------------------------------------------------

/** Pain at or below this, and measurably not rising, is the readiness condition to progress. */
const PROGRESSION_PAIN_CEILING = 3;

/** Readings in the window before a trend can be read at all. */
const MIN_PROGRESSION_READINGS = 6;

/** Days the pain trend is read over. Three weeks, which is a phase's worth of sessions. */
const PROGRESSION_WINDOW = 21;

/**
 * Whether a site in the load-management protocol is ready for the next phase.
 *
 * A measured decision rather than a judgement call, because the judgement call has a
 * known bias: the phases get more fun as they go and the athlete is the one deciding.
 * Two conditions, both from the protocol's own logic - pain low enough to load
 * through, and not trending upward - and the second has to be shown rather than
 * merely not disproved: the whole interval on the weekly pain slope must sit at or
 * below zero. A noisy series whose slope cannot be told from a rise reads as hold,
 * so every doubt resolves toward staying in the phase.
 *
 * The value is the slope, so the interval and the p are about one quantity in one
 * unit; the current level is a separate condition and is reported beside it. This only
 * recommends. Moving a site to the next phase is still the owner's confirmation.
 *
 * Reported per site, and only for sites actually in a phase. A site with no protocol
 * has nothing to progress.
 */
export function protocolReadiness(inputs: AnalyticsInputs): Insight[] {
  const from = addDays(inputs.asOf, -PROGRESSION_WINDOW);
  const bySite = new Map<TendonSite, typeof inputs.tendon>();
  for (const row of inputs.tendon) {
    if (row.day < from || row.day > inputs.asOf) continue;
    const held = bySite.get(row.site) ?? [];
    held.push(row);
    bySite.set(row.site, held);
  }

  return [...bySite.entries()].flatMap(([site, rows]): Insight[] => {
    const ordered = [...rows].sort((a, b) => a.day.localeCompare(b.day));
    const phase = ordered[ordered.length - 1].protocolPhase;
    if (phase === null) return [];

    const origin = ordered[0].day;
    const worst = ordered.map((row) => ({
      day: row.day,
      value: Math.max(row.painDuringLoad, row.painAfterLoad, row.morningStiffness),
    }));
    const fit = linearFit(
      worst.map((entry) => ({ x: daysBetween(origin, entry.day) / 7, y: entry.value })),
    );
    if (!fit) return [];

    const recent = worst.filter((entry) => entry.day >= addDays(inputs.asOf, -7));
    const level = recent.length ? mean(recent.map((entry) => entry.value)) : null;
    const holds = [
      ordered.length < MIN_PROGRESSION_READINGS
        ? `only ${ordered.length} readings in ${PROGRESSION_WINDOW} days, short of the ${MIN_PROGRESSION_READINGS} a trend needs`
        : null,
      level === null ? "no reading in the last week" : null,
      level !== null && level > PROGRESSION_PAIN_CEILING
        ? `pain at ${level.toFixed(1)}/10 over the last week, above the ${PROGRESSION_PAIN_CEILING}/10 ceiling`
        : null,
      fit.slopeCiHigh > 0
        ? `a trend of ${signed(fit.slope)} a week that could still be a rise`
        : null,
    ].filter((reason): reason is string => reason !== null);
    const ready = holds.length === 0;

    const label = tendonSiteLabels.of(site);
    const next =
      phase >= 4
        ? "return to full jumping and sprinting load"
        : `move to phase ${phase + 1}`;

    return [
      draft({
        key: `plyo.protocol-readiness.${site}`,
        family: "plyometrics",
        tier: 1,
        subject: `Readiness to leave protocol phase ${phase} at ${label}`,
        statement:
          ready && level !== null
            ? `${label} is in protocol phase ${phase} at ${level.toFixed(1)}/10 and measurably not rising, which meets the conditions to recommend you ${next}; advancing still needs your confirmation.`
            : `${label} is in protocol phase ${phase}, so hold this phase: ${holds.join("; ")}.`,
        value: fit.slope,
        unit: "pain points per week",
        n: ordered.length,
        minN: MIN_PROGRESSION_READINGS,
        ciLow: fit.slopeCiLow,
        ciHigh: fit.slopeCiHigh,
        p: fit.p,
        nullValue: 0,
        detail: {
          site,
          phase,
          readyToProgress: ready,
          recentPainLevel: level === null ? null : round(level),
          painCeiling: PROGRESSION_PAIN_CEILING,
          painSlopePerWeek: round(fit.slope),
          readings: worst,
        },
      }),
    ];
  });
}

// -----------------------------------------------------------------------------
// Pain lag
// -----------------------------------------------------------------------------

/** Days of lag examined between a load and the pain it causes. */
const PAIN_LAGS = 4;

/**
 * How long after a hard day the pain shows up.
 *
 * Tier 2 and in the starting set because of what the answer changes. If pain peaks
 * two days after the overload, then the warning on the day it matters has to be built
 * from *load*, not from pain: by the time the pain arrives the session that caused it
 * is two days gone and the next one is already planned. Knowing the lag is what turns
 * a lagging indicator into a leading one.
 *
 * Every lag is correlated and the strongest positive one is reported, so its p is
 * multiplied by the number of lags before it reaches the suite's correction. Without
 * that the insight would be significant on pure noise about a quarter of the time.
 * Only a positive one, because the claim is that load leads to pain: a negative
 * correlation is the athlete cutting contacts on painful days, and reporting it would
 * say the opposite of what the data shows.
 */
export function painLag(inputs: AnalyticsInputs): Insight[] {
  const loads = dailyLoads(inputs, WINDOW_DAYS);
  const contacts = new Map(
    loads.filter((load) => load.contacts > 0).map((load) => [load.day, load.contacts] as const),
  );
  const pain = worstPainByDay(inputs.tendon);
  if (contacts.size < 8 || pain.size < 8) return [];

  const lags = laggedCorrelations(contacts, pain, {
    maxLag: PAIN_LAGS,
    shiftDay: addDays,
  });
  if (lags.length === 0) return [];

  const best = lags.reduce((strongest, entry) => (entry.r > strongest.r ? entry : strongest));
  if (!(best.r > 0)) return [];
  const when =
    best.lag === 0 ? "the same day" : `${best.lag} day${best.lag === 1 ? "" : "s"} later`;

  return [
    draft({
      key: "plyo.pain-lag",
      family: "plyometrics",
      tier: 2,
      subject: "How long tendon pain lags contacts",
      statement: `High-impact contacts track tendon pain most strongly ${when} (r = ${best.r.toFixed(2)}), so a warning has to be built from planned contacts rather than from today's pain.`,
      // The correlation at the chosen lag, not the lag itself. A lag is an integer
      // chosen from five, and no interval on it would mean anything; the interval
      // that matters is on whether there is an effect, and the lag is in `detail`.
      value: best.r,
      unit: "r",
      n: best.n,
      minN: 12,
      ciLow: best.ciLow,
      ciHigh: best.ciHigh,
      p: Math.min(1, best.p * lags.length),
      nullValue: 0,
      detail: {
        lagDays: best.lag,
        lagsExamined: lags.length,
        byLag: lags.map((entry) => ({
          lagDays: entry.lag,
          r: round(entry.r),
          n: entry.n,
          rawP: round(entry.p),
        })),
        peakR: round(best.r),
        peakRawP: round(best.p),
      },
    }),
  ];
}

// -----------------------------------------------------------------------------
// Tendon load ceiling
// -----------------------------------------------------------------------------

/** Weeks of paired load and pain before a ceiling is estimable. */
const MIN_CEILING_WEEKS = 12;

/**
 * The weekly high-impact contact count above which a pain flare becomes more likely
 * than not.
 *
 * The single most decision-relevant number the suite can produce, and the one most
 * easily produced wrongly, so the construction is worth stating.
 *
 * The unit of observation is a week, not a day, because the thing being managed is a
 * weekly dose and because next-day pain against same-day contacts would be answering
 * the lag question instead. The outcome is whether the *following* week contained a
 * flare, which is what makes this a prediction rather than a description. The fit is
 * ridge-penalised, because fifteen weeks of one athlete's data are frequently
 * separable and unpenalised logistic regression on separable data returns an infinite
 * coefficient and an infinite confidence in it.
 *
 * Two models are fitted. The multi-predictor one - contacts, mean session intensity,
 * and the share of the week's plyometric work that was short-coupling - is what the
 * `detail` reports, because it is the one that says whether contacts are the thing
 * that matters or merely the thing that correlates with it. The single-predictor one
 * is what the ceiling is read off, because a threshold is only meaningful when
 * everything else is held at its average, and a reader given a number from a
 * three-predictor model will use it as if it came from one.
 */
export function tendonLoadCeiling(inputs: AnalyticsInputs): Insight[] {
  const weeks = weeklyLoads(dailyLoads(inputs, WINDOW_DAYS));
  const pain = worstPainByDay(inputs.tendon);
  if (pain.size < MIN_CEILING_WEEKS) return [];

  const baseline = median([...pain.values()]);
  const flareThreshold = baseline + FLARE_MARGIN;

  const intensityByWeek = weeklyMeanIntensity(inputs);
  const rows: { x: number[]; y: number; week: string }[] = [];
  for (const week of weeks) {
    const next = flaredDuring(pain, addDays(week.day, 7), flareThreshold);
    // A week with no pain check-ins at all is not a week without a flare; it is a
    // week with no outcome, and scoring it as a zero would bias the ceiling upward,
    // which is the dangerous direction.
    if (next === null) continue;
    rows.push({
      week: week.day,
      x: [week.contacts, intensityByWeek.get(week.day) ?? 0, shortCouplingShare(inputs, week.day)],
      y: next ? 1 : 0,
    });
  }
  if (rows.length < MIN_CEILING_WEEKS) return [];

  const full = logisticFit(rows);
  const contactsOnly = logisticFit(rows.map((row) => ({ x: [row.x[0]], y: row.y })));
  if (!contactsOnly) return [];
  const ceiling = logisticThreshold(contactsOnly);
  if (ceiling === null || ceiling <= 0) return [];

  const contactCounts = rows.map((row) => row.x[0]);
  const highest = Math.max(...contactCounts);
  // Same rule as the depth jump vertex, and for the same reason: a ceiling above any
  // week ever trained is a number the data has nothing to say about.
  if (ceiling > highest * 1.25) return [];

  const [, slope] = contactsOnly.coefficients;
  // A ceiling only exists if more contacts make a flare more likely. On a negative
  // slope the 50% crossing is a floor below which flares are likelier, and reporting
  // it as a ceiling would tell the athlete to train above it.
  if (!(slope > 0)) return [];
  const slopeSe = contactsOnly.standardErrors[1];
  // The interval on the ceiling comes from the interval on the slope, which is where
  // nearly all the uncertainty is. Delta-method rather than a bootstrap: with twelve
  // weeks, a bootstrap resamples the same handful of flare weeks over and over and
  // reports an interval narrower than the truth.
  const ceilingSe = slopeSe > 0 && slope !== 0 ? Math.abs(ceiling * (slopeSe / slope)) : 0;

  return [
    draft({
      key: "plyo.tendon-ceiling",
      family: "plyometrics",
      tier: 2,
      subject: "The weekly contact count a flare becomes likely above",
      statement: `A pain flare becomes more likely than not above about ${Math.round(ceiling)} high-impact contacts in a week, from ${rows.length} weeks in which ${rows.filter((row) => row.y === 1).length} flared.`,
      value: ceiling,
      unit: "contacts per week",
      n: rows.length,
      minN: MIN_CEILING_WEEKS,
      ciLow: Math.max(0, ceiling - 1.96 * ceilingSe),
      ciHigh: ceiling + 1.96 * ceilingSe,
      p: contactsOnly.p[1],
      detail: {
        flareThreshold: round(flareThreshold),
        baselinePain: round(baseline),
        flareWeeks: rows.filter((row) => row.y === 1).length,
        highestWeekTrained: highest,
        contactsCoefficient: round(slope),
        withCovariates: full
          ? {
              converged: full.converged,
              contacts: round(full.coefficients[1]),
              meanIntensity: round(full.coefficients[2]),
              shortCouplingShare: round(full.coefficients[3]),
              p: full.p.map(round),
            }
          : null,
        weeks: rows.map((row) => ({ week: row.week, contacts: row.x[0], flared: row.y === 1 })),
      },
    }),
  ];
}

/**
 * Whether the week starting `from` contained a day above the flare threshold.
 *
 * Null when the week had no pain check-ins, which is a missing outcome rather than a
 * negative one.
 */
function flaredDuring(
  pain: ReadonlyMap<string, number>,
  from: string,
  threshold: number,
): boolean | null {
  let seen = false;
  for (let offset = 0; offset < 7; offset += 1) {
    const value = pain.get(addDays(from, offset));
    if (value === undefined) continue;
    seen = true;
    if (value >= threshold) return true;
  }
  return seen ? false : null;
}

function weeklyMeanIntensity(inputs: AnalyticsInputs): Map<string, number> {
  const byWeek = new Map<string, number[]>();
  for (const session of inputs.sessions) {
    if (session.plannedIntensity === null) continue;
    const week = weekStart(session.day);
    const held = byWeek.get(week) ?? [];
    held.push(session.plannedIntensity);
    byWeek.set(week, held);
  }
  return new Map([...byWeek].map(([week, values]) => [week, mean(values)]));
}

/** The share of the week's plyometric sets that were short-coupling, 0 to 1. */
function shortCouplingShare(inputs: AnalyticsInputs, week: string): number {
  let short = 0;
  let total = 0;
  for (const set of inputs.loggedSets) {
    if (weekStart(set.day) !== week) continue;
    const exercise = inputs.exercises.get(set.exerciseId);
    if (!exercise?.highImpact) continue;
    total += 1;
    if (exercise.couplingClass === "short_ssc") short += 1;
  }
  return total === 0 ? 0 : short / total;
}

function signed(value: number): string {
  return `${value >= 0 ? "+" : "-"}${Math.abs(value).toFixed(1)}`;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
