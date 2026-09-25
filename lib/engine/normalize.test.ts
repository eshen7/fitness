import { describe, expect, it } from "vitest";
import { directoryOf } from "./directory";
import {
  APPROACH,
  BACK_SQUAT,
  baselineWeek,
  BOUND,
  DECLARATION,
  DEPTH_JUMP,
  PLANK,
  PULL_UP,
  TRAP_BAR,
} from "./fixtures/baseline";
import { DIRECTORY, exerciseOf, idOf, STOCK } from "./fixtures/directory";
import {
  couplingClassFor,
  couplingLabel,
  demandOrder,
  heavyRest,
  mainBeforeAssistance,
  normalizeSession,
  normalizeWeek,
  plyoDose,
  plyoRest,
  type NormalizeContext,
} from "./normalize";
import type { EngineExercise, PlannedBlock, PlannedSession, PlannedSet } from "./types";

const context: NormalizeContext = {
  directory: DIRECTORY,
  mains: new Set(DECLARATION.complex.filter((i) => i.isMain).map((i) => i.exerciseId)),
};

function session(blocks: PlannedBlock[], kind: PlannedSession["kind"] = "mixed"): PlannedSession {
  return { day: "2026-09-21", kind, plannedIntensity: 7, blocks };
}

const one = (item: PlannedSet, kind?: PlannedSession["kind"]) =>
  session([{ label: "Main", items: [item] }], kind);

const order = (s: PlannedSession) => s.blocks.flatMap((b) => b.items.map((i) => i.exerciseId));

/** A drill the owner added, with a contact time the stock library does not have. */
function custom(slug: string, overrides: Partial<EngineExercise>): EngineExercise {
  return { ...exerciseOf(slug), id: 900, slug: "custom", ...overrides };
}

describe("coupling-label", () => {
  it("classes by contact time, keeping non-classical and unmeasured drills as filed", () => {
    expect(couplingClassFor(exerciseOf("alternate-leg-bound"))).toBe("short_ssc");
    expect(couplingClassFor(exerciseOf("box-jump"))).toBe("long_ssc");
    expect(couplingClassFor(exerciseOf("squat-jump"))).toBe("non_classical");
    expect(couplingClassFor(exerciseOf("trap-bar-jump"))).toBe("long_ssc");
    expect(couplingClassFor(exerciseOf("back-squat"))).toBe("not_plyometric");
    expect(couplingClassFor(custom("box-jump", { typicalContactSeconds: 0.25 }))).toBe("long_ssc");
    expect(couplingClassFor(custom("box-jump", { typicalContactSeconds: 0.249 }))).toBe("short_ssc");
  });

  it("fills in a missing class and corrects a wrong one", () => {
    const missing = couplingLabel(one({ exerciseId: idOf("box-jump"), sets: 3, reps: 8 }), context);
    expect(missing.changes.map((c) => c.message)).toEqual([
      "Box jump contacts the ground for 0.4 s, a long SSC at 250 ms or more: labelled Long SSC.",
    ]);
    const wrong = couplingLabel(
      one({ exerciseId: idOf("squat-jump"), sets: 3, reps: 8, couplingClass: "long_ssc" }),
      context,
    );
    expect(wrong.changes).toMatchObject([
      {
        rule: "coupling-label",
        field: "couplingClass",
        from: "long_ssc",
        to: "non_classical",
        message:
          "Squat jump does not couple an eccentric into a concentric, so it is non-classical rather than an SSC: labelled Non-classical rather than Long SSC.",
      },
    ]);
  });

  it("labels a lift not plyometric only when it claims to be one", () => {
    expect(couplingLabel(one({ exerciseId: BACK_SQUAT, sets: 3 }), context).changes).toEqual([]);
    expect(
      couplingLabel(
        one({ exerciseId: BACK_SQUAT, sets: 3, couplingClass: "not_plyometric" }),
        context,
      ).changes,
    ).toEqual([]);
    expect(
      couplingLabel(one({ exerciseId: BACK_SQUAT, sets: 3, couplingClass: "short_ssc" }), context)
        .changes.map((c) => c.to),
    ).toEqual(["not_plyometric"]);
  });

  it("strips the shock label from a shock drill at or above 0.15 s of contact", () => {
    const slow = custom("depth-jump", { name: "High box depth jump", typicalContactSeconds: 0.15 });
    const result = couplingLabel(
      one({ exerciseId: slow.id, sets: 3, reps: 8, couplingClass: "short_ssc", shockMethod: true }),
      { ...context, directory: directoryOf([...STOCK, slow]) },
    );
    expect(result.changes).toMatchObject([
      {
        field: "shockMethod",
        from: true,
        to: false,
        message:
          "High box depth jump contacts the ground for 0.15 s, at or above the 0.15 s shock-method line, so it is not labelled shock method.",
      },
    ]);
    expect(result.session.blocks[0].items[0].shockMethod).toBe(false);
  });

  it("labels a real shock drill left unlabelled", () => {
    const result = couplingLabel(
      one({ exerciseId: DEPTH_JUMP, sets: 3, reps: 8, couplingClass: "short_ssc" }),
      context,
    );
    expect(result.changes.map((c) => c.message)).toEqual([
      "Depth jump contacts the ground for 0.14 s, under the 0.15 s line, so it is labelled shock method.",
    ]);
  });
});

