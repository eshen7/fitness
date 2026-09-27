import { describe, expect, it } from "vitest";
import { fakeEmbedding } from "@/lib/ai/fake";
import {
  confirmationReason,
  conflictsWithStated,
  cosine,
  factsText,
  isActive,
  isPending,
  promptFacts,
  supersedes,
  SUPERSEDE_SIMILARITY,
  type Embedded,
  type FactProposal,
  type MemoryFact,
} from "./facts";

/**
 * The gate and the supersession rules, which are the two things in this layer that can
 * lose something. Everything here is a pure function, so none of it needs a database
 * and none of it calls the network: the vectors come from `fakeEmbedding`, the same
 * deterministic hashing the AI fake uses.
 */

function proposal(overrides: Partial<FactProposal> = {}): FactProposal {
  return {
    type: "preference",
    body: "The athlete prefers to train in the morning.",
    confidence: 0.6,
    observations: ["Logged four of five sessions before 8am."],
    tendonSites: [],
    retiresExerciseIds: [],
    ...overrides,
  };
}

function fact(overrides: Partial<Embedded<MemoryFact>> = {}): Embedded<MemoryFact> {
  return {
    id: 1,
    type: "preference",
    body: "The athlete prefers to train in the morning.",
    source: "inferred",
    confidence: 0.6,
    observations: [],
    derivedFromSessionId: 7,
    derivedFromProposalId: null,
    supersedesId: null,
    supersededById: null,
    retiredAt: null,
    retiredReason: null,
    requiresConfirmation: false,
    confirmationReason: null,
    confirmedAt: null,
    createdAt: new Date("2026-03-01T10:00:00Z"),
    embedding: null,
    ...overrides,
  };
}

describe("confirmationReason", () => {
  it("lets an ordinary preference commit itself", () => {
    expect(confirmationReason(proposal())).toBeNull();
  });

  it("holds anything that would retire an exercise", () => {
    expect(confirmationReason(proposal({ retiresExerciseIds: [4] }))).toContain(
      "an exercise",
    );
    expect(confirmationReason(proposal({ retiresExerciseIds: [4, 9] }))).toContain(
      "2 exercises",
    );
  });

  it("holds anything that names a tendon site, and says which", () => {
    const reason = confirmationReason(proposal({ tendonSites: ["patellar_left"] }));
    expect(reason).toContain("Patellar, left");
  });

  it("holds injury history whatever it says", () => {
    expect(
      confirmationReason(
        proposal({ type: "injury_history", body: "The athlete rolled an ankle in 2019." }),
      ),
    ).toContain("injury history");
  });

  /**
   * The case the prose scan exists for. The structured field is empty, so nothing about
   * this proposal's shape marks it - but the sentence would be read by the generator
   * and acted on, which is why the words are checked too.
   */
  it("holds a tendon claim that left the structured field empty", () => {
    const reason = confirmationReason(
      proposal({
        body: "The patellar tendon now tolerates about 250 contacts a week.",
        tendonSites: [],
      }),
    );
    expect(reason).toContain("tendon load");
  });

  /**
   * The retirement scan must not fire on the domain's ordinary verbs. "Drop" is a drop
   * jump and a dropped load; a gate that held these would be a queue nobody reads.
   */
  it.each([
    "The athlete drops load rather than grinding a set when their back feels tight.",
    "The athlete prefers drop jumps from a lower box than the plan tends to use.",
    "The athlete removes the plates between sets to reset the bar height.",
  ])("does not hold ordinary training prose: %s", (body) => {
    expect(confirmationReason(proposal({ body }))).toBeNull();
  });

  it("holds retirement language that named no ids", () => {
    const reason = confirmationReason(
      proposal({ body: "The athlete should stop doing depth jumps entirely." }),
    );
    expect(reason).toContain("retire an exercise");
  });

  it("puts the exercise reason ahead of the tendon one when both apply", () => {
    const reason = confirmationReason(
      proposal({ retiresExerciseIds: [4], tendonSites: ["achilles_right"] }),
    );
    expect(reason).toContain("an exercise");
  });
});

