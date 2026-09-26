"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema, type Db } from "@/lib/db";
import { addDays } from "@/lib/days";
import { reviewWeek } from "@/lib/engine";
import { microcyclePlanSchema, type MicrocyclePlan } from "@/lib/engine/types";
import { mesocycleTypeLabels } from "@/lib/labels";
import { BilledFailure, hasApiKey } from "./client";
import { loadContext } from "./context";
import { diffWeeks } from "./edits";
import { generateDeclaration, generateWeek } from "./generate";
import {
  acceptDeclaration,
  acceptWeek,
  rejectProposal,
  saveProposal,
} from "./persist";
import { formatUsd, SPEND_CAP_USD } from "./pricing";
import {
  loadProposalById,
  nextBlockOrdinal,
  nextWeekSlot,
  recordSpend,
  totalSpendUsd,
} from "./proposals";
import { loadOpenBlock } from "./queries";
import {
  acceptSchema,
  declareBlockSchema,
  generateWeekSchema,
  rejectSchema,
  type GenerationResult,
} from "./requests";

/**
 * The four things the owner can do with the generator: declare a block, generate
 * or regenerate a week, accept a proposal, reject one.
 *
 * Every one of them validates its input again here. The review screen holds its
 * own state and validates as it goes, which is a convenience and never a
 * guarantee, and accepting an edited week in particular is a write of whatever
 * shape the client sent.
 *
 * Generating is slow - a model call plus up to three repairs - so these are
 * actions rather than route handlers with a redirect: the button can show its own
 * pending state for as long as it takes, and a proposal row is written whether or
 * not the loop converged.
 */

