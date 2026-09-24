import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { MesocycleType, TendonSite, TestKind } from "@/lib/taxonomy";
import { TEST_KINDS } from "@/lib/taxonomy";
import { dayMinus, dayOf, today } from "@/lib/time";
import {
  bestByHeight,
  bodyweightOn,
  bodyweightTrend,
  bucketTendonWeeks,
  deriveBlockBands,
  groupSittings,
  type BlockBand,
  type JumpSitting,
  type TendonWeek,
} from "./derive";
import { weekStart } from "./scale";

export type { BlockBand, JumpSitting, TendonWeek };

/**
 * Everything the progress screens read.
 *
 * Aggregation happens in TypeScript rather than in SQL wherever the shape is
 * non-trivial. This is one athlete's training history, so the row counts are in
 * the hundreds and the cost of pulling them is nothing next to the cost of a
 * window function nobody can read a year from now. The shaping after each query
 * lives in `derive.ts` and the arithmetic in `scale.ts`, both pure and tested, so
 * what is left here is only the reading.
 */

export async function jumpSittings(days = 180): Promise<JumpSitting[]> {
  const { measurements } = schema;
  const rows = await getDb()
    .select({
      testGroup: measurements.testGroup,
      kind: measurements.kind,
      value: measurements.value,
      boxHeightCm: measurements.boxHeightCm,
      measuredAt: measurements.measuredAt,
    })
    .from(measurements)
    .where(
      and(
        inArray(measurements.kind, [...TEST_KINDS]),
        gte(measurements.measuredAt, new Date(`${dayMinus(days)}T00:00:00Z`)),
      ),
    )
    .orderBy(asc(measurements.measuredAt));

  return groupSittings(
    rows.map((row) => ({
      testGroup: row.testGroup,
      kind: row.kind as TestKind,
      value: Number(row.value),
      boxHeightCm: row.boxHeightCm === null ? null : Number(row.boxHeightCm),
      day: dayOf(row.measuredAt),
      instant: row.measuredAt.toISOString(),
    })),
  );
}

/** The mesocycle blocks that overlap the window, each with a derived end. */
export async function blockBands(fromDay: string): Promise<BlockBand[]> {
  const { mesocycles } = schema;
  const rows = await getDb()
    .select({
      id: mesocycles.id,
      type: mesocycles.type,
      ordinal: mesocycles.ordinal,
      startDate: mesocycles.startDate,
      plannedMicrocycles: mesocycles.plannedMicrocycles,
      closedAt: mesocycles.closedAt,
    })
    .from(mesocycles)
    .orderBy(asc(mesocycles.startDate));

  return deriveBlockBands(
    rows.map((row) => ({
      id: row.id,
      type: row.type as MesocycleType,
      ordinal: row.ordinal,
      startDay: row.startDate,
      plannedMicrocycles: row.plannedMicrocycles,
      closedDay: row.closedAt === null ? null : dayOf(row.closedAt),
    })),
    today(),
    fromDay,
  );
}

/**
 * Weekly tendon pain against weekly high-impact contacts.
 *
 * Two measures on very different scales, so they are never drawn on one pair of
 * axes: the chart stacks two plots over one shared week axis instead. The point
 * is the lag, since pain follows load by a day or three, and a shared x is the
 * only honest way to see it.
 *
 * A contact is one landing, so the count is reps and not sets.
 */
export async function tendonWeeks(weeks = 16): Promise<TendonWeek[]> {
  const { tendonStatus, loggedSets, exercises } = schema;
  const from = weekStart(dayMinus(weeks * 7));

  const [pain, contacts] = await Promise.all([
    getDb()
      .select({
        site: tendonStatus.site,
        recordedAt: tendonStatus.recordedAt,
        during: tendonStatus.painDuringLoad,
        after: tendonStatus.painAfterLoad,
        stiffness: tendonStatus.morningStiffness,
      })
      .from(tendonStatus)
      .where(gte(tendonStatus.recordedAt, new Date(`${from}T00:00:00Z`))),
    getDb()
      .select({
        performedAt: loggedSets.performedAt,
        reps: loggedSets.reps,
      })
      .from(loggedSets)
      .innerJoin(exercises, eq(exercises.id, loggedSets.exerciseId))
      .where(
        and(
          eq(exercises.highImpact, true),
          gte(loggedSets.performedAt, new Date(`${from}T00:00:00Z`)),
        ),
      ),
  ]);

  return bucketTendonWeeks(
    from,
    weekStart(today()),
    pain.map((row) => ({
      week: weekStart(dayOf(row.recordedAt)),
      site: row.site as TendonSite,
      during: row.during,
      after: row.after,
      stiffness: row.stiffness,
    })),
    contacts.map((row) => ({
      week: weekStart(dayOf(row.performedAt)),
      reps: row.reps,
    })),
  );
}

export type StrengthPoint = {
  day: string;
  exerciseId: number;
  exerciseName: string;
  oneRmKg: number;
  /** Estimated 1RM over trend bodyweight, null until there is a bodyweight. */
  relative: number | null;
};

/**
 * Relative strength: estimated 1RM over bodyweight, per lift.
 *
 * Absolute load is the number that feels like progress and relative strength is
 * the one that predicts jumping, so this chart plots the ratio and leaves the
 * kilograms to the tooltip. Bodyweight is smoothed before dividing, because a
 * two-kilo day of water would otherwise show up as a strength change.
 */
