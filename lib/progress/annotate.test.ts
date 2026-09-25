import { describe, expect, it } from "vitest";
import { blockAt, deepestDip, type BlockSpan, type Reading } from "./annotate";

const blocks: BlockSpan[] = [
  {
    type: "accumulation",
    startDay: "2026-06-01",
    endDay: "2026-06-29",
    label: "Block 1 · accumulation",
  },
  {
    type: "realization",
    startDay: "2026-06-29",
    endDay: "2026-07-20",
    label: "Block 2 · realization",
  },
];

describe("blockAt", () => {
  it("includes the start day and excludes the end day", () => {
    expect(blockAt(blocks, "2026-06-01")?.type).toBe("accumulation");
    expect(blockAt(blocks, "2026-06-28")?.type).toBe("accumulation");
    expect(blockAt(blocks, "2026-06-29")?.type).toBe("realization");
  });

  it("returns nothing for a day no block covers", () => {
    expect(blockAt(blocks, "2026-05-31")).toBeNull();
    expect(blockAt(blocks, "2026-08-01")).toBeNull();
  });
});

describe("deepestDip", () => {
  const readings: Reading[] = [
    { day: "2026-06-01", value: 64 },
    { day: "2026-06-15", value: 62 },
    { day: "2026-06-22", value: 59.5 },
    { day: "2026-07-06", value: 66 },
  ];

  it("finds the deepest drop from a previous best", () => {
    const dip = deepestDip(readings, blocks, 1);
    expect(dip?.reading.day).toBe("2026-06-22");
    expect(dip?.drop).toBeCloseTo(4.5, 6);
  });

  it("calls a dip inside a hard block expected", () => {
    expect(deepestDip(readings, blocks, 1)?.expected).toBe(true);
  });

  it("does not call a dip in a peaking block expected", () => {
    const dip = deepestDip(
      [
        { day: "2026-06-29", value: 66 },
        { day: "2026-07-13", value: 61 },
      ],
      blocks,
      1,
    );
    expect(dip?.block.type).toBe("realization");
    expect(dip?.expected).toBe(false);
  });

  it("ignores a drop inside the noise floor", () => {
    const wobble: Reading[] = [
      { day: "2026-06-01", value: 64 },
      { day: "2026-06-08", value: 63 },
    ];
    expect(deepestDip(wobble, blocks, 2)).toBeNull();
    // The same wobble counts once there is no floor to measure it against.
    expect(deepestDip(wobble, blocks, null)?.drop).toBeCloseTo(1, 6);
  });

  it("ignores a drop on a day no block covers", () => {
    const outside: Reading[] = [
      { day: "2026-08-01", value: 64 },
      { day: "2026-08-08", value: 58 },
    ];
    expect(deepestDip(outside, blocks, 1)).toBeNull();
  });

  it("measures the drop from the running best, not from the previous reading", () => {
    const dip = deepestDip(
      [
        { day: "2026-06-01", value: 64 },
        { day: "2026-06-08", value: 61 },
        { day: "2026-06-15", value: 60 },
      ],
      blocks,
      1,
    );
    expect(dip?.reading.day).toBe("2026-06-15");
    expect(dip?.drop).toBeCloseTo(4, 6);
  });

  it("has nothing to say about a series that only rises", () => {
    expect(
      deepestDip(
        [
          { day: "2026-06-01", value: 60 },
          { day: "2026-06-15", value: 64 },
        ],
        blocks,
        null,
      ),
    ).toBeNull();
  });

  it("has nothing to say about a single reading", () => {
    expect(deepestDip([{ day: "2026-06-01", value: 64 }], blocks, null)).toBeNull();
  });
});
