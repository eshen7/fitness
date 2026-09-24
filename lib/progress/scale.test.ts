import { describe, expect, it } from "vitest";
import {
  addDays,
  dayNumber,
  linePath,
  minimalDetectableChange,
  niceExtent,
  quadraticVertex,
  stdDev,
  weekStart,
  xPct,
  yPct,
} from "./scale";

describe("day arithmetic", () => {
  it("counts whole days from the epoch", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayNumber("2026-09-13")).toBe(dayNumber("2026-09-12") + 1);
  });

  it("crosses a month and a leap day without drifting", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("resolves any day to the Monday of its week", () => {
    // 2026-09-13 is a Sunday, which belongs to the week starting the 7th.
    expect(weekStart("2026-09-13")).toBe("2026-09-07");
    expect(weekStart("2026-09-07")).toBe("2026-09-07");
    expect(weekStart("2026-09-08")).toBe("2026-09-07");
  });
});

describe("positioning", () => {
  const days = { min: dayNumber("2026-09-01"), max: dayNumber("2026-09-11") };

  it("puts the ends at the ends and the middle in the middle", () => {
    expect(xPct("2026-09-01", days)).toBe(0);
    expect(xPct("2026-09-11", days)).toBe(100);
    expect(xPct("2026-09-06", days)).toBe(50);
  });

  it("clamps rather than drawing outside the box", () => {
    expect(xPct("2026-08-01", days)).toBe(0);
    expect(xPct("2026-12-01", days)).toBe(100);
  });

  it("flips y so zero is the top, matching CSS", () => {
    expect(yPct(10, { min: 0, max: 10 })).toBe(0);
    expect(yPct(0, { min: 0, max: 10 })).toBe(100);
    expect(yPct(2.5, { min: 0, max: 10 })).toBe(75);
  });
});

describe("niceExtent", () => {
  it("does not start a jump axis at zero", () => {
    const { extent } = niceExtent([58, 61, 64]);
    expect(extent.min).toBeGreaterThan(40);
    expect(extent.min).toBeLessThan(58);
    expect(extent.max).toBeGreaterThanOrEqual(64);
  });

  it("starts a count axis at zero", () => {
    const { extent, ticks } = niceExtent([12, 40, 31], { zero: true });
    expect(extent.min).toBe(0);
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)).toBeGreaterThanOrEqual(40);
  });

  it("prints round ticks rather than floating point noise", () => {
    const { ticks } = niceExtent([0.1, 0.5], { zero: true });
    for (const tick of ticks) expect(String(tick)).not.toMatch(/000000|999999/);
  });

  it("keeps a non-zero axis near its data rather than falling to zero", () => {
    // Box heights in inches: a step rounded up to 10 would put the minimum at 0
    // and leave the readings squeezed into the right of the plot.
    const { extent, ticks } = niceExtent([11.8, 15.7, 19.7, 23.6, 27.6], {
      ticks: 3,
    });
    expect(extent.min).toBeGreaterThan(8);
    expect(extent.max).toBeLessThan(31);
    for (const tick of ticks) {
      expect(tick).toBeGreaterThanOrEqual(extent.min);
      expect(tick).toBeLessThanOrEqual(extent.max);
    }
  });

  it("gives a single value a box to sit in", () => {
    const { extent } = niceExtent([64]);
    expect(extent.max).toBeGreaterThan(extent.min);
  });

  it("survives no data at all", () => {
    const { extent, ticks } = niceExtent([]);
    expect(extent.max).toBeGreaterThan(extent.min);
    expect(ticks.length).toBeGreaterThan(1);
  });
});

describe("linePath", () => {
  it("breaks the line at a gap rather than bridging it", () => {
    const path = linePath([
      { x: 0, y: 0 },
      null,
      { x: 50, y: 25 },
      { x: 100, y: 50 },
    ]);
    // Two M commands means two strokes, so nothing is asserted across the gap.
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path).toBe("M0.000 0.000M50.000 25.000L100.000 50.000");
  });

  it("is empty for no points", () => {
    expect(linePath([])).toBe("");
  });
});

describe("noise floor", () => {
  it("has no standard deviation for a single attempt", () => {
    expect(stdDev([64])).toBeNull();
  });

  it("computes the sample standard deviation", () => {
    expect(stdDev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3);
  });

  it("pools within-sitting spread into a detectable change", () => {
    // Two sittings each spread by 1.0, so the pooled SD is 1.0 and the MDC is
    // 1.96 * sqrt(2), the standard coefficient.
    const mdc = minimalDetectableChange([
      [63, 64, 65],
      [66, 67, 68],
    ]);
    expect(mdc).toBeCloseTo(1.96 * Math.SQRT2, 6);
  });

  it("ignores sittings of one attempt and gives up when all of them are", () => {
    expect(minimalDetectableChange([[64], [66]])).toBeNull();
  });
});

describe("depth jump calibration", () => {
  it("finds the box height where jump height peaks", () => {
    // A clean downward parabola peaking at 45 cm.
    const points = [30, 40, 45, 50, 60].map((x) => ({
      x,
      y: 64 - 0.004 * (x - 45) ** 2,
    }));
    const vertex = quadraticVertex(points);
    expect(vertex?.boxHeightCm).toBeCloseTo(45, 6);
    expect(vertex?.jumpCm).toBeCloseTo(64, 6);
  });

  it("refuses to guess from fewer than three heights", () => {
    expect(quadraticVertex([{ x: 30, y: 60 }, { x: 45, y: 63 }])).toBeNull();
  });

  it("reports no peak when the data only rises", () => {
    const points = [30, 40, 50].map((x) => ({ x, y: 50 + 0.3 * x }));
    expect(quadraticVertex(points)).toBeNull();
  });
});
