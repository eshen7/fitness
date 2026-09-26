import { describe, expect, it } from "vitest";
import type { AiUsage } from "@/lib/ai/client";
import type { KnownFood, ParsedMeal } from "@/lib/ai/food";
import type { FoodUnit } from "@/lib/taxonomy";
import { decodePerUnit, encodePerUnit, macrosAddUp } from "./macros";
import { foodKey, phraseKey } from "./normalize";
import { resolveMeal, type CachedFood, type FoodStore, type MealParser } from "./resolve";

/**
 * The plan's nutrition verification, and the two caches behind it.
 *
 * "Log the same meal twice in plain language and assert identical macros resolved
 * from the cache on the second entry." Run against an in-memory store and a counting
 * parser, so what is asserted is both halves of the claim: the numbers are identical,
 * and the second logging made no model call at all. A test that only checked the
 * numbers would pass against a store that re-estimated and happened to agree.
 *
 * The parser is deliberately unstable - it appends a marker to the food name and
 * bumps the calories every time it is asked - so any path that reaches it a second
 * time produces visibly different macros and fails.
 */

const USAGE: AiUsage = {
  inputTokens: 900,
  outputTokens: 120,
  cachedInputTokens: 0,
  reasoningTokens: 0,
};

/**
 * An in-memory `FoodStore`: the same three reads and one write, over maps.
 *
 * Writes go through the same column codec as the Postgres store, so a precision the
 * columns would lose is lost here too.
 */
function memoryStore() {
  const foods = new Map<string, CachedFood>();
  const entries: { phraseKey: string | null; loggedAt: number; quantity: number; key: string }[] =
    [];
  let nextId = 1;
  let clock = 0;

  const store: FoodStore = {
    async byPhrase(key) {
      const matching = entries.filter((entry) => entry.phraseKey === key);
      if (matching.length === 0) return [];
      const newest = Math.max(...matching.map((entry) => entry.loggedAt));
      return matching
        .filter((entry) => entry.loggedAt === newest)
        .map((entry) => ({
          quantity: entry.quantity,
          food: foods.get(entry.key) as CachedFood,
        }));
    },
    async byKeys(keys) {
      const found = new Map<string, CachedFood>();
      for (const key of keys) {
        const food = foods.get(key);
        if (food) found.set(key, food);
      }
      return found;
    },
    async known(limit) {
      return [...foods.values()]
        .slice(0, limit)
        .map((food): KnownFood => ({
          name: food.name,
          unit: food.unit,
          kcalPerUnit: food.perUnit.kcal,
        }));
    },
    async upsert(food) {
      const key = foodKey(food.name, food.unit);
      const held = foods.get(key);
      if (held) return held;
      const stored: CachedFood = {
        id: nextId++,
        key,
        ...food,
        perUnit: decodePerUnit(encodePerUnit(food.perUnit)),
      };
      foods.set(key, stored);
      return stored;
    },
  };

  /** What the action does after resolving: one instant for the whole sentence. */
  function log(text: string, items: { key: string; quantity: number }[]) {
    clock += 1;
    for (const item of items) {
      entries.push({ phraseKey: phraseKey(text), loggedAt: clock, ...item });
    }
  }

  return { store, log, foods };
}

/**
 * A parser that answers differently every time, so a second call cannot hide.
 *
 * It also reports what it was shown, which is how the known-food table is asserted.
 */
function countingParser(
  items: { name: string; unit: FoodUnit; quantity: number; kcal: number }[],
) {
  const calls: { text: string; known: readonly KnownFood[] }[] = [];
  const parse: MealParser = async (call) => {
    calls.push({ text: call.text, known: call.known });
    const nth = calls.length;
    const output: ParsedMeal = {
      items: items.map((item) => ({
        // Stable name, so the food cache can be exercised on purpose; the drift is
        // in the numbers, which is where an unnoticed re-estimate would show.
        name: item.name,
        unit: item.unit,
        quantity: item.quantity,
        perUnit: {
          kcalPerUnit: item.kcal + nth,
          proteinGPerUnit: 1 + nth,
          carbsGPerUnit: 2 + nth,
          fatGPerUnit: 0.5,
          fiberGPerUnit: null,
        },
        quantityNote: null,
      })),
      unresolved: [],
      notes: null,
    };
    return { output, usage: USAGE, model: "gpt-6-luna" };
  };
  return { parse, calls };
}

