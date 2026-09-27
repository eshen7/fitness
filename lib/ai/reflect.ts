import { z } from "zod";
import { formatDay } from "@/lib/days";
import { MEMORY_FACT_TYPES, TENDON_SITES } from "@/lib/taxonomy";
import { getAiClient, type AiResult } from "./client";

/**
 * The reflection call: one logged session in, proposed memory facts out.
 *
 * The narrowest model call in the app, and deliberately so. It is not asked what the
 * athlete should do, what the pain means, or how next week should change - all of
 * that is the generator's job downstream and the engine's to constrain. It is asked
 * one question: what happened here that would be worth knowing next time, and that
 * the app does not already compute.
 *
 * That last clause is the whole reason this is a small prompt. `lib/analytics/`
 * already measures prescription calibration, schedule adherence, weight trend, tendon
 * load ceilings, and a dozen other things, each with its n and its interval and a
 * gate in front of it. A model asked to notice patterns in logged numbers will
 * cheerfully produce the same claims with none of that, and a memory fact has no
 * interval and no gate. So the prompt's central instruction is to stay off the
 * numbers and report the things only language can carry: what the athlete wrote in a
 * note, what they changed and why, what they keep avoiding.
 *
 * Split stable / volatile like every other call through the seam, with nothing
 * clock-derived in the stable half.
 */

// -----------------------------------------------------------------------------
// What the model returns
// -----------------------------------------------------------------------------

export const factProposalSchema = z.object({
  type: z.enum(MEMORY_FACT_TYPES),
  /**
   * The fact in one sentence, in the third person, as it will appear in a future
   * prompt. Standing knowledge, not a description of this session.
   */
  body: z.string(),
  /** 0 to 1. Below 0.4 the fact is stored but kept out of the prompt. */
  confidence: z.number(),
  /**
   * What was observed, verbatim where possible.
   *
   * Required rather than optional, and it is the field that makes this layer
   * reviewable: a fact in the feed with nothing behind it cannot be judged, only
   * trusted or deleted. Asking for the evidence alongside the claim also suppresses
   * the confident invention that a claim-only schema invites.
   */
  observations: z.array(z.string()),
  /**
   * Tendon sites whose handling this fact would change. Empty for almost every fact.
   *
   * Declared apart from the prose because `lib/memory/facts.ts` uses it to decide
   * whether the owner has to confirm the write. The model is not asked whether its
   * fact is risky - it is asked what the fact is about, and the code draws the
   * conclusion.
   */
  tendonSites: z.array(z.enum(TENDON_SITES)),
  /** Exercise ids this fact would stop being prescribed at all. Almost always empty. */
  retiresExerciseIds: z.array(z.number()),
});
export type ProposedFact = z.infer<typeof factProposalSchema>;

export const reflectionSchema = z.object({
  /**
   * The facts worth keeping. An empty array is the expected answer for an ordinary
   * session, and the prompt says so: a reflection that must produce something will
   * produce something.
   */
  facts: z.array(factProposalSchema),
  /** One line for the feed on what the session looked like. Null when unremarkable. */
  summary: z.string().nullable(),
});
export type Reflection = z.infer<typeof reflectionSchema>;

// -----------------------------------------------------------------------------
// The prompt
// -----------------------------------------------------------------------------

export const REFLECT_SYSTEM_PROMPT = `You read one finished training session for a single athlete and write down anything worth remembering about the ATHLETE, not about the session. What you return is stored as durable memory and shown to the planner before every future workout, so a wrong fact does not cause one bad day, it quietly shapes months of training.

What belongs in memory:

- Preferences and aversions the athlete showed or said. "Skips the second set of split squats whenever they are programmed after bounds" is memory. "Did three sets of split squats" is not.
- Constraints the logs revealed: a movement that cannot be done in their gym, a load their setup cannot reach, a time they cannot train.
- Schedule reality in the athlete's own terms, such as a session moved for a recurring commitment.
- Equipment facts, including something the log implies they do not have.
- Response patterns that are about HOW they train rather than about how much: a cue that works, a warm-up they need, a lift that always feels heavy the day after a jump session.
- Goals they expressed.

What does NOT belong in memory, and this is the most important instruction here:

- Anything that is a number the app already tracks. The app separately computes, with sample sizes and confidence intervals, the athlete's RPE calibration per exercise, weekly volume and workload ratios, adherence by weekday, one-rep-max trends, bodyweight trend, maintenance calories, the depth jump height where their vertical peaks, tendon pain against contact volume, and which lifts correlate with their jump. Do not restate any of those as a memory fact. A sentence like "the athlete averages 1.2 RPE above prescribed on squats" is worse than saying nothing, because it is the same claim without the sample size.
- Anything about this one session that will not still be true next month. A single hard session is not a pattern.
- Medical interpretation, diagnosis, or anything about tendon structure.
- Advice. You are not writing a plan.

Rules:

- Return an empty facts array when the session taught nothing durable. That is the ordinary answer and it is a good one. Most sessions are just sessions.
- One fact per sentence, stated in the third person about the athlete, written to be read cold in six months with no context.
- Every fact carries the observations behind it, quoting the athlete's own notes where they exist. A fact whose only support is your impression should not be written.
- Confidence is what you would bet on the fact still holding in three months. One session rarely supports more than 0.6.
- Fill tendonSites only when the fact genuinely changes how a tendon site should be loaded, and retiresExerciseIds only when the fact means an exercise should never be prescribed again. Both are rare and both send the fact to the athlete for approval rather than committing it, so an empty list is not a way of being cautious - it is the normal, correct value.
- Never contradict something the athlete stated themselves. If the session suggests one of their stated facts is wrong, say so in the summary and write no fact.`;

