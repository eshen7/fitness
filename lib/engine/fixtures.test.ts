import { describe, expect, it } from "vitest";
import { reviewDeclaration, reviewWeek } from "./index";
import { prefilter } from "./prefilter";
import { RULES, type RuleId } from "./rules";
import { baselineReview, DECLARATION, EVERYTHING } from "./fixtures/baseline";
import { DIRECTORY, idOf } from "./fixtures/directory";
import { findingsOf, INVALID_PLANS } from "./fixtures/invalid";

describe("the baseline plan", () => {
  it("passes every rule without a change, a violation or an advisory", () => {
    const review = reviewWeek(baselineReview());
    expect(review.changes).toEqual([]);
    expect(review.violations).toEqual([]);
    expect(review.advisories).toEqual([]);
    expect(review.passed).toBe(true);
  });

  it("passes as a declaration", () => {
    expect(
      reviewDeclaration({ declaration: DECLARATION, directory: DIRECTORY, prefiltered: EVERYTHING }),
    ).toEqual({ violations: [], passed: true });
  });

  it("runs on a candidate set missing only what the stock library switches off", () => {
    expect(EVERYTHING.excluded).toEqual([
      {
        rule: "equipment",
        exerciseId: idOf("single-leg-depth-jump"),
        message: "Single leg depth jump is out: it is marked unavailable in the library.",
      },
    ]);
    expect(EVERYTHING.candidates).toHaveLength(DIRECTORY.size - 1);
  });
});

describe("the invalid plans", () => {
  it("cover every rule, and the closed set", () => {
    const covered = new Set(INVALID_PLANS.map((fixture) => fixture.rule));
    for (const rule of [...Object.keys(RULES), "closed-set"]) {
      expect(covered, `no fixture for ${rule}`).toContain(rule);
    }
  });

  it("each carry at least one message", () => {
    for (const fixture of INVALID_PLANS) expect(fixture.messages, fixture.name).not.toHaveLength(0);
  });

  describe.each(INVALID_PLANS.map((fixture) => [fixture.name, fixture] as const))(
    "%s",
    (_, fixture) => {
      it(`is caught by ${fixture.rule} alone`, () => {
        const rules = new Set(findingsOf(fixture).map((finding) => finding.rule));
        expect([...rules]).toEqual([fixture.rule]);
      });

      it("with its exact messages", () => {
        expect(findingsOf(fixture).map((finding) => finding.message)).toEqual(fixture.messages);
      });

      if (fixture.stage === "prefilter") {
        it("and every exclusion comes from the same rule", () => {
          const { excluded } = prefilter(fixture.input);
          const rules = new Set<RuleId>(excluded.map((exclusion) => exclusion.rule));
          expect([...rules]).toEqual([fixture.rule]);
        });
      }

      if (fixture.stage === "week") {
        const { violations } = reviewWeek(fixture.input);
        const stage = fixture.rule === "closed-set" ? "gate" : RULES[fixture.rule].stage;
        it(stage === "gate" ? "and fails the gate" : "and still passes the gate", () => {
          expect(violations.length > 0).toBe(stage === "gate");
        });
      }
    },
  );
});
