import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/days";
import { gateSuite } from "./insight";
import { emptyInputs, type TendonRow } from "./inputs";
import { protocolReadiness } from "./plyo";

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
  });

  it("holds a settled series with too few readings to read a trend from", () => {
    const insight = readiness(series([3, 2, 1, 0, 0]));
    expect(insight.detail?.readyToProgress).toBe(false);
    expect(insight.n).toBeLessThan(insight.minN);
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
