import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { LoggerOuting, PlanLine } from "@/lib/log/plan";
import type { BodyKind, TendonSite, TestKind, UnitSystem } from "@/lib/taxonomy";
import { TENDON_SITES, TEST_KINDS } from "@/lib/taxonomy";
import { dayMinus, dayOf, today } from "@/lib/time";

/**
 * Reads for the log screens.
 *
 * Numerics come back from the driver as strings, since a Postgres `numeric` does
 * not fit a JS number without loss in general. Every query here converts at the
 * boundary so nothing downstream has to remember which fields are strings.
 */

export async function getUnitSystem(): Promise<UnitSystem> {
  const [row] = await getDb()
    .select({ unitSystem: schema.profile.unitSystem })
    .from(schema.profile)
    .limit(1);
  return row?.unitSystem ?? "imperial";
}

export type TestEntry = {
  testGroup: string;
  kind: TestKind;
  measuredAt: Date;
  /** Canonical centimetres, in attempt order. */
  attempts: number[];
  best: number;
  mean: number;
  boxHeightCm: number | null;
  notes: string | null;
};

/**
 * Recent tests, one entry per sitting rather than per attempt.
 *
 * Attempts are grouped in TypeScript rather than with an aggregate query because
 * every attempt is wanted, in order: the spread within a sitting is the noise
 * floor, and the attempt-number effect is what decides how many warm-up jumps a
 * test needs.
 */
export async function recentTests(limit = 8, kind?: TestKind) {
  const { measurements } = schema;
  const rows = await getDb()
    .select({
      testGroup: measurements.testGroup,
      kind: measurements.kind,
      value: measurements.value,
      attempt: measurements.attempt,
      measuredAt: measurements.measuredAt,
      boxHeightCm: measurements.boxHeightCm,
      notes: measurements.notes,
    })
    .from(measurements)
    .where(
      kind
        ? eq(measurements.kind, kind)
        : inArray(measurements.kind, [...TEST_KINDS]),
    )
    .orderBy(desc(measurements.measuredAt), asc(measurements.attempt))
    // Enough rows to fill `limit` sittings even at a dozen attempts each.
    .limit(limit * 20);

  const byGroup = new Map<string, TestEntry>();
  for (const row of rows) {
    // Pre-grouping rows have no test group; treat each as its own sitting.
    const key = row.testGroup ?? `single:${row.measuredAt.toISOString()}`;
    const entry = byGroup.get(key);
    const value = Number(row.value);
    if (entry) {
      entry.attempts.push(value);
    } else {
      byGroup.set(key, {
        testGroup: key,
        kind: row.kind as TestKind,
        measuredAt: row.measuredAt,
        attempts: [value],
        best: value,
        mean: value,
        boxHeightCm: row.boxHeightCm === null ? null : Number(row.boxHeightCm),
        notes: row.notes,
      });
    }
  }

  const entries = [...byGroup.values()].slice(0, limit);
  for (const entry of entries) {
    entry.best = Math.max(...entry.attempts);
    entry.mean =
      entry.attempts.reduce((sum, v) => sum + v, 0) / entry.attempts.length;
  }
  return entries;
}

export async function recentBodyValues(kind: BodyKind, limit = 14) {
  const rows = await getDb()
    .select({
      id: schema.measurements.id,
      value: schema.measurements.value,
      measuredAt: schema.measurements.measuredAt,
      source: schema.measurements.source,
      notes: schema.measurements.notes,
    })
    .from(schema.measurements)
    .where(eq(schema.measurements.kind, kind))
    .orderBy(desc(schema.measurements.measuredAt))
    .limit(limit);

  return rows.map((row) => ({ ...row, value: Number(row.value) }));
}

export type TendonSnapshot = {
  site: TendonSite;
  recordedAt: Date;
  painDuringLoad: number;
  painAfterLoad: number;
  morningStiffness: number;
  protocolPhase: number | null;
};

