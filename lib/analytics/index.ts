import type { Db } from "@/lib/db";
import { assertable, type Insight } from "./insight";
import { saveInsights } from "./persist";
import { loadAnalyticsInputs } from "./queries";
import { computeInsights, rank } from "./suite";

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
  /** Every insight the suite produced, gated and ranked. */
  insights: Insight[];
  /** How many cleared the gate, which is how many the owner will actually see. */
  assertableCount: number;
  /** Producers that threw, by index into `PRODUCERS`. Empty on a healthy run. */
  failures: number[];
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
 */
export async function recomputeInsights(
  options: { asOf?: string; windowDays?: number; db?: Db } = {},
): Promise<Recompute> {
  const inputs = await loadAnalyticsInputs(options);
  const failures: number[] = [];
  const insights = rank(
    computeInsights(inputs, {
      // A producer that throws costs its own statements and nothing else. The
      // alternative - letting one bad division take down the run - would mean the
      // screen went blank rather than showing one fewer insight, and the nightly job
      // would stop writing anything at all until someone noticed.
      onError: (error, index) => {
        failures.push(index);
        console.error(`analytics producer ${index} failed`, error);
      },
    }),
  );

  await saveInsights(insights, { db: options.db });

  return {
    insights,
    assertableCount: assertable(insights).length,
    failures,
  };
}
