import { benjaminiHochberg, correlation, type Point } from "./stats";

/**
 * What an insight is, and the gate that decides whether it may be asserted.
 *
 * Every statement this layer produces is a claim about one person made from that
 * person's own short, noisy, autocorrelated history. The honest handling of that
 * is not to compute fewer things, it is to compute them all and then be strict
 * about which ones are allowed to speak. So an `Insight` is never just a number:
 * it carries its n, its interval, its raw p, and the false-discovery-corrected p,
 * and `assertable` is false until all four say the same thing.
 *
 * `assertable` is load-bearing in two places and they are the reason the gate is
 * one function rather than a convention:
 *
 * - **The prompt.** `lib/ai/context.ts` puts assertable insights in the cached
 *   stable prefix. An unproven number there does not merely mislead the owner, it
 *   gets baked into the programming and then justified back to them in the
 *   generator's own rationale, which is the most convincing possible form of a
 *   made-up finding.
 * - **The UI.** A non-assertable insight shows its progress toward being one - the
 *   n it has and the n it needs - and never its value. "Your patellar ceiling is
 *   212 contacts, n = 3" is a sentence the owner will remember long after the
 *   caveat, so the number simply is not rendered.
 *
 * Three independent conditions, each of which kills a distinct failure mode:
 *
 * 1. **n.** Declared per insight, because the minimum useful sample is a property
 *    of the question. Four test sittings is plenty for a noise floor and nowhere
 *    near enough for a load ceiling.
 * 2. **The corrected p**, for any insight that tests an effect. Benjamini-Hochberg
 *    across the whole suite, not per area: the suite computes a few dozen
 *    statements from one history, and at the conventional threshold one or two of
 *    them look real purely because several were looked at.
 * 3. **The interval excluding the null.** Redundant with the p for a simple
 *    two-sided test and not redundant at all once the null is something other than
 *    zero - a workload ratio's null is 1, an acceptance rate's is whatever the
 *    owner would consider normal - which is exactly where a p value stops being
 *    the right question.
 */

/** Only for grouping on screen. The correction is applied across all of them. */
export const INSIGHT_FAMILIES = [
  "load",
  "whoop",
  "jump",
  "strength",
  "plyometrics",
  "programming",
  "nutrition",
] as const;
export type InsightFamily = (typeof INSIGHT_FAMILIES)[number];

export type InsightTier = 1 | 2 | 3;

export type Insight = {
  /** Stable, so a recompute replaces the row rather than appending to it. */
  key: string;
  family: InsightFamily;
  tier: InsightTier;
  /**
   * What the insight is about, as a noun phrase with no number in it.
   *
   * Exists because a withheld insight still has to be nameable. The UI may not
   * render `statement` until the gate passes, since the number is inside it, and
   * "one statement is still accumulating" is not something anyone can act on. So
   * every insight carries a label that is safe to show at any n, and the `key` -
   * which carries exercise ids and weekday numbers - stays out of the UI.
   */
  subject: string;
  /**
   * The claim as one sentence, with its number already in it.
   *
   * Written out here rather than assembled by the reader because this string is
   * what the model is shown and what the owner reads, and two renderings of the
   * same insight would eventually disagree.
   */
  statement: string;
  value: number;
  unit: string;
  n: number;
  /** The n this insight needs. Kept on the insight so the UI can show the shortfall. */
  minN: number;
  ciLow: number | null;
  ciHigh: number | null;
  /** Raw two-sided p, or null for a descriptive level with no effect to test. */
  p: number | null;
  /** Filled by `gateSuite`. Null when there was no raw p to correct. */
  pAdjusted: number | null;
  /**
   * The value that would mean "nothing is going on", which the interval has to
   * exclude. Null for a descriptive level - a noise floor, a maintenance calorie
   * estimate - where there is no such value and the interval is reported for
   * information rather than as a test.
   */
  nullValue: number | null;
  assertable: boolean;
  /** Why it is not assertable yet, for the UI. Null once it is. */
  blockedBy: string | null;
  /** The working behind it: lags examined, held-out check, per-item breakdown. */
  detail: Record<string, unknown> | null;
};

/**
 * The false discovery rate the suite runs at.
 *
 * Looser than the 0.05 that would be conventional for a single test, which is
 * deliberate: the decisions downstream are "shade this chart" and "mention this to
 * the generator", not "publish". A rate that admits one bad statement in ten is
 * the right cost of not missing a real tendon-load ceiling for another two blocks.
 */
export const FALSE_DISCOVERY_RATE = 0.1;

/** The n an insight needs when it has not said otherwise. */
export const DEFAULT_MIN_N = 8;

