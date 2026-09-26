import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { directoryOf, toEngineExercise } from "@/lib/engine/directory";
import type {
  ComplexItem,
  Directory,
  EngineExercise,
  MesocycleDeclaration,
  MicrocyclePlan,
  PlannedBlock,
  PlannedSession,
  TendonReading,
} from "@/lib/engine/types";
import type {
  Equipment,
  LoadType,
  MesocycleType,
  MotorAbility,
  MovementPattern,
  MuscleGroup,
  SessionKind,
} from "@/lib/taxonomy";

/**
 * Every database read the generator needs, in one place.
 *
 * Two kinds of caller: context assembly, which needs the whole state at once,
 * and the read-only tools, which answer one narrow question each. Both go
 * through here so that "what the model can see" is a list of functions in a
 * single file rather than a property of whichever prompt happens to be running.
 *
 * Numerics cross the driver as strings, so every one of them is converted on the
 * way out. Nothing in this file writes.
 */

export const DIRECTORY_COLUMNS = {
  id: schema.exercises.id,
  slug: schema.exercises.slug,
  name: schema.exercises.name,
  primaryMuscleGroup: schema.exercises.primaryMuscleGroup,
  secondaryMuscleGroups: schema.exercises.secondaryMuscleGroups,
  movementPattern: schema.exercises.movementPattern,
  forceVelocity: schema.exercises.forceVelocity,
  laterality: schema.exercises.laterality,
  couplingClass: schema.exercises.couplingClass,
  typicalContactSeconds: schema.exercises.typicalContactSeconds,
  highImpact: schema.exercises.highImpact,
  equipment: schema.exercises.equipment,
  equipmentAnyOf: schema.exercises.equipmentAnyOf,
  loadsTendonSites: schema.exercises.loadsTendonSites,
  tendonLoadRating: schema.exercises.tendonLoadRating,
  protocolPhase: schema.exercises.protocolPhase,
  technicalComplexity: schema.exercises.technicalComplexity,
  available: schema.exercises.available,
} as const;

export type AthleteProfile = {
  displayName: string | null;
  heightCm: number | null;
  reachCm: number | null;
  femurCm: number | null;
  tibiaCm: number | null;
  trainingAgeYears: number | null;
  dominantTakeoffLeg: string;
  jumperType: string;
  preferredArmSwing: string;
  goals: readonly string[];
  availableEquipment: readonly Equipment[];
  trainableWeekdays: readonly number[];
};

/**
 * The profile row, or conservative defaults when it has never been filled in.
 * An absent profile means no equipment, which the pre-filter reads literally as
 * bodyweight only; that is the right way to be wrong here.
 */
export async function loadProfile(db: Db = getDb()): Promise<AthleteProfile> {
  const [row] = await db
    .select()
    .from(schema.profile)
    .where(eq(schema.profile.id, 1))
    .limit(1);

  if (!row) {
    return {
      displayName: null,
      heightCm: null,
      reachCm: null,
      femurCm: null,
      tibiaCm: null,
      trainingAgeYears: null,
      dominantTakeoffLeg: "unknown",
      jumperType: "unknown",
      preferredArmSwing: "unknown",
      goals: [],
      availableEquipment: [],
      trainableWeekdays: [],
    };
  }

  const num = (value: string | null) => (value === null ? null : Number(value));
  return {
    displayName: row.displayName,
    heightCm: num(row.heightCm),
    reachCm: num(row.reachCm),
    femurCm: num(row.femurCm),
    tibiaCm: num(row.tibiaCm),
    trainingAgeYears: num(row.trainingAgeYears),
    dominantTakeoffLeg: row.dominantTakeoffLeg,
    jumperType: row.jumperType,
    preferredArmSwing: row.preferredArmSwing,
    goals: row.goals,
    availableEquipment: row.availableEquipment as Equipment[],
    trainableWeekdays: row.trainableWeekdays,
  };
}

/** The whole directory, including unavailable rows: the pre-filter removes those. */
export async function loadDirectory(db: Db = getDb()): Promise<{
  exercises: EngineExercise[];
  directory: Directory;
}> {
  const rows = await db
    .select(DIRECTORY_COLUMNS)
    .from(schema.exercises)
    .orderBy(asc(schema.exercises.id));
  const exercises = rows.map(toEngineExercise);
  return { exercises, directory: directoryOf(exercises) };
}

