import { describe, expect, it } from "vitest";
import { AS_OF } from "@/lib/engine/fixtures/baseline";
import { STOCK } from "@/lib/engine/fixtures/directory";
import { prefilter } from "@/lib/engine/prefilter";
import type { Equipment } from "@/lib/taxonomy";
import {
  lengthText,
  lengthToCm,
  PROFILE_EQUIPMENT,
  profileRow,
  profileSchema,
  type StoredLengths,
} from "./form";

/** A minimal valid submission, as the form sends it. */
function form(overrides: Record<string, unknown> = {}) {
  return {
    displayName: "",
    unitSystem: "metric",
    heightCm: "",
    reachCm: "",
    femurCm: "",
    tibiaCm: "",
    trainingAgeYears: "",
    dominantTakeoffLeg: "unknown",
    jumperType: "unknown",
    preferredArmSwing: "unknown",
    goals: "",
    availableEquipment: [],
    trainableWeekdays: [],
    ...overrides,
  };
}

const BLANK: StoredLengths = { heightCm: null, reachCm: null, femurCm: null, tibiaCm: null };

const issuePaths = (input: Record<string, unknown>) =>
  profileSchema.safeParse(form(input)).error?.issues.map((issue) => issue.path.join("."));

describe("profileSchema", () => {
  it("accepts an empty profile, reading blanks as absent rather than zero", () => {
    const values = profileSchema.parse(form());
    expect(values.heightCm).toBeUndefined();
    expect(values.trainingAgeYears).toBeUndefined();
    expect(values.displayName).toBeNull();
    expect(values.goals).toEqual([]);
  });

  it("keeps a training age of zero, which is an answer rather than a blank", () => {
    expect(profileSchema.parse(form({ trainingAgeYears: "0" })).trainingAgeYears).toBe(0);
  });

  it("splits goals on newlines and drops blank lines", () => {
    const values = profileSchema.parse(form({ goals: "  Dunk off two feet \n\n34 inch standing vertical\n" }));
    expect(values.goals).toEqual(["Dunk off two feet", "34 inch standing vertical"]);
  });

  it("caps the number of goals", () => {
    expect(issuePaths({ goals: Array.from({ length: 9 }, (_, i) => `Goal ${i}`).join("\n") })).toEqual([
      "goals",
    ]);
  });

  it("orders and deduplicates equipment, so the same choice writes the same row", () => {
    const values = profileSchema.parse(
      form({ availableEquipment: ["rack", "barbell", "rack", "box"] }),
    );
    expect(values.availableEquipment).toEqual(["barbell", "rack", "box"]);
  });

  it("rejects equipment outside the taxonomy, and `none`, which means nothing as a tick", () => {
    expect(issuePaths({ availableEquipment: ["barbell", "smith_machine"] })).toEqual([
      "availableEquipment.1",
    ]);
    expect(issuePaths({ availableEquipment: ["none"] })).toEqual(["availableEquipment.0"]);
  });

  it("stores weekdays as 0 Sunday to 6 Saturday, sorted and unique", () => {
    const values = profileSchema.parse(form({ trainableWeekdays: [5, 1, 3, 1, 0] }));
    expect(values.trainableWeekdays).toEqual([0, 1, 3, 5]);
  });

  it("rejects a weekday outside 0 to 6, or one that is not a whole number", () => {
    expect(issuePaths({ trainableWeekdays: [7] })).toEqual(["trainableWeekdays.0"]);
    expect(issuePaths({ trainableWeekdays: [1.5] })).toEqual(["trainableWeekdays.0"]);
  });

  it("rejects enum values the columns cannot hold", () => {
    expect(issuePaths({ jumperType: "hybrid", unitSystem: "stone" })).toEqual([
      "unitSystem",
      "jumperType",
    ]);
  });

  it("rejects a length that is not a positive number", () => {
    expect(issuePaths({ heightCm: "tall" })).toEqual(["heightCm"]);
    expect(issuePaths({ reachCm: "-3" })).toEqual(["reachCm"]);
  });

  // The ceiling is in centimetres, so it catches a height typed in centimetres
  // while the form was set to inches instead of storing a nine metre athlete.
  it("bounds lengths in canonical centimetres, whatever units they were typed in", () => {
    expect(issuePaths({ unitSystem: "metric", heightCm: "183" })).toBeUndefined();
    const imperial = profileSchema.safeParse(form({ unitSystem: "imperial", heightCm: "183" }));
    expect(imperial.error?.issues[0]).toMatchObject({
      path: ["heightCm"],
      message: "Height tops out at 107.1 in. Check the units.",
    });
  });
});

