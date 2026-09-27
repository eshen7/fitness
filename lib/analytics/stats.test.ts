import { describe, expect, it } from "vitest";
import {
  benjaminiHochberg,
  correlation,
  linearFit,
  logisticThreshold,
  logisticFit,
  meanEstimate,
  normalCdf,
  proportionEstimate,
  quadraticFit,
  tCritical,
  theilSen,
  zCritical,
  type Point,
} from "./stats";

/**
 * The arithmetic every insight rests on, checked against values that can be worked out
 * by hand or looked up in a table.
 *
 * Worth testing directly rather than only through the producers, because these are the
 * functions whose being subtly wrong would not look like a bug: a `tCritical` off by a
 * tenth still produces plausible intervals, and the only thing that would catch it is
 * an assertion against a published number.
 */

describe("critical values", () => {
  it("matches the published t table", () => {
    // Two-sided 95%, the column every stats textbook prints.
    expect(tCritical(1)).toBeCloseTo(12.706, 2);
    expect(tCritical(10)).toBeCloseTo(2.228, 2);
    expect(tCritical(30)).toBeCloseTo(2.042, 2);
    // Converges on the normal as df grows.
    expect(tCritical(10000)).toBeCloseTo(1.96, 2);
  });

  it("matches the normal table", () => {
    expect(zCritical()).toBeCloseTo(1.96, 2);
    expect(zCritical(0.9)).toBeCloseTo(1.645, 2);
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });
});

describe("meanEstimate", () => {
  it("centres on the mean with a symmetric interval", () => {
    const estimate = meanEstimate([4, 5, 6, 5, 5], { nullValue: 0 })!;
    expect(estimate.value).toBeCloseTo(5, 10);
    expect(estimate.n).toBe(5);
    expect(estimate.value - estimate.ciLow).toBeCloseTo(estimate.ciHigh - estimate.value, 8);
    expect(estimate.p).not.toBeNull();
    expect(estimate.p!).toBeLessThan(0.01);
  });

  it("cannot reject a null the data sits on", () => {
    const estimate = meanEstimate([-1, 1, -1, 1, 0, 0, 0.5, -0.5], { nullValue: 0 })!;
    expect(estimate.p!).toBeGreaterThan(0.5);
    expect(estimate.ciLow).toBeLessThan(0);
    expect(estimate.ciHigh).toBeGreaterThan(0);
  });
});

describe("proportionEstimate", () => {
  it("keeps the interval inside 0 and 1 even at the edge", () => {
    const estimate = proportionEstimate(12, 12)!;
    expect(estimate.value).toBe(1);
    expect(estimate.ciHigh).toBeLessThanOrEqual(1);
    expect(estimate.ciLow).toBeGreaterThan(0);
  });
});

describe("linearFit", () => {
  it("recovers an exact line and reports no residual scatter", () => {
    const points: Point[] = [1, 2, 3, 4, 5].map((x) => ({ x, y: 3 * x + 2 }));
    const fit = linearFit(points)!;
    expect(fit.slope).toBeCloseTo(3, 8);
    expect(fit.intercept).toBeCloseTo(2, 8);
    expect(fit.r2).toBeCloseTo(1, 8);
  });

  it("refuses a fit with nothing to fit", () => {
    expect(linearFit([{ x: 1, y: 1 }])).toBeNull();
    expect(linearFit([{ x: 1, y: 1 }, { x: 1, y: 4 }])).toBeNull();
  });

  it("brackets zero when the slope is noise", () => {
    const fit = linearFit([
      { x: 1, y: 5 },
      { x: 2, y: 4 },
      { x: 3, y: 6 },
      { x: 4, y: 5 },
      { x: 5, y: 4 },
      { x: 6, y: 6 },
    ])!;
    expect(fit.slopeCiLow).toBeLessThan(0);
    expect(fit.slopeCiHigh).toBeGreaterThan(0);
  });
});

describe("theilSen", () => {
  it("ignores a single wild point that would drag a least-squares slope", () => {
    const clean: Point[] = [1, 2, 3, 4, 5, 6, 7, 8].map((x) => ({ x, y: 2 * x }));
    const withOutlier = [...clean, { x: 9, y: 200 }];
    const robust = theilSen(withOutlier)!;
    const naive = linearFit(withOutlier)!;
    expect(robust.slope).toBeCloseTo(2, 1);
    expect(naive.slope).toBeGreaterThan(5);
  });
});

