import { describe, expect, it } from "vitest";
import {
  bestByHeight,
  bodyweightOn,
  bodyweightTrend,
  bucketTendonWeeks,
  depthJumpCalibration,
  deriveBlockBands,
  groupSittings,
  type BlockRow,
  type JumpRow,
} from "./derive";

describe("groupSittings", () => {
  const row = (overrides: Partial<JumpRow>): JumpRow => ({
    testGroup: "a",
    kind: "standing_vertical",
    value: 60,
    boxHeightCm: null,
    day: "2026-06-01",
    instant: "2026-06-01T17:00:00.000Z",
    ...overrides,
  });

  it("collects attempts under their test group and keeps the best", () => {
    const [sitting, ...rest] = groupSittings([
      row({ value: 59 }),
      row({ value: 61 }),
      row({ value: 60 }),
    ]);
    expect(rest).toHaveLength(0);
    expect(sitting.attempts).toEqual([59, 61, 60]);
    expect(sitting.best).toBe(61);
  });

  it("keeps an ungrouped reading as its own sitting rather than dropping it", () => {
    const sittings = groupSittings([
      row({ testGroup: null, value: 58, instant: "2026-06-01T09:00:00.000Z" }),
      row({ testGroup: null, value: 62, instant: "2026-06-01T18:00:00.000Z" }),
    ]);
    expect(sittings.map((s) => s.best)).toEqual([58, 62]);
  });

  it("does not merge two kinds that share an instant", () => {
    const sittings = groupSittings([
      row({ testGroup: null, kind: "standing_vertical" }),
      row({ testGroup: null, kind: "two_foot_approach_vertical" }),
    ]);
    expect(sittings).toHaveLength(2);
  });

  it("orders sittings by day", () => {
    const sittings = groupSittings([
      row({ testGroup: "late", day: "2026-06-15" }),
      row({ testGroup: "early", day: "2026-06-01" }),
    ]);
    expect(sittings.map((s) => s.day)).toEqual(["2026-06-01", "2026-06-15"]);
  });
});

describe("deriveBlockBands", () => {
  const block = (overrides: Partial<BlockRow>): BlockRow => ({
    id: 1,
    type: "accumulation",
    ordinal: 1,
    startDay: "2026-06-01",
    plannedMicrocycles: 4,
    closedDay: null,
    ...overrides,
  });

  it("ends a block at the next one's start", () => {
    const [first] = deriveBlockBands(
      [
        block({ closedDay: "2026-06-29" }),
        block({ id: 2, ordinal: 2, startDay: "2026-06-22" }),
      ],
      "2026-07-01",
      "2026-01-01",
    );
    expect(first.endDay).toBe("2026-06-22");
  });

  it("ends a closed block on the day it closed, not on its plan", () => {
    // Four weeks planned, closed after two: the missing weeks are not shaded.
    const [band] = deriveBlockBands(
      [block({ closedDay: "2026-06-15" })],
      "2026-07-20",
      "2026-01-01",
    );
    expect(band.endDay).toBe("2026-06-15");
    expect(band.closed).toBe(true);
  });

  it("still gives a block closed the day it opened one day to be drawn", () => {
    const [band] = deriveBlockBands(
      [block({ closedDay: "2026-06-01" })],
      "2026-07-20",
      "2026-01-01",
    );
    expect(band.endDay).toBe("2026-06-02");
  });

  it("runs an open block to its planned length", () => {
    const [band] = deriveBlockBands([block({})], "2026-06-10", "2026-01-01");
    expect(band.endDay).toBe("2026-06-29");
    expect(band.closed).toBe(false);
  });

  it("runs an open block that outran its plan through today", () => {
    const [band] = deriveBlockBands([block({})], "2026-07-10", "2026-01-01");
    // Exclusive, so tomorrow is what puts today inside it.
    expect(band.endDay).toBe("2026-07-11");
  });

  it("drops blocks that ended before the window", () => {
    const bands = deriveBlockBands(
      [
        block({ closedDay: "2026-06-29" }),
        block({ id: 2, ordinal: 2, startDay: "2026-06-29" }),
      ],
      "2026-07-10",
      "2026-07-01",
    );
    expect(bands.map((band) => band.id)).toEqual([2]);
  });
});

describe("bucketTendonWeeks", () => {
  it("has a row for every week, even an empty one", () => {
    const weeks = bucketTendonWeeks("2026-06-01", "2026-06-22", [], []);
    expect(weeks.map((w) => w.week)).toEqual([
      "2026-06-01",
      "2026-06-08",
      "2026-06-15",
      "2026-06-22",
    ]);
    expect(weeks.every((w) => w.contacts === 0 && w.worstPain === null)).toBe(true);
  });

  it("keeps the worst of the three questions and the worst reading per site", () => {
    const [week] = bucketTendonWeeks(
      "2026-06-01",
      "2026-06-01",
      [
        { week: "2026-06-01", site: "patellar_right", during: 2, after: 3, stiffness: 5 },
        { week: "2026-06-01", site: "patellar_right", during: 1, after: 1, stiffness: 2 },
        { week: "2026-06-01", site: "achilles_left", during: 1, after: 0, stiffness: 0 },
      ],
      [],
    );
    expect(week.painBySite).toEqual({ patellar_right: 5, achilles_left: 1 });
    expect(week.worstPain).toBe(5);
  });

  it("counts contacts in reps, and a set with no reps as one landing", () => {
    const [week] = bucketTendonWeeks(
      "2026-06-01",
      "2026-06-01",
      [],
      [
        { week: "2026-06-01", reps: 10 },
        { week: "2026-06-01", reps: 8 },
        { week: "2026-06-01", reps: null },
      ],
    );
    expect(week.contacts).toBe(19);
  });

  it("drops readings outside the window rather than adding a partial week", () => {
    const weeks = bucketTendonWeeks(
      "2026-06-01",
      "2026-06-08",
      [
        { week: "2026-05-25", site: "patellar_left", during: 6, after: 6, stiffness: 6 },
        { week: "2026-06-15", site: "patellar_left", during: 7, after: 7, stiffness: 7 },
      ],
      [
        { week: "2026-05-25", reps: 12 },
        { week: "2026-06-08", reps: 5 },
        { week: "2026-06-15", reps: 9 },
      ],
    );
    expect(weeks.map((w) => w.week)).toEqual(["2026-06-01", "2026-06-08"]);
    expect(weeks.map((w) => w.worstPain)).toEqual([null, null]);
    expect(weeks.map((w) => w.contacts)).toEqual([0, 5]);
  });
});

