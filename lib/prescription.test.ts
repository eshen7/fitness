import { describe, expect, it } from "vitest";
import type { PlannedSet } from "@/lib/engine/types";
import {
  describePrescription,
  liftsNeedingMax,
  prescriptionLoad,
  prescriptionMaxes,
  prescriptionVolume,
} from "./prescription";

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
    expect(describePrescription({ ...base, reps: 5, loadPctOf1rm: 85 }, "imperial", null)).toBe(
      "3 x 5 at 85% 1RM (needs a max), RPE 7",
    );
  });

  it("keeps a bare percentage on a lift that cannot hold a max", () => {
    const jump = { ...base, reps: 5, loadPctOf1rm: 30, targetRpe: null };
    expect(describePrescription(jump, "imperial", undefined)).toBe("3 x 5 at 30% 1RM");
  });

  it("loads a percentage of 1RM from the max, in the owner's units", () => {
    // An Epley estimate of 140 kg from 120 kg x 5; 87% of it is 268.5 lb.
    const squat = { ...base, sets: 5, reps: 3, loadPctOf1rm: 87, targetRpe: null };
    expect(describePrescription(squat, "imperial", 140)).toBe("5 x 3 at 270 lb (87% 1RM)");
    expect(describePrescription(squat, "metric", 140)).toBe("5 x 3 at 122.5 kg (87% 1RM)");
  });
});

describe("prescriptionMaxes and liftsNeedingMax", () => {
  const exercises = [
    { id: 1, forceVelocity: "max_strength" as const },
    { id: 2, forceVelocity: "max_strength" as const },
    { id: 3, forceVelocity: "speed_strength" as const },
  ];
  const maxes = prescriptionMaxes(exercises, { "1": { kg: 140 }, "3": { kg: 60 } });

  it("holds a max, a missing max, or nothing for a lift that cannot hold one", () => {
    expect(maxes).toEqual({ "1": 140, "2": null });
    const jump = { ...base, reps: 5, loadPctOf1rm: 30, targetRpe: null };
    expect(describePrescription(jump, "imperial", maxes["3"])).toBe("3 x 5 at 30% 1RM");
    expect(describePrescription(jump, "imperial", maxes["2"])).toBe(
      "3 x 5 at 30% 1RM (needs a max)",
    );
  });

  it("names only the lifts a max can be entered for, each once, in plan order", () => {
    const line = (exerciseId: number) => ({ exerciseId, loadPctOf1rm: 80 });
    expect(
      liftsNeedingMax([line(3), line(2), line(1), line(2), { exerciseId: 2, loadPctOf1rm: null }], maxes),
    ).toEqual([2]);
    expect(liftsNeedingMax([line(3)], maxes)).toEqual([]);
  });
});

describe("prescriptionVolume and prescriptionLoad", () => {
  it("are the two halves of the one-line reading", () => {
    const item = { ...base, loadKg: 100, boxHeightCm: 45 };
    expect(prescriptionVolume(item)).toBe("3 x 6");
    expect(prescriptionLoad(item)).toBe("100 kg, 45 cm box, RPE 7");
  });

  it("reads a hold in seconds and a bare set count as sets", () => {
    expect(prescriptionVolume({ ...base, reps: null, holdSeconds: 45 })).toBe("3 x 45s");
    expect(prescriptionVolume({ ...base, reps: null })).toBe("3 sets");
  });

  it("has no load half for volume alone", () => {
    expect(prescriptionLoad({ ...base, targetRpe: null })).toBeNull();
    expect(describePrescription({ ...base, targetRpe: null })).toBe("3 x 6");
  });
});
