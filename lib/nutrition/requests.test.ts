import { describe, expect, it } from "vitest";
import { PER_UNIT_HINT, correctEntrySchema, perGramImplausible } from "./requests";

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

describe("perGramImplausible", () => {
  it("passes real per-gram figures, up to pure fat", () => {
    expect(perGramImplausible({ kcal: 0.15, proteinG: 0.0065, carbsG: 0.036, fatG: 0.001, fiberG: null })).toBe(false);
    expect(perGramImplausible({ kcal: 9, proteinG: 0, carbsG: 0, fatG: 1, fiberG: null })).toBe(false);
  });

  it("catches a portion total typed as a per-gram figure", () => {
    expect(perGramImplausible({ kcal: 30, proteinG: 1.3, carbsG: 7.2, fatG: 0.2, fiberG: null })).toBe(true);
    expect(perGramImplausible({ kcal: 4, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 3 })).toBe(true);
  });
});
