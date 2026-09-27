import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { SESSION_COOKIE, verifySession } from "./session";

/**
 * Who is allowed to run a scheduled job: the scheduler, or the owner.
 *
 * These routes sit outside the passcode gate because the scheduler has no session,
 * so each one authenticates itself. Two callers, two credentials: Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET`, and the owner pressing the button in the app
 * sends their session cookie.
 *
 * An unset `CRON_SECRET` refuses the bearer path rather than accepting anything, which
 * is the difference between a job that has not been wired up yet and an open endpoint
 * that recomputes on demand for whoever finds it.
 */
export async function cronAuthorized(request: NextRequest): Promise<boolean> {
  const { CRON_SECRET } = env();
  const bearer = request.headers.get("authorization");
  if (CRON_SECRET && bearer === `Bearer ${CRON_SECRET}`) return true;
  return verifySession(request.cookies.get(SESSION_COOKIE)?.value);
}
