import { formatDay } from "@/lib/days";
import { tendonSiteLabels } from "@/lib/labels";
import { dayOf } from "@/lib/time";
import { TENDON_SITES, type MemoryFactType, type MemorySource, type TendonSite } from "@/lib/taxonomy";

/**
 * What a remembered fact is, which of them may speak, and which of them the owner
 * has to approve before they do.
 *
 * Pure: no database, no model, no reading of the current time. It does resolve an
 * instant into a training day through `lib/time`, which reads `APP_TIMEZONE` and so
 * makes this module server-only; a label reading a day later than the one the owner
 * lived through is worse than the constraint. Every decision
 * about a fact's standing is made here so the store can be a dumb reader and the
 * reflection job can be tested against a fixture.
 *
 * The plan settles the posture, and it is worth restating because it is unusual:
 * inferred facts auto-commit rather than queueing for approval, and safety comes
 * from reversibility - the feed shows what was learned and any fact is one action to
 * correct or delete. Two categories are exempted from that and do queue, and
 * `confirmationReason` below is the only thing that decides which.
 */

export type MemoryFact = {
  id: number;
  type: MemoryFactType;
  body: string;
  source: MemorySource;
  /** 0 to 1. Below `MIN_PROMPT_CONFIDENCE` the fact is stored but never shown. */
  confidence: number;
  /** What the reflection saw. Rendered in the feed so a fact can be judged. */
  observations: string[];
  derivedFromSessionId: number | null;
  derivedFromProposalId: number | null;
  supersedesId: number | null;
  supersededById: number | null;
  retiredAt: Date | null;
  retiredReason: string | null;
  requiresConfirmation: boolean;
  /** Why, in the owner's words, for the queue. Null when nothing held it. */
  confirmationReason: string | null;
  confirmedAt: Date | null;
  createdAt: Date;
};

/**
 * A fact the reflection wants written, before it is one.
 *
 * `tendonSites` and `retiresExerciseIds` are what the fact would *act on*, declared
 * separately from the prose. They exist for the gate rather than for the prompt: see
 * `confirmationReason`.
 */
export type FactProposal = {
  type: MemoryFactType;
  body: string;
  confidence: number;
  observations: string[];
  /** Tendon sites whose handling this fact would change. Usually empty. */
  tendonSites: TendonSite[];
  /** Exercises this fact would stop the generator prescribing. Usually empty. */
  retiresExerciseIds: number[];
};

// -----------------------------------------------------------------------------
// The confirmation gate
// -----------------------------------------------------------------------------

/**
 * Words that mean a fact is about how much load a tendon gets.
 *
 * A backstop to the structured `tendonSites` field, not a replacement for it. The
 * structured field is the mechanism and the scan is the safety net, and both are
 * needed for one reason: a fact is *prose in the prompt* whatever its fields say. A
 * model that wrote "the patellar tendon now tolerates about 250 contacts a week" and
 * left `tendonSites` empty would have its sentence read by the generator and acted on
 * regardless, so the sentence has to be checked too.
 *
 * Deliberately over-broad. A false positive costs the owner one tap on a confirm
 * button; a false negative silently raises a tendon load ceiling on the strength of
 * one good week, which is the single most harmful thing this layer could do.
 */
const TENDON_LANGUAGE = [
  "tendon",
  "tendinopathy",
  "tendinitis",
  "protocol phase",
  "isometric",
  "contact ceiling",
  "contacts per week",
  "contacts a week",
  "pain",
  "flare",
  // The bare anatomical words rather than `tendonSiteLabels`, whose "Patellar, left"
  // contains a comma and so matches no sentence anyone would write.
  ...new Set(TENDON_SITES.map((site) => site.split("_")[0])),
];

/**
 * Phrases that mean a fact would take something out of the generator's reach.
 *
 * Phrases rather than words, which is the one place this list is *not* like
 * `TENDON_LANGUAGE`. The bare verbs are the ordinary vocabulary of the domain: "drop"
 * is a drop jump and a dropped load, "remove" is taking plates off a bar, and matching
 * them would hold most of what reflection ever writes. A queue full of facts that
 * retire nothing is not caution - it is how the owner learns to tap through the queue,
 * which costs exactly the review the two real exceptions need.
 *
 * The asymmetry that justifies over-broadness for tendon load does not apply here
 * either: a retirement is also declared structurally, in `retiresExerciseIds`, and the
 * engine's closed candidate set means prose alone cannot actually remove an exercise.
 * The worst a missed sentence does is discourage the generator from choosing one.
 */
