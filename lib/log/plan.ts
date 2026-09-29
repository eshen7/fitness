import type { PlannedSet } from "@/lib/engine/types";
import type { LoggedSetInput } from "@/lib/log/schemas";
import { loadFromPercent } from "@/lib/strength/one-rm";
import type { UnitSystem } from "@/lib/taxonomy";
import { round1, toCanonical, toDisplay } from "@/lib/units";

/**
 * The set logger's reading of the session plan.
 *
 * A prescription row is one line of the plan, `4 x 5 at RPE 8`, and every logged
 * set that carries out one of its four sets names that row. The link is the whole
 * point: prescribed-against-logged RPE calibration, the recovery-to-performance
 * fit and the reflection's plan comparison all match on it, and a set with no link
 * reads to every one of them as off-plan work.
 *
 * Pure and client-safe, so the decisions the logger makes on a phone with no
 * signal are the same ones the tests pin.
 */

/** One prescription row as the logger shows it, in session order. */
export type PlanLine = PlannedSet & {
  /** The `prescribed_sets` row, which is what a logged set links to. */
  id: number;
  blockLabel: string;
  cueOverride: string | null;
};

/** Enough of a logged or queued set to count it against the plan. */
export type PlanEntry = { prescribedSetId: number | null };

export type LineProgress = { line: PlanLine; done: number };

/** What a set was last logged at, for prefilling the next one. */
export type LoggerLastSet = {
  reps: number | null;
  loadKg: number | null;
  holdSeconds: number | null;
  boxHeightCm: number | null;
  rpe: number | null;
};

/** What makes two lines the same work across weeks, whichever row each one is. */
export type PrescriptionShape = Pick<
  PlannedSet,
  "reps" | "holdSeconds" | "loadPctOf1rm" | "targetRpe" | "boxHeightCm"
>;

/**
 * A set from an earlier session, with the shape of the line it carried out, or
 * null for one logged off plan. The latest of each shape, newest first.
 */
export type LoggerOuting = LoggerLastSet & { shape: PrescriptionShape | null };

function sameShape(a: PrescriptionShape, b: PrescriptionShape) {
  return (
    a.reps === b.reps &&
    a.holdSeconds === b.holdSeconds &&
    a.loadPctOf1rm === b.loadPctOf1rm &&
    a.targetRpe === b.targetRpe &&
    a.boxHeightCm === b.boxHeightCm
  );
}

/**
 * The earlier outing a new set may borrow from.
 *
 * For a planned line only a set that carried out a line of the same shape counts:
 * last week's back-off is not this week's top set, and borrowing its load would
 * open the top set at the back-off weight. With no such set there is nothing to
 * borrow. An unplanned exercise has no shape to match, so its latest set does.
 */
export function lastOutingFor(
  line: PlanLine | null,
  outings: readonly LoggerOuting[],
): LoggerOuting | undefined {
  if (line === null) return outings[0];
  return outings.find((outing) => outing.shape !== null && sameShape(outing.shape, line));
}

/** The form as typed, in display units. */
export type LoggerFields = {
  reps: string;
  load: string;
  hold: string;
  box: string;
  rpe: string;
  quality: number | null;
};

export const EMPTY_FIELDS: LoggerFields = {
  reps: "",
  load: "",
  hold: "",
  box: "",
  rpe: "",
  quality: null,
};

/** Every line with the sets already logged against it, server and queue alike. */
export function planProgress(
  lines: readonly PlanLine[],
  entries: readonly PlanEntry[],
): LineProgress[] {
  const counts = new Map<number, number>();
  for (const entry of entries) {
    if (entry.prescribedSetId === null) continue;
    counts.set(entry.prescribedSetId, (counts.get(entry.prescribedSetId) ?? 0) + 1);
  }
  return lines.map((line) => ({ line, done: counts.get(line.id) ?? 0 }));
}

/** The first line with sets still to do, which is where the logger opens. */
export function nextLine(progress: readonly LineProgress[]): PlanLine | null {
  return progress.find(({ line, done }) => done < line.sets)?.line ?? null;
}

/**
 * The prescription a set logged now carries out, or null for an extra one.
 *
 * A fifth set on a `4 x 5` line is real work and is logged, but it is not one of
 * the four the plan asked for: linking it would count it toward a target it went
 * past and blur the calibration with a set nobody prescribed.
 */
