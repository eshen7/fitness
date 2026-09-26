import type { Db } from "@/lib/db";
import { BilledFailure } from "./client";
import { formatUsd, SPEND_CAP_USD } from "./pricing";
import { recordSpend, totalSpendUsd } from "./proposals";

/**
 * The four checks every live call sits behind, in one place because there is now
 * more than one kind of live call.
 *
 * A `"use server"` module may only export async functions, so these cannot live in
 * `actions.ts` and be reused from the nutrition actions. That is a mechanical
 * reason, but the substantive one is the cap: `SPEND_CAP_USD` is the owner's single
 * ceiling across generation, food parsing and the bench, and a second copy of the
 * check is a second chance to get it wrong in only one of them.
 *
 * Shaped as a refusal value rather than a thrown error, because every caller is a
 * server action whose contract is a message for the owner. Both result types are
 * `{ ok, message, errors? }`, so one guard serves both.
 */

export type Refusal = { ok: false; message: string; errors?: Record<string, string> };

/** A Zod failure as a field map, with the first message as the headline. */
export function invalid(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): Refusal {
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

/** A missing key is a configuration problem, and saying so beats a 500. */
export function keyMissing(subject: string): Refusal {
  return {
    ok: false,
    message: `${subject} needs OPENAI_API_KEY in the environment. Nothing was written.`,
  };
}

/**
 * The owner's ceiling, checked before a call rather than after.
 *
 * The total is every live call ever made, not this subject's share of it, because
 * the cap is on the account and not on the feature. A call started under the cap may
 * still end a little over it; the next one is refused.
 */
export async function capReached(db: Db, subject: string): Promise<Refusal | null> {
  const spent = await totalSpendUsd(db);
  if (spent < SPEND_CAP_USD) return null;
  return {
    ok: false,
    message: `Live calls have spent ${formatUsd(spent)} of the ${formatUsd(SPEND_CAP_USD)} cap, so ${subject.toLowerCase()} is off. Nothing was written.`,
  };
}

export function reasonOf(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}

/**
 * Puts a call that died in transport on the ledger.
 *
 * Such a call writes nothing else - no proposal, no food - but it was billed, and a
 * spend cap that forgets the failures is not a cap. Failing to record is logged
 * rather than thrown: the owner's problem is the call that failed, not the
 * bookkeeping behind it.
 */
export async function recordBilledFailure(error: unknown, label: string): Promise<void> {
  if (!(error instanceof BilledFailure)) return;
  if (!Object.values(error.usage).some((tokens) => tokens > 0)) return;
  try {
    await recordSpend({ source: "app", label, model: error.model, usage: error.usage });
  } catch (unrecorded) {
    console.error("Could not record the spend of a failed call.", unrecorded);
  }
}
