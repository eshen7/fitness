import { addDays } from "@/lib/days";
import { draft, type Insight } from "./insight";
import type { AnalyticsInputs, ReadinessRow } from "./inputs";
import {
  correlation,
  linearFit,
  mean,
  predictiveR2,
  ridgeFit,
  sampleSd,
  type Point,
} from "./stats";

/**
 * Whether WHOOP's recovery score is worth listening to, or whether the raw inputs
 * behind it say more once they are weighted for this athlete.
 *
 * Tier 2, and in the starting set because of how much the answer changes. The
 * recovery percentage is the single most prominent number the owner sees each morning
 * and the generator reads it as readiness. If it does not predict how this athlete's
 * sessions actually go, then every day it is deferred to is a day the plan was bent
 * around a number from someone else's population.
 *
 * WHOOP's score is a fixed formula fit across everyone. The alternative here is the
 * same raw inputs - HRV, resting heart rate, sleep duration, sleep performance, slow
 * wave and REM minutes - reweighted by ridge regression against this athlete's own
 * outcomes. Whichever predicts better on weeks the fit did not see is the one
 * reported, which is the only comparison that means anything: an index fit on all the
 * data will always beat a fixed formula in-sample, and doing that comparison in-sample
 * would recommend the personal index every time regardless of whether it works.
 */

/** Days of history. Twelve weeks of daily readiness rows. */
const WINDOW_DAYS = 84;

/** Paired days before either model is fit. */
const MIN_PAIRED_DAYS = 21;

/**
 * The share of days held back to test on, taken from the end of the series.
 *
 * From the end rather than at random, because readiness and performance are both
 * autocorrelated: a random hold-out leaves each test day sitting between two training
 * days, so the model can reach a near neighbour and scores far better than it will
 * tomorrow. A time split is the pessimistic estimate and the honest one.
 */
const HOLD_OUT_FRACTION = 0.3;

/**
 * The ridge constant for the personal index.
 *
 * Deliberately firm. Six standardised predictors over maybe fifty days is exactly the
 * regime where an unpenalised fit invents a large positive HRV coefficient and a large
 * negative sleep coefficient that cancel out, and the penalty is what keeps the
 * comparison against WHOOP's score a fair one rather than a contest between a formula
 * and an interpolation.
 */
const RIDGE = 3;

type Predictor = {
  key: string;
  label: string;
  of: (row: ReadinessRow) => number | null;
};

/**
 * The raw inputs WHOOP's own recovery score is built from, as far as the API exposes
 * them. Anything WHOOP derives from these - the score itself, sleep need - is left
 * out, because including a value and its own summary makes the fit a tautology.
 */
const PREDICTORS: readonly Predictor[] = [
  { key: "hrv", label: "HRV", of: (row) => row.hrvMs },
  { key: "rhr", label: "resting heart rate", of: (row) => row.restingHeartRate },
  { key: "sleep", label: "sleep duration", of: (row) => row.sleepMinutes },
  {
    key: "sleep-performance",
    label: "sleep performance",
    of: (row) => row.sleepPerformancePct,
  },
  { key: "slow-wave", label: "slow wave sleep", of: (row) => row.slowWaveMinutes },
  { key: "rem", label: "REM sleep", of: (row) => row.remMinutes },
];

/**
 * WHOOP's recovery score against a personally fitted index, on the same outcome.
 *
 * The outcome is how much easier a session felt than it was prescribed to feel:
 * target RPE minus actual RPE, averaged over the day's prescribed sets, so a positive
 * value means the work went better than planned. That choice deserves defending,
 * because the obvious outcome - jump height - is measured on test days only and there
 * are not enough of them in a mesocycle to fit anything against.
 *
 * This proxy is available on nearly every training day, it is on an interval scale, and
 * it is already adjusted for how hard the day was supposed to be, which is what makes
 * it comparable across a heavy Monday and a light Friday. Its weakness is that it is
 * self-reported from the same person whose morning readiness is being tested, so a bad
 * recovery score can talk them into a higher RPE. That is a real confound, it inflates
 * both models equally, and it is named in `detail` rather than hidden.
 */