function invalid(error: {
  issues: { path: PropertyKey[]; message: string }[];
}): GenerationResult {
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
function keyMissing(): GenerationResult {
  return {
    ok: false,
    message:
      "Generation needs OPENAI_API_KEY in the environment. Nothing was written.",
  };
}

/**
 * The owner's ceiling, checked before a call rather than after. A generation
 * started under the cap may still end a little over it; the next one is refused.
 */
async function capReached(db: Db): Promise<GenerationResult | null> {
  const spent = await totalSpendUsd(db);
  if (spent < SPEND_CAP_USD) return null;
  return {
    ok: false,
    message: `Generation has spent ${formatUsd(spent)} of the ${formatUsd(SPEND_CAP_USD)} cap, so it is off. Nothing was written.`,
  };
}

function failed(error: unknown): GenerationResult {
  return {
    ok: false,
    message: `Generation failed: ${error instanceof Error ? error.message : "unknown error"}. Nothing was written.`,
  };
}

/**
 * A generation that died in transport saves no proposal, but it was billed, so its
 * usage goes on the ledger before the failure is reported.
 */
async function generationFailed(error: unknown, label: string): Promise<GenerationResult> {
  if (error instanceof BilledFailure && Object.values(error.usage).some((n) => n > 0)) {
    try {
      await recordSpend({ source: "app", label, model: error.model, usage: error.usage });
    } catch (unrecorded) {
      console.error("Could not record the spend of a failed generation.", unrecorded);
    }
  }
  return failed(error);
}

// -----------------------------------------------------------------------------

/**
 * Declares a block: type, targets, technical focus and the stable complex.
 *
 * The owner's preferred type is passed as a preference rather than as the value,
 * because the declaration has to satisfy the block-scope gate rules and a forced
 * type that cannot carry two targets would fail every attempt.
 */
export async function declareBlock(input: unknown): Promise<GenerationResult> {
  const parsed = declareBlockSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  if (!hasApiKey()) return keyMissing();
  const { startDate, weeks, note, preferredType } = parsed.data;

  try {
    const db = getDb();
    const refused = await capReached(db);
    if (refused) return refused;
    const context = await loadContext({ db, mesocycleId: null });
    const run = await generateDeclaration({
      context,
      ordinal: await nextBlockOrdinal(db),
      startDate,
      weeks,
      note: [
        preferredType
          ? `The athlete would prefer ${mesocycleTypeLabels.of(preferredType)}, if the targets and the complex work out under that type.`
          : null,
        note ?? null,
      ]
        .filter(Boolean)
        .join("\n"),
      db,
    });

    const proposalId = await saveProposal({ run, db });
    revalidatePath("/plan");
    return {
      ok: run.passed,
      proposalId,
      message: run.passed
        ? "Block proposed. Review it before it is written."
        : `The gate refused every attempt (${run.attempts.length}). The proposal is stored with the violations so the prompt can be fixed.`,
    };
  } catch (error) {
    return generationFailed(error, "declare block");
  }
}

/**
 * Generates the next week inside a block, or regenerates one.
 *
 * A regeneration is a new proposal row pointing at the one it replaces, per the
 * plan: the reason a week was thrown away is the training signal, and an overwrite
 * destroys it.
 */
export async function generateNextWeek(input: unknown): Promise<GenerationResult> {
  const parsed = generateWeekSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  if (!hasApiKey()) return keyMissing();
  const { mesocycleId, note, supersedesId } = parsed.data;

  try {
    const db = getDb();
    const refused = await capReached(db);
    if (refused) return refused;
    const context = await loadContext({ db, mesocycleId });
    const block = context.block;
    if (!block) {
      return { ok: false, message: `No block ${mesocycleId}. Declare one first.` };
    }

    const slot = await nextWeekSlot(mesocycleId, db);
    const startDate =
      parsed.data.startDate ??
      (slot.lastStartDate ? addDays(slot.lastStartDate, 7) : block.startDate);

    const run = await generateWeek({
      context,
      declaration: block.declaration,
      // A superseded week was never written, so a regeneration takes the same
      // next slot the week it replaces had.
      ordinal: slot.ordinal,
      startDate,
      priorWeeks: block.priorWeeks,
      priorSession: block.priorSession,
      note: note ?? null,
      db,
    });

    const proposalId = await saveProposal({
      run,
      mesocycleId,
      supersedesId: supersedesId ?? null,
      db,
    });
    revalidatePath("/plan");
    revalidatePath("/today");

    if (run.passed) {
      return { ok: true, proposalId, message: "Week proposed. Review it before it is written." };
    }
    return {
      ok: false,
      proposalId,
      message: run.fallback
        ? `The gate refused every attempt (${run.attempts.length}), so the last session of each kind is offered instead at reduced load, flagged as a fallback.`
        : `The gate refused every attempt (${run.attempts.length}) and there is no history to fall back on. The violations are on the proposal.`,
    };
  } catch (error) {
    return generationFailed(error, "generate week");
  }
}

/**
 * Accepts a proposal, writing the plan tree.
 *
 * An edited week is re-normalized and re-gated before it is written, so the diff
 * and the gate report stored against it describe the plan that actually landed.
 * Violations on an edited week do not block it: the owner outranks the gate, and
 * the record of the disagreement is more useful than a refusal.
 */
export async function acceptProposal(input: unknown): Promise<GenerationResult> {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);
  const { proposalId, editedWeek, sessionOrigins } = parsed.data;

  try {
    const db = getDb();
    const stored = await loadProposalById(proposalId, db);
    if (!stored) return { ok: false, message: `No proposal ${proposalId}.` };
    if (stored.verdict !== "pending") {
      return { ok: false, message: `That proposal is already ${stored.verdict}.` };
    }

    if (stored.scope === "mesocycle") {
      await acceptDeclaration({ proposalId, db });
      revalidatePath("/plan");
      revalidatePath("/today");
      return { ok: true, proposalId, message: "Block open. Generate its first week." };
    }

    if (stored.mesocycleId === null) {
      return { ok: false, message: "That week names no block, so it has nowhere to go." };
    }
    const context = await loadContext({ db, mesocycleId: stored.mesocycleId });
    const block = context.block;
    if (!block) return { ok: false, message: "The block this week belongs to is gone." };

    const proposed = microcyclePlanSchema.safeParse(stored.normalized);
    if (!proposed.success) {
      return {
        ok: false,
        message:
          "That proposal holds no usable week, so there is nothing to accept. Regenerate it.",
      };
    }

    // A week handed back unchanged is an acceptance, not an edit, whatever the
    // client sent: the verdict is training signal and must not claim an edit.
    const origins = sessionOrigins ?? [];
    const edited =
      editedWeek && diffWeeks(proposed.data, editedWeek as MicrocyclePlan, origins).length
        ? (editedWeek as MicrocyclePlan)
        : null;
    const review = edited
      ? reviewWeek({
          declaration: block.declaration,
          directory: context.directory,
          prefiltered: context.prefiltered,
          week: edited,
          priorWeeks: block.priorWeeks,
          priorSession: block.priorSession,
        })
      : null;

    await acceptWeek({
      proposalId,
      directory: context.directory,
      edited: review ? review.week : null,
      changes: review?.changes,
      advisories: review?.advisories,
      ownerEdits: review ? diffWeeks(proposed.data, review.week, origins) : null,
      db,
    });

    revalidatePath("/plan");
    revalidatePath("/today");
    revalidatePath("/log");

    if (review && !review.passed) {
      return {
        ok: true,
        proposalId,
        message: `Week written as you edited it. The gate still objects: ${review.violations[0]?.message ?? "see the report"}`,
      };
    }
    return { ok: true, proposalId, message: "Week written. It is on Today." };
  } catch (error) {
    return failed(error);
  }
}

export async function rejectProposalAction(input: unknown): Promise<GenerationResult> {
  const parsed = rejectSchema.safeParse(input);
  if (!parsed.success) return invalid(parsed.error);

  await rejectProposal({ ...parsed.data, db: getDb() });
  revalidatePath("/plan");
  return { ok: true, message: "Rejected. The reason goes into the next generation." };
}

/** Closes the open block by hand, for when a block ends early. */
export async function closeOpenBlock(): Promise<GenerationResult> {
  const db = getDb();
  const block = await loadOpenBlock(db);
  if (!block) return { ok: false, message: "No block is open." };
  await db
    .update(schema.mesocycles)
    .set({ closedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.mesocycles.id, block.mesocycleId));
  revalidatePath("/plan");
  return { ok: true, message: "Block closed." };
}
