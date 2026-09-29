import { describe, expect, it } from "vitest";
import type { PlannedSet } from "@/lib/engine/types";
import { describePrescription } from "./prescription";

const base: PlannedSet = {
  exerciseId: 1,
  sets: 3,
  reps: 6,
  holdSeconds: null,
  loadPctOf1rm: null,
  loadKg: null,
  boxHeightCm: null,
  targetRpe: 7,
  tempo: null,
  restSeconds: null,
  couplingClass: null,
  shockMethod: null,
};

describe("describePrescription", () => {
  it("reads in canonical kg and cm by default", () => {
    expect(describePrescription({ ...base, loadKg: 100, boxHeightCm: 45 })).toBe(
      "3 x 6 at 100 kg, 45 cm box, RPE 7",
    );
  });

  it("reads in pounds and inches for an imperial owner", () => {
    expect(describePrescription({ ...base, loadKg: 100, boxHeightCm: 45 }, "imperial")).toBe(
      "3 x 6 at 220.5 lb, 17.7 in box, RPE 7",
    );
  });

  it("says a max is needed for a percentage of 1RM with none on record", () => {
    expect(describePrescription({ ...base, reps: 5, loadPctOf1rm: 85 }, "imperial")).toBe(
      "3 x 5 at 85% 1RM (needs a max), RPE 7",
    );
  });

  it("loads a percentage of 1RM from the max, in the owner's units", () => {
    // An Epley estimate of 140 kg from 120 kg x 5; 87% of it is 268.5 lb.
    const squat = { ...base, sets: 5, reps: 3, loadPctOf1rm: 87, targetRpe: null };
    expect(describePrescription(squat, "imperial", 140)).toBe("5 x 3 at 270 lb (87% 1RM)");
    expect(describePrescription(squat, "metric", 140)).toBe("5 x 3 at 122.5 kg (87% 1RM)");
  });
});
