import { and, eq, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { dayOf } from "@/lib/time";
import {
  minutes,
  percent,
  whoopCycle,
  whoopRecovery,
  whoopSleep,
  type WhoopCycle,
  type WhoopRecovery,
  type WhoopSleep,
} from "./records";

/**
 * Projection of raw WHOOP records into the readiness row for a training day.
 *
 * The raw payloads are the record of truth and this is a derivation of them, so
 * it is re-runnable: a record that arrives unscored and is scored an hour later
 * is projected again from what is already stored. That is why the patch builders
 * below are pure and take a day rather than reading one.
 *
 * Which day a record belongs to is a judgement, not a lookup. A night of sleep
 * belongs to the morning it ends, because that is the day it is readiness for.
 * A cycle belongs to the day it starts, because its strain accumulates forward.
 */

export type ReadinessPatch = Partial<
  Pick<
    typeof schema.readinessCheckins.$inferInsert,
    | "recoveryScore"
    | "hrvMs"
    | "restingHeartRate"
    | "sleepMinutes"
    | "sleepPerformancePct"
    | "sleepEfficiencyPct"
    | "slowWaveMinutes"
    | "remMinutes"
    | "dayStrain"
  >
>;

/** The day a night of sleep is readiness for: the one it ends on. */
export function sleepDay(sleep: WhoopSleep) {
  return dayOf(new Date(sleep.end));
}

export function sleepPatch(sleep: WhoopSleep): ReadinessPatch {
  const stages = sleep.score?.stage_summary;
  if (!stages && !sleep.score) return {};

  const inBed = stages?.total_in_bed_time_milli ?? null;
  const awake = stages?.total_awake_time_milli ?? null;
  // Asleep, not in bed: time awake in bed is not recovery, and every downstream
  // use of this number is about how much sleep was actually had.
  const asleep =
    inBed === null ? null : awake === null ? inBed : Math.max(0, inBed - awake);

  return {
    sleepMinutes: minutes(asleep),
    slowWaveMinutes: minutes(stages?.total_slow_wave_sleep_time_milli),
    remMinutes: minutes(stages?.total_rem_sleep_time_milli),
    sleepPerformancePct: percent(sleep.score?.sleep_performance_percentage),
    sleepEfficiencyPct: percent(sleep.score?.sleep_efficiency_percentage),
  };
}

export function recoveryPatch(recovery: WhoopRecovery): ReadinessPatch {
  const score = recovery.score;
  if (!score) return {};
  return {
    recoveryScore: percent(score.recovery_score),
    // Numerics cross the driver as strings, so the conversion happens here rather
    // than being left for the insert to coerce however it happens to.
    hrvMs:
      score.hrv_rmssd_milli === null || score.hrv_rmssd_milli === undefined
        ? null
        : score.hrv_rmssd_milli.toFixed(2),
    restingHeartRate: percent(score.resting_heart_rate),
  };
}

/** The day a cycle's strain belongs to: the one it starts on. */
export function cycleDay(cycle: WhoopCycle) {
  return dayOf(new Date(cycle.start));
}

export function cyclePatch(cycle: WhoopCycle): ReadinessPatch {
  const strain = cycle.score?.strain;
  if (strain === null || strain === undefined) return {};
  return { dayStrain: strain.toFixed(2) };
}

/** Drops the keys whose value is null, so a patch never blanks a stored number. */
function present(patch: ReadinessPatch): ReadinessPatch {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== null),
  ) as ReadinessPatch;
}

/**
 * Merge a patch into the day's readiness row, creating it if the day has no
 * check-in yet.
 *
 * Only the device columns are written. The self-reported fields are never in the
 * update set, so a projection arriving after the morning check-in cannot erase
 * the answers that were typed in, and a projection arriving before it means the
 * form opens with recovery and sleep already filled.
 */
export async function mergeReadiness(day: string, patch: ReadinessPatch) {
  const fields = present(patch);
  if (!Object.keys(fields).length) return false;

  await getDb()
    .insert(schema.readinessCheckins)
    .values({ day, ...fields, whoopFilled: true })
    .onConflictDoUpdate({
      target: schema.readinessCheckins.day,
      set: { ...fields, whoopFilled: true, updatedAt: new Date() },
    });
  return true;
}

/**
 * Project every record that has not been projected since it last changed.
 *
 * Recovery is the awkward one: a v2 recovery event identifies its *sleep*, and
 * the recovery itself carries no timestamp of the night it describes, so its day
 * comes from the stored sleep. A recovery whose sleep has not arrived yet is left
 * unprojected rather than guessed at, and picked up by the next run once it has.
 */
export async function projectPending(limit = 200) {
  const { whoopRecords } = schema;
  const rows = await getDb()
    .select()
    .from(whoopRecords)
    .where(
      and(
        isNull(whoopRecords.deletedAt),
        or(
          isNull(whoopRecords.projectedAt),
          sql`${whoopRecords.projectedAt} < ${whoopRecords.updatedAt}`,
        ),
      ),
    )
    .limit(limit);

  let merged = 0;
  let deferred = 0;

  for (const row of rows) {
    let applied = false;

    if (row.type === "sleep") {
      const sleep = whoopSleep.parse(row.payload);
      // A nap is not the night, and folding one into the night's totals would
      // report more sleep than was had in one stretch.
      if (sleep.nap) applied = true;
      else applied = await mergeReadiness(sleepDay(sleep), sleepPatch(sleep));
    } else if (row.type === "cycle") {
      const cycle = whoopCycle.parse(row.payload);
      applied = await mergeReadiness(cycleDay(cycle), cyclePatch(cycle));
    } else if (row.type === "recovery") {
      const recovery = whoopRecovery.parse(row.payload);
      const [sleepRow] = await getDb()
        .select({ payload: whoopRecords.payload })
        .from(whoopRecords)
        .where(
          and(
            eq(whoopRecords.type, "sleep"),
            eq(whoopRecords.whoopId, recovery.sleep_id),
          ),
        )
        .limit(1);
      if (!sleepRow) {
        deferred++;
        continue;
      }
      const sleep = whoopSleep.parse(sleepRow.payload);
      applied = await mergeReadiness(sleepDay(sleep), recoveryPatch(recovery));
    } else {
      // Workouts and body measurements are stored for later analysis rather than
      // projected: WHOOP's own workout detection does not know what was
      // prescribed, and bodyweight stays manual by decision.
      applied = true;
    }

    // Marked whether or not it changed anything. An unscored record yields an
    // empty patch, and leaving those unmarked would have them reconsidered on
    // every run forever, eventually filling the batch and starving the records
    // that do have something to say. Re-projection is driven by writes instead:
    // storing a record clears this column, so an update is always picked up.
    await getDb()
      .update(whoopRecords)
      .set({ projectedAt: new Date() })
      .where(eq(whoopRecords.id, row.id));
    if (applied) merged++;
  }

  return { considered: rows.length, merged, deferred };
}
