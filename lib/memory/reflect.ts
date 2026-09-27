import type { AiUsage } from "@/lib/ai/client";
import { reflectOnSession, type ProposedFact, type ReflectionSession } from "@/lib/ai/reflect";
import { unindexedStated, type Embedded, type FactProposal, type MemoryFact } from "./facts";
import type { FactOutcome } from "./store";

/**
 * The reflection pipeline: one finished session becomes zero or more memory facts.
 *
 * Written against a port for the same reason `lib/nutrition/resolve.ts` is: everything
 * interesting here is policy - which proposals are dropped, which are held for
 * confirmation, which supersede what - and policy tested through a database is policy
 * tested only when a container is running. `lib/memory/store.ts` is the part that
 * needs Postgres; this part is a unit test with a scripted client.
 *
 * The order of operations matters in one non-obvious place, marked below: the set of
 * existing facts grows as the reflection's own proposals land, so two paraphrases of
 * the same observation in one reflection collapse into one fact instead of both being
 * written and then sitting in the prompt contradicting nothing in particular.
 */

/**
 * Everything the pipeline needs, as a port.
 *
 * `embed` returns one entry per text, nullable, rather than throwing. A proposal with
 * no vector cannot be checked against what the owner stated, so `apply` drops it and
 * the next reflection can derive it again.
 *
 * `billed` puts the reflection call itself on the meter, and is called as soon as the
 * call returns, so a failure in anything after it cannot lose spend already incurred.
 *
 * `indexed` stores the vector for a stated fact that was written without one.
 */
export interface MemoryPort {
  /** The session as the prompt renders it, or null if there is no such session. */
  session(sessionId: number): Promise<ReflectionSession | null>;
  /** Every fact, so `isActive` can be applied here rather than in SQL. */
  facts(): Promise<Embedded<MemoryFact>[]>;
  embed(texts: readonly string[]): Promise<(number[] | null)[]>;
  billed(usage: AiUsage, model: string): Promise<void>;
  indexed(id: number, embedding: number[]): Promise<void>;
  apply(input: {
    proposal: FactProposal;
    embedding: number[] | null;
    existing: readonly Embedded<MemoryFact>[];
    derivedFromSessionId: number;
  }): Promise<FactOutcome>;
}

export type ReflectionOutcome = FactOutcome & { body: string };

export type ReflectionResult = {
  /** One per proposed fact, in the order the model proposed them. */
  outcomes: ReflectionOutcome[];
  summary: string | null;
  /** Null when no call was made, which is what `skipped` explains. */
  usage: AiUsage | null;
  model: string | null;
  /** Why nothing was done. Null on a reflection that ran. */
  skipped: string | null;
};

/**
 * Reflects on one session and applies whatever comes back.
 *
 * A reflection that proposes nothing is the expected outcome for an ordinary session
 * and costs one model call and no embeddings. That asymmetry is deliberate: the call
 * is unavoidable, since only a model can read a note, but the embedding is only needed
 * for facts that exist.
 */
export async function reflect(input: {
  sessionId: number;
  port: MemoryPort;
}): Promise<ReflectionResult> {
  const session = await input.port.session(input.sessionId);
  if (!session) {
    return {
      outcomes: [],
      summary: null,
      usage: null,
      model: null,
      skipped: `There is no session ${input.sessionId} to reflect on.`,
    };
  }

  const stored = await withStatedIndexed(input.port, await input.port.facts());
  // Only the live facts are shown to the model. A retired fact is one the owner
  // deleted, and putting it back in front of the model as "already remembered" is how
  // a corrected inference gets proposed again next week.
  const active = stored.filter(isLive);

  const result = await reflectOnSession({
    session,
    known: active.map((fact) => ({
      type: fact.type,
      body: fact.body,
      source: fact.source,
    })),
  });
  await input.port.billed(result.usage, result.model);

  const proposals = result.output.facts.map(toProposal);
  const embeddings = await input.port.embed(proposals.map((proposal) => proposal.body));

  // Grows as this reflection's own facts land. Without it, a model that says the same
  // thing twice in one answer writes it twice, and the deduplication that
  // `supersedes` exists for would only ever work across reflections.
  const existing = [...stored];
  const outcomes: ReflectionOutcome[] = [];

  for (const [index, proposal] of proposals.entries()) {
    const embedding = embeddings[index] ?? null;
    const outcome = await input.port.apply({
      proposal,
      embedding,
      existing,
      derivedFromSessionId: input.sessionId,
    });
    outcomes.push({ ...outcome, body: proposal.body });
    if (outcome.kind !== "dropped") {
      existing.push(
        projected({ outcome, proposal, embedding, sessionId: input.sessionId }),
      );
    }
  }

  return {
    outcomes,
    summary: result.output.summary,
    usage: result.usage,
    model: result.model,
    skipped: null,
  };
}

