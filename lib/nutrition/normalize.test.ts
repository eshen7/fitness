import { describe, expect, it } from "vitest";
import { foodKey, phraseKey } from "./normalize";

/**
 * The cache keys, which are the whole basis of a repeat being free.
 *
 * Two kinds of assertion, and both matter: what must fold together, so the same
 * breakfast typed a little differently still hits, and what must not, so a cache hit
 * is never the wrong food's macros.
 */

describe("phraseKey", () => {
  it("folds case, spacing and punctuation", () => {
    const canonical = phraseKey("200g greek yogurt with honey");
    expect(phraseKey("  200G   Greek Yogurt, with honey!  ")).toBe(canonical);
    expect(phraseKey("200g greek yogurt with honey.")).toBe(canonical);
  });

  it("folds accents onto their plain letters", () => {
    expect(phraseKey("jalapeño")).toBe(phraseKey("jalapeno"));
  });

  it("keeps a decimal point inside a number", () => {
    expect(phraseKey("1.5 cups of rice")).toBe("1.5 cups of rice");
    expect(phraseKey("1.5 cups")).not.toBe(phraseKey("15 cups"));
  });

  it("keeps quantities and word order apart", () => {
    expect(phraseKey("2 eggs")).not.toBe(phraseKey("3 eggs"));
    expect(phraseKey("chicken and rice")).not.toBe(phraseKey("rice and chicken"));
  });

  it("does not stem, so a near-miss costs an estimate and never a wrong match", () => {
    expect(phraseKey("oat milk")).not.toBe(phraseKey("oats"));
  });

  it("is null when the text folds away to nothing", () => {
    expect(phraseKey("  ")).toBeNull();
    expect(phraseKey("!!!")).toBeNull();
    expect(phraseKey("...")).toBeNull();
  });
});

describe("foodKey", () => {
  it("folds the name the same way the phrase is folded", () => {
    expect(foodKey("Greek Yogurt, plain", "g")).toBe(foodKey("greek yogurt plain", "g"));
  });

  it("separates the same food measured in different units", () => {
    expect(foodKey("Chicken breast", "g")).not.toBe(foodKey("Chicken breast", "item"));
  });
});
