import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/days";
import {
  MIN_TREND_READINGS,
  RATE_TOLERANCE_PCT,
  rateVerdict,
  targetPath,
  weeklyChangePct,
  type WeightPoint,
} from "./trend";

/** A run of days with weight changing by a fixed amount each day. */
function ramp(from: string, days: number, startKg: number, kgPerDay: number): WeightPoint[] {
  return Array.from({ length: days }, (_, offset) => ({
    day: addDays(from, offset),
    kg: startKg + kgPerDay * offset,
  }));
}

describe("weeklyChangePct", () => {
  it("reads a steady gain as a percent of bodyweight per week", () => {
    // 0.04 kg a day is 0.28 kg a week, and a hair over 0.25 kg is 0.35% of 80 kg.
    const trend = ramp("2026-09-01", 21, 80, 0.04);
    const measured = weeklyChangePct(trend, { asOf: "2026-09-21" });
    expect(measured).not.toBeNull();
    expect(measured as number).toBeCloseTo(((0.04 * 7) / 80.4) * 100, 5);
  });

  it("is signed, so a loss reads negative", () => {
    const trend = ramp("2026-09-01", 21, 80, -0.06);
    expect(weeklyChangePct(trend, { asOf: "2026-09-21" }) as number).toBeLessThan(0);
  });

  it("is null when the window is too sparse to be a rate", () => {
    const trend = ramp("2026-09-01", MIN_TREND_READINGS - 1, 80, 0.05);
    expect(weeklyChangePct(trend, { asOf: "2026-09-03" })).toBeNull();
  });

  it("ignores readings older than the window", () => {
    // Three weeks of gain, preceded by a month of loss that must not count.
    const old = ramp("2026-07-01", 30, 84, -0.1);
    const recent = ramp("2026-09-01", 21, 80, 0.05);
    expect(weeklyChangePct([...old, ...recent], { asOf: "2026-09-21" }) as number).toBeGreaterThan(
      0,
    );
  });

  it("takes a narrower window when asked", () => {
    const trend = [...ramp("2026-09-01", 14, 80, -0.05), ...ramp("2026-09-15", 7, 79.3, 0.1)];
    const wide = weeklyChangePct(trend, { asOf: "2026-09-21" }) as number;
    const narrow = weeklyChangePct(trend, { asOf: "2026-09-21", windowDays: 7 }) as number;
    expect(wide).toBeLessThan(narrow);
  });

  it("is null when every reading lands on one day, which is a level and not a rate", () => {
    const trend = Array.from({ length: 5 }, () => ({ day: "2026-09-20", kg: 80 }));
    expect(weeklyChangePct(trend, { asOf: "2026-09-20" })).toBeNull();
  });

  it("is flat to zero when weight does not move", () => {
    const trend = ramp("2026-09-01", 21, 80, 0);
    expect(weeklyChangePct(trend, { asOf: "2026-09-21" })).toBe(0);
  });
});

describe("targetPath", () => {
  it("compounds weekly, so a percent target curves rather than running straight", () => {
    const path = targetPath({
      from: "2026-09-01",
      to: "2026-09-29",
      startKg: 80,
      pctPerWeek: 0.25,
    });
    expect(path).toHaveLength(29);
    expect(path[0]).toEqual({ day: "2026-09-01", kg: 80 });
    expect(path[7].kg).toBeCloseTo(80 * 1.0025, 8);
    expect(path[28].kg).toBeCloseTo(80 * 1.0025 ** 4, 8);
    // The compounded curve sits above the straight line it would otherwise be.
    expect(path[28].kg).toBeGreaterThan(80 + 4 * 80 * 0.0025);
  });

  it("falls for a negative target", () => {
    const path = targetPath({
      from: "2026-09-01",
      to: "2026-09-08",
      startKg: 80,
      pctPerWeek: -0.5,
    });
    expect(path[7].kg).toBeCloseTo(80 * 0.995, 8);
  });

  it("is empty when the range runs backwards", () => {
    expect(
      targetPath({ from: "2026-09-08", to: "2026-09-01", startKg: 80, pctPerWeek: 0 }),
    ).toEqual([]);
  });
});

describe("rateVerdict", () => {
  it("is unknown without both halves", () => {
    expect(rateVerdict(null, 0.25)).toBe("unknown");
    expect(rateVerdict(0.25, null)).toBe("unknown");
  });

  it("calls a close-enough rate on target", () => {
    expect(rateVerdict(0.25, 0.25)).toBe("on-target");
    expect(rateVerdict(0.25 + RATE_TOLERANCE_PCT * 0.9, 0.25)).toBe("on-target");
    expect(rateVerdict(0.25 + RATE_TOLERANCE_PCT * 1.1, 0.25)).toBe("faster");
  });

  it("reads faster and slower against the direction asked for", () => {
    expect(rateVerdict(0.6, 0.25)).toBe("faster");
    expect(rateVerdict(0.05, 0.25)).toBe("slower");
    // Losing faster than asked is still "faster", since the target is negative.
    expect(rateVerdict(-1, -0.5)).toBe("faster");
    expect(rateVerdict(-0.1, -0.5)).toBe("slower");
  });

  it("treats any drift off a hold as faster than asked for", () => {
    expect(rateVerdict(0.4, 0)).toBe("faster");
    expect(rateVerdict(-0.4, 0)).toBe("faster");
    expect(rateVerdict(0.1, 0)).toBe("on-target");
  });
});
