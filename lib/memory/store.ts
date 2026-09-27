import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema, type Db } from "@/lib/db";
import type { MemoryFactType, MemorySource } from "@/lib/taxonomy";
import {
  confirmationReason,
  conflictsWithStated,
  isActive,
  supersedes,
  uncheckedAgainstStated,
  type Embedded,
  type FactProposal,
  type MemoryFact,
} from "./facts";

/**
 * Everything `memory_facts` reads and writes.
 *
 * The decisions live in `facts.ts` and the writing lives here, the same split as
 * `lib/analytics/`. What this file adds is transactional care, because supersession is
 * two rows changing together: the new fact points back at the one it replaces and the
 * old one points forward at the new. A half-applied supersession leaves both facts
 * active and contradicting each other in the prompt, which is the one outcome this
 * layer must never produce.
 *
 * Numerics cross the driver as strings, so confidence is `.toFixed(2)` on the way in
 * and `Number()` on the way out, matching its `numeric(3, 2)` column.
 */

type Writer = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

const FACT_COLUMNS = {
  id: schema.memoryFacts.id,
  type: schema.memoryFacts.type,
  body: schema.memoryFacts.body,
  source: schema.memoryFacts.source,
  confidence: schema.memoryFacts.confidence,
  observations: schema.memoryFacts.observations,
  derivedFromSessionId: schema.memoryFacts.derivedFromSessionId,
  derivedFromProposalId: schema.memoryFacts.derivedFromProposalId,
  supersedesId: schema.memoryFacts.supersedesId,
  supersededById: schema.memoryFacts.supersededById,
  retiredAt: schema.memoryFacts.retiredAt,
  retiredReason: schema.memoryFacts.retiredReason,
  requiresConfirmation: schema.memoryFacts.requiresConfirmation,
  confirmationReason: schema.memoryFacts.confirmationReason,
  confirmedAt: schema.memoryFacts.confirmedAt,
  embedding: schema.memoryFacts.embedding,
  createdAt: schema.memoryFacts.createdAt,
};

type FactRow = {
  id: number;
  type: string;
  body: string;
  source: string;
  confidence: string;
  observations: string[];
  derivedFromSessionId: number | null;
  derivedFromProposalId: number | null;
  supersedesId: number | null;
  supersededById: number | null;
  retiredAt: Date | null;
  retiredReason: string | null;
  requiresConfirmation: boolean;
  confirmationReason: string | null;
  confirmedAt: Date | null;
  embedding: number[] | null;
  createdAt: Date;
};

function toFact(row: FactRow): Embedded<MemoryFact> {
  return {
    id: row.id,
    type: row.type as MemoryFactType,
    body: row.body,
    source: row.source as MemorySource,
    confidence: Number(row.confidence),
    observations: row.observations ?? [],
    derivedFromSessionId: row.derivedFromSessionId,
    derivedFromProposalId: row.derivedFromProposalId,
    supersedesId: row.supersedesId,
    supersededById: row.supersededById,
    retiredAt: row.retiredAt,
    retiredReason: row.retiredReason,
    requiresConfirmation: row.requiresConfirmation,
    confirmationReason: row.confirmationReason,
    confirmedAt: row.confirmedAt,
    embedding: row.embedding,
    createdAt: row.createdAt,
  };
}

/**
 * Every fact, newest first, superseded and retired ones included.
 *
 * The whole table rather than a filtered view, and the reason is that there is one
 * athlete: this is a few dozen rows, all of the callers want a different subset of
 * them, and pushing the filters into SQL would buy nothing and put the definition of
 * "active" in two places. `isActive` in `facts.ts` is that definition, and it is the
 * only one.
 *
 * The embedding comes back with each row because supersession needs it. A 1536-float
 * vector per fact is a few hundred kilobytes across the whole store, which is cheaper
 * than a second round trip to fetch them.
 */
export async function loadFacts(options: { db?: Db } = {}): Promise<Embedded<MemoryFact>[]> {
  const db = options.db ?? getDb();
  const rows = await db
    .select(FACT_COLUMNS)
    .from(schema.memoryFacts)
    .orderBy(desc(schema.memoryFacts.createdAt), desc(schema.memoryFacts.id));
  return rows.map(toFact);
}

/** The live ones, for the prompt and for the reflection's "already remembered" list. */
export async function loadActiveFacts(
  options: { db?: Db } = {},
): Promise<Embedded<MemoryFact>[]> {
  return (await loadFacts(options)).filter(isActive);
}

// -----------------------------------------------------------------------------
// Writing
// -----------------------------------------------------------------------------

