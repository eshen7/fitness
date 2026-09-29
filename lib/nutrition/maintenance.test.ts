import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/days";
import { emptyInputs, type AnalyticsInputs } from "@/lib/analytics/inputs";
import { measuredMaintenance } from "@/lib/analytics/nutrition";
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
 * changes from week to week so there is a line to fit maintenance through.
 */
function history(weeks: number): AnalyticsInputs {
  const inputs = emptyInputs(AS_OF);
  const days = weeks * 7;
  const start = addDays(AS_OF, -days);
  let kg = START_KG;
  for (let offset = 0; offset < days; offset += 1) {
    const day = addDays(start, offset);
    const surplus = [300, -100, 150, -250, 50, 200, -150][Math.floor(offset / 7) % 7];
    if (offset % 2 === 0) inputs.bodyweight.push({ day, kg });
    if (offset % 7 < 5) inputs.intake.push({ day, kcal: TRUE_MAINTENANCE + surplus });
    kg += surplus / KCAL_PER_KG;
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
    expect(target.kcal).toBe(START_KG * MAINTENANCE_KCAL_PER_KG);
    expect(target.rationale).toContain(`the ${MAINTENANCE_KCAL_PER_KG} kcal/kg default`);
  });

  it("falls back to the default on an empty history", () => {
    expect(measuredMaintenance(emptyInputs(AS_OF))).toBeNull();
  });
});
