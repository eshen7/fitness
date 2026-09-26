import type { EnergyDirection, MesocycleType, TendonSite } from "@/lib/taxonomy";
import { KCAL_PER_G } from "./macros";

/**
 * Phase-aware daily targets, as a pure function of state.
 *
 * No model call. What the calories should be given a block type, a trend
 * bodyweight and a set of tendon readings has one defensible answer, and a
 * generated one would be a different answer each time it was asked. The rules come
 * straight out of the ebook:
 *
 * - **Relative strength is what predicts jumping**, not absolute strength. That
 *   cuts both ways: mass added faster than strength is a loss, and energy removed
 *   during a block that needs the strength is a bigger one.
 * - **Adaptation needs load above the habitual level**, and an accumulation block
 *   is where potential is built, so that is where the surplus goes.
 * - **Tendons are rebuilt by load, not rest**, and phases 2 and 3 of the protocol
 *   are a progressive rebuild of capacity. Removing energy mid-rebuild is the wrong
 *   order, so a cut is refused while any site is painful or on a protocol.
 * - **Realization is the peak.** Bodyweight changing during it changes the thing
 *   being peaked, so a cut is refused there whatever the tendons say.
 *
 * A refused cut holds at maintenance and says so. Silently obeying would be worse,
 * and silently ignoring would be worse still.
 */

export type TendonState = {
  site: TendonSite;
  /** The worst of the site's three questions at its latest check-in. */
  worstPain: number;
  protocolPhase: number | null;
};

/**
 * A stable 3 of 10 is a tendon coping, which is the same line
 * `lib/engine/prefilter.ts` draws when it caps load: above 3 the cap tightens.
 * Being on a protocol at all counts as not healthy regardless of today's pain,
 * because the protocol is a capacity rebuild and pain is analgesic-sensitive.
 */
export const HEALTHY_PAIN_MAX = 3;

export function tendonsHealthy(tendon: readonly TendonState[]): boolean {
  return tendon.every(
    (site) => site.protocolPhase === null && site.worstPain <= HEALTHY_PAIN_MAX,
  );
}

/** Sites that are the reason a cut was refused, worst first. */
export function unhealthySites(tendon: readonly TendonState[]): TendonState[] {
  return tendon
    .filter((site) => site.protocolPhase !== null || site.worstPain > HEALTHY_PAIN_MAX)
    .sort((a, b) => b.worstPain - a.worstPain);
}

// -----------------------------------------------------------------------------
// The numbers
// -----------------------------------------------------------------------------

/**
 * Maintenance calories per kilogram, for when nothing better is known.
 *
 * A placeholder on purpose. True maintenance is measurable from intake against
 * trend bodyweight change, and that arrives with the analytics; until it does this
 * is a textbook multiplier for an athlete training most days, and the rationale
 * line says which of the two produced the number so a target from before the
 * measurement is not mistaken for one after it.
 */
export const MAINTENANCE_KCAL_PER_KG = 33;

/** Surplus and deficit as a share of maintenance. */
export const SURPLUS_FRACTION = 0.1;
export const DEFICIT_FRACTION = 0.15;

/**
 * Target weekly bodyweight change, as a percent of bodyweight.
 *
 * Slow in both directions, and slower down than up. Faster than about half a
 * percent a week down costs lean mass, which is the numerator of the ratio the cut
 * was supposed to improve; faster than a quarter percent up is mostly fat, which
 * is the denominator.
 */
export const GAIN_PCT_PER_WEEK = 0.25;
export const LOSS_PCT_PER_WEEK = -0.5;

/** Protein grams per kilogram. Higher in a deficit, where it spares lean mass. */
export const PROTEIN_G_PER_KG = { surplus: 1.8, hold: 1.8, deficit: 2.4 } as const;

/** Fat grams per kilogram. A floor, not a target: below it hormones suffer. */
export const FAT_G_PER_KG = { surplus: 1, hold: 0.9, deficit: 0.8 } as const;

/** Millilitres of fluid per kilogram per day. */
export const FLUID_ML_PER_KG = 35;

export type TargetGoal = "gain" | "hold" | "cut";

/**
 * What the open block implies, before the owner says otherwise.
 *
 * Accumulation is where potential is built and is therefore where the surplus
 * belongs. Transmutation converts general fitness into specific and realization
 * peaks, and both want bodyweight still: the whole point of the block is that
 * something other than mass is changing. With no block open there is no phase to
 * be aware of, so holding is the answer that assumes least.
 */
