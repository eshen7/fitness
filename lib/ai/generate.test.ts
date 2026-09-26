import { afterEach, describe, expect, it } from "vitest";
import {
  DECLARATION,
  DEPTH_JUMP,
  WEEK_START,
  baselineWeek,
  priorSession,
  priorWeek,
} from "@/lib/engine/fixtures/baseline";
import { STOCK } from "@/lib/engine/fixtures/directory";
import type {
  MesocycleDeclaration,
  MicrocyclePlan,
  PlannedSession,
} from "@/lib/engine/types";
import type { SessionKind } from "@/lib/taxonomy";
import { setAiClient } from "./client";
import type { GenerationContext } from "./context";
import { fakeAiClient, refused, truncated, type FakeStep } from "./fake";
import { fixtureBlock, fixtureContext, tendonReading } from "./fixtures";
import {
  FALLBACK_LOAD_SCALE,
  MAX_REPAIR_ATTEMPTS,
  generateDeclaration,
  finalViolations,
  generateWeek,
  repairAttemptsOf,
} from "./generate";
import type { DeclarationProposal, WeekProposal } from "./schemas";

/**
 * The generation pipeline end to end, with no key and no database.
 *
 * These are the phase's own verification bullets. A realistic history produces a
 * plan the gate accepts. A tendon in a protocol phase removes every exercise
 * loading that site from the candidate set, so the model is never offered one
 * rather than being caught naming one. An over-targeted request either gets
 * repaired or falls back to a real session at reduced load rather than to nothing.
 *
 * The caching assertion here is about the plumbing - one byte-identical prefix
 * across generations, and the cache read accumulated onto the run - because a fake
 * client can only simulate a cache. The measurement is the live bench.
 */

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

function use(script: Parameters<typeof fakeAiClient>[0]) {
  const client = fakeAiClient(script);
  restore = setAiClient(client);
  return client;
}

/** Always the same reply, for the tests that care about the loop giving up. */
function always(step: FakeStep) {
  return () => step;
}

function declarationProposal(
  overrides: Partial<MesocycleDeclaration> = {},
): DeclarationProposal {
  return {
    rationale: "Accumulation: build the strength the reactive work will convert.",
    claimedConstraints: [
      "target-count: two abilities and one technical focus.",
      "stable-complex: eight exercises, all from the candidate set.",
    ],
    suggestedExercises: [],
    declaration: { ...DECLARATION, ...overrides },
  };
}

function weekProposal(week: MicrocyclePlan = baselineWeek()): WeekProposal {
  return {
    rationale: "Week 2 holds the complex and raises the heavy day.",
    claimedConstraints: ["rule-of-60: the light day sits at 60% of the heavy one."],
    suggestedExercises: [],
    week,
  };
}

/** Three target abilities, which no week can repair: the gate caps them at two. */
const OVER_TARGETED: Partial<MesocycleDeclaration> = {
  targetAbilities: ["max_strength", "reactive_strength", "speed_strength"],
};

// -----------------------------------------------------------------------------
// Block declaration
// -----------------------------------------------------------------------------

