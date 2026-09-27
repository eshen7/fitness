import type { Db } from "@/lib/db";
import { assertable, type Insight } from "./insight";
import { saveInsights } from "./persist";
import { loadAnalyticsInputs } from "./queries";
import { computeInsights, IncompleteSuiteError, rank } from "./suite";

/**
 * The analytics layer: statistics over the owner's own history, no model involved.
 *
 * Three stages that stay strictly apart, because each of them fails differently.
 * `queries.ts` reads and converts and decides nothing. `suite.ts` and the producers
 * beside it are pure functions of one `AnalyticsInputs` value, which is what lets the
 * whole suite be driven over a fixture with no database. `persist.ts` writes the
 * result. Nothing in the middle stage may reach a connection, and nothing in the
 * outer two may decide what a number means.
 *
 * Everything here computes; nothing here asserts. `insight.ts` owns the gate, and
 * `assertable` is the only thing any caller - the prompt, the UI - should use to
 * decide whether a number may be shown.
 */

export * from "./inputs";
export * from "./insight";
export * from "./persist";
export * from "./queries";
export * from "./suite";

export type Recompute = {
  /** Every insight the suite produced, gated and ranked. Empty when it was refused. */
  insights: Insight[];
  /** How many cleared the gate, which is how many the owner will actually see. */
  assertableCount: number;
  /** Producers that threw, by name. Empty on a healthy run. */
  failures: string[];
  /** Whether the stored suite was replaced. False keeps the last whole one. */
  saved: boolean;
};

/**
 * Recompute the whole suite for a day and replace what is stored.
 *
 * The whole suite every time rather than the insights whose inputs changed, and the
 * reason is the correction rather than simplicity: the Benjamini-Hochberg denominator
 * is how many statements were computed together, so a partial recompute would mix
 * fresh q values with stale ones and quietly make the untouched insights easier to
 * assert than they have any right to be. This is a few hundred rows of arithmetic on
 * one athlete's history, so there is nothing to save by being clever.
 *
 * For the same reason a suite with a failed producer is not written at all. The stored
 * suite stays as the last whole one, and the failure is logged and returned by name.
 */
export async function recomputeInsights(
  options: { asOf?: string; windowDays?: number; db?: Db } = {},
): Promise<Recompute> {
  const inputs = await loadAnalyticsInputs(options);
  let insights: Insight[];
  try {
    insights = rank(computeInsights(inputs));
  } catch (error) {
    if (!(error instanceof IncompleteSuiteError)) throw error;
    for (const failure of error.failures) {
      console.error(`analytics producer ${failure.producer} failed`, failure.error);
    }
    return {
      insights: [],
      assertableCount: 0,
      failures: error.failures.map((failure) => failure.producer),
      saved: false,
    };
  }

  await saveInsights(insights, { db: options.db });

  return {
    insights,
    assertableCount: assertable(insights).length,
    failures: [],
    saved: true,
  };
}
