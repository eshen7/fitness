import { z } from "zod";
import type { Db } from "@/lib/db";
import { isPlyometric } from "@/lib/engine/classify";
import type { EngineExercise } from "@/lib/engine/types";
import {
  FORCE_VELOCITIES,
  MOVEMENT_PATTERNS,
  MUSCLE_GROUPS,
  TENDON_SITES,
} from "@/lib/taxonomy";
import { dayOf } from "@/lib/time";
import type { AiTool } from "./client";
import type { GenerationContext } from "./context";
import {
  loadPriorProposals,
  loadReadiness,
  loadRecentVolume,
  loadTendonReadings,
} from "./queries";

/**
 * The read-only lookups the model may call. Nothing here writes.
 *
 * The candidate table is already in the prompt, so these exist for the questions
 * a table cannot answer: what the athlete has actually been doing, how a tendon
 * has moved over weeks rather than at its last reading, and what happened to the
 * last few proposals. The directory search is here too, because asking for the
 * eight eligible hinge patterns is cheaper and less error-prone than re-reading
 * three hundred rows.
 *
 * Every search is restricted to the pre-filtered candidate set. A tool that could
 * surface an excluded exercise would route around the pre-filter, which is the one
 * mechanism making tendon safety absolute rather than merely checked.
 */

/** Rows per search. Enough to choose from, small enough not to reprint the table. */
const SEARCH_LIMIT = 40;

function summarize(exercise: EngineExercise) {
  return {
    id: exercise.id,
    name: exercise.name,
    primaryMuscleGroup: exercise.primaryMuscleGroup,
    secondaryMuscleGroups: exercise.secondaryMuscleGroups,
    movementPattern: exercise.movementPattern,
    forceVelocity: exercise.forceVelocity,
    laterality: exercise.laterality,
    couplingClass: exercise.couplingClass,
    typicalContactSeconds: exercise.typicalContactSeconds,
    highImpact: exercise.highImpact,
    loadsTendonSites: exercise.loadsTendonSites,
    tendonLoadRating: exercise.tendonLoadRating,
    technicalComplexity: exercise.technicalComplexity,
  };
}

const findExercisesParams = z.object({
  primaryMuscleGroup: z.enum(MUSCLE_GROUPS).nullish(),
  movementPattern: z.enum(MOVEMENT_PATTERNS).nullish(),
  forceVelocity: z.enum(FORCE_VELOCITIES).nullish(),
  /** True for plyometrics only, false to exclude them, null for either. */
  plyometric: z.boolean().nullish(),
  /** Highest tendon load rating, 1 to 5, to include. */
  maxTendonLoad: z.number().int().min(1).max(5).nullish(),
  /** Highest technical complexity, 1 to 5, to include. */
  maxTechnicalComplexity: z.number().int().min(1).max(5).nullish(),
});

const daysParams = z.object({
  days: z.number().int().min(1).max(365).nullish(),
});

export function buildTools(context: GenerationContext, db?: Db): AiTool[] {
  return [
    {
      name: "find_exercises",
      description: `Search the candidate exercise set by attribute. Returns at most ${SEARCH_LIMIT} matches with their ids. Omit a field to leave that attribute unconstrained.`,
      parameters: findExercisesParams,
      run: async (args: z.infer<typeof findExercisesParams>) => {
        const matches = context.prefiltered.candidates.filter((exercise) => {
          if (args.primaryMuscleGroup && exercise.primaryMuscleGroup !== args.primaryMuscleGroup)
            return false;
          if (args.movementPattern && exercise.movementPattern !== args.movementPattern)
            return false;
          if (args.forceVelocity && exercise.forceVelocity !== args.forceVelocity) return false;
          if (args.plyometric != null && isPlyometric(exercise) !== args.plyometric) return false;
          if (args.maxTendonLoad != null && exercise.tendonLoadRating > args.maxTendonLoad)
            return false;
          if (
            args.maxTechnicalComplexity != null &&
            exercise.technicalComplexity > args.maxTechnicalComplexity
          )
            return false;
          return true;
        });
        return {
          total: matches.length,
          truncated: matches.length > SEARCH_LIMIT,
          exercises: matches.slice(0, SEARCH_LIMIT).map(summarize),
        };
      },
    },
    {
      name: "recent_volume",
      description:
        "Logged sets and high-impact contacts over a window, grouped by primary muscle group and movement pattern.",
      parameters: daysParams,
      run: async (args: z.infer<typeof daysParams>) => ({
        days: args.days ?? 28,
        rows: await loadRecentVolume(args.days ?? 28, db),
      }),
    },
    {
      name: "tendon_history",
      description:
        "Tendon check-ins over a window, newest last, optionally for one site. Pain and function only; this app never records structure.",
      parameters: z.object({
        days: z.number().int().min(1).max(365).nullish(),
        site: z.enum(TENDON_SITES).nullish(),
      }),
      run: async (args: { days?: number | null; site?: string | null }) => {
        const readings = await loadTendonReadings(args.days ?? 28, db);
        return {
          readings: readings
            .filter((reading) => !args.site || reading.site === args.site)
            .map((reading) => ({
              site: reading.site,
              day: dayOf(reading.recordedAt),
              painDuringLoad: reading.painDuringLoad,
              painAfterLoad: reading.painAfterLoad,
              morningStiffness: reading.morningStiffness,
              protocolPhase: reading.protocolPhase,
            })),
        };
      },
    },
    {
      name: "readiness_history",
      description:
        "Morning check-ins over a window, oldest first: recovery, HRV, sleep, strain, motivation, soreness and notes.",
      parameters: daysParams,
      run: async (args: z.infer<typeof daysParams>) => ({
        days: args.days ?? 14,
        checkins: await loadReadiness(args.days ?? 14, db),
      }),
    },
    {
      name: "prior_proposals",
      description:
        "Recent plan proposals, the verdict the athlete gave each one, the reason, and any gate failures.",
      parameters: z.object({
        limit: z.number().int().min(1).max(20).nullish(),
      }),
      run: async (args: { limit?: number | null }) => ({
        proposals: (await loadPriorProposals(args.limit ?? 8, db)).map((proposal) => ({
          ...proposal,
          createdAt: proposal.createdAt.toISOString(),
        })),
      }),
    },
  ];
}