export function recoveryIndex(inputs: AnalyticsInputs): Insight[] {
  const performance = performanceByDay(inputs);
  const from = addDays(inputs.asOf, -WINDOW_DAYS);

  const rows: { day: string; readiness: ReadinessRow; outcome: number }[] = [];
  for (const readiness of inputs.readiness) {
    if (readiness.day < from) continue;
    const outcome = performance.get(readiness.day);
    if (outcome === undefined) continue;
    rows.push({ day: readiness.day, readiness, outcome });
  }
  rows.sort((a, b) => a.day.localeCompare(b.day));
  if (rows.length < MIN_PAIRED_DAYS) return [];

  // Only predictors WHOOP actually delivered on every paired day. A column with holes
  // in it would have to be imputed, and imputing a night's HRV from its neighbours
  // manufactures exactly the autocorrelation the time split exists to defeat.
  const available = PREDICTORS.filter((predictor) =>
    rows.every((row) => predictor.of(row.readiness) !== null),
  );
  const withScore = rows.filter((row) => row.readiness.recoveryScore !== null);
  if (withScore.length < MIN_PAIRED_DAYS) return [];

  const scorePairs: Point[] = withScore.map((row) => ({
    x: row.readiness.recoveryScore as number,
    y: row.outcome,
  }));
  const scoreFit = correlation(scorePairs);
  if (!scoreFit) return [];

  const comparison = compareModels(rows, withScore, available);
  const better = comparison && comparison.indexR2 > comparison.scoreR2 ? "index" : "score";

  const detail = {
    outcome: "target RPE minus actual RPE, averaged over the day's prescribed sets",
    confound:
      "the outcome is self-reported by the same athlete who saw the recovery score that morning, which flatters both models equally",
    whoopScoreR: round(scoreFit.r),
    whoopScoreRawP: round(scoreFit.p),
    predictorsUsed: available.map((predictor) => predictor.key),
    predictorsMissing: PREDICTORS.filter(
      (predictor) => !available.some((kept) => kept.key === predictor.key),
    ).map((predictor) => predictor.key),
    heldOut: comparison
      ? {
          trainDays: comparison.trainN,
          testDays: comparison.testN,
          whoopScoreR2: round(comparison.scoreR2),
          personalIndexR2: round(comparison.indexR2),
          winner: better,
          weights: comparison.weights,
        }
      : null,
    strongestSingleInput: strongestInput(rows, available),
  };

  const correlates = `WHOOP's recovery score correlates with how a session goes at r = ${scoreFit.r.toFixed(2)} over ${scoreFit.n} days`;
  const statement = !comparison
    ? `${correlates}; there is not yet enough held-out history to compare it against an index weighted for you.`
    : better === "index"
      ? `A personally weighted index over your raw WHOOP inputs predicts how a session goes better than WHOOP's own recovery score does (${round(comparison.indexR2)} against ${round(comparison.scoreR2)} on weeks the fit did not see), while the score itself correlates at r = ${scoreFit.r.toFixed(2)}.`
      : `${correlates}, and reweighting its raw inputs for you does not beat it on weeks the fit did not see.`;

  return [
    draft({
      key: "whoop.recovery-index",
      family: "whoop",
      tier: 2,
      subject: "WHOOP recovery against how a session goes",
      statement,
      // The value is the score's own correlation whichever model wins, because that
      // is the number the rest of the app has to decide about: whether to keep
      // treating the morning percentage as readiness. Which model predicts better is
      // the finding, and it lives in `detail` where it can carry both figures.
      value: scoreFit.r,
      unit: "r",
      n: scoreFit.n,
      minN: MIN_PAIRED_DAYS,
      ciLow: scoreFit.ciLow,
      ciHigh: scoreFit.ciHigh,
      p: scoreFit.p,
      nullValue: 0,
      detail,
    }),
  ];
}

/**
 * Per-day performance: how much easier the day's prescribed work turned out to be than
 * it was written to be.
 *
 * Signed so that up is better, which is the opposite of the sign
 * `prescriptionCalibration` uses on the same quantity. Deliberate, and the reason both
 * exist: a calibration correction is applied to a prescription, where "over target"
 * has to read positive, and a performance outcome is regressed against readiness,
 * where a reader will assume a positive coefficient means the input helped.
 */