describe("declaring a block", () => {
  const ask = { ordinal: 1, startDate: WEEK_START, weeks: 4 };

  it("passes the gate on the first attempt from a realistic history", async () => {
    const client = use([{ output: declarationProposal() }]);
    const run = await generateDeclaration({ context: fixtureContext(), ...ask });

    expect(run.passed).toBe(true);
    expect(run.declaration).toEqual(DECLARATION);
    expect(run.attempts).toEqual([
      { attempt: 1, violations: [], passed: true, error: null },
    ]);
    expect(repairAttemptsOf(run)).toBe(0);
    expect(client.used).toBe(1);
    expect(run.ask).toEqual({ ...ask, note: null });
    expect(run.rationale).toBe(declarationProposal().rationale);
  });

  it("sends the stable prefix first and keeps the clock out of it", async () => {
    const client = use([{ output: declarationProposal() }]);
    await generateDeclaration({ context: fixtureContext(), ...ask });

    const [call] = client.calls;
    expect(call.stable).toContain("Candidate exercises");
    expect(call.stable).toContain("Equipment available");
    // The one thing that must never reach the cached prefix: it changes daily and
    // would zero the cache read on every request.
    expect(call.stable).not.toContain("The plan is being generated on");
    expect(call.volatile).toContain("The plan is being generated on");
    expect(call.volatile).toContain("## Tendon state");
    expect(call.cacheKey).toBe("fitness-declaration");
  });

  it("repairs an over-targeted declaration and converges", async () => {
    const client = use([
      { output: declarationProposal(OVER_TARGETED) },
      { output: declarationProposal() },
    ]);
    const run = await generateDeclaration({ context: fixtureContext(), ...ask });

    expect(run.passed).toBe(true);
    expect(repairAttemptsOf(run)).toBe(1);
    expect(run.attempts[0].violations.map((violation) => violation.rule)).toContain(
      "target-count",
    );

    // The repair round is the ask, the rejected attempt, and the gate's own
    // message. Paraphrasing the violation is how the loop and the rules drift.
    expect(client.calls[0].turns).toHaveLength(1);
    expect(client.calls[1].turns).toHaveLength(3);
    expect(client.calls[1].turns[1].role).toBe("assistant");
    expect(client.calls[1].turns[2].content).toContain(
      run.attempts[0].violations[0].message,
    );
    // And the prefix did not move, so the second call still reads the cache.
    expect(client.calls[1].stable).toBe(client.calls[0].stable);
  });

  it("stops after three repairs and keeps every violation", async () => {
    const client = use(always({ output: declarationProposal(OVER_TARGETED) }));
    const run = await generateDeclaration({ context: fixtureContext(), ...ask });

    expect(run.passed).toBe(false);
    expect(run.declaration).toBeNull();
    expect(client.used).toBe(MAX_REPAIR_ATTEMPTS + 1);
    expect(run.attempts).toHaveLength(MAX_REPAIR_ATTEMPTS + 1);
    for (const attempt of run.attempts) {
      expect(attempt.passed).toBe(false);
      expect(attempt.violations.map((violation) => violation.rule)).toContain(
        "target-count",
      );
    }
    // The refused proposal survives, so the review screen shows what was refused
    // rather than an empty card.
    expect(run.proposal).not.toBeNull();
    expect(run.rationale).not.toBeNull();
  });

  it("counts a truncated or refused response as a failed attempt and carries on", async () => {
    const client = use([
      truncated("block declaration"),
      refused("block declaration"),
      { output: declarationProposal() },
    ]);
    const run = await generateDeclaration({ context: fixtureContext(), ...ask });

    expect(run.passed).toBe(true);
    expect(client.used).toBe(3);
    expect(run.attempts.map((attempt) => attempt.error)).toEqual([
      "block declaration: the response stopped early (max_output_tokens).",
      "block declaration: the model declined.",
      null,
    ]);
    expect(repairAttemptsOf(run)).toBe(2);
  });
});

// -----------------------------------------------------------------------------
// Weekly microcycle
// -----------------------------------------------------------------------------

