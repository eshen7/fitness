import { and, desc, eq, isNull, lt } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { itemsOf, setsIn } from "@/lib/engine/classify";
import {
  mesocycleDeclarationSchema,
  microcyclePlanSchema,
  type Advisory,
  type Change,
  type Directory,
  type MesocycleDeclaration,
  type MicrocyclePlan,
  type PlannedSession,
} from "@/lib/engine/types";
import type { ProposalVerdict } from "@/lib/taxonomy";
import type { AiUsage } from "./client";
import {
  advisoryStrings,
  repairAttemptsOf,
  type DeclarationRun,
  type GenerationAsk,
  type WeekRun,
} from "./generate";

/**
 * Everything the generator writes.
 *
 * Two separate acts, deliberately separate rows. Generating writes a
 * `plan_proposals` row and nothing else: a proposal is a record of what was asked
 * for, what came back, what the normalizer changed and what the gate said, and it
 * is worth keeping whether or not the owner ever accepts it. Accepting is what
 * writes the plan tree, and it happens later, from the review UI.
 *
 * A regeneration is a new row that points at the one it replaces rather than an
 * update, because the reason a week was regenerated is training signal and an
 * overwrite destroys it.
 *
 * Numerics cross the driver as strings, so every one of them is `.toFixed`ed on
 * the way in at exactly the scale its column declares.
 */

/** A transaction or the pool: every writer here takes either. */
type Writer = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

// -----------------------------------------------------------------------------
// The proposal row
// -----------------------------------------------------------------------------

/**
 * What ships for a week: the plan that passed, or the fallback when nothing did.
 *
 * `week` is null only when the loop failed and there was no history to fall back
 * on, which the review UI shows as the violations and nothing else.
 */
export function shippedWeek(run: WeekRun): {
  week: MicrocyclePlan | null;
  isFallback: boolean;
} {
  if (run.passed && run.week) return { week: run.week, isFallback: false };
  if (run.fallback) return { week: run.fallback, isFallback: true };
  return { week: null, isFallback: false };
}

/** The gate's last word, plus the trail that got there. */
function gateReportOf(run: DeclarationRun | WeekRun) {
  return {
    violations: run.attempts.at(-1)?.violations ?? [],
    attempts: run.attempts,
  };
}

function usageOf(usage: AiUsage) {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    reasoningTokens: usage.reasoningTokens,
  };
}

/**
 * Stores one generation. Returns the proposal id, which is what the review UI
 * addresses it by.
 *
 * `supersedesId` marks a regeneration: the row it replaces is moved to
 * `superseded` if the owner had not already ruled on it, so the two never both
 * look like they are awaiting a verdict.
 */
export async function saveProposal(input: {
  run: DeclarationRun | WeekRun;
  /** The block a week belongs to. Null for a declaration, which creates one. */
  mesocycleId?: number | null;
  supersedesId?: number | null;
  db?: Db;
}): Promise<number> {
  const db = input.db ?? getDb();
  const { run } = input;
  const shipped = run.scope === "microcycle" ? shippedWeek(run) : null;

  return db.transaction(async (tx) => {
    if (input.supersedesId != null) {
      await tx
        .update(schema.planProposals)
        .set({ verdict: "superseded", verdictAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(schema.planProposals.id, input.supersedesId),
            eq(schema.planProposals.verdict, "pending"),
          ),
        );
    }

    const [row] = await tx
      .insert(schema.planProposals)
      .values({
        scope: run.scope,
        mesocycleId: input.mesocycleId ?? null,
        inputs: { ...run.inputs, ask: run.ask },
        // The raw proposal, before the normalizer. Null only when no attempt
        // parsed, and the column is not null, so the absence is spelled out.
        proposal: run.proposal ?? { error: "No attempt produced a parseable plan." },
        normalized: run.scope === "microcycle" ? shipped?.week : run.declaration,
        normalizerDiff: run.scope === "microcycle" ? run.changes : [],
        gateReport: gateReportOf(run),
        advisories: run.scope === "microcycle" ? advisoryStrings(run) : [],
        rationale: run.rationale,
        claimedConstraints: run.claimedConstraints,
        repairAttempts: repairAttemptsOf(run),
        isFallback: shipped?.isFallback ?? false,
        supersedesId: input.supersedesId ?? null,
        model: run.model,
        usage: usageOf(run.usage),
      })
      .returning({ id: schema.planProposals.id });
    return row.id;
  });
}

