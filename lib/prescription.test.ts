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

  it("keeps a percentage of 1RM as a percentage", () => {
    expect(describePrescription({ ...base, reps: 5, loadPctOf1rm: 85 }, "imperial")).toBe(
      "3 x 5 at 85% 1RM, RPE 7",
    );
  });
});
