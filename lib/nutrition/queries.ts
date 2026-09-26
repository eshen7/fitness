import { and, asc, desc, eq, gte, isNotNull, isNull, lte, or } from "drizzle-orm";
import { hasApiKey } from "@/lib/ai/client";
import { SPEND_CAP_USD } from "@/lib/ai/pricing";
import { totalSpendUsd } from "@/lib/ai/proposals";
import { loadOpenBlock } from "@/lib/ai/queries";
import { getDb, schema, type Db } from "@/lib/db";
import { getUnitSystem, latestTendonBySite } from "@/lib/log/queries";
import { bodyweightOn, bodyweightTrend } from "@/lib/progress/derive";
import type { FoodUnit, MealSlot, MesocycleType, UnitSystem } from "@/lib/taxonomy";
import { MEAL_SLOTS } from "@/lib/taxonomy";
import { dayMinus, dayOf, today } from "@/lib/time";
import {
  decodePerUnit,
  macrosAddUp,
  scaleMacros,
  sumMacros,
  type Macros,
} from "./macros";
import {
  cutRefusal,
  defaultGoalFor,
  goalOf,
  proposeTargets,
  targetStale,
  remaining,
  type DailyTarget,
  type RemainingTarget,
  type TargetGoal,
  type TargetProposal,
  type TendonState,
} from "./targets";
import { hasLoggedFood } from "./store";
import {
  rateVerdict,
  targetPath,
  weeklyChangePct,
  type RateVerdict,
  type WeightPoint,
} from "./trend";

/**
 * Everything the nutrition screens read.
 *
 * Same division as `lib/progress/queries.ts`: the reading is here, and every
 * decision about what the numbers mean is in the pure modules beside it -
 * `macros.ts` for the sums, `targets.ts` for what the targets should be, `trend.ts`
 * for whether bodyweight is moving at the rate asked for. One athlete's food log is
 * a few thousand rows, so a day is pulled and summed in TypeScript rather than
 * aggregated in SQL that nobody can read next year.
 */

export type LoggedItem = {
  id: number;
  foodId: number;
  name: string;
  unit: FoodUnit;
  quantity: number;
  meal: MealSlot;
  /** `perUnit` times `quantity`: what the totals sum. */
  macros: Macros;
  perUnit: Macros;
  provenance: string;
  /** The sentence this row came from, so a whole meal can be deleted or re-logged. */
  rawText: string | null;
  loggedAt: Date;
  /** The food's own calories disagree with its own macros. Shown, not corrected. */
  suspectMacros: boolean;
};

export type MealGroup = {
  meal: MealSlot;
  items: LoggedItem[];
  totals: Macros;
};

export async function dayLog(day: string, db: Db = getDb()): Promise<LoggedItem[]> {
  const { foodLogEntries, foods } = schema;
  const rows = await db
    .select({
      id: foodLogEntries.id,
      foodId: foods.id,
      name: foods.name,
      unit: foods.unit,
      quantity: foodLogEntries.quantity,
      meal: foodLogEntries.meal,
      rawText: foodLogEntries.rawText,
      loggedAt: foodLogEntries.loggedAt,
      provenance: foods.provenance,
      kcalPerUnit: foods.kcalPerUnit,
      proteinGPerUnit: foods.proteinGPerUnit,
      carbsGPerUnit: foods.carbsGPerUnit,
      fatGPerUnit: foods.fatGPerUnit,
      fiberGPerUnit: foods.fiberGPerUnit,
    })
    .from(foodLogEntries)
    .innerJoin(foods, eq(foods.id, foodLogEntries.foodId))
    .where(eq(foodLogEntries.day, day))
    .orderBy(asc(foodLogEntries.loggedAt), asc(foodLogEntries.id));

  return rows.map((row): LoggedItem => {
    const perUnit = decodePerUnit(row);
    const quantity = Number(row.quantity);
    return {
      id: row.id,
      foodId: row.foodId,
      name: row.name,
      unit: row.unit as FoodUnit,
      quantity,
      meal: row.meal,
      macros: scaleMacros(perUnit, quantity),
      perUnit,
      provenance: row.provenance,
      rawText: row.rawText,
      loggedAt: row.loggedAt,
      suspectMacros: !macrosAddUp(perUnit),
    };
  });
}

/** The day grouped into meals, in the order meals happen, empty ones dropped. */
export function groupByMeal(items: readonly LoggedItem[]): MealGroup[] {
  return MEAL_SLOTS.map((meal) => {
    const inMeal = items.filter((item) => item.meal === meal);
    return { meal, items: inMeal, totals: sumMacros(inMeal.map((item) => item.macros)) };
  }).filter((group) => group.items.length > 0);
}

