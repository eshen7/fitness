import { env } from "@/lib/env";

/**
 * WHOOP endpoints and scopes.
 *
 * Kept apart from the client so the webhook verifier and the token store can be
 * unit tested without a live configuration, and so a change of API version is
 * one edit rather than a search.
 */

export const WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
export const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
export const WHOOP_API_BASE = "https://api.prod.whoop.com/developer";

/**
 * `offline` is what earns a refresh token, and without it the connection dies an
 * hour after it is made. The rest are read-only.
 */
export const WHOOP_SCOPES = [
  "read:recovery",
  "read:cycles",
  "read:sleep",
  "read:workout",
  "read:body_measurement",
  "offline",
] as const;

export function whoopRedirectUri() {
  return new URL("/api/whoop/callback", env().APP_URL).toString();
}

/** Whether the app has credentials at all. Everything WHOOP is optional. */
export function whoopConfigured() {
  const { WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET } = env();
  return !!WHOOP_CLIENT_ID && !!WHOOP_CLIENT_SECRET;
}

export function whoopCredentials() {
  const { WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET } = env();
  if (!WHOOP_CLIENT_ID || !WHOOP_CLIENT_SECRET) {
    throw new Error("WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET are not set.");
  }
  return { clientId: WHOOP_CLIENT_ID, clientSecret: WHOOP_CLIENT_SECRET };
}
