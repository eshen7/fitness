import { describe, expect, it } from "vitest";
import { quietDay, type BlockCalendar } from "./today";

const week1 = {
  ordinal: 1,
  startDate: "2026-09-29",
  sessions: [
    { day: "2026-09-30", kind: "mixed" as const, title: "Jumps and heavy lower" },
    { day: "2026-10-02", kind: "strength" as const, title: null },
  ],
};

function block(weeks: BlockCalendar["weeks"], plannedMicrocycles = 4): BlockCalendar {
  return { plannedMicrocycles, weeks };
}

describe("quietDay", () => {
  it("asks for a block when none is open", () => {
    expect(quietDay("2026-09-29", null)).toEqual({ kind: "no-block" });
  });

  it("asks for the first week of a block with none written", () => {
    expect(quietDay("2026-09-29", block([]))).toEqual({ kind: "no-week", nextOrdinal: 1 });
  });

  it("reads a day inside a written week as rest, with the next session", () => {
    // The first day of a week whose first session is the day after: the case that
    // used to be told to generate the week it was already in.
    expect(quietDay("2026-09-29", block([week1]))).toEqual({
      kind: "rest",
      next: { day: "2026-09-30", kind: "mixed", title: "Jumps and heavy lower" },
      nextOrdinal: null,
    });
    expect(quietDay("2026-10-01", block([week1]))).toMatchObject({
      kind: "rest",
      next: { day: "2026-10-02", title: null },
    });
  });

  it("reads a day before the block's first session as rest", () => {
    expect(quietDay("2026-09-27", block([week1]))).toMatchObject({
      kind: "rest",
      next: { day: "2026-09-30" },
    });
  });

  it("looks into a later written week for the next session", () => {
    const week2 = {
      ordinal: 2,
      startDate: "2026-10-06",
      sessions: [{ day: "2026-10-07", kind: "plyometric" as const }],
    };
    expect(quietDay("2026-10-03", block([week2, week1]))).toMatchObject({
      kind: "rest",
      next: { day: "2026-10-07", kind: "plyometric", title: null },
    });
  });

  it("names the week to generate once the written sessions are behind the day", () => {
    expect(quietDay("2026-10-04", block([week1]))).toEqual({
      kind: "rest",
      next: null,
      nextOrdinal: 2,
    });
    expect(quietDay("2026-10-06", block([week1]))).toEqual({
      kind: "no-week",
      nextOrdinal: 2,
    });
  });

  it("says the block is done once every planned week is behind the day", () => {
    expect(quietDay("2026-10-04", block([week1], 1))).toEqual({
      kind: "rest",
      next: null,
      nextOrdinal: null,
    });
    expect(quietDay("2026-10-06", block([week1], 1))).toEqual({ kind: "block-done" });
  });
});
