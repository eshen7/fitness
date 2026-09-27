import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/days";
import { emptyInputs, type AnalyticsExercise, type LoggedSetRow } from "./inputs";
import { workloadRatios } from "./load";

/**
 * The acute to chronic ratio, on whole weeks.
 *
 * A Wednesday is two and a half days into its week, so comparing it against full
 * weeks would read every midweek check as a deload.
 */

const WEDNESDAY = "2026-09-23";
const LAST_SUNDAY = "2026-09-20";

const POGO: AnalyticsExercise = {
  id: 1,
  name: "Pogo hop",
  primaryMuscleGroup: "lower_leg",
  movementPattern: "hop",
  forceVelocity: "reactive",
  couplingClass: "short_ssc",
  highImpact: true,
  loadsTendonSites: ["achilles_left", "achilles_right"],
  tendonLoadRating: 3,
};

function contacts(day: string, reps: number): LoggedSetRow {
  return {
    day,
    sessionId: 1,
    exerciseId: POGO.id,
    reps,
    loadKg: null,
    holdSeconds: null,
    boxHeightCm: null,
    rpe: null,
    qualityRating: null,
    prescribedSetId: null,
  };
}

describe("workloadRatios", () => {
  it("compares the latest full week against the three before it, not the week in progress", () => {
    // Twenty contacts every day of the four full weeks, and a much bigger Monday in the
    // week still under way.
    const sets = Array.from({ length: 28 }, (_, offset) =>
      contacts(addDays(LAST_SUNDAY, -offset), 20),
    );
    sets.push(contacts(addDays(LAST_SUNDAY, 1), 500));
    const inputs = {
      ...emptyInputs(WEDNESDAY),
      exercises: new Map([[POGO.id, POGO]]),
      loggedSets: sets,
    };

    const ratio = workloadRatios(inputs).find((insight) => insight.key === "load.acwr.contacts");

    expect(ratio?.value).toBeCloseTo(1, 6);
    expect(ratio?.n).toBe(3);
    expect(ratio?.detail?.weekEnding).toBe(LAST_SUNDAY);
    expect(ratio?.detail?.weeks).toHaveLength(4);
  });
});
