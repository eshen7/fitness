import { z } from "zod";
import { microcyclePlanSchema } from "@/lib/engine/types";
import { MESOCYCLE_TYPES } from "@/lib/taxonomy";

/**
 * What the review UI sends the server, and what it gets back.
 *
 * Separate from `actions.ts` because that module is `"use server"` and a client
 * component importing a type out of it would pull the whole server bundle along.
 * Separate from `schemas.ts` because these describe requests from the owner, and
 * conflating them with what the model is asked to return is how a field the owner
 * controls ends up in the model's schema.
 */

export type GenerationResult = {
  ok: boolean;
  message: string;
  /** Present whenever a proposal row was written, passing or not. */
  proposalId?: number;
  errors?: Record<string, string>;
};

const isoDay = z.iso.date();

export const declareBlockSchema = z.object({
  startDate: isoDay,
  /** 2 to 6 microcycles, per the ebook. The model picks within the ask. */
  weeks: z.number().int().min(2).max(6),
  /** A hint from the owner: an upcoming trip, a sore knee, a peak to hit. */
  note: z.string().trim().max(1000).nullish(),
  /** Steers the declaration without forcing it; the gate still rules. */
  preferredType: z.enum(MESOCYCLE_TYPES).nullish(),
});
export type DeclareBlockInput = z.input<typeof declareBlockSchema>;

export const generateWeekSchema = z.object({
  mesocycleId: z.number().int().positive(),
  /** Defaults to the day after the last generated week ends. */
  startDate: isoDay.nullish(),
  note: z.string().trim().max(1000).nullish(),
  /** Set when this replaces a proposal the owner did not want. */
  supersedesId: z.number().int().positive().nullish(),
});
export type GenerateWeekInput = z.input<typeof generateWeekSchema>;

export const acceptSchema = z.object({
  proposalId: z.number().int().positive(),
  /** The whole plan as the owner edited it. Omitted means accept as proposed. */
  editedWeek: microcyclePlanSchema.nullish(),
});
export type AcceptInput = z.input<typeof acceptSchema>;

export const rejectSchema = z.object({
  proposalId: z.number().int().positive(),
  /**
   * Required, and with a floor, because the reason is carried into every later
   * generation. "No" teaches nothing; "too much shock work on a sore knee" is the
   * strongest steer the generator has before the memory layer exists.
   */
  reason: z.string().trim().min(4, "Say why, in a few words at least."),
});
export type RejectInput = z.input<typeof rejectSchema>;
