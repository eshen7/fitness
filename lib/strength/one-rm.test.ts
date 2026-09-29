import { describe, expect, it } from "vitest";
import {
  currentOneRm,
  dailyBestEstimates,
  estimateOneRmKg,
  loadFromPercent,
  oneRmHistory,
  type OneRmReading,
} from "./one-rm";

const TODAY = "2026-09-29";
const estimated = (day: string, kg: number): OneRmReading => ({ day, kg, source: "estimated" });
const tested = (day: string, kg: number): OneRmReading => ({ day, kg, source: "tested" });

describe("estimateOneRmKg", () => {
  it("reads a heavy set through Epley", () => {
    expect(estimateOneRmKg({ loadKg: 120, reps: 5 })).toBeCloseTo(140);
    expect(estimateOneRmKg({ loadKg: 150, reps: 1 })).toBeCloseTo(155);
  });

  it("refuses a set with no load, no reps, or more reps than the formula is fit for", () => {
    expect(estimateOneRmKg({ loadKg: null, reps: 5 })).toBeNull();
    expect(estimateOneRmKg({ loadKg: 0, reps: 5 })).toBeNull();
    expect(estimateOneRmKg({ loadKg: 100, reps: null })).toBeNull();
    expect(estimateOneRmKg({ loadKg: 100, reps: 0 })).toBeNull();
    expect(estimateOneRmKg({ loadKg: 60, reps: 11 })).toBeNull();
    expect(estimateOneRmKg({ loadKg: 60, reps: 10 })).not.toBeNull();
  });
});

describe("dailyBestEstimates", () => {
  it("turns a logged heavy set into a reading, keeping each day's best set", () => {
    const readings = dailyBestEstimates([
      { day: "2026-09-26", exerciseId: 7, loadKg: 100, reps: 5 },
      { day: "2026-09-26", exerciseId: 7, loadKg: 120, reps: 5 },
      { day: "2026-09-26", exerciseId: 7, loadKg: 60, reps: 15 },
      { day: "2026-09-24", exerciseId: 7, loadKg: 110, reps: 3 },
      { day: "2026-09-26", exerciseId: 9, loadKg: null, reps: 8 },
    ]);
    expect([...readings.keys()]).toEqual([7]);
    expect(readings.get(7)).toEqual([
      { day: "2026-09-24", kg: expect.closeTo(121, 5), source: "estimated" },
      { day: "2026-09-26", kg: expect.closeTo(140, 5), source: "estimated" },
    ]);
  });
});

describe("oneRmHistory", () => {
  it("lets a tested max own the day it was tested on", () => {
    expect(
      oneRmHistory([
        estimated("2026-09-20", 150),
        tested("2026-09-20", 145),
        estimated("2026-09-10", 140),
      ]),
    ).toEqual([estimated("2026-09-10", 140), tested("2026-09-20", 145)]);
  });
});

describe("currentOneRm", () => {
  it("is null with nothing on record", () => {
    expect(currentOneRm([], TODAY)).toBeNull();
  });

  it("takes the best estimate in the window rather than the latest", () => {
    expect(
      currentOneRm([estimated("2026-09-10", 140), estimated("2026-09-24", 132)], TODAY),
    ).toEqual(estimated("2026-09-10", 140));
  });

  it("ages out an estimate older than the window", () => {
    expect(currentOneRm([estimated("2026-06-01", 140)], TODAY)).toBeNull();
  });

  it("prefers a tested max over lower estimates, even later ones", () => {
    expect(
      currentOneRm(
        [estimated("2026-09-01", 150), tested("2026-09-10", 145), estimated("2026-09-24", 138)],
        TODAY,
      ),
    ).toEqual(tested("2026-09-10", 145));
  });

  it("keeps a tested max however old it is", () => {
    expect(currentOneRm([tested("2025-01-10", 145)], TODAY)).toEqual(tested("2025-01-10", 145));
  });

  it("gives way to a later estimate the tested max could not have lifted", () => {
    expect(
      currentOneRm([tested("2026-09-10", 145), estimated("2026-09-24", 151)], TODAY),
    ).toEqual(estimated("2026-09-24", 151));
  });

  it("uses the newest tested max", () => {
    expect(currentOneRm([tested("2026-09-20", 140), tested("2026-08-01", 150)], TODAY)).toEqual(
      tested("2026-09-20", 140),
    );
  });
});

describe("loadFromPercent", () => {
  it("rounds to a pair of 2.5 lb plates for an imperial owner", () => {
    // 87% of 140 kg is 121.8 kg, 268.5 lb.
    const load = loadFromPercent(87, 140, "imperial");
    expect(load.shown).toBe(270);
    expect(load.kg).toBeCloseTo(122.47, 2);
  });

  it("rounds to a pair of 1.25 kg plates for a metric owner", () => {
    expect(loadFromPercent(87, 140, "metric")).toEqual({ shown: 122.5, kg: 122.5 });
  });
});