/**
 * The latest check-in per site, which is the state the pre-filter reads: a site
 * in protocol phase 1 or 2 removes every exercise loading it from the candidate
 * set, so "latest" has to mean latest per site and not latest overall.
 */
export async function latestTendonBySite() {
  const { tendonStatus } = schema;
  const rows = await getDb()
    .select()
    .from(tendonStatus)
    .orderBy(desc(tendonStatus.recordedAt))
    .limit(TENDON_SITES.length * 8);

  const latest = new Map<TendonSite, TendonSnapshot>();
  for (const row of rows) {
    if (latest.has(row.site)) continue;
    latest.set(row.site, {
      site: row.site,
      recordedAt: row.recordedAt,
      painDuringLoad: row.painDuringLoad,
      painAfterLoad: row.painAfterLoad,
      morningStiffness: row.morningStiffness,
      protocolPhase: row.protocolPhase,
    });
  }
  return latest;
}

export async function tendonHistory(days = 60) {
  const since = new Date(`${dayMinus(days)}T00:00:00Z`);
  const rows = await getDb()
    .select()
    .from(schema.tendonStatus)
    .where(gte(schema.tendonStatus.recordedAt, since))
    .orderBy(desc(schema.tendonStatus.recordedAt));
  return rows;
}

export async function readinessForDay(day = today()) {
  const [row] = await getDb()
    .select()
    .from(schema.readinessCheckins)
    .where(eq(schema.readinessCheckins.day, day))
    .limit(1);
  return row ?? null;
}

/**
 * The session sets are logged into: the one open today, if any.
 *
 * Only one session is open at a time by construction. A second workout on the
 * same day is a second session, opened after the first is finished, which keeps
 * per-session RPE meaningful.
 */
export async function openSession(day = today()) {
  const { sessions } = schema;
  const [row] = await getDb()
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.day, day),
        isNull(sessions.completedAt),
        isNull(sessions.skippedAt),
      ),
    )
    .orderBy(desc(sessions.id))
    .limit(1);
  return row ?? null;
}

/**
 * Sessions already closed today, newest first.
 *
 * Without this the hub says "nothing open" the moment a session is finished, which
 * is word for word what it says before any training has happened. What was done
 * today is the first question the screen exists to answer, so a closed session
 * stays visible; starting another one is still one tap away, since a second
 * workout on the same day is a second session.
 */
export async function finishedSessions(day = today()) {
  const { sessions, loggedSets } = schema;
  const rows = await getDb()
    .select({
      id: sessions.id,
      kind: sessions.kind,
      completedAt: sessions.completedAt,
      sessionRpe: sessions.reportedRpe,
      sets: count(loggedSets.id),
    })
    .from(sessions)
    .leftJoin(loggedSets, eq(loggedSets.sessionId, sessions.id))
    .where(and(eq(sessions.day, day), isNotNull(sessions.completedAt)))
    .groupBy(
      sessions.id,
      sessions.kind,
      sessions.completedAt,
      sessions.reportedRpe,
    )
    .orderBy(desc(sessions.completedAt));

  return rows.map((row) => ({
    ...row,
    // Narrowed by the query itself; the column is nullable in general.
    completedAt: row.completedAt as Date,
    sessionRpe: row.sessionRpe === null ? null : Number(row.sessionRpe),
    sets: Number(row.sets),
  }));
}

export async function sessionById(id: number) {
  const [row] = await getDb()
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .limit(1);
  return row ?? null;
}

export type LoggedSetRow = {
  id: number;
  /** Null for a set written before the queue existed, or straight from the server. */
  clientId: string | null;
  /** The prescription this set carried out, null for off-plan work. */
  prescribedSetId: number | null;
  exerciseId: number;
  exerciseName: string;
  exerciseSlug: string;
  setIndex: number;
  reps: number | null;
  holdSeconds: number | null;
  loadKg: number | null;
  boxHeightCm: number | null;
  rpe: number | null;
  qualityRating: number | null;
  performedAt: Date;
  notes: string | null;
};