describe("generating a week", () => {
  function generate(input: {
    declaration?: MesocycleDeclaration;
    context?: GenerationContext;
    lastSession?: (kind: SessionKind) => Promise<PlannedSession | null>;
  }) {
    return generateWeek({
      context: input.context ?? fixtureContext({ block: fixtureBlock() }),
      declaration: input.declaration ?? DECLARATION,
      ordinal: 2,
      startDate: WEEK_START,
      priorWeeks: [priorWeek()],
      priorSession: priorSession(),
      // Defaults to the database, which no test has, so every case says where the
      // fallback may look even when it expects not to need one.
      lastSession: input.lastSession ?? (async () => null),
    });
  }

  it("passes the gate on the first attempt with nothing to normalize", async () => {
    const client = use([{ output: weekProposal() }]);
    const run = await generate({});

    expect(run.passed).toBe(true);
    expect(run.changes).toEqual([]);
    expect(run.advisories).toEqual([]);
    expect(run.fallback).toBeNull();
    expect(run.week?.sessions).toHaveLength(3);
    expect(repairAttemptsOf(run)).toBe(0);
    expect(client.calls[0].cacheKey).toBe("fitness-week");
  });

  it("records what the normalizer silently fixed", async () => {
    use([{ output: weekProposal(overdosedPlyos()) }]);
    const run = await generate({});

    expect(run.passed).toBe(true);
    const fix = run.changes.find((change) => change.exerciseId === DEPTH_JUMP);
    expect(fix).toMatchObject({
      rule: "plyo-dose",
      field: "reps",
      from: 20,
      to: 12,
    });
    // The week the gate saw is the fixed one, not what the model wrote.
    expect(repsFor(run.week!, DEPTH_JUMP)).toEqual([12, 8]);
  });

  describe("a tendon in protocol phase 2", () => {
    const context = fixtureContext({
      block: fixtureBlock(),
      tendon: [
        tendonReading({ site: "patellar_left", protocolPhase: 2, painDuringLoad: 4 }),
      ],
    });

    it("removes every exercise loading that site from the candidate set", () => {
      expect(gatedByPatellar().length).toBeGreaterThan(3);
      const candidates = new Set(
        context.prefiltered.candidates.map((exercise) => exercise.id),
      );
      for (const exercise of gatedByPatellar()) {
        expect(candidates.has(exercise.id), `${exercise.name} is still a candidate`).toBe(
          false,
        );
      }
    });

    it("never offers one to the model, and says why it is gone", async () => {
      const client = use(always({ output: weekProposal() }));
      await generate({ context });

      const [call] = client.calls;
      for (const exercise of gatedByPatellar()) {
        // The candidate table is one `id | name | ...` row per line.
        expect(call.stable).not.toMatch(new RegExp(`^${exercise.id} \\| `, "m"));
      }
      expect(call.volatile).toContain("protocol phase 2");
      expect(call.volatile).toContain("Removed from the candidate set");
    });

    it("reports the same set as the inputs the proposal stores", async () => {
      use(always({ output: weekProposal() }));
      const run = await generate({ context });

      for (const exercise of gatedByPatellar()) {
        expect(run.inputs.candidateIds).not.toContain(exercise.id);
      }
      expect(run.inputs.excluded.length).toBeGreaterThan(0);
    });
  });

  it("falls back to the last session of each kind at reduced load", async () => {
    const client = use(always({ output: weekProposal() }));
    // Last one of each kind wins, which is what `loadLastPlannedSession` returns:
    // the Friday mixed session rather than the Monday one.
    const priors = new Map<SessionKind, PlannedSession>(
      baselineWeek().sessions.map((session) => [session.kind, session]),
    );
    const run = await generate({
      declaration: { ...DECLARATION, ...OVER_TARGETED },
      lastSession: async (kind) => priors.get(kind) ?? null,
    });

    expect(run.passed).toBe(false);
    expect(client.used).toBe(MAX_REPAIR_ATTEMPTS + 1);

    const fallback = run.fallback;
    expect(fallback).not.toBeNull();
    expect(fallback!.loadType).toBe("retaining");
    expect(fallback!.relativeLoad).toBe(FALLBACK_LOAD_SCALE);
    expect(fallback!.startDate).toBe(WEEK_START);
    expect(fallback!.sessions.map((session) => session.kind)).toEqual([
      "mixed",
      "strength",
    ]);
    for (const session of fallback!.sessions) {
      expect(session.title).toContain("fallback, load reduced");
      expect(session.day >= WEEK_START).toBe(true);
    }

    // The heaviest set across those two sessions was 85% of a max; a fifth off is
    // 68%, which is felt and still trains.
    expect(Math.max(...loadsOf(fallback!))).toBe(Math.round(85 * FALLBACK_LOAD_SCALE));
    expect(loadsOf(fallback!).length).toBeGreaterThan(3);
  });

  it("keeps the fallback inside the candidate set a tendon has narrowed", async () => {
    use(always({ output: weekProposal() }));
    const priors = new Map<SessionKind, PlannedSession>(
      baselineWeek().sessions.map((session) => [session.kind, session]),
    );
    const context = fixtureContext({
      block: fixtureBlock(),
      tendon: [
        tendonReading({ site: "patellar_left", protocolPhase: 2, painDuringLoad: 4 }),
      ],
    });
    const run = await generate({
      context,
      declaration: { ...DECLARATION, ...OVER_TARGETED },
      lastSession: async (kind) => priors.get(kind) ?? null,
    });

    const candidates = new Set(context.prefiltered.candidates.map((exercise) => exercise.id));
    const shipped = run.fallback!.sessions.flatMap((session) =>
      session.blocks.flatMap((block) => block.items.map((item) => item.exerciseId)),
    );
    expect(shipped.length).toBeGreaterThan(0);
    for (const exerciseId of shipped) expect(candidates.has(exerciseId)).toBe(true);
    for (const session of run.fallback!.sessions) {
      for (const block of session.blocks) expect(block.items.length).toBeGreaterThan(0);
    }
  });

  it("meters a failed call and reports the violations of the last gated attempt", async () => {
    use([
      { output: weekProposal() },
      { output: weekProposal() },
      { output: weekProposal() },
      truncated("week 2"),
    ]);
    const run = await generate({
      declaration: { ...DECLARATION, ...OVER_TARGETED },
      lastSession: async () => null,
    });

    expect(run.attempts.at(-1)!.error).not.toBeNull();
    expect(finalViolations(run).length).toBeGreaterThan(0);
    expect(finalViolations(run)).toEqual(run.attempts[2].violations);
    expect(run.usage.outputTokens).toBe(3 * 500 + 32_000);
  });

  it("says there is nothing to fall back on rather than inventing one", async () => {
    use(always({ output: weekProposal() }));
    const run = await generate({
      declaration: { ...DECLARATION, ...OVER_TARGETED },
      lastSession: async () => null,
    });

    expect(run.passed).toBe(false);
    expect(run.fallback).toBeNull();
    // The refused week and the reasons it was refused both stand.
    expect(run.week).not.toBeNull();
    expect(run.attempts.at(-1)!.violations.length).toBeGreaterThan(0);
  });
});