function performanceByDay(inputs: AnalyticsInputs): Map<string, number> {
  const targets = new Map(inputs.prescribedSets.map((set) => [set.id, set]));
  const byDay = new Map<string, number[]>();
  for (const set of inputs.loggedSets) {
    if (set.rpe === null || set.prescribedSetId === null) continue;
    const target = targets.get(set.prescribedSetId);
    if (!target || target.targetRpe === null) continue;
    const held = byDay.get(set.day) ?? [];
    held.push(target.targetRpe - set.rpe);
    byDay.set(set.day, held);
  }
  return new Map([...byDay].map(([day, gaps]) => [day, mean(gaps)]));
}

type Comparison = {
  scoreR2: number;
  indexR2: number;
  trainN: number;
  testN: number;
  weights: { input: string; weight: number }[];
};

/**
 * Fit both models on the earlier days and score both on the later ones.
 *
 * Null when either side cannot be fit, in which case the insight reports the score's
 * correlation alone rather than declaring a winner by default.
 */
function compareModels(
  rows: readonly { day: string; readiness: ReadinessRow; outcome: number }[],
  withScore: readonly { day: string; readiness: ReadinessRow; outcome: number }[],
  available: readonly Predictor[],
): Comparison | null {
  if (available.length === 0) return null;

  // Standardised against the *training* half only. Using the whole series' mean and
  // spread would leak the test period into the fit, which is a small leak and exactly
  // the kind that makes a held-out score stop being held out.
  const split = Math.max(MIN_PAIRED_DAYS - 7, Math.floor(rows.length * (1 - HOLD_OUT_FRACTION)));
  const train = rows.slice(0, split);
  const test = rows.slice(split);
  if (train.length < available.length + 3 || test.length < 4) return null;

  const scales = available.map((predictor) => {
    const values = train.map((row) => predictor.of(row.readiness) as number);
    const spread = sampleSd(values);
    return { centre: mean(values), spread: spread === 0 ? 1 : spread };
  });
  const standardise = (readiness: ReadinessRow) =>
    available.map(
      (predictor, index) =>
        ((predictor.of(readiness) as number) - scales[index].centre) / scales[index].spread,
    );

  const index = ridgeFit(
    train.map((row) => ({ x: standardise(row.readiness), y: row.outcome })),
    { ridge: RIDGE },
  );
  if (!index) return null;
  const indexR2 = predictiveR2(
    test.map((row) => row.outcome),
    test.map((row) => index.at(standardise(row.readiness))),
  );

  const scoreTrain = withScore.filter((row) => row.day <= train[train.length - 1].day);
  const scoreTest = withScore.filter((row) => row.day > train[train.length - 1].day);
  if (scoreTrain.length < 4 || scoreTest.length < 3) return null;
  const line = linearFit(
    scoreTrain.map((row) => ({ x: row.readiness.recoveryScore as number, y: row.outcome })),
  );
  if (!line) return null;
  const scoreR2 = predictiveR2(
    scoreTest.map((row) => row.outcome),
    scoreTest.map((row) => line.at(row.readiness.recoveryScore as number)),
  );

  if (indexR2 === null || scoreR2 === null) return null;
  return {
    scoreR2,
    indexR2,
    trainN: train.length,
    testN: test.length,
    weights: available.map((predictor, position) => ({
      input: predictor.key,
      weight: round(index.coefficients[position + 1]),
    })),
  };
}

/** The single readiness input most strongly associated with the outcome, for the feed. */
function strongestInput(
  rows: readonly { readiness: ReadinessRow; outcome: number }[],
  available: readonly Predictor[],
): { input: string; label: string; r: number; rawP: number } | null {
  let best: { input: string; label: string; r: number; rawP: number } | null = null;
  for (const predictor of available) {
    const fit = correlation(
      rows.map((row) => ({ x: predictor.of(row.readiness) as number, y: row.outcome })),
    );
    if (!fit) continue;
    if (!best || Math.abs(fit.r) > Math.abs(best.r)) {
      best = {
        input: predictor.key,
        label: predictor.label,
        r: round(fit.r),
        rawP: round(fit.p),
      };
    }
  }
  // Uncorrected on purpose, and labelled `rawP` so nothing downstream mistakes it for
  // a tested claim. It is the strongest of six and it belongs in `detail` as a pointer
  // for the next block, not as a finding.
  return best;
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
