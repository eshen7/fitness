import { z } from "zod";
import {
  mesocycleDeclarationSchema,
  microcyclePlanSchema,
} from "@/lib/engine/types";
import {
  EQUIPMENT_TYPES,
  FORCE_VELOCITIES,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
} from "@/lib/taxonomy";

/**
 * What the model is asked to return, at each of the two generation scopes.
 *
 * The plan shapes come straight from `lib/engine/types.ts` rather than being
 * restated here, so the thing the model produces and the thing the engine
 * reviews cannot drift apart. What this file adds is the part the engine has no
 * opinion about: the rationale, the constraints the model believes it satisfied,
 * and the suggested-addition escape hatch.
 *
 * `claimedConstraints` exists to be compared against the gate report. When the
 * model claims a rule it in fact broke, that disagreement is the most useful
 * single signal for fixing the prompt, and the proposal row keeps both sides.
 */

/**
 * The directory is a closed set. When the model wants something that is not in
 * it, it files the addition here instead of inventing an exercise inline, and
 * plans around what exists in the meantime.
 */
export const exerciseSuggestionSchema = z.object({
  name: z.string(),
  /** Why the block needs it, and what it would be used for. */
  rationale: z.string(),
  primaryMuscleGroup: z.enum(MUSCLE_GROUPS),
  movementPattern: z.enum(MOVEMENT_PATTERNS),
  forceVelocity: z.enum(FORCE_VELOCITIES),
  equipment: z.array(z.enum(EQUIPMENT_TYPES)),
});
export type ExerciseSuggestion = z.infer<typeof exerciseSuggestionSchema>;

const proposalFields = {
  /** Why this plan, in the owner's terms. Shown at the top of the review. */
  rationale: z.string(),
  /**
   * One line per rule the model believes it satisfied, naming the rule and how.
   * Checked against the gate report rather than trusted.
   */
  claimedConstraints: z.array(z.string()),
  /** Exercises the directory should hold but does not. Empty is the normal case. */
  suggestedExercises: z.array(exerciseSuggestionSchema),
};

export const declarationProposalSchema = z.object({
  ...proposalFields,
  declaration: mesocycleDeclarationSchema,
});
export type DeclarationProposal = z.infer<typeof declarationProposalSchema>;

export const weekProposalSchema = z.object({
  ...proposalFields,
  week: microcyclePlanSchema,
});
export type WeekProposal = z.infer<typeof weekProposalSchema>;
