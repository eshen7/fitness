import { describe, expect, it } from "vitest";
import {
  archiveFilename,
  archiveRow,
  type ExportColumn,
  exportTables,
  findExportTable,
  REDACTIONS,
  toCsv,
} from "@/lib/export/archive";

describe("exportTables", () => {
  const tables = exportTables();

  it("covers every table in the schema", () => {
    // Sampled across the domain areas rather than asserted as a full list, so
    // adding a table does not fail this test - the point is that the derivation
    // reaches all of `lib/db/schema/`, not that the count is frozen.
    const names = tables.map((entry) => entry.name);
    expect(names).toContain("exercises");
    expect(names).toContain("logged_sets");
    expect(names).toContain("measurements");
    expect(names).toContain("food_log_entries");
    expect(names).toContain("memory_facts");
    expect(names).toContain("derived_insights");
    expect(names).toContain("whoop_records");
    expect(names).toContain("spend_ledger");
  });

  it("orders tables by name, so two archives differ only in their data", () => {
    const names = tables.map((entry) => entry.name);
    expect(names).toEqual([...names].sort());
  });

  it("holds back the WHOOP token pair", () => {
    const connection = findExportTable("whoop_connection");
    const columns = connection!.columns.map((column) => column.name);
    expect(columns).not.toContain("access_token");
    expect(columns).not.toContain("refresh_token");
    // Everything else about the connection still ships, so the export says what
    // was connected and when even though it cannot say how to reach it.
    expect(columns).toContain("whoop_user_id");
    expect(columns).toContain("scopes");
  });

  it("every redaction names a column that actually exists", () => {
    // Otherwise a rename turns a redaction into a no-op and the token ships.
    for (const [name, columns] of Object.entries(REDACTIONS)) {
      const entry = tables.find((table) => table.name === name);
      expect(entry, `redacted table ${name} is in the schema`).toBeDefined();
      for (const column of Object.keys(columns)) {
        expect(
          entry!.columns.map((c) => c.name),
          `${name}.${column} is redacted, so it must not be exported`,
        ).not.toContain(column);
      }
    }
  });

  it("drops embedding vectors but keeps the fact they index", () => {
    const facts = findExportTable("memory_facts")!;
    const columns = facts.columns.map((column) => column.name);
    expect(columns).not.toContain("embedding");
    expect(columns).toContain("body");
    expect(columns).toContain("confidence");
  });

  it("finds the numeric columns that need converting", () => {
    const sets = findExportTable("logged_sets")!;
    const numeric = sets.columns
      .filter((column) => column.numeric)
      .map((column) => column.name);
    expect(numeric).toEqual(
      expect.arrayContaining(["load_kg", "rpe", "hold_seconds", "box_height_cm"]),
    );
    // Integers already arrive as numbers and must not be touched.
    expect(numeric).not.toContain("reps");
    expect(numeric).not.toContain("set_index");
  });

  it("carries both names for a column drizzle camel-cases", () => {
    const sets = findExportTable("logged_sets")!;
    const load = sets.columns.find((column) => column.name === "load_kg");
    expect(load).toEqual({ name: "load_kg", property: "loadKg", numeric: true });
  });
});

const LOAD: ExportColumn = { name: "load_kg", property: "loadKg", numeric: true };
const REPS: ExportColumn = { name: "reps", property: "reps", numeric: false };

describe("archiveRow", () => {
  it("keys the row on the database column name, not the drizzle property", () => {
    const row = archiveRow({ loadKg: "82.50", reps: 5 }, [LOAD, REPS]);
    expect(row).toEqual({ load_kg: 82.5, reps: 5 });
    // The property name must not survive alongside it, or an archive carries
    // every renamed column twice and neither copy is authoritative.
    expect(Object.keys(row)).not.toContain("loadKg");
  });

  it("turns numeric strings into numbers", () => {
    expect(archiveRow({ loadKg: "82.50" }, [LOAD])).toEqual({ load_kg: 82.5 });
  });

  it("leaves nulls alone", () => {
    expect(archiveRow({ loadKg: null }, [LOAD])).toEqual({ load_kg: null });
  });

  it("keeps a value it cannot parse rather than losing it", () => {
    expect(archiveRow({ loadKg: "NaN" }, [LOAD])).toEqual({ load_kg: "NaN" });
  });

  it("carries only the columns it was given, in their order", () => {
    // Which is how a redacted or dropped column stays out: it is absent from the
    // column list, so no amount of selecting it by accident puts it in the file.
    const row = archiveRow(
      { loadKg: "40", reps: 3, accessToken: "secret" },
      [REPS, LOAD],
    );
    expect(Object.keys(row)).toEqual(["reps", "load_kg"]);
  });
});

describe("toCsv", () => {
  const columns: ExportColumn[] = [
    { name: "id", property: "id", numeric: false },
    { name: "notes", property: "notes", numeric: false },
  ];

  it("writes the database column names as the header", () => {
    expect(toCsv([LOAD], [])).toBe("load_kg\r\n");
  });

  it("reads the same keys the JSON archive is written under", () => {
    // The one invariant the page's "same columns, same names" rests on: both
    // exports go through `archiveRow`, so a CSV column can never line up against
    // a differently named JSON key.
    const cols = [REPS, LOAD];
    const row = archiveRow({ reps: 5, loadKg: "82.50" }, cols);
    expect(toCsv(cols, [row])).toBe("reps,load_kg\r\n5,82.5\r\n");
    expect(Object.keys(row)).toEqual(cols.map((column) => column.name));
  });

  it("quotes a field containing a comma, a quote or a newline", () => {
    const csv = toCsv(columns, [
      { id: 1, notes: 'felt "light", knee fine' },
      { id: 2, notes: "line one\nline two" },
      { id: 3, notes: "plain" },
    ]);
    expect(csv).toBe(
      "id,notes\r\n" +
        '1,"felt ""light"", knee fine"\r\n' +
        '2,"line one\nline two"\r\n' +
        "3,plain\r\n",
    );
  });

  it("writes null as an empty field, not as the text null", () => {
    expect(toCsv(columns, [{ id: 1, notes: null }])).toBe("id,notes\r\n1,\r\n");
  });

  it("writes a timestamp as an ISO instant", () => {
    const at = new Date("2026-09-27T14:32:00.000Z");
    const column: ExportColumn = {
      name: "performed_at",
      property: "performedAt",
      numeric: false,
    };
    expect(toCsv([column], [{ performed_at: at }])).toBe(
      "performed_at\r\n2026-09-27T14:32:00.000Z\r\n",
    );
  });

  it("writes jsonb as JSON in one quoted field", () => {
    const column: ExportColumn = {
      name: "observations",
      property: "observations",
      numeric: false,
    };
    expect(
      toCsv([column], [{ observations: { sets: 3, note: "a,b" } }]),
    ).toBe('observations\r\n"{""sets"":3,""note"":""a,b""}"\r\n');
  });
});

describe("archiveFilename", () => {
  it("stamps the training day", () => {
    expect(archiveFilename("2026-09-27", "json")).toBe(
      "training-export-2026-09-27.json",
    );
  });

  it("names the table for a single-table download", () => {
    expect(archiveFilename("2026-09-27", "csv", "logged_sets")).toBe(
      "training-logged_sets-2026-09-27.csv",
    );
  });
});
