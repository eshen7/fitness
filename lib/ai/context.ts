import type { Db } from "@/lib/db";
import { getDb } from "@/lib/db";
import { formatContact } from "@/lib/engine/classify";
import { prefilter, type PrefilterResult } from "@/lib/engine/prefilter";
import type {
  Directory,
  EngineExercise,
  MesocycleDeclaration,
  TendonReading,
} from "@/lib/engine/types";
import { formatDay } from "@/lib/days";
import { dayOf } from "@/lib/time";
import {
  couplingClassLabels,
  equipmentLabels,
  forceVelocityLabels,
  mesocycleTypeLabels,
  motorAbilityLabels,
  movementPatternLabels,
  muscleGroupLabels,
  tendonSiteLabels,
} from "@/lib/labels";
import { assertable, type Insight } from "@/lib/analytics/insight";
import { storedInsights } from "@/lib/analytics/persist";
import { factsText, promptFacts, type MemoryFact } from "@/lib/memory/facts";
import { loadActiveFacts } from "@/lib/memory/store";
import { DOMAIN_RULES, GATE_RULES, SYSTEM_PROMPT } from "./prompts";
import {
  loadBlock,
  loadDirectory,
  loadPriorProposals,
  loadProfile,
  loadReadiness,
  loadRecentVolume,
  loadTendonReadings,
  type AthleteProfile,
  type BlockState,
  type PriorProposal,
  type ReadinessDay,
  type VolumeRow,
} from "./queries";

/**
 * Stage 1: everything the model is shown, in the order that lets it be cached.
 *
 * Two strings come out of here. `stableText` holds the system prompt, the domain
 * rules, the athlete profile and the candidate exercise table: content that is
 * identical from one generation to the next, so the provider's automatic prefix
 * cache hits it. `volatileText` holds readiness, tendon state, recent volume,
 * block state and prior verdicts, and is sent after it.
 *
 * The ordering is the whole point and it is fragile in one specific way: anything
 * that varies per call, a timestamp most of all, placed inside the stable text
 * invalidates the prefix on every request and the cache silently reads zero. So
 * no part of `stableText` may derive from the clock.
 *
 * Within the stable text the order is by how often each part changes, least first,
 * because the cache covers everything up to the first altered byte. The prompt and
 * the profile almost never move; the candidate table moves when a tendon enters
 * protocol phase 2; the remembered facts move when a reflection writes one; the
 * derived insights are recomputed nightly and so go last of all. None of the three
 * is clock-derived - each is a stored value that happens to be rewritten on its own
 * schedule - which is what lets them sit in the cached half at all.
 */

export type GenerationContext = {
  asOf: Date;
  profile: AthleteProfile;
  exercises: EngineExercise[];
  directory: Directory;
  prefiltered: PrefilterResult;
  tendon: TendonReading[];
  readiness: ReadinessDay[];
  volume: VolumeRow[];
  priorProposals: PriorProposal[];
  /** Null when declaring a block; present for every week within one. */
  block: BlockState | null;
  /** Active memory facts. `promptFacts` decides which of them the model sees. */
  facts: MemoryFact[];
  /** Only the assertable insights. A withheld statement has no business in a prompt. */
  insights: Insight[];
};

export async function loadContext(input: {
  db?: Db;
  asOf?: Date;
  mesocycleId?: number | null;
}): Promise<GenerationContext> {
  const db = input.db ?? getDb();
  const asOf = input.asOf ?? new Date();
  const [profile, directory, tendon, readiness, volume, priorProposals, facts, insights] =
    await Promise.all([
      loadProfile(db),
      loadDirectory(db),
      loadTendonReadings(28, db),
      loadReadiness(14, db),
      loadRecentVolume(28, db),
      loadPriorProposals(8, db),
      loadActiveFacts({ db }),
      storedInsights({ db }),
    ]);
  const block =
    input.mesocycleId == null ? null : await loadBlock(input.mesocycleId, db);

  return {
    asOf,
    profile,
    exercises: directory.exercises,
    directory: directory.directory,
    prefiltered: prefilter({
      exercises: directory.exercises,
      tendon,
      availableEquipment: profile.availableEquipment,
      asOf,
    }),
    tendon,
    readiness,
    volume,
    priorProposals,
    block,
    facts,
    insights: assertable(insights),
  };
}

