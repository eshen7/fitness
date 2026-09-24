"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/lib/db";
import {
  type FormState,
  parseExerciseForm,
  readExerciseForm,
  slugify,
} from "./form";

/**
 * Library mutations.
 *
 * Nothing here deletes an exercise. Availability is a toggle instead, because a
 * logged set references the exercise it was performed on and losing that row
 * would rewrite training history to remove work that actually happened. An
 * unavailable exercise is invisible to the generator, which is the whole point of
 * the flag, so disabling is already the useful outcome.
 */

function fieldErrors(error: {
  issues: { path: (string | number | symbol)[]; message: string }[];
}) {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : "_form";
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
}

/** Shared shape for the create and update paths. */
function toRow(values: ReturnType<typeof parseExerciseForm> & { success: true }) {
  const v = values.data;
  return {
    name: v.name,
    primaryMuscleGroup: v.primaryMuscleGroup,
    secondaryMuscleGroups: v.secondaryMuscleGroups,
    movementPattern: v.movementPattern,
    forceVelocity: v.forceVelocity,
    laterality: v.laterality,
    plane: v.plane,
    couplingClass: v.couplingClass,
    typicalContactSeconds:
      v.typicalContactSeconds === undefined
        ? null
        : v.typicalContactSeconds.toFixed(3),
    highImpact: v.highImpact,
    equipment: v.equipment,
    equipmentAnyOf: v.equipmentAnyOf,
    loadsTendonSites: v.loadsTendonSites,
    tendonLoadRating: v.tendonLoadRating,
    protocolPhase: v.protocolPhase,
    technicalComplexity: v.technicalComplexity,
    cues: v.cues,
    notes: v.notes,
  };
}

export async function createExercise(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const fields = readExerciseForm(formData);
  const parsed = parseExerciseForm(fields);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Fix the highlighted fields.",
      errors: fieldErrors(parsed.error),
      fields,
    };
  }

  const slug = parsed.data.slug ?? slugify(parsed.data.name);
  if (!slug) {
    return {
      ok: false,
      message: "Fix the highlighted fields.",
      errors: { name: ["That name does not produce a usable slug."] },
      fields,
    };
  }

  const [existing] = await getDb()
    .select({ slug: schema.exercises.slug })
    .from(schema.exercises)
    .where(eq(schema.exercises.slug, slug))
    .limit(1);
  if (existing) {
    return {
      ok: false,
      message: "Fix the highlighted fields.",
      errors: {
        slug: [
          `\`${slug}\` already exists. Edit that entry, or give this one a distinct slug.`,
        ],
      },
      fields,
    };
  }

  await getDb()
    .insert(schema.exercises)
    // Available on creation: the owner is adding it because they can do it.
    .values({ ...toRow(parsed), slug, isStock: false, available: true });

  revalidatePath("/library");
  redirect(`/library/${slug}`);
}

export async function updateExercise(
  slug: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const fields = readExerciseForm(formData);
  const parsed = parseExerciseForm(fields);
  if (!parsed.success) {
    return {
      ok: false,
      message: "Fix the highlighted fields.",
      errors: fieldErrors(parsed.error),
      fields,
    };
  }

  const updated = await getDb()
    .update(schema.exercises)
    // The slug is intentionally immutable: it is the key the seed file, the
    // generator's candidate set, and any existing prescription all refer to.
    .set({ ...toRow(parsed), updatedAt: new Date() })
    .where(eq(schema.exercises.slug, slug))
    .returning({ slug: schema.exercises.slug });

  if (updated.length === 0) {
    return { ok: false, message: "That exercise no longer exists.", fields };
  }

  revalidatePath("/library");
  revalidatePath(`/library/${slug}`);
  // The saved fields go back too: React resets the form after the action, and
  // re-rendering from the stale server row would flash the old values.
  return { ok: true, message: "Saved.", fields };
}

export async function setExerciseAvailability(slug: string, available: boolean) {
  await getDb()
    .update(schema.exercises)
    .set({ available, updatedAt: new Date() })
    .where(eq(schema.exercises.slug, slug));

  revalidatePath("/library");
  revalidatePath(`/library/${slug}`);
}
