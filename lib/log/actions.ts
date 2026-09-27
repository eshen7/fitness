"use server";

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getDb, schema } from "@/lib/db";
import { runReflection } from "@/lib/memory";
import { getUnitSystem } from "@/lib/log/queries";
import type { ActionResult } from "@/lib/log/schemas";
import {
  bodySchema,
  readinessSchema,
  tendonSchema,
  testSchema,
} from "@/lib/log/schemas";
import type { SessionKind, TendonSite } from "@/lib/taxonomy";
import { SESSION_KINDS } from "@/lib/taxonomy";
import { today } from "@/lib/time";
import { dimensionOf, toCanonical } from "@/lib/units";

/**
 * Writes for the manual log screens.
 *
 * These take typed objects rather than `FormData`, because the forms that call
 * them hold their own state: a jump test has a variable number of attempts and a
 * tendon check-in is a grid of twelve fields, and React resets an uncontrolled
 * form once an action resolves. Validation still runs here against the same
 * schema the client used, since a client-side check is a convenience and never a
 * guarantee.
 */

function invalid(error: { issues: { path: PropertyKey[]; message: string }[] }) {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    errors[issue.path.map(String).join(".")] = issue.message;
  }
  return {
    ok: false,
    message: Object.values(errors)[0] ?? "That did not validate.",
    errors,
  };
}

/**
 * A test sitting: one row per attempt, sharing a `testGroup`.
 *
 * Every attempt is stored rather than just the best one. The within-sitting
 * spread is the measurement noise floor, and the minimal detectable change drawn
 * on the jump chart comes from it; keeping only the best attempt would make the
 * chart's error band unknowable.
 */
export async function logTest(input: unknown): Promise<ActionResult> {
  const parsed = testSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { kind, attempts, boxHeight, notes } = parsed.data;

  if (kind === "depth_jump_vertical" && boxHeight === undefined) {
    return {
      ok: false,
      message:
        "A depth jump needs its drop height: calibration fits jump height against box height, and an attempt without one cannot join that curve.",
      errors: { boxHeight: "Enter the drop height." },
    };
  }

  const system = await getUnitSystem();
  const dimension = dimensionOf(kind);
  const testGroup = randomUUID();
  const measuredAt = new Date();

  await getDb()
    .insert(schema.measurements)
    .values(
      attempts.map((value, index) => ({
        kind,
        value: toCanonical(value, dimension, system).toFixed(2),
        unit: "cm",
        boxHeightCm:
          boxHeight === undefined
            ? null
            : toCanonical(boxHeight, "length", system).toFixed(1),
        measuredAt,
        testGroup,
        attempt: index + 1,
        source: "manual" as const,
        // The note belongs to the sitting, so it goes on the first attempt only
        // rather than being repeated onto every row.
        notes: index === 0 ? notes : null,
      })),
    );

  revalidatePath("/log");
  revalidatePath("/progress");
  return {
    ok: true,
    message: `Logged ${attempts.length} ${attempts.length === 1 ? "attempt" : "attempts"}.`,
  };
}

export async function logBodyValue(input: unknown): Promise<ActionResult> {
  const parsed = bodySchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { kind, value, notes } = parsed.data;

  const system = await getUnitSystem();
  const dimension = dimensionOf(kind);

  await getDb()
    .insert(schema.measurements)
    .values({
      kind,
      value: toCanonical(value, dimension, system).toFixed(2),
      unit: dimension === "mass" ? "kg" : dimension === "percent" ? "%" : "cm",
      measuredAt: new Date(),
      source: "manual",
      notes,
    });

  revalidatePath("/log");
  revalidatePath("/progress");
  return { ok: true, message: "Logged." };
}

/**
 * A tendon check-in writes one row per site that was answered.
 *
 * A site is either fully answered or skipped, never partly. The pre-filter and the
 * pain-to-load lag both read these rows as measurements, so a blank stored as a
 * zero would be a fabricated data point in the one series where a false "no pain"
 * is the expensive direction to be wrong in. Answering all three is one tap
 * through the form's all-clear shortcut, so the strictness costs nothing.
 */
