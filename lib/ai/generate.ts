import type { Db } from "@/lib/db";
import { reviewDeclaration, reviewWeek } from "@/lib/engine";
import type {
  Advisory,
  Change,
  MesocycleDeclaration,
  MicrocyclePlan,
  PlannedSession,
  Violation,
} from "@/lib/engine/types";
import { addDays } from "@/lib/days";
import type { SessionKind } from "@/lib/taxonomy";
import {
  AiOutputError,
  BilledFailure,
  GENERATION_MODEL,
  getAiClient,
  type AiCall,
  type AiToolCall,
  type AiUsage,
} from "./client";
import {
  contextInputs,
  stableText,
  volatileText,
  type ContextInputs,
  type GenerationContext,
} from "./context";
import { loadLastPlannedSession } from "./queries";
import {
  advisoryLines,
  declarationAsk,
  priorAttemptTurn,
  repairRequest,
  weekAsk,
} from "./prompts";
import {
  declarationProposalSchema,
  weekProposalSchema,
  type DeclarationProposal,
  type ExerciseSuggestion,
  type WeekProposal,
} from "./schemas";
import { buildTools } from "./tools";

/**
 * Stages 2 to 4: propose, normalize, gate, repair, and fall back.
 *
 * The loop is deliberately dumb. It calls the model, hands the result to the
 * engine, and if the gate says no it sends the gate's own messages back and asks
 * again, at most `MAX_REPAIR_ATTEMPTS` times. It contains no rule logic of its
 * own, because a second opinion about the rules living here is exactly how a
 * generator drifts away from its validator.
 *
 * Every attempt is recorded, including the ones that failed to parse, because the
 * attempt distribution is a phase exit criterion and an attempt that is not
 * counted is an attempt that flatters the number.
 */

/** Three, per the plan. The fourth failure ships the fallback instead. */
export const MAX_REPAIR_ATTEMPTS = 3;

/** How hard the fallback is scaled back. A fifth off is felt but still trains. */
export const FALLBACK_LOAD_SCALE = 0.8;

const EMPTY_USAGE: AiUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
};

function sumUsage(a: AiUsage, b: AiUsage): AiUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  };
}

/** One trip through the model and the engine, whatever came of it. */
export type Attempt = {
  /** 1-based. `repairAttempts` on the stored proposal is this minus one. */
  attempt: number;
  violations: Violation[];
  passed: boolean;
  /** Set when the call itself produced nothing usable, which counts as a failure. */
  error: string | null;
};

/**
 * What was asked for, kept on the run because accepting a proposal needs it.
 *
 * A declaration carries no start date of its own and a week's ordinal is a
 * property of the request rather than of the plan, so without this the review UI
 * would have to be trusted to hand the same numbers back at accept time.
 */
export type GenerationAsk = {
  ordinal: number;
  startDate: string;
  /** Planned length in weeks. Null for a microcycle, which is one week by definition. */
  weeks: number | null;
  note: string | null;
};

type RunShape = {
  ask: GenerationAsk;
  inputs: ContextInputs;
  attempts: Attempt[];
  usage: AiUsage;
  model: string | null;
  toolCalls: AiToolCall[];
  suggestedExercises: ExerciseSuggestion[];
  rationale: string | null;
  claimedConstraints: string[];
  /** The last proposal the model returned, passing or not. Null if none parsed. */
  proposal: unknown;
};

export type DeclarationRun = RunShape & {
  scope: "mesocycle";
  declaration: MesocycleDeclaration | null;
  passed: boolean;
};

export type WeekRun = RunShape & {
  scope: "microcycle";
  week: MicrocyclePlan | null;
  changes: Change[];
  advisories: Advisory[];
  passed: boolean;
  /** Present only when the loop never converged and there was history to reuse. */
  fallback: MicrocyclePlan | null;
};

// -----------------------------------------------------------------------------
// Block declaration
// -----------------------------------------------------------------------------

export async function generateDeclaration(input: {
  context: GenerationContext;
  ordinal: number;
  startDate: string;
  weeks: number;
  note?: string | null;
  db?: Db;
}): Promise<DeclarationRun> {
  const { context } = input;
  const call: AiCall<DeclarationProposal> = {
    stable: stableText(context),
    volatile: volatileText(context),
    turns: [
      {
        role: "user",
        content: declarationAsk({
          startDate: input.startDate,
          ordinal: input.ordinal,
          weeks: input.weeks,
          note: input.note ?? null,
        }),
      },
    ],
    tools: buildTools(context, input.db),
    schema: declarationProposalSchema,
    cacheKey: "fitness-declaration",
    label: "block declaration",
  };

  const run: DeclarationRun = {
    scope: "mesocycle",
    ask: {
      ordinal: input.ordinal,
      startDate: input.startDate,
      weeks: input.weeks,
      note: input.note ?? null,
    },
    inputs: contextInputs(context),
    attempts: [],
    usage: EMPTY_USAGE,
    model: null,
    toolCalls: [],
    suggestedExercises: [],
    rationale: null,
    claimedConstraints: [],
    proposal: null,
    declaration: null,
    passed: false,
  };

  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS + 1; attempt += 1) {
    const proposal = await attemptOnce(call, run, attempt);
    if (!proposal) continue;

    const review = reviewDeclaration({
      declaration: proposal.declaration,
      directory: context.directory,
      prefiltered: context.prefiltered,
    });
    run.attempts.push({
      attempt,
      violations: review.violations,
      passed: review.passed,
      error: null,
    });
    if (review.passed) {
      run.declaration = proposal.declaration;
      run.passed = true;
      return run;
    }
    appendRepair(call, proposal, review.violations, attempt);
  }
  // Out of attempts. There is no fallback at block scope, because a block is
  // declared once and has nothing to fall back to; the refused proposal stays on
  // the run as `proposal`, with the violations, for the review UI.
  return run;
}