export type WriteFactInput = {
  type: MemoryFactType;
  body: string;
  source: MemorySource;
  confidence: number;
  observations: string[];
  embedding: number[] | null;
  derivedFromSessionId?: number | null;
  derivedFromProposalId?: number | null;
  /** The fact this one replaces. Both rows are linked in one transaction. */
  supersedesId?: number | null;
  /** Set by the caller from `confirmationReason`, never by the model. */
  requiresConfirmation?: boolean;
  /** That function's answer, stored so the queue can say why it is asking. */
  confirmationReason?: string | null;
  /**
   * Pre-confirmed. Only ever true for something the owner typed themselves, where
   * asking them to confirm what they just said would be theatre.
   */
  confirmed?: boolean;
};

/**
 * Writes one fact, linking the supersession from both ends in one transaction.
 *
 * Two conditions on that link, and both are about not losing knowledge to a write
 * nobody agreed to:
 *
 * - The old row is only marked superseded if it is still live. A fact the owner
 *   already retired stays retired, because the reason they gave is the more
 *   informative record and "replaced by an inference" would overwrite it.
 * - A fact still waiting for confirmation supersedes nothing yet. It points at its
 *   predecessor, so the link is recorded, but the predecessor stays active until the
 *   owner says yes. Otherwise an unapproved inference about tendon load would take
 *   the approved fact out of the prompt while sitting in the queue itself, which
 *   leaves the generator with neither.
 */
export async function writeFact(
  input: WriteFactInput,
  options: { db?: Db } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  return db.transaction(async (tx) => writeFactWith(tx, input));
}

async function writeFactWith(tx: Writer, input: WriteFactInput): Promise<number> {
  const held = (input.requiresConfirmation ?? false) && !input.confirmed;
  const [row] = await tx
    .insert(schema.memoryFacts)
    .values({
      type: input.type,
      body: input.body,
      source: input.source,
      confidence: input.confidence.toFixed(2),
      observations: input.observations,
      derivedFromSessionId: input.derivedFromSessionId ?? null,
      derivedFromProposalId: input.derivedFromProposalId ?? null,
      supersedesId: input.supersedesId ?? null,
      requiresConfirmation: input.requiresConfirmation ?? false,
      confirmationReason: input.confirmationReason ?? null,
      confirmedAt: input.confirmed ? new Date() : null,
      embedding: input.embedding,
    })
    .returning({ id: schema.memoryFacts.id });

  if (input.supersedesId != null && !held) {
    await linkSupersession(tx, { newId: row.id, oldId: input.supersedesId });
  }

  return row.id;
}

async function linkSupersession(tx: Writer, input: { newId: number; oldId: number }) {
  await tx
    .update(schema.memoryFacts)
    .set({ supersededById: input.newId, updatedAt: new Date() })
    .where(
      and(
        eq(schema.memoryFacts.id, input.oldId),
        isNull(schema.memoryFacts.supersededById),
        isNull(schema.memoryFacts.retiredAt),
      ),
    );
}

/**
 * Applies one proposed fact, deciding supersession and confirmation from the store as
 * it stands.
 *
 * Returns what happened rather than a bare id, because three of the four outcomes are
 * things the feed should be able to say: committed, queued for confirmation, replaced
 * an older fact, or dropped for contradicting something the owner stated or for
 * not being checkable against it.
 */
export type FactOutcome =
  /** Live now. `supersedesId` names the fact it retired, if any. */
  | { kind: "committed"; id: number; supersedesId: number | null }
  /** Written but inert until confirmed, at which point it retires `supersedesId`. */
  | { kind: "pending"; id: number; reason: string; supersedesId: number | null }
  /** Not written. `conflictsWith` is the stated fact it contradicted, if that is why. */
  | { kind: "dropped"; reason: string; conflictsWith: number | null };

export async function applyFactProposal(
  input: {
    proposal: FactProposal;
    embedding: number[] | null;
    existing: readonly Embedded<MemoryFact>[];
    derivedFromSessionId?: number | null;
    derivedFromProposalId?: number | null;
  },
  options: { db?: Db } = {},
): Promise<FactOutcome> {
  const { proposal, embedding, existing } = input;
  const embedded = { type: proposal.type, embedding };

  const unchecked = uncheckedAgainstStated(embedded, existing);
  if (unchecked) {
    console.warn(`Memory fact not written: "${proposal.body}". ${unchecked}`);
    return { kind: "dropped", reason: unchecked, conflictsWith: null };
  }

  const stated = conflictsWithStated(embedded, existing);
  if (stated) {
    return {
      kind: "dropped",
      reason: `The athlete already stated "${stated.body}", and a stated fact is never overwritten by an inference.`,
      conflictsWith: stated.id,
    };
  }

  const replaced = supersedes(embedded, existing);
  const reason = confirmationReason(proposal);

  const id = await writeFact(
    {
      type: proposal.type,
      body: proposal.body,
      source: "inferred",
      // Clamped rather than trusted: confidence is a number the model wrote, and one
      // above 1 would make a fact outrank the owner's own in every sort.
      confidence: Math.min(1, Math.max(0, proposal.confidence)),
      observations: proposal.observations,
      embedding,
      derivedFromSessionId: input.derivedFromSessionId ?? null,
      derivedFromProposalId: input.derivedFromProposalId ?? null,
      supersedesId: replaced?.id ?? null,
      requiresConfirmation: reason !== null,
      confirmationReason: reason,
    },
    options,
  );

  return reason === null
    ? { kind: "committed", id, supersedesId: replaced?.id ?? null }
    : { kind: "pending", id, reason, supersedesId: replaced?.id ?? null };
}