export async function relativeStrength(days = 180): Promise<StrengthPoint[]> {
  const { measurements, exercises } = schema;
  const since = new Date(`${dayMinus(days)}T00:00:00Z`);

  const [lifts, weights] = await Promise.all([
    getDb()
      .select({
        exerciseId: measurements.exerciseId,
        exerciseName: exercises.name,
        value: measurements.value,
        measuredAt: measurements.measuredAt,
      })
      .from(measurements)
      .innerJoin(exercises, eq(exercises.id, measurements.exerciseId))
      .where(
        and(
          eq(measurements.kind, "estimated_1rm"),
          isNotNull(measurements.exerciseId),
          gte(measurements.measuredAt, since),
        ),
      )
      .orderBy(asc(measurements.measuredAt)),
    getDb()
      .select({ value: measurements.value, measuredAt: measurements.measuredAt })
      .from(measurements)
      .where(
        and(eq(measurements.kind, "bodyweight"), gte(measurements.measuredAt, since)),
      )
      .orderBy(asc(measurements.measuredAt)),
  ]);

  const trend = bodyweightTrend(
    weights.map((row) => ({ day: dayOf(row.measuredAt), kg: Number(row.value) })),
  );

  return lifts.map((row): StrengthPoint => {
    const day = dayOf(row.measuredAt);
    const oneRmKg = Number(row.value);
    const bodyweight = bodyweightOn(trend, day);
    return {
      day,
      exerciseId: row.exerciseId as number,
      exerciseName: row.exerciseName,
      oneRmKg,
      relative: bodyweight === null ? null : oneRmKg / bodyweight,
    };
  });
}

export type SessionOutcome = {
  id: number;
  day: string;
  kind: string;
  prescribedSets: number;
  loggedSets: number;
  /** Mean target RPE across the session's prescribed sets. */
  targetRpe: number | null;
  reportedRpe: number | null;
  skipped: boolean;
};

/**
 * Adherence and RPE against what was prescribed.
 *
 * This is the chart that says whether the generator is calibrated. Sets completed
 * over sets prescribed is adherence; reported RPE minus mean target RPE is the
 * correction factor, and a plan that reads 8 when it prescribed 6 is not a plan
 * that was followed badly, it is a plan that was too hard.
 */
export async function sessionOutcomes(days = 90): Promise<SessionOutcome[]> {
  const { sessions, sessionBlocks, prescribedSets, loggedSets } = schema;
  const from = dayMinus(days);

  const rows = await getDb()
    .select({
      id: sessions.id,
      day: sessions.day,
      kind: sessions.kind,
      reportedRpe: sessions.reportedRpe,
      skippedAt: sessions.skippedAt,
      prescribed: sql<number>`coalesce(sum(${prescribedSets.sets}), 0)`,
      targetRpe: sql<number | null>`avg(${prescribedSets.targetRpe})`,
    })
    .from(sessions)
    .leftJoin(sessionBlocks, eq(sessionBlocks.sessionId, sessions.id))
    .leftJoin(prescribedSets, eq(prescribedSets.blockId, sessionBlocks.id))
    .where(gte(sessions.day, from))
    .groupBy(sessions.id, sessions.day, sessions.kind, sessions.reportedRpe, sessions.skippedAt)
    .orderBy(asc(sessions.day), asc(sessions.id));

  // Logged sets counted separately rather than in a second join, which would
  // multiply the prescribed rows by the logged ones and inflate both.
  const logged = await getDb()
    .select({
      sessionId: loggedSets.sessionId,
      count: sql<number>`count(*)`,
    })
    .from(loggedSets)
    .innerJoin(sessions, eq(sessions.id, loggedSets.sessionId))
    .where(gte(sessions.day, from))
    .groupBy(loggedSets.sessionId);
  const loggedBySession = new Map(logged.map((row) => [row.sessionId, Number(row.count)]));

  return rows.map((row) => ({
    id: row.id,
    day: row.day,
    kind: row.kind,
    prescribedSets: Number(row.prescribed),
    loggedSets: loggedBySession.get(row.id) ?? 0,
    targetRpe: row.targetRpe === null ? null : Number(row.targetRpe),
    reportedRpe: row.reportedRpe === null ? null : Number(row.reportedRpe),
    skipped: row.skippedAt !== null,
  }));
}

/**
 * The depth jump calibration readings: drop height against jump height.
 *
 * The ebook's protocol is to raise the box until measured vertical falls below the
 * standing jump, and to train at the height where the two match. Both numbers are
 * needed to say anything, so the standing vertical comes back with them.
 */
export async function depthJumpReadings(days = 365) {
  const { measurements } = schema;
  const since = new Date(`${dayMinus(days)}T00:00:00Z`);

  const [drops, standing] = await Promise.all([
    getDb()
      .select({
        value: measurements.value,
        boxHeightCm: measurements.boxHeightCm,
        measuredAt: measurements.measuredAt,
        testGroup: measurements.testGroup,
      })
      .from(measurements)
      .where(
        and(
          eq(measurements.kind, "depth_jump_vertical"),
          isNotNull(measurements.boxHeightCm),
          gte(measurements.measuredAt, since),
        ),
      )
      .orderBy(asc(measurements.boxHeightCm)),
    getDb()
      .select({ value: measurements.value, measuredAt: measurements.measuredAt })
      .from(measurements)
      .where(eq(measurements.kind, "standing_vertical"))
      .orderBy(desc(measurements.measuredAt))
      .limit(1),
  ]);

  return {
    standingCm: standing[0] ? Number(standing[0].value) : null,
    points: bestByHeight(
      drops.map((row) => ({
        boxHeightCm: Number(row.boxHeightCm),
        jumpCm: Number(row.value),
        day: dayOf(row.measuredAt),
      })),
    ),
  };
}