// -----------------------------------------------------------------------------
// Accepting
// -----------------------------------------------------------------------------

type ProposalRow = {
  id: number;
  scope: string;
  mesocycleId: number | null;
  microcycleId: number | null;
  normalized: unknown;
  inputs: unknown;
  rationale: string | null;
  verdict: string;
};

async function loadProposal(proposalId: number, tx: Writer): Promise<ProposalRow> {
  const [row] = await tx
    .select({
      id: schema.planProposals.id,
      scope: schema.planProposals.scope,
      mesocycleId: schema.planProposals.mesocycleId,
      microcycleId: schema.planProposals.microcycleId,
      normalized: schema.planProposals.normalized,
      inputs: schema.planProposals.inputs,
      rationale: schema.planProposals.rationale,
      verdict: schema.planProposals.verdict,
    })
    .from(schema.planProposals)
    .where(eq(schema.planProposals.id, proposalId))
    .limit(1);
  if (!row) throw new Error(`No proposal ${proposalId}.`);
  return row;
}

/** The ask, read back off the stored inputs. */
function askOf(inputs: unknown): GenerationAsk {
  const ask =
    inputs !== null && typeof inputs === "object" && "ask" in inputs
      ? (inputs as { ask: unknown }).ask
      : null;
  if (
    ask === null ||
    typeof ask !== "object" ||
    !("startDate" in ask) ||
    !("ordinal" in ask)
  ) {
    throw new Error("The stored proposal has no ask, so there is no date to write it on.");
  }
  const typed = ask as GenerationAsk;
  return {
    ordinal: Number(typed.ordinal),
    startDate: String(typed.startDate),
    weeks: typed.weeks == null ? null : Number(typed.weeks),
    note: typed.note ?? null,
  };
}

/**
 * The macrocycle a new block joins.
 *
 * `mesocycles.macrocycle_id` is not null, so declaring the first block of a
 * database has to create the season it sits in. An open macrocycle is reused
 * rather than a new one opened per block, because a macrocycle is a season and
 * the app has no other way to be told when one ends.
 */
async function ensureMacrocycle(startDate: string, tx: Writer): Promise<number> {
  const [open] = await tx
    .select({ id: schema.macrocycles.id })
    .from(schema.macrocycles)
    .where(isNull(schema.macrocycles.endDate))
    .orderBy(desc(schema.macrocycles.startDate), desc(schema.macrocycles.id))
    .limit(1);
  if (open) return open.id;

  const [created] = await tx
    .insert(schema.macrocycles)
    .values({ name: `Season ${startDate.slice(0, 4)}`, startDate })
    .returning({ id: schema.macrocycles.id });
  return created.id;
}

/**
 * A free ordinal within the macrocycle.
 *
 * The asked-for ordinal is what the model saw, so it is used when it is free.
 * `(macrocycle_id, ordinal)` is unique, though, and a second block declared for
 * the same slot is a retry rather than an error worth surfacing, so it takes the
 * next number instead of failing the accept.
 */
async function freeOrdinal(
  macrocycleId: number,
  wanted: number,
  tx: Writer,
): Promise<number> {
  const rows = await tx
    .select({ ordinal: schema.mesocycles.ordinal })
    .from(schema.mesocycles)
    .where(eq(schema.mesocycles.macrocycleId, macrocycleId));
  const taken = new Set(rows.map((row) => row.ordinal));
  if (!taken.has(wanted)) return wanted;
  let next = Math.max(0, ...taken) + 1;
  while (taken.has(next)) next += 1;
  return next;
}

/**
 * Writes an accepted block: the mesocycle, its stable complex, and the verdict.
 *
 * Any earlier block still left open in the same macrocycle is closed, because
 * "the open block" is how every later generation finds its declaration and two of
 * them open at once makes that lookup arbitrary.
 */
