import { getDb, type Db } from "@/lib/db";
import { getAiClient } from "@/lib/ai/client";
import { recordSpend } from "@/lib/ai/proposals";
import { capReached, recordBilledFailure } from "@/lib/ai/guards";

/**
 * Turning fact sentences into vectors, on the meter.
 *
 * Every live call in this app is billed against one ceiling - `SPEND_CAP_USD`, the
 * owner's ten dollars across generation, food parsing, the bench and now this - so an
 * embedding bought outside the ledger is a hole in the cap rather than a rounding
 * error. `totalSpendUsd` sums `plan_proposals` and `spend_ledger`, and an embedding
 * has no proposal behind it, so it goes on the ledger.
 *
 * The cost is genuinely small: a fact is one sentence, and `text-embedding-3-small`
 * is two cents a million tokens, so the whole store re-embeds for a fraction of a
 * cent. That is an argument for recording it, not for skipping it. A cap that only
 * counts the expensive calls is a cap that stops working the moment something cheap
 * runs in a loop.
 *
 * One batch per call, because per-request overhead dwarfs the tokens when the inputs
 * are single sentences.
 */

/** What an embedding call costs, so a caller can decide not to make it. */
export const EMBED_LABEL = "memory embedding";

/**
 * Embeds a batch and puts the spend on the ledger.
 *
 * An empty batch short-circuits without a call, which is the common path: most
 * reflections propose no facts, and "nothing to embed" must cost nothing. A batch
 * over the cap throws before the call, like any other live call past it.
 *
 * Recording is awaited rather than fired off, because the next thing the caller does
 * is usually write the facts, and a ledger row that lost a race with a crash is spend
 * the cap will never see again.
 */
export async function embedFacts(
  texts: readonly string[],
  options: { db?: Db; label?: string } = {},
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const label = options.label ?? EMBED_LABEL;
  const db = options.db ?? getDb();

  const capped = await capReached(db, "Memory embedding");
  if (capped) throw new Error(capped.message);

  try {
    const result = await getAiClient().embed({ texts, label });
    await recordSpend({ source: "app", label, model: result.model, usage: result.usage }, db);
    return result.vectors;
  } catch (error) {
    // A `BilledFailure` may still have been billed. `recordBilledFailure` only
    // writes when the usage is nonzero, so the ordinary "connection refused" case
    // adds no row.
    await recordBilledFailure(error, label, db);
    throw error;
  }
}

/**
 * One text, or null when the embedding could not be had.
 *
 * Null rather than a throw, because every caller of this is a write of the owner's own
 * words that should still happen: a stated fact with no vector cannot be deduplicated,
 * which is far better than a correction lost because the embeddings endpoint was
 * having a bad afternoon. Inferences are held to more: `uncheckedAgainstStated` in
 * `lib/memory/facts.ts` drops any that cannot be compared against a stated fact.
 */
export async function embedOne(
  text: string,
  options: { db?: Db; label?: string } = {},
): Promise<number[] | null> {
  try {
    const [vector] = await embedFacts([text], options);
    return vector ?? null;
  } catch (error) {
    console.error("Could not embed a memory fact; storing it without a vector.", error);
    return null;
  }
}