describe("plyo-dose", () => {
  it("clamps reps to 8-12 and sets to 3-6", () => {
    const result = plyoDose(one({ exerciseId: BOUND, sets: 8, reps: 5 }), context);
    expect(result.changes.map((c) => c.message)).toEqual([
      "Alternate leg bound raised from 5 to 8 reps: plyometrics run 8 to 12.",
      "Alternate leg bound lowered from 8 to 6 sets: plyometrics run 3 to 6.",
    ]);
    expect(result.session.blocks[0].items[0]).toMatchObject({ sets: 6, reps: 8 });
  });

  it("gives a missing rep count the conservative end", () => {
    expect(plyoDose(one({ exerciseId: BOUND, sets: 3 }), context).changes).toMatchObject([
      {
        field: "reps",
        from: null,
        to: 8,
        message: "Alternate leg bound had no rep count, so it is set to 8: plyometrics run 8 to 12 reps.",
      },
    ]);
  });

  it("leaves lifts, protocol sessions and tests alone", () => {
    expect(plyoDose(one({ exerciseId: BACK_SQUAT, sets: 1, reps: 1 }), context).changes).toEqual([]);
    const landings = { exerciseId: idOf("depth-landing"), sets: 4, reps: 6 };
    expect(plyoDose(one(landings, "tendon_protocol"), context).changes).toEqual([]);
    expect(plyoDose(one({ exerciseId: APPROACH, sets: 1, reps: 3 }, "test"), context).changes).toEqual(
      [],
    );
  });
});

describe("plyo-rest", () => {
  it("rests low-intensity plyometrics 30 to 60 seconds", () => {
    const result = plyoRest(
      one({ exerciseId: idOf("pogo-hop"), sets: 3, reps: 10, restSeconds: 120 }),
      context,
    );
    expect(result.changes.map((c) => c.message)).toEqual([
      "Pogo hop rest lowered from 2 min to 1 min: low-intensity plyometrics rest 30 to 60 seconds.",
    ]);
  });

  it("sets a missing rest to the middle of the band", () => {
    const result = plyoRest(one({ exerciseId: BOUND, sets: 3, reps: 8 }), context);
    expect(result.changes.map((c) => c.message)).toEqual([
      "Alternate leg bound rest set to 1 min 30 s: plyometrics rest 1 to 2 minutes.",
    ]);
  });

  it("reads the shock label the coupling rule has already corrected", () => {
    const item: PlannedSet = {
      exerciseId: BOUND,
      sets: 3,
      reps: 8,
      restSeconds: 90,
      couplingClass: "short_ssc",
      shockMethod: true,
    };
    expect(normalizeSession(one(item), context).changes.map((c) => c.rule)).toEqual([
      "coupling-label",
    ]);
  });
});

describe("heavy-rest", () => {
  it("fits heavy sets into 4 to 5 minutes", () => {
    const long = heavyRest(
      one({ exerciseId: BACK_SQUAT, sets: 5, reps: 3, loadPctOf1rm: 90, restSeconds: 420 }),
      context,
    );
    expect(long.changes.map((c) => c.message)).toEqual([
      "Back squat rest lowered from 7 min to 5 min: heavy sets rest 4 to 5 minutes.",
    ]);
    const unset = heavyRest(one({ exerciseId: TRAP_BAR, sets: 5, reps: 3 }), context);
    expect(unset.changes.map((c) => c.message)).toEqual([
      "Trap bar deadlift rest set to 4 min 30 s: heavy sets rest 4 to 5 minutes.",
    ]);
  });

  it("leaves lighter strength work and tests alone", () => {
    const light = { exerciseId: BACK_SQUAT, sets: 3, reps: 8, loadPctOf1rm: 70, restSeconds: 120 };
    expect(heavyRest(one(light), context).changes).toEqual([]);
    const test = { exerciseId: BACK_SQUAT, sets: 1, reps: 1, loadPctOf1rm: 100, restSeconds: 600 };
    expect(heavyRest(one(test, "test"), context).changes).toEqual([]);
  });

  it("leaves a heavy slow calf raise in a tendon protocol session alone", () => {
    const protocol = {
      exerciseId: idOf("slow-heavy-calf-raise"),
      sets: 4,
      reps: 6,
      loadPctOf1rm: 85,
      restSeconds: 120,
    };
    const result = heavyRest(one(protocol, "tendon_protocol"), context);
    expect(result.changes).toEqual([]);
    expect(result.session.blocks[0].items[0].restSeconds).toBe(120);
  });
});

