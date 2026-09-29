import {
  COMPLEX_SIZE,
  INTENSE_PLYO_SESSION,
  LOAD_STEP,
  MIN_WEEKLY_FREQUENCY,
  PLYO_DAYS,
  VOLUME_STEP,
} from "@/lib/engine/validate";
import {
  HEAVY_REST,
  PLYO_REPS,
  PLYO_REST,
  PLYO_SETS,
} from "@/lib/engine/normalize";
import { SHOCK_CONTACT_LIMIT, SHORT_SSC_LIMIT } from "@/lib/engine/classify";
import type { Advisory, Change, Violation } from "@/lib/engine/types";
import { formatDay } from "@/lib/days";

/**
 * Every word the model is told, and the repair request built from what the gate
 * said.
 *
 * The rules are restated here from the engine's own constants rather than typed
 * out as prose, so a threshold that moves in `lib/engine/` moves in the prompt in
 * the same change. The gate is the oracle; this text exists only to raise the
 * first-attempt pass rate, and it earns its place by being exactly the gate.
 */

export const SYSTEM_PROMPT = `You are the programming engine for a single athlete's vertical jump and upper body training app. You write training blocks and weekly microcycles that a deterministic rule engine then checks.

How this works, so you can be useful rather than merely plausible:

- You are given a closed set of candidate exercises, each with a numeric id. Every exercise you prescribe must be one of them, by id. There is no other way to name an exercise.
- The candidate set has already had illegal options removed: exercises loading a tendon in an early protocol phase, exercises above a load cap set by rising pain, and exercises needing equipment the athlete does not have. You do not need to reason about those three things. You only need to choose from what you are shown.
- If the block genuinely needs a movement the candidate set does not contain, put it in suggestedExercises with a rationale and plan around what exists. Never invent an exercise inline and never guess an id.
- After you answer, a normalizer fixes every field that has exactly one correct answer: exercise order within a session, rest windows, plyometric set and rep clamps, and coupling-time labels. Do your best on them, but spend your effort on selection, emphasis and structure, which are yours alone.
- Then a gate checks the structural rules below and either accepts the plan or sends you the failures to repair. Those rules are hard. A plan that breaks one is rejected however good its reasoning.

Write the rationale for the athlete, in plain language: what this block or week is for, and why these choices. In claimedConstraints, name each hard rule and say in one line how the plan satisfies it. That list is checked against the gate, so an honest "I could not satisfy X because Y" is far more useful than a claim that turns out to be false.`;

/**
 * The domain the rules come from. Short on purpose: the ebook's reasoning is what
 * makes a plan good, and the gate is what makes it legal, so this carries the
 * framing facts that change decisions and leaves the rest to the rule text.
 */
export const DOMAIN_RULES = `Training model, from the coaching methodology this app encodes.

Framing facts that change how you plan:

- Vertical jump is expected to drop during hard training blocks. Planned back-off produces supercompensation. Do not treat a downward trend as a reason to go easier than the block calls for.
- Each biomotor capacity has its own fatigue and recovery curve, so fatigue is not one number. An athlete too tired to repeat one drill can still do another well. Sequence drills so more total work is possible.
- Relative strength, not absolute strength, is what raises a jump. Compound movements transfer better because jumping is intermuscularly complex. Transfer is asymmetric: max strength helps power, power does not help max strength.
- A constant stimulus decays in effect (accommodation), and adaptation needs load above the habitual level (overload). So vary the load within a block, and keep the exercises fixed.
- Gains drop when several abilities are trained at once. One or two motor abilities per block plus one technical feature, with roughly 70 to 80 percent of the block's work on those targets.
- Plyometrics are the hardest part to get right and can make some athletes jump lower. Default conservative. Intensity is force at impact plus intent; only well-executed reps count.
- Do as much work as possible while staying as fresh as possible. Highest-value, most coordination-demanding, most intense work first while rested. Main lifts before assistance, large muscle groups before small, dynamic before slow.
- Mesocycle types: accumulation builds potential, transmutation converts general fitness into specific, realization peaks. Load waves across the weeks of a block: the lightest day's volume should sit near 60 percent of the heaviest day's.
- Tendons are biological springs. Load is set by reps, speed and joint angle, and one-foot jumping loads a leg at up to 14 times bodyweight. What works is load management, not stretching, icing or anti-inflammatories.

Dosage the normalizer will enforce, so you may simply follow it:

- Plyometrics: ${PLYO_REPS.min} to ${PLYO_REPS.max} reps, ${PLYO_SETS.min} to ${PLYO_SETS.max} sets.
- Rest: ${HEAVY_REST.min / 60} to ${HEAVY_REST.max / 60} minutes on heavy sets, ${PLYO_REST.shock.min / 60} to ${PLYO_REST.shock.max / 60} minutes on shock-method work, ${PLYO_REST.low.min} to ${PLYO_REST.low.max} seconds on low-intensity plyometrics, ${PLYO_REST.standard.min / 60} to ${PLYO_REST.standard.max / 60} minutes otherwise.
- Coupling time: short SSC under ${SHORT_SSC_LIMIT * 1000} ms, long SSC over. Nothing above ${SHOCK_CONTACT_LIMIT} s of ground contact is shock-method work.
- Roughly 20 sets is a full session. More than that is an advisory, not a rejection, but it is a real ceiling.`;

