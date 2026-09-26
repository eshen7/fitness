import { z } from "zod";
import { FOOD_UNITS } from "@/lib/taxonomy";
import type { FoodUnit, MealSlot } from "@/lib/taxonomy";
import { formatDay } from "@/lib/days";
import { mealSlotLabels } from "@/lib/labels";
import { KCAL_PER_G } from "@/lib/nutrition/macros";
import { getAiClient, type AiResult } from "./client";

/**
 * The one model call nutrition makes: a sentence of food into items with macros.
 *
 * Everything else in nutrition is arithmetic. This is the only part that needs a
 * model, because "a bowl of oats with a scoop of whey and a banana" is a language
 * problem, and it is the only part that costs money, so it is also the part the two
 * caches exist to avoid. By the time this is reached, `lib/nutrition/resolve.ts`
 * has already established that neither the phrase nor its foods are known.
 *
 * Two rules shape the prompt and both are about the cache rather than about food:
 *
 * - The model is shown the foods already resolved and told to reuse their exact
 *   names and units. A second parse that answers "greek yoghurt" where the first
 *   said "Greek yogurt, plain" is a second cache key and therefore a second
 *   estimate, and the owner sees two different numbers for one breakfast.
 * - Macros are asked for **per unit**, never per portion. A portion is the one part
 *   of this the app can do exactly, and a cache of per-portion numbers would have to
 *   be re-estimated the moment the portion changed.
 *
 * The prompt is split stable / volatile like every other call in `lib/ai/`: nothing
 * derived from the clock may sit in the stable half, or the prefix cache reads zero
 * on every request and the input cost goes up tenfold.
 */

// -----------------------------------------------------------------------------
// What the model returns
// -----------------------------------------------------------------------------

/**
 * Per-unit macros, flat rather than nested and every field required.
 *
 * Structured output is strict: an optional field is not a field the model may omit,
 * it is a schema the API rejects. So fibre, the one genuinely unknowable number, is
 * `.nullable()` and the null is carried all the way through `Macros`.
 *
 * No numeric refinements either. A refinement the model breaks becomes a parse
 * failure and then a repair round, and the arithmetic check that matters here -
 * whether the macros add up to the calories - is one the owner should see and fix
 * rather than one the model should be asked to guess again at.
 */
const perUnitMacrosSchema = z.object({
  kcalPerUnit: z.number(),
  proteinGPerUnit: z.number(),
  carbsGPerUnit: z.number(),
  fatGPerUnit: z.number(),
  fiberGPerUnit: z.number().nullable(),
});

export const parsedFoodSchema = z.object({
  /**
   * The canonical name this food should be cached under: the food, not the portion.
   * "Greek yogurt, plain, 5% fat", never "a tub of greek yogurt".
   *
   * One field rather than a name and a brand, because the name is half the cache
   * key and a brand beside it that the key ignored would make "Fage 5%" and "Aldi
   * 5%" the same row. A brand that changes the macros belongs in the name.
   */
  name: z.string(),
  /** The unit the macros below are per. */
  unit: z.enum(FOOD_UNITS),
  /** How many of that unit this sentence said. */
  quantity: z.number(),
  perUnit: perUnitMacrosSchema,
  /** What the quantity was inferred from when the sentence did not give one. */
  quantityNote: z.string().nullable(),
});
export type ParsedFood = z.infer<typeof parsedFoodSchema>;

export const parsedMealSchema = z.object({
  items: z.array(parsedFoodSchema),
  /**
   * Fragments that named no food the model could estimate, kept verbatim.
   *
   * An escape hatch of the same kind as `suggestedExercises` in the generation
   * schemas: a model with nowhere to put "and some of whatever that was" will
   * invent a plausible food instead, and an invented food with confident macros is
   * the worst outcome available here.
   */
  unresolved: z.array(z.string()),
  /** One line for the owner on anything assumed. Null when nothing was. */
  notes: z.string().nullable(),
});
export type ParsedMeal = z.infer<typeof parsedMealSchema>;

// -----------------------------------------------------------------------------
// The prompt
// -----------------------------------------------------------------------------

export const FOOD_SYSTEM_PROMPT = `You turn one sentence of plainly described food into a list of items with macros. A single athlete's training app logs what you return, sums it against daily targets, and caches it, so you are a unit converter and a portion estimator rather than a nutritionist.

How this is used, so you can be useful rather than merely plausible:

- Give macros PER UNIT, and the quantity separately. The app multiplies. "Two slices of sourdough" is one item, unit "slice", quantity 2, and the macros of ONE slice. Per-portion numbers are wrong here even when they are accurate.
- Every item you return is cached under its name and unit and reused forever. Name the food, not the serving: "Peanut butter, smooth" and not "a big spoon of peanut butter". Put a brand in the name only when the brand changes the numbers.
- You are shown the foods already in the cache. If the sentence means one of them, reuse its name and its unit EXACTLY as written. That is what makes the same meal log to the same numbers twice, which matters more than any improvement you could make to the name.
- Estimate a missing quantity from how people eat rather than refusing, and say what you assumed in quantityNote. A conservative ordinary portion is the right guess.
- If part of the sentence names nothing you can estimate, put that fragment in unresolved and leave it out of items. Never invent a food to cover it.
- Do not add items the sentence did not mention, and do not split a food into components. "A chicken sandwich" is one item unless the sentence itemised it.

Accuracy bar: supermarket-label accuracy for packaged food, a sensible cooked-weight estimate otherwise. The owner can correct any number afterwards, so an honest estimate with a note beats a precise-looking guess.`;

