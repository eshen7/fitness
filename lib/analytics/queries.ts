import { and, asc, eq, gte, lt, lte } from "drizzle-orm";
import { daysBetween } from "@/lib/days";
import { getDb, schema, type Db } from "@/lib/db";
import { blockBands, jumpSittings } from "@/lib/progress/queries";
import type {
  CouplingClass,
  ForceVelocity,
  MovementPattern,
  MuscleGroup,
  ProposalScope,
  ProposalVerdict,
  SessionKind,
  TendonSite,
} from "@/lib/taxonomy";
import { dayMinus, dayOf, today } from "@/lib/time";
import type {
  AnalyticsExercise,
  AnalyticsInputs,
  LoggedSetRow,
  PrescribedSetRow,
  ProposalRow,
  ReadinessRow,
  SessionRow,
  TendonRow,
} from "./inputs";

/**
 * Loading `AnalyticsInputs` out of the database, and nothing else.
 *
 * Same division as `lib/progress/queries.ts` and `lib/nutrition/queries.ts`: the
 * reading lives here and every decision about what the numbers mean lives in the pure
 * modules beside it. That split is worth more in this area than anywhere else in the
 * app, because the suite is a few hundred lines of statistics whose failures are
 * silent, and `suite.test.ts` can only drive it over fixtures if the computation never
 * touches a connection.
 *
 * One window for the whole suite rather than one per insight. A correction applied
 * across statements computed over different windows is not a correction, and the cost
 * of the wider read is nothing: this is one athlete, so the largest table involved
 * holds a few thousand rows.
 */

/**
 * How far back everything is read.
 *
 * Six months, which is the longest window any producer asks for and about one
 * macrocycle. Reading further would start mixing in an athlete who trained
 * differently, which is the quiet way a long history makes an estimate worse rather
 * than better.
 */
export const ANALYTICS_WINDOW_DAYS = 180;