/**
 * One sentence's worth of a meal, which is the grain the owner typed in.
 *
 * Keyed by the instant every entry of one resolution shares, so a group is exactly
 * what `deleteFoodEntry` removes at `sentence` scope and what `repeatEntry` re-logs.
 * The same sentence typed twice in one day is two groups, because it was two meals.
 */
export type SentenceGroup = {
  key: string;
  rawText: string | null;
  items: LoggedItem[];
  totals: Macros;
};

export function groupBySentence(items: readonly LoggedItem[]): SentenceGroup[] {
  const groups = new Map<string, LoggedItem[]>();
  for (const item of items) {
    const key = item.loggedAt.toISOString();
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()].map(([key, inGroup]) => ({
    key,
    rawText: inGroup[0].rawText,
    items: inGroup,
    totals: sumMacros(inGroup.map((item) => item.macros)),
  }));
}

/**
 * The target in force on a day.
 *
 * Ranges rather than one current row, because a target is a decision made on a date
 * and yesterday's totals have to be read against yesterday's target. Ties are broken
 * by the newest row, which is what a target set twice in one day means.
 */
export async function activeTarget(
  day: string,
  db: Db = getDb(),
): Promise<DailyTarget | null> {
  const { nutritionTargets } = schema;
  const [row] = await db
    .select()
    .from(nutritionTargets)
    .where(
      and(
        lte(nutritionTargets.effectiveFrom, day),
        or(isNull(nutritionTargets.effectiveTo), gte(nutritionTargets.effectiveTo, day)),
      ),
    )
    .orderBy(desc(nutritionTargets.effectiveFrom), desc(nutritionTargets.id))
    .limit(1);
  if (!row) return null;

  return {
    kcal: row.kcal,
    proteinG: row.proteinG,
    carbsG: row.carbsG,
    fatG: row.fatG,
    fluidMl: row.fluidMl,
    targetWeeklyChangePct:
      row.targetWeeklyChangePct === null ? null : Number(row.targetWeeklyChangePct),
    rationale: row.rationale,
    effectiveFrom: row.effectiveFrom,
  };
}

/** Raw bodyweight readings over a window, oldest first. */
async function bodyweightReadings(days: number, db: Db): Promise<WeightPoint[]> {
  const rows = await db
    .select({ value: schema.measurements.value, measuredAt: schema.measurements.measuredAt })
    .from(schema.measurements)
    .where(
      and(
        eq(schema.measurements.kind, "bodyweight"),
        gte(schema.measurements.measuredAt, new Date(`${dayMinus(days)}T00:00:00Z`)),
      ),
    )
    .orderBy(asc(schema.measurements.measuredAt));
  return rows.map((row) => ({ day: dayOf(row.measuredAt), kg: Number(row.value) }));
}

/** The tendon state the target rules gate a cut on. */
async function tendonStates(): Promise<TendonState[]> {
  const latest = await latestTendonBySite();
  return [...latest.values()].map((snapshot) => ({
    site: snapshot.site,
    worstPain: Math.max(
      snapshot.painDuringLoad,
      snapshot.painAfterLoad,
      snapshot.morningStiffness,
    ),
    protocolPhase: snapshot.protocolPhase,
  }));
}

export type WeightView = {
  /** Every morning reading in the window, drawn as dots. */
  readings: WeightPoint[];
  /** Smoothed, which is the line and the thing the rate is measured on. */
  trend: WeightPoint[];
  /** What the target implies, from the day the target took effect. */
  path: WeightPoint[];
  measuredPct: number | null;
  targetPct: number | null;
  verdict: RateVerdict;
};

/**
 * Bodyweight against the target rate of change.
 *
 * The path starts on the day the target took effect rather than at the left edge of
 * the chart, because a target set last week says nothing about the month before it,
 * and a line drawn back through that month would read as a goal that was missed.
 */
function weightView(input: {
  readings: WeightPoint[];
  target: DailyTarget | null;
  day: string;
}): WeightView {
  const trend = bodyweightTrend([...input.readings]);
  const measuredPct = weeklyChangePct(trend, { asOf: input.day });
  const targetPct = input.target?.targetWeeklyChangePct ?? null;

  const from =
    input.target && input.target.effectiveFrom > (trend[0]?.day ?? input.target.effectiveFrom)
      ? input.target.effectiveFrom
      : (trend[0]?.day ?? null);
  const startKg = from === null ? null : bodyweightOn(trend, from);
  const path =
    from === null || startKg === null || targetPct === null
      ? []
      : targetPath({ from, to: input.day, startKg, pctPerWeek: targetPct });

  return {
    readings: input.readings,
    trend,
    path,
    measuredPct,
    targetPct,
    verdict: rateVerdict(measuredPct, targetPct),
  };
}

