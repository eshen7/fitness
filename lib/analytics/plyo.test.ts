import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/days";
import { gateSuite } from "./insight";
import { emptyInputs, type AnalyticsExercise, type LoggedSetRow, type TendonRow } from "./inputs";
import { painLag, protocolReadiness } from "./plyo";

/**
 * Protocol readiness, the one insight that recommends doing more to a painful tendon.
 *
 * Every case here is about which way a doubt resolves. The rule is that progressing has
 * to be shown - pain low now, and a slope whose whole interval sits at or below zero -
 * so a noisy series, a short one, or one that is still being written after `asOf` all
 * read as hold.
 */

const AS_OF = "2026-09-26";

/** One reading every third day, ending three days before `AS_OF`. */
function series(values: readonly number[], phase: number | null = 2): TendonRow[] {
  return values.map((value, index) => ({
    day: addDays(AS_OF, -3 * (values.length - index)),
    site: "patellar_left",
    painDuringLoad: value,
    painAfterLoad: 0,
    morningStiffness: 0,
    protocolPhase: phase,
  }));
}

function readiness(tendon: TendonRow[]) {
  const [insight] = protocolReadiness({ ...emptyInputs(AS_OF), tendon });
  return insight;
}

describe("protocolReadiness", () => {
  it("reads a noisy series whose slope cannot be told from a rise as not ready", () => {
    const insight = readiness(series([0, 2, 0, 3, 1, 3]));
    expect(insight.detail?.readyToProgress).toBe(false);
    expect(insight.statement).toContain("hold this phase");
    expect(insight.statement).toContain("could still be a rise");
    expect(insight.ciHigh as number).toBeGreaterThan(0);
  });

  it("recommends the next phase on a low pain that is measurably falling", () => {
    const insight = readiness(series([5, 4, 4, 3, 2, 2, 1]));
    expect(insight.detail?.readyToProgress).toBe(true);
    expect(insight.statement).toContain("move to phase 3");
    expect(insight.statement).toContain("confirmation");
    expect(insight.ciHigh as number).toBeLessThanOrEqual(0);
  });

  it("tests the slope in one unit, against a null of no change", () => {
    const insight = readiness(series([5, 4, 4, 3, 2, 2, 1]));
    expect(insight.unit).toBe("pain points per week");
    expect(insight.value).toBeLessThan(0);
    expect(insight.nullValue).toBe(0);
    expect(insight.p).not.toBeNull();
    expect(insight.ciLow as number).toBeLessThanOrEqual(insight.value);
    expect(insight.ciHigh as number).toBeGreaterThanOrEqual(insight.value);
  });

  it("goes through the suite's gate like any other claim", () => {
    const [gated] = gateSuite([readiness(series([5, 4, 4, 3, 2, 2, 1]))]);
    expect(gated.pAdjusted).not.toBeNull();
    expect(gated.assertable).toBe(true);
  });

  it("holds a falling series that is still above the protocol's pain ceiling", () => {
    const insight = readiness(series([9, 8, 7, 6, 5, 4]));
    expect(insight.detail?.readyToProgress).toBe(false);
    expect(insight.ciHigh as number).toBeLessThan(0);
    expect(insight.statement).toContain("above the 3/10 ceiling");
    expect(insight.statement).not.toContain("could still be a rise");
  });

  it("holds a settled series with too few readings to read a trend from", () => {
    const insight = readiness(series([3, 2, 1, 0, 0]));
    expect(insight.detail?.readyToProgress).toBe(false);
    expect(insight.n).toBeLessThan(insight.minN);
    expect(insight.statement).toContain("short of the 6 a trend needs");
    expect(insight.statement).not.toContain("ceiling");
  });

  it("says return to full load from phase 4, never phase 5", () => {
    const insight = readiness(series([5, 4, 4, 3, 2, 2, 1], 4));
    expect(insight.detail?.readyToProgress).toBe(true);
    expect(insight.statement).toContain("return to full jumping and sprinting load");
    expect(insight.statement).not.toContain("phase 5");
  });

  it("ignores readings dated after the day it is computed for", () => {
    const later: TendonRow = {
      ...series([9])[0],
      day: addDays(AS_OF, 1),
    };
    const insight = readiness([...series([5, 4, 4, 3, 2, 2, 1]), later]);
    expect(insight.n).toBe(7);
    expect(insight.detail?.readyToProgress).toBe(true);
  });

  it("reports nothing for a site with no protocol", () => {
    const tendon = series([1, 1, 1, 1, 1, 1], null);
    expect(protocolReadiness({ ...emptyInputs(AS_OF), tendon })).toEqual([]);
  });
});

const POGO: AnalyticsExercise = {
  id: 1,
  name: "Pogo hop",
  primaryMuscleGroup: "lower_leg",
  movementPattern: "hop",
  forceVelocity: "reactive",
  couplingClass: "short_ssc",
  highImpact: true,
  loadsTendonSites: ["patellar_left"],
  tendonLoadRating: 3,
};

/** Twenty days of rising contacts, with the pain on each day given by `pain(index)`. */
function contactsAndPain(pain: (index: number) => number) {
  const days = Array.from({ length: 20 }, (_, index) => addDays(AS_OF, index - 20));
  const loggedSets: LoggedSetRow[] = days.map((day, index) => ({
    day,
    sessionId: index + 1,
    exerciseId: POGO.id,
    reps: 20 + 5 * index,
    loadKg: null,
    holdSeconds: null,
    boxHeightCm: null,
    rpe: null,
    qualityRating: null,
    prescribedSetId: null,
  }));
  const tendon: TendonRow[] = days.map((day, index) => ({
    day,
    site: "patellar_left",
    painDuringLoad: pain(index),
    painAfterLoad: 0,
    morningStiffness: 0,
    protocolPhase: null,
  }));
  return { ...emptyInputs(AS_OF), exercises: new Map([[POGO.id, POGO]]), loggedSets, tendon };
}

describe("painLag", () => {
  it("reports how long pain follows contacts when more contacts mean more pain", () => {
    const [insight] = painLag(contactsAndPain((index) => Math.floor(index / 2)));
    expect(insight.value).toBeGreaterThan(0);
    expect(insight.nullValue).toBe(0);
    expect(gateSuite([insight])[0].assertable).toBe(true);
  });

  it("says nothing when pain falls as contacts rise, which is load being cut on painful days", () => {
    expect(painLag(contactsAndPain((index) => Math.floor((19 - index) / 2)))).toEqual([]);
  });
});
