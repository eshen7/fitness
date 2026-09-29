import { formatSeconds } from "@/lib/engine/classify";
import type { PlannedSet } from "@/lib/engine/types";
import { couplingClassLabels } from "@/lib/labels";
import { loadFromPercent } from "@/lib/strength/one-rm";
import type { UnitSystem } from "@/lib/taxonomy";
import { displayUnit, round1, toDisplay } from "@/lib/units";

/**
 * A prescription as the owner reads it, shared by Today and the proposal review
 * so the plan under review reads exactly as it will on the day.
 */

/**
 * The prescription in one line: `4 x 8 at 145 kg (85% 1RM), 45 cm box`.
 *
 * Canonical kg and cm unless a unit system is given. A percentage of 1RM is
 * turned into a load from the lift's current max, rounded to what can be put on
 * the bar, because a percentage alone is a prescription nobody can follow; with
 * no max on record it stays a percentage and says a max is what is missing.
 */
export function describePrescription(
  item: PlannedSet,
  unitSystem: UnitSystem = "metric",
  oneRmKg: number | null = null,
) {
  const measure = (value: number, dimension: "mass" | "length") => {
    const shown =
      unitSystem === "metric" ? value : round1(toDisplay(value, dimension, unitSystem));
    return `${shown} ${displayUnit(dimension, unitSystem)}`;
  };
  const volume =
    item.reps != null
      ? `${item.sets} x ${item.reps}`
      : item.holdSeconds != null
        ? `${item.sets} x ${item.holdSeconds}s`
        : `${item.sets} sets`;
  const load = [
    item.loadPctOf1rm == null
      ? null
      : oneRmKg == null
        ? `${item.loadPctOf1rm}% 1RM (needs a max)`
        : `${loadFromPercent(item.loadPctOf1rm, oneRmKg, unitSystem).shown} ${displayUnit("mass", unitSystem)} (${item.loadPctOf1rm}% 1RM)`,
    item.loadKg != null ? measure(item.loadKg, "mass") : null,
    item.boxHeightCm != null ? `${measure(item.boxHeightCm, "length")} box` : null,
    item.targetRpe != null ? `RPE ${item.targetRpe}` : null,
  ].filter(Boolean);
  return load.length ? `${volume} at ${load.join(", ")}` : volume;
}

/** Rest, coupling and tempo: the normalizer's fields, shown but not edited. */
export function prescriptionDetail(item: PlannedSet) {
  return [
    item.restSeconds == null ? null : `${formatSeconds(item.restSeconds)} rest`,
    item.couplingClass ? couplingClassLabels.of(item.couplingClass) : null,
    item.tempo ? `tempo ${item.tempo}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The lifts in a plan with a percentage of 1RM and no max to load it from, in
 * plan order and each once, which is who the "needs a max" note names.
 */
export function liftsNeedingMax(
  items: readonly Pick<PlannedSet, "exerciseId" | "loadPctOf1rm">[],
  maxes: Readonly<Record<string, unknown>>,
): number[] {
  const ids = items
    .filter((item) => item.loadPctOf1rm != null && maxes[String(item.exerciseId)] == null)
    .map((item) => item.exerciseId);
  return [...new Set(ids)];
}