const RETIREMENT_LANGUAGE = [
  "never prescribe",
  "never again",
  "never do",
  "stop prescribing",
  "stop doing",
  "no longer prescribe",
  "no longer do",
  "retire",
  "dropped from",
  "drop entirely",
  "dropped entirely",
  "removed from",
  "cut out",
  "avoid entirely",
  "avoid completely",
];

/**
 * Why this fact needs the owner's approval, or null if it may commit itself.
 *
 * The decision is made from the proposal's shape and its words, never from the
 * model's own opinion of its riskiness, and that is the point. Asking a model to
 * flag which of its writes should be reviewed asks it to gate itself, and the
 * failure mode - a confident model that marks nothing - is exactly the case the gate
 * exists for.
 *
 * Returns a sentence rather than a boolean because it goes on screen beside the
 * confirm button. "Waiting for you" with no reason is a prompt the owner learns to
 * tap through.
 */
export function confirmationReason(proposal: FactProposal): string | null {
  const body = proposal.body.toLowerCase();

  if (proposal.retiresExerciseIds.length > 0) {
    return `It would stop ${proposal.retiresExerciseIds.length === 1 ? "an exercise" : `${proposal.retiresExerciseIds.length} exercises`} being prescribed at all.`;
  }
  if (proposal.tendonSites.length > 0) {
    return `It changes how ${proposal.tendonSites.map((site) => tendonSiteLabels.of(site)).join(" and ")} is handled.`;
  }
  if (proposal.type === "injury_history") {
    return "It is injury history, which the generator treats as a hard constraint.";
  }
  if (TENDON_LANGUAGE.some((word) => body.includes(word))) {
    return "It talks about tendon load, and tendon rules are never changed unasked.";
  }
  if (RETIREMENT_LANGUAGE.some((word) => body.includes(word))) {
    return "It reads like it would retire an exercise or a movement class.";
  }
  return null;
}

// -----------------------------------------------------------------------------
// Supersession
// -----------------------------------------------------------------------------

/**
 * How alike two facts have to be for the new one to replace the old rather than
 * join it.
 *
 * Cosine similarity on the embedding, and the number is a compromise with one
 * asymmetry behind it. Set too low, a fact about back squats supersedes a fact about
 * front squats and knowledge is lost silently. Set too high, near-duplicates
 * accumulate and the prompt fills with six phrasings of "prefers morning sessions",
 * which is visible in the feed and fixable with one tap. So it errs high: duplicates
 * are an annoyance, and a quiet deletion is not.
 */
export const SUPERSEDE_SIMILARITY = 0.86;

/** Cosine similarity. Both vectors are assumed the same width; zero if either is flat. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  const width = Math.min(a.length, b.length);
  for (let i = 0; i < width; i += 1) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  if (aa === 0 || bb === 0) return 0;
  return dot / Math.sqrt(aa * bb);
}

export type Embedded<T> = T & { embedding: number[] | null };

/**
 * Which existing fact a new one replaces, or null when it is new knowledge.
 *
 * Only ever an inferred fact. A stated fact is what the owner said, and an inference
 * from a few sessions overwriting it is the app deciding it knows better than the
 * person using it - which is both wrong and, because the overwrite is silent, the
 * kind of wrong that is never discovered. Facts the owner stated are skipped here
 * and handled by `conflictsWithStated` instead.
 *
 * Nearest match rather than every match above the threshold, because supersession is
 * a chain: the new fact points at one predecessor, and that predecessor already
 * points at its own.
 */