// -----------------------------------------------------------------------------
// Caching
// -----------------------------------------------------------------------------

describe("prompt caching", () => {
  it("repeats the prefix byte for byte and accumulates the cache read", async () => {
    const client = use(always({ output: weekProposal() }));
    const input = {
      context: fixtureContext({ block: fixtureBlock() }),
      declaration: DECLARATION,
      ordinal: 2,
      startDate: WEEK_START,
      priorWeeks: [priorWeek()],
      priorSession: priorSession(),
      lastSession: async () => null,
    };

    const first = await generateWeek(input);
    const second = await generateWeek(input);

    expect(client.calls[0].stable).toBe(client.calls[1].stable);
    expect(client.calls[0].cacheKey).toBe(client.calls[1].cacheKey);
    expect(first.usage.cachedInputTokens).toBe(0);
    expect(second.usage.cachedInputTokens).toBeGreaterThan(0);
    expect(second.usage.inputTokens).toBeGreaterThan(second.usage.cachedInputTokens);
  });
});

// -----------------------------------------------------------------------------

/** The baseline week with a plyometric dose outside the 8 to 12 rep band. */
function overdosedPlyos(): MicrocyclePlan {
  const week = baselineWeek();
  const monday = week.sessions[0];
  return {
    ...week,
    sessions: [
      {
        ...monday,
        blocks: monday.blocks.map((block) => ({
          ...block,
          items: block.items.map((item) =>
            item.exerciseId === DEPTH_JUMP ? { ...item, reps: 20 } : item,
          ),
        })),
      },
      ...week.sessions.slice(1),
    ],
  };
}

function repsFor(week: MicrocyclePlan, exerciseId: number) {
  return week.sessions
    .flatMap((session) => session.blocks.flatMap((block) => block.items))
    .filter((item) => item.exerciseId === exerciseId)
    .map((item) => item.reps);
}

function loadsOf(week: MicrocyclePlan) {
  return week.sessions
    .flatMap((session) => session.blocks.flatMap((block) => block.items))
    .map((item) => item.loadPctOf1rm)
    .filter((load): load is number => load != null);
}

/**
 * Stock exercises the left patellar tendon entering protocol phase 2 takes out.
 * The protocol's own phase 1 and 2 prescriptions stay in, because the protocol is
 * load management rather than rest.
 */
function gatedByPatellar() {
  return STOCK.filter(
    (exercise) =>
      exercise.loadsTendonSites.includes("patellar_left") &&
      (exercise.protocolPhase === null || exercise.protocolPhase > 2),
  );
}