export async function logTendonCheckin(input: unknown): Promise<ActionResult> {
  const parsed = tendonSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { sites, notes } = parsed.data;

  const recordedAt = new Date();
  const rows: {
    site: TendonSite;
    recordedAt: Date;
    painDuringLoad: number;
    painAfterLoad: number;
    morningStiffness: number;
    protocolPhase: number | null;
    notes: string | null;
  }[] = [];

  for (const [site, values] of Object.entries(sites)) {
    const { painDuringLoad, painAfterLoad, morningStiffness } = values;
    const answered = [painDuringLoad, painAfterLoad, morningStiffness].filter(
      (score) => score !== undefined,
    ).length;
    if (answered === 0) continue;
    if (answered < 3) {
      return {
        ok: false,
        message:
          "Answer all three scores for a site, or leave the site blank. A missing score would be stored as a zero, and a fabricated \"no pain\" is the expensive direction to be wrong in.",
        errors: { [site]: "Incomplete." },
      };
    }
    rows.push({
      site: site as TendonSite,
      recordedAt,
      painDuringLoad: painDuringLoad as number,
      painAfterLoad: painAfterLoad as number,
      morningStiffness: morningStiffness as number,
      protocolPhase: values.protocolPhase,
      notes,
    });
  }

  if (rows.length === 0) {
    return { ok: false, message: "Nothing to record: every site was left blank." };
  }

  await getDb().insert(schema.tendonStatus).values(rows);

  revalidatePath("/log");
  revalidatePath("/progress");

  const gated = rows.filter(
    (row) => row.protocolPhase !== null && row.protocolPhase <= 2,
  );
  return {
    ok: true,
    message: gated.length
      ? `Recorded. ${gated.length === 1 ? "One site is" : `${gated.length} sites are`} in protocol phase 1 or 2, so exercises loading ${gated.length === 1 ? "it" : "them"} leave the candidate set, apart from the protocol's own prescriptions, until that changes.`
      : "Recorded.",
  };
}

/** One check-in per day, so a correction replaces rather than duplicates. */
export async function logReadiness(input: unknown): Promise<ActionResult> {
  const parsed = readinessSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { soreness, motivation, priorSessionRpe, notes } = parsed.data;

  const sorenessByRegion: Record<string, number> = {};
  for (const [region, score] of Object.entries(soreness)) {
    if (score !== undefined) sorenessByRegion[region] = score;
  }

  const values = {
    day: today(),
    sorenessByRegion,
    motivation,
    priorSessionRpe: priorSessionRpe?.toFixed(1),
    notes,
  };

  await getDb()
    .insert(schema.readinessCheckins)
    .values(values)
    .onConflictDoUpdate({
      target: schema.readinessCheckins.day,
      set: { ...values, updatedAt: new Date() },
    });

  revalidatePath("/log");
  revalidatePath("/today");
  return { ok: true, message: "Checked in." };
}

/**
 * Opens an ad-hoc session: training that is happening without a generated plan
 * behind it. Idempotent for the day, so tapping start twice does not split one
 * workout across two sessions.
 */
export async function startAdHocSession(
  kind: string,
): Promise<ActionResult & { sessionId?: number }> {
  if (!SESSION_KINDS.includes(kind as SessionKind)) {
    return { ok: false, message: "Unknown session kind." };
  }

  const db = getDb();
  const day = today();
  const [existing] = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.day, day),
        isNull(schema.sessions.completedAt),
        isNull(schema.sessions.skippedAt),
      ),
    )
    .limit(1);

  if (existing) {
    return { ok: true, message: "Session already open.", sessionId: existing.id };
  }

  const [row] = await db
    .insert(schema.sessions)
    .values({ day, kind: kind as SessionKind, startedAt: new Date() })
    .returning({ id: schema.sessions.id });

  revalidatePath("/log");
  return { ok: true, message: "Session open.", sessionId: row.id };
}

export async function finishSession(
  sessionId: number,
  rpe: number | null,
  notes: string | null,
): Promise<ActionResult> {
  if (rpe !== null && (!Number.isFinite(rpe) || rpe < 1 || rpe > 10)) {
    return { ok: false, message: "Session RPE runs from 1 to 10." };
  }

  await getDb()
    .update(schema.sessions)
    .set({
      completedAt: new Date(),
      reportedRpe: rpe === null ? null : rpe.toFixed(1),
      notes,
      updatedAt: new Date(),
    })
    .where(eq(schema.sessions.id, sessionId));

  // After the response, never before it. Reflection is a model call, and the athlete
  // tapping "finish" is standing in a gym: a second or two of spinner to learn
  // something about them next month is the wrong trade. `after` also means a failed
  // reflection cannot fail the close, which matters because the close is the write
  // that must not be lost - `/api/reflect` can run the reflection again, and nothing
  // can re-close a session the athlete has walked away from.
  after(async () => {
    const result = await runReflection(sessionId);
    if (result.skipped) console.warn(`Reflection skipped: ${result.skipped}`);
  });

  revalidatePath("/log");
  revalidatePath("/progress");
  return { ok: true, message: "Session closed." };
}

/**
 * Removes a mis-tapped set. A set is cheap to enter again and a wrong one is not:
 * it lands in weekly volume, in the contact count, and in every trend fitted to
 * either.
 */
export async function deleteLoggedSet(id: number): Promise<ActionResult> {
  await getDb().delete(schema.loggedSets).where(eq(schema.loggedSets.id, id));
  revalidatePath("/log");
  return { ok: true, message: "Set removed." };
}
