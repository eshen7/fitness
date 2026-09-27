import { z } from "zod";
import { MEMORY_FACT_TYPES } from "@/lib/taxonomy";

/**
 * What the memory screen is allowed to ask for.
 *
 * Separate from `actions.ts` because a `"use server"` module may only export async
 * functions, so a schema or a result type declared beside an action cannot be imported
 * by the form that submits to it. The same split as `lib/nutrition/requests.ts`.
 */

export type MemoryResult =
  | { ok: true; message: string }
  | { ok: false; message: string; errors?: Record<string, string> };

/** Deleting is retiring, and the reason is optional because usually it is just wrong. */
export const forgetFactSchema = z.object({
  id: z.coerce.number().int().positive(),
  reason: z.string().trim().max(200).optional(),
});

/**
 * Correcting means writing the owner's version as a stated fact over the inference.
 *
 * The lower bound is deliberately more than one character: a correction is a sentence
 * the generator will read cold in six months, and "no" as a memory fact is worse than
 * deleting the thing outright, which is the other button.
 */
export const correctFactSchema = z.object({
  id: z.coerce.number().int().positive(),
  body: z
    .string()
    .trim()
    .min(8, "Write the correction as a sentence.")
    .max(400, "One sentence, not a paragraph."),
});

export const confirmFactSchema = z.object({
  id: z.coerce.number().int().positive(),
});

export const stateFactSchema = z.object({
  type: z.enum(MEMORY_FACT_TYPES),
  body: z
    .string()
    .trim()
    .min(8, "Write the fact as a sentence.")
    .max(400, "One sentence, not a paragraph."),
});
