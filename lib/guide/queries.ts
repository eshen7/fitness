import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { getDb, schema } from "@/lib/db";
import type { SetupFacts } from "./steps";

export type GuideState = { facts: SetupFacts; dismissedAt: Date | null };

/**
 * What the setup checklist needs to know.
 *
 * Existence rather than counts: a step is done the moment its first row lands,
 * and a `limit 1` stops at that row.
 */
export async function loadGuideState(db: Db = getDb()): Promise<GuideState> {
  const any = async (query: PromiseLike<unknown[]>) => (await query).length > 0;
  const measured = (kind: "bodyweight" | "standing_vertical") =>
    any(
      db
        .select({ id: schema.measurements.id })
        .from(schema.measurements)
        .where(eq(schema.measurements.kind, kind))
        .limit(1),
    );

  const [[profile], hasBodyweight, hasStandingVertical, hasFoodTargets, hasBlock, hasWeek] =
    await Promise.all([
      db
        .select({
          savedAt: schema.profile.profileSavedAt,
          dismissedAt: schema.profile.guideDismissedAt,
        })
        .from(schema.profile)
        .where(eq(schema.profile.id, 1))
        .limit(1),
      measured("bodyweight"),
      measured("standing_vertical"),
      any(db.select({ id: schema.nutritionTargets.id }).from(schema.nutritionTargets).limit(1)),
      any(db.select({ id: schema.mesocycles.id }).from(schema.mesocycles).limit(1)),
      any(db.select({ id: schema.microcycles.id }).from(schema.microcycles).limit(1)),
    ]);

  return {
    facts: {
      hasSavedProfile: (profile?.savedAt ?? null) !== null,
      hasBodyweight,
      hasStandingVertical,
      hasFoodTargets,
      hasBlock,
      hasWeek,
    },
    dismissedAt: profile?.dismissedAt ?? null,
  };
}
