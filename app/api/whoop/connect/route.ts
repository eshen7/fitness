import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  WHOOP_AUTH_URL,
  WHOOP_SCOPES,
  whoopConfigured,
  whoopCredentials,
  whoopRedirectUri,
} from "@/lib/whoop/config";

export const OAUTH_STATE_COOKIE = "whoop_oauth_state";

/**
 * Start the OAuth flow.
 *
 * The state is a random value held in a short-lived cookie and compared on the
 * way back, which is what stops a callback the app did not initiate from
 * installing someone else's tokens. Single-user is not the same as single-visitor.
 */
export async function GET() {
  if (!whoopConfigured()) {
    return NextResponse.json(
      { error: "WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET are not set." },
      { status: 501 },
    );
  }

  const state = randomBytes(16).toString("hex");
  const store = await cookies();
  store.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  const url = new URL(WHOOP_AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", whoopCredentials().clientId);
  url.searchParams.set("redirect_uri", whoopRedirectUri());
  url.searchParams.set("scope", WHOOP_SCOPES.join(" "));
  url.searchParams.set("state", state);

  return NextResponse.redirect(url);
}