// -----------------------------------------------------------------------------
// Weekly microcycle
// -----------------------------------------------------------------------------

export async function generateWeek(input: {
  context: GenerationContext;
  declaration: MesocycleDeclaration;
  ordinal: number;
  startDate: string;
  priorWeeks?: readonly MicrocyclePlan[];
  priorSession?: PlannedSession | null;
  note?: string | null;
  db?: Db;
  /**
   * Where the terminal fallback finds a session to reuse. Defaults to the
   * database; a test supplies its own so the fallback path can be exercised
   * without one, which is the only part of this loop that reads a table.
   */
  lastSession?: (kind: SessionKind) => Promise<PlannedSession | null>;
}): Promise<WeekRun> {
  const { context } = input;
  const call: AiCall<WeekProposal> = {
    stable: stableText(context),
    volatile: volatileText(context),
    turns: [
      {
        role: "user",
        content: weekAsk({
          ordinal: input.ordinal,
          startDate: input.startDate,
          trainableWeekdays: context.profile.trainableWeekdays,
          note: input.note ?? null,
        }),
      },
    ],
    tools: buildTools(context, input.db),
    schema: weekProposalSchema,
    cacheKey: "fitness-week",
    label: `week ${input.ordinal}`,
  };

  const run: WeekRun = {
    scope: "microcycle",
    ask: {
      ordinal: input.ordinal,
      startDate: input.startDate,
      weeks: null,
      note: input.note ?? null,
    },
    inputs: contextInputs(context),
    attempts: [],
    usage: EMPTY_USAGE,
    model: null,
    toolCalls: [],
    suggestedExercises: [],
    rationale: null,
    claimedConstraints: [],
    proposal: null,
    week: null,
    changes: [],
    advisories: [],
    passed: false,
    fallback: null,
  };

  for (let attempt = 1; attempt <= MAX_REPAIR_ATTEMPTS + 1; attempt += 1) {
    const proposal = await attemptOnce(call, run, attempt);
    if (!proposal) continue;

    const review = reviewWeek({
      declaration: input.declaration,
      directory: context.directory,
      prefiltered: context.prefiltered,
      week: proposal.week,
      priorWeeks: input.priorWeeks,
      priorSession: input.priorSession,
    });
    run.attempts.push({
      attempt,
      violations: review.violations,
      passed: review.passed,
      error: null,
    });
    // The normalized week is kept whatever the gate said, because the review UI
    // shows the diff on a rejected proposal too.
    run.week = review.week;
    run.changes = review.changes;
    run.advisories = review.advisories;
    if (review.passed) {
      run.passed = true;
      return run;
    }
    appendRepair(call, proposal, review.violations, attempt);
  }

  run.fallback = await fallbackWeek({
    ordinal: input.ordinal,
    startDate: input.startDate,
    attempted: run.week,
    candidates: new Set(context.prefiltered.candidates.map((exercise) => exercise.id)),
    lastSession:
      input.lastSession ?? ((kind) => loadLastPlannedSession(kind, input.db)),
  });
  return run;
}

// -----------------------------------------------------------------------------

/**
 * One model call, with its usage and its failure both folded into the run.
 *
 * Returns null when the call produced no parseable proposal. That is recorded as
 * a failed attempt rather than thrown, because a truncated or refused response is
 * one bad attempt and the loop has more; only a transport error, which is not an
 * `AiOutputError`, propagates, as a `BilledFailure` carrying every token the run
 * had been billed for so far.
 */
async function attemptOnce<T extends DeclarationProposal | WeekProposal>(
  call: AiCall<T>,
  run: RunShape,
  attempt: number,
): Promise<T | null> {
  try {
    const result = await getAiClient().propose(call);
    run.usage = sumUsage(run.usage, result.usage);
    run.model = result.model;
    run.toolCalls.push(...result.toolCalls);
    run.proposal = result.output;
    run.rationale = result.output.rationale;
    run.claimedConstraints = result.output.claimedConstraints;
    run.suggestedExercises = result.output.suggestedExercises;
    return result.output;
  } catch (error) {
    if (!(error instanceof AiOutputError)) {
      const billed = error instanceof BilledFailure ? error : null;
      throw new BilledFailure(
        billed ? billed.cause : error,
        sumUsage(run.usage, billed?.usage ?? EMPTY_USAGE),
        run.model ?? billed?.model ?? GENERATION_MODEL,
      );
    }
    run.usage = sumUsage(run.usage, error.usage);
    run.model ??= GENERATION_MODEL;
    run.attempts.push({
      attempt,
      violations: [],
      passed: false,
      error: error.message,
    });
    return null;
  }
}

