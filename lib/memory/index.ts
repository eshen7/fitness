import { hasApiKey } from "@/lib/ai/client";
import { capReached, reasonOf, recordBilledFailure } from "@/lib/ai/guards";
import { recordSpend } from "@/lib/ai/proposals";
import { getDb, type Db } from "@/lib/db";
import { databasePort } from "./queries";
import { reflect, type ReflectionResult } from "./reflect";

export * from "./embed";
export * from "./facts";
export * from "./queries";
export * from "./reflect";
export * from "./requests";
export * from "./store";

/**
 * Reflection, wired to the database and to the meter.
 *
 * The guards are the same two every live call in this app sits behind, and the reason
 * they are here rather than inside `reflect` is that `reflect` is the part with no
 * infrastructure: it takes a port and is a unit test with a scripted client. A spend
 * cap checked inside it would be a spend cap the tests have to satisfy.
 *
 * Nothing about this is worth surfacing to the owner in the moment. A reflection runs
 * after a session is finished, and the athlete's next screen is their progress, not a
 * notice that the app failed to learn something. So every failure path here logs and
 * returns a reason, and the caller is free to ignore it - which `finishSession` does.
 */
export type ReflectionRun = ReflectionResult & { ok: boolean };

const SUBJECT = "Reflection";
const SPEND_LABEL = "reflection";

export async function runReflection(
  sessionId: number,
  options: { db?: Db } = {},
): Promise<ReflectionRun> {
  const db = options.db ?? getDb();
  const empty = { outcomes: [], summary: null, usage: null, model: null };

  if (!hasApiKey()) {
    return { ...empty, ok: false, skipped: `${SUBJECT} needs OPENAI_API_KEY.` };
  }
  const capped = await capReached(db, SUBJECT);
  if (capped) return { ...empty, ok: false, skipped: capped.message };

  try {
    const result = await reflect({ sessionId, port: databasePort(db) });

    // The embeddings are already on the ledger, recorded by `embedFacts` as they were
    // bought. This is the reflection call itself, which has no proposal row behind it.
    if (result.usage && result.model) {
      await recordSpend(
        { source: "app", label: SPEND_LABEL, model: result.model, usage: result.usage },
        db,
      );
    }

    return { ...result, ok: result.skipped === null };
  } catch (error) {
    await recordBilledFailure(error, SPEND_LABEL);
    console.error(`Reflection on session ${sessionId} failed.`, error);
    return { ...empty, ok: false, skipped: `Reflection failed: ${reasonOf(error)}.` };
  }
}
