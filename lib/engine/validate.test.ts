import { describe, expect, it } from "vitest";
import {
  APPROACH,
  BACK_SQUAT,
  baselineWeek,
  BENCH,
  BOUND,
  DECLARATION,
  DEPTH_JUMP,
  PLANK,
  priorSession,
  priorWeek,
  TRAP_BAR,
} from "./fixtures/baseline";
import { DIRECTORY, idOf, STOCK } from "./fixtures/directory";
import type { MesocycleDeclaration, MicrocyclePlan, PlannedSession } from "./types";
import {
  backToBack,
  closedSet,
  gate,
  loadNotComplex,
  plyoFrequency,
  stableComplex,
  targetCount,
  type GateInput,
} from "./validate";

const ALL = new Set(STOCK.map((exercise) => exercise.id));
const PLYOS = [APPROACH, DEPTH_JUMP, BOUND];

function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    declaration: DECLARATION,
    directory: DIRECTORY,
    eligible: ALL,
    week: baselineWeek(),
    priorWeeks: [priorWeek()],
    priorSession: priorSession(),
    ...overrides,
  };
}

function without(ids: number[], week = baselineWeek()): MicrocyclePlan {
  for (const session of week.sessions) {
    for (const block of session.blocks) {
      block.items = block.items.filter((item) => !ids.includes(item.exerciseId));
    }
    session.blocks = session.blocks.filter((block) => block.items.length > 0);
  }
  return week;
}

const messages = (violations: { message: string }[]) => violations.map((v) => v.message);

describe("closed-set", () => {
  it("checks the complex at declaration, giving the pre-filter's reason", () => {
    const declaration: MesocycleDeclaration = {
      ...DECLARATION,
      complex: [...DECLARATION.complex, { exerciseId: 9999, isMain: false }],
    };
    const eligible = new Set([...ALL].filter((id) => id !== BENCH));
    const violations = closedSet({
      declaration,
      directory: DIRECTORY,
      eligible,
      excluded: [
        { rule: "equipment", exerciseId: BENCH, message: "Bench press is out: the rack is not available." },
      ],
    });
    expect(violations).toMatchObject([
      {
        scope: "mesocycle",
        exerciseIds: [BENCH],
        message:
          "Bench press is not in the candidate set. Bench press is out: the rack is not available.",
      },
      {
        scope: "mesocycle",
        exerciseIds: [9999],
        message:
          "Exercise 9999 is not in the directory. The directory is a closed set, so file a suggested addition rather than inventing one.",
      },
    ]);
  });

  it("reports an exercise once however often the week names it", () => {
    const eligible = new Set([...ALL].filter((id) => id !== BACK_SQUAT));
    expect(messages(closedSet(input({ eligible })))).toEqual([
      "Back squat is not in the candidate set, so it cannot be prescribed.",
    ]);
  });

  it("runs alone, because the other rules cannot reason about what is outside the set", () => {
    const eligible = new Set([...ALL].filter((id) => id !== BACK_SQUAT));
    const week = baselineWeek();
    week.relativeLoad = 0.8;
    expect(gate(input({ eligible, week })).map((v) => v.rule)).toEqual(["closed-set"]);
  });
});

describe("target-count", () => {
  it("needs at least one target", () => {
    expect(messages(targetCount({ ...DECLARATION, targetAbilities: [] }))).toEqual([
      "The block declares no target ability. A block trains 1 or 2.",
    ]);
  });

  it("counts distinct targets and focuses, ignoring blank focuses", () => {
    expect(
      targetCount({
        ...DECLARATION,
        targetAbilities: ["max_strength", "max_strength"],
        technicalFocus: ["Penultimate step", " Penultimate step ", ""],
      }),
    ).toEqual([]);
    expect(targetCount({ ...DECLARATION, technicalFocus: [] })).toEqual([]);
  });
});

