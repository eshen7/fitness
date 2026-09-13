/**
 * Migration runner. Kept as a script rather than something that fires on first
 * request, so a deploy that fails to migrate fails visibly instead of serving
 * traffic against a stale schema.
 *
 * `pgvector` is created here rather than in a generated migration because
 * drizzle-kit does not emit extension statements, and the memory table's index
 * cannot be created without it.
 */
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({ path: [".env.local", ".env"], quiet: true });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  await sql`create extension if not exists vector`;
  await migrate(db, { migrationsFolder: "./lib/db/migrations" });

  await sql.end();
  console.log("migrations applied");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
