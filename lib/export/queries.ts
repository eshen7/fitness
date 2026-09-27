import { asc, getTableColumns, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  ARCHIVE_NOTE,
  type ArchiveMeta,
  archiveRow,
  type ExportTable,
  exportTables,
  REDACTIONS,
  type Row,
} from "@/lib/export/archive";
import journal from "@/lib/db/migrations/meta/_journal.json";
import { dayOf } from "@/lib/time";

/**
 * The migration the code expects, so an archive can be read back against the shape
 * it was written from.
 *
 * Taken from the journal rather than from `drizzle.__drizzle_migrations`, which
 * stores only a hash of the SQL: the tag is the name a human can find in the
 * repository, and a static import costs no query and cannot fail at request time.
 */
const SCHEMA_VERSION =
  journal.entries.at(-1)?.tag ?? "unknown";

/** Every column the archive keeps, as a drizzle selection. */
function selection(entry: ExportTable) {
  const columns = getTableColumns(entry.table);
  return Object.fromEntries(
    entry.columns.map(({ property }) => [property, columns[property]]),
  );
}

/**
 * One table's rows, keyed by column name with numerics already numbers.
 *
 * Ordered by `id` where there is one. Every table in this schema has a serial
 * primary key, but the fallback is unordered rather than a throw: an archive
 * whose rows arrive in an arbitrary order is still the owner's data, and refusing
 * to export a table because it cannot be sorted would be the wrong trade.
 */
export async function exportRows(entry: ExportTable): Promise<Row[]> {
  const columns = getTableColumns(entry.table);
  const query = getDb().select(selection(entry)).from(entry.table);
  const rows = await (columns.id ? query.orderBy(asc(columns.id)) : query);
  return rows.map((row) => archiveRow(row as Row, entry.columns));
}

/**
 * Row counts for every table, in one statement rather than one per table.
 *
 * The export page shows these so the owner can see what is actually in there
 * before downloading, and a count query per table would be 26 round trips to
 * render a list.
 */
export async function exportCounts(): Promise<Record<string, number>> {
  const tables = exportTables();
  if (tables.length === 0) return {};

  const parts = tables.map(
    (entry) =>
      sql`select ${entry.name}::text as name, count(*)::int as rows from ${entry.table}`,
  );
  const rows = await getDb().execute<{ name: string; rows: number }>(
    sql.join(parts, sql` union all `),
  );

  return Object.fromEntries(rows.map((row) => [row.name, Number(row.rows)]));
}

/**
 * The whole archive as one object.
 *
 * Built in memory rather than streamed. The largest table here is one row per
 * logged set, which after years of training is tens of thousands of small rows,
 * and a single-user export that runs once in a while does not earn the complexity
 * of a streaming JSON encoder.
 */
export async function buildArchive(): Promise<{
  meta: ArchiveMeta;
  data: Record<string, Row[]>;
}> {
  const tables = exportTables();
  const data: Record<string, Row[]> = {};
  const counts: { name: string; rows: number }[] = [];

  for (const entry of tables) {
    const rows = await exportRows(entry);
    data[entry.name] = rows;
    counts.push({ name: entry.name, rows: rows.length });
  }

  const omitted = Object.entries(REDACTIONS).flatMap(([table, columns]) =>
    Object.entries(columns).map(([column, reason]) => ({ table, column, reason })),
  );

  return {
    meta: {
      exportedAt: new Date().toISOString(),
      day: dayOf(),
      app: "fitness",
      schemaVersion: SCHEMA_VERSION,
      tables: counts,
      omitted,
      note: ARCHIVE_NOTE,
    },
    data,
  };
}
