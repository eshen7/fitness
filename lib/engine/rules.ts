/**
 * The eighteen rules, and the mechanism that enforces each one.
 *
 * The same prescriptions are enforced four different ways, and three of them
 * cannot reject a plan at all. The pre-filter removes illegal options before the
 * model sees them, the normalizer computes every field that has exactly one right
 * answer, the gate holds only what needs structural judgment, and advisories note
 * what the ebook gives as guidance bands rather than tolerances. A gate with all
 * eighteen behind it would reject constantly, and a generator that fails often is
 * one the owner stops trusting.
 */

export const RULE_STAGES = ["prefilter", "normalize", "gate", "advisory"] as const;
export type RuleStage = (typeof RULE_STAGES)[number];

export const RULES = {
  "tendon-protocol": {
    stage: "prefilter",
    summary:
      "A site in protocol phase 1 or 2 removes every exercise loading it, apart from the protocol's own prescriptions",
  },
  "pain-trend-cap": {
    stage: "prefilter",
    summary: "Pain trending up over a rolling window caps the tendon load allowed on that site",
  },
  equipment: {
    stage: "prefilter",
    summary: "Only exercises marked available, with equipment actually reachable, are eligible",
  },
  "demand-order": {
    stage: "normalize",
    summary:
      "The most dynamic, coordination-demanding and intense work goes first, while rested",
  },
  "main-before-assistance": {
    stage: "normalize",
    summary: "Main lifts before assistance, large muscle groups before small",
  },
  "heavy-rest": {
    stage: "normalize",
    summary: "Heavy sets rest 4 to 5 minutes",
  },
  "plyo-dose": {
    stage: "normalize",
    summary: "Plyometrics run 8 to 12 reps and 3 to 6 sets",
  },
  "plyo-rest": {
    stage: "normalize",
    summary:
      "Plyometric rest is 1 to 2 minutes, 30 to 60 seconds at low intensity, and 2 to 3 minutes for shock work",
  },
  "coupling-label": {
    stage: "normalize",
    summary:
      "Coupling class follows contact time, and nothing at or above 0.15 s is labelled shock method",
  },
  "target-count": {
    stage: "gate",
    summary: "A block trains 1 or 2 target abilities plus at most 1 technical focus",
  },
  "stable-complex": {
    stage: "gate",
    summary:
      "One stable complex of roughly ten exercises, each appearing at least twice a week",
  },
  "load-not-complex": {
    stage: "gate",
    summary: "Load varies across microcycles; the exercise complex does not",
  },
  "plyo-frequency": {
    stage: "gate",
    summary: "Plyometrics on 2 to 3 days a week, fewer as intensity rises",
  },
  "back-to-back": {
    stage: "gate",
    summary:
      "Back-to-back sessions do not repeat a large muscle group or a coordination pattern",
  },
  "target-share": {
    stage: "advisory",
    summary:
      "65 to 85 percent of block volume on the targets, ideally 70 to 80, and 35 to 40 each",
  },
  "rule-of-60": {
    stage: "advisory",
    summary: "The lightest day's volume is about 60 percent of the heaviest day's",
  },
  "strength-frequency": {
    stage: "advisory",
    summary:
      "Strength work at least 3 sessions a week to gain it, or 2 of about 30 minutes to retain it",
  },
  "session-set-cap": {
    stage: "advisory",
    summary: "A session runs about 20 sets at most",
  },
} as const satisfies Record<string, { stage: RuleStage; summary: string }>;

export type RuleId = keyof typeof RULES;

export function rulesIn(stage: RuleStage) {
  return (Object.keys(RULES) as RuleId[]).filter((id) => RULES[id].stage === stage);
}