/** Unit rules, in the same closed-set language the exercise directory uses. */
const UNIT_RULES = `Units. This is a closed set; there is no other unit.

- g, ml: a weight or volume the sentence gave, or one you are confident of. Macros per single gram or millilitre, so they are small numbers with decimals.
- item: one whole countable thing - an egg, a banana, a bar, a sandwich.
- slice, cup, tbsp, tsp, scoop: household measures, used when that is how the food is actually measured. A scoop is a supplement scoop, about 30 g of protein powder unless the sentence says otherwise.

Prefer g or ml when the sentence gave a weight or volume, and the household measure when it did not. Do not convert a household measure into grams and then report the household measure: the macros must be per the unit you name.`;

/**
 * The arithmetic the app checks, stated so the first attempt usually passes it.
 *
 * `lib/nutrition/macros.ts` flags an item whose calories disagree with its own
 * macros by more than a fifth. That is not a rejection - the owner sees the flag -
 * but a prompt that states the identity costs nothing and avoids most of them.
 */
const MACRO_RULES = `Arithmetic the app checks. Calories come from the macros: protein and carbohydrate at ${KCAL_PER_G.protein} kcal per gram, fat at ${KCAL_PER_G.fat}. Your kcalPerUnit should be within a fifth of protein x ${KCAL_PER_G.protein} + carbs x ${KCAL_PER_G.carbs} + fat x ${KCAL_PER_G.fat}, and an item that misses that is flagged to the owner as an arithmetic slip. Carbohydrate is total carbohydrate including fibre, which is reported again separately. Alcohol is the one honest exception: put its energy in kcalPerUnit and leave the macros at zero.`;

export type KnownFood = {
  name: string;
  unit: FoodUnit;
  kcalPerUnit: number;
};

/**
 * The cache, as a table the model can match against.
 *
 * Name, unit and calories only. The point of showing it is to fix the *name and
 * unit* so a repeat hits the cache; the full macros would be several times the size
 * for a value the app already holds and would not use the model's copy of. Last
 * within the stable text, like the candidate exercise table and for the same reason:
 * it is the part most likely to change, and everything ahead of it stays cached.
 */
function knownFoodTable(known: readonly KnownFood[]) {
  const header = "name | unit | kcal per unit";
  const rows = known.map((food) => [food.name, food.unit, food.kcalPerUnit].join(" | "));
  return [header, ...rows].join("\n");
}

function section(title: string, body: string) {
  return `## ${title}\n\n${body}`;
}

export function foodStableText(known: readonly KnownFood[]) {
  return [
    FOOD_SYSTEM_PROMPT,
    section("Units", UNIT_RULES),
    section("Macros", MACRO_RULES),
    section(
      `Foods already cached (${known.length})`,
      known.length === 0
        ? "None yet. Whatever you name becomes the cached name, so name carefully."
        : `If the sentence means one of these, reuse the name and unit exactly.\n\n${knownFoodTable(known)}`,
    ),
  ].join("\n\n");
}

export function foodVolatileText(input: { meal: MealSlot; day: string }) {
  return section(
    "This entry",
    `Logged as ${mealSlotLabels.of(input.meal).toLowerCase()} on ${formatDay(input.day)}.`,
  );
}

// -----------------------------------------------------------------------------

/**
 * Parses one sentence. Throws `AiOutputError` or `BilledFailure`, like every other
 * call through the seam, and records nothing: the caller owns the meter and the
 * database.
 *
 * There is no repair loop here, unlike generation. The gate that justifies one does
 * not exist for food - there is no deterministic oracle for whether an estimate of a
 * banana is right - so a second attempt would be a second guess at the same
 * question, at twice the price. The owner correcting a number is both cheaper and
 * more accurate, and a correction is cached, so it is paid for once.
 */
export async function parseMeal(input: {
  text: string;
  meal: MealSlot;
  day: string;
  known: readonly KnownFood[];
}): Promise<AiResult<ParsedMeal>> {
  return getAiClient().propose({
    stable: foodStableText(input.known),
    volatile: foodVolatileText(input),
    turns: [{ role: "user", content: `Log this: ${input.text}` }],
    tools: [],
    schema: parsedMealSchema,
    cacheKey: "fitness-food",
    label: "food parse",
  });
}
