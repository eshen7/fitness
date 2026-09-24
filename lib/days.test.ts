import { describe, expect, it } from "vitest";
import { addDays, daysBetween, formatDay } from "./days";

describe("day keys", () => {
  it("formats weekday first", () => {
    expect(formatDay("2026-09-21")).toBe("Mon 21 Sept");
  });

  it("counts whole days across a DST change and a year end", () => {
    expect(daysBetween("2026-11-01", "2026-11-02")).toBe(1);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween("2026-09-23", "2026-09-21")).toBe(-2);
  });

  it("adds days across month and year ends, both ways", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-08", 0)).toBe("2026-03-08");
  });
});
