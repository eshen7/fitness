"use server";

import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { hasApiKey } from "@/lib/ai/client";
import { parseMeal } from "@/lib/ai/food";
import {
  capReached,
  invalid,
  keyMissing,
  reasonOf,
  recordBilledFailure,
  type Refusal,
} from "@/lib/ai/guards";
import { recordSpend } from "@/lib/ai/proposals";
import { addDays } from "@/lib/days";
import { getDb, schema, type Db } from "@/lib/db";
import { today } from "@/lib/time";
import { decodePerUnit, encodePerUnit, samePerUnit } from "./macros";
import { targetInputsFor } from "./queries";
import {
  PER_UNIT_HINT,
  correctEntrySchema,
  deleteEntrySchema,
  logMealSchema,
  perGramImplausible,
  setTargetsSchema,
  type NutritionResult,
} from "./requests";
import { resolveMeal, type MealParser } from "./resolve";
import { foodStore } from "./store";

/**
 * The writes behind the nutrition screens.
 *
 * The one that matters is `logMeal`, and what it is careful about is money. The
 * guards in `lib/ai/guards.ts` - key present, spend under the cap - are checked
 * inside the parser callback rather than at the top of the action, so a sentence the
 * phrase cache can answer never asks the cap query at all, let alone the model. A
 * repeat of yesterday's breakfast is two selects and an insert.
 *
 * The label on the ledger is `food parse`, and the ledger is the same one generation
 * and the bench write to, so `SPEND_CAP_USD` is one ceiling over every live call
 * rather than one per feature.
 */

const SUBJECT = "Food parsing";
const SPEND_LABEL = "food parse";

/**
 * A guard that fired inside the parser callback, on its way back out.
 *
 * The callback's contract is to return a parse or throw, and a refusal is neither a
 * parse nor a failure, so it travels as an exception and is unwrapped at the top.
 */
class Refused extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.message);
    this.name = "Refused";
  }
}

/**
 * Logs a sentence of food.
 *
 * Every item one sentence resolves into shares a `loggedAt`, which is what lets the
 * sentence be replayed, deleted or shown as a unit later. The phrase is only cached
 * when the parse understood all of it: a sentence with a fragment left over is one
 * the owner should get the chance to re-word, and replaying it would quietly drop
 * the part that was never resolved.
 */
export async function logMeal(input: unknown): Promise<NutritionResult> {
  const parsed = logMealSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { text, meal } = parsed.data;
  const day = parsed.data.day ?? today();

  const db = getDb();
  const parse: MealParser = async (call) => {
    if (!hasApiKey()) throw new Refused(keyMissing(SUBJECT));
    const capped = await capReached(db, SUBJECT);
    if (capped) throw new Refused(capped);
    const result = await parseMeal(call);
    return { output: result.output, usage: result.usage, model: result.model };
  };

  try {
    const resolution = await resolveMeal({
      text,
      meal,
      day,
      store: foodStore(db),
      parse,
    });

    if (resolution.usage && resolution.model) {
      await recordSpend({
        source: "app",
        label: SPEND_LABEL,
        model: resolution.model,
        usage: resolution.usage,
      });
    }

    if (resolution.items.length === 0) {
      return {
        ok: false,
        message:
          resolution.unresolved.length > 0
            ? `Nothing in that resolved to a food: ${resolution.unresolved.join("; ")}. Try naming the food and the amount.`
            : "Nothing in that resolved to a food. Try naming the food and the amount.",
        unresolved: resolution.unresolved,
      };
    }

    const loggedAt = new Date();
    await db.insert(schema.foodLogEntries).values(
      resolution.items.map((item) => ({
        foodId: item.food.id,
        quantity: item.quantity.toFixed(2),
        meal,
        day,
        loggedAt,
        rawText: text,
        phraseKey: resolution.unresolved.length === 0 ? resolution.phraseKey : null,
      })),
    );

    revalidatePath("/nutrition");

    const count = resolution.items.length;
    const kcal = resolution.totals.kcal;
    return {
      ok: true,
      itemCount: count,
      cached: resolution.cached,
      unresolved: resolution.unresolved,
      // A whole sentence per clause, because joining fragments with ". " reads as
      // "378 kcal. from the cache", which looks like a bug in the string rather than
      // the two separate facts it is.
      message: [
        `${count} item${count === 1 ? "" : "s"}, ${kcal} kcal.`,
        resolution.cached ? "From the cache, so nothing was spent." : null,
        resolution.unresolved.length > 0
          ? `Not understood: ${resolution.unresolved.join("; ")}.`
          : null,
      ]
        .filter(Boolean)
        .join(" "),
    };
  } catch (error) {
    if (error instanceof Refused) return error.refusal;
    await recordBilledFailure(error, SPEND_LABEL);
    return {
      ok: false,
      message: `That could not be parsed: ${reasonOf(error)}. Nothing was logged.`,
    };
  }
}

