import { formatSeconds } from "@/lib/engine/classify";
import type { PlannedSet } from "@/lib/engine/types";
import { couplingClassLabels } from "@/lib/labels";
import type { UnitSystem } from "@/lib/taxonomy";
import { displayUnit, round1, toDisplay } from "@/lib/units";

/**
 * A prescription as the owner reads it, shared by Today and the proposal review
 * so the plan under review reads exactly as it will on the day.
 */

/**
 * The prescription in one line: `4 x 8 at 85% 1RM, 45 cm box`.
 *
 * Canonical kg and cm unless a unit system is given, which the set logger passes
 * so the target reads in the units its fields are typed in.
 */
export function describePrescription(
  item: PlannedSet,
  unitSystem: UnitSystem = "metric",
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
    item.loadPctOf1rm != null ? `${item.loadPctOf1rm}% 1RM` : null,
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
