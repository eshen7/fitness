import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

/**
 * Proves the deployment can actually reach its database and that pgvector is
 * present, rather than only that the process booted. Behind the passcode, so it
 * is a deploy check rather than a public probe.
 */
export async function GET() {
  try {
    const [row] = await getDb().execute<{ vector: string | null }>(sql`
      select (select extversion from pg_extension where extname = 'vector') as vector
    `);
    return NextResponse.json({ ok: true, pgvector: row?.vector ?? null });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "unknown" },
      { status: 503 },
    );
  }
}
