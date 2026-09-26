import { describe, expect, it } from "vitest";
import { KCAL_PER_G } from "./macros";
import {
  DEFICIT_FRACTION,
  GAIN_PCT_PER_WEEK,
  LOSS_PCT_PER_WEEK,
  MAINTENANCE_KCAL_PER_KG,
  SURPLUS_FRACTION,
  TARGET_DRIFT_KCAL,
  cutRefusal,
  defaultGoalFor,
  goalOf,
  proposeTargets,
  remaining,
  targetDrifted,
  targetStale,
  tendonsHealthy,
  type DailyTarget,
  type TargetGoal,
  type TargetProposal,
  type TendonState,
} from "./targets";

/**
 * The phase-aware rules, which are the part of nutrition that can be wrong in a way
 * that costs training rather than accuracy.
 *
 * The two refusals get a test each, and so does the ordering between them, because a
 * refusal that names the wrong reason sends the owner off to fix the wrong thing.
 */

const BODYWEIGHT = 80;
const MAINTENANCE = BODYWEIGHT * MAINTENANCE_KCAL_PER_KG;

const healthy: TendonState[] = [
  { site: "patellar_left", worstPain: 1, protocolPhase: null },
  { site: "achilles_right", worstPain: 0, protocolPhase: null },
];

describe("defaultGoalFor", () => {
  it("puts the surplus in accumulation, where potential is built", () => {
    expect(defaultGoalFor("accumulation")).toBe("gain");
  });

  it("holds through transmutation, realization and no block at all", () => {
    expect(defaultGoalFor("transmutation")).toBe("hold");
    expect(defaultGoalFor("realization")).toBe("hold");
    expect(defaultGoalFor(null)).toBe("hold");
  });
});

describe("tendonsHealthy", () => {
  it("treats a stable 3 as coping, matching where the load cap tightens", () => {
    expect(tendonsHealthy([{ site: "patellar_left", worstPain: 3, protocolPhase: null }])).toBe(true);
    expect(tendonsHealthy([{ site: "patellar_left", worstPain: 4, protocolPhase: null }])).toBe(false);
  });

  it("treats being on a protocol as not healthy whatever today's pain says", () => {
    expect(tendonsHealthy([{ site: "patellar_left", worstPain: 0, protocolPhase: 2 }])).toBe(false);
  });

  it("is true with nothing recorded, since there is no reason to refuse", () => {
    expect(tendonsHealthy([])).toBe(true);
  });
});

