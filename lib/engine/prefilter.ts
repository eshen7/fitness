import { equipmentLabels, PROTOCOL_PHASES } from "@/lib/labels";
import type { Equipment, TendonSite } from "@/lib/taxonomy";
import { list } from "./classify";
import type { EngineExercise, Exclusion, TendonReading } from "./types";

/**
 * Stage 1: remove every illegal option before the model sees the directory.
 *
 * These three rules cannot be violated rather than merely being checked, because
 * an exercise the model is never shown is one it cannot choose. That is strictly
 * stronger than rejecting a plan afterwards, and it is how tendon safety is
 * absolute without ever producing a rejection.
 */

export type PrefilterInput = {
  exercises: readonly EngineExercise[];
  tendon: readonly TendonReading[];
  /**
   * Taken literally: an empty list means bodyweight only. Whether the profile
   * has been filled in is the caller's question, not the engine's.
   */
  availableEquipment: readonly Equipment[];
  asOf: Date;
};

export type LoadCap = {
  site: TendonSite;
  /** The highest tendon load rating, 1 to 5, still eligible on this site. */
  cap: number;
  /** Points of pain per day over the window. */
  slope: number;
  latestScore: number;
  readings: number;
  message: string;
};

export type PrefilterResult = {
  candidates: EngineExercise[];
  excluded: Exclusion[];
  loadCaps: LoadCap[];
};

const SITE_NAMES: Record<TendonSite, string> = {
  patellar_left: "left patellar tendon",
  patellar_right: "right patellar tendon",
  achilles_left: "left Achilles",
  achilles_right: "right Achilles",
};

function phaseName(phase: number) {
  const label = PROTOCOL_PHASES.find((entry) => entry.value === String(phase))?.label;
  return label ? label.split(" - ")[1].toLowerCase() : `phase ${phase}`;
}

/** A check-in's pain score: the worst of its three readings. */
function scoreOf(reading: TendonReading) {
  return Math.max(reading.painDuringLoad, reading.painAfterLoad, reading.morningStiffness);
}

/** The latest reading per site at or before `asOf`, which is the site's state. */
function latestBySite(readings: readonly TendonReading[], asOf: Date) {
  const latest = new Map<TendonSite, TendonReading>();
  for (const reading of readings) {
    if (reading.recordedAt > asOf) continue;
    const held = latest.get(reading.site);
    if (!held || reading.recordedAt > held.recordedAt) latest.set(reading.site, reading);
  }
  return latest;
}

// -----------------------------------------------------------------------------
// tendon-protocol
// -----------------------------------------------------------------------------

/**
 * The phase each site is in, for the sites in phase 1 or 2. A site whose latest
 * check-in names no phase is not on a protocol, whatever an older one said.
 */
export function gatedSites(readings: readonly TendonReading[], asOf: Date) {
  const gated = new Map<TendonSite, number>();
  for (const [site, reading] of latestBySite(readings, asOf)) {
    if (reading.protocolPhase !== null && reading.protocolPhase <= 2) {
      gated.set(site, reading.protocolPhase);
    }
  }
  return gated;
}

/**
 * A site in protocol phase 1 or 2 removes every exercise loading it. The one
 * exception is the protocol's own prescription for that phase or an earlier one,
 * because the protocol is load management rather than rest, and removing the
 * isometrics it calls for would make it impossible to follow.
 */
export function tendonProtocol(
  exercise: EngineExercise,
  gated: ReadonlyMap<TendonSite, number>,
): Exclusion | null {
  for (const site of exercise.loadsTendonSites) {
    const phase = gated.get(site);
    if (phase === undefined) continue;
    if (exercise.protocolPhase !== null && exercise.protocolPhase <= phase) continue;
    return {
      rule: "tendon-protocol",
      exerciseId: exercise.id,
      message: `${exercise.name} loads the ${SITE_NAMES[site]}, which is in protocol phase ${phase} (${phaseName(phase)}), so it stays out of the candidate set until the tendon reaches phase 3.`,
    };
  }
  return null;
}

// -----------------------------------------------------------------------------
// pain-trend-cap
// -----------------------------------------------------------------------------

export const PAIN_WINDOW_DAYS = 14;
/** Fewer readings than this is noise, not a trend. */
export const PAIN_MIN_READINGS = 3;
/** Points of pain per day. Half a point every five days is a real climb. */
export const PAIN_RISING_SLOPE = 0.1;

/** The cap follows where the pain has got to: the worse it is, the gentler the load. */
function capFor(latestScore: number) {
  if (latestScore <= 3) return 3;
  if (latestScore <= 5) return 2;
  return 1;
}

