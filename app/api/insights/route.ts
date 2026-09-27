import { NextResponse, type NextRequest } from "next/server";
import { recomputeInsights } from "@/lib/analytics";
import { cronAuthorized } from "@/lib/auth/cron";

/**
 * The nightly insight recompute, and the button that runs it by hand.
 *
 * Nightly rather than on write, and the reason is the gate: every statement's
 * Benjamini-Hochberg threshold depends on how many statements were computed alongside
 * it, so the suite is recomputed whole or not at all. Recomputing on every logged set
 * would mean doing the whole suite per set, and recomputing one insight would quietly
 * use a correction denominator of one.
 *
 * Costs nothing but database time. There is no model call anywhere in `lib/analytics/`,
 * which is why this route can run every night without touching the spend cap.
 *
 * Scheduled after the WHOOP sync at 09:20 UTC, so the night that was just scored is
 * already in the tables the suite reads.
 */
export const maxDuration = 60;

async function run(request: NextRequest) {
  if (!(await cronAuthorized(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await recomputeInsights();
  if (!result.saved) {
    return NextResponse.json(
      { ok: false, error: "incomplete suite", failedProducers: result.failures },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    computed: result.insights.length,
    assertable: result.assertableCount,
  });
}

export async function GET(request: NextRequest) {
  return run(request);
}

/** Vercel Cron issues a GET; POST is here for a manual trigger from the app. */
export async function POST(request: NextRequest) {
  return run(request);
}
