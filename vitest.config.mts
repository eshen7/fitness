import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "lib/**/*.test.tsx"],
    /**
     * `lib/env.ts` validates the whole environment on first read, so anything
     * that formats a training day needs these present even though no test opens a
     * connection. Fixed values rather than the real `.env.local`, so a test that
     * depends on the zone says so and cannot pass or fail by local accident.
     */
    env: {
      DATABASE_URL: "postgres://test/test",
      PASSCODE_HASH: "$2b$12$0000000000000000000000000000000000000000000000000000",
      SESSION_SECRET: "test-session-secret-that-is-long-enough-32",
      APP_TIMEZONE: "America/New_York",
    },
  },
});
