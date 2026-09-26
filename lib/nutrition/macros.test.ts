import { describe, expect, it } from "vitest";
import {
  energySplit,
  impliedKcal,
  kcalMismatch,
  macrosAddUp,
  scaleMacros,
  sumMacros,
  ZERO_MACROS,
  type Macros,
} from "./macros";

const oatsPerGram: Macros = {
  kcal: 3.8,
  proteinG: 0.13,
  carbsG: 0.68,
  fatG: 0.07,
  fiberG: 0.1,
};

describe("scaleMacros", () => {
  it("multiplies per-unit macros by the quantity", () => {
    expect(scaleMacros(oatsPerGram, 80)).toEqual({
      kcal: 304,
      proteinG: 10.4,
      carbsG: 54.4,
      fatG: 5.6,
      fiberG: 8,
    });
  });

  it("keeps an unknown fibre unknown rather than turning it into zero", () => {
    expect(scaleMacros({ ...oatsPerGram, fiberG: null }, 80).fiberG).toBeNull();
  });
});

describe("sumMacros", () => {
  it("adds a day up", () => {
    const total = sumMacros([
      { kcal: 304, proteinG: 10.4, carbsG: 54.4, fatG: 5.6, fiberG: 8 },
      { kcal: 105, proteinG: 1.3, carbsG: 27, fatG: 0.4, fiberG: 3.1 },
    ]);
    expect(total).toEqual({
      kcal: 409,
      proteinG: 11.7,
      carbsG: 81.4,
      fatG: 6,
      fiberG: 11.1,
    });
  });

  it("reports the fibre it knows about when only some items have one", () => {
    const total = sumMacros([
      { kcal: 100, proteinG: 0, carbsG: 25, fatG: 0, fiberG: 4 },
      { kcal: 100, proteinG: 0, carbsG: 25, fatG: 0, fiberG: null },
    ]);
    expect(total.fiberG).toBe(4);
  });

  it("leaves fibre null when nothing had one", () => {
    expect(sumMacros([ZERO_MACROS, ZERO_MACROS]).fiberG).toBeNull();
  });

  it("is zero over nothing, so an empty day is a day and not an error", () => {
    expect(sumMacros([])).toEqual(ZERO_MACROS);
  });
});

describe("kcalMismatch", () => {
  it("is zero for macros that agree with their calories", () => {
    const bar: Macros = { kcal: 290, proteinG: 20, carbsG: 30, fatG: 10, fiberG: 2 };
    expect(impliedKcal(bar)).toBe(290);
    expect(kcalMismatch(bar)).toBe(0);
    expect(macrosAddUp(bar)).toBe(true);
  });

  it("tolerates an estimate that is close", () => {
    expect(macrosAddUp({ kcal: 270, proteinG: 20, carbsG: 30, fatG: 10, fiberG: null })).toBe(
      true,
    );
  });

  it("flags an arithmetic slip", () => {
    expect(macrosAddUp({ kcal: 100, proteinG: 20, carbsG: 30, fatG: 10, fiberG: null })).toBe(
      false,
    );
  });

  it("lets alcohol through, where the energy is real and behind none of the macros", () => {
    expect(macrosAddUp({ kcal: 150, proteinG: 0, carbsG: 0, fatG: 0, fiberG: null })).toBe(true);
  });

  it("still flags macros with no calories against them", () => {
    expect(macrosAddUp({ kcal: 0, proteinG: 20, carbsG: 30, fatG: 10, fiberG: null })).toBe(
      false,
    );
  });

  it("agrees with itself on nothing at all", () => {
    expect(macrosAddUp(ZERO_MACROS)).toBe(true);
  });

  /**
   * The flag is read off `perUnit`, which is where the numbers are stored and what
   * the correction form edits, so the check has to give the same answer per gram as
   * it does per portion. It did not: rounding the implied calories to an integer
   * made every food under a kcal per unit look like a 30% arithmetic slip, and a
   * floor of one kcal on the divisor then made the opposite mistake.
   */
  it("gives the same verdict per unit as per portion", () => {
    const perGram: Macros = { kcal: 0.74, proteinG: 0.1, carbsG: 0.04, fatG: 0.02, fiberG: 0 };
    expect(macrosAddUp(perGram)).toBe(true);
    expect(macrosAddUp(scaleMacros(perGram, 200))).toBe(true);

    const slipPerGram: Macros = { kcal: 0.3, proteinG: 0.1, carbsG: 0.04, fatG: 0.02, fiberG: 0 };
    expect(macrosAddUp(slipPerGram)).toBe(false);
    expect(macrosAddUp(scaleMacros(slipPerGram, 200))).toBe(false);
  });
});

describe("energySplit", () => {
  it("splits energy by macro", () => {
    // 90 kcal from each: 22.5 g of protein, 22.5 g of carbohydrate, 10 g of fat.
    const split = energySplit({ kcal: 270, proteinG: 22.5, carbsG: 22.5, fatG: 10, fiberG: null });
    expect(split).not.toBeNull();
    expect(split?.proteinPct).toBeCloseTo(33.333, 3);
    expect(split?.carbsPct).toBeCloseTo(33.333, 3);
    expect(split?.fatPct).toBeCloseTo(33.333, 3);
  });

  it("is null when there is no energy to split", () => {
    expect(energySplit(ZERO_MACROS)).toBeNull();
  });
});