/** Appends the rejected attempt and the gate's verdict to the conversation. */
function appendRepair<T>(
  call: AiCall<T>,
  proposal: T,
  violations: readonly Violation[],
  attempt: number,
) {
  call.turns.push({ role: "assistant", content: priorAttemptTurn(proposal) });
  call.turns.push({
    role: "user",
    content: repairRequest({
      violations,
      attempt,
      attemptsLeft: MAX_REPAIR_ATTEMPTS + 1 - attempt,
    }),
  });
}

// -----------------------------------------------------------------------------
// Terminal fallback
// -----------------------------------------------------------------------------

/**
 * The last accepted session of each kind the failed week asked for, with load
 * scaled down and the days re-dated onto the new week.
 *
 * The plan's promise is that the failure mode is a conservative real workout
 * rather than a blank screen, so this reuses sessions the owner has already
 * trained instead of synthesizing anything. It is not gated: it cannot be, since
 * it is the path taken when nothing passes the gate. It is prefiltered, though:
 * an exercise the candidate set no longer holds is dropped, because tendon
 * safety is enforced by construction and history predates today's tendon state.
 * It ships flagged, with the violations attached, and the owner sees both.
 *
 * Returns null when there is no history to reuse, which on a brand-new database is
 * the honest answer. The proposal then shows the violations, which is worse than a
 * workout and better than a lie.
 */
async function fallbackWeek(input: {
  ordinal: number;
  startDate: string;
  attempted: MicrocyclePlan | null;
  candidates: ReadonlySet<number>;
  lastSession: (kind: SessionKind) => Promise<PlannedSession | null>;
}): Promise<MicrocyclePlan | null> {
  const kinds = uniqueKinds(input.attempted);
  const sessions: PlannedSession[] = [];
  for (const [index, kind] of kinds.entries()) {
    const prior = await input.lastSession(kind);
    if (!prior) continue;
    const blocks = prior.blocks
      .map((block) => ({
        ...block,
        items: block.items
          .filter((item) => input.candidates.has(item.exerciseId))
          .map((item) => ({
            ...item,
            loadKg: item.loadKg == null ? item.loadKg : scale(item.loadKg),
            loadPctOf1rm:
              item.loadPctOf1rm == null ? item.loadPctOf1rm : Math.round(scale(item.loadPctOf1rm)),
          })),
      }))
      .filter((block) => block.items.length > 0);
    if (blocks.length === 0) continue;
    sessions.push({
      ...prior,
      day: addDays(input.startDate, dayOffset(input.attempted, kind, index)),
      title: `${prior.title ?? "Session"} (fallback, load reduced)`,
      blocks,
    });
  }
  if (sessions.length === 0) return null;
  return {
    ordinal: input.ordinal,
    startDate: input.startDate,
    // A week nobody could plan is a week to absorb, not to push into.
    loadType: "retaining",
    relativeLoad: Number(FALLBACK_LOAD_SCALE.toFixed(2)),
    sessions: sessions.sort((a, b) => a.day.localeCompare(b.day)),
  };
}

function scale(value: number) {
  return Number((value * FALLBACK_LOAD_SCALE).toFixed(2));
}

/** The session kinds the failed week wanted, in order, without repeats. */
function uniqueKinds(week: MicrocyclePlan | null): SessionKind[] {
  if (!week) return ["strength", "plyometric"];
  const seen = new Set<SessionKind>();
  for (const session of week.sessions) seen.add(session.kind);
  return [...seen];
}

/**
 * Where in the new week a fallback session lands: the day the failed plan wanted
 * for that kind, or one session every other day when the plan is unusable.
 */
function dayOffset(week: MicrocyclePlan | null, kind: SessionKind, index: number) {
  const wanted = week?.sessions.find((session) => session.kind === kind);
  if (!wanted) return index * 2;
  const offset = Math.round(
    (Date.parse(`${wanted.day}T00:00:00Z`) - Date.parse(`${week!.startDate}T00:00:00Z`)) /
      86_400_000,
  );
  return offset >= 0 && offset <= 6 ? offset : index * 2;
}

/** Advisories as the strings the proposal row stores. */
export function advisoryStrings(run: WeekRun) {
  return advisoryLines(run.advisories);
}

/**
 * The violations the run ended on: those of the last attempt that reached the
 * gate. A truncated or refused call after it says nothing about the rules, so it
 * must not read as a clean report.
 */
export function finalViolations(run: RunShape): Violation[] {
  return run.attempts.findLast((attempt) => attempt.error === null)?.violations ?? [];
}

/** `repairAttempts` for the stored proposal: 0 when the first attempt passed. */
export function repairAttemptsOf(run: RunShape) {
  return Math.max(0, run.attempts.length - 1);
}
