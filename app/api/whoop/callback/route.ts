import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { backfill } from "@/lib/whoop/ingest";
import { projectPending } from "@/lib/whoop/project";
import { exchangeAuthorizationCode } from "@/lib/whoop/tokens";
import { OAUTH_STATE_COOKIE } from "../connect/route";

/**
 * The OAuth redirect target.
 *
 * On success it backfills a week immediately rather than waiting for the nightly
 * job, so the readiness screen has recovery and sleep in it the moment the
 * connection is made instead of tomorrow morning.
 */
export async function GET(request: NextRequest) {
  const settings = new URL("/log/readiness", env().APP_URL);
  const params = request.nextUrl.searchParams;

  const fail = (reason: string) => {
    settings.searchParams.set("whoop", "error");
    settings.searchParams.set("reason", reason);
    return NextResponse.redirect(settings);
  };

  const error = params.get("error");
  if (error) return fail(params.get("error_description") ?? error);

  const code = params.get("code");
  const state = params.get("state");
  const store = await cookies();
  const expected = store.get(OAUTH_STATE_COOKIE)?.value;
  store.delete(OAUTH_STATE_COOKIE);

  if (!code) return fail("no authorization code returned");
  if (!state || !expected || state !== expected) {
    return fail("state did not match the request that started the flow");
  }

  try {
    await exchangeAuthorizationCode(code);
  } catch (cause) {
    return fail(cause instanceof Error ? cause.message : String(cause));
  }

  // A failure here is not a failure of the connection: the tokens are stored and
  // the nightly job will fill the history, so it is reported and not raised.
  const filled = await backfill(7)
    .then(async (counts) => {
      await projectPending();
      return counts;
    })
    .catch(() => null);

  settings.searchParams.set("whoop", filled ? "connected" : "connected-empty");
  return NextResponse.redirect(settings);
}
