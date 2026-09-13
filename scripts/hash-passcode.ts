/**
 * Generates the two secrets phase 1 needs. Run with `npm run passcode`.
 * Nothing is written to disk: the values are printed for pasting into
 * `.env.local` and into the Vercel project settings.
 */
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { hashPasscode } from "../lib/auth/passcode";

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const passcode = (await rl.question("Passcode: ")).trim();
  rl.close();

  if (passcode.length < 6) {
    throw new Error("Use at least 6 characters.");
  }

  console.log("\nPASSCODE_HASH=" + (await hashPasscode(passcode)));
  console.log("SESSION_SECRET=" + randomBytes(48).toString("base64url"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
