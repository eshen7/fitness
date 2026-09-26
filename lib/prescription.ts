import { formatSeconds } from "@/lib/engine/classify";
import type { PlannedSet } from "@/lib/engine/types";
import { couplingClassLabels } from "@/lib/labels";

/**
 * A prescription as the owner reads it, shared by Today and the proposal review
 * so the plan under review reads exactly as it will on the day.
 */

/** The prescription in one line: `4 x 8 at 85% 1RM, 45 cm box`. */
export function describePrescription(item: PlannedSet) {
  const volume =
    item.reps != null
      ? `${item.sets} x ${item.reps}`
      : item.holdSeconds != null
        ? `${item.sets} x ${item.holdSeconds}s`
        : `${item.sets} sets`;
  const load = [
    item.loadPctOf1rm != null ? `${item.loadPctOf1rm}% 1RM` : null,
    item.loadKg != null ? `${item.loadKg} kg` : null,
    item.boxHeightCm != null ? `${item.boxHeightCm} cm box` : null,
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
