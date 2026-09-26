import { z } from "zod";
import { MEAL_SLOTS } from "@/lib/taxonomy";
import { PER_UNIT_MAX, type Macros } from "./macros";

/**
 * What the nutrition UI sends the server, and what it gets back.
 *
 * Imports nothing but Zod and the taxonomy, so a client component can validate as
 * it types without pulling the database driver or a `"use server"` module in behind
 * it. Same split as `lib/ai/requests.ts` and for the same reason.
 */

export type NutritionResult = {
  ok: boolean;
  message: string;
  errors?: Record<string, string>;
  /** How many items a sentence resolved into, when one did. */
  itemCount?: number;
  /** True when the log was answered from the caches, so it cost nothing. */
  cached?: boolean;
  /** Fragments the parse could not turn into food, for the owner to re-word. */
  unresolved?: string[];
};

const isoDay = z.iso.date();

export const logMealSchema = z.object({
  /**
   * The sentence. Bounded at both ends: a single character resolves to nothing
   * useful, and a whole day typed at once is a parse whose items cannot be told
   * apart by meal, which is what the meal field is for.
   */
  text: z.string().trim().min(2, "Say what you ate.").max(500),
  meal: z.enum(MEAL_SLOTS),
  /** Defaults to today on the server, where the app's zone is known. */
  day: isoDay.nullish(),
});
export type LogMealInput = z.input<typeof logMealSchema>;

export const deleteEntrySchema = z.object({
  id: z.number().int().positive(),
  /**
   * `item` removes one food, `sentence` removes everything one sentence produced.
   * Both exist because a parse can be wrong in either grain: an extra banana that
   * was not eaten, or a whole sentence read as the wrong meal.
   */
  scope: z.enum(["item", "sentence"]).nullish(),
});
export type DeleteEntryInput = z.input<typeof deleteEntrySchema>;

export const PER_UNIT_HINT = "Per unit, not per portion.";

/**
 * The most a single gram of any food can hold: pure fat is 9 kcal, and no food is
 * more than all of itself in one macro. A per-unit figure above either is a portion
 * total typed into a per-unit field, which is the one slip worth catching by unit.
 *
 * A millilitre gets the calorie ceiling only: oil is lighter than water, so 9 kcal
 * still holds, but honey is denser and carries more than a gram of sugar per ml.
 */
export const PER_GRAM_MAX = { kcal: 9, grams: 1 } as const;

export function perUnitImplausible(unit: string, macros: Macros): boolean {
  if (unit !== "g" && unit !== "ml") return false;
  if (macros.kcal > PER_GRAM_MAX.kcal) return true;
  return (
    unit === "g" &&
    [macros.proteinG, macros.carbsG, macros.fatG, macros.fiberG ?? 0].some(
      (grams) => grams > PER_GRAM_MAX.grams,
    )
  );
}

/**
 * A correction, which is both the portion on this entry and the macros of the food
 * behind it.
 *
 * One form rather than two, because it is one question - "this line is wrong" - and
 * the answer is usually the quantity and occasionally the macros. Correcting the
 * macros rewrites the cached food, which changes every entry that used it and every
 * entry that ever will: that is the cache doing its job, and it is why the
 * correction is marked as the owner's so no later parse overwrites it.
 *
 * `perUnit` is sent only when the owner edited a macro, so a portion fix never has
 * to re-validate numbers the parse stored. Its ceilings are the columns', because a
 * food the parse could store is a food the owner must be able to correct.
 */
export const correctEntrySchema = z.object({
  entryId: z.number().int().positive(),
  quantity: z
    .number()
    .positive("A portion is more than nothing.")
    .max(10_000, "That is not a portion."),
  perUnit: z
    .object({
      kcal: z.number().min(0).max(PER_UNIT_MAX.kcal, PER_UNIT_HINT),
      proteinG: z.number().min(0).max(PER_UNIT_MAX.grams, PER_UNIT_HINT),
      carbsG: z.number().min(0).max(PER_UNIT_MAX.grams, PER_UNIT_HINT),
      fatG: z.number().min(0).max(PER_UNIT_MAX.grams, PER_UNIT_HINT),
      fiberG: z.number().min(0).max(PER_UNIT_MAX.grams, PER_UNIT_HINT).nullish(),
    })
    .nullish(),
});
export type CorrectEntryInput = z.input<typeof correctEntrySchema>;

export const setTargetsSchema = z.object({
  /**
   * The owner picks a direction; the numbers come from the rules in
   * `lib/nutrition/targets.ts`. There is no field for the calories themselves,
   * because a target typed by hand is a target the phase rules cannot vouch for -
   * and the one rule that matters here, that a cut waits for healthy tendons and a
   * block that is not a peak, would be trivially bypassed by one.
   */
  goal: z.enum(["gain", "hold", "cut"]),
  effectiveFrom: isoDay.nullish(),
});
export type SetTargetsInput = z.input<typeof setTargetsSchema>;