export function supersedes(
  proposal: Embedded<{ type: MemoryFactType }>,
  existing: readonly Embedded<MemoryFact>[],
): MemoryFact | null {
  if (!proposal.embedding) return null;
  let best: { fact: MemoryFact; similarity: number } | null = null;
  for (const fact of existing) {
    if (fact.source === "stated") continue;
    if (fact.retiredAt !== null || fact.supersededById !== null) continue;
    if (fact.type !== proposal.type) continue;
    if (!fact.embedding) continue;
    const similarity = cosine(proposal.embedding, fact.embedding);
    if (similarity < SUPERSEDE_SIMILARITY) continue;
    if (!best || similarity > best.similarity) best = { fact, similarity };
  }
  return best?.fact ?? null;
}

/**
 * A stated fact this proposal would contradict, or null.
 *
 * Same similarity test pointed at the facts the owner stated themselves. A hit is a
 * reason to drop the proposal rather than to write it: "stated facts always outrank
 * inferred ones", and the honest handling of an inference that disagrees with what
 * the owner said is to say nothing and let them change their mind in their own words.
 */
export function conflictsWithStated(
  proposal: Embedded<{ type: MemoryFactType }>,
  existing: readonly Embedded<MemoryFact>[],
): MemoryFact | null {
  if (!proposal.embedding) return null;
  for (const fact of existing) {
    if (fact.source !== "stated") continue;
    if (fact.retiredAt !== null || fact.supersededById !== null) continue;
    if (fact.type !== proposal.type) continue;
    if (!fact.embedding) continue;
    if (cosine(proposal.embedding, fact.embedding) >= SUPERSEDE_SIMILARITY) return fact;
  }
  return null;
}

/**
 * Why this proposal cannot be checked against what the owner stated, or null.
 *
 * `conflictsWithStated` can only find a contradiction it has vectors for, so a
 * proposal with no embedding, or a stated fact of its type stored without one, would
 * pass it by default. An inference that could not be checked is not written: the
 * observation is still in the session, and the next reflection can derive it again.
 */
export function uncheckedAgainstStated(
  proposal: Embedded<{ type: MemoryFactType }>,
  existing: readonly Embedded<MemoryFact>[],
): string | null {
  if (!proposal.embedding) {
    return "It has no embedding, so it could not be checked against what the athlete stated.";
  }
  const bare = existing.find(
    (fact) =>
      fact.source === "stated" &&
      fact.retiredAt === null &&
      fact.supersededById === null &&
      fact.type === proposal.type &&
      !fact.embedding,
  );
  if (bare) {
    return `The athlete's stated "${bare.body}" has no embedding, so it could not be checked against it.`;
  }
  return null;
}

// -----------------------------------------------------------------------------
// What reaches the prompt
// -----------------------------------------------------------------------------

/**
 * Confidence below which a fact is kept but not shown.
 *
 * Reflection is asked for its confidence and mostly answers between 0.5 and 0.9, so
 * this only excludes the guesses it flagged as guesses. The row is still written,
 * because a low-confidence inference that recurs is how a real pattern first looks,
 * and the feed showing it is how the owner can confirm it in one tap.
 */
export const MIN_PROMPT_CONFIDENCE = 0.4;

/**
 * The most facts the prompt will carry.
 *
 * One athlete accumulates maybe a few dozen, so this is a ceiling rather than a
 * working constraint, and it is there to bound the prefix rather than to select. A
 * prompt that grows without limit does not fail, it just gets slowly more expensive
 * and slowly less attended to, which is the sort of decay nobody notices.
 */
export const PROMPT_FACT_BUDGET = 40;

/** Whether a fact is live: not retired, not replaced, and confirmed if it needed to be. */
export function isActive(fact: MemoryFact): boolean {
  if (fact.retiredAt !== null) return false;
  if (fact.supersededById !== null) return false;
  if (fact.requiresConfirmation && fact.confirmedAt === null) return false;
  return true;
}

/** Awaiting the owner's decision, which is the only queue this layer has. */
export function isPending(fact: MemoryFact): boolean {
  return (
    fact.retiredAt === null &&
    fact.supersededById === null &&
    fact.requiresConfirmation &&
    fact.confirmedAt === null
  );
}

