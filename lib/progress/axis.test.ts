import { describe, expect, it } from "vitest";
import { dayTicks, shortDay, shortWeek, tickIndexes } from "./axis";
import { dayNumber } from "./scale";

describe("day labels", () => {
  it("drops the year and the weekday", () => {
    expect(shortDay("2026-09-13")).toBe("13 Sep");
    expect(shortDay("2026-01-01")).toBe("1 Jan");
    expect(shortWeek("2026-09-13")).toBe("wk 13 Sep");
  });
});

describe("dayTicks", () => {
  it("spans the window end to end", () => {
    const days = { min: dayNumber("2026-04-27"), max: dayNumber("2026-09-15") };
    const ticks = dayTicks(days);
    expect(ticks[0]).toBe("2026-04-27");
    expect(ticks.at(-1)).toBe("2026-09-15");
  });

  it("labels a window shorter than the tick count once per day", () => {
    const one = dayNumber("2026-09-29");
    expect(dayTicks({ min: one, max: one })).toStrictEqual(["2026-09-29"]);
    expect(dayTicks({ min: one, max: one + 1 })).toStrictEqual([
      "2026-09-29",
      "2026-09-30",
    ]);
  });

  it("uses fewer labels on a shorter window", () => {
    const short = dayTicks({ min: 0, max: 20 });
    const long = dayTicks({ min: 0, max: 200 });
    expect(short.length).toBeLessThan(long.length);
  });
});

describe("tickIndexes", () => {
  it("always labels the last bucket", () => {
    for (const count of [2, 5, 9, 13, 16, 52]) {
      expect(tickIndexes(count).at(-1)).toBe(count - 1);
    }
  });

  it("does not put the final label on top of its neighbour", () => {
    // 13 weeks steps by 4 to 0, 4, 8, 12, which already ends on the last bucket;
    // 14 would step to 12 and then add 13 right beside it.
    const ticks = tickIndexes(14);
    expect(ticks.at(-1)).toBe(13);
    expect(13 - (ticks.at(-2) ?? 0)).toBeGreaterThan(2);
  });

  it("stays within range and in order", () => {
    for (const count of [1, 3, 7, 20, 100]) {
      const ticks = tickIndexes(count);
      expect(ticks).toStrictEqual([...ticks].sort((a, b) => a - b));
      expect(new Set(ticks).size).toBe(ticks.length);
      for (const tick of ticks) {
        expect(tick).toBeGreaterThanOrEqual(0);
        expect(tick).toBeLessThan(count);
      }
    }
  });

  it("has nothing to label with no buckets", () => {
    expect(tickIndexes(0)).toStrictEqual([]);
  });
});
