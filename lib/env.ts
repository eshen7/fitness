import { z } from "zod";

/**
 * Fail fast and loudly on a missing or malformed environment rather than at the
 * first request that happens to touch the variable. Only `DATABASE_URL` and the
 * auth secrets are required to boot; integrations are optional so the app runs
 * before WHOOP or OpenAI are connected.
 */
const schema = z.object({
  DATABASE_URL: z.string().min(1),

  /** bcrypt hash of the single passcode. Generate with `npm run passcode`. */
  PASSCODE_HASH: z.string().min(1),
  /** Signing key for the session cookie. 32+ random bytes, base64 or hex. */
  SESSION_SECRET: z.string().min(32),

  /** Every model call. Read at call time in `lib/ai/client.ts`, never at import time. */
  OPENAI_API_KEY: z.string().optional(),

  WHOOP_CLIENT_ID: z.string().optional(),
  WHOOP_CLIENT_SECRET: z.string().optional(),
  /**
   * Bearer the scheduler presents to the scheduled jobs in `vercel.json`, which sit
   * outside the passcode gate because a cron has no session (see `lib/auth/cron.ts`).
   * Unset means scheduled calls are refused; running them from inside the app still works.
   */
  CRON_SECRET: z.string().optional(),
  /** Public origin used to build the OAuth redirect URI and webhook URL. */
  APP_URL: z.string().url().default("http://localhost:3000"),

  /**
   * IANA zone the training day is defined in. A set logged at 11pm belongs to
   * that day and not to UTC's next one, and the server may well be in neither
   * zone, so the boundary is configured rather than inferred.
   */
  APP_TIMEZONE: z
    .string()
    .default("America/New_York")
    .refine((zone) => {
      try {
        new Intl.DateTimeFormat("en-CA", { timeZone: zone });
        return true;
      } catch {
        return false;
      }
    }, "Not an IANA time zone name."),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n  ");
    throw new Error(`Invalid environment:\n  ${detail}`);
  }
  cached = parsed.data;
  return cached;
}
