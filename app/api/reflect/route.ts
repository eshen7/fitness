import { NextResponse } from "next/server";
import { runReflection } from "@/lib/memory";

/**
 * Reflects on one finished session by hand.
 *
 * `finishSession` already schedules this through `after()`, so the ordinary path never
 * reaches here. What this route is for is the case where that scheduled work did not
 * finish - the invocation timed out, the key was missing, the cap had been hit and has
 * since been raised - because a reflection is idempotent in the only sense that
 * matters: a fact already remembered is shown to the model as already remembered, and
 * a paraphrase of one supersedes it rather than joining it.
 *
 * Behind the passcode gate like every other route here, which is why an
 * unauthenticated call gets `401 {"error":"locked"}` rather than a redirect.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const sessionId = Number((body as { sessionId?: unknown } | null)?.sessionId);
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return NextResponse.json({ error: "sessionId is required." }, { status: 422 });
  }

  const result = await runReflection(sessionId);
  return NextResponse.json(
    {
      ok: result.ok,
      skipped: result.skipped,
      summary: result.summary,
      outcomes: result.outcomes,
    },
    { status: result.ok ? 200 : 422 },
  );
}
