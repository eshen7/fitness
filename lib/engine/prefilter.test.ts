import { describe, expect, it } from "vitest";
import type { Equipment, TendonSite } from "@/lib/taxonomy";
import { AS_OF } from "./fixtures/baseline";
import { exerciseOf, FULL_GYM, idOf, STOCK } from "./fixtures/directory";
import {
  equipmentRule,
  gatedSites,
  painTrendCap,
  painTrendCaps,
  prefilter,
  tendonProtocol,
} from "./prefilter";
import type { TendonReading } from "./types";

const DAY = 86_400_000;

function reading(
  site: TendonSite,
  daysBefore: number,
  pain: number,
  protocolPhase: number | null = null,
): TendonReading {
  return {
    site,
    recordedAt: new Date(AS_OF.getTime() - daysBefore * DAY),
    painDuringLoad: pain,
    painAfterLoad: Math.max(0, pain - 1),
    morningStiffness: Math.max(0, pain - 2),
    protocolPhase,
  };
}

const candidateSlugs = (tendon: TendonReading[], equipment: readonly Equipment[] = FULL_GYM) =>
  prefilter({ exercises: STOCK, tendon, availableEquipment: equipment, asOf: AS_OF })
    .candidates.map((exercise) => exercise.slug);

describe("tendon-protocol", () => {
  it("gates a site by its latest check-in, ignoring anything after the review", () => {
    expect(gatedSites([reading("patellar_left", 3, 4, 1)], AS_OF)).toEqual(
      new Map([["patellar_left", 1]]),
    );
    expect(
      gatedSites([reading("patellar_left", 3, 4, 1), reading("patellar_left", 1, 2, null)], AS_OF),
    ).toEqual(new Map());
    expect(
      gatedSites([reading("patellar_left", 3, 4, 2), reading("patellar_left", -1, 5, 1)], AS_OF),
    ).toEqual(new Map([["patellar_left", 2]]));
  });

  it("gates nothing from phase 3 on", () => {
    expect(gatedSites([reading("achilles_left", 0, 2, 3)], AS_OF)).toEqual(new Map());
    expect(gatedSites([reading("achilles_left", 0, 2, 4)], AS_OF)).toEqual(new Map());
  });

  it("removes every exercise loading a phase 1 site except the phase 1 prescriptions", () => {
    const gated = new Map<TendonSite, number>([["patellar_left", 1]]);
    expect(tendonProtocol(exerciseOf("spanish-squat-isometric"), gated)).toBeNull();
    expect(tendonProtocol(exerciseOf("single-leg-extension-isometric"), gated)).toBeNull();
    expect(tendonProtocol(exerciseOf("slow-heavy-leg-extension"), gated)?.message).toBe(
      "Slow heavy leg extension loads the left patellar tendon, which is in protocol phase 1 (isometric loading), so it stays out of the candidate set until the tendon reaches phase 3.",
    );
    expect(tendonProtocol(exerciseOf("depth-landing"), gated)?.rule).toBe("tendon-protocol");
    // The Achilles prescriptions do not load the patellar tendon, so they are untouched.
    expect(tendonProtocol(exerciseOf("isometric-calf-hold"), gated)).toBeNull();
    expect(tendonProtocol(exerciseOf("trap-bar-deadlift"), gated)).toBeNull();
  });

  it("keeps the phase 1 and phase 2 prescriptions for a phase 2 site, and nothing later", () => {
    const gated = new Map<TendonSite, number>([["achilles_right", 2]]);
    expect(tendonProtocol(exerciseOf("isometric-calf-hold"), gated)).toBeNull();
    expect(tendonProtocol(exerciseOf("slow-heavy-calf-raise"), gated)).toBeNull();
    expect(tendonProtocol(exerciseOf("standing-calf-raise"), gated)?.message).toBe(
      "Standing calf raise loads the right Achilles, which is in protocol phase 2 (slow heavy strength), so it stays out of the candidate set until the tendon reaches phase 3.",
    );
    expect(tendonProtocol(exerciseOf("depth-landing"), gated)).not.toBeNull();
  });

  it("leaves a phase 1 knee with exactly what the protocol and the upper body allow", () => {
    const kept = candidateSlugs([reading("patellar_right", 0, 4, 1)]);
    expect(kept).toContain("spanish-squat-isometric");
    expect(kept).toContain("single-leg-extension-isometric");
    expect(kept).toContain("bench-press");
    expect(kept).toContain("pogo-hop");
    expect(kept).not.toContain("slow-heavy-leg-extension");
    expect(kept).not.toContain("back-squat");
    expect(kept).not.toContain("box-jump");
  });
});