describe("bodyweight", () => {
  it("smooths toward each new reading by a quarter", () => {
    const trend = bodyweightTrend([
      { day: "2026-06-01", kg: 80 },
      { day: "2026-06-02", kg: 84 },
      { day: "2026-06-03", kg: 84 },
    ]);
    expect(trend.map((p) => p.kg)).toEqual([80, 81, 81.75]);
  });

  it("uses the latest trend value on or before the day", () => {
    const trend = [
      { day: "2026-06-01", kg: 80 },
      { day: "2026-06-10", kg: 81 },
    ];
    expect(bodyweightOn(trend, "2026-06-01")).toBe(80);
    expect(bodyweightOn(trend, "2026-06-09")).toBe(80);
    expect(bodyweightOn(trend, "2026-07-01")).toBe(81);
  });

  it("falls forward to the first weigh-in for a lift tested before it", () => {
    expect(bodyweightOn([{ day: "2026-06-10", kg: 81 }], "2026-06-01")).toBe(81);
  });

  it("has no bodyweight to divide by without a reading", () => {
    expect(bodyweightOn([], "2026-06-01")).toBeNull();
  });
});

describe("bestByHeight", () => {
  it("keeps the best attempt per height, in height order", () => {
    expect(
      bestByHeight([
        { boxHeightCm: 50, jumpCm: 68, day: "2026-08-10" },
        { boxHeightCm: 30, jumpCm: 66, day: "2026-08-10" },
        { boxHeightCm: 50, jumpCm: 69.5, day: "2026-08-11" },
        { boxHeightCm: 50, jumpCm: 67, day: "2026-08-12" },
      ]),
    ).toEqual([
      { boxHeightCm: 30, jumpCm: 66, day: "2026-08-10" },
      { boxHeightCm: 50, jumpCm: 69.5, day: "2026-08-11" },
    ]);
  });
});

describe("depthJumpCalibration", () => {
  const day = "2026-08-17";

  it("stops at the first height that drops below the standing jump", () => {
    const { matched, standingCm, dropped } = depthJumpCalibration(
      [
        { boxHeightCm: 30, jumpCm: 50, day },
        { boxHeightCm: 40, jumpCm: 46, day },
        { boxHeightCm: 50, jumpCm: 48.5, day },
      ],
      [{ day, cm: 48 }],
    );
    expect(standingCm).toBe(48);
    expect(matched?.boxHeightCm).toBe(30);
    expect(dropped).toBe(true);
  });

  it("recommends the highest box, and reports no drop, when none dropped below", () => {
    const { matched, dropped } = depthJumpCalibration(
      [
        { boxHeightCm: 30, jumpCm: 48, day },
        { boxHeightCm: 40, jumpCm: 49, day },
      ],
      [{ day, cm: 48 }],
    );
    expect(matched?.boxHeightCm).toBe(40);
    expect(dropped).toBe(false);
  });

  it("reads only the most recent day, against that day's best standing jump", () => {
    const result = depthJumpCalibration(
      [
        { boxHeightCm: 60, jumpCm: 70, day: "2026-06-01" },
        { boxHeightCm: 30, jumpCm: 51, day },
        { boxHeightCm: 40, jumpCm: 49, day },
      ],
      [
        { day: "2026-06-01", cm: 40 },
        { day, cm: 48 },
        { day, cm: 50 },
        { day: "2026-09-01", cm: 45 },
      ],
    );
    expect(result.day).toBe(day);
    expect(result.standingCm).toBe(50);
    expect(result.points.map((p) => p.boxHeightCm)).toEqual([30, 40]);
    expect(result.matched?.boxHeightCm).toBe(30);
  });

  it("names no height without a standing jump that day, or when the lowest box fell short", () => {
    const drops = [
      { boxHeightCm: 30, jumpCm: 46, day },
      { boxHeightCm: 40, jumpCm: 49, day },
    ];
    expect(depthJumpCalibration(drops, [{ day: "2026-08-10", cm: 40 }]).matched).toBeNull();
    expect(depthJumpCalibration(drops, [{ day, cm: 48 }]).matched).toBeNull();
    expect(depthJumpCalibration([], []).day).toBeNull();
  });

  it("names no height from a single box, which is not a progression", () => {
    const { matched, points } = depthJumpCalibration(
      [{ boxHeightCm: 30, jumpCm: 50, day }],
      [{ day, cm: 48 }],
    );
    expect(points).toHaveLength(1);
    expect(matched).toBeNull();
  });
});
