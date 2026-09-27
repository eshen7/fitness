import { gateSuite, INSIGHT_FAMILIES, type Insight } from "./insight";
import type { AnalyticsInputs } from "./inputs";
import {
  asymmetryIndex,
  bestVersusMeanDrift,
  noiseFloor,
} from "./jump";
import {
  externalLoadCrossCheck,
  trainingMonotony,
  workloadRatios,
} from "./load";
import { bodyweightTrend, maintenanceCalories } from "./nutrition";
import {
  depthJumpVertex,
  painLag,
  protocolReadiness,
  tendonLoadCeiling,
} from "./plyo";
import {
  generationQuality,
  prescriptionCalibration,
  scheduleReality,
} from "./programming";
import {
  oneRmTrends,
  relativeStrengthTrends,
  transferCorrelations,
} from "./strength";
import { recoveryIndex } from "./whoop";

/**
 * The whole insight suite, as one pure function of one input value.
 *
 * The list being in one place is not organisational tidiness, it is what makes the
 * false-discovery correction correct. `gateSuite` divides by how many statements were
 * computed, so an insight produced somewhere else and gated on its own would be
 * corrected against a denominator of one and would assert itself on a p of 0.09. The
 * rule that follows: a new producer is added to `PRODUCERS` and reached no other way.
 *
 * Which means adding an insight makes every existing insight slightly harder to
 * assert, and that is the intended pressure. A suite of two hundred statements over
 * one athlete's twenty weeks would have nothing to say at any honest threshold, so the
 * cost of a new statement being visible to the ones already there is the mechanism
 * keeping the suite the size the data can support.
 */

/**
 * Every producer, in the order their output is presented.
 *
 * A producer takes the whole input object and returns zero or more insights, and
 * returning zero is the normal early state rather than an error. None of them throws:
 * an insight that cannot be computed from the history available is absent, which is
 * what lets the first run against a nearly empty database return a short list instead
 * of a stack trace.
 */
export const PRODUCERS: readonly ((inputs: AnalyticsInputs) => Insight[])[] = [
  // Load first, because the ratios are what the owner looks at before deciding
  // whether to train today, and because they need the least history.
  workloadRatios,
  trainingMonotony,
  externalLoadCrossCheck,
  recoveryIndex,
  // Then the measurements, then what they imply.
  noiseFloor,
  bestVersusMeanDrift,
  asymmetryIndex,
  oneRmTrends,
  relativeStrengthTrends,
  transferCorrelations,
  // Tendon work last of the analyses but first in the UI's own ordering, which
  // `rank` handles: it is the most consequential and the slowest to earn its n.
  depthJumpVertex,
  protocolReadiness,
  painLag,
  tendonLoadCeiling,
  prescriptionCalibration,
  scheduleReality,
  generationQuality,
  bodyweightTrend,
  maintenanceCalories,
];

/**
 * Compute every insight and gate the result as one suite.
 *
 * A producer that throws is a bug, and it is a bug that would otherwise take the
 * whole nightly recompute with it and leave the owner's insight list frozen at
 * whatever it held a week ago with no sign anything was wrong. So each is isolated and
 * a thrown error costs that producer's insights and nothing else. `onError` exists so
 * the route can log it; the default swallows, because the alternative in a page render
 * is a blank screen where a slightly shorter list would do.
 */
export function computeInsights(
  inputs: AnalyticsInputs,
  options: { onError?: (error: unknown, index: number) => void } = {},
): Insight[] {
  const drafted: Insight[] = [];
  for (const [index, producer] of PRODUCERS.entries()) {
    try {
      drafted.push(...producer(inputs));
    } catch (error) {
      options.onError?.(error, index);
    }
  }
  return gateSuite(deduplicate(drafted));
}

/**
 * Last key wins, and a duplicate key is dropped rather than tolerated.
 *
 * `derived_insights.key` is unique and `gateSuite` maps corrections back by key, so
 * two insights sharing one would silently receive each other's adjusted p. Since keys
 * are interpolated from exercise and site ids, that collision is one typo away.
 */
function deduplicate(insights: readonly Insight[]): Insight[] {
  const byKey = new Map<string, Insight>();
  for (const insight of insights) byKey.set(insight.key, insight);
  return [...byKey.values()];
}

const FAMILY_ORDER = new Map(INSIGHT_FAMILIES.map((family, index) => [family, index]));

/**
 * The order the owner sees them in: assertable first, then by family, then by key.
 *
 * Assertable first because the rest are progress bars, and a screen that opens on six
 * things the app cannot yet tell you reads as a broken feature rather than as an
 * honest one. Key last so the order is stable between recomputes - a list that
 * reshuffles whenever a p value moves by a thousandth is unreadable even when every
 * row in it is right.
 */
export function rank(insights: readonly Insight[]): Insight[] {
  return [...insights].sort((a, b) => {
    if (a.assertable !== b.assertable) return a.assertable ? -1 : 1;
    const family = (FAMILY_ORDER.get(a.family) ?? 0) - (FAMILY_ORDER.get(b.family) ?? 0);
    if (family !== 0) return family;
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.key.localeCompare(b.key);
  });
}
