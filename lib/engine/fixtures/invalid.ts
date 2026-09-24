import { addDays } from "@/lib/days";
import type { TendonSite } from "@/lib/taxonomy";
import { reviewDeclaration, reviewWeek } from "../index";
import { prefilter, type PrefilterInput } from "../prefilter";
import type { RuleId } from "../rules";
import type {
  MesocycleDeclaration,
  MicrocyclePlan,
  PlannedSession,
  PlannedSet,
  TendonReading,
} from "../types";
import {
  APPROACH,
  AS_OF,
  BACK_SQUAT,
  baselineReview,
  BENCH,
  BOUND,
  DECLARATION,
  DEPTH_JUMP,
  EVERYTHING,
  PLANK,
  PULL_UP,
  TRAP_BAR,
  WEEK_START,
} from "./baseline";
import { DIRECTORY, FULL_GYM, idOf, STOCK } from "./directory";

/**
 * Deliberately invalid plans, at least one per rule.
 *
 * Each is the baseline with one edit, so every finding it produces must come
 * from the rule it names, and each carries the exact messages that rule must
 * produce. A rule that fires with a generic or wrong message fails its fixture
 * just as surely as one that does not fire at all.
 *
 * Three shapes, by where the rule runs:
 * - `prefilter` fixtures assert any load caps, then why one named exercise left
 *   the candidate set. Others may leave with it, under the same rule.
 * - `declaration` fixtures run a block declaration through the gate.
 * - `week` fixtures run a generated week through normalize, gate and advise,
 *   and assert the complete list of findings across all three.
 */

export type Finding = { rule: RuleId | "closed-set"; message: string };

type Common = {
  name: string;
  rule: RuleId | "closed-set";
  /** The exact messages, in order. */
  messages: readonly string[];
};

export type PrefilterFixture = Common & {
  stage: "prefilter";
  input: PrefilterInput;
  /** The exercise whose exclusion is asserted. */
  exerciseId: number;
};

export type DeclarationFixture = Common & {
  stage: "declaration";
  input: Parameters<typeof reviewDeclaration>[0];
};

export type WeekFixture = Common & {
  stage: "week";
  input: Parameters<typeof reviewWeek>[0];
};

export type InvalidPlan = PrefilterFixture | DeclarationFixture | WeekFixture;

// -----------------------------------------------------------------------------
// Editing helpers
// -----------------------------------------------------------------------------

const MON = 0;
const WED = 1;
const FRI = 2;

/** The baseline review with the week edited in place on a fresh copy. */
function editWeek(
  edit: (week: MicrocyclePlan) => void,
  overrides: Partial<ReturnType<typeof baselineReview>> = {},
) {
  const review = { ...baselineReview(), ...overrides };
  const week = structuredClone(review.week);
  edit(week);
  return { ...review, week };
}

function block(session: PlannedSession, label: string) {
  const found = session.blocks.find((candidate) => candidate.label === label);
  if (!found) throw new Error(`No "${label}" block on ${session.day}.`);
  return found;
}

function item(session: PlannedSession, exerciseId: number): PlannedSet {
  for (const candidate of session.blocks.flatMap((b) => b.items)) {
    if (candidate.exerciseId === exerciseId) return candidate;
  }
  throw new Error(`Exercise ${exerciseId} is not on ${session.day}.`);
}

function removeItem(session: PlannedSession, exerciseId: number) {
  for (const b of session.blocks) b.items = b.items.filter((i) => i.exerciseId !== exerciseId);
  session.blocks = session.blocks.filter((b) => b.items.length > 0);
}

function declare(edit: Partial<MesocycleDeclaration>): MesocycleDeclaration {
  return { ...structuredClone(DECLARATION), ...edit };
}

function reading(
  site: TendonSite,
  daysBefore: number,
  pain: number,
  protocolPhase: number | null = null,
): TendonReading {
  return {
    site,
    recordedAt: new Date(AS_OF.getTime() - daysBefore * 86_400_000),
    painDuringLoad: pain,
    painAfterLoad: pain,
    morningStiffness: pain,
    protocolPhase,
  };
}