describe("stable-complex", () => {
  it("names a duplicated entry", () => {
    const declaration = {
      ...DECLARATION,
      complex: [...DECLARATION.complex, { exerciseId: PLANK, isMain: false }],
    };
    expect(messages(stableComplex(input({ declaration, week: undefined })))).toEqual([
      "Plank is listed in the complex more than once.",
    ]);
  });

  it("asks a complex over twelve to drop the excess", () => {
    const extra = ["romanian-deadlift", "hip-thrust", "nordic-hamstring-curl", "chin-up", "dip"];
    const declaration = {
      ...DECLARATION,
      complex: [...DECLARATION.complex, ...extra.map((slug) => ({ exerciseId: idOf(slug), isMain: false }))],
    };
    expect(messages(stableComplex(input({ declaration, week: undefined })))).toEqual([
      "The complex holds 13 exercises. A block runs one stable complex of roughly ten, 8 to 12, so drop 1 or more.",
    ]);
  });

  it("raises the weekly floor to an item's own target frequency", () => {
    const declaration = {
      ...DECLARATION,
      complex: DECLARATION.complex.map((item) =>
        item.exerciseId === BACK_SQUAT ? { ...item, targetWeeklyFrequency: 3 } : item,
      ),
    };
    expect(messages(stableComplex(input({ declaration })))).toEqual([
      "Back squat appears on 2 days (Mon 21 Sept and Wed 23 Sept) this week. Each complex exercise appears at least 3 times a week.",
    ]);
  });

  it("does not ask for a complex exercise the pre-filter has since removed", () => {
    const eligible = new Set([...ALL].filter((id) => id !== BENCH));
    expect(stableComplex(input({ eligible, week: without([BENCH]) }))).toEqual([]);
  });
});

describe("load-not-complex", () => {
  it("allows one stand-in per complex exercise the pre-filter removed", () => {
    const eligible = new Set([...ALL].filter((id) => id !== BACK_SQUAT));
    const week = baselineWeek();
    for (const item of week.sessions.flatMap((s) => s.blocks.flatMap((b) => b.items))) {
      if (item.exerciseId === BACK_SQUAT) item.exerciseId = idOf("bulgarian-split-squat");
    }
    expect(loadNotComplex(input({ eligible, week }))).toEqual([]);

    week.sessions[1].blocks[0].items.push({ exerciseId: idOf("hip-thrust"), sets: 2, reps: 8 });
    expect(messages(loadNotComplex(input({ eligible, week })))).toEqual([
      "Bulgarian split squat and Barbell hip thrust are not in the block's complex. Load varies within a block, the exercises do not. Only 1 stand-in is allowed, for Back squat, which the pre-filter removed.",
    ]);
  });

  it("lets mobility drills in without a place in the complex", () => {
    const week = baselineWeek();
    week.sessions[0].blocks.unshift({
      label: "Warm-up",
      items: [{ exerciseId: idOf("ankle-dorsiflexion-mobilization"), sets: 1, reps: 10 }],
    });
    expect(loadNotComplex(input({ week }))).toEqual([]);
  });

  it("accepts a week at the same load when volume moves 10% or more", () => {
    const week = baselineWeek();
    week.relativeLoad = 0.8;
    // 48 sets to 43 is a 10.4% drop.
    for (const item of week.sessions[1].blocks.flatMap((b) => b.items)) {
      if (item.exerciseId !== PLANK) item.sets -= 1;
    }
    week.sessions[1].blocks[1].items[0].sets = 1;
    expect(loadNotComplex(input({ week }))).toEqual([]);
  });

  it("has nothing to compare in a block's first week", () => {
    const week = baselineWeek();
    week.relativeLoad = 0.8;
    expect(loadNotComplex(input({ week, priorWeeks: [] }))).toEqual([]);
  });
});