export type InsightDraft = Omit<
  Insight,
  "minN" | "ciLow" | "ciHigh" | "p" | "pAdjusted" | "nullValue" | "assertable" | "blockedBy" | "detail"
> &
  Partial<Pick<Insight, "minN" | "ciLow" | "ciHigh" | "p" | "nullValue" | "detail">>;

/**
 * One insight, ungated. `pAdjusted` and `assertable` are placeholders until
 * `gateSuite` has seen the whole suite, because neither can be decided from one
 * insight in isolation, and an insight that skipped the gate would be indexed as
 * assertable by accident rather than on purpose.
 */
export function draft(input: InsightDraft): Insight {
  return {
    ...input,
    minN: input.minN ?? DEFAULT_MIN_N,
    ciLow: input.ciLow ?? null,
    ciHigh: input.ciHigh ?? null,
    p: input.p ?? null,
    pAdjusted: null,
    nullValue: input.nullValue ?? null,
    assertable: false,
    blockedBy: "not yet gated",
    detail: input.detail ?? null,
  };
}

/**
 * The gate, applied to the whole suite at once.
 *
 * Has to be the whole suite: the correction denominator is how many statements
 * were computed, so gating one insight at a time would silently use a denominator
 * of one and let everything through.
 */
export function gateSuite(
  insights: readonly Insight[],
  options: { falseDiscoveryRate?: number } = {},
): Insight[] {
  const rate = options.falseDiscoveryRate ?? FALSE_DISCOVERY_RATE;
  const tested = insights.filter((insight) => insight.p !== null);
  const adjusted = benjaminiHochberg(tested.map((insight) => insight.p as number));
  const byKey = new Map(tested.map((insight, index) => [insight.key, adjusted[index]]));

  return insights.map((insight) => {
    const pAdjusted = insight.p === null ? null : (byKey.get(insight.key) ?? 1);
    const blockedBy = firstFailure({ ...insight, pAdjusted, rate });
    return { ...insight, pAdjusted, assertable: blockedBy === null, blockedBy };
  });
}

function firstFailure(input: {
  n: number;
  minN: number;
  pAdjusted: number | null;
  rate: number;
  ciLow: number | null;
  ciHigh: number | null;
  nullValue: number | null;
}): string | null {
  if (input.n < input.minN) {
    return `${input.n} of the ${input.minN} observations it needs`;
  }
  if (input.pAdjusted !== null && input.pAdjusted > input.rate) {
    return `not distinguishable from chance once the whole suite is corrected for (q = ${input.pAdjusted.toFixed(3)})`;
  }
  if (input.nullValue !== null) {
    if (input.ciLow === null || input.ciHigh === null) {
      return "no interval, so the effect cannot be separated from none";
    }
    if (input.ciLow <= input.nullValue && input.ciHigh >= input.nullValue) {
      return `its interval still contains ${input.nullValue}`;
    }
  }
  return null;
}

/** The ones allowed into the prompt and onto the screen as numbers. */
export function assertable(insights: readonly Insight[]): Insight[] {
  return insights.filter((insight) => insight.assertable);
}

// -----------------------------------------------------------------------------
// Held-out validation
// -----------------------------------------------------------------------------

export type HoldOut = {
  /** Correlation over the earlier part of the series. */
  trainR: number;
  /** The same correlation recomputed on weeks the fit never saw. */
  testR: number;
  trainN: number;
  testN: number;
  /** False when the later weeks reverse the sign, which is the failure worth catching. */
  holds: boolean;
};

/**
 * Refits a correlation on the last slice of a chronologically ordered series and
 * asks whether it still points the same way.
 *
 * This is the cheap half of the plan's "validation on held-out later weeks", and
 * the cheap half is the half that catches the real failure. An insight fit over a
 * whole history is fit over several blocks of a periodised program, and a
 * relationship that only existed during one accumulation phase will happily show a
 * significant p over the pooled data. Splitting by time and checking the sign
 * survives is what distinguishes a standing relationship from an artefact of one
 * block.
 *
 * `pairs` must already be in time order. Null when either side of the split is too
 * small to correlate, which is the common early case and is not a failure - it is
 * reported as "no held-out check yet" rather than as a check that failed.
 */
export function holdOut(
  pairs: readonly Point[],
  options: { fraction?: number } = {},
): HoldOut | null {
  const fraction = options.fraction ?? 0.3;
  const split = Math.floor(pairs.length * (1 - fraction));
  const train = correlation(pairs.slice(0, split));
  const test = correlation(pairs.slice(split));
  if (!train || !test) return null;
  return {
    trainR: train.r,
    testR: test.r,
    trainN: train.n,
    testN: test.n,
    holds: Math.sign(train.r) === Math.sign(test.r),
  };
}
