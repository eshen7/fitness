import { STOCK_EXERCISES } from "@/lib/db/seed/exercises";
import { EQUIPMENT_TYPES } from "@/lib/taxonomy";
import { directoryOf } from "../directory";
import type { EngineExercise } from "../types";

/**
 * The stock directory as the engine sees it, with ids assigned in seed order.
 *
 * Fixtures run against the real stock attributes rather than hand-written
 * stand-ins, so a re-tag in the seed that changes an outcome shows up here as a
 * failing message instead of passing against data nobody ships.
 */

export const STOCK: readonly EngineExercise[] = STOCK_EXERCISES.map((seed, index) => ({
  id: index + 1,
  slug: seed.slug,
  name: seed.name,
  primaryMuscleGroup: seed.primaryMuscleGroup,
  secondaryMuscleGroups: seed.secondaryMuscleGroups ?? [],
  movementPattern: seed.movementPattern,
  forceVelocity: seed.forceVelocity,
  laterality: seed.laterality,
  couplingClass: seed.couplingClass ?? "not_plyometric",
  typicalContactSeconds:
    seed.typicalContactSeconds == null ? null : Number(seed.typicalContactSeconds),
  highImpact: seed.highImpact ?? false,
  equipment: seed.equipment ?? [],
  equipmentAnyOf: seed.equipmentAnyOf ?? [],
  loadsTendonSites: seed.loadsTendonSites ?? [],
  tendonLoadRating: seed.tendonLoadRating ?? 1,
  protocolPhase: seed.protocolPhase ?? null,
  technicalComplexity: seed.technicalComplexity ?? 1,
  available: seed.available ?? true,
}));

export const DIRECTORY = directoryOf(STOCK);

const BY_SLUG = new Map(STOCK.map((exercise) => [exercise.slug, exercise]));

/** The id of a stock exercise. Throws on a typo, so a fixture cannot silently miss. */
export function idOf(slug: string) {
  const exercise = BY_SLUG.get(slug);
  if (!exercise) throw new Error(`No stock exercise with slug "${slug}".`);
  return exercise.id;
}

export function exerciseOf(slug: string) {
  return DIRECTORY.get(idOf(slug))!;
}

/** Every piece of equipment, so only the rule under test removes anything. */
export const FULL_GYM = EQUIPMENT_TYPES.filter((item) => item !== "none");