export async function loggedSetsForSession(sessionId: number) {
  const { loggedSets, exercises } = schema;
  const rows = await getDb()
    .select({
      id: loggedSets.id,
      clientId: loggedSets.clientId,
      prescribedSetId: loggedSets.prescribedSetId,
      exerciseId: loggedSets.exerciseId,
      exerciseName: exercises.name,
      exerciseSlug: exercises.slug,
      setIndex: loggedSets.setIndex,
      reps: loggedSets.reps,
      holdSeconds: loggedSets.holdSeconds,
      loadKg: loggedSets.loadKg,
      boxHeightCm: loggedSets.boxHeightCm,
      rpe: loggedSets.rpe,
      qualityRating: loggedSets.qualityRating,
      performedAt: loggedSets.performedAt,
      notes: loggedSets.notes,
    })
    .from(loggedSets)
    .innerJoin(exercises, eq(exercises.id, loggedSets.exerciseId))
    .where(eq(loggedSets.sessionId, sessionId))
    .orderBy(loggedSets.performedAt, loggedSets.id);

  return rows.map(
    (row): LoggedSetRow => ({
      ...row,
      holdSeconds: row.holdSeconds === null ? null : Number(row.holdSeconds),
      loadKg: row.loadKg === null ? null : Number(row.loadKg),
      boxHeightCm: row.boxHeightCm === null ? null : Number(row.boxHeightCm),
      rpe: row.rpe === null ? null : Number(row.rpe),
    }),
  );
}

/**
 * The session's plan, one row per prescription line, in the order it is done.
 *
 * Block position then position within the block, which is the order the
 * normalizer wrote: highest intensity and most coordination-demanding work first.
 * Empty for an ad-hoc session. Every field is as the plan stores it; a load given
 * as a percentage of 1RM stays one.
 */
export async function plannedSetsForSession(sessionId: number): Promise<PlanLine[]> {
  const { prescribedSets, sessionBlocks } = schema;
  const rows = await getDb()
    .select({
      id: prescribedSets.id,
      blockLabel: sessionBlocks.label,
      exerciseId: prescribedSets.exerciseId,
      sets: prescribedSets.sets,
      reps: prescribedSets.reps,
      holdSeconds: prescribedSets.holdSeconds,
      loadKg: prescribedSets.loadKg,
      loadPctOf1rm: prescribedSets.loadPctOf1rm,
      boxHeightCm: prescribedSets.boxHeightCm,
      targetRpe: prescribedSets.targetRpe,
      restSeconds: prescribedSets.restSeconds,
      couplingClass: prescribedSets.couplingClass,
      tempo: prescribedSets.tempo,
      cueOverride: prescribedSets.cueOverride,
    })
    .from(prescribedSets)
    .innerJoin(sessionBlocks, eq(sessionBlocks.id, prescribedSets.blockId))
    .where(eq(sessionBlocks.sessionId, sessionId))
    .orderBy(asc(sessionBlocks.position), asc(prescribedSets.position));

  return rows.map((row) => ({
    ...row,
    holdSeconds: row.holdSeconds === null ? null : Number(row.holdSeconds),
    loadKg: row.loadKg === null ? null : Number(row.loadKg),
    boxHeightCm: row.boxHeightCm === null ? null : Number(row.boxHeightCm),
    targetRpe: row.targetRpe === null ? null : Number(row.targetRpe),
    shockMethod: null,
  }));
}

/**
 * Every exercise's earlier outings, which is what the logger prefills from: the
 * latest set of each prescription shape it was logged against, plus the latest
 * one logged off plan, newest first.
 *
 * Per shape rather than one per exercise, so a top set and its back-off each
 * find their own last load instead of whichever of the two was logged last. The
 * session being logged is left out, since its own sets are already on the device.
 *
 * Repeating last week's numbers is the common case, and typing them again on a
 * phone between sets is the single thing most likely to stop a set being logged at
 * all. One query for the whole directory rather than one per selection, so the
 * prefill is already on the device when the connection is not.
 */