/** Tendon check-ins over the window the pre-filter's pain trend reads. */
export async function loadTendonReadings(
  days = 28,
  db: Db = getDb(),
): Promise<TendonReading[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({
      site: schema.tendonStatus.site,
      recordedAt: schema.tendonStatus.recordedAt,
      painDuringLoad: schema.tendonStatus.painDuringLoad,
      painAfterLoad: schema.tendonStatus.painAfterLoad,
      morningStiffness: schema.tendonStatus.morningStiffness,
      protocolPhase: schema.tendonStatus.protocolPhase,
    })
    .from(schema.tendonStatus)
    .where(gte(schema.tendonStatus.recordedAt, since))
    .orderBy(asc(schema.tendonStatus.recordedAt));
  return rows;
}

export type ReadinessDay = {
  day: string;
  recoveryScore: number | null;
  hrvMs: number | null;
  restingHeartRate: number | null;
  sleepMinutes: number | null;
  sleepPerformancePct: number | null;
  dayStrain: number | null;
  motivation: number | null;
  priorSessionRpe: number | null;
  sorenessByRegion: Record<string, number>;
  notes: string | null;
};

export async function loadReadiness(
  days = 14,
  db: Db = getDb(),
): Promise<ReadinessDay[]> {
  const rows = await db
    .select()
    .from(schema.readinessCheckins)
    .orderBy(desc(schema.readinessCheckins.day))
    .limit(days);
  return rows
    .map((row) => ({
      day: row.day,
      recoveryScore: row.recoveryScore,
      hrvMs: row.hrvMs === null ? null : Number(row.hrvMs),
      restingHeartRate: row.restingHeartRate,
      sleepMinutes: row.sleepMinutes,
      sleepPerformancePct: row.sleepPerformancePct,
      dayStrain: row.dayStrain === null ? null : Number(row.dayStrain),
      motivation: row.motivation,
      priorSessionRpe:
        row.priorSessionRpe === null ? null : Number(row.priorSessionRpe),
      sorenessByRegion: row.sorenessByRegion,
      notes: row.notes,
    }))
    .reverse();
}

export type VolumeRow = {
  muscleGroup: MuscleGroup;
  movementPattern: MovementPattern;
  sets: number;
  contacts: number;
};

/**
 * Logged sets over a window, grouped the way the microcycle rules think: primary
 * mover and coordination pattern. `contacts` counts only high-impact reps, which
 * is the number the tendon load ceiling is about.
 */
export async function loadRecentVolume(
  days = 28,
  db: Db = getDb(),
): Promise<VolumeRow[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({
      muscleGroup: schema.exercises.primaryMuscleGroup,
      movementPattern: schema.exercises.movementPattern,
      sets: sql<string>`count(*)`,
      contacts: sql<string>`coalesce(sum(case when ${schema.exercises.highImpact} then coalesce(${schema.loggedSets.reps}, 0) else 0 end), 0)`,
    })
    .from(schema.loggedSets)
    .innerJoin(schema.exercises, eq(schema.loggedSets.exerciseId, schema.exercises.id))
    .where(gte(schema.loggedSets.performedAt, since))
    .groupBy(schema.exercises.primaryMuscleGroup, schema.exercises.movementPattern);
  return rows.map((row) => ({
    muscleGroup: row.muscleGroup,
    movementPattern: row.movementPattern,
    sets: Number(row.sets),
    contacts: Number(row.contacts),
  }));
}

export type PriorProposal = {
  id: number;
  scope: string;
  createdAt: Date;
  verdict: string;
  verdictReason: string | null;
  rationale: string | null;
  repairAttempts: number;
  isFallback: boolean;
  gateMessages: string[];
};

/**
 * Prior proposals and what the owner did with them. A rejection with a reason is
 * the strongest steer the generator has before the memory layer exists, so the
 * reason is carried through verbatim.
 */
