import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import { addDays } from "@/lib/days";
import type { Change, Directory, Violation } from "@/lib/engine/types";
import { hasApiKey, type AiUsage } from "./client";
import type { Attempt, GenerationAsk } from "./generate";
import { costOf, SPEND_CAP_USD } from "./pricing";
import { loadDirectory, loadOpenBlock, type BlockState } from "./queries";

/**
 * Reading proposals back out.
 *
 * Every jsonb field is checked rather than cast. These rows outlive the code that
 * wrote them, so a row written before a shape changed has to render as a row with
 * a missing field and not as a crashed page.
 */

export type StoredProposal = {
  id: number;
  scope: string;
  mesocycleId: number | null;
  microcycleId: number | null;
  createdAt: Date;
  ask: GenerationAsk | null;
  /** The two rendered prompt segments, so the owner can read what the model read. */
  stable: string;
  volatile: string;
  proposal: unknown;
  normalized: unknown;
  changes: Change[];
  violations: Violation[];
  /** The repair loop's trail: one entry per call, with what the gate said each time. */
  attempts: Attempt[];
  advisories: string[];
  rationale: string | null;
  claimedConstraints: string[];
  repairAttempts: number;
  isFallback: boolean;
  supersedesId: number | null;
  verdict: string;
  verdictReason: string | null;
  model: string | null;
  usage: AiUsage | null;
};

/** The newest proposal of a scope still awaiting a verdict. */
export async function loadPendingProposal(
  scope: "mesocycle" | "microcycle",
  db: Db = getDb(),
): Promise<StoredProposal | null> {
  const [row] = await db
    .select()
    .from(schema.planProposals)
    .where(
      and(
        eq(schema.planProposals.scope, scope),
        eq(schema.planProposals.verdict, "pending"),
      ),
    )
    .orderBy(desc(schema.planProposals.createdAt), desc(schema.planProposals.id))
    .limit(1);
  return row ? hydrate(row) : null;
}

export async function loadProposalById(
  id: number,
  db: Db = getDb(),
): Promise<StoredProposal | null> {
  const [row] = await db
    .select()
    .from(schema.planProposals)
    .where(eq(schema.planProposals.id, id))
    .limit(1);
  return row ? hydrate(row) : null;
}

/** Recent proposals of either scope, newest first. */
export async function loadProposalHistory(
  limit = 12,
  db: Db = getDb(),
): Promise<StoredProposal[]> {
  const rows = await db
    .select()
    .from(schema.planProposals)
    .orderBy(desc(schema.planProposals.createdAt), desc(schema.planProposals.id))
    .limit(limit);
  return rows.map(hydrate);
}

/** Every proposal in a block, oldest first. */
export async function loadBlockProposals(
  mesocycleId: number,
  db: Db = getDb(),
): Promise<StoredProposal[]> {
  const rows = await db
    .select()
    .from(schema.planProposals)
    .where(eq(schema.planProposals.mesocycleId, mesocycleId))
    .orderBy(asc(schema.planProposals.createdAt), asc(schema.planProposals.id));
  return rows.map(hydrate);
}

type ProposalSelect = typeof schema.planProposals.$inferSelect;

