"use server";

import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/lib/db";
import type { ActionResult } from "@/lib/log/schemas";

/**
 * Stops Today offering the guide. The guide itself stays reachable from Today's
 * header, so this only takes back the prompt, never the page.
 *
 * An upsert for the same reason as `saveProfile`: the row exists once the seed has
 * run, and a fresh database is exactly the one showing this prompt.
 */
export async function dismissGuide(): Promise<ActionResult> {
  const now = new Date();
  await getDb()
    .insert(schema.profile)
    .values({ id: 1, guideDismissedAt: now })
    .onConflictDoUpdate({
      target: schema.profile.id,
      set: { guideDismissedAt: now, updatedAt: now },
    });
  revalidatePath("/today");
  return { ok: true, message: "Dismissed. The guide is still under Guide on Today." };
}