describe("lengthToCm", () => {
  it("converts from the submitted units", () => {
    expect(lengthToCm(72, "imperial", null)).toBeCloseTo(182.88, 5);
    expect(lengthToCm(183, "metric", null)).toBe(183);
  });

  // 180.0 cm shows as 70.9 in, and 70.9 in is 180.086 cm: without this, saving
  // the screen to change a weekday would rewrite a height nobody touched.
  it("keeps the stored value when the field still reads as it was shown", () => {
    expect(lengthText(180, "imperial")).toBe("70.9");
    expect(lengthToCm(70.9, "imperial", 180)).toBe(180);
    expect(lengthToCm(71, "imperial", 180)).toBeCloseTo(180.34, 5);
  });

  it("reads a cleared field as absent", () => {
    expect(lengthToCm(undefined, "metric", 180)).toBeNull();
  });
});

describe("profileRow", () => {
  it("writes every profile column in the shape its consumers read", () => {
    const values = profileSchema.parse(
      form({
        displayName: " Owner ",
        unitSystem: "imperial",
        heightCm: "72",
        reachCm: "95",
        femurCm: "18.5",
        tibiaCm: "16.5",
        trainingAgeYears: "6",
        dominantTakeoffLeg: "left",
        jumperType: "power",
        preferredArmSwing: "pendulum",
        goals: "Dunk off two feet",
        availableEquipment: ["barbell", "rack"],
        trainableWeekdays: [1, 3, 5],
      }),
    );
    expect(profileRow(values, BLANK)).toEqual({
      displayName: "Owner",
      unitSystem: "imperial",
      // Numerics cross the driver as strings, fixed to the column's scale.
      heightCm: "182.9",
      reachCm: "241.3",
      femurCm: "47.0",
      tibiaCm: "41.9",
      trainingAgeYears: "6.0",
      dominantTakeoffLeg: "left",
      jumperType: "power",
      preferredArmSwing: "pendulum",
      goals: ["Dunk off two feet"],
      availableEquipment: ["barbell", "rack"],
      trainableWeekdays: [1, 3, 5],
    });
  });

  it("clears a dimension that was emptied, rather than keeping the stored one", () => {
    const values = profileSchema.parse(form({ heightCm: "" }));
    expect(profileRow(values, { ...BLANK, heightCm: 180 }).heightCm).toBeNull();
  });

  it("leaves untouched dimensions exactly as stored across a change of units", () => {
    const stored: StoredLengths = { heightCm: 180, reachCm: 238.5, femurCm: 46.2, tibiaCm: 41.1 };
    const shown = (key: keyof StoredLengths) => lengthText(stored[key], "imperial");
    const values = profileSchema.parse(
      form({
        unitSystem: "imperial",
        heightCm: shown("heightCm"),
        reachCm: shown("reachCm"),
        femurCm: shown("femurCm"),
        tibiaCm: shown("tibiaCm"),
      }),
    );
    const row = profileRow(values, stored);
    expect([row.heightCm, row.reachCm, row.femurCm, row.tibiaCm]).toEqual([
      "180.0",
      "238.5",
      "46.2",
      "41.1",
    ]);
  });
});

/**
 * The reason the screen exists: the pre-filter reads an empty equipment list
 * literally, as bodyweight only, so a blank profile plans push-ups next to a
 * rack. What the screen writes is what the pre-filter then reads.
 */
describe("the written equipment, as the pre-filter reads it", () => {
  const candidates = (equipment: readonly Equipment[]) =>
    prefilter({ exercises: STOCK, tendon: [], availableEquipment: equipment, asOf: AS_OF })
      .candidates;

  it("opens the directory up from bodyweight only to everything it holds", () => {
    const blank = profileRow(profileSchema.parse(form()), BLANK);
    const full = profileRow(
      profileSchema.parse(form({ availableEquipment: [...PROFILE_EQUIPMENT] })),
      BLANK,
    );

    const bodyweight = candidates(blank.availableEquipment);
    expect(bodyweight.every((exercise) => exercise.equipment.every((item) => item === "none"))).toBe(
      true,
    );
    expect(bodyweight.map((exercise) => exercise.slug)).not.toContain("back-squat");

    const gym = candidates(full.availableEquipment);
    expect(gym.map((exercise) => exercise.slug)).toContain("back-squat");
    // Everything the library has switched on, and nothing it has switched off.
    expect(gym).toHaveLength(STOCK.filter((exercise) => exercise.available).length);
  });
});