export function carriesOut(
  progress: readonly LineProgress[],
  lineId: number | null,
): number | null {
  if (lineId === null) return null;
  const found = progress.find(({ line }) => line.id === lineId);
  return found && found.done < found.line.sets ? found.line.id : null;
}

/**
 * The fields a new set opens with.
 *
 * What the plan fixes, the plan fills: reps and hold time come from the line.
 * Load and drop height come first from this session's last set carrying out the
 * same line, because a load adjusted after the first set is the athlete
 * calibrating and retyping it every set is how sets stop being logged; then from
 * the line, a percentage of 1RM becoming a load from the lift's current max
 * rounded to what can be loaded; then from `lastOutingFor`. Only the same line
 * counts: a back-off line of the exercise has a load of its own, and opening it
 * at the top set's would log the back-off at the wrong weight. An unplanned exercise carries the
 * session's last set of it. With no max on record a percentage has nothing
 * honest to convert it with, so the field falls back to what was actually lifted
 * last time on a line of the same shape, and stays blank when there is none.
 *
 * RPE is never filled. It is how the set that just happened felt, and a
 * prefilled one would be a guess dressed up as a measurement.
 */
export function prefill({
  line,
  sessionSets,
  outings,
  unitSystem,
  oneRmKg = null,
}: {
  line: PlanLine | null;
  /** This session's sets of the exercise, in order. */
  sessionSets: readonly (LoggerLastSet & PlanEntry)[];
  /** The exercise's earlier outings, from `lastSetsByExercise`. */
  outings: readonly LoggerOuting[];
  unitSystem: UnitSystem;
  /** The exercise's current max, from `currentOneRms`, or null with none on record. */
  oneRmKg?: number | null;
}): LoggerFields {
  const inSession = (
    line === null
      ? sessionSets
      : sessionSets.filter((set) => set.prescribedSetId === line.id)
  ).at(-1);
  const lastOuting = lastOutingFor(line, outings);
  const previous = inSession ?? lastOuting;
  const reps = line?.reps ?? previous?.reps;
  const hold = line?.holdSeconds ?? previous?.holdSeconds;
  const planned =
    line?.loadKg ??
    (line?.loadPctOf1rm != null && oneRmKg != null
      ? loadFromPercent(line.loadPctOf1rm, oneRmKg, unitSystem).kg
      : null);
  const loadKg = inSession?.loadKg ?? planned ?? lastOuting?.loadKg;
  const boxCm = inSession?.boxHeightCm ?? line?.boxHeightCm ?? lastOuting?.boxHeightCm;
  return {
    reps: reps?.toString() ?? "",
    load: loadKg == null ? "" : String(round1(toDisplay(loadKg, "mass", unitSystem))),
    hold: hold?.toString() ?? "",
    box: boxCm == null ? "" : String(round1(toDisplay(boxCm, "length", unitSystem))),
    rpe: "",
    quality: null,
  };
}

/** The form turned into the queue item, in canonical units. */
export function buildLoggedSet(input: {
  clientId: string;
  sessionId: number;
  exerciseId: number;
  /** From `carriesOut`: null for an unplanned exercise or an extra set. */
  prescribedSetId: number | null;
  setIndex: number;
  fields: LoggerFields;
  unitSystem: UnitSystem;
  performedAt: Date;
}): LoggedSetInput | { error: string } {
  const { fields, unitSystem } = input;
  const number = (value: string) => {
    const parsed = Number(value.trim());
    return value.trim() && Number.isFinite(parsed) ? parsed : null;
  };
  const reps = number(fields.reps);
  const hold = number(fields.hold);
  if (reps === null && hold === null) {
    return { error: "A set needs either reps or a hold time." };
  }
  const load = number(fields.load);
  const box = number(fields.box);
  return {
    clientId: input.clientId,
    sessionId: input.sessionId,
    exerciseId: input.exerciseId,
    prescribedSetId: input.prescribedSetId,
    setIndex: input.setIndex,
    reps,
    holdSeconds: hold,
    loadKg: load === null ? null : toCanonical(load, "mass", unitSystem),
    boxHeightCm: box === null ? null : toCanonical(box, "length", unitSystem),
    rpe: number(fields.rpe),
    qualityRating: fields.quality,
    performedAt: input.performedAt.toISOString(),
  };
}
