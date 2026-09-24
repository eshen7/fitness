import { describe, expect, it } from "vitest";
import {
  advise,
  ruleOf60,
  sessionSetCap,
  strengthFrequency,
  targetShare,
  type AdvisoryInput,
} from "./advisories";
import {
  APPROACH,
  BACK_SQUAT,
  baselineReview,
  baselineWeek,
  BOUND,
  DECLARATION,
  PLANK,
  priorWeek,
} from "./fixtures/baseline";
import { DIRECTORY } from "./fixtures/directory";
import { reviewWeek } from "./index";
import type { MicrocyclePlan, PlannedSession, PlannedSet } from "./types";

function input(overrides: Partial<AdvisoryInput> = {}): AdvisoryInput {
  return {
    declaration: DECLARATION,
    directory: DIRECTORY,
    week: baselineWeek(),
    priorWeeks: [priorWeek()],
    ...overrides,
  };
}

function day(date: string, items: PlannedSet[], kind: PlannedSession["kind"] = "mixed"): PlannedSession {
  return { day: date, kind, plannedIntensity: 6, blocks: [{ label: "Main", items }] };
}

function weekOf(sessions: PlannedSession[], loadType: MicrocyclePlan["loadType"] = "stimulating") {
  return { ordinal: 1, startDate: "2026-09-21", loadType, relativeLoad: 0.8, sessions };
}

const squat = (sets: number): PlannedSet => ({
  exerciseId: BACK_SQUAT,
  sets,
  reps: 3,
  loadPctOf1rm: 85,
  restSeconds: 270,
});
const bound = (sets: number): PlannedSet => ({ exerciseId: BOUND, sets, reps: 8, restSeconds: 90 });

const messages = (found: { message: string }[]) => found.map((a) => a.message);

describe("target-share", () => {
  it("notes a block with no room for supporting work", () => {
    const week = weekOf([day("2026-09-21", [bound(4), squat(4)]), day("2026-09-24", [bound(3), squat(3)])]);
    expect(messages(targetShare(input({ week, priorWeeks: [] })))).toEqual([
      "100% of block volume so far is on the targets (max strength and reactive strength). Aim for 70 to 80%: above 85% leaves no room for supporting work.",
      "Max strength has 50% of block volume so far. With two targets each takes about 35 to 40%.",
      "Reactive strength has 50% of block volume so far. With two targets each takes about 35 to 40%.",
    ]);
  });

  it("does not split a single target", () => {
    const declaration = { ...DECLARATION, targetAbilities: ["max_strength" as const] };
    const week = weekOf([day("2026-09-21", [squat(8), bound(2)])]);
    expect(messages(targetShare(input({ declaration, week, priorWeeks: [] })))).toEqual([]);
  });

  it("counts the block to date, not the week alone", () => {
    const lopsided = weekOf([day("2026-09-21", [squat(8)])]);
    expect(targetShare(input({ week: lopsided, priorWeeks: [] })).length).toBeGreaterThan(0);
    // 8 max strength, 8 reactive and 5 core: 76% on the targets, 38% each.
    const balanced = weekOf([day("2026-09-14", [bound(5), { exerciseId: APPROACH, sets: 3, reps: 8 }])]);
    const block = [balanced, weekOf([day("2026-09-17", [{ exerciseId: PLANK, sets: 5 }])])];
    expect(messages(targetShare(input({ week: lopsided, priorWeeks: block })))).toEqual([]);
  });
});