/** Removes one item, or everything one sentence produced. */
export async function deleteFoodEntry(input: unknown): Promise<NutritionResult> {
  const parsed = deleteEntrySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { id } = parsed.data;
  const db = getDb();
  const { foodLogEntries } = schema;

  const [row] = await db
    .select({ loggedAt: foodLogEntries.loggedAt, day: foodLogEntries.day })
    .from(foodLogEntries)
    .where(eq(foodLogEntries.id, id))
    .limit(1);
  if (!row) return { ok: false, message: "That entry is already gone." };

  if (parsed.data.scope === "sentence") {
    // Grouped by the instant, the same handle the phrase cache uses, so a sentence
    // logged twice in one day loses only the logging that was tapped.
    const removed = await db
      .delete(foodLogEntries)
      .where(
        and(eq(foodLogEntries.day, row.day), eq(foodLogEntries.loggedAt, row.loggedAt)),
      )
      .returning({ id: foodLogEntries.id });
    revalidatePath("/nutrition");
    return {
      ok: true,
      message: `Removed ${removed.length} item${removed.length === 1 ? "" : "s"}.`,
    };
  }

  await db.delete(foodLogEntries).where(eq(foodLogEntries.id, id));
  revalidatePath("/nutrition");
  return { ok: true, message: "Removed." };
}

/**
 * Corrects a portion, and the macros of the food behind it.
 *
 * The food is rewritten in place and marked as the owner's, so `resolveMeal` keeps
 * it over any later estimate. That is deliberate and it is the reason the cache is
 * worth having: a number corrected once is corrected for every future logging of
 * that food, including the ones inside sentences not yet typed.
 */
export async function correctEntry(input: unknown): Promise<NutritionResult> {
  const parsed = correctEntrySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { entryId, quantity, perUnit } = parsed.data;
  const db = getDb();
  const { foodLogEntries, foods } = schema;

  const [entry] = await db
    .select({
      id: foodLogEntries.id,
      foodId: foodLogEntries.foodId,
      unit: foods.unit,
      kcalPerUnit: foods.kcalPerUnit,
      proteinGPerUnit: foods.proteinGPerUnit,
      carbsGPerUnit: foods.carbsGPerUnit,
      fatGPerUnit: foods.fatGPerUnit,
      fiberGPerUnit: foods.fiberGPerUnit,
    })
    .from(foodLogEntries)
    .innerJoin(foods, eq(foods.id, foodLogEntries.foodId))
    .where(eq(foodLogEntries.id, entryId))
    .limit(1);
  if (!entry) return { ok: false, message: "That entry is gone." };

  // Only macros that actually differ from the stored ones rewrite the food, so the
  // "yours" tag keeps meaning the owner changed the numbers and not just the portion.
  const edited = perUnit == null ? null : { ...perUnit, fiberG: perUnit.fiberG ?? null };
  const rewrite =
    edited !== null && !samePerUnit(edited, decodePerUnit(entry)) ? edited : null;

  if (rewrite && entry.unit === "g" && perGramImplausible(rewrite)) {
    return { ok: false, message: PER_UNIT_HINT };
  }

  await db
    .update(foodLogEntries)
    .set({ quantity: quantity.toFixed(2), updatedAt: new Date() })
    .where(eq(foodLogEntries.id, entryId));

  if (rewrite === null) {
    revalidatePath("/nutrition");
    return { ok: true, message: "Corrected." };
  }

  await db
    .update(foods)
    .set({ ...encodePerUnit(rewrite), provenance: "owner", updatedAt: new Date() })
    .where(eq(foods.id, entry.foodId));

  revalidatePath("/nutrition");
  return { ok: true, message: "Corrected, and the food is cached as you set it." };
}

