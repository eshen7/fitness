"use server";

import { revalidatePath } from "next/cache";
import { invalid } from "@/lib/ai/guards";
import { getDb } from "@/lib/db";
import { embedOne } from "./embed";
import {
  confirmFactSchema,
  correctFactSchema,
  forgetFactSchema,
  stateFactSchema,
  type MemoryResult,
} from "./requests";
import { confirmFact, correctFact, retireFact, stateFact } from "./store";

/**
 * The owner's four buttons on the memory screen.
 *
 * The plan's position on memory is that inferred facts commit themselves and safety
 * comes from reversibility rather than from asking first, with two exceptions that do
 * ask. These actions are the other half of that bargain: if a fact can appear without
 * permission, undoing it has to be one tap, and it has to be one tap from the same
 * screen that shows the fact. Anything slower makes the auto-commit indefensible.
 *
 * Every one of them revalidates `/plan` as well as `/plan/memory`, because the facts
 * are in the generator's prompt and the plan page is where the next generation is
 * started. A stale count beside that button is the one place a memory edit could look
 * like it did not take.
 */

function revalidate() {
  revalidatePath("/plan/memory");
  revalidatePath("/plan");
}

/**
 * Deletes a fact.
 *
 * Retired, not removed: the row stays so the feed can show that the app inferred
 * something and was told otherwise. That trail is the only evidence anyone will ever
 * have about whether reflection earns its keep, and it costs a boolean column.
 */
export async function forgetFactAction(input: unknown): Promise<MemoryResult> {
  const parsed = forgetFactSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  await retireFact({
    id: parsed.data.id,
    reason: parsed.data.reason?.length ? parsed.data.reason : "Deleted by the athlete.",
  });
  revalidate();
  return { ok: true, message: "Forgotten." };
}

/**
 * Replaces a fact with the owner's own wording.
 *
 * The new fact is embedded before it is written, so it can supersede paraphrases of
 * itself later; a failed embedding stores it bare rather than refusing the correction,
 * which is `embedOne`'s whole reason for returning null.
 */
export async function correctFactAction(input: unknown): Promise<MemoryResult> {
  const parsed = correctFactSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const embedding = await embedOne(parsed.data.body, { db: getDb() });
  try {
    await correctFact({ id: parsed.data.id, body: parsed.data.body, embedding });
  } catch (error) {
    console.error("Could not correct a memory fact.", error);
    return { ok: false, message: "That fact is gone, so there was nothing to correct." };
  }

  revalidate();
  return { ok: true, message: "Corrected, and it now counts as something you said." };
}

/**
 * Approves a held fact, which is also when the supersession it was carrying lands.
 *
 * Idempotent on purpose. A second tap finds the row already confirmed, changes
 * nothing, and still says yes, because the alternative is an error message for a
 * double-tap on a phone.
 */
export async function confirmFactAction(input: unknown): Promise<MemoryResult> {
  const parsed = confirmFactSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  await confirmFact({ id: parsed.data.id });
  revalidate();
  return { ok: true, message: "Approved. The planner can see it now." };
}

/**
 * Records something the owner typed themselves.
 *
 * Confirmed on arrival whatever it says, including the tendon and retirement cases the
 * gate holds back for inferences. The gate exists because a guess about tendon load
 * should not act unasked; a person typing one is the asking.
 */
export async function stateFactAction(input: unknown): Promise<MemoryResult> {
  const parsed = stateFactSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const embedding = await embedOne(parsed.data.body, { db: getDb() });
  await stateFact({ type: parsed.data.type, body: parsed.data.body, embedding });
  revalidate();
  return { ok: true, message: "Remembered." };
}