export async function acceptDeclaration(input: {
  proposalId: number;
  /** Set when the owner changed the declaration before accepting. */
  edited?: MesocycleDeclaration | null;
  ownerEdits?: unknown;
  db?: Db;
}): Promise<{ mesocycleId: number }> {
  const db = input.db ?? getDb();

  return db.transaction(async (tx) => {
    const row = await loadProposal(input.proposalId, tx);
    if (row.scope !== "mesocycle") {
      throw new Error(`Proposal ${row.id} is a ${row.scope} proposal, not a block.`);
    }
    const declaration =
      input.edited ?? mesocycleDeclarationSchema.parse(row.normalized);
    const ask = askOf(row.inputs);

    const macrocycleId = await ensureMacrocycle(ask.startDate, tx);
    await tx
      .update(schema.mesocycles)
      .set({ closedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.mesocycles.macrocycleId, macrocycleId),
          isNull(schema.mesocycles.closedAt),
          lt(schema.mesocycles.startDate, ask.startDate),
        ),
      );

    const [meso] = await tx
      .insert(schema.mesocycles)
      .values({
        macrocycleId,
        ordinal: await freeOrdinal(macrocycleId, ask.ordinal, tx),
        type: declaration.type,
        startDate: ask.startDate,
        plannedMicrocycles: declaration.plannedMicrocycles,
        targetAbilities: [...declaration.targetAbilities],
        // The gate holds the declaration to one technical feature, so the column
        // is singular and this is the accepted value rather than a truncation.
        technicalFocus: declaration.technicalFocus[0] ?? null,
        rationale: row.rationale,
      })
      .returning({ id: schema.mesocycles.id });

    const [complex] = await tx
      .insert(schema.exerciseComplexes)
      .values({ mesocycleId: meso.id })
      .returning({ id: schema.exerciseComplexes.id });

    if (declaration.complex.length) {
      await tx.insert(schema.exerciseComplexItems).values(
        declaration.complex.map((item) => ({
          complexId: complex.id,
          exerciseId: item.exerciseId,
          isMain: item.isMain,
          targetWeeklyFrequency: item.targetWeeklyFrequency ?? 2,
        })),
      );
    }

    await settle(tx, {
      proposalId: row.id,
      verdict: input.edited ? "edited" : "accepted",
      ownerEdits: input.ownerEdits,
      mesocycleId: meso.id,
    });

    return { mesocycleId: meso.id };
  });
}

/**
 * Writes an accepted week: the microcycle, its sessions, their blocks and every
 * prescription, then the verdict.
 *
 * `changes` and `advisories` are passed in rather than read off the row because an
 * owner edit is re-normalized and re-gated before it gets here, and storing the
 * original run's diff against an edited plan would describe a plan that was never
 * written.
 */
export async function acceptWeek(input: {
  proposalId: number;
  directory: Directory;
  /** Set when the owner changed the week before accepting. */
  edited?: MicrocyclePlan | null;
  changes?: readonly Change[];
  advisories?: readonly Advisory[];
  ownerEdits?: unknown;
  db?: Db;
}): Promise<{ microcycleId: number }> {
  const db = input.db ?? getDb();

  return db.transaction(async (tx) => {
    const row = await loadProposal(input.proposalId, tx);
    if (row.scope !== "microcycle") {
      throw new Error(`Proposal ${row.id} is a ${row.scope} proposal, not a week.`);
    }
    if (row.mesocycleId === null) {
      throw new Error(`Proposal ${row.id} names no block, so its week has nowhere to go.`);
    }
    const week = input.edited ?? microcyclePlanSchema.parse(row.normalized);

    const [micro] = await tx
      .insert(schema.microcycles)
      .values({
        mesocycleId: row.mesocycleId,
        ordinal: week.ordinal,
        startDate: week.startDate,
        loadType: week.loadType,
        relativeLoad: week.relativeLoad.toFixed(2),
        rationale: row.rationale,
      })
      .returning({ id: schema.microcycles.id });

    for (const session of week.sessions) {
      await writeSession(tx, micro.id, session, input.directory);
    }

    await settle(tx, {
      proposalId: row.id,
      verdict: input.edited ? "edited" : "accepted",
      ownerEdits: input.ownerEdits,
      microcycleId: micro.id,
      changes: input.changes,
      advisories: input.advisories,
      normalized: input.edited ?? undefined,
    });

    return { microcycleId: micro.id };
  });
}

