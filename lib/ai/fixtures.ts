import { prefilter } from "@/lib/engine/prefilter";
import { DIRECTORY, FULL_GYM, STOCK } from "@/lib/engine/fixtures/directory";
import { AS_OF, DECLARATION, priorSession, priorWeek } from "@/lib/engine/fixtures/baseline";
import type { MesocycleDeclaration, TendonReading } from "@/lib/engine/types";
import type { GenerationContext } from "./context";
import type { AthleteProfile, BlockState, PriorProposal, ReadinessDay, VolumeRow } from "./queries";

/**
 * A realistic `GenerationContext` with no database behind it.
 *
 * The pipeline's own tests are about the loop - propose, gate, repair, fall back -
 * and none of that needs Postgres: `loadContext` is the only part that reads one,
 * and it produces a plain object. Building that object here means the generation
 * tests run in CI, which starts no database, rather than being the one suite that
 * has to be skipped.
 *
 * The athlete is deliberately not a blank slate. An empty profile means no
 * equipment, which the pre-filter reads as bodyweight only, and a candidate set of
 * push-ups would make every assertion about exercise selection vacuous.
 */

export const FIXTURE_PROFILE: AthleteProfile = {
  displayName: "Owner",
  heightCm: 183,
  reachCm: 241,
  femurCm: 47,
  tibiaCm: 42,
  trainingAgeYears: 6,
  dominantTakeoffLeg: "left",
  jumperType: "power",
  preferredArmSwing: "pendulum",
  goals: ["Dunk two-handed off two feet", "Raise standing vertical to 34 inches"],
  availableEquipment: FULL_GYM,
  // Monday, Wednesday, Friday, Saturday.
  trainableWeekdays: [1, 3, 5, 6],
};

/** Two weeks of plausible readiness, ending the day the context is assembled. */
export const FIXTURE_READINESS: ReadinessDay[] = [
  { recoveryScore: 68, hrvMs: 82, sleepMinutes: 447, motivation: 7, priorSessionRpe: 8 },
  { recoveryScore: 74, hrvMs: 91, sleepMinutes: 471, motivation: 8, priorSessionRpe: null },
  { recoveryScore: 61, hrvMs: 74, sleepMinutes: 402, motivation: 6, priorSessionRpe: 7.5 },
  { recoveryScore: 80, hrvMs: 97, sleepMinutes: 492, motivation: 8, priorSessionRpe: null },
  { recoveryScore: 77, hrvMs: 93, sleepMinutes: 468, motivation: 7, priorSessionRpe: 8.5 },
].map((day, index) => ({
  day: dayKey(AS_OF, index - 4),
  recoveryScore: day.recoveryScore,
  hrvMs: day.hrvMs,
  restingHeartRate: 52,
  sleepMinutes: day.sleepMinutes,
  sleepPerformancePct: 88,
  dayStrain: 13.4,
  motivation: day.motivation,
  priorSessionRpe: day.priorSessionRpe,
  sorenessByRegion: (index === 2 ? { knee_extensors: 4 } : {}) as Record<string, number>,
  notes: null,
}));

export const FIXTURE_VOLUME: VolumeRow[] = [
  { muscleGroup: "knee_extensors", movementPattern: "squat", sets: 34, contacts: 0 },
  { muscleGroup: "posterior_chain", movementPattern: "hinge", sets: 26, contacts: 0 },
  { muscleGroup: "full_body", movementPattern: "jump_bilateral", sets: 18, contacts: 288 },
  { muscleGroup: "lower_leg", movementPattern: "depth_drop", sets: 12, contacts: 176 },
  { muscleGroup: "upper_push", movementPattern: "push_horizontal", sets: 20, contacts: 0 },
  { muscleGroup: "upper_pull", movementPattern: "pull_vertical", sets: 20, contacts: 0 },
  { muscleGroup: "core", movementPattern: "brace", sets: 12, contacts: 0 },
];

/**
 * A tendon reading. Defaults are a healthy tendon, so a test that cares about one
 * site names only the numbers it is changing.
 */
export function tendonReading(input: {
  site: TendonReading["site"];
  painDuringLoad?: number;
  painAfterLoad?: number;
  morningStiffness?: number;
  protocolPhase?: number | null;
  daysAgo?: number;
}): TendonReading {
  return {
    site: input.site,
    recordedAt: new Date(AS_OF.getTime() - (input.daysAgo ?? 0) * 86_400_000),
    painDuringLoad: input.painDuringLoad ?? 1,
    painAfterLoad: input.painAfterLoad ?? 1,
    morningStiffness: input.morningStiffness ?? 1,
    protocolPhase: input.protocolPhase ?? null,
  };
}

/** The open block the weekly generator plans inside, week 1 already written. */
export function fixtureBlock(
  declaration: MesocycleDeclaration = DECLARATION,
): BlockState {
  return {
    mesocycleId: 1,
    macrocycleId: 1,
    startDate: priorWeek().startDate,
    ordinal: 1,
    declaration,
    priorWeeks: [priorWeek()],
    priorSession: priorSession(),
  };
}

export function fixtureContext(
  overrides: Partial<GenerationContext> & { tendon?: TendonReading[] } = {},
): GenerationContext {
  const tendon = overrides.tendon ?? [];
  const profile = overrides.profile ?? FIXTURE_PROFILE;
  const asOf = overrides.asOf ?? AS_OF;
  return {
    asOf,
    profile,
    exercises: [...STOCK],
    directory: DIRECTORY,
    // Derived rather than passed, so a test that injects tendon pain gets the
    // candidate set that pain implies instead of one it had to compute itself.
    prefiltered:
      overrides.prefiltered ??
      prefilter({
        exercises: STOCK,
        tendon,
        availableEquipment: profile.availableEquipment,
        asOf,
      }),
    tendon,
    readiness: overrides.readiness ?? FIXTURE_READINESS,
    volume: overrides.volume ?? FIXTURE_VOLUME,
    priorProposals: overrides.priorProposals ?? FIXTURE_PROPOSALS,
    block: overrides.block === undefined ? null : overrides.block,
    // Empty by default. Memory and insights are additive context, so the fixture that
    // exercises the pipeline should see the prompt an athlete gets on their first week
    // rather than one carrying facts no test asked for.
    facts: overrides.facts ?? [],
    insights: overrides.insights ?? [],
  };
}

export const FIXTURE_PROPOSALS: PriorProposal[] = [
  {
    id: 7,
    scope: "microcycle",
    createdAt: new Date(AS_OF.getTime() - 7 * 86_400_000),
    verdict: "accepted",
    verdictReason: null,
    rationale: "Week 1 of the block, easing into the complex.",
    repairAttempts: 0,
    isFallback: false,
    gateMessages: [],
  },
];

function dayKey(from: Date, offsetDays: number) {
  return new Date(from.getTime() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}
