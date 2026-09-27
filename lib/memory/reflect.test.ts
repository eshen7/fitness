import { afterEach, describe, expect, it } from "vitest";
import { setAiClient } from "@/lib/ai/client";
import { fakeAiClient, fakeEmbedding } from "@/lib/ai/fake";
import type { ProposedFact, ReflectionSession } from "@/lib/ai/reflect";
import {
  confirmationReason,
  conflictsWithStated,
  supersedes,
  type Embedded,
  type FactProposal,
  type MemoryFact,
} from "./facts";
import { reflect, type MemoryPort } from "./reflect";
import type { FactOutcome } from "./store";

/**
 * The reflection pipeline end to end with no database and no network.
 *
 * The port is an in-memory store that applies the same three rules the real one does -
 * drop against a stated fact, hold on `confirmationReason`, supersede a near-duplicate
 * - by calling the same pure functions `lib/memory/store.ts` calls. That is the payoff
 * of the port: the policy under test is the policy that ships, and the only thing
 * faked is Postgres.
 */

afterEach(() => setAiClient(null));

const SESSION: ReflectionSession = {
  day: "2026-03-04",
  kind: "Strength",
  title: "Lower A",
  notes: "Back felt tight on the second squat set so I dropped the load.",
  reportedRpe: 7,
  plannedSets: 18,
  sets: [
    {
      exerciseName: "Back squat",
      prescribed: "4 x 5, 120 kg",
      performed: "5 reps at 100 kg",
      rpe: 8,
      targetRpe: 7,
      qualityRating: 3,
      notes: "tight",
    },
  ],
  skipped: ["- Split squat: 3 x 8"],
  tendon: [{ site: "Patellar, left", painDuringLoad: 2, painAfterLoad: 1 }],
};

function proposed(overrides: Partial<ProposedFact> = {}): ProposedFact {
  return {
    type: "preference",
    body: "The athlete drops load rather than grinding a set when their back feels tight.",
    confidence: 0.55,
    observations: ['Wrote "back felt tight" and cut 120 kg to 100 kg.'],
    tendonSites: [],
    retiresExerciseIds: [],
    ...overrides,
  };
}

function storedFact(overrides: Partial<Embedded<MemoryFact>>): Embedded<MemoryFact> {
  return {
    id: 1,
    type: "preference",
    body: "",
    source: "inferred",
    confidence: 0.6,
    observations: [],
    derivedFromSessionId: null,
    derivedFromProposalId: null,
    supersedesId: null,
    supersededById: null,
    retiredAt: null,
    retiredReason: null,
    requiresConfirmation: false,
    confirmationReason: null,
    confirmedAt: null,
    createdAt: new Date("2026-02-01T00:00:00Z"),
    embedding: null,
    ...overrides,
  };
}

/**
 * The port, backed by an array. `apply` reproduces `applyFactProposal` by calling the
 * same pure deciders, so a change to the policy breaks this test rather than sliding
 * past it.
 */
function memoryPort(
  options: {
    session?: ReflectionSession | null;
    facts?: Embedded<MemoryFact>[];
    embed?: (texts: readonly string[]) => (number[] | null)[];
  } = {},
) {
  const rows = [...(options.facts ?? [])];
  let nextId = Math.max(0, ...rows.map((row) => row.id)) + 1;
  const applied: { proposal: FactProposal; existingCount: number }[] = [];

  const port: MemoryPort = {
    async session() {
      return options.session === undefined ? SESSION : options.session;
    },
    async facts() {
      return rows;
    },
    async embed(texts) {
      return options.embed ? options.embed(texts) : texts.map((text) => fakeEmbedding(text));
    },
    async apply(input) {
      applied.push({ proposal: input.proposal, existingCount: input.existing.length });
      const embedded = { type: input.proposal.type, embedding: input.embedding };

      const stated = conflictsWithStated(embedded, input.existing);
      if (stated) {
        return { kind: "dropped", reason: "stated", conflictsWith: stated.id };
      }

      const replaced = supersedes(embedded, input.existing);
      const reason = confirmationReason(input.proposal);
      const id = nextId;
      nextId += 1;
      rows.push(
        storedFact({
          id,
          type: input.proposal.type,
          body: input.proposal.body,
          confidence: input.proposal.confidence,
          embedding: input.embedding,
          supersedesId: replaced?.id ?? null,
          requiresConfirmation: reason !== null,
          confirmationReason: reason,
        }),
      );
      if (replaced && reason === null) {
        const index = rows.findIndex((row) => row.id === replaced.id);
        rows[index] = { ...rows[index], supersededById: id };
      }
      const outcome: FactOutcome =
        reason === null
          ? { kind: "committed", id, supersedesId: replaced?.id ?? null }
          : { kind: "pending", id, reason, supersedesId: replaced?.id ?? null };
      return outcome;
    },
  };

  return { port, rows, applied };
}