describe("plyo-frequency", () => {
  const fridayWithoutJumps = () => {
    const week = baselineWeek();
    week.sessions[2].blocks = week.sessions[2].blocks.filter((b) => b.label !== "Jumps");
    return week;
  };

  it("needs two plyometric days", () => {
    expect(messages(plyoFrequency(input({ week: fridayWithoutJumps() })))).toEqual([
      "Plyometrics on 1 day (Mon 21 Sept). They need 2 to 3 days a week to drive adaptation.",
    ]);
    expect(messages(plyoFrequency(input({ week: without(PLYOS) })))).toEqual([
      "Plyometrics on no day. They need 2 to 3 days a week to drive adaptation.",
    ]);
  });

  it("drops the floor in a detraining week or when no plyometric is eligible", () => {
    const detraining = { ...fridayWithoutJumps(), loadType: "detraining" as const };
    expect(plyoFrequency(input({ week: detraining }))).toEqual([]);
    const eligible = new Set(STOCK.filter((e) => e.couplingClass === "not_plyometric").map((e) => e.id));
    expect(plyoFrequency(input({ eligible, week: without(PLYOS) }))).toEqual([]);
  });

  /** Plyometrics on the given sessions, with no shock work and no session above 7. */
  function gentleWeek(days: string[]) {
    const week = without([DEPTH_JUMP]);
    week.sessions[0].plannedIntensity = 7;
    const extra: PlannedSession[] = days.map((day) => ({
      day,
      kind: "plyometric",
      plannedIntensity: 5,
      blocks: [{ label: "Jumps", items: [{ exerciseId: idOf("pogo-hop"), sets: 3, reps: 10 }] }],
    }));
    week.sessions.push(...extra);
    return week;
  }

  it("allows a third day when nothing in the week is intense", () => {
    expect(plyoFrequency(input({ week: gentleWeek(["2026-09-26"]) }))).toEqual([]);
    expect(messages(plyoFrequency(input({ week: gentleWeek(["2026-09-26", "2026-09-27"]) })))).toEqual([
      "Plyometrics on 4 days (Mon 21 Sept, Fri 25 Sept, Sat 26 Sept and Sun 27 Sept). The ceiling is 3 days a week, because frequency runs inverse to intensity.",
    ]);
  });

  it("lowers the ceiling to two for a plyometric session at 8 or above", () => {
    const week = gentleWeek(["2026-09-26"]);
    week.sessions[3].plannedIntensity = 8;
    expect(messages(plyoFrequency(input({ week })))).toEqual([
      "Plyometrics on 3 days (Mon 21 Sept, Fri 25 Sept and Sat 26 Sept) in a week with a plyometric session at intensity 8 (Sat 26 Sept). At that intensity the ceiling is 2 days a week, because frequency runs inverse to intensity.",
    ]);
  });
});

describe("back-to-back", () => {
  it("checks across the week boundary", () => {
    const sunday: PlannedSession = { ...priorSession(), day: "2026-09-20" };
    expect(messages(backToBack(input({ priorSession: sunday })))).toEqual([
      "Sun 20 Sept and Mon 21 Sept are back to back. Both train the full body, knee extensors and posterior chain, and both repeat the \"Jump, two foot\", \"Depth drop\" and \"Bound\" patterns (Two foot approach jump, Depth jump, Back squat and Alternate leg bound on Mon 21 Sept). Back-to-back sessions must not repeat a large muscle group or a coordination pattern.",
    ]);
  });

  it("ignores low-coordination patterns and small muscle groups", () => {
    const week = baselineWeek();
    week.sessions.push({
      day: "2026-09-22",
      kind: "strength",
      plannedIntensity: 3,
      blocks: [
        {
          label: "Accessories",
          items: [
            { exerciseId: PLANK, sets: 3, holdSeconds: 45 },
            { exerciseId: idOf("lateral-raise"), sets: 3, reps: 12 },
            { exerciseId: idOf("tibialis-raise"), sets: 3, reps: 15 },
          ],
        },
      ],
    });
    expect(backToBack(input({ week }))).toEqual([]);
  });

  it("ignores sessions that are not training", () => {
    const week = baselineWeek();
    week.sessions.push({
      day: "2026-09-22",
      kind: "tendon_protocol",
      plannedIntensity: 2,
      blocks: [{ label: "Protocol", items: [{ exerciseId: idOf("spanish-squat-isometric"), sets: 5, holdSeconds: 45 }] }],
    });
    expect(backToBack(input({ week }))).toEqual([]);
  });

  it("treats two sessions on one day as back to back", () => {
    const week = baselineWeek();
    week.sessions.push({
      day: "2026-09-25",
      kind: "strength",
      plannedIntensity: 4,
      blocks: [{ label: "Pull", items: [{ exerciseId: TRAP_BAR, sets: 2, reps: 5 }] }],
    });
    expect(messages(backToBack(input({ week })))).toEqual([
      "The two sessions on Fri 25 Sept are back to back. Both train the posterior chain, and both repeat the \"Hinge\" pattern (Trap bar deadlift on Fri 25 Sept). Back-to-back sessions must not repeat a large muscle group or a coordination pattern.",
    ]);
  });
});