export type NutritionSnapshot = {
  day: string;
  unitSystem: UnitSystem;
  items: LoggedItem[];
  meals: MealGroup[];
  totals: Macros;
  target: DailyTarget | null;
  /**
   * What the rules say now: the proposal for the suggested goal. Null without a
   * bodyweight, since every target is per kilogram.
   */
  proposal: TargetProposal | null;
  /** Whether the target in force is out of date, per `targetStale`. */
  stale: boolean;
  /** What the open block implies, which is the default the form opens on. */
  suggestedGoal: TargetGoal;
  /** Why a cut would be declined today, whatever goal is in force. */
  cutRefusedBecause: string | null;
  blockType: MesocycleType | null;
  remaining: RemainingTarget | null;
  /** Anything ever logged, which is what tells an empty today from a first run. */
  hasHistory: boolean;
  weight: WeightView;
  trendKg: number | null;
  spendUsd: number;
  spendCapUsd: number;
  hasKey: boolean;
};

/** Days of bodyweight behind the chart. A quarter is two to three blocks. */
const WEIGHT_WINDOW_DAYS = 90;

export async function nutritionSnapshot(
  day = today(),
  db: Db = getDb(),
): Promise<NutritionSnapshot> {
  const [
    items,
    target,
    readings,
    tendon,
    block,
    lastClosedOn,
    unitSystem,
    spendUsd,
    hasHistory,
  ] = await Promise.all([
    dayLog(day, db),
    activeTarget(day, db),
    bodyweightReadings(WEIGHT_WINDOW_DAYS, db),
    tendonStates(),
    loadOpenBlock(db),
    lastBlockClosedOn(db),
    getUnitSystem(),
    totalSpendUsd(db),
    hasLoggedFood(db),
  ]);

  const weight = weightView({ readings, target, day });
  const trendKg = bodyweightOn(weight.trend, day);
  const blockType = block?.declaration.type ?? null;
  const totals = sumMacros(items.map((item) => item.macros));

  // The proposal is what the rules say the targets should be *now*, which is not
  // the same as the target in force: a block that has moved on, or a tendon that has
  // flared, changes the answer, and the page shows both so the difference is the
  // prompt to set a new one rather than a silent replacement.
  const suggestedGoal = defaultGoalFor(blockType);
  const proposalFor = (goal: TargetGoal) =>
    trendKg === null
      ? null
      : proposeTargets({ bodyweightKg: trendKg, blockType, tendon, goal });
  const proposal = proposalFor(suggestedGoal);
  const inForce = target === null ? null : proposalFor(goalOf(target));
  const stale =
    target !== null &&
    inForce !== null &&
    targetStale({
      target,
      inForce,
      suggestedGoal,
      blockStart: block?.startDate ?? null,
      blockClosedOn: block === null ? lastClosedOn : null,
    });

  return {
    day,
    unitSystem,
    items,
    meals: groupByMeal(items),
    totals,
    target,
    proposal,
    stale,
    suggestedGoal,
    cutRefusedBecause: cutRefusal({ blockType, tendon }),
    blockType,
    remaining: target === null ? null : remaining(target, totals),
    hasHistory,
    weight,
    trendKg,
    spendUsd,
    spendCapUsd: SPEND_CAP_USD,
    hasKey: hasApiKey(),
  };
}

/** The day the most recently closed block was closed, or null if none ever was. */
async function lastBlockClosedOn(db: Db): Promise<string | null> {
  const { mesocycles } = schema;
  const [row] = await db
    .select({ closedAt: mesocycles.closedAt })
    .from(mesocycles)
    .where(isNotNull(mesocycles.closedAt))
    .orderBy(desc(mesocycles.closedAt))
    .limit(1);
  return row?.closedAt ? dayOf(row.closedAt) : null;
}

/**
 * The state the target form needs to propose a target for a goal the owner picked.
 *
 * Read again inside the action rather than trusted from the client, because the
 * refusal rules are the point: a cut refused because a tendon is on a protocol must
 * be refused against the tendon state on the server and not against whatever the
 * page held when it rendered.
 */
export async function targetInputsFor(
  goal: TargetGoal,
  day = today(),
  db: Db = getDb(),
): Promise<TargetProposal | null> {
  const [readings, tendon, block] = await Promise.all([
    bodyweightReadings(WEIGHT_WINDOW_DAYS, db),
    tendonStates(),
    loadOpenBlock(db),
  ]);
  const trendKg = bodyweightOn(bodyweightTrend(readings), day);
  if (trendKg === null) return null;
  return proposeTargets({
    bodyweightKg: trendKg,
    blockType: block?.declaration.type ?? null,
    tendon,
    goal,
  });
}
