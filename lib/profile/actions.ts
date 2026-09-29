"use server";

import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/lib/db";
import { loadProfile } from "@/lib/ai/queries";
import { invalid, type ActionResult } from "@/lib/log/schemas";
import { profileRow, profileSchema } from "./form";

/**
 * Writes the single profile row.
 *
 * An upsert rather than an update, because the row only exists once the seed has
 * run, and a fresh database with no profile is exactly the one most in need of
 * this screen. Validation runs here whatever the form already checked.
 */
export async function saveProfile(input: unknown): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  const db = getDb();
  const stored = await loadProfile(db);
  const now = new Date();
  const row = { ...profileRow(parsed.data, stored), profileSavedAt: now };

  await db
    .insert(schema.profile)
    .values({ id: 1, ...row })
    .onConflictDoUpdate({
      target: schema.profile.id,
      set: { ...row, updatedAt: now },
    });

  // The unit system is read by nearly every screen, and the equipment and the
  // weekdays by the planner, so the whole app is stale rather than one page.
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved." };
}
