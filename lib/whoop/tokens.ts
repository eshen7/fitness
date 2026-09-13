import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { WHOOP_TOKEN_URL, whoopCredentials, whoopRedirectUri } from "./config";

/**
 * The OAuth token pair and its rotation.
 *
 * Refreshing invalidates the previous access token and issues a new refresh
 * token, so the two values are only ever valid as a pair. They are written in one
 * statement for that reason: a half-written pair leaves a refresh token WHOOP has
 * already retired, and the connection is then dead in a way nothing detects until
 * the next sync silently returns nothing.
 */

/** Refresh this far before expiry rather than after, so no request races it. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export type WhoopConnection = typeof schema.whoopConnection.$inferSelect;

export async function getConnection(): Promise<WhoopConnection | null> {
  const [row] = await getDb()
    .select()
    .from(schema.whoopConnection)
    .where(eq(schema.whoopConnection.id, 1))
    .limit(1);
  return row ?? null;
}

export type WhoopTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  token_type: string;
};

async function requestToken(body: Record<string, string>) {
  const response = await fetch(WHOOP_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`WHOOP token request failed (${response.status}): ${text}`);
  }
  return JSON.parse(text) as WhoopTokenResponse;
}

export async function exchangeAuthorizationCode(code: string) {
  const { clientId, clientSecret } = whoopCredentials();
  const token = await requestToken({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: whoopRedirectUri(),
  });
  return storeTokens(token);
}

/**
 * Upsert onto the single pinned row, so connecting a second time replaces the
 * pair rather than adding one the reader will never see.
 */
export async function storeTokens(
  token: WhoopTokenResponse,
  whoopUserId?: string,
) {
  const scopes = token.scope ? token.scope.split(/\s+/).filter(Boolean) : [];
  const expiresAt = new Date(Date.now() + token.expires_in * 1000);
  const values = {
    id: 1,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    accessTokenExpiresAt: expiresAt,
    scopes,
    lastRefreshedAt: new Date(),
    invalidatedAt: null,
    invalidatedReason: null,
    ...(whoopUserId ? { whoopUserId } : {}),
  };

  const [row] = await getDb()
    .insert(schema.whoopConnection)
    .values(values)
    .onConflictDoUpdate({ target: schema.whoopConnection.id, set: values })
    .returning();
  return row;
}

export async function disconnect(reason = "disconnected by hand") {
  await getDb()
    .delete(schema.whoopConnection)
    .where(eq(schema.whoopConnection.id, 1));
  return reason;
}

async function invalidate(reason: string) {
  await getDb()
    .update(schema.whoopConnection)
    .set({ invalidatedAt: new Date(), invalidatedReason: reason })
    .where(eq(schema.whoopConnection.id, 1));
}

export class WhoopNotConnected extends Error {
  constructor(message = "WHOOP is not connected.") {
    super(message);
    this.name = "WhoopNotConnected";
  }
}

/**
 * A usable access token, refreshing if it is close to expiry.
 *
 * A refresh that fails is terminal: WHOOP retires the old refresh token the
 * moment it issues a new one, so there is nothing to retry with and the only fix
 * is re-authorizing. The row is marked instead, which is what the UI reads to
 * ask for it.
 */
export async function accessToken(force = false): Promise<string> {
  const connection = await getConnection();
  if (!connection) throw new WhoopNotConnected();
  if (connection.invalidatedAt) {
    throw new WhoopNotConnected(
      `WHOOP connection needs re-authorizing: ${connection.invalidatedReason}`,
    );
  }

  const fresh =
    connection.accessTokenExpiresAt.getTime() - REFRESH_MARGIN_MS > Date.now();
  if (fresh && !force) return connection.accessToken;

  const { clientId, clientSecret } = whoopCredentials();
  let token: WhoopTokenResponse;
  try {
    token = await requestToken({
      grant_type: "refresh_token",
      refresh_token: connection.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      // WHOOP requires the scope on refresh, and dropping `offline` here would
      // return a pair with no refresh token, ending the connection in an hour.
      scope: "offline",
    });
  } catch (error) {
    await invalidate(error instanceof Error ? error.message : String(error));
    throw error;
  }

  const stored = await storeTokens(token);
  return stored.accessToken;
}