function hydrate(row: ProposalSelect): StoredProposal {
  const inputs = asRecord(row.inputs);
  const gate = asRecord(row.gateReport);
  return {
    id: row.id,
    scope: row.scope,
    mesocycleId: row.mesocycleId,
    microcycleId: row.microcycleId,
    createdAt: row.createdAt,
    ask: inputs?.ask ? (inputs.ask as GenerationAsk) : null,
    stable: typeof inputs?.stable === "string" ? inputs.stable : "",
    volatile: typeof inputs?.volatile === "string" ? inputs.volatile : "",
    proposal: row.proposal,
    normalized: row.normalized,
    changes: Array.isArray(row.normalizerDiff) ? (row.normalizerDiff as Change[]) : [],
    violations: Array.isArray(gate?.violations) ? (gate.violations as Violation[]) : [],
    attempts: Array.isArray(gate?.attempts) ? (gate.attempts as Attempt[]) : [],
    advisories: row.advisories,
    rationale: row.rationale,
    claimedConstraints: row.claimedConstraints,
    repairAttempts: row.repairAttempts,
    isFallback: row.isFallback,
    supersedesId: row.supersedesId,
    verdict: row.verdict,
    verdictReason: row.verdictReason,
    model: row.model,
    usage: row.usage
      ? {
          inputTokens: row.usage.inputTokens ?? 0,
          outputTokens: row.usage.outputTokens ?? 0,
          cachedInputTokens: row.usage.cachedInputTokens ?? 0,
          reasoningTokens: row.usage.reasoningTokens ?? 0,
        }
      : null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

// -----------------------------------------------------------------------------
// Slots and spend
// -----------------------------------------------------------------------------

/**
 * The ordinal the next block would take, for the prompt.
 *
 * Only a label at generation time: the accepted sequence is decided when a block
 * is written, because blocks can be declared and abandoned.
 */
export async function nextBlockOrdinal(db: Db = getDb()): Promise<number> {
  const [row] = await db
    .select({ ordinal: sql<number>`coalesce(max(${schema.mesocycles.ordinal}), 0)` })
    .from(schema.mesocycles);
  return Number(row?.ordinal ?? 0) + 1;
}

/** The next week's ordinal and the start date of the last one written. */
export async function nextWeekSlot(
  mesocycleId: number,
  db: Db = getDb(),
): Promise<{ ordinal: number; lastStartDate: string | null }> {
  const [row] = await db
    .select({
      ordinal: sql<number>`coalesce(max(${schema.microcycles.ordinal}), 0)`,
      lastStartDate: sql<string | null>`max(${schema.microcycles.startDate})::text`,
    })
    .from(schema.microcycles)
    .where(eq(schema.microcycles.mesocycleId, mesocycleId));
  return {
    ordinal: Number(row?.ordinal ?? 0) + 1,
    lastStartDate: row?.lastStartDate ?? null,
  };
}

/**
 * Everything spent on generation so far, from the stored usage and the model's
 * price.
 *
 * Derived rather than tracked, so it survives a restart and cannot drift from what
 * was actually billed for. Shown on the plan screen because a generator that bills
 * per call should say what it has cost without being asked.
 */
export async function totalSpendUsd(db: Db = getDb()): Promise<number> {
  const rows = await db
    .select({ model: schema.planProposals.model, usage: schema.planProposals.usage })
    .from(schema.planProposals);
  return rows.reduce((sum, row) => {
    if (!row.model || !row.usage) return sum;
    return (
      sum +
      costOf(row.model, {
        inputTokens: row.usage.inputTokens ?? 0,
        outputTokens: row.usage.outputTokens ?? 0,
        cachedInputTokens: row.usage.cachedInputTokens ?? 0,
        reasoningTokens: row.usage.reasoningTokens ?? 0,
      })
    );
  }, 0);
}

// -----------------------------------------------------------------------------

export type PlanSnapshot = {
  block: BlockState | null;
  directory: Directory;
  /** The proposal awaiting a verdict: a week if there is a block, else a block. */
  pending: StoredProposal | null;
  history: StoredProposal[];
  /** Where the next week would start, so the button can say the date. */
  nextWeek: { ordinal: number; startDate: string } | null;
  spendUsd: number;
  spendCapUsd: number;
  hasKey: boolean;
};

/** Everything `/plan` renders, in one round of queries. */
export async function planSnapshot(db: Db = getDb()): Promise<PlanSnapshot> {
  const [block, directory, spendUsd, history] = await Promise.all([
    loadOpenBlock(db),
    loadDirectory(db),
    totalSpendUsd(db),
    loadProposalHistory(12, db),
  ]);

  // With a block open the question is which week comes next; without one it is
  // whether to open a block at all, so only the matching scope is surfaced.
  const pending = block
    ? await loadPendingProposal("microcycle", db)
    : await loadPendingProposal("mesocycle", db);

  let nextWeek: PlanSnapshot["nextWeek"] = null;
  if (block) {
    const slot = await nextWeekSlot(block.mesocycleId, db);
    nextWeek = {
      ordinal: slot.ordinal,
      startDate: slot.lastStartDate ? addDays(slot.lastStartDate, 7) : block.startDate,
    };
  }

  return {
    block,
    directory: directory.directory,
    pending,
    history,
    nextWeek,
    spendUsd,
    spendCapUsd: SPEND_CAP_USD,
    hasKey: hasApiKey(),
  };
}
