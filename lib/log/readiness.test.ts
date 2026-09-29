import { describe, expect, it } from "vitest";
import { priorRpePrefill } from "./readiness";

const deviceOnly = {
  priorSessionRpe: null,
  motivation: null,
  notes: null,
  sorenessByRegion: {},
};

describe("priorRpePrefill", () => {
  it("starts a new check-in from the last finished session", () => {
    expect(priorRpePrefill(null, 8)).toEqual({ value: "8", filled: true });
    expect(priorRpePrefill(null, 7.5)).toEqual({ value: "7.5", filled: true });
  });

  it("leaves a new check-in blank when no session was rated", () => {
    expect(priorRpePrefill(null, null)).toEqual({ value: "", filled: false });
  });

  it("treats a row only WHOOP wrote as a check-in not yet made", () => {
    expect(priorRpePrefill(deviceOnly, 8)).toEqual({ value: "8", filled: true });
    expect(priorRpePrefill({ ...deviceOnly, notes: "  " }, 8)).toEqual({
      value: "8",
      filled: true,
    });
  });

  it("keeps what a saved check-in holds, blank included", () => {
    expect(priorRpePrefill({ ...deviceOnly, priorSessionRpe: "6.0" }, 8)).toEqual({
      value: "6",
      filled: false,
    });
    for (const answered of [
      { motivation: 7 },
      { notes: "slept badly" },
      { sorenessByRegion: { quads: 3 } },
    ]) {
      expect(priorRpePrefill({ ...deviceOnly, ...answered }, 8)).toEqual({
        value: "",
        filled: false,
      });
    }
  });
});
