import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { WhoopRecordType } from "@/lib/taxonomy";
import { whoopCollection, whoopFetch } from "./client";
import {
  whoopCycle,
  whoopRecovery,
  whoopSleep,
  whoopWorkout,
  type WhoopRecovery,
} from "./records";

/**
 * Fetching records from WHOOP and storing them verbatim.
 *
 * The webhook payload carries identifiers only, so every event turns into a fetch
 * of that record. What lands in `whoop_records` is the response body untouched;
 * the projection into readiness is derived from it separately, which means a
 * projection bug is fixed by re-running the projection rather than by asking
 * WHOOP for history again.
 */

type Ingested = { type: WhoopRecordType; whoopId: string };

/** Upsert on (type, whoopId), which is what makes a duplicate delivery a no-op. */
export async function storeRecord({
  type,
  whoopId,
  payload,
  recordStart,
  recordEnd,
}: {
  type: WhoopRecordType;
  whoopId: string;
  payload: unknown;
  recordStart?: Date | null;
  recordEnd?: Date | null;
}): Promise<Ingested> {
  const values = {
    type,
    whoopId,
    payload: payload as object,
    recordStart: recordStart ?? null,
    recordEnd: recordEnd ?? null,
    // Cleared so the next projection run picks the record up again, which is what
    // makes an update to an already-scored record take effect.
    projectedAt: null,
    deletedAt: null,
    updatedAt: new Date(),
  };

  await getDb()
    .insert(schema.whoopRecords)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.whoopRecords.type, schema.whoopRecords.whoopId],
      set: values,
    });

  return { type, whoopId };
}

/**
 * Deletes are recorded rather than removing the row, so a delete arriving before
 * the record it refers to still suppresses it, and so the history of what WHOOP
 * retracted is not itself lost.
 */
export async function markDeleted(type: WhoopRecordType, whoopId: string) {
  const now = new Date();
  await getDb()
    .insert(schema.whoopRecords)
    .values({
      type,
      whoopId,
      payload: {},
      deletedAt: now,
      projectedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.whoopRecords.type, schema.whoopRecords.whoopId],
      set: { deletedAt: now, projectedAt: now, updatedAt: now },
    });
}

export async function ingestSleep(sleepId: string) {
  const raw = await whoopFetch<unknown>(`/v2/activity/sleep/${sleepId}`);
  const sleep = whoopSleep.parse(raw);
  return storeRecord({
    type: "sleep",
    whoopId: sleep.id,
    payload: raw,
    recordStart: new Date(sleep.start),
    recordEnd: new Date(sleep.end),
  });
}

export async function ingestWorkout(workoutId: string) {
  const raw = await whoopFetch<unknown>(`/v2/activity/workout/${workoutId}`);
  const workout = whoopWorkout.parse(raw);
  return storeRecord({
    type: "workout",
    whoopId: workout.id,
    payload: raw,
    recordStart: new Date(workout.start),
    recordEnd: new Date(workout.end),
  });
}

export async function ingestCycle(cycleId: string) {
  const raw = await whoopFetch<unknown>(`/v2/cycle/${cycleId}`);
  const cycle = whoopCycle.parse(raw);
  return storeRecord({
    type: "cycle",
    whoopId: cycle.id,
    payload: raw,
    recordStart: new Date(cycle.start),
    recordEnd: cycle.end ? new Date(cycle.end) : null,
  });
}

/**
 * Store a recovery, and the sleep it scores if that has not arrived yet.
 *
 * A v2 recovery event names its sleep rather than its cycle, and the recovery
 * body carries no timestamp for the night, so the sleep is what dates it. Pulling
 * the sleep here rather than waiting for its own event means a recovery is
 * projectable the moment it lands.
 */
export async function ingestRecoveryForSleep(sleepId: string) {
  const sleepRecord = await ingestSleep(sleepId);

  // There is no by-sleep recovery route, so the recent page is scanned. Recovery
  // follows its sleep closely enough that one page always covers it.
  const page = await whoopCollection<unknown>("/v2/recovery", {}, 2);
  let match: WhoopRecovery | undefined;
  let raw: unknown;
  for (const candidate of page) {
    const parsed = whoopRecovery.safeParse(candidate);
    if (parsed.success && parsed.data.sleep_id === sleepId) {
      match = parsed.data;
      raw = candidate;
      break;
    }
  }
  if (!match) return [sleepRecord];

  const recovery = await storeRecord({
    type: "recovery",
    whoopId: match.sleep_id,
    payload: raw,
  });

  // The cycle carries day strain, which has no webhook of its own, so an arriving
  // recovery is the earliest moment its cycle is worth refreshing.
  const cycle = await ingestCycle(match.cycle_id).catch(() => null);
  return cycle ? [sleepRecord, recovery, cycle] : [sleepRecord, recovery];
}

/**
 * Nightly backfill.
 *
 * Cycles and body measurements have no webhook, and a webhook missed while the
 * app was down is not redelivered, so the only thing that makes the series whole
 * is asking for a window of it on a schedule. Overlapping the window with what is
 * already stored is free, since every write upserts.
 */
export async function backfill(days = 7) {
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const query = { start: start.toISOString() };

  const cycles = await whoopCollection<unknown>("/v2/cycle", query);
  for (const raw of cycles) {
    const cycle = whoopCycle.parse(raw);
    await storeRecord({
      type: "cycle",
      whoopId: cycle.id,
      payload: raw,
      recordStart: new Date(cycle.start),
      recordEnd: cycle.end ? new Date(cycle.end) : null,
    });
  }

  const sleeps = await whoopCollection<unknown>("/v2/activity/sleep", query);
  for (const raw of sleeps) {
    const sleep = whoopSleep.parse(raw);
    await storeRecord({
      type: "sleep",
      whoopId: sleep.id,
      payload: raw,
      recordStart: new Date(sleep.start),
      recordEnd: new Date(sleep.end),
    });
  }

  const recoveries = await whoopCollection<unknown>("/v2/recovery", query);
  for (const raw of recoveries) {
    const recovery = whoopRecovery.parse(raw);
    await storeRecord({
      type: "recovery",
      whoopId: recovery.sleep_id,
      payload: raw,
    });
  }

  const workouts = await whoopCollection<unknown>("/v2/activity/workout", query);
  for (const raw of workouts) {
    const workout = whoopWorkout.parse(raw);
    await storeRecord({
      type: "workout",
      whoopId: workout.id,
      payload: raw,
      recordStart: new Date(workout.start),
      recordEnd: new Date(workout.end),
    });
  }

  const body = await whoopFetch<unknown>("/v2/user/measurement/body").catch(
    () => null,
  );
  if (body) {
    // One row, replaced: it is a profile field rather than a series, which is
    // exactly why bodyweight is still entered by hand.
    await storeRecord({
      type: "body_measurement",
      whoopId: "current",
      payload: body,
    });
  }

  return {
    cycles: cycles.length,
    sleeps: sleeps.length,
    recoveries: recoveries.length,
    workouts: workouts.length,
    bodyMeasurement: !!body,
  };
}

export async function recordExists(type: WhoopRecordType, whoopId: string) {
  const [row] = await getDb()
    .select({ id: schema.whoopRecords.id })
    .from(schema.whoopRecords)
    .where(
      and(eq(schema.whoopRecords.type, type), eq(schema.whoopRecords.whoopId, whoopId)),
    )
    .limit(1);
  return !!row;
}
