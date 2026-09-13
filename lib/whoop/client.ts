import { WHOOP_API_BASE } from "./config";
import { accessToken } from "./tokens";

/**
 * The authorized fetch, plus paging.
 *
 * Two failure modes are handled here rather than at every call site: a 401,
 * which means the access token expired earlier than its stated hour and is fixed
 * by one forced refresh, and a 429, which the API returns under load and which is
 * fixed by waiting. Everything else is the caller's problem.
 */

const MAX_ATTEMPTS = 4;
/** Doubling from a second, so the last wait is eight seconds. */
const BASE_BACKOFF_MS = 1000;

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

export class WhoopApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    path: string,
  ) {
    super(`WHOOP ${path} failed (${status}): ${body.slice(0, 300)}`);
    this.name = "WhoopApiError";
  }
}

export async function whoopFetch<T>(
  path: string,
  query?: Record<string, string | undefined>,
): Promise<T> {
  const url = new URL(path.replace(/^\//, ""), `${WHOOP_API_BASE}/`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }

  let refreshed = false;
  let lastError: WhoopApiError | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const token = await accessToken(refreshed && attempt === 0);
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    if (response.ok) return (await response.json()) as T;

    const body = await response.text();
    lastError = new WhoopApiError(response.status, body, path);

    // One forced refresh, then give up: a second 401 on a fresh token is not a
    // token problem and retrying it just burns the rate limit.
    if (response.status === 401 && !refreshed) {
      refreshed = true;
      await accessToken(true);
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await sleep(
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : BASE_BACKOFF_MS * 2 ** attempt,
      );
      continue;
    }

    throw lastError;
  }

  throw lastError ?? new Error(`WHOOP ${path} failed with no response.`);
}

export type WhoopPage<T> = { records: T[]; next_token?: string | null };

/**
 * Every collection caps at 25 records per page, so a backfill of any length is
 * necessarily paged. `limit` bounds the pages rather than the records, because
 * the point of a bound here is to stop a runaway loop, not to trim a result.
 */
export async function whoopCollection<T>(
  path: string,
  query: Record<string, string | undefined> = {},
  maxPages = 40,
): Promise<T[]> {
  const all: T[] = [];
  let nextToken: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const body = await whoopFetch<WhoopPage<T>>(path, {
      ...query,
      limit: "25",
      nextToken,
    });
    all.push(...(body.records ?? []));
    if (!body.next_token) return all;
    nextToken = body.next_token;
  }
  return all;
}