export async function loadAnalyticsInputs(
  options: { asOf?: string; windowDays?: number; db?: Db } = {},
): Promise<AnalyticsInputs> {
  const db = options.db ?? getDb();
  const asOf = options.asOf ?? today();
  const windowDays = options.windowDays ?? ANALYTICS_WINDOW_DAYS;
  const fromDay = dayMinus(windowDays, asOf);
  // Instants are read a day wide on either side and then cut by the owner's day,
  // because a UTC midnight is not the owner's midnight at either end.
  const fromInstant = new Date(`${dayMinus(1, fromDay)}T00:00:00Z`);
  const toInstant = new Date(`${dayMinus(-2, asOf)}T00:00:00Z`);
  const inWindow = (day: string) => day >= fromDay && day <= asOf;

  const {
    exercises,
    foodLogEntries,
    foods,
    loggedSets,
    measurements,
    planProposals,
    prescribedSets,
    profile,
    readinessCheckins,
    sessionBlocks,
    sessions,
    tendonStatus,
  } = schema;

  const [
    exerciseRows,
    sessionRows,
    prescribedRows,
    loggedRows,
    tendonRows,
    readinessRows,
    weightRows,
    intakeRows,
    proposalRows,
    profileRow,
    tests,
    blocks,
  ] = await Promise.all([
    db
      .select({
        id: exercises.id,
        name: exercises.name,
        primaryMuscleGroup: exercises.primaryMuscleGroup,
        movementPattern: exercises.movementPattern,
        forceVelocity: exercises.forceVelocity,
        couplingClass: exercises.couplingClass,
        highImpact: exercises.highImpact,
        loadsTendonSites: exercises.loadsTendonSites,
        tendonLoadRating: exercises.tendonLoadRating,
      })
      .from(exercises),
    db
      .select({
        id: sessions.id,
        day: sessions.day,
        kind: sessions.kind,
        plannedSets: sessions.plannedSets,
        plannedContacts: sessions.plannedContacts,
        plannedIntensity: sessions.plannedIntensity,
        reportedRpe: sessions.reportedRpe,
        completedAt: sessions.completedAt,
        skippedAt: sessions.skippedAt,
        microcycleId: sessions.microcycleId,
      })
      .from(sessions)
      .where(and(gte(sessions.day, fromDay), lte(sessions.day, asOf)))
      .orderBy(asc(sessions.day), asc(sessions.id)),
    // Prescribed sets hang off a session block rather than the session, so the join
    // is what carries the session id the producers group by.
    db
      .select({
        id: prescribedSets.id,
        sessionId: sessionBlocks.sessionId,
        exerciseId: prescribedSets.exerciseId,
        sets: prescribedSets.sets,
        reps: prescribedSets.reps,
        targetRpe: prescribedSets.targetRpe,
        loadKg: prescribedSets.loadKg,
      })
      .from(prescribedSets)
      .innerJoin(sessionBlocks, eq(sessionBlocks.id, prescribedSets.blockId))
      .innerJoin(sessions, eq(sessions.id, sessionBlocks.sessionId))
      .where(and(gte(sessions.day, fromDay), lte(sessions.day, asOf))),
    // Dated by the session's day rather than by `performedAt`, so a set logged at
    // half past midnight belongs to the training day it was part of. Every weekly
    // and daily bucket in the suite depends on that agreeing with the plan.
    db
      .select({
        day: sessions.day,
        sessionId: loggedSets.sessionId,
        exerciseId: loggedSets.exerciseId,
        reps: loggedSets.reps,
        loadKg: loggedSets.loadKg,
        holdSeconds: loggedSets.holdSeconds,
        boxHeightCm: loggedSets.boxHeightCm,
        rpe: loggedSets.rpe,
        qualityRating: loggedSets.qualityRating,
        prescribedSetId: loggedSets.prescribedSetId,
      })
      .from(loggedSets)
      .innerJoin(sessions, eq(sessions.id, loggedSets.sessionId))
      .where(and(gte(sessions.day, fromDay), lte(sessions.day, asOf)))
      .orderBy(asc(sessions.day)),
    db
      .select({
        site: tendonStatus.site,
        recordedAt: tendonStatus.recordedAt,
        painDuringLoad: tendonStatus.painDuringLoad,
        painAfterLoad: tendonStatus.painAfterLoad,
        morningStiffness: tendonStatus.morningStiffness,
        protocolPhase: tendonStatus.protocolPhase,
      })
      .from(tendonStatus)
      .where(
        and(gte(tendonStatus.recordedAt, fromInstant), lt(tendonStatus.recordedAt, toInstant)),
      )
      .orderBy(asc(tendonStatus.recordedAt)),
    db
      .select({
        day: readinessCheckins.day,
        recoveryScore: readinessCheckins.recoveryScore,
        hrvMs: readinessCheckins.hrvMs,
        restingHeartRate: readinessCheckins.restingHeartRate,
        sleepMinutes: readinessCheckins.sleepMinutes,
        sleepPerformancePct: readinessCheckins.sleepPerformancePct,
        slowWaveMinutes: readinessCheckins.slowWaveMinutes,
        remMinutes: readinessCheckins.remMinutes,
        dayStrain: readinessCheckins.dayStrain,
        motivation: readinessCheckins.motivation,
        sorenessByRegion: readinessCheckins.sorenessByRegion,
      })
      .from(readinessCheckins)
      .where(and(gte(readinessCheckins.day, fromDay), lte(readinessCheckins.day, asOf)))
      .orderBy(asc(readinessCheckins.day)),
    db
      .select({ value: measurements.value, measuredAt: measurements.measuredAt })
      .from(measurements)
      .where(
        and(
          eq(measurements.kind, "bodyweight"),
          gte(measurements.measuredAt, fromInstant),
          lt(measurements.measuredAt, toInstant),
        ),
      )
      .orderBy(asc(measurements.measuredAt)),
    db
      .select({
        day: foodLogEntries.day,
        quantity: foodLogEntries.quantity,
        kcalPerUnit: foods.kcalPerUnit,
      })
      .from(foodLogEntries)
      .innerJoin(foods, eq(foods.id, foodLogEntries.foodId))
      .where(and(gte(foodLogEntries.day, fromDay), lte(foodLogEntries.day, asOf))),
    db
      .select({
        id: planProposals.id,
        scope: planProposals.scope,
        verdict: planProposals.verdict,
        repairAttempts: planProposals.repairAttempts,
        isFallback: planProposals.isFallback,
        ownerEdits: planProposals.ownerEdits,
        createdAt: planProposals.createdAt,
      })
      .from(planProposals)
      .where(
        and(gte(planProposals.createdAt, fromInstant), lt(planProposals.createdAt, toInstant)),
      )
      .orderBy(asc(planProposals.createdAt)),
    db
      .select({ trainableWeekdays: profile.trainableWeekdays })
      .from(profile)
      .limit(1),
    jumpSittings(daysBetween(fromDay, today()) + 1),
    blockBands(fromDay),
  ]);

  const exerciseMap = new Map<number, AnalyticsExercise>(
    exerciseRows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        primaryMuscleGroup: row.primaryMuscleGroup as MuscleGroup,
        movementPattern: row.movementPattern as MovementPattern,
        forceVelocity: row.forceVelocity as ForceVelocity,
        couplingClass: row.couplingClass as CouplingClass,
        highImpact: row.highImpact,
        loadsTendonSites: row.loadsTendonSites as TendonSite[],
        tendonLoadRating: row.tendonLoadRating,
      },
    ]),
  );

  const intakeByDay = new Map<string, number>();
  for (const row of intakeRows) {
    const kcal = Number(row.quantity) * Number(row.kcalPerUnit);
    intakeByDay.set(row.day, (intakeByDay.get(row.day) ?? 0) + kcal);
  }

  return {
    asOf,
    trainableWeekdays: profileRow[0]?.trainableWeekdays ?? [],
    exercises: exerciseMap,
    loggedSets: loggedRows.map(
      (row): LoggedSetRow => ({
        day: row.day,
        sessionId: row.sessionId,
        exerciseId: row.exerciseId,
        reps: row.reps,
        loadKg: numeric(row.loadKg),
        holdSeconds: numeric(row.holdSeconds),
        boxHeightCm: numeric(row.boxHeightCm),
        rpe: numeric(row.rpe),
        qualityRating: row.qualityRating,
        prescribedSetId: row.prescribedSetId,
      }),
    ),
    prescribedSets: prescribedRows.map(
      (row): PrescribedSetRow => ({
        id: row.id,
        sessionId: row.sessionId,
        exerciseId: row.exerciseId,
        sets: row.sets,
        reps: row.reps,
        targetRpe: numeric(row.targetRpe),
        loadKg: numeric(row.loadKg),
      }),
    ),
    sessions: sessionRows.map(
      (row): SessionRow => ({
        id: row.id,
        day: row.day,
        kind: row.kind as SessionKind,
        plannedSets: row.plannedSets,
        plannedContacts: row.plannedContacts,
        plannedIntensity: row.plannedIntensity,
        reportedRpe: numeric(row.reportedRpe),
        completed: row.completedAt !== null,
        skipped: row.skippedAt !== null,
        microcycleId: row.microcycleId,
      }),
    ),
    tests: tests.filter((sitting) => inWindow(sitting.day)),
    bodyweight: weightRows
      .map((row) => ({ day: dayOf(row.measuredAt), kg: Number(row.value) }))
      .filter((reading) => inWindow(reading.day)),
    intake: [...intakeByDay.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, kcal]) => ({ day, kcal })),
    tendon: tendonRows
      .map(
        (row): TendonRow => ({
          day: dayOf(row.recordedAt),
          site: row.site as TendonSite,
          painDuringLoad: row.painDuringLoad,
          painAfterLoad: row.painAfterLoad,
          morningStiffness: row.morningStiffness,
          protocolPhase: row.protocolPhase,
        }),
      )
      .filter((row) => inWindow(row.day)),
    readiness: readinessRows.map(
      (row): ReadinessRow => ({
        day: row.day,
        recoveryScore: row.recoveryScore,
        hrvMs: numeric(row.hrvMs),
        restingHeartRate: row.restingHeartRate,
        sleepMinutes: row.sleepMinutes,
        sleepPerformancePct: row.sleepPerformancePct,
        slowWaveMinutes: row.slowWaveMinutes,
        remMinutes: row.remMinutes,
        dayStrain: numeric(row.dayStrain),
        motivation: row.motivation,
        sorenessByRegion: row.sorenessByRegion ?? {},
      }),
    ),
    blocks,
    proposals: proposalRows
      .filter((row) => inWindow(dayOf(row.createdAt)))
      .map(
        (row): ProposalRow => ({
          id: row.id,
          scope: row.scope as ProposalScope,
          verdict: row.verdict as ProposalVerdict,
          repairAttempts: row.repairAttempts,
          isFallback: row.isFallback,
          // A first-attempt pass is zero repairs *and* no fallback. Reading only the
          // repair count would score a plan that was abandoned after a failed repair
          // loop as having passed cleanly, which is the opposite of what happened.
          passedFirstAttempt: row.repairAttempts === 0 && !row.isFallback,
          editedFields: countEdits(row.ownerEdits),
        }),
      ),
  };
}

/**
 * How many fields the owner changed, from the `owner_edits` document.
 *
 * Null rather than zero when nothing was recorded, because "accepted untouched" and
 * "edited, and we did not capture what" are different facts and averaging the second
 * in as a zero would make the generator look better the less the app remembered.
 */
function countEdits(ownerEdits: unknown): number | null {
  if (ownerEdits === null || typeof ownerEdits !== "object") return null;
  if (Array.isArray(ownerEdits)) return ownerEdits.length;
  return Object.keys(ownerEdits as Record<string, unknown>).length;
}

/** Numerics cross the driver as strings. One converter, so no boundary is missed. */
function numeric(value: string | null): number | null {
  return value === null ? null : Number(value);
}
