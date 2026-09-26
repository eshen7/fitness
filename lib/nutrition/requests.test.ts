import { describe, expect, it } from "vitest";
import { PER_UNIT_HINT, correctEntrySchema, perUnitImplausible } from "./requests";

/**
 * The correction's bounds, which have to admit every food the parse could store and
 * still catch a portion total typed into a per-unit field.
 */

describe("correctEntrySchema", () => {
  it("accepts a portion-only correction with no macros sent", () => {
    expect(correctEntrySchema.safeParse({ entryId: 1, quantity: 2 }).success).toBe(true);
  });

  it("accepts an item food the parse stored above a hundred grams of carbohydrate", () => {
    const burrito = { kcal: 1050, proteinG: 45, carbsG: 120, fatG: 40, fiberG: 12 };
    expect(
      correctEntrySchema.safeParse({ entryId: 1, quantity: 1, perUnit: burrito }).success,
    ).toBe(true);
  });

  it("refuses a value past what the columns hold, with the per-unit hint", () => {
    const result = correctEntrySchema.safeParse({
      entryId: 1,
      quantity: 1,
      perUnit: { kcal: 2_000_000, proteinG: 0, carbsG: 0, fatG: 0 },
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(PER_UNIT_HINT);
  });
});

describe("perUnitImplausible", () => {
  it("passes real per-gram figures, up to pure fat", () => {
    expect(perUnitImplausible("g", { kcal: 0.15, proteinG: 0.0065, carbsG: 0.036, fatG: 0.001, fiberG: null })).toBe(false);
    expect(perUnitImplausible("g", { kcal: 9, proteinG: 0, carbsG: 0, fatG: 1, fiberG: null })).toBe(false);
  });

  it("catches a portion total typed as a per-gram figure", () => {
    expect(perUnitImplausible("g", { kcal: 30, proteinG: 1.3, carbsG: 7.2, fatG: 0.2, fiberG: null })).toBe(true);
    expect(perUnitImplausible("g", { kcal: 4, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 3 })).toBe(true);
  });

  it("holds a millilitre to the calorie ceiling alone, so dense liquids still save", () => {
    const honey = { kcal: 4.3, proteinG: 0, carbsG: 1.15, fatG: 0, fiberG: null };
    expect(perUnitImplausible("ml", honey)).toBe(false);
    const milkPortion = { kcal: 120, proteinG: 8, carbsG: 12, fatG: 5, fiberG: null };
    expect(perUnitImplausible("ml", milkPortion)).toBe(true);
  });

  it("leaves household units and items to the column ceilings", () => {
    const burrito = { kcal: 1050, proteinG: 45, carbsG: 120, fatG: 40, fiberG: 12 };
    expect(perUnitImplausible("item", burrito)).toBe(false);
  });
});