function prefilterWith(input: Partial<PrefilterInput>): PrefilterInput {
  return {
    exercises: STOCK,
    tendon: [],
    availableEquipment: FULL_GYM,
    asOf: AS_OF,
    ...input,
  };
}

// -----------------------------------------------------------------------------
// The fixtures
// -----------------------------------------------------------------------------

export const INVALID_PLANS: readonly InvalidPlan[] = [
  // --- prefilter -------------------------------------------------------------
  {
    name: "a back squat while the left patellar tendon is in protocol phase 1",
    stage: "prefilter",
    rule: "tendon-protocol",
    exerciseId: BACK_SQUAT,
    input: prefilterWith({ tendon: [reading("patellar_left", 1, 4, 1)] }),
    messages: [
      "Back squat loads the left patellar tendon, which is in protocol phase 1 (isometric loading), so it stays out of the candidate set until the tendon reaches phase 3.",
    ],
  },
  {
    name: "a depth jump while right Achilles pain climbs 1, 3, 5 over ten days",
    stage: "prefilter",
    rule: "pain-trend-cap",
    exerciseId: DEPTH_JUMP,
    input: prefilterWith({
      tendon: [
        reading("achilles_right", 10, 1),
        reading("achilles_right", 5, 3),
        reading("achilles_right", 0, 5),
      ],
    }),
    messages: [
      "Pain in the right Achilles is rising 0.4 points a day over 3 check-ins in 14 days, now 5 of 10, so exercises loading it are capped at tendon load 2 of 5.",
      "Depth jump loads the right Achilles at 5 of 5, above the cap of 2 set while its pain is rising.",
    ],
  },
  {
    name: "a back squat with no rack",
    stage: "prefilter",
    rule: "equipment",
    exerciseId: BACK_SQUAT,
    input: prefilterWith({ availableEquipment: FULL_GYM.filter((item) => item !== "rack") }),
    messages: [
      "Back squat is out: the rack is not available.",
    ],
  },

  // --- normalize -------------------------------------------------------------
  {
    name: "Monday's strength block ahead of its jumps",
    stage: "week",
    rule: "demand-order",
    input: editWeek((week) => {
      const mon = week.sessions[MON];
      mon.blocks = [block(mon, "Strength"), block(mon, "Jumps"), block(mon, "Core")];
    }),
    messages: [
      "Two foot approach jump moved from 3rd to 1st: the most dynamic work goes first, while rested.",
      "Depth jump moved from 4th to 2nd: the most dynamic work goes first, while rested.",
      "Alternate leg bound moved from 5th to 3rd: the most dynamic work goes first, while rested.",
    ],
  },
  {
    name: "Wednesday opening on pull-ups ahead of the main lifts",
    stage: "week",
    rule: "main-before-assistance",
    input: editWeek((week) => {
      const strength = block(week.sessions[WED], "Strength");
      strength.items = [
        item(week.sessions[WED], PULL_UP),
        ...strength.items.filter((i) => i.exerciseId !== PULL_UP),
      ];
    }),
    messages: [
      "Back squat moved from 2nd to 1st: main lifts go before assistance.",
      "Trap bar deadlift moved from 3rd to 2nd: main lifts go before assistance.",
      "Bench press moved from 4th to 3rd: main lifts go before assistance.",
    ],
  },
  {
    name: "heavy squats on two minutes' rest",
    stage: "week",
    rule: "heavy-rest",
    input: editWeek((week) => {
      item(week.sessions[MON], BACK_SQUAT).restSeconds = 120;
    }),
    messages: [
      "Back squat rest raised from 2 min to 4 min: heavy sets rest 4 to 5 minutes.",
    ],
  },
  {
    name: "depth jumps in sets of 15",
    stage: "week",
    rule: "plyo-dose",
    input: editWeek((week) => {
      item(week.sessions[MON], DEPTH_JUMP).reps = 15;
    }),
    messages: [
      "Depth jump lowered from 15 to 12 reps: plyometrics run 8 to 12.",
    ],
  },
  {
    name: "shock-method depth jumps on a minute's rest",
    stage: "week",
    rule: "plyo-rest",
    input: editWeek((week) => {
      item(week.sessions[MON], DEPTH_JUMP).restSeconds = 60;
    }),
    messages: [
      "Depth jump rest raised from 1 min to 2 min: shock-method work rests 2 to 3 minutes.",
    ],
  },
  {
    name: "bounds labelled long SSC and approach jumps labelled shock method",
    stage: "week",
    rule: "coupling-label",
    input: editWeek((week) => {
      item(week.sessions[MON], BOUND).couplingClass = "long_ssc";
      item(week.sessions[MON], APPROACH).shockMethod = true;
    }),
    messages: [
      "Two foot approach jump is not a shock-method drill, so it is not labelled shock method.",
      "Alternate leg bound contacts the ground for 0.17 s, a short SSC under 250 ms: labelled Short SSC rather than Long SSC.",
    ],
  },

  // --- gate ------------------------------------------------------------------
  {
    name: "a block with three target abilities and two technical focuses",
    stage: "declaration",
    rule: "target-count",
    input: {
      declaration: declare({
        targetAbilities: ["max_strength", "reactive_strength", "speed_strength"],
        technicalFocus: ["Penultimate step: low and long", "Arm swing: pendulum"],
      }),
      directory: DIRECTORY,
      prefiltered: EVERYTHING,
    },
    messages: [
      "The block declares 3 target abilities (max strength, reactive strength and speed strength). A block trains 1 or 2, because gains drop when several abilities are trained at once; sequence the rest across later blocks.",
      "The block declares 2 technical focuses (Penultimate step: low and long and Arm swing: pendulum). A block carries at most 1 technical feature alongside its targets.",
    ],
  },
  {
    name: "a complex of six exercises",
    stage: "declaration",
    rule: "stable-complex",
    input: {
      declaration: declare({
        complex: DECLARATION.complex.filter(
          (entry) => entry.exerciseId !== PULL_UP && entry.exerciseId !== PLANK,
        ),
      }),
      directory: DIRECTORY,
      prefiltered: EVERYTHING,
    },
    messages: [
      "The complex holds 6 exercises. A block runs one stable complex of roughly ten, 8 to 12, so add 2 or more.",
    ],
  },
  {
    name: "a strength block whose complex holds no plyometric",
    stage: "declaration",
    rule: "plyo-frequency",
    input: {
      declaration: declare({
        complex: [
          ...DECLARATION.complex.filter(
            (entry) => ![APPROACH, DEPTH_JUMP, BOUND].includes(entry.exerciseId),
          ),
          { exerciseId: idOf("front-squat"), isMain: false },
          { exerciseId: idOf("romanian-deadlift"), isMain: false },
          { exerciseId: idOf("hip-thrust"), isMain: false },
        ],
      }),
      directory: DIRECTORY,
      prefiltered: EVERYTHING,
    },
    messages: [
      "The complex holds no plyometric. Plyometrics need 2 to 3 days a week, and a week may not bring in exercises from outside the complex, so add at least one.",
    ],
  },
  {
    name: "bench press trained on Monday only",
    stage: "week",
    rule: "stable-complex",
    input: editWeek((week) => removeItem(week.sessions[WED], BENCH)),
    messages: [
      "Bench press appears on 1 day (Mon 21 Sept) this week. Each complex exercise appears at least twice a week.",
    ],
  },
  {
    name: "Romanian deadlifts brought in from outside the complex",
    stage: "week",
    rule: "load-not-complex",
    input: editWeek((week) => {
      const strength = block(week.sessions[WED], "Strength");
      const at = strength.items.findIndex((i) => i.exerciseId === PULL_UP);
      strength.items.splice(at, 0, {
        exerciseId: idOf("romanian-deadlift"),
        sets: 2,
        reps: 8,
        loadPctOf1rm: 65,
        restSeconds: 120,
      });
    }),
    messages: [
      "Romanian deadlift is not in the block's complex. Load varies within a block, the exercises do not.",
    ],
  },
  {
    name: "week 2 repeating week 1's load and volume",
    stage: "week",
    rule: "load-not-complex",
    input: editWeek((week) => {
      week.relativeLoad = 0.8;
    }),
    messages: [
      "Week 2 repeats week 1's load: relative load 0.80 against 0.80, and 48 sets against 48. A constant stimulus decays in effect, so move relative load by at least 0.05 or volume by at least 10%.",
    ],
  },
  {
    name: "approach jumps added on Wednesday, a third plyometric day in a shock week",
    stage: "week",
    rule: "plyo-frequency",
    input: editWeek((week) => {
      const wed = week.sessions[WED];
      wed.blocks.unshift({
        label: "Jumps",
        items: [{ ...item(week.sessions[MON], APPROACH) }],
      });
    }),
    messages: [
      "Plyometrics on 3 days (Mon 21 Sept, Wed 23 Sept and Fri 25 Sept) in a week with shock-method work (Depth jump on Mon 21 Sept). At that intensity the ceiling is 2 days a week, because frequency runs inverse to intensity.",
    ],
  },
  {
    name: "Friday's session moved to Thursday, the day after Wednesday's",
    stage: "week",
    rule: "back-to-back",
    input: editWeek((week) => {
      week.sessions[FRI].day = addDays(WEEK_START, 3);
    }),
    messages: [
      "Wed 23 Sept and Thu 24 Sept are back to back. Both train the knee extensors, posterior chain and upper pull, and both repeat the \"Hinge\" and \"Pull, vertical\" patterns (Depth jump, Alternate leg bound, Trap bar deadlift and Pull up on Thu 24 Sept). Back-to-back sessions must not repeat a large muscle group or a coordination pattern.",
    ],
  },

  // --- advisory --------------------------------------------------------------
  {
    name: "a strength and hypertrophy block run on a jump-heavy week",
    stage: "week",
    rule: "target-share",
    input: editWeek(() => {}, {
      declaration: declare({ targetAbilities: ["max_strength", "hypertrophy"] }),
    }),
    messages: [
      "52% of block volume so far is on the targets (max strength and hypertrophy). Aim for 70 to 80%: below 65% the targets are diluted by everything else.",
      "Hypertrophy has 15% of block volume so far. With two targets each takes about 35 to 40%.",
    ],
  },
  {
    name: "Wednesday loaded up to 80% of Monday",
    stage: "week",
    rule: "rule-of-60",
    input: editWeek((week) => {
      item(week.sessions[WED], BACK_SQUAT).sets = 5;
      item(week.sessions[WED], TRAP_BAR).sets = 5;
    }),
    messages: [
      "The lightest day (Wed 23 Sept, 16 sets) is 80% of the heaviest (Mon 21 Sept, 20 sets). The rule of 60% puts it near 60%, so lighten the light day or load the heavy one.",
    ],
  },
  {
    name: "a strength block with two strength days",
    stage: "week",
    rule: "strength-frequency",
    input: editWeek((week) => {
      const sets = (session: PlannedSession, counts: Record<number, number>) => {
        for (const i of session.blocks.flatMap((b) => b.items)) i.sets = counts[i.exerciseId];
      };
      const [mon, wed, fri] = week.sessions;
      // Friday takes on every complex exercise so each still appears twice.
      fri.blocks = [
        block(fri, "Jumps"),
        {
          label: "Strength",
          items: [
            item(fri, TRAP_BAR),
            { ...item(mon, BACK_SQUAT), loadPctOf1rm: 80 },
            { ...item(mon, BENCH), loadPctOf1rm: 75 },
            item(fri, PULL_UP),
          ],
        },
        { label: "Core", items: [item(wed, PLANK)] },
      ];
      block(mon, "Strength").items.splice(1, 0, { ...item(fri, TRAP_BAR) });
      block(mon, "Strength").items.push({ ...item(wed, PULL_UP) });
      sets(mon, {
        [APPROACH]: 3,
        [DEPTH_JUMP]: 3,
        [BOUND]: 3,
        [BACK_SQUAT]: 5,
        [TRAP_BAR]: 3,
        [BENCH]: 2,
        [PULL_UP]: 2,
        [PLANK]: 1,
      });
      sets(fri, {
        [APPROACH]: 3,
        [DEPTH_JUMP]: 3,
        [BOUND]: 3,
        [BACK_SQUAT]: 1,
        [TRAP_BAR]: 1,
        [BENCH]: 1,
        [PULL_UP]: 1,
        [PLANK]: 1,
      });
      week.sessions = [mon, fri];
    }),
    messages: [
      "Strength work on 2 days (Mon 21 Sept and Fri 25 Sept). The block targets strength, and gaining it takes heavy resistance training at least 3 times a week.",
    ],
  },
  {
    name: "Monday padded to 24 sets with extra planks",
    stage: "week",
    rule: "session-set-cap",
    input: editWeek((week) => {
      item(week.sessions[MON], PLANK).sets = 6;
      item(week.sessions[WED], PLANK).sets = 4;
    }),
    messages: [
      "Mon 21 Sept runs 24 sets. The most intense sessions run about 20, because the aim is as much work as possible while staying as fresh as possible.",
    ],
  },

  // --- closed set ------------------------------------------------------------
  {
    name: "a plan written before the left patellar tendon went into phase 2",
    stage: "week",
    rule: "closed-set",
    input: editWeek(() => {}, {
      prefiltered: prefilter(prefilterWith({ tendon: [reading("patellar_left", 0, 3, 2)] })),
    }),
    messages: [
      "Two foot approach jump is not in the candidate set. Two foot approach jump loads the left patellar tendon, which is in protocol phase 2 (slow heavy strength), so it stays out of the candidate set until the tendon reaches phase 3.",
      "Depth jump is not in the candidate set. Depth jump loads the left patellar tendon, which is in protocol phase 2 (slow heavy strength), so it stays out of the candidate set until the tendon reaches phase 3.",
      "Alternate leg bound is not in the candidate set. Alternate leg bound loads the left patellar tendon, which is in protocol phase 2 (slow heavy strength), so it stays out of the candidate set until the tendon reaches phase 3.",
      "Back squat is not in the candidate set. Back squat loads the left patellar tendon, which is in protocol phase 2 (slow heavy strength), so it stays out of the candidate set until the tendon reaches phase 3.",
    ],
  },
  {
    name: "an exercise the directory does not hold",
    stage: "week",
    rule: "closed-set",
    input: editWeek((week) => {
      block(week.sessions[WED], "Core").items.push({ exerciseId: 9999, sets: 2, reps: 10 });
    }),
    messages: [
      "Exercise 9999 is not in the directory. The directory is a closed set, so file a suggested addition rather than inventing one.",
    ],
  },
];

// -----------------------------------------------------------------------------

/** Every finding a fixture produces, across whichever stages it runs. */
export function findingsOf(fixture: InvalidPlan): Finding[] {
  switch (fixture.stage) {
    case "prefilter": {
      const result = prefilter(fixture.input);
      return [
        ...result.loadCaps.map((cap) => ({ rule: "pain-trend-cap" as const, message: cap.message })),
        ...result.excluded.filter((exclusion) => exclusion.exerciseId === fixture.exerciseId),
      ];
    }
    case "declaration":
      return reviewDeclaration(fixture.input).violations;
    case "week": {
      const review = reviewWeek(fixture.input);
      return [...review.changes, ...review.violations, ...review.advisories];
    }
  }
}