describe("proposeTargets", () => {
  it("builds a surplus with protein and fat floors and carbohydrate as the remainder", () => {
    const target = proposeTargets({
      bodyweightKg: BODYWEIGHT,
      blockType: "accumulation",
      tendon: healthy,
      goal: "gain",
    });

    expect(target.direction).toBe("surplus");
    expect(target.maintenanceKcal).toBe(MAINTENANCE);
    expect(target.kcal).toBe(Math.round(MAINTENANCE * (1 + SURPLUS_FRACTION)));
    expect(target.proteinG).toBe(144);
    expect(target.fatG).toBe(80);
    expect(target.carbsG).toBe(
      Math.round(
        (target.kcal - target.proteinG * KCAL_PER_G.protein - target.fatG * KCAL_PER_G.fat) /
          KCAL_PER_G.carbs,
      ),
    );
    expect(target.targetWeeklyChangePct).toBe(GAIN_PCT_PER_WEEK);
    expect(target.cutRefusedBecause).toBeNull();
  });

  it("cuts when the block allows it and the tendons are healthy", () => {
    const target = proposeTargets({
      bodyweightKg: BODYWEIGHT,
      blockType: "transmutation",
      tendon: healthy,
      goal: "cut",
    });

    expect(target.direction).toBe("deficit");
    expect(target.kcal).toBe(Math.round(MAINTENANCE * (1 - DEFICIT_FRACTION)));
    // Protein rises in a deficit, which is the point: the ratio jumping tracks has
    // bodyweight underneath it and lean mass on top.
    expect(target.proteinG).toBe(192);
    expect(target.targetWeeklyChangePct).toBe(LOSS_PCT_PER_WEEK);
    expect(target.cutRefusedBecause).toBeNull();
  });

  it("refuses a cut during realization, because the peak is what is being protected", () => {
    const target = proposeTargets({
      bodyweightKg: BODYWEIGHT,
      blockType: "realization",
      tendon: healthy,
      goal: "cut",
    });

    expect(target.direction).toBe("hold");
    expect(target.kcal).toBe(MAINTENANCE);
    expect(target.targetWeeklyChangePct).toBe(0);
    expect(target.cutRefusedBecause).toContain("realization");
    expect(target.rationale).toContain("A cut was asked for and declined");
  });

  it("refuses a cut while a tendon is painful, and names the site", () => {
    const target = proposeTargets({
      bodyweightKg: BODYWEIGHT,
      blockType: "accumulation",
      tendon: [
        { site: "patellar_left", worstPain: 6, protocolPhase: null },
        { site: "achilles_right", worstPain: 1, protocolPhase: null },
      ],
      goal: "cut",
    });

    expect(target.direction).toBe("hold");
    expect(target.cutRefusedBecause).toContain("patellar");
    expect(target.cutRefusedBecause).toContain("6 of 10");
  });

  it("refuses a cut while a site is on a protocol, and names the phase", () => {
    const target = proposeTargets({
      bodyweightKg: BODYWEIGHT,
      blockType: "accumulation",
      tendon: [{ site: "achilles_right", worstPain: 0, protocolPhase: 2 }],
      goal: "cut",
    });
    expect(target.cutRefusedBecause).toContain("protocol phase 2");
  });

  it("names the block first when the block and the tendons both forbid a cut", () => {
    const target = proposeTargets({
      bodyweightKg: BODYWEIGHT,
      blockType: "realization",
      tendon: [{ site: "patellar_left", worstPain: 8, protocolPhase: 1 }],
      goal: "cut",
    });
    expect(target.cutRefusedBecause).toContain("realization");
    expect(target.cutRefusedBecause).not.toContain("patellar");
  });

  it("does not stand in the way of a surplus during realization", () => {
    const target = proposeTargets({
      bodyweightKg: BODYWEIGHT,
      blockType: "realization",
      tendon: [{ site: "patellar_left", worstPain: 8, protocolPhase: 1 }],
      goal: "gain",
    });
    expect(target.direction).toBe("surplus");
    expect(target.cutRefusedBecause).toBeNull();
  });

  it("prefers a measured maintenance over the per-kilogram estimate, and says which", () => {
    const measured = proposeTargets({
      bodyweightKg: BODYWEIGHT,
      blockType: null,
      tendon: healthy,
      maintenanceKcal: 3100,
      goal: "hold",
    });
    expect(measured.maintenanceKcal).toBe(3100);
    expect(measured.kcal).toBe(3100);
    expect(measured.rationale).toContain("measured");

    const estimated = proposeTargets({
      bodyweightKg: BODYWEIGHT,
      blockType: null,
      tendon: healthy,
      goal: "hold",
    });
    expect(estimated.rationale).toContain("estimated");
  });

  it("clamps carbohydrate at zero rather than reporting a negative target", () => {
    // A tiny maintenance against protein and fat floors leaves no room at all.
    const target = proposeTargets({
      bodyweightKg: BODYWEIGHT,
      blockType: null,
      tendon: healthy,
      maintenanceKcal: 800,
      goal: "hold",
    });
    expect(target.carbsG).toBe(0);
  });
});

/** A proposal written down as the target in force, the way `setTargets` stores it. */
function inForce(proposal: TargetProposal): DailyTarget {
  return {
    kcal: proposal.kcal,
    proteinG: proposal.proteinG,
    carbsG: proposal.carbsG,
    fatG: proposal.fatG,
    fluidMl: proposal.fluidMl,
    targetWeeklyChangePct: proposal.targetWeeklyChangePct,
    rationale: proposal.rationale,
    effectiveFrom: "2026-09-20",
  };
}