describe("cosine", () => {
  it("is 1 for a vector against itself and 0 against a flat one", () => {
    const vector = fakeEmbedding("the athlete prefers morning sessions");
    expect(cosine(vector, vector)).toBeCloseTo(1, 10);
    expect(cosine(vector, new Array(vector.length).fill(0))).toBe(0);
  });
});

describe("supersedes", () => {
  const body = "The athlete prefers to train in the morning.";

  it("replaces a near-identical inferred fact of the same type", () => {
    const existing = [fact({ id: 3, body, embedding: fakeEmbedding(body) })];
    const found = supersedes(
      { type: "preference", embedding: fakeEmbedding(body) },
      existing,
    );
    expect(found?.id).toBe(3);
  });

  it("leaves a stated fact alone, so an inference cannot overwrite the owner", () => {
    const existing = [
      fact({ id: 3, body, source: "stated", embedding: fakeEmbedding(body) }),
    ];
    expect(
      supersedes({ type: "preference", embedding: fakeEmbedding(body) }, existing),
    ).toBeNull();
  });

  it("skips retired and already-superseded facts", () => {
    const embedding = fakeEmbedding(body);
    expect(
      supersedes({ type: "preference", embedding }, [
        fact({ id: 3, body, embedding, retiredAt: new Date() }),
      ]),
    ).toBeNull();
    expect(
      supersedes({ type: "preference", embedding }, [
        fact({ id: 3, body, embedding, supersededById: 9 }),
      ]),
    ).toBeNull();
  });

  it("will not cross fact types even on an identical sentence", () => {
    const embedding = fakeEmbedding(body);
    expect(
      supersedes({ type: "schedule", embedding }, [fact({ id: 3, body, embedding })]),
    ).toBeNull();
  });

  it("treats a proposal with no embedding as new knowledge", () => {
    const existing = [fact({ id: 3, body, embedding: fakeEmbedding(body) })];
    expect(supersedes({ type: "preference", embedding: null }, existing)).toBeNull();
  });

  it("picks the nearest of several matches", () => {
    // Hand-built vectors rather than hashed sentences, because the point is the
    // comparison and two similarities have to be provably different to test it. Both
    // are above the threshold; the exact match must win.
    const embedding = [1, 0, 0];
    const nearer = fact({ id: 3, body, embedding: [1, 0, 0] });
    const further = fact({ id: 4, body, embedding: [0.95, 0.31, 0] });
    expect(cosine(embedding, further.embedding!)).toBeGreaterThan(SUPERSEDE_SIMILARITY);
    expect(supersedes({ type: "preference", embedding }, [further, nearer])?.id).toBe(3);
  });

  it("does not replace an unrelated fact of the same type", () => {
    const existing = [
      fact({
        id: 3,
        body: "The athlete has no access to a squat rack on Sundays.",
        embedding: fakeEmbedding("The athlete has no access to a squat rack on Sundays."),
      }),
    ];
    expect(
      supersedes({ type: "preference", embedding: fakeEmbedding(body) }, existing),
    ).toBeNull();
  });

  it("uses a threshold high enough to be a near-duplicate test", () => {
    // Guards the number itself. Set low, this function deletes knowledge silently.
    expect(SUPERSEDE_SIMILARITY).toBeGreaterThanOrEqual(0.8);
    expect(SUPERSEDE_SIMILARITY).toBeLessThan(1);
  });
});

