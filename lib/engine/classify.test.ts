import { describe, expect, it } from "vitest";
import {
  abilitiesOf,
  formatContact,
  formatSeconds,
  isHeavy,
  isShockDrill,
  isTraining,
  list,
} from "./classify";
import { exerciseOf } from "./fixtures/directory";

describe("classify", () => {
  it("calls a lift heavy at 80% or more, or at 5 reps or fewer with no percentage", () => {
    const squat = exerciseOf("back-squat");
    expect(isHeavy(squat, { exerciseId: squat.id, sets: 3, reps: 8, loadPctOf1rm: 80 })).toBe(true);
    expect(isHeavy(squat, { exerciseId: squat.id, sets: 3, reps: 3, loadPctOf1rm: 75 })).toBe(false);
    expect(isHeavy(squat, { exerciseId: squat.id, sets: 3, reps: 5 })).toBe(true);
    expect(isHeavy(squat, { exerciseId: squat.id, sets: 3, reps: 6 })).toBe(false);
    const plank = exerciseOf("plank");
    expect(isHeavy(plank, { exerciseId: plank.id, sets: 3, reps: 1 })).toBe(false);
  });

  it("counts a shock drill only under the 0.15 s line", () => {
    expect(isShockDrill(exerciseOf("depth-jump"))).toBe(true);
    expect(isShockDrill({ ...exerciseOf("depth-jump"), typicalContactSeconds: 0.15 })).toBe(false);
    expect(isShockDrill({ ...exerciseOf("depth-jump"), typicalContactSeconds: null })).toBe(false);
    expect(isShockDrill(exerciseOf("pogo-hop"))).toBe(false);
  });

  it("reads the ability a strength set trains from its dose", () => {
    const squat = exerciseOf("back-squat");
    const set = (reps: number, loadPctOf1rm?: number) => ({ exerciseId: squat.id, sets: 3, reps, loadPctOf1rm });
    expect(abilitiesOf(squat, set(10, 85))).toEqual(["max_strength"]);
    expect(abilitiesOf(squat, set(6))).toEqual(["max_strength"]);
    expect(abilitiesOf(squat, set(10))).toEqual(["hypertrophy"]);
    expect(abilitiesOf(squat, set(20))).toEqual(["strength_endurance"]);
    const depth = exerciseOf("depth-jump");
    expect(abilitiesOf(depth, { exerciseId: depth.id, sets: 3 })).toEqual([
      "reactive_strength",
      "elastic_capacity",
    ]);
    const sprint = exerciseOf("acceleration-sprint");
    expect(abilitiesOf(sprint, { exerciseId: sprint.id, sets: 3 })).toEqual(["sprint_speed"]);
  });

  it("treats rest, mobility, protocol and test sessions as carrying no training volume", () => {
    const idle = ["rest", "mobility", "tendon_protocol", "test"] as const;
    expect(idle.map((kind) => isTraining({ kind }))).toEqual([false, false, false, false]);
    expect(isTraining({ kind: "mixed" })).toBe(true);
  });

  it("formats lists, rests and contact times as the messages read them", () => {
    expect(list([])).toBe("");
    expect(list(["a"])).toBe("a");
    expect(list(["a", "b"])).toBe("a and b");
    expect(list(["a", "b", "c"])).toBe("a, b and c");
    expect(formatSeconds(45)).toBe("45 s");
    expect(formatSeconds(120)).toBe("2 min");
    expect(formatSeconds(270)).toBe("4 min 30 s");
    expect(formatContact(0.14)).toBe("0.14 s");
    expect(formatContact(0.145)).toBe("0.145 s");
  });
});