// -----------------------------------------------------------------------------
// The stable prefix
// -----------------------------------------------------------------------------

function section(title: string, body: string) {
  return `## ${title}\n\n${body}`;
}

/**
 * One candidate exercise per line, pipe separated.
 *
 * A table rather than JSON because it is the largest thing in the prompt and the
 * field names would otherwise repeat on every one of a few hundred rows. Empty
 * columns are written as `-` so the positions stay readable when a value is null.
 */
function candidateTable(candidates: readonly EngineExercise[]) {
  const header =
    "id | name | primary group | pattern | force-velocity | laterality | coupling | contact | high impact | tendon sites | tendon load 1-5 | complexity 1-5 | protocol phase";
  const rows = candidates.map((exercise) =>
    [
      exercise.id,
      exercise.name,
      muscleGroupLabels.of(exercise.primaryMuscleGroup),
      movementPatternLabels.of(exercise.movementPattern),
      forceVelocityLabels.of(exercise.forceVelocity),
      exercise.laterality,
      couplingClassLabels.of(exercise.couplingClass),
      exercise.typicalContactSeconds === null
        ? "-"
        : formatContact(exercise.typicalContactSeconds),
      exercise.highImpact ? "yes" : "no",
      exercise.loadsTendonSites.length
        ? exercise.loadsTendonSites.map((site) => tendonSiteLabels.of(site)).join(" + ")
        : "-",
      exercise.tendonLoadRating,
      exercise.technicalComplexity,
      exercise.protocolPhase ?? "-",
    ].join(" | "),
  );
  return [header, ...rows].join("\n");
}

function profileText(profile: AthleteProfile) {
  const cm = (value: number | null) => (value === null ? "unknown" : `${value} cm`);
  const equipment = profile.availableEquipment.length
    ? profile.availableEquipment.map((item) => equipmentLabels.of(item)).join(", ")
    : "none recorded, so bodyweight only";
  return [
    `Height ${cm(profile.heightCm)}, standing reach ${cm(profile.reachCm)}, femur ${cm(profile.femurCm)}, tibia ${cm(profile.tibiaCm)}.`,
    `Training age ${profile.trainingAgeYears ?? "unknown"} years. Dominant takeoff leg ${profile.dominantTakeoffLeg}. Jumper type ${profile.jumperType}. Preferred arm swing ${profile.preferredArmSwing}.`,
    `Equipment available: ${equipment}.`,
    profile.goals.length ? `Goals: ${profile.goals.join("; ")}.` : "No goals recorded.",
  ].join("\n");
}

/**
 * The remembered facts, or a line saying there are none.
 *
 * Every active fact rather than a per-request selection, which is the decision
 * argued out in `lib/memory/facts.ts`: retrieval keyed on the request would make
 * this prefix a function of the request, and a prefix that changes every call is a
 * prefix that is never cached. At a few dozen one-sentence facts for one athlete
 * there is nothing to retrieve from anyway.
 */
function memoryText(facts: readonly MemoryFact[]) {
  const shown = promptFacts(facts);
  if (shown.length === 0) return "Nothing remembered yet.";
  return `Things the athlete said are marked stated and are not negotiable. The rest were inferred from their logs, and a plan may work around one but should not contradict it silently.\n\n${factsText(shown)}`;
}

/**
 * The insights that passed the gate, as they are written for the athlete.
 *
 * Only the assertable ones, and the statements are passed through verbatim - second
 * person and all - because they are the same strings the owner reads on the progress
 * screen. Re-rendering them for the model would eventually produce a prompt that says
 * 47 cm beside a card that says 45.
 *
 * The sample size goes on every line. The whole reason these come from
 * `lib/analytics/` rather than from the model's own reading of the logs is that each
 * one arrives with an n and an interval, and stripping those here would hand the model
 * the confident version of a claim the gate only just let through.
 */
function insightText(insights: readonly Insight[]) {
  if (insights.length === 0) {
    return "None yet. Nothing measured has cleared its sample size and its interval, so plan from the training model rather than from this athlete's numbers.";
  }
  const lines = insights.map((insight) => {
    const interval =
      insight.ciLow === null || insight.ciHigh === null
        ? ""
        : `, 95% CI ${insight.ciLow.toFixed(2)} to ${insight.ciHigh.toFixed(2)} ${insight.unit}`;
    return `- ${insight.statement} (n = ${insight.n}${interval})`;
  });
  return `Each line is addressed to the athlete and every number in it was measured, not estimated by you. Do not restate them; use them.\n\n${lines.join("\n")}`;
}