export function defaultGoalFor(blockType: MesocycleType | null): TargetGoal {
  return blockType === "accumulation" ? "gain" : "hold";
}

export type TargetInputs = {
  /** Smoothed bodyweight in kilograms. The raw morning number is mostly noise. */
  bodyweightKg: number;
  /** Null when no block is open, which is treated as conservatively as realization. */
  blockType: MesocycleType | null;
  tendon: readonly TendonState[];
  /** Measured maintenance, once the analytics can estimate it. */
  maintenanceKcal?: number | null;
  goal: TargetGoal;
};

export type TargetProposal = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fluidMl: number;
  /** Signed percent of bodyweight per week. Zero when holding. */
  targetWeeklyChangePct: number;
  direction: EnergyDirection;
  maintenanceKcal: number;
  /** Set only when a cut was asked for and not allowed. */
  cutRefusedBecause: string | null;
  rationale: string;
};

/**
 * What the daily targets should be.
 *
 * Carbohydrate is the remainder rather than a ratio, because protein and fat are
 * both floors set per kilogram and the energy left over is what fuels the work.
 * That ordering is also why the remainder is clamped at zero: a deficit deep enough
 * to leave no room would be a deficit that had already gone too far, and the clamp
 * makes it visible as a target with no carbohydrate in it rather than as a negative
 * number that formats as one.
 */
export function proposeTargets(input: TargetInputs): TargetProposal {
  const { bodyweightKg, blockType, goal } = input;
  const maintenanceKcal =
    input.maintenanceKcal ?? Math.round(bodyweightKg * MAINTENANCE_KCAL_PER_KG);

  // Only asked when a cut is on the table. The rules say nothing against a surplus
  // during realization or on a painful tendon - eating more is not what hurts a
  // tendon - so a refusal computed for every goal would report one that never applied.
  const refusal = goal === "cut" ? cutRefusal(input) : null;
  const direction: EnergyDirection =
    goal === "cut" ? (refusal ? "hold" : "deficit") : goal === "gain" ? "surplus" : "hold";

  const kcal = Math.round(
    direction === "surplus"
      ? maintenanceKcal * (1 + SURPLUS_FRACTION)
      : direction === "deficit"
        ? maintenanceKcal * (1 - DEFICIT_FRACTION)
        : maintenanceKcal,
  );

  const proteinG = Math.round(bodyweightKg * PROTEIN_G_PER_KG[direction]);
  const fatG = Math.round(bodyweightKg * FAT_G_PER_KG[direction]);
  const carbsG = Math.max(
    0,
    Math.round(
      (kcal - proteinG * KCAL_PER_G.protein - fatG * KCAL_PER_G.fat) / KCAL_PER_G.carbs,
    ),
  );

  return {
    kcal,
    proteinG,
    carbsG,
    fatG,
    fluidMl: Math.round(bodyweightKg * FLUID_ML_PER_KG),
    targetWeeklyChangePct:
      direction === "surplus"
        ? GAIN_PCT_PER_WEEK
        : direction === "deficit"
          ? LOSS_PCT_PER_WEEK
          : 0,
    direction,
    maintenanceKcal,
    cutRefusedBecause: refusal,
    rationale: rationaleFor({
      direction,
      blockType,
      maintenanceKcal,
      measured: input.maintenanceKcal != null,
      refusal,
    }),
  };
}

/**
 * Why a cut cannot happen now, or null when it can.
 *
 * Ordered by which fact the owner can do least about: the block is a decision
 * already made and the tendons are a state to be trained out of, so the block is
 * named first when both apply.
 */
export function cutRefusal(
  input: Pick<TargetInputs, "blockType" | "tendon">,
): string | null {
  if (input.blockType === "realization") {
    return "a realization block is a peak, and bodyweight moving during it changes the thing being peaked";
  }
  const unhealthy = unhealthySites(input.tendon);
  if (unhealthy.length > 0) {
    const worst = unhealthy[0];
    const how =
      worst.protocolPhase !== null
        ? `is on protocol phase ${worst.protocolPhase}`
        : `is at ${worst.worstPain} of 10`;
    return `the ${siteWords(worst.site)} ${how}, and tendon capacity is rebuilt by load rather than by eating less`;
  }
  return null;
}

function siteWords(site: TendonSite) {
  return site.replace(/_/g, " ");
}

