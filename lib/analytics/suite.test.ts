import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/days";
import { FALSE_DISCOVERY_RATE, type Insight } from "./insight";
import {
  emptyInputs,
  type AnalyticsExercise,
  type AnalyticsInputs,
  type LoggedSetRow,
  type PrescribedSetRow,
  type SessionRow,
} from "./inputs";
import { computeInsights, IncompleteSuiteError, PRODUCERS, rank } from "./suite";

/**
 * The suite as a whole, over one synthetic history and no database.
 *
 * Per-producer arithmetic is not what this file is for - `stats.test.ts` owns the
 * estimators and `insight.test.ts` owns the gate. What is only checkable here is the
 * contract every producer shares and none of them can enforce alone: that each
 * statement arrives with an n, an interval and a subject, that nothing is asserted
 * without clearing all three conditions, and that a number in a statement is on the
 * same scale as the interval printed beside it. Those are the invariants the screen and
 * the prompt are both built on, and a new producer breaking one of them would otherwise
 * be caught by reading the page rather than by running the tests.
 */

const AS_OF = "2026-09-26";
const DAYS = 140;

/** A day count back from `AS_OF`, so every fixture row is inside every window. */
function day(offset: number): string {
  return addDays(AS_OF, -DAYS + offset);
}

const SQUAT: AnalyticsExercise = {
  id: 1,
  name: "Back squat",
  primaryMuscleGroup: "knee_extensors",
  movementPattern: "squat",
  forceVelocity: "max_strength",
  couplingClass: "not_plyometric",
  highImpact: false,
  loadsTendonSites: ["patellar_left", "patellar_right"],
  tendonLoadRating: 3,
};

const DEPTH_JUMP: AnalyticsExercise = {
  id: 2,
  name: "Depth jump",
  primaryMuscleGroup: "knee_extensors",
  movementPattern: "depth_drop",
  forceVelocity: "shock",
  couplingClass: "short_ssc",
  highImpact: true,
  loadsTendonSites: ["patellar_left", "patellar_right"],
  tendonLoadRating: 5,
};

/**
 * Twenty weeks of plausible training, built to reach every producer.
 *
 * Deliberately regular - three sessions a week, one test day a fortnight, a squat that
 * climbs and a bodyweight that drifts - because the point is to produce a suite with
 * both assertable and withheld statements in it, not to model an athlete. The one
 * effect planted on purpose is a right leg that jumps consistently higher than the
 * left, which `jump.asymmetry` should find and name in the right direction.
 */
