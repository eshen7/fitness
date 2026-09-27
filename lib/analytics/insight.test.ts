import { describe, expect, it } from "vitest";
import {
  assertable,
  draft,
  gateSuite,
  holdOut,
  type Insight,
  type InsightDraft,
} from "./insight";

/**
 * The gate, which is the only thing standing between a coincidence in twenty weeks of
 * one athlete's logs and a sentence the app tells them about their own body.
 *
 * Three conditions, and each is tested on its own here because they fail for different
 * reasons and the UI says which: too little data, indistinguishable from chance once
 * the suite is corrected for, or an interval that still contains "nothing happened".
 */

function insight(overrides: Partial<InsightDraft> = {}): Insight {
  return draft({
    key: "test",
    family: "strength",
    tier: 1,
    subject: "Something",
    statement: "Something is happening.",
    value: 2,
    unit: "kg",
    n: 20,
    minN: 8,
    ciLow: 1,
    ciHigh: 3,
    p: 0.001,
    nullValue: 0,
    ...overrides,
  });
}

describe("draft", () => {
  it("leaves an ungated insight unassertable, and says so", () => {
    const drafted = insight();
    expect(drafted.assertable).toBe(false);
    expect(drafted.blockedBy).toBe("not yet gated");
    expect(drafted.pAdjusted).toBeNull();
  });
});

describe("gateSuite", () => {
  it("passes a strong effect with enough data and an interval clear of zero", () => {
    const [gated] = gateSuite([insight()]);
    expect(gated.assertable).toBe(true);
    expect(gated.blockedBy).toBeNull();
  });

  it("withholds on sample size first, naming the shortfall", () => {
    const [gated] = gateSuite([insight({ n: 5, minN: 12 })]);
    expect(gated.assertable).toBe(false);
    expect(gated.blockedBy).toBe("5 of the 12 observations it needs");
  });

  it("withholds when the corrected p is above the rate", () => {
    const [gated] = gateSuite([insight({ p: 0.4 })]);
    expect(gated.blockedBy).toContain("not distinguishable from chance");
    expect(gated.blockedBy).toContain("q = 0.400");
  });

  it("withholds when the interval still contains the null value", () => {
    const [gated] = gateSuite([insight({ ciLow: -0.5, ciHigh: 4 })]);
    expect(gated.blockedBy).toBe("its interval still contains 0");
  });

  it("withholds a tested effect that arrived with no interval at all", () => {
    const [gated] = gateSuite([insight({ ciLow: null, ciHigh: null })]);
    expect(gated.blockedBy).toContain("cannot be separated from none");
  });

  /**
   * A descriptive level - a noise floor, a maintenance calorie estimate - has no null
   * to exclude and no effect to test, so it passes on sample size alone. Reporting one
   * is not a claim that anything is going on.
   */
  it("passes a descriptive level on sample size alone", () => {
    const [gated] = gateSuite([
      insight({ p: null, nullValue: null, ciLow: 2400, ciHigh: 2700, value: 2550 }),
    ]);
    expect(gated.assertable).toBe(true);
    expect(gated.pAdjusted).toBeNull();
  });

  /**
   * The reason `recomputeInsights` always does the whole suite. The same raw p is
   * assertable alone and withheld among twenty statements, because the correction
   * denominator is how many were computed together.
   */
  it("corrects against the size of the whole suite", () => {
    const alone = gateSuite([insight({ key: "a", p: 0.02 })]);
    expect(alone[0].assertable).toBe(true);

    const suite = [
      insight({ key: "a", p: 0.02 }),
      ...Array.from({ length: 19 }, (_, index) =>
        insight({ key: `noise-${index}`, p: 0.8 }),
      ),
    ];
    const gated = gateSuite(suite);
    expect(gated[0].assertable).toBe(false);
    expect(gated[0].pAdjusted!).toBeGreaterThan(0.02);
  });

  it("does not let untested insights dilute the correction", () => {
    // Descriptive levels carry no p, so they must not count toward m. If they did,
    // adding a bodyweight readout would withhold a real strength trend.
    const withDescriptives = gateSuite([
      insight({ key: "effect", p: 0.02 }),
      ...Array.from({ length: 19 }, (_, index) =>
        insight({ key: `level-${index}`, p: null, nullValue: null }),
      ),
    ]);
    expect(withDescriptives[0].pAdjusted).toBeCloseTo(0.02, 10);
    expect(withDescriptives[0].assertable).toBe(true);
  });

  it("keeps the suite's order and length", () => {
    const keys = ["a", "b", "c"];
    const gated = gateSuite(keys.map((key) => insight({ key })));
    expect(gated.map((item) => item.key)).toEqual(keys);
  });
});

describe("assertable", () => {
  it("selects only what the gate passed", () => {
    const gated = gateSuite([
      insight({ key: "pass", p: 0.001 }),
      insight({ key: "fail", n: 2 }),
    ]);
    expect(assertable(gated).map((item) => item.key)).toEqual(["pass"]);
  });
});

describe("holdOut", () => {
  it("confirms a relationship that is really there in both halves", () => {
    const pairs = Array.from({ length: 24 }, (_, index) => ({
      x: index,
      y: 2 * index + (index % 3),
    }));
    const result = holdOut(pairs)!;
    expect(result.holds).toBe(true);
    expect(result.testR).toBeGreaterThan(0.8);
  });

  it("does not confirm a relationship that only exists in the first half", () => {
    // Clean in the train half, scrambled in the test half, which is what an
    // overfitted lag looks like.
    const pairs = [
      ...Array.from({ length: 12 }, (_, index) => ({ x: index, y: 2 * index })),
      ...[7, 1, 9, 3, 11, 2, 8, 4, 10, 5, 0, 6].map((y, index) => ({
        x: index + 12,
        y: y * 2,
      })),
    ];
    const result = holdOut(pairs)!;
    expect(result.holds).toBe(false);
  });

  it("refuses to split a set too small for either half to mean anything", () => {
    expect(holdOut([{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }])).toBeNull();
  });
});
