import { describe, expect, it } from "vitest";
import { priorRpePrefill } from "./readiness";

describe("priorRpePrefill", () => {
  it("starts a new check-in from the last finished session", () => {
    expect(priorRpePrefill(null, 8)).toEqual({ value: "8", filled: true });
    expect(priorRpePrefill(null, 7.5)).toEqual({ value: "7.5", filled: true });
  });

  it("leaves a new check-in blank when no session was rated", () => {
    expect(priorRpePrefill(null, null)).toEqual({ value: "", filled: false });
  });

  it("keeps what a saved check-in holds, blank included", () => {
    expect(priorRpePrefill({ priorSessionRpe: "6.0" }, 8)).toEqual({
      value: "6",
      filled: false,
    });
    expect(priorRpePrefill({ priorSessionRpe: null }, 8)).toEqual({
      value: "",
      filled: false,
    });
  });
});
