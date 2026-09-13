import { describe, expect, it } from "vitest";
import { hashPasscode, verifyPasscode } from "./passcode";

describe("passcode", () => {
  it("accepts the right passcode and rejects a wrong one", async () => {
    const encoded = await hashPasscode("penultimate-step");
    expect(await verifyPasscode("penultimate-step", encoded)).toBe(true);
    expect(await verifyPasscode("penultimate-stef", encoded)).toBe(false);
    expect(await verifyPasscode("", encoded)).toBe(false);
  });

  it("salts, so the same passcode hashes differently each time", async () => {
    const a = await hashPasscode("same-input");
    const b = await hashPasscode("same-input");
    expect(a).not.toEqual(b);
    expect(await verifyPasscode("same-input", a)).toBe(true);
    expect(await verifyPasscode("same-input", b)).toBe(true);
  });

  it("contains no dollar sign, so it survives dotenv expansion intact", async () => {
    const encoded = await hashPasscode("anything");
    expect(encoded).not.toContain("$");
  });

  it("rejects a malformed or truncated hash instead of throwing", async () => {
    for (const bad of ["", "scrypt:", "bcrypt:1:2:3:ab:cd", "scrypt:x:8:1::"]) {
      expect(await verifyPasscode("anything", bad)).toBe(false);
    }
  });
});