describe("demand-order", () => {
  it("puts the most coordination-demanding dynamic drill first", () => {
    const result = demandOrder(
      session([
        {
          label: "Jumps",
          items: [
            { exerciseId: BOUND, sets: 3, reps: 8 },
            { exerciseId: DEPTH_JUMP, sets: 3, reps: 8 },
            { exerciseId: APPROACH, sets: 3, reps: 8 },
          ],
        },
      ]),
      context,
    );
    expect(order(result.session)).toEqual([APPROACH, DEPTH_JUMP, BOUND]);
    expect(result.changes.map((c) => c.message)).toEqual([
      "Two foot approach jump moved from 3rd to 1st: the most coordination-demanding and intense work goes first, while rested.",
    ]);
  });

  it("keeps a complex pair in its written order", () => {
    const pair: PlannedBlock = {
      label: "Contrast",
      complexPair: true,
      items: [
        { exerciseId: BACK_SQUAT, sets: 3, reps: 3, loadPctOf1rm: 85 },
        { exerciseId: idOf("box-jump"), sets: 3, reps: 8 },
      ],
    };
    const result = demandOrder(session([pair]), context);
    expect(result.changes).toEqual([]);
    expect(order(result.session)).toEqual([BACK_SQUAT, idOf("box-jump")]);
  });

  it("moves a complex pair as a unit by its lead item", () => {
    const core: PlannedBlock = { label: "Core", items: [{ exerciseId: PLANK, sets: 2 }] };
    const pair: PlannedBlock = {
      label: "Contrast",
      complexPair: true,
      items: [
        { exerciseId: BACK_SQUAT, sets: 3, reps: 3, loadPctOf1rm: 85 },
        { exerciseId: idOf("box-jump"), sets: 3, reps: 8 },
      ],
    };
    const result = demandOrder(session([core, pair]), context);
    expect(order(result.session)).toEqual([BACK_SQUAT, idOf("box-jump"), PLANK]);
  });

  it("keeps a leading warm-up block at the start", () => {
    const written = session([
      { label: "Warm-up", items: [{ exerciseId: idOf("ankle-dorsiflexion-mobilization"), sets: 2 }] },
      {
        label: "Jumps",
        items: [
          { exerciseId: APPROACH, sets: 3, reps: 8 },
          { exerciseId: DEPTH_JUMP, sets: 3, reps: 8 },
        ],
      },
      { label: "Strength", items: [{ exerciseId: BACK_SQUAT, sets: 3, reps: 5, loadPctOf1rm: 80 }] },
    ]);
    const demand = demandOrder(written, context);
    expect(demand.changes).toEqual([]);
    expect(demand.session).toEqual(written);
    const main = mainBeforeAssistance(written, context);
    expect(main.changes).toEqual([]);
    expect(main.session).toEqual(written);
  });

  it("still sorts a trailing stretch block after the training work", () => {
    const result = demandOrder(
      session([
        { label: "Strength", items: [{ exerciseId: BACK_SQUAT, sets: 3, reps: 5, loadPctOf1rm: 80 }] },
        { label: "Stretch", items: [{ exerciseId: idOf("hip-flexor-stretch"), sets: 2 }] },
        { label: "Jumps", items: [{ exerciseId: APPROACH, sets: 3, reps: 8 }] },
      ]),
      context,
    );
    expect(order(result.session)).toEqual([APPROACH, BACK_SQUAT, idOf("hip-flexor-stretch")]);
  });

  it("leaves a session naming an unknown exercise as written", () => {
    const written = session([
      {
        label: "Main",
        items: [
          { exerciseId: PLANK, sets: 2 },
          { exerciseId: 9999, sets: 3 },
          { exerciseId: APPROACH, sets: 3, reps: 8 },
        ],
      },
    ]);
    expect(demandOrder(written, context)).toEqual({ session: written, changes: [] });
  });
});

describe("main-before-assistance", () => {
  it("puts main lifts first, then larger groups, then heavier loads", () => {
    const result = mainBeforeAssistance(
      session([
        {
          label: "Strength",
          items: [
            { exerciseId: PULL_UP, sets: 3, reps: 8 },
            { exerciseId: idOf("romanian-deadlift"), sets: 3, reps: 8, loadPctOf1rm: 65 },
            { exerciseId: TRAP_BAR, sets: 3, reps: 5, loadPctOf1rm: 80 },
          ],
        },
      ]),
      context,
    );
    expect(order(result.session)).toEqual([TRAP_BAR, idOf("romanian-deadlift"), PULL_UP]);
    expect(result.changes.map((c) => c.message)).toEqual([
      "Trap bar deadlift moved from 3rd to 1st: main lifts go before assistance.",
    ]);
  });
});

describe("normalizeWeek", () => {
  it("is idempotent", () => {
    const week = baselineWeek();
    week.sessions[0].blocks.reverse();
    for (const item of week.sessions[0].blocks.flatMap((b) => b.items)) {
      item.restSeconds = null;
      item.couplingClass = null;
    }
    const once = normalizeWeek(week, DIRECTORY, DECLARATION.complex);
    expect(once.changes.length).toBeGreaterThan(0);
    expect(normalizeWeek(once.week, DIRECTORY, DECLARATION.complex).changes).toEqual([]);
  });

  it("never touches the plan it was given", () => {
    const week = baselineWeek();
    week.sessions[0].blocks.reverse();
    const copy = structuredClone(week);
    normalizeWeek(week, DIRECTORY, DECLARATION.complex);
    expect(week).toEqual(copy);
  });
});
