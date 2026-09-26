import type { AiUsage } from "@/lib/ai/client";
import type { KnownFood, ParsedMeal } from "@/lib/ai/food";
import type { FoodUnit, MealSlot } from "@/lib/taxonomy";
import { foodKey, phraseKey } from "./normalize";
import { macrosAddUp, scaleMacros, sumMacros, type Macros } from "./macros";

/**
 * Sentence in, priced items out, cheapest path first.
 *
 * This is the module the plan's nutrition verification is about - log the same meal
 * twice and the second is identical, from the cache - and it is written against a
 * port rather than the database so that behaviour is a unit test rather than a
 * fixture. Three paths, tried in order:
 *
 * 1. **The phrase cache.** The whole sentence, normalised, has been logged before, so
 *    its own prior entries are replayed. No model call, and byte-identical numbers.
 * 2. **The model,** for a sentence never seen. It answers with named items, and
 *    those names are what the next two steps key on.
 * 3. **The food cache,** per item. A sentence is new but its foods are not - a
 *    familiar breakfast with an extra banana - so each item's macros come from the
 *    stored food and only genuinely new foods are written.
 *
 * Step 1 is what makes a repeat free; step 3 is what makes a *variation* consistent.
 * Both matter, and only having step 3 would leave the verification passing
 * intermittently, because a second parse is free to answer "greek yoghurt" where the
 * first said "Greek yogurt, plain" and that is a different key.
 *
 * The one rule about ordering: the model is never asked when step 1 can answer, so a
 * repeat costs nothing at all rather than costing a call whose answer is discarded.
 */

/** Per-unit macros for one food, as they are cached. */
export type CachedFood = {
  id: number;
  key: string;
  name: string;
  unit: FoodUnit;
  perUnit: Macros;
  /** `model` when estimated, `owner` once corrected by hand. */
  provenance: string;
};

/**
 * One line of a resolved meal, ready to be written as a `food_log_entries` row.
 *
 * `source` is kept because it is the answer to the owner's only real question about a
 * number they doubt: was this estimated just now, or is it the same number as last
 * time? It is also what the verification asserts on.
 */
export type ResolvedItem = {
  food: CachedFood;
  quantity: number;
  /** `food.perUnit` times `quantity`, which is what the day totals sum. */
  macros: Macros;
  source: "phrase-cache" | "food-cache" | "model";
  /** True when the item's calories disagree with its own macros. */
  suspectMacros: boolean;
  quantityNote: string | null;
};

export type MealResolution = {
  items: ResolvedItem[];
  totals: Macros;
  /** Fragments the model could not turn into a food. Empty on a cache hit. */
  unresolved: string[];
  notes: string | null;
  /** The key this meal is cached under, or null when the text folds away to nothing. */
  phraseKey: string | null;
  /** True when no model call was made, which is the state a repeat should be in. */
  cached: boolean;
  /** Null unless a call was made. The caller meters it. */
  usage: AiUsage | null;
  model: string | null;
};

/**
 * The reads and the one write the resolver needs, as a port.
 *
 * Narrow on purpose. Everything interesting here is cache logic, and cache logic
 * tested through a database is cache logic tested once a container is running; this
 * way `lib/nutrition/resolve.test.ts` runs it in memory, and
 * `lib/nutrition/store.ts` is the only part that needs Postgres.
 */
export interface FoodStore {
  /** The items a previous logging of this exact phrase resolved to, newest only. */
  byPhrase(key: string): Promise<{ quantity: number; food: CachedFood }[]>;
  /** Cached foods for the keys the parse produced. Missing keys are simply absent. */
  byKeys(keys: readonly string[]): Promise<Map<string, CachedFood>>;
  /** Names and units to show the model, so it answers with keys that already exist. */
  known(limit: number): Promise<KnownFood[]>;
  /** Writes a food the parse invented, and returns it as stored. */
  upsert(food: Omit<CachedFood, "id" | "key">): Promise<CachedFood>;
}

export type MealParser = (input: {
  text: string;
  meal: MealSlot;
  day: string;
  known: readonly KnownFood[];
}) => Promise<{ output: ParsedMeal; usage: AiUsage; model: string }>;

/**
 * How many cached foods the model is shown.
 *
 * A ceiling rather than everything, because the table is the largest part of the
 * prompt and an unbounded one grows the input cost of every parse forever. The store
 * orders by how recently a food was used, so what is dropped is what the owner has
 * stopped eating - and dropping it costs one estimate, not a wrong answer.
 */
export const KNOWN_FOODS_SHOWN = 200;

export async function resolveMeal(input: {
  text: string;
  meal: MealSlot;
  day: string;
  store: FoodStore;
  parse: MealParser;
}): Promise<MealResolution> {
  const key = phraseKey(input.text);

  if (key) {
    const replayed = await input.store.byPhrase(key);
    if (replayed.length > 0) {
      const items = replayed.map((entry) => item(entry.food, entry.quantity, "phrase-cache", null));
      return {
        items,
        totals: sumMacros(items.map((resolved) => resolved.macros)),
        unresolved: [],
        notes: null,
        phraseKey: key,
        cached: true,
        usage: null,
        model: null,
      };
    }
  }

  const known = await input.store.known(KNOWN_FOODS_SHOWN);
  const parsed = await input.parse({
    text: input.text,
    meal: input.meal,
    day: input.day,
    known,
  });

  // Every key the parse produced, looked up in one round trip rather than one per
  // item: a sentence of six familiar foods is one query, not six.
  const keys = parsed.output.items.map((food) => foodKey(food.name, food.unit));
  const cachedFoods = await input.store.byKeys(keys);

  const items: ResolvedItem[] = [];
  for (const [index, parsedFood] of parsed.output.items.entries()) {
    const held = cachedFoods.get(keys[index]);
    // A food already cached keeps the cached macros, and the fresh estimate is
    // discarded. That is the whole point: the first answer is the answer, so the
    // same food never shows two sets of numbers, and a correction the owner made
    // is not silently overwritten by the next parse that mentions it.
    const food =
      held ??
      (await input.store.upsert({
        name: parsedFood.name,
        unit: parsedFood.unit,
        perUnit: {
          kcal: parsedFood.perUnit.kcalPerUnit,
          proteinG: parsedFood.perUnit.proteinGPerUnit,
          carbsG: parsedFood.perUnit.carbsGPerUnit,
          fatG: parsedFood.perUnit.fatGPerUnit,
          fiberG: parsedFood.perUnit.fiberGPerUnit,
        },
        provenance: "model",
      }));
    items.push(
      item(food, parsedFood.quantity, held ? "food-cache" : "model", parsedFood.quantityNote),
    );
  }

  return {
    items,
    totals: sumMacros(items.map((resolved) => resolved.macros)),
    unresolved: parsed.output.unresolved,
    notes: parsed.output.notes,
    phraseKey: key,
    cached: false,
    usage: parsed.usage,
    model: parsed.model,
  };
}

function item(
  food: CachedFood,
  quantity: number,
  source: ResolvedItem["source"],
  quantityNote: string | null,
): ResolvedItem {
  return {
    food,
    quantity,
    macros: scaleMacros(food.perUnit, quantity),
    source,
    suspectMacros: !macrosAddUp(food.perUnit),
    quantityNote,
  };
}