export async function loadPriorProposals(
  limit = 8,
  db: Db = getDb(),
): Promise<PriorProposal[]> {
  const rows = await db
    .select({
      id: schema.planProposals.id,
      scope: schema.planProposals.scope,
      createdAt: schema.planProposals.createdAt,
      verdict: schema.planProposals.verdict,
      verdictReason: schema.planProposals.verdictReason,
      rationale: schema.planProposals.rationale,
      repairAttempts: schema.planProposals.repairAttempts,
      isFallback: schema.planProposals.isFallback,
      gateReport: schema.planProposals.gateReport,
    })
    .from(schema.planProposals)
    .orderBy(desc(schema.planProposals.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    scope: row.scope,
    createdAt: row.createdAt,
    verdict: row.verdict,
    verdictReason: row.verdictReason,
    rationale: row.rationale,
    repairAttempts: row.repairAttempts,
    isFallback: row.isFallback,
    gateMessages: gateMessagesOf(row.gateReport),
  }));
}

/** The gate report is stored as JSON, so its shape is checked rather than assumed. */
function gateMessagesOf(report: unknown): string[] {
  const violations =
    report !== null && typeof report === "object" && "violations" in report
      ? (report as { violations: unknown }).violations
      : report;
  if (!Array.isArray(violations)) return [];
  return violations
    .map((entry) =>
      entry !== null && typeof entry === "object" && "message" in entry
        ? String((entry as { message: unknown }).message)
        : null,
    )
    .filter((message): message is string => message !== null);
}

// -----------------------------------------------------------------------------
// Reconstructing plans out of the tables they were written to
// -----------------------------------------------------------------------------

/**
 * Sessions with their blocks and prescriptions, as `PlannedSession`.
 *
 * The gate reads prior weeks and the session before this one, and the fallback
 * reads the last accepted session, so the write-side tables have to be readable
 * back into the shape the engine takes. Three queries rather than a join, so a
 * session with no blocks does not disappear and a block with no sets does not
 * collapse the row.
 */
async function loadSessionPlans(
  sessionIds: readonly number[],
  db: Db,
): Promise<Map<number, PlannedSession>> {
  const plans = new Map<number, PlannedSession>();
  if (sessionIds.length === 0) return plans;

  const sessions = await db
    .select({
      id: schema.sessions.id,
      day: schema.sessions.day,
      kind: schema.sessions.kind,
      title: schema.sessions.title,
      plannedIntensity: schema.sessions.plannedIntensity,
    })
    .from(schema.sessions)
    .where(inArray(schema.sessions.id, [...sessionIds]))
    .orderBy(asc(schema.sessions.day), asc(schema.sessions.id));

  const blocks = await db
    .select({
      id: schema.sessionBlocks.id,
      sessionId: schema.sessionBlocks.sessionId,
      label: schema.sessionBlocks.label,
      pairedWithBlockId: schema.sessionBlocks.pairedWithBlockId,
    })
    .from(schema.sessionBlocks)
    .where(inArray(schema.sessionBlocks.sessionId, [...sessionIds]))
    .orderBy(asc(schema.sessionBlocks.sessionId), asc(schema.sessionBlocks.position));

  const blockIds = blocks.map((block) => block.id);
  const sets = blockIds.length
    ? await db
        .select()
        .from(schema.prescribedSets)
        .where(inArray(schema.prescribedSets.blockId, blockIds))
        .orderBy(asc(schema.prescribedSets.blockId), asc(schema.prescribedSets.position))
    : [];

  const setsByBlock = new Map<number, typeof sets>();
  for (const set of sets) {
    setsByBlock.set(set.blockId, [...(setsByBlock.get(set.blockId) ?? []), set]);
  }

  const blocksBySession = new Map<number, PlannedBlock[]>();
  for (const block of blocks) {
    const items = (setsByBlock.get(block.id) ?? []).map((set) => ({
      exerciseId: set.exerciseId,
      sets: set.sets,
      reps: set.reps,
      holdSeconds: set.holdSeconds === null ? null : Number(set.holdSeconds),
      loadPctOf1rm: set.loadPctOf1rm,
      loadKg: set.loadKg === null ? null : Number(set.loadKg),
      boxHeightCm: set.boxHeightCm === null ? null : Number(set.boxHeightCm),
      targetRpe: set.targetRpe === null ? null : Number(set.targetRpe),
      tempo: set.tempo,
      restSeconds: set.restSeconds,
      couplingClass: set.couplingClass,
      shockMethod: null,
    }));
    // A block with no prescriptions cannot be represented: `PlannedBlock.items`
    // is non-empty by construction, and an empty one carries no information.
    if (items.length === 0) continue;
    blocksBySession.set(block.sessionId, [
      ...(blocksBySession.get(block.sessionId) ?? []),
      {
        label: block.label,
        complexPair: block.pairedWithBlockId !== null,
        items,
      },
    ]);
  }

  for (const session of sessions) {
    plans.set(session.id, {
      day: session.day,
      kind: session.kind,
      title: session.title,
      // Every generated session carries one; a null here is an ad-hoc session,
      // and 5 keeps it out of both the intense and the trivial band.
      plannedIntensity: session.plannedIntensity ?? 5,
      blocks: blocksBySession.get(session.id) ?? [],
    });
  }
  return plans;
}

