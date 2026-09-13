import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/lib/db";
import { loggedSetBatchSchema, loggedSetSchema } from "@/lib/log/schemas";

/**
 * Receiver for the offline set queue.
 *
 * Every set is validated on its own and answered for on its own: `accepted` leaves
 * the client's queue because it landed, `rejected` leaves it because no retry will
 * ever help, and anything absent from both stays queued. A batch that failed as a
 * unit would mean one malformed set from an older build could block a whole
 * session's worth of good ones forever.
 *
 * Idempotency is the unique index on `client_id`, so a queue that flushes twice,
 * or from two tabs, writes once.
 */

type Row = typeof schema.loggedSets.$inferInsert;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const batch = loggedSetBatchSchema.safeParse(body);
  if (!batch.success) {
    return Response.json({ error: "Expected a batch of sets." }, { status: 400 });
  }

  const accepted: string[] = [];
  const rejected: { clientId: string; message: string }[] = [];
  const rows: Row[] = [];

  for (const [index, raw] of batch.data.sets.entries()) {
    const parsed = loggedSetSchema.safeParse(raw);
    if (!parsed.success) {
      // Without a usable clientId there is nothing the client can retire, so the
      // index is echoed back instead and the item is named for what it is.
      const clientId =
        typeof raw === "object" && raw !== null && "clientId" in raw
          ? String((raw as { clientId: unknown }).clientId)
          : `unknown:${index}`;
      rejected.push({
        clientId,
        message: parsed.error.issues[0]?.message ?? "Invalid set.",
      });
      continue;
    }
    const set = parsed.data;
    rows.push({
      clientId: set.clientId,
      sessionId: set.sessionId,
      exerciseId: set.exerciseId,
      prescribedSetId: set.prescribedSetId ?? null,
      setIndex: set.setIndex,
      reps: set.reps ?? null,
      holdSeconds: set.holdSeconds?.toFixed(1) ?? null,
      loadKg: set.loadKg?.toFixed(2) ?? null,
      boxHeightCm: set.boxHeightCm?.toFixed(1) ?? null,
      rpe: set.rpe?.toFixed(1) ?? null,
      qualityRating: set.qualityRating ?? null,
      performedAt: new Date(set.performedAt),
      notes: set.notes ?? null,
    });
  }

  const db = getDb();
  const sessionIds = new Set<number>();

  if (rows.length) {
    try {
      await db
        .insert(schema.loggedSets)
        .values(rows)
        .onConflictDoNothing({ target: schema.loggedSets.clientId });
      for (const row of rows) {
        accepted.push(row.clientId!);
        sessionIds.add(row.sessionId);
      }
    } catch {
      // One bad foreign key fails the whole statement, so fall back to writing
      // them individually to find out which set is actually the problem.
      for (const row of rows) {
        try {
          await db
            .insert(schema.loggedSets)
            .values(row)
            .onConflictDoNothing({ target: schema.loggedSets.clientId });
          accepted.push(row.clientId!);
          sessionIds.add(row.sessionId);
        } catch (error) {
          rejected.push({
            clientId: row.clientId!,
            message:
              error instanceof Error && /foreign key/i.test(error.message)
                ? "That session or exercise no longer exists."
                : "The server could not store this set.",
          });
        }
      }
    }
  }

  for (const id of sessionIds) revalidatePath(`/log/session/${id}`);
  if (accepted.length) {
    revalidatePath("/log");
    revalidatePath("/progress");
  }

  return Response.json({ accepted, rejected });
}
