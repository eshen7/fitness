import { formatSeconds } from "@/lib/engine/classify";
import type { PlannedSet } from "@/lib/engine/types";
import { couplingClassLabels } from "@/lib/labels";
import { estimatesOneRm, loadFromPercent } from "@/lib/strength/one-rm";
import type { ForceVelocity, UnitSystem } from "@/lib/taxonomy";
import { displayUnit, round1, toDisplay } from "@/lib/units";

/**
 * A prescription as the owner reads it, shared by Today and the proposal review
 * so the plan under review reads exactly as it will on the day.
 */

/**
 * Each lift's max as a prescription reads it, keyed by exercise id as a string:
 * the max in kilograms, or null for a lift that can hold a max and has none yet.
 * A lift `estimatesOneRm` rejects is absent, because no max can ever be entered
 * for it and saying one is needed would point at a page with nowhere to enter it.
 */
export type PrescriptionMaxes = Readonly<Record<string, number | null>>;

export function prescriptionMaxes(
  exercises: Iterable<{ id: number; forceVelocity: ForceVelocity }>,
  current: Readonly<Record<string, { kg: number }>>,
): Record<string, number | null> {
  const maxes: Record<string, number | null> = {};
  for (const exercise of exercises) {
    if (!estimatesOneRm(exercise)) continue;
    maxes[String(exercise.id)] = current[String(exercise.id)]?.kg ?? null;
  }
  return maxes;
}

/**
 * The prescription in one line: `4 x 8 at 145 kg (85% 1RM), 45 cm box`.
 *
 * Canonical kg and cm unless a unit system is given. A percentage of 1RM is
 * turned into a load from the lift's current max, rounded to what can be put on
 * the bar, because a percentage alone is a prescription nobody can follow. With
 * `oneRmKg` null, a lift with no max on record, it stays a percentage and says a
 * max is what is missing; with it undefined, a lift that cannot hold a max, it
 * stays a bare percentage.
 */
export function describePrescription(
  item: PlannedSet,
  unitSystem: UnitSystem = "metric",
  oneRmKg?: number | null,
) {
  const volume = prescriptionVolume(item);
  const load = prescriptionLoad(item, unitSystem, oneRmKg);
  return load ? `${volume} at ${load}` : volume;
}

/**
 * The volume half of `describePrescription` - `4 x 8`, `3 x 45s`, `3 sets` -
 * which the screens set large, because it is the part read from across a rack.
 */
export function prescriptionVolume(item: PlannedSet) {
  return item.reps != null
    ? `${item.sets} x ${item.reps}`
    : item.holdSeconds != null
      ? `${item.sets} x ${item.holdSeconds}s`
      : `${item.sets} sets`;
}

/**
 * The load half of `describePrescription` - `145 kg (85% 1RM), RPE 8` - or null
 * for a prescription that is volume alone. Same rules for a missing max.
 */
export function prescriptionLoad(
  item: PlannedSet,
  unitSystem: UnitSystem = "metric",
  oneRmKg?: number | null,
): string | null {
  const measure = (value: number, dimension: "mass" | "length") => {
    const shown =
      unitSystem === "metric" ? value : round1(toDisplay(value, dimension, unitSystem));
    return `${shown} ${displayUnit(dimension, unitSystem)}`;
  };
  const load = [
    item.loadPctOf1rm == null
      ? null
      : oneRmKg === undefined
        ? `${item.loadPctOf1rm}% 1RM`
        : oneRmKg === null
          ? `${item.loadPctOf1rm}% 1RM (needs a max)`
          : `${loadFromPercent(item.loadPctOf1rm, oneRmKg, unitSystem).shown} ${displayUnit("mass", unitSystem)} (${item.loadPctOf1rm}% 1RM)`,
    item.loadKg != null ? measure(item.loadKg, "mass") : null,
    item.boxHeightCm != null ? `${measure(item.boxHeightCm, "length")} box` : null,
    item.targetRpe != null ? `RPE ${item.targetRpe}` : null,
  ].filter(Boolean);
  return load.length ? load.join(", ") : null;
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
 * plan order and each once, which is who the "needs a max" note names. A lift
 * that cannot hold a max is not one of them.
 */
export function liftsNeedingMax(
  items: readonly Pick<PlannedSet, "exerciseId" | "loadPctOf1rm">[],
  maxes: PrescriptionMaxes,
): number[] {
  const ids = items
    .filter((item) => item.loadPctOf1rm != null && maxes[String(item.exerciseId)] === null)
    .map((item) => item.exerciseId);
  return [...new Set(ids)];
}
