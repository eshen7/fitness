import { and, asc, count, eq, gte, isNull, lt } from "drizzle-orm";
import { getDb, schema, type Db } from "@/lib/db";
import { sessionKindLabels, tendonSiteLabels } from "@/lib/labels";
import type { ReflectionSession, ReflectionSet } from "@/lib/ai/reflect";
import { recordSpend } from "@/lib/ai/proposals";
import { addDays } from "@/lib/days";
import { dayOf } from "@/lib/time";
import { embedFacts } from "./embed";
import { isPending, type Embedded, type MemoryFact } from "./facts";
import type { MemoryPort } from "./reflect";
import { applyFactProposal, loadFacts, storeEmbedding } from "./store";

/**
 * The database side of memory: the reflection port, and the feed.
 *
 * Reading only, apart from the port's `apply`, which delegates straight to
 * `store.ts`. Everything that decides anything is in `facts.ts` or `reflect.ts`.
 */

// -----------------------------------------------------------------------------
// The session, as the reflection prompt renders it
// -----------------------------------------------------------------------------

/** How far either side of the session day tendon check-ins count as "around it". */
const TENDON_WINDOW_DAYS = 1;

/**
 * One session, joined out into prose-ready rows.
 *
 * Prescribed sets are carried alongside the logged ones rather than being resolved
 * into a diff here, because the interesting comparisons are things only the model can
 * make - a set the athlete swapped for a different exercise, a load they quietly
 * halved. What this function does resolve is the pairing, since a logged set that
 * names no prescription is off-plan work and reads completely differently.
 */
export async function loadReflectionSession(
  sessionId: number,
  db: Db = getDb(),
): Promise<ReflectionSession | null> {
  const [session] = await db
    .select({
      id: schema.sessions.id,
      day: schema.sessions.day,
      kind: schema.sessions.kind,
      title: schema.sessions.title,
      notes: schema.sessions.notes,
      reportedRpe: schema.sessions.reportedRpe,
      plannedSets: schema.sessions.plannedSets,
    })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);
  if (!session) return null;

  const [logged, prescribed, tendon] = await Promise.all([
    db
      .select({
        exerciseName: schema.exercises.name,
        prescribedSetId: schema.loggedSets.prescribedSetId,
        reps: schema.loggedSets.reps,
        loadKg: schema.loggedSets.loadKg,
        holdSeconds: schema.loggedSets.holdSeconds,
        boxHeightCm: schema.loggedSets.boxHeightCm,
        rpe: schema.loggedSets.rpe,
        qualityRating: schema.loggedSets.qualityRating,
        notes: schema.loggedSets.notes,
        setIndex: schema.loggedSets.setIndex,
      })
      .from(schema.loggedSets)
      .innerJoin(schema.exercises, eq(schema.exercises.id, schema.loggedSets.exerciseId))
      .where(eq(schema.loggedSets.sessionId, sessionId))
      .orderBy(asc(schema.loggedSets.performedAt), asc(schema.loggedSets.setIndex)),
    db
      .select({
        id: schema.prescribedSets.id,
        exerciseName: schema.exercises.name,
        sets: schema.prescribedSets.sets,
        reps: schema.prescribedSets.reps,
        loadKg: schema.prescribedSets.loadKg,
        holdSeconds: schema.prescribedSets.holdSeconds,
        boxHeightCm: schema.prescribedSets.boxHeightCm,
        targetRpe: schema.prescribedSets.targetRpe,
      })
      .from(schema.prescribedSets)
      .innerJoin(
        schema.sessionBlocks,
        eq(schema.sessionBlocks.id, schema.prescribedSets.blockId),
      )
      .innerJoin(
        schema.exercises,
        eq(schema.exercises.id, schema.prescribedSets.exerciseId),
      )
      .where(eq(schema.sessionBlocks.sessionId, sessionId))
      .orderBy(asc(schema.sessionBlocks.position), asc(schema.prescribedSets.position)),
    db
      .select({
        site: schema.tendonStatus.site,
        recordedAt: schema.tendonStatus.recordedAt,
        painDuringLoad: schema.tendonStatus.painDuringLoad,
        painAfterLoad: schema.tendonStatus.painAfterLoad,
      })
      .from(schema.tendonStatus)
      // A day wider than the window on each side in UTC, then cut by the owner's day
      // below, because a UTC midnight is not the owner's.
      .where(
        and(
          gte(
            schema.tendonStatus.recordedAt,
            new Date(`${addDays(session.day, -TENDON_WINDOW_DAYS - 1)}T00:00:00Z`),
          ),
          lt(
            schema.tendonStatus.recordedAt,
            new Date(`${addDays(session.day, TENDON_WINDOW_DAYS + 2)}T00:00:00Z`),
          ),
        ),
      )
      .orderBy(asc(schema.tendonStatus.recordedAt)),
  ]);

  const byId = new Map(prescribed.map((row) => [row.id, row]));
  const loggedIds = new Set(
    logged.map((row) => row.prescribedSetId).filter((id): id is number => id !== null),
  );

  const sets: ReflectionSet[] = logged.map((row) => {
    const plan = row.prescribedSetId === null ? null : byId.get(row.prescribedSetId);
    return {
      exerciseName: row.exerciseName,
      prescribed: plan
        ? describePrescription(plan)
        : row.prescribedSetId === null
          ? null
          : "a prescription that has since been removed",
      performed: describePerformance(row),
      rpe: numeric(row.rpe),
      targetRpe: plan ? numeric(plan.targetRpe) : null,
      qualityRating: row.qualityRating,
      notes: row.notes,
    };
  });

  return {
    day: session.day,
    kind: sessionKindLabels.of(session.kind),
    title: session.title,
    notes: session.notes,
    reportedRpe: numeric(session.reportedRpe),
    plannedSets: session.plannedSets,
    sets,
    skipped: prescribed
      .filter((row) => !loggedIds.has(row.id))
      .map((row) => `- ${row.exerciseName}: ${describePrescription(row)}`),
    tendon: tendon
      .filter((row) => {
        const day = dayOf(row.recordedAt);
        return (
          day >= addDays(session.day, -TENDON_WINDOW_DAYS) &&
          day <= addDays(session.day, TENDON_WINDOW_DAYS)
        );
      })
      .map((row) => ({
        site: tendonSiteLabels.of(row.site),
        painDuringLoad: row.painDuringLoad,
        painAfterLoad: row.painAfterLoad,
      })),
  };
}

