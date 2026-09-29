import { describe, expect, it } from "vitest";
import * as z from "zod";
import { AiOutputError, schemaIssues, unparseable } from "./client";
import { reasonOf } from "./guards";

const plan = z.object({
  targets: z.array(z.enum(["max_strength", "sprint_speed"])),
  weeks: z.number(),
});

function zodErrorOf(value: unknown): z.ZodError {
  const result = plan.safeParse(value);
  if (result.success) throw new Error("expected the value to fail the schema");
  return result.error;
}

describe("unparseable", () => {
  it("counts a schema failure as a failed attempt, not an outage", () => {
    const error = unparseable(zodErrorOf({ targets: ["speed"], weeks: 4 }), "Block");
    expect(error).toBeInstanceOf(AiOutputError);
    expect(error?.reason).toBe("unparseable");
    expect(error?.message).toMatch(/^Block: the answer did not match the schema \(targets\.0: /);
  });

  it("counts a cut-off JSON body as a failed attempt", () => {
    let syntax: unknown;
    try {
      JSON.parse('{"targets": [');
    } catch (error) {
      syntax = error;
    }
    expect(unparseable(syntax, "Week")?.reason).toBe("unparseable");
  });

  it("leaves a transport failure alone", () => {
    expect(unparseable(new Error("socket hang up"), "Week")).toBeNull();
  });
});

describe("schemaIssues", () => {
  it("names the first few issues by path in one line", () => {
    const error = zodErrorOf({ targets: ["a", "b", "c", "d"], weeks: "four" });
    const line = schemaIssues(error);
    expect(line).not.toContain("\n");
    expect(line).toMatch(/^targets\.0: .*; targets\.1: .*; targets\.2: .*; and 2 more$/);
  });
});

describe("reasonOf", () => {
  it("never shows the raw issue dump", () => {
    const reason = reasonOf(zodErrorOf({ targets: ["speed"], weeks: 4 }));
    expect(reason).not.toContain("[");
    expect(reason).toMatch(/^the answer did not match the schema \(targets\.0: /);
  });
});