describe("pain-trend-cap", () => {
  it("caps a site whose pain is climbing, harder the worse it has got", () => {
    const climb = (to: number) => [
      reading("achilles_left", 12, 1),
      reading("achilles_left", 6, Math.ceil((1 + to) / 2)),
      reading("achilles_left", 0, to),
    ];
    expect(painTrendCaps(climb(3), AS_OF).map((cap) => cap.cap)).toEqual([3]);
    expect(painTrendCaps(climb(5), AS_OF).map((cap) => cap.cap)).toEqual([2]);
    expect(painTrendCaps(climb(8), AS_OF).map((cap) => cap.cap)).toEqual([1]);
  });

  it("reads the worst of the three readings as the score", () => {
    const [cap] = painTrendCaps(
      [
        { ...reading("achilles_left", 10, 0), morningStiffness: 1 },
        { ...reading("achilles_left", 5, 0), morningStiffness: 2 },
        { ...reading("achilles_left", 0, 0), morningStiffness: 4 },
      ],
      AS_OF,
    );
    expect(cap).toMatchObject({ site: "achilles_left", latestScore: 4, cap: 2, readings: 3 });
  });

  it("ignores a stable level, a falling trend, and too few check-ins", () => {
    const stable = [8, 4, 0].map((d) => reading("patellar_left", d, 4));
    const falling = [8, 4, 0].map((d, i) => reading("patellar_left", d, 6 - 2 * i));
    const two = [reading("patellar_left", 4, 1), reading("patellar_left", 0, 6)];
    expect(painTrendCaps(stable, AS_OF)).toEqual([]);
    expect(painTrendCaps(falling, AS_OF)).toEqual([]);
    expect(painTrendCaps(two, AS_OF)).toEqual([]);
  });

  it("reads only the 14-day window", () => {
    const old = [reading("patellar_left", 30, 1), reading("patellar_left", 20, 3)];
    expect(painTrendCaps([...old, reading("patellar_left", 0, 6)], AS_OF)).toEqual([]);
  });

  it("removes only exercises loading the site above the cap", () => {
    const [cap] = painTrendCaps([10, 5, 0].map((d, i) => reading("achilles_right", d, 1 + 2 * i)), AS_OF);
    expect(cap.cap).toBe(2);
    expect(painTrendCap(exerciseOf("pogo-hop"), [cap])).toBeNull();
    expect(painTrendCap(exerciseOf("back-squat"), [cap])).toBeNull();
    expect(painTrendCap(exerciseOf("ankle-hop-single-leg"), [cap])?.message).toBe(
      "Single leg ankle hop loads the right Achilles at 3 of 5, above the cap of 2 set while its pain is rising.",
    );
  });
});

describe("equipment", () => {
  const gym = (items: Equipment[]) => new Set<Equipment>(items);

  it("needs everything in the list, naming what is missing", () => {
    expect(equipmentRule(exerciseOf("back-squat"), gym(["barbell", "rack"]))).toBeNull();
    expect(equipmentRule(exerciseOf("bench-press"), gym(["barbell"]))?.message).toBe(
      "Bench press is out: the bench and the rack are not available.",
    );
  });

  it("needs one of the alternatives on top", () => {
    expect(equipmentRule(exerciseOf("farmers-carry"), gym(["kettlebell"]))).toBeNull();
    expect(equipmentRule(exerciseOf("farmers-carry"), gym(["barbell"]))?.message).toBe(
      "Farmer's carry is out: it takes any one of dumbbell or kettlebell, and none of them is available.",
    );
  });

  it("treats an empty gym as bodyweight only", () => {
    const kept = candidateSlugs([], []);
    expect(kept).toContain("plank");
    expect(kept).toContain("pogo-hop");
    expect(kept).not.toContain("back-squat");
    expect(kept).not.toContain("depth-jump");
  });

  it("keeps an exercise switched off in the library out, whatever the gym holds", () => {
    expect(equipmentRule(exerciseOf("single-leg-depth-jump"), gym(FULL_GYM))?.message).toBe(
      "Single leg depth jump is out: it is marked unavailable in the library.",
    );
  });
});

describe("prefilter", () => {
  it("reports an exercise failing several rules under the tendon rule first", () => {
    const result = prefilter({
      exercises: STOCK,
      tendon: [reading("patellar_left", 0, 3, 1)],
      availableEquipment: [],
      asOf: AS_OF,
    });
    expect(result.excluded.find((e) => e.exerciseId === idOf("back-squat"))?.rule).toBe(
      "tendon-protocol",
    );
    expect(result.candidates.length + result.excluded.length).toBe(STOCK.length);
  });
});