export function stableText(context: GenerationContext) {
  return [
    SYSTEM_PROMPT,
    section("Training model", DOMAIN_RULES),
    section("Hard rules", GATE_RULES),
    section("The athlete", profileText(context.profile)),
    section(
      `Candidate exercises (${context.prefiltered.candidates.length} of ${context.exercises.length})`,
      `Every exercise you prescribe must be one of these ids. The other ${context.exercises.length - context.prefiltered.candidates.length} are excluded for reasons listed in the request that follows, and naming one is a rejection.\n\n${candidateTable(context.prefiltered.candidates)}`,
    ),
    section("What the app remembers about this athlete", memoryText(context.facts)),
    section("What the numbers support saying", insightText(context.insights)),
  ].join("\n\n");
}

// -----------------------------------------------------------------------------
// The volatile suffix
// -----------------------------------------------------------------------------

function tendonText(context: GenerationContext) {
  const { loadCaps, excluded } = context.prefiltered;
  const latest = new Map<string, TendonReading>();
  for (const reading of context.tendon) {
    const held = latest.get(reading.site);
    if (!held || reading.recordedAt > held.recordedAt) latest.set(reading.site, reading);
  }
  const lines = [...latest.values()]
    .sort((a, b) => a.site.localeCompare(b.site))
    .map(
      (reading) =>
        `${tendonSiteLabels.of(reading.site)}: pain during load ${reading.painDuringLoad}/10, after load ${reading.painAfterLoad}/10, morning stiffness ${reading.morningStiffness}/10${reading.protocolPhase === null ? ", no protocol" : `, protocol phase ${reading.protocolPhase}`} (${formatDay(dayOf(reading.recordedAt))}).`,
    );
  const caps = loadCaps.map((cap) => cap.message);
  const removals = excluded.map((exclusion) => exclusion.message);
  return [
    lines.length ? lines.join("\n") : "No tendon check-ins in the last 28 days.",
    caps.length ? `\nLoad caps now in force:\n${caps.map((cap) => `- ${cap}`).join("\n")}` : "",
    removals.length
      ? `\nRemoved from the candidate set (${removals.length}):\n${removals.map((line) => `- ${line}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function readinessText(readiness: readonly ReadinessDay[]) {
  if (readiness.length === 0) return "No check-ins recorded.";
  return readiness
    .map((day) => {
      const parts = [
        day.recoveryScore === null ? null : `recovery ${day.recoveryScore}%`,
        day.hrvMs === null ? null : `HRV ${day.hrvMs} ms`,
        day.sleepMinutes === null
          ? null
          : `sleep ${Math.round(day.sleepMinutes / 60)}h${day.sleepPerformancePct === null ? "" : ` at ${day.sleepPerformancePct}%`}`,
        day.dayStrain === null ? null : `strain ${day.dayStrain}`,
        day.motivation === null ? null : `motivation ${day.motivation}/10`,
        day.priorSessionRpe === null ? null : `prior RPE ${day.priorSessionRpe}`,
      ].filter(Boolean);
      const soreness = Object.entries(day.sorenessByRegion)
        .filter(([, score]) => score > 0)
        .map(([region, score]) => `${region} ${score}/10`);
      return `${day.day}: ${parts.length ? parts.join(", ") : "no readings"}${soreness.length ? `; sore ${soreness.join(", ")}` : ""}${day.notes ? `; "${day.notes}"` : ""}`;
    })
    .join("\n");
}

function volumeText(volume: readonly VolumeRow[]) {
  if (volume.length === 0) return "Nothing logged in the last 28 days.";
  return [...volume]
    .sort((a, b) => b.sets - a.sets)
    .map(
      (row) =>
        `${muscleGroupLabels.of(row.muscleGroup)} / ${movementPatternLabels.of(row.movementPattern)}: ${row.sets} sets${row.contacts ? `, ${row.contacts} high-impact contacts` : ""}`,
    )
    .join("\n");
}

function declarationText(declaration: MesocycleDeclaration, directory: Directory) {
  const complex = declaration.complex
    .map((item) => {
      const name = directory.get(item.exerciseId)?.name ?? `exercise ${item.exerciseId}`;
      return `- ${item.exerciseId} ${name}${item.isMain ? ", main" : ""}${item.targetWeeklyFrequency ? `, ${item.targetWeeklyFrequency}x a week` : ""}`;
    })
    .join("\n");
  return [
    `Type ${mesocycleTypeLabels.of(declaration.type)}, ${declaration.plannedMicrocycles} weeks.`,
    `Targets: ${declaration.targetAbilities.map((ability) => motorAbilityLabels.of(ability)).join(" and ") || "none declared"}.`,
    `Technical focus: ${declaration.technicalFocus.join("; ") || "none declared"}.`,
    `The stable complex, which every week must draw from:\n${complex}`,
  ].join("\n");
}

function blockText(block: BlockState, directory: Directory) {
  const weeks = block.priorWeeks.length
    ? block.priorWeeks
        .map((week) => {
          const sets = week.sessions.reduce(
            (sum, session) =>
              sum +
              session.blocks.reduce(
                (blockSum, item) =>
                  blockSum + item.items.reduce((setSum, set) => setSum + set.sets, 0),
                0,
              ),
            0,
          );
          const days = week.sessions
            .map((session) => `${session.day} ${session.kind} at ${session.plannedIntensity}`)
            .join("; ");
          return `Week ${week.ordinal} from ${week.startDate}: ${week.loadType}, relative load ${week.relativeLoad.toFixed(2)}, ${sets} sets. ${days || "no sessions"}`;
        })
        .join("\n")
    : "No weeks generated yet.";
  const priorSession = block.priorSession
    ? `The last session before the new week is ${block.priorSession.day}, a ${block.priorSession.kind} session at intensity ${block.priorSession.plannedIntensity}. The back-to-back rule applies across that boundary.`
    : "";
  return [
    declarationText(block.declaration, directory),
    `\nWeeks already generated in this block:\n${weeks}`,
    priorSession,
  ]
    .filter(Boolean)
    .join("\n");
}

function verdictText(proposals: readonly PriorProposal[]) {
  if (proposals.length === 0) return "None yet.";
  return proposals
    .map((proposal) => {
      const gate = proposal.gateMessages.length
        ? ` Gate said: ${proposal.gateMessages.join(" ")}`
        : "";
      const reason = proposal.verdictReason ? ` Reason: "${proposal.verdictReason}".` : "";
      return `${proposal.scope} proposal ${proposal.id}, ${proposal.verdict} after ${proposal.repairAttempts} repair attempt${proposal.repairAttempts === 1 ? "" : "s"}${proposal.isFallback ? ", shipped as a fallback" : ""}.${reason}${gate}`;
    })
    .join("\n");
}

export function volatileText(context: GenerationContext) {
  return [
    section("Today", `The plan is being generated on ${formatDay(dayOfContext(context))}.`),
    section("Tendon state", tendonText(context)),
    section("Readiness, last 14 days", readinessText(context.readiness)),
    section("Logged volume, last 28 days", volumeText(context.volume)),
    context.block
      ? section("The open block", blockText(context.block, context.directory))
      : section("The open block", "None. You are declaring a new one."),
    section("Recent proposals and what the athlete did with them", verdictText(context.priorProposals)),
  ].join("\n\n");
}

function dayOfContext(context: GenerationContext) {
  return dayOf(context.asOf);
}

// -----------------------------------------------------------------------------

/**
 * The exact inputs, for the proposal row and the review UI.
 *
 * Stored as the rendered strings rather than as the objects behind them, because
 * the question the owner asks of a bad plan is "what did it actually see", and a
 * re-derived summary is not an answer to that.
 */
export function contextInputs(context: GenerationContext) {
  return {
    asOf: context.asOf.toISOString(),
    stable: stableText(context),
    volatile: volatileText(context),
    candidateIds: context.prefiltered.candidates.map((exercise) => exercise.id),
    excluded: context.prefiltered.excluded,
    loadCaps: context.prefiltered.loadCaps,
  };
}

export type ContextInputs = ReturnType<typeof contextInputs>;