/** Ordinary least squares slope, x in days. */
function slopeOf(points: readonly { x: number; y: number }[]) {
  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (const p of points) {
    numerator += (p.x - meanX) * (p.y - meanY);
    denominator += (p.x - meanX) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * A load cap per site whose pain is trending up over the rolling window. The
 * trend rather than the level is the signal: a stable 3 is a tendon coping with
 * its load, and a climb from 1 to 3 in a fortnight is the reactive spike the
 * continuum warns about.
 */
export function painTrendCaps(readings: readonly TendonReading[], asOf: Date): LoadCap[] {
  const from = asOf.getTime() - PAIN_WINDOW_DAYS * 86_400_000;
  const bySite = new Map<TendonSite, TendonReading[]>();
  for (const reading of readings) {
    const at = reading.recordedAt.getTime();
    if (at < from || at > asOf.getTime()) continue;
    bySite.set(reading.site, [...(bySite.get(reading.site) ?? []), reading]);
  }

  const caps: LoadCap[] = [];
  for (const [site, siteReadings] of bySite) {
    if (siteReadings.length < PAIN_MIN_READINGS) continue;
    const sorted = [...siteReadings].sort(
      (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime(),
    );
    const slope = slopeOf(
      sorted.map((reading) => ({
        x: (reading.recordedAt.getTime() - from) / 86_400_000,
        y: scoreOf(reading),
      })),
    );
    if (slope < PAIN_RISING_SLOPE) continue;
    const latestScore = scoreOf(sorted[sorted.length - 1]);
    const cap = capFor(latestScore);
    caps.push({
      site,
      cap,
      slope,
      latestScore,
      readings: sorted.length,
      message: `Pain in the ${SITE_NAMES[site]} is rising ${slope.toFixed(1)} points a day over ${sorted.length} check-ins in ${PAIN_WINDOW_DAYS} days, now ${latestScore} of 10, so exercises loading it are capped at tendon load ${cap} of 5.`,
    });
  }
  return caps.sort((a, b) => a.site.localeCompare(b.site));
}

export function painTrendCap(
  exercise: EngineExercise,
  caps: readonly LoadCap[],
): Exclusion | null {
  for (const cap of caps) {
    if (!exercise.loadsTendonSites.includes(cap.site)) continue;
    if (exercise.tendonLoadRating <= cap.cap) continue;
    return {
      rule: "pain-trend-cap",
      exerciseId: exercise.id,
      message: `${exercise.name} loads the ${SITE_NAMES[cap.site]} at ${exercise.tendonLoadRating} of 5, above the cap of ${cap.cap} set while its pain is rising.`,
    };
  }
  return null;
}

// -----------------------------------------------------------------------------
// equipment
// -----------------------------------------------------------------------------

function equipmentName(item: Equipment) {
  return equipmentLabels.of(item).toLowerCase();
}

/** The part of an exercise the equipment rule reads, which the profile screen also holds. */
export type EquipmentNeeds = Pick<
  EngineExercise,
  "id" | "name" | "available" | "equipment" | "equipmentAnyOf"
>;

/**
 * Only what is actually reachable is eligible. `equipment` is needed all
 * together, `equipmentAnyOf` needs one on top, `none` is always satisfied, and
 * an exercise switched off in the library is out whatever the gym holds.
 */
export function equipmentRule(
  exercise: EquipmentNeeds,
  available: ReadonlySet<Equipment>,
): Exclusion | null {
  const exclude = (reason: string): Exclusion => ({
    rule: "equipment",
    exerciseId: exercise.id,
    message: `${exercise.name} is out: ${reason}.`,
  });

  if (!exercise.available) return exclude("it is marked unavailable in the library");

  const missing = exercise.equipment.filter(
    (item) => item !== "none" && !available.has(item),
  );
  if (missing.length > 0) {
    const names = missing.map((item) => `the ${equipmentName(item)}`);
    return exclude(`${list(names)} ${missing.length === 1 ? "is" : "are"} not available`);
  }

  const { equipmentAnyOf } = exercise;
  if (equipmentAnyOf.length > 0 && !equipmentAnyOf.some((item) => available.has(item))) {
    const names = equipmentAnyOf.map(equipmentName).join(" or ");
    return exclude(`it takes any one of ${names}, and none of them is available`);
  }
  return null;
}

// -----------------------------------------------------------------------------

/**
 * The candidate set, and a reason for every exercise left out. An exercise
 * failing several rules is reported under the first, tendon before equipment,
 * because the tendon reason is the one the owner most needs to see.
 */
export function prefilter(input: PrefilterInput): PrefilterResult {
  const gated = gatedSites(input.tendon, input.asOf);
  const loadCaps = painTrendCaps(input.tendon, input.asOf);
  const available = new Set(input.availableEquipment);

  const candidates: EngineExercise[] = [];
  const excluded: Exclusion[] = [];
  for (const exercise of input.exercises) {
    const exclusion =
      tendonProtocol(exercise, gated) ??
      painTrendCap(exercise, loadCaps) ??
      equipmentRule(exercise, available);
    if (exclusion) excluded.push(exclusion);
    else candidates.push(exercise);
  }
  return { candidates, excluded, loadCaps };
}