describe("quadraticFit", () => {
  it("finds the peak of a downward parabola in the caller's own units", () => {
    // Vertex at x = 45, which is a plausible drop height in centimetres and the
    // magnitude that made centring necessary in the first place.
    const at = (x: number) => -0.02 * (x - 45) ** 2 + 60;
    const fit = quadraticFit([30, 40, 45, 50, 60, 70].map((x) => ({ x, y: at(x) })))!;
    expect(fit.vertexX!).toBeCloseTo(45, 4);
    expect(fit.at(45)).toBeCloseTo(60, 4);
    expect(fit.r2).toBeCloseTo(1, 6);
  });

  it("reports no vertex for a curve that opens upward", () => {
    const fit = quadraticFit([1, 2, 3, 4, 5].map((x) => ({ x, y: x * x })))!;
    expect(fit.vertexX).toBeNull();
  });

  it("refuses three points, which fit a parabola exactly", () => {
    expect(quadraticFit([{ x: 1, y: 1 }, { x: 2, y: 4 }, { x: 3, y: 3 }])).toBeNull();
  });

  it("refuses four points over two heights", () => {
    expect(
      quadraticFit([
        { x: 1, y: 1 },
        { x: 1, y: 2 },
        { x: 2, y: 4 },
        { x: 2, y: 5 },
      ]),
    ).toBeNull();
  });
});

describe("correlation", () => {
  it("is 1 and -1 on exact relationships and near 0 on none", () => {
    const up: Point[] = [1, 2, 3, 4, 5, 6].map((x) => ({ x, y: 2 * x + 1 }));
    // Clamped just short of 1 on purpose, because the Fisher transform of exactly 1
    // is infinite and an insight with an infinite bound is not one.
    expect(correlation(up)!.r).toBeCloseTo(1, 5);
    expect(correlation(up.map((p) => ({ x: p.x, y: -p.y })))!.r).toBeCloseTo(-1, 5);

    const flat = correlation([
      { x: 1, y: 3 },
      { x: 2, y: 1 },
      { x: 3, y: 4 },
      { x: 4, y: 1 },
      { x: 5, y: 5 },
      { x: 6, y: 2 },
    ])!;
    expect(Math.abs(flat.r)).toBeLessThan(0.6);
    expect(flat.ciLow).toBeLessThan(0);
    expect(flat.ciHigh).toBeGreaterThan(0);
  });
});

describe("logisticFit and logisticThreshold", () => {
  it("finds the x where the outcome becomes more likely than not", () => {
    // Weekly contact counts against whether the tendon flared, separated around 250
    // with a little overlap either way so the fit has something to do.
    const rows = [
      ...[120, 150, 180, 200, 220, 240].map((x) => ({ x: [x], y: 0 })),
      ...[260, 280, 300, 330, 360, 400].map((x) => ({ x: [x], y: 1 })),
      { x: [230], y: 1 },
      { x: [270], y: 0 },
    ];
    const fit = logisticFit(rows)!;
    const threshold = logisticThreshold(fit, 0.5);
    expect(threshold).not.toBeNull();
    expect(threshold!).toBeGreaterThan(200);
    expect(threshold!).toBeLessThan(300);
  });

  it("refuses a set with only one outcome in it", () => {
    expect(
      logisticFit([100, 200, 300, 400, 500, 600].map((x) => ({ x: [x], y: 1 }))),
    ).toBeNull();
  });

  it("refuses a set too small to have any freedom left", () => {
    expect(
      logisticFit([
        { x: [100], y: 0 },
        { x: [200], y: 0 },
        { x: [300], y: 1 },
        { x: [400], y: 1 },
      ]),
    ).toBeNull();
  });
});

describe("benjaminiHochberg", () => {
  /**
   * Worked by hand: sorted p times m over rank, then capped by the next larger value.
   * 0.01*4/1 = 0.04, 0.02*4/2 = 0.04, 0.03*4/3 = 0.04, 0.04*4/4 = 0.04.
   */
  it("matches the hand calculation and preserves input order", () => {
    const adjusted = benjaminiHochberg([0.04, 0.01, 0.03, 0.02]);
    expect(adjusted[1]).toBeCloseTo(0.04, 10);
    expect(adjusted[3]).toBeCloseTo(0.04, 10);
    expect(adjusted[2]).toBeCloseTo(0.04, 10);
    expect(adjusted[0]).toBeCloseTo(0.04, 10);
  });

  it("is monotone in the sorted order, which is what makes it a threshold", () => {
    const ps = [0.001, 0.008, 0.02, 0.3, 0.4, 0.9];
    const adjusted = benjaminiHochberg(ps);
    for (let i = 1; i < adjusted.length; i += 1) {
      expect(adjusted[i]).toBeGreaterThanOrEqual(adjusted[i - 1]);
    }
  });

  it("never reports above 1, and leaves a single test alone", () => {
    expect(benjaminiHochberg([0.6, 0.7, 0.8]).every((p) => p <= 1)).toBe(true);
    expect(benjaminiHochberg([0.03])[0]).toBeCloseTo(0.03, 10);
    expect(benjaminiHochberg([])).toEqual([]);
  });

  /**
   * The property the suite depends on: adding statements can only make the survivors
   * harder to come by, never easier. A partial recompute would violate it by using a
   * smaller m, which is why `recomputeInsights` always does the whole suite.
   */
  it("gets stricter as the suite grows", () => {
    const alone = benjaminiHochberg([0.02])[0];
    const amongMany = benjaminiHochberg([0.02, 0.5, 0.6, 0.7, 0.8, 0.9])[0];
    expect(amongMany).toBeGreaterThan(alone);
  });
});