/** The rules the gate actually enforces, stated in the gate's own numbers. */
export const GATE_RULES = `Hard rules. The gate rejects a plan that breaks any of these.

Block scope, checked when the block is declared and again at every week:

1. Targets: 1 or 2 target motor abilities, and at most 1 technical focus.
2. Stable complex: one complex of ${COMPLEX_SIZE.min} to ${COMPLEX_SIZE.max} distinct exercises, roughly ten, no repeats. Every complex exercise appears on at least ${MIN_WEEKLY_FREQUENCY} days of each week.
3. Load varies, the complex does not: a week may only prescribe exercises from the complex, plus mobility work, plus one stand-in for each complex exercise the pre-filter has removed. Consecutive weeks must differ: move relative load by at least ${LOAD_STEP}, or total training sets by at least ${VOLUME_STEP * 100} percent.
4. Plyometric frequency: plyometrics on ${PLYO_DAYS.min} to ${PLYO_DAYS.max} days a week, dropping to ${PLYO_DAYS.maxWhenIntense} days when the week contains shock-method work or a plyometric session at planned intensity ${INTENSE_PLYO_SESSION} or above. The floor is waived in a detraining week. The complex must contain at least one plyometric, or no week could ever meet the floor.
5. Back to back: sessions on the same day or on consecutive days must not both train the same large muscle group as a primary mover, nor repeat the same coordination pattern. Large groups are the full body, posterior chain, knee extensors, upper push and upper pull. Holds, bracing, carries and mobility do not count as coordination patterns. This is checked across the week boundary too, against the last session of the previous week.
6. Target RPE: every set sets targetRpe, 1 to 10, for how hard it should feel. Only mobility work, and sessions of kind tendon_protocol, test, mobility or rest, may leave it null. It is how the athlete's reported effort is held against the plan, so set it from the week's load type and the set's place in the session: a stimulating week works closer to the limit than a retaining one, and a detraining week further from it.`;

// -----------------------------------------------------------------------------
// The asks
// -----------------------------------------------------------------------------

export function declarationAsk(input: {
  startDate: string;
  ordinal: number;
  weeks: number;
  note: string | null;
}) {
  return [
    `Declare mesocycle ${input.ordinal} of the current macrocycle, starting ${formatDay(input.startDate)} and running ${input.weeks} week${input.weeks === 1 ? "" : "s"}.`,
    "Choose the block type, 1 or 2 target motor abilities, at most 1 technical focus, and the stable exercise complex. Set targetWeeklyFrequency on each complex item to the number of days a week it should appear, and isMain true for the few lifts the block is actually built on.",
    "Do not write any sessions. Weeks are generated one at a time against this declaration.",
    input.note ? `The athlete adds: ${input.note}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function weekAsk(input: {
  ordinal: number;
  startDate: string;
  trainableWeekdays: readonly number[];
  note: string | null;
}) {
  const days =
    input.trainableWeekdays.length === 0
      ? "The athlete has set no training days, so use your judgement."
      : `Trainable weekdays, 0 for Sunday: ${input.trainableWeekdays.join(", ")}. Sessions land only on those days.`;
  return [
    `Generate week ${input.ordinal} of this block, the microcycle starting ${formatDay(input.startDate)}.`,
    "Set loadType and relativeLoad for the week, then write each session with its day, kind, planned intensity 1 to 10, and blocks of prescribed sets. Every set names an exercise by id from the candidate set and, unless it is mobility work or in a session that is not training, a targetRpe.",
    days,
    input.note ? `The athlete adds: ${input.note}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// -----------------------------------------------------------------------------
// The repair request
// -----------------------------------------------------------------------------

/**
 * The gate's failures, back to the model, as an instruction rather than a dump.
 *
 * The messages are the engine's own, verbatim, because each one already names the
 * rule, the offending exercises and the number to move. Rewording them here would
 * be a second place to keep in step with `lib/engine/` and a worse explanation.
 */
export function repairRequest(input: {
  violations: readonly Violation[];
  changes?: readonly Change[];
  attempt: number;
  attemptsLeft: number;
}) {
  const lines = input.violations.map(
    (violation) =>
      `- [${violation.rule}, ${violation.scope} scope${violation.day ? `, ${formatDay(violation.day)}` : ""}] ${violation.message}`,
  );
  const normalized = (input.changes ?? []).length
    ? `\n\nThe normalizer had already fixed ${input.changes!.length} field${input.changes!.length === 1 ? "" : "s"} before the gate ran, so the plan judged was not literally yours. Those fixes are not failures and need no attention.`
    : "";
  const urgency =
    input.attemptsLeft <= 1
      ? " This is the last attempt: after it the app ships the athlete's last accepted session with reduced load instead of your plan, so fix the violations even at the cost of an unexciting week."
      : "";
  return `The gate rejected attempt ${input.attempt}. ${input.violations.length} violation${input.violations.length === 1 ? "" : "s"}:

${lines.join("\n")}

Return a complete corrected plan, not a patch, in the same schema.${urgency} Change only what these violations require; everything else about the plan was accepted.${normalized}`;
}

/** The model's own plan, echoed back so a repair turn has something to correct. */
export function priorAttemptTurn(plan: unknown) {
  return `Attempt submitted:\n${JSON.stringify(plan)}`;
}

/** Advisories, for the record on the proposal rather than for the model. */
export function advisoryLines(advisories: readonly Advisory[]) {
  return advisories.map((advisory) => `[${advisory.rule}] ${advisory.message}`);
}
