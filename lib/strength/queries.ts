import { and, asc, eq, gte, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { dayMinus, dayOf, today } from "@/lib/time";
import {
  currentOneRm,
  dailyBestEstimates,
  ESTIMATE_WINDOW_DAYS,
  ONE_RM_FORCE_VELOCITY,
  oneRmHistory,
  type CurrentOneRm,
  type OneRmReading,
} from "./one-rm";

export type LiftHistory = {
  exerciseId: number;
  exerciseName: string;
  slug: string;
  /** One reading per day, oldest first, from `oneRmHistory`. */
  readings: OneRmReading[];
};

/**
 * Every lift's one-rep max readings: each tested max, and each day's best
 * estimate from the sets logged since `sinceDay`.
 *
 * Sets are dated by their session's day rather than by `performedAt`, the same
 * as the insight suite, so a set logged after midnight belongs to the training
 * day it was part of. Tested maxes are read in full unless `testedSinceDay` is
 * given, because a tested max is not aged out of `currentOneRm`.
 */
export async function oneRmHistories({
  sinceDay,
  testedSinceDay,
}: {
  sinceDay: string;
  testedSinceDay?: string;
}): Promise<LiftHistory[]> {
  const { exercises, loggedSets, measurements, sessions } = schema;
  const [sets, tests] = await Promise.all([
    getDb()
      .select({
        day: sessions.day,
        exerciseId: loggedSets.exerciseId,
        exerciseName: exercises.name,
        slug: exercises.slug,
        reps: loggedSets.reps,
        loadKg: loggedSets.loadKg,
      })
      .from(loggedSets)
      .innerJoin(sessions, eq(sessions.id, loggedSets.sessionId))
      .innerJoin(exercises, eq(exercises.id, loggedSets.exerciseId))
      .where(
        and(
          eq(exercises.forceVelocity, ONE_RM_FORCE_VELOCITY),
          isNotNull(loggedSets.loadKg),
          gte(sessions.day, sinceDay),
        ),
      ),
    getDb()
      .select({
        exerciseId: measurements.exerciseId,
        exerciseName: exercises.name,
        slug: exercises.slug,
        value: measurements.value,
        measuredAt: measurements.measuredAt,
      })
      .from(measurements)
      .innerJoin(exercises, eq(exercises.id, measurements.exerciseId))
      .where(
        and(
          eq(measurements.kind, "tested_1rm"),
          testedSinceDay === undefined
            ? undefined
            : gte(measurements.measuredAt, new Date(`${testedSinceDay}T00:00:00Z`)),
        ),
      )
      .orderBy(asc(measurements.measuredAt)),
  ]);

  const lifts = new Map<number, LiftHistory>();
  const liftOf = (row: { exerciseId: number; exerciseName: string; slug: string }) => {
    const held = lifts.get(row.exerciseId);
    if (held) return held;
    const lift = { ...row, readings: [] };
    lifts.set(row.exerciseId, lift);
    return lift;
  };

  const estimates = dailyBestEstimates(
    sets.map((row) => ({
      day: row.day,
      exerciseId: row.exerciseId,
      reps: row.reps,
      loadKg: row.loadKg === null ? null : Number(row.loadKg),
    })),
  );
  for (const row of sets) liftOf(row);
  for (const [exerciseId, readings] of estimates) lifts.get(exerciseId)!.readings.push(...readings);
  for (const row of tests) {
    const day = dayOf(row.measuredAt);
    if (testedSinceDay !== undefined && day < testedSinceDay) continue;
    liftOf({ ...row, exerciseId: row.exerciseId! }).readings.push({
      day,
      kg: Number(row.value),
      source: "tested",
    });
  }

  return [...lifts.values()]
    .map((lift) => ({ ...lift, readings: oneRmHistory(lift.readings) }))
    .filter((lift) => lift.readings.length > 0);
}

/**
 * The max every lift's prescriptions are loaded from today, keyed by exercise
 * id as a string so it survives being handed to a client component. A lift with
 * nothing on record is absent.
 */
export async function currentOneRms(): Promise<Record<string, CurrentOneRm>> {
  const day = today();
  const lifts = await oneRmHistories({ sinceDay: dayMinus(ESTIMATE_WINDOW_DAYS, day) });
  const current: Record<string, CurrentOneRm> = {};
  for (const lift of lifts) {
    const max = currentOneRm(lift.readings, day);
    if (max) current[String(lift.exerciseId)] = max;
  }
  return current;
}