describe("targetDrifted", () => {
  it("stays quiet on a hold chosen during accumulation", () => {
    const held = inForce(
      proposeTargets({ bodyweightKg: BODYWEIGHT, blockType: "accumulation", tendon: healthy, goal: "hold" }),
    );
    const now = proposeTargets({
      bodyweightKg: BODYWEIGHT,
      blockType: "accumulation",
      tendon: healthy,
      goal: goalOf(held),
    });
    expect(goalOf(held)).toBe("hold");
    expect(targetDrifted(held, now)).toBe(false);
  });

  it("stays quiet when the trend moves a tenth of a kilogram overnight", () => {
    const set = inForce(
      proposeTargets({ bodyweightKg: BODYWEIGHT, blockType: "accumulation", tendon: healthy, goal: "gain" }),
    );
    const now = proposeTargets({
      bodyweightKg: BODYWEIGHT + 0.1,
      blockType: "accumulation",
      tendon: healthy,
      goal: goalOf(set),
    });
    expect(now.kcal).not.toBe(set.kcal);
    expect(targetDrifted(set, now)).toBe(false);
  });

  it("fires when bodyweight has moved enough to shift the calories past the tolerance", () => {
    const set = inForce(
      proposeTargets({ bodyweightKg: BODYWEIGHT, blockType: null, tendon: healthy, goal: "hold" }),
    );
    const kg = TARGET_DRIFT_KCAL / MAINTENANCE_KCAL_PER_KG + 1;
    const now = proposeTargets({
      bodyweightKg: BODYWEIGHT + kg,
      blockType: null,
      tendon: healthy,
      goal: goalOf(set),
    });
    expect(targetDrifted(set, now)).toBe(true);
  });

  it("fires when a cut in force would now be refused", () => {
    const cut = inForce(
      proposeTargets({ bodyweightKg: BODYWEIGHT, blockType: "transmutation", tendon: healthy, goal: "cut" }),
    );
    const flared: TendonState[] = [{ site: "patellar_left", worstPain: 6, protocolPhase: null }];
    const now = proposeTargets({
      bodyweightKg: BODYWEIGHT,
      blockType: "transmutation",
      tendon: flared,
      goal: goalOf(cut),
    });
    expect(goalOf(cut)).toBe("cut");
    expect(targetDrifted(cut, now)).toBe(true);
  });

  it("reads a refused cut back as the hold it was stored as", () => {
    const refused = inForce(
      proposeTargets({ bodyweightKg: BODYWEIGHT, blockType: "realization", tendon: healthy, goal: "cut" }),
    );
    expect(goalOf(refused)).toBe("hold");
    expect(goalOf({ targetWeeklyChangePct: null })).toBe("hold");
  });
});

describe("targetStale", () => {
  const propose = (
    blockType: "accumulation" | "realization",
    goal: TargetGoal,
    bodyweightKg = BODYWEIGHT,
  ) => proposeTargets({ bodyweightKg, blockType, tendon: healthy, goal });

  it("prompts when a gain set in accumulation meets a realization block", () => {
    const target = { ...inForce(propose("accumulation", "gain")), effectiveFrom: "2026-09-01" };
    const suggestedGoal = defaultGoalFor("realization");
    expect(suggestedGoal).toBe("hold");
    expect(
      targetStale({
        target,
        inForce: propose("realization", goalOf(target)),
        suggestedGoal,
        blockStart: "2026-09-20",
      }),
    ).toBe(true);
  });

  it("stays quiet on a hold chosen against the suggestion inside the same block", () => {
    const target = { ...inForce(propose("accumulation", "hold")), effectiveFrom: "2026-09-10" };
    const suggestedGoal = defaultGoalFor("accumulation");
    expect(suggestedGoal).toBe("gain");
    for (const kg of [BODYWEIGHT, BODYWEIGHT + 0.1]) {
      expect(
        targetStale({
          target,
          inForce: propose("accumulation", goalOf(target), kg),
          suggestedGoal,
          blockStart: "2026-09-01",
        }),
      ).toBe(false);
    }
  });

  it("stays quiet on a target set the day its block opened", () => {
    const target = { ...inForce(propose("realization", "hold")), effectiveFrom: "2026-09-20" };
    expect(
      targetStale({
        target,
        inForce: propose("realization", "hold"),
        suggestedGoal: "gain",
        blockStart: "2026-09-20",
      }),
    ).toBe(false);
  });
});

describe("cutRefusal", () => {
  it("answers ahead of time, whatever goal is in force", () => {
    expect(cutRefusal({ blockType: "realization", tendon: healthy })).toMatch(/realization/);
    expect(
      cutRefusal({
        blockType: "accumulation",
        tendon: [{ site: "achilles_right", worstPain: 1, protocolPhase: 2 }],
      }),
    ).toMatch(/protocol phase 2/);
    expect(cutRefusal({ blockType: "accumulation", tendon: healthy })).toBeNull();
  });
});

describe("remaining", () => {
  it("is what is left, and goes negative when the target is passed", () => {
    const target = {
      kcal: 2900,
      proteinG: 150,
      carbsG: 350,
      fatG: 80,
      fluidMl: 2800,
      targetWeeklyChangePct: 0.25,
      rationale: null,
      effectiveFrom: "2026-09-01",
    };
    expect(
      remaining(target, { kcal: 3000, proteinG: 120.5, carbsG: 400, fatG: 60 }),
    ).toEqual({ kcal: -100, proteinG: 29.5, carbsG: -50, fatG: 20 });
  });
});