async function writeSession(
  tx: Writer,
  microcycleId: number,
  session: PlannedSession,
  directory: Directory,
) {
  const [row] = await tx
    .insert(schema.sessions)
    .values({
      microcycleId,
      day: session.day,
      kind: session.kind,
      title: session.title ?? null,
      plannedIntensity: session.plannedIntensity,
      plannedSets: setsIn(session),
      plannedContacts: contactsIn(session, directory),
    })
    .returning({ id: schema.sessions.id });

  for (const [index, block] of session.blocks.entries()) {
    const [blockRow] = await tx
      .insert(schema.sessionBlocks)
      .values({
        sessionId: row.id,
        // The normalizer owns the order, so array position is the position.
        position: index + 1,
        label: block.label,
      })
      .returning({ id: schema.sessionBlocks.id });

    // A complex-training pair is a pairing *inside* one block, so the block
    // points at itself: `pairedWithBlockId` being set is what the reader turns
    // back into `complexPair`, and there is no second block to name.
    if (block.complexPair) {
      await tx
        .update(schema.sessionBlocks)
        .set({ pairedWithBlockId: blockRow.id })
        .where(eq(schema.sessionBlocks.id, blockRow.id));
    }

    await tx.insert(schema.prescribedSets).values(
      block.items.map((item, position) => ({
        blockId: blockRow.id,
        position: position + 1,
        exerciseId: item.exerciseId,
        sets: item.sets,
        reps: item.reps ?? null,
        holdSeconds: item.holdSeconds == null ? null : item.holdSeconds.toFixed(1),
        loadKg: item.loadKg == null ? null : item.loadKg.toFixed(2),
        loadPctOf1rm: item.loadPctOf1rm ?? null,
        boxHeightCm: item.boxHeightCm == null ? null : item.boxHeightCm.toFixed(1),
        targetRpe: item.targetRpe == null ? null : item.targetRpe.toFixed(1),
        restSeconds: item.restSeconds ?? null,
        couplingClass: item.couplingClass ?? null,
        tempo: item.tempo ?? null,
      })),
    );
  }
}

/**
 * Planned high-impact contacts: reps, not sets, and only from exercises flagged
 * high impact. This is the number the tendon ceiling is about, counted the same
 * way `loadRecentVolume` counts the logged side so the two are comparable.
 */
function contactsIn(session: PlannedSession, directory: Directory) {
  return itemsOf(session).reduce((sum, item) => {
    const exercise = directory.get(item.exerciseId);
    if (!exercise?.highImpact) return sum;
    return sum + item.sets * (item.reps ?? 0);
  }, 0);
}

// -----------------------------------------------------------------------------
// Verdicts
// -----------------------------------------------------------------------------

async function settle(
  tx: Writer,
  input: {
    proposalId: number;
    verdict: ProposalVerdict;
    reason?: string | null;
    ownerEdits?: unknown;
    mesocycleId?: number;
    microcycleId?: number;
    changes?: readonly Change[];
    advisories?: readonly Advisory[];
    normalized?: MicrocyclePlan;
  },
) {
  await tx
    .update(schema.planProposals)
    .set({
      verdict: input.verdict,
      verdictReason: input.reason ?? null,
      verdictAt: new Date(),
      ownerEdits: input.ownerEdits ?? null,
      ...(input.mesocycleId === undefined ? {} : { mesocycleId: input.mesocycleId }),
      ...(input.microcycleId === undefined ? {} : { microcycleId: input.microcycleId }),
      ...(input.changes === undefined ? {} : { normalizerDiff: input.changes }),
      ...(input.advisories === undefined
        ? {}
        : { advisories: input.advisories.map((advisory) => advisory.message) }),
      ...(input.normalized === undefined ? {} : { normalized: input.normalized }),
      updatedAt: new Date(),
    })
    .where(eq(schema.planProposals.id, input.proposalId));
}

/**
 * A rejection with its reason. The reason is the strongest steer the generator
 * has, so it is required rather than optional: a bare "no" teaches nothing.
 */
export async function rejectProposal(input: {
  proposalId: number;
  reason: string;
  db?: Db;
}): Promise<void> {
  await settle(input.db ?? getDb(), {
    proposalId: input.proposalId,
    verdict: "rejected",
    reason: input.reason,
  });
}