describe("conflictsWithStated", () => {
  const body = "The athlete cannot train on Thursdays.";

  it("finds the stated fact a proposal would contradict", () => {
    const existing = [
      fact({ id: 5, type: "schedule", body, source: "stated", embedding: fakeEmbedding(body) }),
    ];
    const hit = conflictsWithStated(
      { type: "schedule", embedding: fakeEmbedding(body) },
      existing,
    );
    expect(hit?.id).toBe(5);
  });

  it("ignores inferred facts, which `supersedes` handles instead", () => {
    const existing = [fact({ id: 5, type: "schedule", body, embedding: fakeEmbedding(body) })];
    expect(
      conflictsWithStated({ type: "schedule", embedding: fakeEmbedding(body) }, existing),
    ).toBeNull();
  });
});

describe("isActive and isPending", () => {
  it("a plain inferred fact is active and not pending", () => {
    expect(isActive(fact())).toBe(true);
    expect(isPending(fact())).toBe(false);
  });

  it("a held fact is pending and not active until it is confirmed", () => {
    const held = fact({ requiresConfirmation: true });
    expect(isActive(held)).toBe(false);
    expect(isPending(held)).toBe(true);

    const confirmed = fact({ requiresConfirmation: true, confirmedAt: new Date() });
    expect(isActive(confirmed)).toBe(true);
    expect(isPending(confirmed)).toBe(false);
  });

  it("a retired or superseded fact is neither", () => {
    for (const dead of [fact({ retiredAt: new Date() }), fact({ supersededById: 2 })]) {
      expect(isActive(dead)).toBe(false);
      expect(isPending(dead)).toBe(false);
    }
  });
});

describe("promptFacts", () => {
  it("drops the inactive and the low-confidence, keeping the row unmentioned", () => {
    const shown = promptFacts([
      fact({ id: 1, confidence: 0.9 }),
      fact({ id: 2, confidence: 0.2 }),
      fact({ id: 3, confidence: 0.9, retiredAt: new Date() }),
      fact({ id: 4, confidence: 0.9, requiresConfirmation: true }),
    ]);
    expect(shown.map((f) => f.id)).toEqual([1]);
  });

  it("puts stated facts first, then the most confident", () => {
    const shown = promptFacts([
      fact({ id: 1, confidence: 0.5 }),
      fact({ id: 2, confidence: 0.9 }),
      fact({ id: 3, confidence: 0.5, source: "stated" }),
    ]);
    expect(shown.map((f) => f.id)).toEqual([3, 2, 1]);
  });

  /**
   * The ordering has to be a function of the facts alone. Anything clock-derived in
   * this sort would rewrite the cached prefix on a schedule and zero the cache.
   */
  it("orders identically whatever order the rows arrive in", () => {
    const facts = [
      fact({ id: 1, confidence: 0.7, createdAt: new Date("2026-01-01") }),
      fact({ id: 2, confidence: 0.7, createdAt: new Date("2026-06-01") }),
      fact({ id: 3, confidence: 0.7, createdAt: new Date("2026-03-01") }),
    ];
    const forward = promptFacts(facts).map((f) => f.id);
    const backward = promptFacts([...facts].reverse()).map((f) => f.id);
    expect(forward).toEqual(backward);
    expect(forward).toEqual([1, 2, 3]);
  });

  it("honours the budget", () => {
    const many = Array.from({ length: 10 }, (_, index) => fact({ id: index + 1 }));
    expect(promptFacts(many, { budget: 3 })).toHaveLength(3);
  });
});

describe("factsText", () => {
  it("groups by type and marks how each fact was come by", () => {
    const text = factsText([
      fact({ id: 1, type: "preference", body: "Prefers mornings.", confidence: 0.62 }),
      fact({ id: 2, type: "equipment", body: "Has no trap bar.", source: "stated" }),
    ]);
    expect(text).toContain("Preferences:");
    expect(text).toContain("Equipment:");
    expect(text).toContain("inferred, confidence 0.62");
    expect(text).toContain("stated by the athlete");
  });

  it("says so when there is nothing, rather than rendering an empty heading", () => {
    expect(factsText([])).toContain("Nothing learned yet");
  });
});