describe("reflect", () => {
  it("commits an ordinary fact and reports what it did", async () => {
    const client = fakeAiClient([
      { output: { facts: [proposed()], summary: "Cut the load and finished the session." } },
    ]);
    setAiClient(client);
    const { port, rows } = memoryPort();

    const result = await reflect({ sessionId: 42, port });

    expect(result.skipped).toBeNull();
    expect(result.outcomes).toHaveLength(1);
    expect(result.outcomes[0].kind).toBe("committed");
    expect(result.summary).toBe("Cut the load and finished the session.");
    expect(rows).toHaveLength(1);
  });

  it("proposes nothing and embeds nothing on an unremarkable session", async () => {
    const client = fakeAiClient([{ output: { facts: [], summary: null } }]);
    setAiClient(client);
    const { port, rows } = memoryPort();

    const result = await reflect({ sessionId: 42, port });

    expect(result.outcomes).toEqual([]);
    expect(rows).toEqual([]);
  });

  it("makes no model call at all when the session does not exist", async () => {
    const client = fakeAiClient([]);
    setAiClient(client);
    const { port } = memoryPort({ session: null });

    const result = await reflect({ sessionId: 99, port });

    expect(result.skipped).toBe("There is no session 99 to reflect on.");
    expect(client.used).toBe(0);
    expect(client.embedCalls).toHaveLength(0);
  });

  it("holds a tendon fact for confirmation instead of committing it", async () => {
    const client = fakeAiClient([
      {
        output: {
          facts: [
            proposed({
              type: "response_pattern",
              body: "The left patellar tendon tolerates about 250 contacts a week.",
              tendonSites: ["patellar_left"],
            }),
          ],
          summary: null,
        },
      },
    ]);
    setAiClient(client);
    const { port, rows } = memoryPort();

    const result = await reflect({ sessionId: 42, port });

    expect(result.outcomes[0].kind).toBe("pending");
    expect(rows[0].requiresConfirmation).toBe(true);
  });

  it("drops a proposal that contradicts something the athlete stated", async () => {
    const body = "The athlete cannot train on Thursdays.";
    const client = fakeAiClient([
      {
        output: {
          facts: [proposed({ type: "schedule", body })],
          summary: null,
        },
      },
    ]);
    setAiClient(client);
    const { port, rows } = memoryPort({
      facts: [
        storedFact({
          id: 4,
          type: "schedule",
          body,
          source: "stated",
          embedding: fakeEmbedding(body),
        }),
      ],
    });

    const result = await reflect({ sessionId: 42, port });

    expect(result.outcomes[0]).toMatchObject({ kind: "dropped", conflictsWith: 4 });
    expect(rows).toHaveLength(1);
  });

  /**
   * The ordering the pipeline's doc calls out. Two paraphrases in one answer must not
   * both survive, which only works if the first one is visible to the second.
   */
  it("lets a fact written in this reflection supersede its own paraphrase", async () => {
    const body = "The athlete drops load rather than grinding a tight set.";
    const client = fakeAiClient([
      {
        output: {
          facts: [proposed({ body }), proposed({ body })],
          summary: null,
        },
      },
    ]);
    setAiClient(client);
    const { port, applied } = memoryPort();

    const result = await reflect({ sessionId: 42, port });

    expect(applied[0].existingCount).toBe(0);
    expect(applied[1].existingCount).toBe(1);
    expect(result.outcomes[1]).toMatchObject({ kind: "committed", supersedesId: 1 });
  });

  it("shows the model the pending facts, so it stops re-proposing them", async () => {
    const client = fakeAiClient([{ output: { facts: [], summary: null } }]);
    setAiClient(client);
    const { port } = memoryPort({
      facts: [
        storedFact({ id: 1, body: "Held fact.", requiresConfirmation: true }),
        storedFact({ id: 2, body: "Retired fact.", retiredAt: new Date() }),
        storedFact({ id: 3, body: "Replaced fact.", supersededById: 1 }),
        storedFact({ id: 4, body: "Live fact." }),
      ],
    });

    await reflect({ sessionId: 42, port });

    const stable = client.calls[0].stable;
    expect(stable).toContain("Held fact.");
    expect(stable).toContain("Live fact.");
    expect(stable).not.toContain("Retired fact.");
    expect(stable).not.toContain("Replaced fact.");
  });

  it("still writes the fact when the embedding could not be had", async () => {
    const client = fakeAiClient([{ output: { facts: [proposed()], summary: null } }]);
    setAiClient(client);
    const { port, rows } = memoryPort({ embed: (texts) => texts.map(() => null) });

    const result = await reflect({ sessionId: 42, port });

    expect(result.outcomes[0].kind).toBe("committed");
    expect(rows[0].embedding).toBeNull();
  });

  it("clamps a confidence the model overstated and de-duplicates its lists", async () => {
    const client = fakeAiClient([
      {
        output: {
          facts: [
            proposed({
              confidence: 1.8,
              tendonSites: ["patellar_left", "patellar_left"],
              retiresExerciseIds: [4, 4],
            }),
          ],
          summary: null,
        },
      },
    ]);
    setAiClient(client);
    const { port, applied } = memoryPort();

    await reflect({ sessionId: 42, port });

    expect(applied[0].proposal.confidence).toBe(1);
    expect(applied[0].proposal.tendonSites).toEqual(["patellar_left"]);
    expect(applied[0].proposal.retiresExerciseIds).toEqual([4]);
  });

  it("keeps the clock out of the cached half and the session in the volatile half", async () => {
    const client = fakeAiClient([{ output: { facts: [], summary: null } }]);
    setAiClient(client);
    const { port } = memoryPort();

    await reflect({ sessionId: 42, port });

    const call = client.calls[0];
    expect(call.stable).not.toContain("2026-03-04");
    expect(call.volatile).toContain("Back squat");
    expect(call.volatile).toContain("Back felt tight");
  });
});
