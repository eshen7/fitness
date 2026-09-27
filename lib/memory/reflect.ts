import type { AiUsage } from "@/lib/ai/client";
import { reflectOnSession, type ProposedFact, type ReflectionSession } from "@/lib/ai/reflect";
import type { Embedded, FactProposal, MemoryFact } from "./facts";
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
 * `embed` returns one entry per text, nullable, rather than throwing. A fact with no
 * vector cannot be deduplicated, which is worth far more than a fact that was never
 * written because the embeddings endpoint was down.
 */
export interface MemoryPort {
  /** The session as the prompt renders it, or null if there is no such session. */
  session(sessionId: number): Promise<ReflectionSession | null>;
  /** Every fact, so `isActive` can be applied here rather than in SQL. */
  facts(): Promise<Embedded<MemoryFact>[]>;
  embed(texts: readonly string[]): Promise<(number[] | null)[]>;
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

  const stored = await input.port.facts();
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
