import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

/**
 * One driver for local Postgres and for Neon over TCP, so there is no
 * environment-specific database path to get wrong.
 *
 * Resolved lazily rather than at module scope. Importing this file must not
 * require a database URL, because Next.js imports every route module while
 * collecting build output, and a connection opened at import time turns a
 * missing build-time secret into a failed build for a route that would only ever
 * connect at request time. Cached on the global so hot reload does not open a
 * pool per edit.
 */
const globalForDb = globalThis as unknown as {
  __sql?: ReturnType<typeof postgres>;
  __db?: ReturnType<typeof create>;
};

function create() {
  const sql =
    globalForDb.__sql ??
    postgres(env().DATABASE_URL, {
      max: env().NODE_ENV === "production" ? 5 : 2,
      idle_timeout: 20,
      prepare: false,
    });
  if (env().NODE_ENV !== "production") globalForDb.__sql = sql;
  return drizzle(sql, { schema, casing: "snake_case" });
}

export function getDb() {
  globalForDb.__db ??= create();
  return globalForDb.__db;
}

export { schema };
export type Db = ReturnType<typeof getDb>;