describe("rule-of-60", () => {
  it("notes a light day lighter than it needs to be", () => {
    const week = weekOf([day("2026-09-21", [squat(10)]), day("2026-09-23", [squat(4)])]);
    expect(messages(ruleOf60(input({ week })))).toEqual([
      "The lightest day (Wed 23 Sept, 4 sets) is 40% of the heaviest (Mon 21 Sept, 10 sets). The rule of 60% puts it near 60%, so the light day is lighter than it needs to be.",
    ]);
  });

  it("sums two sessions on one day into that day's volume", () => {
    const even = weekOf([
      day("2026-09-21", [squat(6)]),
      day("2026-09-21", [squat(4)]),
      day("2026-09-23", [squat(16)]),
    ]);
    expect(ruleOf60(input({ week: even }))).toEqual([]);
    const light = weekOf([
      day("2026-09-21", [squat(5)]),
      day("2026-09-21", [squat(5)]),
      day("2026-09-23", [squat(20)]),
    ]);
    expect(messages(ruleOf60(input({ week: light })))).toEqual([
      "The lightest day (Mon 21 Sept, 10 sets) is 50% of the heaviest (Wed 23 Sept, 20 sets). The rule of 60% puts it near 60%, so the light day is lighter than it needs to be.",
    ]);
  });

  it("needs two training days to compare", () => {
    const week = weekOf([day("2026-09-21", [squat(10)]), day("2026-09-23", [squat(2)], "test")]);
    expect(ruleOf60(input({ week }))).toEqual([]);
  });
});

describe("strength-frequency", () => {
  it("asks for two sessions of about 30 minutes to retain strength", () => {
    const week = weekOf(
      [day("2026-09-21", [squat(6)]), day("2026-09-24", [squat(2)])],
      "retaining",
    );
    expect(messages(strengthFrequency(input({ week })))).toEqual([
      "Strength work of about 30 minutes on 1 day (Mon 21 Sept). Retaining strength takes at least 2 such sessions a week.",
    ]);
    week.sessions[1] = day("2026-09-24", [squat(5)]);
    expect(strengthFrequency(input({ week }))).toEqual([]);
  });

  it("counts two sessions on one day as one day", () => {
    const week = weekOf([
      day("2026-09-21", [squat(4)]),
      day("2026-09-21", [squat(4)]),
      day("2026-09-23", [squat(4)]),
    ]);
    expect(messages(strengthFrequency(input({ week })))).toEqual([
      "Strength work on 2 days (Mon 21 Sept and Wed 23 Sept). The block targets strength, and gaining it takes heavy resistance training at least 3 times a week.",
    ]);
  });

  it("sums two short sessions on one day toward the 30 minutes", () => {
    const week = weekOf(
      [day("2026-09-21", [squat(3)]), day("2026-09-21", [squat(3)]), day("2026-09-24", [squat(6)])],
      "retaining",
    );
    expect(strengthFrequency(input({ week }))).toEqual([]);
  });

  it("holds a block not targeting strength to retention even in a stimulating week", () => {
    const declaration = { ...DECLARATION, targetAbilities: ["reactive_strength" as const] };
    const week = weekOf([day("2026-09-21", [squat(6)]), day("2026-09-24", [squat(6)])]);
    expect(strengthFrequency(input({ declaration, week }))).toEqual([]);
  });
});

describe("session-set-cap", () => {
  it("allows up to 22 sets, and ignores sessions that are not training", () => {
    const week = weekOf([
      day("2026-09-21", [squat(11), bound(11)]),
      day("2026-09-24", [squat(30)], "test"),
    ]);
    expect(sessionSetCap(input({ week }))).toEqual([]);
    week.sessions[0] = day("2026-09-21", [squat(12), bound(11)]);
    expect(sessionSetCap(input({ week }))).toMatchObject([
      { day: "2026-09-21", scope: "session" },
    ]);
  });
});

describe("advise", () => {
  it("says nothing about the baseline", () => {
    expect(advise(input())).toEqual([]);
  });

  it("is withheld while the gate is failing, since the plan goes back for repair", () => {
    // Monday at 24 sets would draw the set-cap note, but the week repeats week
    // 1's load and volume, so it fails the gate first.
    const review = baselineReview();
    const [mon, , fri] = review.week.sessions;
    mon.blocks[2].items[0].sets = 6;
    fri.blocks[1].items[0].sets = 2;
    fri.blocks[1].items[1].sets = 1;
    review.week.relativeLoad = 0.8;
    const result = reviewWeek(review);
    expect(result.violations.map((v) => v.rule)).toEqual(["load-not-complex"]);
    expect(result.advisories).toEqual([]);
    expect(result.passed).toBe(false);
    expect(advise(input({ week: result.week })).map((a) => a.rule)).toContain("session-set-cap");
  });
});