function rationaleFor(input: {
  direction: EnergyDirection;
  blockType: MesocycleType | null;
  maintenanceKcal: number;
  measured: boolean;
  refusal: string | null;
}) {
  const basis = input.measured
    ? `Maintenance ${input.maintenanceKcal} kcal, measured from intake against the bodyweight trend.`
    : `Maintenance estimated at ${input.maintenanceKcal} kcal from trend bodyweight, since intake has not been measured against it yet.`;

  const block =
    input.blockType === null
      ? "No block is open."
      : `The block is ${input.blockType}.`;

  const call = {
    surplus:
      "A surplus: adaptation needs load above the habitual level, and mass added slowly is mass strength can keep up with.",
    hold: "Holding: bodyweight is the denominator of the ratio that predicts jumping, so it stays put unless there is a reason to move it.",
    deficit:
      "A deficit, with protein raised: what jumping tracks is strength relative to bodyweight, so the point is to lose the denominator without the numerator.",
  }[input.direction];

  return [basis, block, call, input.refusal ? `A cut was asked for and declined: ${input.refusal}.` : null]
    .filter(Boolean)
    .join(" ");
}

// -----------------------------------------------------------------------------

export type DailyTarget = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fluidMl: number | null;
  targetWeeklyChangePct: number | null;
  rationale: string | null;
  effectiveFrom: string;
};

export type RemainingTarget = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

/**
 * The goal a stored target was set for, read back from the sign of its rate.
 *
 * A refused cut was written at maintenance with a zero rate, so it reads back as the
 * hold it became rather than as the cut that was asked for.
 */
export function goalOf(target: { targetWeeklyChangePct: number | null }): TargetGoal {
  const pct = target.targetWeeklyChangePct ?? 0;
  return pct > 0 ? "gain" : pct < 0 ? "cut" : "hold";
}

/**
 * How far the calories may wander before a target counts as out of date.
 *
 * Roughly three kilograms of trend bodyweight at the maintenance multiplier, so the
 * morning-to-morning wobble of the trend never trips it and a real change in size does.
 */
export const TARGET_DRIFT_KCAL = 100;

/**
 * Whether the rules, asked the same question today, give a materially different
 * answer from the target in force.
 *
 * `proposal` must be the proposal for `goalOf(target)`: comparing a hold against the
 * surplus an accumulation block suggests would report a decision as drift. The
 * direction changing is always drift - a cut in force that the tendons would now
 * refuse - and the calories are compared with a tolerance rather than exactly.
 */
export function targetDrifted(target: DailyTarget, proposal: TargetProposal): boolean {
  return (
    goalOf(target) !== goalOf(proposal) ||
    Math.abs(target.kcal - proposal.kcal) > TARGET_DRIFT_KCAL
  );
}

/**
 * Whether the card should prompt for a new target.
 *
 * Two ways a target goes out of date, and only two. The block moved on after the
 * target took effect and now implies a different goal from the one in force: a gain
 * set in accumulation once realization opens. Or the rules, asked the target's own
 * goal again, now answer materially differently, which is also where tendon status
 * lands: a cut in force that the tendons would now refuse comes back as a hold.
 * A goal the owner chose against the suggestion inside the same block is neither,
 * so it stays quiet.
 *
 * "Moved on" is read off dates: the open block starting after the target took effect,
 * or, with no block open, the last one closing after it. `inForce` is the proposal
 * for `goalOf(target)`.
 */
export function targetStale(input: {
  target: DailyTarget;
  inForce: TargetProposal;
  suggestedGoal: TargetGoal;
  blockStart: string | null;
  /** The day the last block closed, only when no block is open now. */
  blockClosedOn: string | null;
}): boolean {
  const from = input.target.effectiveFrom;
  const blockChanged =
    (input.blockStart !== null && input.blockStart > from) ||
    (input.blockClosedOn !== null && input.blockClosedOn > from);
  return (
    (blockChanged && input.suggestedGoal !== goalOf(input.target)) ||
    targetDrifted(input.target, input.inForce)
  );
}

/** What is left of today's target after what has been eaten. Negative is over. */
export function remaining(
  target: DailyTarget,
  eaten: { kcal: number; proteinG: number; carbsG: number; fatG: number },
): RemainingTarget {
  return {
    kcal: target.kcal - eaten.kcal,
    proteinG: Math.round((target.proteinG - eaten.proteinG) * 10) / 10,
    carbsG: Math.round((target.carbsG - eaten.carbsG) * 10) / 10,
    fatG: Math.round((target.fatG - eaten.fatG) * 10) / 10,
  };
}
