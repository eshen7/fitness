import type { exercises } from "@/lib/db/schema/exercises";
import type { Directory, EngineExercise } from "./types";

/**
 * The exercise directory, keyed by id, as every stage of the engine reads it.
 *
 * The engine never touches the database. The caller selects the rows and hands
 * them over through `toEngineExercise`, which is the one place the driver's
 * numeric strings become numbers, so no rule can compare `"0.140" < 0.15`.
 */

type ExerciseRow = Pick<
  typeof exercises.$inferSelect,
  | "id"
  | "slug"
  | "name"
  | "primaryMuscleGroup"
  | "secondaryMuscleGroups"
  | "movementPattern"
  | "forceVelocity"
  | "laterality"
  | "couplingClass"
  | "typicalContactSeconds"
  | "highImpact"
  | "equipment"
  | "equipmentAnyOf"
  | "loadsTendonSites"
  | "tendonLoadRating"
  | "protocolPhase"
  | "technicalComplexity"
  | "available"
>;

export function toEngineExercise(row: ExerciseRow): EngineExercise {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    primaryMuscleGroup: row.primaryMuscleGroup,
    secondaryMuscleGroups: row.secondaryMuscleGroups,
    movementPattern: row.movementPattern,
    forceVelocity: row.forceVelocity,
    laterality: row.laterality,
    couplingClass: row.couplingClass,
    typicalContactSeconds:
      row.typicalContactSeconds === null ? null : Number(row.typicalContactSeconds),
    highImpact: row.highImpact,
    equipment: row.equipment,
    equipmentAnyOf: row.equipmentAnyOf,
    loadsTendonSites: row.loadsTendonSites,
    tendonLoadRating: row.tendonLoadRating,
    protocolPhase: row.protocolPhase,
    technicalComplexity: row.technicalComplexity,
    available: row.available,
  };
}

export function directoryOf(list: Iterable<EngineExercise>): Directory {
  const map = new Map<number, EngineExercise>();
  for (const exercise of list) map.set(exercise.id, exercise);
  return map;
}

/**
 * The name to show for an id. An id the directory does not hold is exactly
 * what the closed-set check reports, so it is named rather than thrown on.
 */
export function nameOf(directory: Directory, id: number) {
  return directory.get(id)?.name ?? `Exercise ${id}`;
}