function history(): AnalyticsInputs {
  const inputs = emptyInputs(AS_OF);
  inputs.trainableWeekdays = [1, 3, 5];
  inputs.exercises = new Map([
    [SQUAT.id, SQUAT],
    [DEPTH_JUMP.id, DEPTH_JUMP],
  ]);

  const sessions: SessionRow[] = [];
  const prescribed: PrescribedSetRow[] = [];
  const logged: LoggedSetRow[] = [];
  let sessionId = 0;
  let prescribedId = 0;

  for (let offset = 0; offset < DAYS; offset += 1) {
    const today = day(offset);
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    if (!inputs.trainableWeekdays.includes(weekday)) continue;

    sessionId += 1;
    const week = Math.floor(offset / 7);
    // Every fourth Friday is missed, so the completion rate is under one and the
    // weekday breakdown has something to distinguish.
    const completed = !(weekday === 5 && week % 4 === 3);
    sessions.push({
      id: sessionId,
      day: today,
      kind: weekday === 3 ? "plyometric" : "strength",
      plannedSets: 18,
      plannedContacts: weekday === 3 ? 40 : 0,
      plannedIntensity: 7,
      reportedRpe: 7 + (week % 3) * 0.5,
      completed,
      skipped: !completed,
      microcycleId: week + 1,
    });
    if (!completed) continue;

    prescribedId += 1;
    prescribed.push({
      id: prescribedId,
      sessionId,
      exerciseId: SQUAT.id,
      sets: 4,
      reps: 5,
      targetRpe: 7,
      loadKg: 100 + week,
    });
    for (let set = 0; set < 4; set += 1) {
      logged.push({
        day: today,
        sessionId,
        exerciseId: SQUAT.id,
        reps: 5,
        // Climbs a kilo a week, which is what the e1RM and relative strength trends read.
        loadKg: 100 + week + set * 0.5,
        holdSeconds: null,
        boxHeightCm: null,
        // Half a point above what was asked for, which is the calibration finding.
        rpe: 7.5,
        qualityRating: 4,
        prescribedSetId: prescribedId,
      });
    }
    if (weekday === 3) {
      for (let set = 0; set < 5; set += 1) {
        logged.push({
          day: today,
          sessionId,
          exerciseId: DEPTH_JUMP.id,
          reps: 8,
          loadKg: null,
          holdSeconds: null,
          boxHeightCm: 45,
          rpe: 8,
          qualityRating: 4,
          prescribedSetId: null,
        });
      }
    }

    inputs.readiness.push({
      day: today,
      recoveryScore: 60 + (week % 5) * 4,
      hrvMs: 70 + (week % 4) * 3,
      restingHeartRate: 52,
      sleepMinutes: 420,
      sleepPerformancePct: 88,
      slowWaveMinutes: 90,
      remMinutes: 100,
      dayStrain: weekday === 3 ? 15 + (week % 3) : 12 + (week % 3),
      motivation: 4,
      sorenessByRegion: {},
    });
    inputs.tendon.push({
      day: today,
      site: "patellar_left",
      painDuringLoad: weekday === 3 ? 3 : 1,
      painAfterLoad: weekday === 3 ? 3 : 1,
      morningStiffness: 1,
      protocolPhase: 3,
    });
  }

  for (let offset = 0; offset < DAYS; offset += 14) {
    const testDay = day(offset);
    const base = 70 + offset / 20;
    inputs.tests.push(
      sitting("standing_vertical", testDay, [base - 1, base, base - 0.5]),
      sitting("two_foot_approach_vertical", testDay, [base + 4, base + 5, base + 4.5]),
      // The planted effect: the right leg is about four centimetres better throughout.
      sitting("one_foot_approach_left", testDay, [base - 2, base - 1.5]),
      sitting("one_foot_approach_right", testDay, [base + 2, base + 2.5]),
      { ...sitting("depth_jump_vertical", testDay, [base + 1, base + 1.5]), boxHeightCm: 45 },
    );
  }

  for (let offset = 0; offset < DAYS; offset += 1) {
    inputs.bodyweight.push({ day: day(offset), kg: 82 + offset * 0.01 });
    inputs.intake.push({ day: day(offset), kcal: 3000 + (offset % 7) * 60 });
  }

  inputs.blocks = [
    { id: 1, type: "accumulation", ordinal: 1, startDay: day(0), endDay: day(56), closed: true },
    { id: 2, type: "transmutation", ordinal: 2, startDay: day(56), endDay: day(112), closed: true },
    { id: 3, type: "realization", ordinal: 3, startDay: day(112), endDay: addDays(AS_OF, 1), closed: false },
  ];

  inputs.proposals = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    scope: "microcycle" as const,
    verdict: index % 6 === 5 ? ("rejected" as const) : ("accepted" as const),
    repairAttempts: index % 3 === 0 ? 1 : 0,
    isFallback: false,
    passedFirstAttempt: index % 3 !== 0,
    editedFields: null,
  }));

  inputs.sessions = sessions;
  inputs.prescribedSets = prescribed;
  inputs.loggedSets = logged;
  return inputs;
}

function sitting(
  kind: AnalyticsInputs["tests"][number]["kind"],
  testDay: string,
  attempts: number[],
) {
  return {
    testGroup: `${kind}:${testDay}`,
    kind,
    day: testDay,
    attempts,
    best: Math.max(...attempts),
    boxHeightCm: null,
  };
}

function byKey(insights: readonly Insight[], key: string): Insight | undefined {
  return insights.find((insight) => insight.key === key);
}