/**
 * The facts, with every live stated fact that was stored without a vector embedded now.
 *
 * Done before anything is checked against them, because each such fact pauses every
 * inference of its type. Through the same embedding port, so it is on the meter and
 * stops at the cap; a fact that still cannot be embedded stays bare, and its type
 * stays paused until a later reflection gets a vector for it.
 */
async function withStatedIndexed(
  port: MemoryPort,
  facts: Embedded<MemoryFact>[],
): Promise<Embedded<MemoryFact>[]> {
  const bare = unindexedStated(facts);
  if (bare.length === 0) return facts;

  const vectors = await port.embed(bare.map((fact) => fact.body));
  const found = new Map<number, number[]>();
  for (const [index, fact] of bare.entries()) {
    const vector = vectors[index];
    if (!vector) continue;
    await port.indexed(fact.id, vector);
    found.set(fact.id, vector);
  }
  return facts.map((fact) => {
    const vector = found.get(fact.id);
    return vector ? { ...fact, embedding: vector } : fact;
  });
}

/**
 * The fact that was just written, as the next proposal will see it.
 *
 * Constructed rather than read back, which keeps the loop to one round trip per fact.
 * Only the fields `supersedes` and `conflictsWithStated` actually read have to be
 * right, and they are the ones spelled out here; the rest are placeholders that
 * nothing in this function's lifetime looks at.
 */
function projected(input: {
  outcome: FactOutcome & { kind: "committed" | "pending" };
  proposal: FactProposal;
  embedding: number[] | null;
  sessionId: number;
}): Embedded<MemoryFact> {
  const now = new Date();
  return {
    id: input.outcome.id,
    type: input.proposal.type,
    body: input.proposal.body,
    source: "inferred",
    confidence: input.proposal.confidence,
    observations: input.proposal.observations,
    derivedFromSessionId: input.sessionId,
    derivedFromProposalId: null,
    supersedesId: input.outcome.supersedesId,
    supersededById: null,
    retiredAt: null,
    retiredReason: null,
    requiresConfirmation: input.outcome.kind === "pending",
    confirmationReason: input.outcome.kind === "pending" ? input.outcome.reason : null,
    confirmedAt: null,
    createdAt: now,
    embedding: input.embedding,
  };
}

/**
 * Whether a fact is still standing, which is a weaker test than `isActive`.
 *
 * A fact awaiting confirmation counts as live here on purpose. It is not in the
 * generator's prompt and it has superseded nothing, but it *is* in the queue, and a
 * reflection that could not see it would propose it again after every session until
 * the owner got round to the first one.
 */
function isLive(fact: MemoryFact): boolean {
  return fact.retiredAt === null && fact.supersededById === null;
}

/** The model's answer, clamped into the shape the store's gate reads. */
function toProposal(fact: ProposedFact): FactProposal {
  return {
    type: fact.type,
    body: fact.body.trim(),
    confidence: Math.min(1, Math.max(0, fact.confidence)),
    observations: fact.observations,
    tendonSites: [...new Set(fact.tendonSites)],
    retiresExerciseIds: [...new Set(fact.retiresExerciseIds)],
  };
}
