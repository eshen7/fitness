import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { schema } from "@/lib/db";

/**
 * The data export, as a shape rather than as a route.
 *
 * Two things make this worth its own module instead of a query per screen. The
 * table list is *derived* from the schema rather than written out, so a table
 * added in a later phase leaves with the archive instead of being silently left
 * behind - an export that quietly omits a table is worse than no export, because
 * it looks complete. And the redactions are declared here once, next to the
 * derivation that would otherwise pick them up.
 *
 * Nothing here opens a connection or reads a request, so the serialisation is
 * unit-testable without either.
 */

/** Columns held back from the archive, with the reason the file itself carries. */
export const REDACTIONS: Record<string, Record<string, string>> = {
  whoop_connection: {
    access_token: "live OAuth credential",
    refresh_token: "live OAuth credential",
  },
};

/**
 * Embeddings are dropped wholesale by column type rather than by name.
 *
 * They are a derived index, regenerable from the fact body that ships beside
 * them, and one row is 1536 floats: keeping them would multiply the archive's
 * size by an order of magnitude to carry nothing the owner cannot recompute.
 */
const DROPPED_COLUMN_TYPES = new Set(["PgVector"]);

/**
 * One column, under both of its names.
 *
 * `name` is what the archive is keyed on and `property` is only how a selected
 * row arrives from drizzle, which is why the rename happens once in `archiveRow`
 * rather than at each place a row is read.
 */
export type ExportColumn = {
  /** The database column name. What the JSON key and the CSV header both are. */
  name: string;
  /** The drizzle property a selected row carries the value under. */
  property: string;
  /** A numeric, which the driver hands over as a string. */
  numeric: boolean;
};

export type ExportTable = {
  /** The Postgres table name, which is what the archive and the CSVs key on. */
  name: string;
  table: PgTable;
  columns: ExportColumn[];
};

/**
 * Every table in the schema, ordered by name so two archives of the same database
 * differ only where the data does.
 */
export function exportTables(): ExportTable[] {
  const tables: ExportTable[] = [];

  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;

    const name = getTableName(value);
    const redacted = REDACTIONS[name] ?? {};
    const columns: ExportColumn[] = [];

    for (const [property, column] of Object.entries(getTableColumns(value))) {
      if (redacted[column.name]) continue;
      if (DROPPED_COLUMN_TYPES.has(column.columnType)) continue;
      columns.push({
        name: column.name,
        property,
        numeric: column.columnType === "PgNumeric",
      });
    }

    tables.push({ name, table: value, columns });
  }

  return tables.sort((a, b) => (a.name < b.name ? -1 : 1));
}

export function findExportTable(name: string): ExportTable | undefined {
  return exportTables().find((entry) => entry.name === name);
}

export type Row = Record<string, unknown>;

/**
 * A selected row as the archive carries it: keyed by database column name, with
 * numerics as numbers and timestamps as instants.
 *
 * The rename is the point. Drizzle hands back `loadKg` where the database, the
 * CSV header and every migration in the repository say `load_kg`, and an archive
 * keyed the first way cannot be read back against the schema it came from - nor
 * lined up against the CSV of the same table. Doing it here, once, is what keeps
 * the two exports describing the same columns under the same names.
 *
 * Postgres numerics cross the driver as strings, so leaving them alone would put
 * `"82.50"` in a JSON file where every other weight is a number and make the
 * whole column a string to anything reading it. An unparseable value is left as
 * it came rather than turned into `null`, because losing the value is worse than
 * carrying it in the wrong type.
 */
export function archiveRow(row: Row, columns: ExportColumn[]): Row {
  const out: Row = {};
  for (const column of columns) {
    const value = row[column.property];
    if (column.numeric && typeof value === "string") {
      const parsed = Number(value);
      out[column.name] = Number.isFinite(parsed) ? parsed : value;
      continue;
    }
    out[column.name] = value;
  }
  return out;
}

/** One value as a CSV field. */
function csvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  // Quote when the field could otherwise be misread, and double any quote in it.
  return /["\n\r,]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * A table as RFC 4180 CSV, header first.
 *
 * `\r\n` and the leading header are what a spreadsheet expects. Takes rows that
 * have already been through `archiveRow`, so the header and the values are read
 * out of the same column list under the same names as the JSON archive.
 */
export function toCsv(columns: ExportColumn[], rows: Row[]): string {
  const lines = [columns.map((column) => csvField(column.name)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => csvField(row[column.name])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

/** What the archive says about itself, so a file found later explains itself. */
export type ArchiveMeta = {
  exportedAt: string;
  /** The training day the export was taken on, in the owner's zone. */
  day: string;
  app: string;
  schemaVersion: string;
  tables: { name: string; rows: number }[];
  omitted: { table: string; column: string; reason: string }[];
  note: string;
};

export const ARCHIVE_NOTE =
  "Every table in the app's schema, one key per table, rows in primary-key " +
  "order. Keys are the database column names, the same ones the per-table CSVs " +
  "use. Numerics are numbers and timestamps are ISO 8601 instants; a whole-day " +
  "column such as `day` or `start_date` is a training day in the app's own " +
  "timezone, not UTC. Memory-fact embeddings are omitted: they are a derived " +
  "vector index, regenerable from the fact bodies that ship here.";

/** The filename a browser saves the archive under. */
export function archiveFilename(day: string, extension: string, table?: string) {
  return table
    ? `training-${table}-${day}.${extension}`
    : `training-export-${day}.${extension}`;
}
