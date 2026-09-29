import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/days";
import { emptyInputs, type AnalyticsInputs } from "@/lib/analytics/inputs";
import { maintenanceCalories, measuredMaintenance } from "@/lib/analytics/nutrition";
import { MAINTENANCE_KCAL_PER_KG, proposeTargets } from "./targets";

/**
 * The daily targets resting on the owner's measured maintenance.
 *
 * For a long time nothing called the estimate, so a history that could support one
 * still produced a target at the per-kilogram default, and the rationale went on
 * saying intake had not been measured yet however long the log grew. These drive the
 * same two calls the food screen makes, over a history built from a known energy
 * balance, so the figure the estimate should recover is known in advance.
 */

const AS_OF = "2026-09-29";
const TRUE_MAINTENANCE = 3000;
const KCAL_PER_KG = 7700;
const START_KG = 80;

/**
 * `weeks` of history ending yesterday: weight every other morning, following the
 * energy balance exactly, and intake logged five days in seven at a surplus that
 * swings slowly over twelve weeks so there is a line to fit maintenance through. The
 * swing has to be slow, since the smoothed trend flattens a week-to-week change in
 * the rate of gain and the estimate then reads as implausible.
 */
function history(weeks: number, maintenance = TRUE_MAINTENANCE): AnalyticsInputs {
  const inputs = emptyInputs(AS_OF);
  const days = weeks * 7;
  const start = addDays(AS_OF, -days);
  const cycle = [-300, -200, -100, 0, 100, 200, 300, 200, 100, 0, -100, -200];
  let kg = START_KG;
  for (let offset = 0; offset < days; offset += 1) {
    const day = addDays(start, offset);
    const surplus = cycle[Math.floor(offset / 7) % cycle.length];
    if (offset % 2 === 0) inputs.bodyweight.push({ day, kg });
    if (offset % 7 < 5) inputs.intake.push({ day, kcal: maintenance + surplus });
    kg += surplus / KCAL_PER_KG;
  }
  return inputs;
}

/**
 * Eight weeks of a sustained bulk ending yesterday, after a lead-in week: every
 * week's smoothed trend gains 0.03-0.04 kg a day on 3050-3350 kcal, the richer weeks
 * gaining faster. Maintenance can only be read off that line far outside the data,
 * where it lands near 2150 kcal against a default of 2640. The daily gains behind
 * the scale are the ones that make the trend come out at those rates.
 */
function bulk(): AnalyticsInputs {
  const inputs = emptyInputs(AS_OF);
  const weeks = [
    { kcal: 3050, kgPerDay: 0.0469 },
    { kcal: 3350, kgPerDay: 0.0844 },
    { kcal: 3200, kgPerDay: 0.009 },
    { kcal: 3125, kgPerDay: 0.0137 },
    { kcal: 3275, kgPerDay: 0.0944 },
    { kcal: 3050, kgPerDay: -0.0574 },
    { kcal: 3350, kgPerDay: 0.1096 },
    { kcal: 3200, kgPerDay: 0.2009 },
  ];
  const start = addDays(AS_OF, -(weeks.length + 1) * 7);
  let kg = START_KG;
  for (let offset = 0; offset < (weeks.length + 1) * 7; offset += 1) {
    const day = addDays(start, offset);
    const week = weeks[Math.floor(offset / 7) - 1];
    inputs.bodyweight.push({ day, kg });
    if (week && offset % 7 < 5) inputs.intake.push({ day, kcal: week.kcal });
    kg += week?.kgPerDay ?? 0.035;
  }
  return inputs;
}

function holdTarget(inputs: AnalyticsInputs) {
  return proposeTargets({
    bodyweightKg: START_KG,
    blockType: null,
    tendon: [],
    maintenance: measuredMaintenance(inputs),
    goal: "hold",
  });
}

describe("maintenance behind the daily targets", () => {
  it("measures maintenance from enough logged intake and weigh-ins, instead of the default", () => {
    const target = holdTarget(history(12));

    expect(measuredMaintenance(history(12))?.reliable).toBe(true);
    expect(target.maintenanceWeeks).not.toBeNull();
    expect(target.maintenanceWeeks).toBeGreaterThanOrEqual(5);
    expect(target.kcal).not.toBe(START_KG * MAINTENANCE_KCAL_PER_KG);
    expect(Math.abs(target.kcal - TRUE_MAINTENANCE)).toBeLessThan(150);
    expect(target.rationale).toContain(
      `measured from ${target.maintenanceWeeks} weeks of logged intake`,
    );
  });

  it("falls back to the per-kilogram default while the history is too short to measure", () => {
    const target = holdTarget(history(3));

    expect(target.maintenanceWeeks).toBeNull();
    expect(target.maintenanceUnreliable).toBe(false);
    expect(target.kcal).toBe(START_KG * MAINTENANCE_KCAL_PER_KG);
    expect(target.rationale).toContain(`the ${MAINTENANCE_KCAL_PER_KG} kcal/kg default until`);
  });

  it("falls back to the default when a sustained bulk extrapolates maintenance far below it", () => {
    const inputs = bulk();
    const [insight] = maintenanceCalories(inputs);
    const rates = (insight.detail!.weeks as { kgPerWeek: number }[]).map(
      (week) => week.kgPerWeek / 7,
    );
    expect(rates.length).toBeGreaterThanOrEqual(6);
    for (const rate of rates) {
      expect(rate).toBeGreaterThanOrEqual(0.0295);
      expect(rate).toBeLessThanOrEqual(0.0405);
    }
    expect(Math.abs(insight.value - 2150)).toBeLessThan(100);

    const target = holdTarget(inputs);
    expect(measuredMaintenance(inputs)?.reliable).toBe(false);
    expect(target.maintenanceWeeks).toBeNull();
    expect(target.maintenanceUnreliable).toBe(true);
    expect(target.kcal).toBe(START_KG * MAINTENANCE_KCAL_PER_KG);
    expect(target.rationale).toContain("does not yet measure it reliably enough to use");
  });

  it("falls back to the default when a plausible measurement sits far from it", () => {
    const inputs = history(12, 4000);
    expect(measuredMaintenance(inputs)).toMatchObject({ reliable: false });
    expect(holdTarget(inputs).kcal).toBe(START_KG * MAINTENANCE_KCAL_PER_KG);
  });

  it("falls back to the default on an empty history", () => {
    expect(measuredMaintenance(emptyInputs(AS_OF))).toBeNull();
  });
});