describe("resolveMeal", () => {
  it("resolves the same sentence to identical macros with no second model call", async () => {
    const { store, log } = memoryStore();
    const { parse, calls } = countingParser([
      { name: "Oats, rolled, dry", unit: "g", quantity: 80, kcal: 3.8 },
      { name: "Banana", unit: "item", quantity: 1, kcal: 105 },
    ]);
    const text = "80g of oats with a banana";

    const first = await resolveMeal({ text, meal: "breakfast", day: "2026-09-20", store, parse });
    log(
      text,
      first.items.map((item) => ({ key: item.food.key, quantity: item.quantity })),
    );

    const second = await resolveMeal({ text, meal: "breakfast", day: "2026-09-21", store, parse });

    expect(calls).toHaveLength(1);
    expect(second.cached).toBe(true);
    expect(second.usage).toBeNull();
    expect(second.totals).toEqual(first.totals);
    expect(second.items.map((item) => item.macros)).toEqual(
      first.items.map((item) => item.macros),
    );
    expect(second.items.map((item) => item.source)).toEqual(["phrase-cache", "phrase-cache"]);
  });

  it("matches a sentence that only differs in case, spacing and punctuation", async () => {
    const { store, log } = memoryStore();
    const { parse, calls } = countingParser([
      { name: "Greek yogurt, plain", unit: "g", quantity: 200, kcal: 0.97 },
    ]);

    const first = await resolveMeal({
      text: "200g greek yogurt",
      meal: "snack",
      day: "2026-09-20",
      store,
      parse,
    });
    log(
      "200g greek yogurt",
      first.items.map((item) => ({ key: item.food.key, quantity: item.quantity })),
    );

    const second = await resolveMeal({
      text: "  200G   Greek Yogurt!  ",
      meal: "snack",
      day: "2026-09-21",
      store,
      parse,
    });

    expect(calls).toHaveLength(1);
    expect(second.totals).toEqual(first.totals);
  });

  it("keeps the cached macros for a familiar food inside a new sentence", async () => {
    const { store, log } = memoryStore();
    const { parse, calls } = countingParser([
      { name: "Banana", unit: "item", quantity: 1, kcal: 105 },
    ]);

    const first = await resolveMeal({
      text: "a banana",
      meal: "snack",
      day: "2026-09-20",
      store,
      parse,
    });
    log(
      "a banana",
      first.items.map((item) => ({ key: item.food.key, quantity: item.quantity })),
    );

    // A different sentence, so the phrase cache cannot answer and the model is asked
    // again - but the food it names is already cached, so the numbers must not move.
    const second = await resolveMeal({
      text: "two bananas",
      meal: "snack",
      day: "2026-09-21",
      store,
      parse,
    });

    expect(calls).toHaveLength(2);
    expect(second.cached).toBe(false);
    expect(second.items[0].source).toBe("food-cache");
    expect(second.items[0].food.perUnit).toEqual(first.items[0].food.perUnit);
  });

  it("shows the model what is already cached, so it can answer with known names", async () => {
    const { store, log } = memoryStore();
    const { parse, calls } = countingParser([
      { name: "Whey protein", unit: "scoop", quantity: 1, kcal: 120 },
    ]);

    const first = await resolveMeal({
      text: "a scoop of whey",
      meal: "post_workout",
      day: "2026-09-20",
      store,
      parse,
    });
    log(
      "a scoop of whey",
      first.items.map((item) => ({ key: item.food.key, quantity: item.quantity })),
    );

    await resolveMeal({
      text: "two scoops of whey",
      meal: "post_workout",
      day: "2026-09-21",
      store,
      parse,
    });

    expect(calls[0].known).toEqual([]);
    expect(calls[1].known).toEqual([
      { name: "Whey protein", unit: "scoop", kcalPerUnit: 121 },
    ]);
  });

  it("scales per-unit macros by the quantity and sums the sentence", async () => {
    const { store } = memoryStore();
    const { parse } = countingParser([
      { name: "Rice, cooked", unit: "g", quantity: 250, kcal: 0.3 },
      { name: "Chicken breast, cooked", unit: "g", quantity: 150, kcal: 1.4 },
    ]);

    const meal = await resolveMeal({
      text: "250g rice and 150g chicken",
      meal: "dinner",
      day: "2026-09-20",
      store,
      parse,
    });

    // Per unit, call 1: kcal 1.3 and 2.4, protein 2, carbs 3, fat 0.5.
    expect(meal.items[0].macros).toEqual({
      kcal: 325,
      proteinG: 500,
      carbsG: 750,
      fatG: 125,
      fiberG: null,
    });
    expect(meal.totals.kcal).toBe(325 + 360);
    expect(meal.items.every((item) => item.source === "model")).toBe(true);
  });

  it("keeps per-gram macros through the store, so a small food neither drifts nor is flagged", async () => {
    const { store, log } = memoryStore();
    const cucumber = { kcal: 0.15, proteinG: 0.0065, carbsG: 0.036, fatG: 0.001 };
    const parse: MealParser = async () => ({
      output: {
        items: [
          {
            name: "Cucumber",
            unit: "g",
            quantity: 200,
            perUnit: {
              kcalPerUnit: cucumber.kcal,
              proteinGPerUnit: cucumber.proteinG,
              carbsGPerUnit: cucumber.carbsG,
              fatGPerUnit: cucumber.fatG,
              fiberGPerUnit: null,
            },
            quantityNote: null,
          },
        ],
        unresolved: [],
        notes: null,
      },
      usage: USAGE,
      model: "gpt-6-luna",
    });
    const text = "200g cucumber";

    const first = await resolveMeal({ text, meal: "lunch", day: "2026-09-20", store, parse });
    log(
      text,
      first.items.map((item) => ({ key: item.food.key, quantity: item.quantity })),
    );
    const second = await resolveMeal({ text, meal: "lunch", day: "2026-09-21", store, parse });

    for (const meal of [first, second]) {
      const [item] = meal.items;
      expect(macrosAddUp(item.food.perUnit)).toBe(true);
      expect(item.suspectMacros).toBe(false);
      for (const field of ["kcal", "proteinG", "carbsG", "fatG"] as const) {
        const exact = cucumber[field] * 200;
        expect(Math.abs(item.macros[field] - exact) / exact).toBeLessThan(0.01);
      }
    }
    expect(second.items[0].source).toBe("phrase-cache");
  });

  it("flags a food whose calories disagree with its own macros", async () => {
    const { store } = memoryStore();
    const parse: MealParser = async () => ({
      output: {
        items: [
          {
            name: "Mystery bar",
            unit: "item",
            quantity: 1,
            // 20 g protein, 30 g carbs, 10 g fat is 290 kcal, not 100.
            perUnit: {
              kcalPerUnit: 100,
              proteinGPerUnit: 20,
              carbsGPerUnit: 30,
              fatGPerUnit: 10,
              fiberGPerUnit: 2,
            },
            quantityNote: null,
          },
        ],
        unresolved: [],
        notes: null,
      },
      usage: USAGE,
      model: "gpt-6-luna",
    });

    const meal = await resolveMeal({
      text: "a mystery bar",
      meal: "snack",
      day: "2026-09-20",
      store,
      parse,
    });
    expect(meal.items[0].suspectMacros).toBe(true);
  });

  it("carries unresolved fragments through rather than inventing a food", async () => {
    const { store } = memoryStore();
    const parse: MealParser = async () => ({
      output: {
        items: [],
        unresolved: ["some of whatever that was"],
        notes: "Nothing nameable in that.",
      },
      usage: USAGE,
      model: "gpt-6-luna",
    });

    const meal = await resolveMeal({
      text: "some of whatever that was",
      meal: "snack",
      day: "2026-09-20",
      store,
      parse,
    });
    expect(meal.items).toEqual([]);
    expect(meal.unresolved).toEqual(["some of whatever that was"]);
    expect(meal.totals.kcal).toBe(0);
  });

  it("parses a sentence that folds away to nothing rather than caching it", async () => {
    const { store } = memoryStore();
    const { parse, calls } = countingParser([
      { name: "Water", unit: "ml", quantity: 500, kcal: 0 },
    ]);
    const meal = await resolveMeal({
      text: "!!!",
      meal: "snack",
      day: "2026-09-20",
      store,
      parse,
    });
    expect(meal.phraseKey).toBeNull();
    expect(calls).toHaveLength(1);
  });
});