export type BlockState = {
  mesocycleId: number;
  macrocycleId: number;
  startDate: string;
  ordinal: number;
  declaration: MesocycleDeclaration;
  /** Weeks already generated in this block, oldest first. */
  priorWeeks: MicrocyclePlan[];
  /** The last session before the next week starts, for the week-boundary check. */
  priorSession: PlannedSession | null;
};

/** The open block: the newest mesocycle that has not been closed. */
export async function loadOpenBlock(db: Db = getDb()): Promise<BlockState | null> {
  const [meso] = await db
    .select()
    .from(schema.mesocycles)
    .where(sql`${schema.mesocycles.closedAt} is null`)
    .orderBy(desc(schema.mesocycles.startDate), desc(schema.mesocycles.id))
    .limit(1);
  if (!meso) return null;
  return loadBlock(meso.id, db);
}

export async function loadBlock(
  mesocycleId: number,
  db: Db = getDb(),
): Promise<BlockState | null> {
  const [meso] = await db
    .select()
    .from(schema.mesocycles)
    .where(eq(schema.mesocycles.id, mesocycleId))
    .limit(1);
  if (!meso) return null;

  const complex = await loadComplex(mesocycleId, db);

  const weekRows = await db
    .select()
    .from(schema.microcycles)
    .where(eq(schema.microcycles.mesocycleId, mesocycleId))
    .orderBy(asc(schema.microcycles.ordinal));

  const sessionRows = weekRows.length
    ? await db
        .select({ id: schema.sessions.id, microcycleId: schema.sessions.microcycleId })
        .from(schema.sessions)
        .where(
          inArray(
            schema.sessions.microcycleId,
            weekRows.map((week) => week.id),
          ),
        )
    : [];

  const plans = await loadSessionPlans(
    sessionRows.map((row) => row.id),
    db,
  );

  const priorWeeks: MicrocyclePlan[] = weekRows.map((week) => ({
    ordinal: week.ordinal,
    startDate: week.startDate,
    loadType: week.loadType as LoadType,
    relativeLoad: week.relativeLoad === null ? 1 : Number(week.relativeLoad),
    sessions: sessionRows
      .filter((row) => row.microcycleId === week.id)
      .map((row) => plans.get(row.id))
      .filter((plan): plan is PlannedSession => plan !== undefined)
      .sort((a, b) => a.day.localeCompare(b.day)),
  }));

  const lastWeek = priorWeeks.at(-1);
  const priorSession = lastWeek?.sessions.at(-1) ?? null;

  return {
    mesocycleId: meso.id,
    macrocycleId: meso.macrocycleId,
    startDate: meso.startDate,
    ordinal: meso.ordinal,
    declaration: {
      type: meso.type as MesocycleType,
      plannedMicrocycles: meso.plannedMicrocycles,
      targetAbilities: meso.targetAbilities as MotorAbility[],
      technicalFocus: meso.technicalFocus ? [meso.technicalFocus] : [],
      complex,
    },
    priorWeeks,
    priorSession,
  };
}