/**
 * The facts the prompt gets, in a deterministic order.
 *
 * Every active fact rather than a similarity search against the request, which is
 * the one place this design departs from the obvious reading of "retrieval". Two
 * reasons, and the second is the deciding one:
 *
 * - There is nothing to retrieve from. A few dozen sentences fit in the prompt whole,
 *   so a nearest-neighbour search over them would be selecting from a set it could
 *   have simply shown.
 * - The facts go in the **cached stable prefix**. A per-request retrieval makes the
 *   prefix a function of the request, which means it changes on every call and the
 *   cache reads zero - a tenfold input cost for the privilege of hiding facts the
 *   model had room for. Ordering by anything clock-derived does the same thing, which
 *   is why recency is not in the sort.
 *
 * The embeddings still earn their place: they are what `supersedes` uses to keep this
 * set from filling with paraphrases, which is the actual failure mode of a store that
 * writes itself.
 */
export function promptFacts(
  facts: readonly MemoryFact[],
  options: { budget?: number; minConfidence?: number } = {},
): MemoryFact[] {
  const budget = options.budget ?? PROMPT_FACT_BUDGET;
  const minConfidence = options.minConfidence ?? MIN_PROMPT_CONFIDENCE;
  return facts
    .filter((fact) => isActive(fact) && fact.confidence >= minConfidence)
    .sort(
      (a, b) =>
        // Stated first, because it is the owner's own word and the thing the model
        // should treat as settled.
        rankOfSource(a.source) - rankOfSource(b.source) ||
        b.confidence - a.confidence ||
        a.type.localeCompare(b.type) ||
        a.id - b.id,
    )
    .slice(0, budget);
}

function rankOfSource(source: MemorySource): number {
  return source === "stated" ? 0 : 1;
}

/**
 * The facts as the model sees them.
 *
 * Grouped by type and marked stated or inferred with its confidence, because the
 * generator has to be able to weigh them: "prefers morning sessions, inferred, 0.6"
 * and "cannot train Thursdays, stated" are not the same kind of claim and a flat list
 * would present them as though they were.
 */
export function factsText(facts: readonly MemoryFact[]): string {
  if (facts.length === 0) {
    return "Nothing learned yet. Ask for nothing on the athlete's behalf that the request does not say.";
  }
  const byType = new Map<MemoryFactType, MemoryFact[]>();
  for (const fact of facts) {
    const held = byType.get(fact.type) ?? [];
    held.push(fact);
    byType.set(fact.type, held);
  }
  return [...byType.entries()]
    .map(([type, group]) => {
      const lines = group.map(
        (fact) =>
          `- ${fact.body} (${fact.source === "stated" ? "stated by the athlete" : `inferred, confidence ${fact.confidence.toFixed(2)}`})`,
      );
      return `${factTypeHeading(type)}\n${lines.join("\n")}`;
    })
    .join("\n\n");
}

function factTypeHeading(type: MemoryFactType): string {
  return `${memoryFactTypeLabels[type]}:`;
}

/**
 * Headings for the prompt, kept here rather than in `lib/labels.ts` because these
 * are addressed to the model and the UI's are addressed to the owner. They agree
 * today and there is no reason they must.
 */
const memoryFactTypeLabels: Record<MemoryFactType, string> = {
  preference: "Preferences",
  constraint: "Constraints",
  schedule: "Schedule",
  injury_history: "Injury history",
  response_pattern: "How the athlete responds to training",
  goal: "Goals",
  equipment: "Equipment",
};

/** One line for the feed: what was learned, when, and off what. */
export function factSummary(fact: MemoryFact): string {
  // `dayOf` rather than the UTC date of the instant: the app runs in the owner's zone
  // and Vercel's clock is UTC, so anything written after 8pm eastern would be labelled
  // tomorrow on the screen of the person who was there when it happened.
  const when = formatDay(dayOf(fact.createdAt));
  const from =
    fact.derivedFromSessionId !== null
      ? `session ${fact.derivedFromSessionId}`
      : fact.derivedFromProposalId !== null
        ? `proposal ${fact.derivedFromProposalId}`
        : "no single session";
  return fact.source === "stated"
    ? `Stated ${when}.`
    : `Inferred ${when} from ${from}, confidence ${fact.confidence.toFixed(2)}.`;
}
