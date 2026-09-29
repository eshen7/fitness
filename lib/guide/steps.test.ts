import { describe, expect, it } from "vitest";
import { offerGuide, setupProgress, type SetupFacts } from "./steps";

const fresh: SetupFacts = {
  hasSavedProfile: false,
  hasBodyweight: false,
  hasStandingVertical: false,
  hasFoodTargets: false,
  hasBlock: false,
  hasWeek: false,
};

const complete: SetupFacts = Object.fromEntries(
  Object.keys(fresh).map((key) => [key, true]),
) as SetupFacts;

describe("setupProgress", () => {
  it("starts a fresh install at the profile", () => {
    expect(setupProgress(fresh)).toEqual({ done: 0, total: 6, next: "profile" });
  });

  it("counts the profile once it has been saved", () => {
    expect(setupProgress({ ...fresh, hasSavedProfile: true })).toEqual({
      done: 1,
      total: 6,
      next: "bodyweight",
    });
  });

  it("points at the earliest gap even when later steps are done", () => {
    expect(setupProgress({ ...complete, hasStandingVertical: false })).toEqual({
      done: 5,
      total: 6,
      next: "vertical",
    });
  });

  it("has nothing next once every step is done", () => {
    expect(setupProgress(complete)).toEqual({ done: 6, total: 6, next: null });
  });
});

describe("offerGuide", () => {
  it("offers itself to an owner who has not set up", () => {
    expect(offerGuide(fresh, null)).toBe(true);
    expect(offerGuide({ ...complete, hasWeek: false }, null)).toBe(true);
  });

  it("stays away once dismissed or once setup is complete", () => {
    expect(offerGuide(fresh, new Date("2026-09-29T12:00:00Z"))).toBe(false);
    expect(offerGuide(complete, null)).toBe(false);
  });
});