export async function lastSetsByExercise(excludeSessionId: number) {
  const { loggedSets, prescribedSets } = schema;
  const linked = sql<boolean>`${prescribedSets.id} is not null`;
  const rows = await getDb()
    .selectDistinctOn(
      [
        loggedSets.exerciseId,
        linked,
        prescribedSets.reps,
        prescribedSets.holdSeconds,
        prescribedSets.loadPctOf1rm,
        prescribedSets.targetRpe,
        prescribedSets.boxHeightCm,
      ],
      {
        exerciseId: loggedSets.exerciseId,
        reps: loggedSets.reps,
        loadKg: loggedSets.loadKg,
        holdSeconds: loggedSets.holdSeconds,
        boxHeightCm: loggedSets.boxHeightCm,
        rpe: loggedSets.rpe,
        performedAt: loggedSets.performedAt,
        linked,
        shapeReps: prescribedSets.reps,
        shapeHoldSeconds: prescribedSets.holdSeconds,
        shapeLoadPctOf1rm: prescribedSets.loadPctOf1rm,
        shapeTargetRpe: prescribedSets.targetRpe,
        shapeBoxHeightCm: prescribedSets.boxHeightCm,
      },
    )
    .from(loggedSets)
    .leftJoin(prescribedSets, eq(prescribedSets.id, loggedSets.prescribedSetId))
    .where(ne(loggedSets.sessionId, excludeSessionId))
    .orderBy(
      loggedSets.exerciseId,
      linked,
      prescribedSets.reps,
      prescribedSets.holdSeconds,
      prescribedSets.loadPctOf1rm,
      prescribedSets.targetRpe,
      prescribedSets.boxHeightCm,
      desc(loggedSets.performedAt),
    );

  const optional = (value: string | null) => (value === null ? null : Number(value));
  rows.sort((a, b) => b.performedAt.getTime() - a.performedAt.getTime());
  const byExercise: Record<number, LoggerOuting[]> = {};
  for (const row of rows) {
    (byExercise[row.exerciseId] ??= []).push({
      reps: row.reps,
      loadKg: optional(row.loadKg),
      holdSeconds: optional(row.holdSeconds),
      boxHeightCm: optional(row.boxHeightCm),
      rpe: optional(row.rpe),
      shape: row.linked
        ? {
            reps: row.shapeReps,
            holdSeconds: optional(row.shapeHoldSeconds),
            loadPctOf1rm: row.shapeLoadPctOf1rm,
            targetRpe: optional(row.shapeTargetRpe),
            boxHeightCm: optional(row.shapeBoxHeightCm),
          }
        : null,
    });
  }
  return byExercise;
}

/** Everything the log hub shows, in one round of queries. */
export async function logSnapshot() {
  const day = today();
  const [bodyweight] = await recentBodyValues("bodyweight", 1);
  const [readiness, tendon, session, finished, tests] = await Promise.all([
    readinessForDay(day),
    latestTendonBySite(),
    openSession(day),
    finishedSessions(day),
    recentTests(1),
  ]);

  const [{ value: setsToday } = { value: 0 }] = session
    ? await getDb()
        .select({ value: count() })
        .from(schema.loggedSets)
        .where(eq(schema.loggedSets.sessionId, session.id))
    : [];

  return {
    day,
    bodyweight: bodyweight ?? null,
    bodyweightIsToday: !!bodyweight && dayOf(bodyweight.measuredAt) === day,
    readiness,
    tendon,
    session,
    finished,
    setsToday: Number(setsToday ?? 0),
    lastTest: tests[0] ?? null,
  };
}