describe("computeInsights", () => {
  it("returns nothing at all from an empty history rather than throwing", () => {
    expect(computeInsights(emptyInputs(AS_OF))).toEqual([]);
  });

  it("refuses the whole suite when a producer throws, naming every one that did", () => {
    // Nothing in the real suite throws, so the refusal is checked by handing the
    // producers an input they cannot read: `exercises` is what almost all of them join
    // through, and a null map makes every lookup fail.
    const broken = { ...history(), exercises: null } as unknown as AnalyticsInputs;
    let thrown: unknown = null;
    try {
      computeInsights(broken);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(IncompleteSuiteError);
    const failures = (thrown as IncompleteSuiteError).failures;
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.length).toBeLessThan(PRODUCERS.length);
    for (const failure of failures) {
      expect(failure.producer).toBe(PRODUCERS[failure.index].name);
    }
  });

  describe("over twenty weeks of history", () => {
    const insights = computeInsights(history());

    it("computes a suite with both assertable and withheld statements in it", () => {
      expect(insights.length).toBeGreaterThan(10);
      expect(insights.some((insight) => insight.assertable)).toBe(true);
      expect(insights.some((insight) => !insight.assertable)).toBe(true);
    });

    it("gives every insight a unique key", () => {
      const keys = insights.map((insight) => insight.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it("gives every insight the parts the screen and the prompt need", () => {
      for (const insight of insights) {
        expect(insight.subject, insight.key).not.toBe("");
        expect(insight.statement, insight.key).not.toBe("");
        expect(insight.unit, insight.key).not.toBe("");
        expect(Number.isFinite(insight.value), insight.key).toBe(true);
        expect(insight.n, insight.key).toBeGreaterThan(0);
        expect(insight.minN, insight.key).toBeGreaterThan(0);
      }
    });

    it("never asserts a statement that fails any one of the three conditions", () => {
      for (const insight of insights.filter((candidate) => candidate.assertable)) {
        expect(insight.blockedBy, insight.key).toBeNull();
        expect(insight.n, insight.key).toBeGreaterThanOrEqual(insight.minN);
        if (insight.pAdjusted !== null) {
          expect(insight.pAdjusted, insight.key).toBeLessThanOrEqual(FALSE_DISCOVERY_RATE);
        }
        if (insight.nullValue !== null) {
          expect(insight.ciLow, insight.key).not.toBeNull();
          expect(insight.ciHigh, insight.key).not.toBeNull();
          const contains =
            (insight.ciLow as number) <= insight.nullValue &&
            (insight.ciHigh as number) >= insight.nullValue;
          expect(contains, insight.key).toBe(false);
        }
      }
    });

    it("says why every withheld statement is withheld", () => {
      for (const insight of insights.filter((candidate) => !candidate.assertable)) {
        expect(insight.blockedBy, insight.key).not.toBeNull();
        expect(insight.blockedBy, insight.key).not.toBe("not yet gated");
      }
    });

    it("orders an interval low to high", () => {
      for (const insight of insights) {
        if (insight.ciLow === null || insight.ciHigh === null) continue;
        expect(insight.ciHigh, insight.key).toBeGreaterThanOrEqual(insight.ciLow);
      }
    });

    it("finds the planted asymmetry and names the better leg", () => {
      const asymmetry = byKey(insights, "jump.asymmetry");
      expect(asymmetry).toBeDefined();
      expect(asymmetry?.value).toBeGreaterThan(0);
      expect(asymmetry?.statement).toContain("right leg");
    });

    it("keeps a rate and the sentence quoting it on one scale", () => {
      // The regression this pins: a statement reading "90 percent of the time" printed
      // above an interval reading "0.62 to 0.98", which is the same fact twice on two
      // scales and reads as a contradiction on the screen that shows both.
      const rates = insights.filter((insight) => insight.unit.startsWith("percent of"));
      expect(rates.length).toBeGreaterThan(0);
      for (const insight of rates) {
        expect(insight.value, insight.key).toBeLessThanOrEqual(100);
        expect(insight.statement, insight.key).toContain(
          `${Math.round(insight.value)} percent`,
        );
        expect(insight.ciHigh, insight.key).toBeLessThanOrEqual(100);
      }
    });

    it("ranks the assertable statements first and orders the rest stably", () => {
      const ranked = rank(insights);
      const firstWithheld = ranked.findIndex((insight) => !insight.assertable);
      expect(firstWithheld).toBeGreaterThan(0);
      expect(ranked.slice(firstWithheld).every((insight) => !insight.assertable)).toBe(true);
      expect(rank(ranked).map((insight) => insight.key)).toEqual(
        ranked.map((insight) => insight.key),
      );
    });
  });
});
