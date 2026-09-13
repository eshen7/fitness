import { and, asc, eq, ilike, or, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export type ExerciseRow = typeof schema.exercises.$inferSelect;

export type ExerciseFilters = {
  q?: string;
  group?: ExerciseRow["primaryMuscleGroup"];
  pattern?: ExerciseRow["movementPattern"];
  forceVelocity?: ExerciseRow["forceVelocity"];
  /** Default is available only, matching what the generator is allowed to see. */
  include?: "available" | "all" | "unavailable";
};

export async function listExercises(filters: ExerciseFilters = {}) {
  const { exercises } = schema;
  const where: SQL[] = [];

  if (filters.q) {
    const like = `%${filters.q}%`;
    where.push(
      or(ilike(exercises.name, like), ilike(exercises.slug, like)) as SQL,
    );
  }
  if (filters.group) where.push(eq(exercises.primaryMuscleGroup, filters.group));
  if (filters.pattern) where.push(eq(exercises.movementPattern, filters.pattern));
  if (filters.forceVelocity) {
    where.push(eq(exercises.forceVelocity, filters.forceVelocity));
  }
  if (filters.include === "available") where.push(eq(exercises.available, true));
  if (filters.include === "unavailable") where.push(eq(exercises.available, false));

  return getDb()
    .select()
    .from(exercises)
    .where(where.length ? and(...where) : undefined)
    // Grouped by muscle group so browsing matches how a session is assembled,
    // then alphabetical within the group.
    .orderBy(asc(exercises.primaryMuscleGroup), asc(exercises.name));
}

export async function getExerciseBySlug(slug: string) {
  const [row] = await getDb()
    .select()
    .from(schema.exercises)
    .where(eq(schema.exercises.slug, slug))
    .limit(1);
  return row ?? null;
}

/** Slug and name only, for progression pickers and proposal rendering. */
export async function listExerciseOptions() {
  return getDb()
    .select({
      id: schema.exercises.id,
      slug: schema.exercises.slug,
      name: schema.exercises.name,
    })
    .from(schema.exercises)
    .orderBy(asc(schema.exercises.name));
}

export async function countExercises() {
  const rows = await getDb()
    .select({
      available: schema.exercises.available,
      isStock: schema.exercises.isStock,
    })
    .from(schema.exercises);

  return {
    total: rows.length,
    available: rows.filter((r) => r.available).length,
    unavailable: rows.filter((r) => !r.available).length,
    custom: rows.filter((r) => !r.isStock).length,
  };
}
