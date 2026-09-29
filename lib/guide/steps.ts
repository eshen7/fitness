/**
 * The one-time setup, as a checklist the database can answer.
 *
 * Each step is done when the row it produces exists, not when a box was ticked.
 * The profile row exists from the seed on, so its step counts once the owner has
 * saved the profile, whatever the lists hold. The order is the order they depend
 * on each other: the planner reads the profile, the food targets read the
 * bodyweight, and a week can only be generated inside a block.
 */

export type SetupFacts = {
  hasSavedProfile: boolean;
  hasBodyweight: boolean;
  hasStandingVertical: boolean;
  hasFoodTargets: boolean;
  hasBlock: boolean;
  hasWeek: boolean;
};

export const SETUP_STEPS = [
  "profile",
  "bodyweight",
  "vertical",
  "food",
  "block",
  "week",
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export function stepDone(step: SetupStep, facts: SetupFacts): boolean {
  switch (step) {
    case "profile":
      return facts.hasSavedProfile;
    case "bodyweight":
      return facts.hasBodyweight;
    case "vertical":
      return facts.hasStandingVertical;
    case "food":
      return facts.hasFoodTargets;
    case "block":
      return facts.hasBlock;
    case "week":
      return facts.hasWeek;
  }
}

export type SetupProgress = {
  done: number;
  total: number;
  /** The first step not yet done, or null once setup is complete. */
  next: SetupStep | null;
};

export function setupProgress(facts: SetupFacts): SetupProgress {
  const remaining = SETUP_STEPS.filter((step) => !stepDone(step, facts));
  return {
    done: SETUP_STEPS.length - remaining.length,
    total: SETUP_STEPS.length,
    next: remaining[0] ?? null,
  };
}

/**
 * Whether Today should offer the guide unasked.
 *
 * Only to an owner who has not finished setting up and has not said no. Once
 * setup is complete the prompt has nothing left to point at, and once dismissed
 * it stays dismissed: the guide itself is always a link away.
 */
export function offerGuide(facts: SetupFacts, dismissedAt: Date | null): boolean {
  return dismissedAt === null && setupProgress(facts).next !== null;
}

/** What each step asks for, in the words the guide and the Today prompt share. */
export const STEP_COPY: Record<SetupStep, { title: string; href: string }> = {
  profile: { title: "Set your equipment and training days", href: "/profile" },
  bodyweight: { title: "Log a morning bodyweight", href: "/log/body" },
  vertical: { title: "Test your standing vertical", href: "/log/test" },
  food: { title: "Set your food targets", href: "/nutrition" },
  block: { title: "Declare your first block", href: "/plan" },
  week: { title: "Generate and accept week 1", href: "/plan" },
};
