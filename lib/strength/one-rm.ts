import { addDays } from "@/lib/days";
import type { ForceVelocity, UnitSystem } from "@/lib/taxonomy";
import { toCanonical, toDisplay } from "@/lib/units";

/**
 * One-rep maxes: the estimate from logged sets, the max the owner actually
 * tested, which of the two a prescription is loaded from, and the load a
 * percentage of it comes to.
 *
 * Estimates are derived from `logged_sets` whenever they are read rather than
 * stored, so a set deleted or retyped can never leave a stale estimate behind,
 * and the insight suite, the Progress chart and every prescription read the same
 * number from the same rule. Only a tested max is a row of its own, because it is
 * a measurement the log has no other record of.
 *
 * Pure and client-safe, so the set logger prefills with the same arithmetic on a
 * phone with no signal.
 */

/**
 * Above this many reps an estimate stops being an estimate.
 *
 * Every rep-max formula is fit near the top of the curve, and a set of fifteen is
 * limited by how long the muscle can keep going rather than by how much force it
 * can make. Including those sets does not add data to a strength trend, it adds a
 * different measurement wearing the same units.
 */
export const MAX_REPS_FOR_ONE_RM = 10;

/**
 * Epley. One formula rather than an average of several, because the absolute
 * number matters far less here than its comparability over time: every insight
 * built on this reads a *trend*, and a systematic bias cancels in a slope while a
 * formula that changed between months would not.
 */
export function epley(loadKg: number, reps: number): number {
  return loadKg * (1 + reps / 30);
}

/**
 * The exercises a one-rep max means something for. Jumps and throws carry load
 * and reps too, and a one-rep max of a depth jump is not a quantity, so only the
 * slow strength end of the curve is estimated.
 */
export const ONE_RM_FORCE_VELOCITY = "max_strength" satisfies ForceVelocity;

export function estimatesOneRm(exercise: { forceVelocity: ForceVelocity }) {
  return exercise.forceVelocity === ONE_RM_FORCE_VELOCITY;
}

/**
 * The estimate one logged set supports, or null for a set that supports none: no
 * load, no reps, or more reps than the formula is fit for. Only for an exercise
 * `estimatesOneRm` accepts.
 */
export function estimateOneRmKg(set: {
  loadKg: number | null;
  reps: number | null;
}): number | null {
  if (set.loadKg === null || set.loadKg <= 0) return null;
  if (set.reps === null || set.reps < 1 || set.reps > MAX_REPS_FOR_ONE_RM) return null;
  return epley(set.loadKg, set.reps);
}

/**
 * How far back an estimate still describes the lifter.
 *
 * Twelve weeks is three mesocycles. A lift not trained for longer than that has
 * detrained by an amount nobody can put a number on, and loading a prescription
 * from last spring's best set is how a first session back gets missed. A tested
 * max is not aged out: the owner entered it on purpose and can enter another.
 */
export const ESTIMATE_WINDOW_DAYS = 84;

export type OneRmSource = "tested" | "estimated";

/** One day's reading for one lift: a tested max, or that day's best estimate. */
export type OneRmReading = { day: string; kg: number; source: OneRmSource };

export type CurrentOneRm = OneRmReading;

/**
 * The max a prescription is loaded from.
 *
 * A tested max takes precedence over the estimates. Estimates come from work
 * sets, and a work set stops short of failure by design, so Epley reads a heavy
 * triple at RPE 8 as a lower max than the lifter has: letting the newest estimate
 * win would walk the max down every week the plan went as intended. An estimate
 * replaces the tested max only when it is from a later day and higher, which is a
 * set that could not have been lifted at the tested max. With no tested max the
 * best estimate inside the window is used, the best rather than the latest for the
 * same reason: back-off days are in the log too.
 */
export function currentOneRm(
  readings: readonly OneRmReading[],
  today: string,
): CurrentOneRm | null {
  let tested: OneRmReading | null = null;
  for (const reading of readings) {
    if (reading.source !== "tested") continue;
    if (!tested || reading.day >= tested.day) tested = reading;
  }

  const since = addDays(today, -ESTIMATE_WINDOW_DAYS);
  let best: OneRmReading | null = null;
  for (const reading of readings) {
    if (reading.source !== "estimated" || reading.day < since || reading.day > today) continue;
    if (tested && reading.day <= tested.day) continue;
    if (!best || reading.kg > best.kg) best = reading;
  }

  if (tested && (!best || best.kg <= tested.kg)) return tested;
  return best;
}

/**
 * The smallest jump in load a gym can make: a pair of 2.5 lb plates, or a pair
 * of 1.25 kg ones. A load finer than this is one nobody can put on the bar.
 */
export const LOAD_INCREMENT: Record<UnitSystem, number> = { imperial: 5, metric: 2.5 };

/**
 * A percentage of a max as a load that can actually be loaded, in the owner's
 * units: `shown` is the number to put on the bar and `kg` is the same load stored
 * canonically, so a set logged at the prefill round-trips to exactly this.
 */
export function loadFromPercent(
  pct: number,
  oneRmKg: number,
  unitSystem: UnitSystem,
): { shown: number; kg: number } {
  const increment = LOAD_INCREMENT[unitSystem];
  const exact = toDisplay((oneRmKg * pct) / 100, "mass", unitSystem);
  const shown = Math.round(exact / increment) * increment;
  return { shown, kg: toCanonical(shown, "mass", unitSystem) };
}

/**
 * Each lift's best estimate per day, from sets of lifts `estimatesOneRm` accepts.
 *
 * The daily maximum rather than the mean of the day's sets: back-off sets and
 * warm-ups are in the log too, and averaging them in would make a session's
 * estimate a function of how the session was structured rather than of how strong
 * the lifter was.
 */
export function dailyBestEstimates(
  sets: readonly {
    day: string;
    exerciseId: number;
    loadKg: number | null;
    reps: number | null;
  }[],
): Map<number, OneRmReading[]> {
  const best = new Map<number, Map<string, number>>();
  for (const set of sets) {
    const kg = estimateOneRmKg(set);
    if (kg === null) continue;
    const days = best.get(set.exerciseId) ?? new Map<string, number>();
    days.set(set.day, Math.max(days.get(set.day) ?? 0, kg));
    best.set(set.exerciseId, days);
  }
  return new Map(
    [...best].map(([exerciseId, days]) => [
      exerciseId,
      [...days]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, kg]): OneRmReading => ({ day, kg, source: "estimated" })),
    ]),
  );
}

/**
 * One lift's readings, one per day, in day order. A tested max owns the day it
 * was tested on: the warm-ups and openers before an attempt are in the log as
 * sets, and none of them is a better answer than the attempt. Of two tested maxes
 * on one day the later in `readings` wins, because the second is the owner
 * correcting the first; of two estimates the higher does.
 */
export function oneRmHistory(readings: readonly OneRmReading[]): OneRmReading[] {
  const byDay = new Map<string, OneRmReading>();
  for (const reading of readings) {
    const held = byDay.get(reading.day);
    const wins =
      !held ||
      reading.source === "tested" ||
      (held.source === "estimated" && reading.kg > held.kg);
    if (wins) byDay.set(reading.day, reading);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}