// -----------------------------------------------------------------------------
// The owner's three actions
// -----------------------------------------------------------------------------

/** Deletes a fact by retiring it. The row stays so the feed can show it was wrong. */
export async function retireFact(
  input: { id: number; reason: string },
  options: { db?: Db } = {},
): Promise<void> {
  const db = options.db ?? getDb();
  await db
    .update(schema.memoryFacts)
    .set({ retiredAt: new Date(), retiredReason: input.reason, updatedAt: new Date() })
    .where(eq(schema.memoryFacts.id, input.id));
}

/**
 * Corrects a fact: the owner's version is written as a *stated* fact superseding the
 * inference, and the inference is retired.
 *
 * A new row rather than an edit in place, and this is the mechanism the plan's
 * "safety comes from reversibility" rests on. An edit would leave no trace that the
 * app had inferred something wrong, and that trace is the only way anyone can tell
 * whether reflection is worth running. It also means the correction arrives with
 * `source = "stated"`, so no later inference can quietly undo it.
 */
export async function correctFact(
  input: { id: number; body: string; embedding: number[] | null },
  options: { db?: Db } = {},
): Promise<number> {
  const db = options.db ?? getDb();

  return db.transaction(async (tx) => {
    const [original] = await tx
      .select(FACT_COLUMNS)
      .from(schema.memoryFacts)
      .where(eq(schema.memoryFacts.id, input.id))
      .limit(1);
    if (!original) throw new Error(`No memory fact ${input.id}.`);

    const id = await writeFactWith(tx, {
      type: original.type as MemoryFactType,
      body: input.body,
      source: "stated",
      // The owner's own word, so there is nothing to be uncertain about.
      confidence: 1,
      observations: [`Corrected by the athlete from: "${original.body}"`],
      embedding: input.embedding,
      supersedesId: input.id,
      confirmed: true,
    });

    await tx
      .update(schema.memoryFacts)
      .set({
        retiredAt: new Date(),
        retiredReason: "Corrected by the athlete.",
        updatedAt: new Date(),
      })
      .where(eq(schema.memoryFacts.id, input.id));

    return id;
  });
}

/**
 * Approves a fact that was held back, and only now applies the supersession it was
 * carrying.
 *
 * The two halves belong in one transaction because the confirmation is what makes the
 * fact active: approving it without retiring its predecessor leaves two contradicting
 * facts in the prompt, and retiring the predecessor without approving it leaves none.
 */
export async function confirmFact(
  input: { id: number },
  options: { db?: Db } = {},
): Promise<void> {
  const db = options.db ?? getDb();

  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.memoryFacts)
      .set({ confirmedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.memoryFacts.id, input.id),
          isNull(schema.memoryFacts.confirmedAt),
          isNull(schema.memoryFacts.retiredAt),
        ),
      )
      .returning({ supersedesId: schema.memoryFacts.supersedesId });

    // No row means it was already confirmed or already retired, both of which are a
    // second tap on the same button rather than an error worth surfacing.
    if (row?.supersedesId != null) {
      await linkSupersession(tx, { newId: input.id, oldId: row.supersedesId });
    }
  });
}

/**
 * Records something the owner told the app directly.
 *
 * Confirmed on arrival regardless of what it says. The confirmation gate exists
 * because an *inference* about tendon load should not act unasked; the owner typing
 * one is the asking.
 */
export async function stateFact(
  input: {
    type: MemoryFactType;
    body: string;
    embedding: number[] | null;
    supersedesId?: number | null;
  },
  options: { db?: Db } = {},
): Promise<number> {
  return writeFact(
    {
      type: input.type,
      body: input.body,
      source: "stated",
      confidence: 1,
      observations: [],
      embedding: input.embedding,
      supersedesId: input.supersedesId ?? null,
      confirmed: true,
    },
    options,
  );
}