/**
 * Sets the daily targets from a goal.
 *
 * The numbers are computed on the server from state read on the server, because the
 * rule that a cut waits for healthy tendons and a block that is not a peak is the
 * whole point and a client-supplied number would walk straight past it. A refused cut
 * is written as maintenance and says why, rather than failing: the owner asked a
 * reasonable question and deserves a target either way.
 */
export async function applyTargets(input: unknown): Promise<NutritionResult> {
  const parsed = setTargetsSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { goal } = parsed.data;
  const day = parsed.data.effectiveFrom ?? today();
  const db = getDb();

  const proposal = await targetInputsFor(goal, day, db);
  if (!proposal) {
    return {
      ok: false,
      message:
        "Every target is per kilogram of bodyweight, so log a weigh-in first and these will follow from it.",
    };
  }

  await closePriorTargets(day, db);
  await db.insert(schema.nutritionTargets).values({
    effectiveFrom: day,
    kcal: proposal.kcal,
    proteinG: proposal.proteinG,
    carbsG: proposal.carbsG,
    fatG: proposal.fatG,
    fluidMl: proposal.fluidMl,
    targetWeeklyChangePct: proposal.targetWeeklyChangePct.toFixed(2),
    rationale: proposal.rationale,
  });

  revalidatePath("/nutrition");
  revalidatePath("/progress");
  return {
    ok: true,
    message: proposal.cutRefusedBecause
      ? `Set at maintenance, ${proposal.kcal} kcal. A cut was declined: ${proposal.cutRefusedBecause}.`
      : `Set: ${proposal.kcal} kcal, ${proposal.proteinG} g protein.`,
  };
}

/**
 * Makes room for a target taking effect on `day`.
 *
 * A target already effective before that day is closed the day before, so the ranges
 * meet without overlapping and a past day still reads against the target it was
 * actually held to. One dated on or after that day is replaced outright: it never
 * governed a logged day, so there is no history in it to preserve.
 */
async function closePriorTargets(day: string, db: Db) {
  const { nutritionTargets } = schema;
  await db.delete(nutritionTargets).where(gte(nutritionTargets.effectiveFrom, day));
  await db
    .update(nutritionTargets)
    .set({ effectiveTo: addDays(day, -1), updatedAt: new Date() })
    .where(
      and(isNull(nutritionTargets.effectiveTo), lt(nutritionTargets.effectiveFrom, day)),
    );
}

/**
 * Re-logs a sentence that is already in the log, onto today.
 *
 * The button behind this is the point of the phrase cache made visible: yesterday's
 * breakfast, logged again, costs two selects. It goes through `logMeal` rather than
 * copying rows so the resolution takes exactly the same path as a typed repeat.
 */
export async function repeatEntry(input: unknown): Promise<NutritionResult> {
  const parsed = deleteEntrySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { foodLogEntries } = schema;
  const [row] = await getDb()
    .select({ rawText: foodLogEntries.rawText, meal: foodLogEntries.meal })
    .from(foodLogEntries)
    .where(eq(foodLogEntries.id, parsed.data.id))
    .limit(1);
  if (!row?.rawText) {
    return { ok: false, message: "That entry has no sentence behind it to repeat." };
  }
  return logMeal({ text: row.rawText, meal: row.meal, day: today() });
}