export async function loadComplex(
  mesocycleId: number,
  db: Db = getDb(),
): Promise<ComplexItem[]> {
  const rows = await db
    .select({
      exerciseId: schema.exerciseComplexItems.exerciseId,
      isMain: schema.exerciseComplexItems.isMain,
      targetWeeklyFrequency: schema.exerciseComplexItems.targetWeeklyFrequency,
    })
    .from(schema.exerciseComplexItems)
    .innerJoin(
      schema.exerciseComplexes,
      eq(schema.exerciseComplexItems.complexId, schema.exerciseComplexes.id),
    )
    .where(eq(schema.exerciseComplexes.mesocycleId, mesocycleId))
    .orderBy(asc(schema.exerciseComplexItems.id));
  return rows;
}

/**
 * The newest session of a kind that came from an accepted plan, which is what
 * the terminal fallback ships when the repair loop never converges.
 */
export async function loadLastPlannedSession(
  kind: SessionKind,
  db: Db = getDb(),
): Promise<PlannedSession | null> {
  const [row] = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.kind, kind), isNotNull(schema.sessions.microcycleId)))
    .orderBy(desc(schema.sessions.day), desc(schema.sessions.id))
    .limit(1);
  if (!row) return null;
  const plans = await loadSessionPlans([row.id], db);
  const plan = plans.get(row.id) ?? null;
  // A session whose prescriptions were deleted is no use as a fallback.
  return plan && plan.blocks.length > 0 ? plan : null;
}

/**
 * A planned session with the week and block it came out of, which is what Today
 * shows: the prescription is only half the answer, and the other half is which
 * week of which block it belongs to and why that week loads the way it does.
 */
export type PlannedDay = {
  sessionId: number;
  session: PlannedSession;
  completedAt: Date | null;
  skippedAt: Date | null;
  week: {
    microcycleId: number;
    ordinal: number;
    loadType: LoadType;
    relativeLoad: number;
    rationale: string | null;
  };
  block: {
    mesocycleId: number;
    ordinal: number;
    type: MesocycleType;
    technicalFocus: string | null;
  };
};

/**
 * Every planned session on a day. Plural because a second workout on the same day
 * is a second session, the same way the log treats it.
 */
export async function loadPlannedDay(
  day: string,
  db: Db = getDb(),
): Promise<PlannedDay[]> {
  const rows = await db
    .select({
      sessionId: schema.sessions.id,
      completedAt: schema.sessions.completedAt,
      skippedAt: schema.sessions.skippedAt,
      microcycleId: schema.microcycles.id,
      weekOrdinal: schema.microcycles.ordinal,
      loadType: schema.microcycles.loadType,
      relativeLoad: schema.microcycles.relativeLoad,
      rationale: schema.microcycles.rationale,
      mesocycleId: schema.mesocycles.id,
      blockOrdinal: schema.mesocycles.ordinal,
      type: schema.mesocycles.type,
      technicalFocus: schema.mesocycles.technicalFocus,
    })
    .from(schema.sessions)
    .innerJoin(
      schema.microcycles,
      eq(schema.sessions.microcycleId, schema.microcycles.id),
    )
    .innerJoin(
      schema.mesocycles,
      eq(schema.microcycles.mesocycleId, schema.mesocycles.id),
    )
    .where(eq(schema.sessions.day, day))
    .orderBy(asc(schema.sessions.id));

  const plans = await loadSessionPlans(
    rows.map((row) => row.sessionId),
    db,
  );

  return rows.flatMap((row) => {
    const session = plans.get(row.sessionId);
    if (!session) return [];
    return [
      {
        sessionId: row.sessionId,
        session,
        completedAt: row.completedAt,
        skippedAt: row.skippedAt,
        week: {
          microcycleId: row.microcycleId,
          ordinal: row.weekOrdinal,
          loadType: row.loadType as LoadType,
          relativeLoad: row.relativeLoad === null ? 1 : Number(row.relativeLoad),
          rationale: row.rationale,
        },
        block: {
          mesocycleId: row.mesocycleId,
          ordinal: row.blockOrdinal,
          type: row.type as MesocycleType,
          technicalFocus: row.technicalFocus,
        },
      },
    ];
  });
}
