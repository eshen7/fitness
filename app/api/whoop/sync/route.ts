import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { backfill } from "@/lib/whoop/ingest";
import { projectPending } from "@/lib/whoop/project";
import { getConnection } from "@/lib/whoop/tokens";

/**
 * The nightly backfill, and the button that runs it by hand.
 *
 * Day strain, cycles and body measurements have no webhook, and a webhook missed
 * while the app was asleep is never redelivered, so a schedule is the only thing
 * that makes the series whole. `?days=` widens the window after an outage.
 *
 * This route is outside the passcode gate, because the scheduler has no session,
 * so it authenticates itself: either the cron secret or a real session. Without a
 * configured secret the scheduled call is refused rather than left open.
 */
export const maxDuration = 60;

async function authorized(request: NextRequest) {
  const { CRON_SECRET } = env();
  const bearer = request.headers.get("authorization");
  if (CRON_SECRET && bearer === `Bearer ${CRON_SECRET}`) return true;
  return verifySession(request.cookies.get(SESSION_COOKIE)?.value);
}

async function run(request: NextRequest) {
  if (!(await authorized(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!(await getConnection())) {
    return NextResponse.json({ error: "WHOOP is not connected." }, { status: 409 });
  }

  const days = Number(request.nextUrl.searchParams.get("days") ?? 7);
  const counts = await backfill(Number.isFinite(days) ? Math.min(days, 90) : 7);
  const projection = await projectPending();
  return NextResponse.json({ ok: true, ...counts, projection });
}

export async function GET(request: NextRequest) {
  return run(request);
}

/** Vercel Cron issues a GET; POST is here for a manual trigger from the app. */
export async function POST(request: NextRequest) {
  return run(request);
}