function describePrescription(row: {
  sets: number;
  reps: number | null;
  loadKg: string | null;
  holdSeconds: string | null;
  boxHeightCm: string | null;
}) {
  const parts = [
    row.reps === null ? `${row.sets} sets` : `${row.sets} x ${row.reps}`,
    row.loadKg === null ? null : `${Number(row.loadKg)} kg`,
    row.holdSeconds === null ? null : `${Number(row.holdSeconds)} s holds`,
    row.boxHeightCm === null ? null : `from ${Number(row.boxHeightCm)} cm`,
  ].filter(Boolean);
  return parts.join(", ");
}

function describePerformance(row: {
  reps: number | null;
  loadKg: string | null;
  holdSeconds: string | null;
  boxHeightCm: string | null;
}) {
  const parts = [
    row.reps === null ? null : `${row.reps} reps`,
    row.loadKg === null ? null : `${Number(row.loadKg)} kg`,
    row.holdSeconds === null ? null : `${Number(row.holdSeconds)} s hold`,
    row.boxHeightCm === null ? null : `from ${Number(row.boxHeightCm)} cm`,
  ].filter(Boolean);
  return parts.length ? parts.join(" at ") : "logged with no numbers";
}

function numeric(value: string | null): number | null {
  return value === null ? null : Number(value);
}

// -----------------------------------------------------------------------------
// The port
// -----------------------------------------------------------------------------

/**
 * The live port. Every embedding batch is on the meter.
 *
 * A failed batch, including one refused at the cap, degrades to one null per text
 * rather than failing the reflection, matching the port's contract: those proposals are
 * dropped, since they cannot be checked against what the owner stated, and the session
 * is still there for the next reflection to derive them from. A stated fact that could
 * not be re-embedded stays bare until a later reflection tries again.
 */
export function databasePort(db: Db = getDb(), label = "reflection"): MemoryPort {
  return {
    session: (sessionId) => loadReflectionSession(sessionId, db),
    facts: () => loadFacts({ db }),
    embed: async (texts) => {
      try {
        return await embedFacts(texts, { db });
      } catch (error) {
        console.error("Reflection could not embed; those texts stay without a vector.", error);
        return texts.map(() => null);
      }
    },
    billed: (usage, model) => recordSpend({ source: "app", label, model, usage }, db),
    indexed: (id, embedding) => storeEmbedding({ id, embedding }, { db }),
    apply: (input) => applyFactProposal(input, { db }),
  };
}

// -----------------------------------------------------------------------------
// The feed
// -----------------------------------------------------------------------------

export type MemoryFeed = {
  /** Awaiting the owner's decision, first because it is the only thing blocking. */
  pending: Embedded<MemoryFact>[];
  /** Live and in the prompt. */
  active: Embedded<MemoryFact>[];
  /** Superseded or deleted, kept so a wrong inference leaves a trace. */
  past: Embedded<MemoryFact>[];
};

/**
 * Every fact, split the three ways the screen shows them.
 *
 * `past` is not hidden. The plan's position is that safety here comes from
 * reversibility rather than caution, and a history of corrections is the only evidence
 * anyone has about whether reflection is worth running at all. A feed that showed only
 * the current facts would make the store look infallible.
 */
/**
 * How many facts are waiting on the owner, for the badge on `/plan`.
 *
 * Counted in SQL rather than by loading the feed, because the plan page has no other
 * use for the facts and `loadFacts` brings a 1536-float vector back with every row.
 */
export async function pendingFactCount(db: Db = getDb()): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(schema.memoryFacts)
    .where(
      and(
        eq(schema.memoryFacts.requiresConfirmation, true),
        isNull(schema.memoryFacts.confirmedAt),
        isNull(schema.memoryFacts.retiredAt),
        isNull(schema.memoryFacts.supersededById),
      ),
    );
  return row?.count ?? 0;
}

export async function memoryFeed(db: Db = getDb()): Promise<MemoryFeed> {
  const facts = await loadFacts({ db });
  return {
    pending: facts.filter(isPending),
    active: facts.filter(
      (fact) =>
        fact.retiredAt === null &&
        fact.supersededById === null &&
        !isPending(fact),
    ),
    past: facts.filter((fact) => fact.retiredAt !== null || fact.supersededById !== null),
  };
}