/** Facts already held, so the reflection adds to them rather than restating them. */
export type KnownFactLine = { type: string; body: string; source: string };

function knownFactsText(known: readonly KnownFactLine[]) {
  if (known.length === 0) return "Nothing yet. This is the first reflection.";
  return known
    .map((fact) => `- [${fact.type}, ${fact.source}] ${fact.body}`)
    .join("\n");
}

function section(title: string, body: string) {
  return `## ${title}\n\n${body}`;
}

/**
 * The stable half.
 *
 * The known facts are last and inside the stable text, matching the candidate table
 * in `context.ts` and the food cache in `food.ts`: it is the part most likely to
 * change, so everything ahead of it stays cached when a reflection writes a fact.
 * Nothing here derives from the clock, which is the one rule that keeps the prefix
 * cacheable at all.
 */
export function reflectStableText(known: readonly KnownFactLine[]) {
  return [
    REFLECT_SYSTEM_PROMPT,
    section(
      `Already remembered (${known.length})`,
      `Do not repeat, rephrase, or contradict these. Add a fact only if it says something these do not.\n\n${knownFactsText(known)}`,
    ),
  ].join("\n\n");
}

/** One logged set against what was asked for. Rendered as prose, not as a table. */
export type ReflectionSet = {
  exerciseName: string;
  prescribed: string | null;
  performed: string;
  rpe: number | null;
  targetRpe: number | null;
  qualityRating: number | null;
  notes: string | null;
};

export type ReflectionSession = {
  day: string;
  kind: string;
  title: string | null;
  /** The athlete's own words about the session. The most valuable input here. */
  notes: string | null;
  reportedRpe: number | null;
  plannedSets: number | null;
  sets: ReflectionSet[];
  /** Prescriptions with nothing logged against them, which is its own signal. */
  skipped: string[];
  tendon: { site: string; painDuringLoad: number; painAfterLoad: number }[];
};

function setLine(set: ReflectionSet) {
  const rpe =
    set.rpe === null
      ? ""
      : ` at RPE ${set.rpe}${set.targetRpe === null ? "" : ` against a target of ${set.targetRpe}`}`;
  const quality = set.qualityRating === null ? "" : `, quality ${set.qualityRating}/5`;
  const against = set.prescribed === null ? " (not on the plan)" : ` against ${set.prescribed}`;
  const notes = set.notes ? ` Note: "${set.notes}"` : "";
  return `- ${set.exerciseName}: ${set.performed}${against}${rpe}${quality}.${notes}`;
}

export function reflectVolatileText(session: ReflectionSession) {
  const header = [
    `${formatDay(session.day)}, a ${session.kind} session${session.title ? ` titled "${session.title}"` : ""}.`,
    session.reportedRpe === null
      ? null
      : `The athlete rated the whole session ${session.reportedRpe} RPE.`,
    session.plannedSets === null
      ? null
      : `${session.plannedSets} sets were planned and ${session.sets.length} were logged.`,
  ]
    .filter(Boolean)
    .join(" ");

  return [
    section("The session", header),
    section(
      "What the athlete wrote",
      session.notes ? `"${session.notes}"` : "Nothing. Do not invent a reason for anything.",
    ),
    section(
      "Sets logged",
      session.sets.length ? session.sets.map(setLine).join("\n") : "None.",
    ),
    section(
      "Prescribed and not logged",
      session.skipped.length
        ? `${session.skipped.join("\n")}\n\nA skip is worth a fact only if it is part of a pattern the remembered facts already hint at.`
        : "Nothing was skipped.",
    ),
    section(
      "Tendon check-ins around this session",
      session.tendon.length
        ? session.tendon
            .map(
              (row) =>
                `${row.site}: pain during load ${row.painDuringLoad}/10, after load ${row.painAfterLoad}/10.`,
            )
            .join("\n")
        : "None recorded.",
    ),
  ].join("\n\n");
}

// -----------------------------------------------------------------------------

/**
 * Reflects on one session. Throws `AiOutputError` or `BilledFailure` like every
 * other call through the seam, and writes nothing: the caller owns the meter, the
 * confirmation gate and the database.
 *
 * No repair loop, for the same reason `parseMeal` has none: there is no oracle for
 * whether a remembered fact is true, so a second attempt is a second guess at twice
 * the price. The gate that protects this is the confirmation list and the feed, both
 * of which are cheaper and more accurate than another call.
 */
export async function reflectOnSession(input: {
  session: ReflectionSession;
  known: readonly KnownFactLine[];
}): Promise<AiResult<Reflection>> {
  return getAiClient().propose({
    stable: reflectStableText(input.known),
    volatile: reflectVolatileText(input.session),
    turns: [
      {
        role: "user",
        content:
          "What, if anything, should be remembered about this athlete after that session?",
      },
    ],
    tools: [],
    schema: reflectionSchema,
    cacheKey: "fitness-reflect",
    label: "reflection",
  });
}
