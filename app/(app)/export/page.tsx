import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui";
import { exportTables, REDACTIONS } from "@/lib/export/archive";
import { exportCounts } from "@/lib/export/queries";
import { today } from "@/lib/time";

export const metadata = { title: "Export" };

/**
 * The data export screen.
 *
 * Plain links rather than buttons, because a download is a navigation and a link
 * is the thing a browser already knows how to resume, retry and save somewhere
 * else. The row counts are rendered before the download so the archive can be
 * sanity-checked against what the app shows elsewhere, which is the one way to
 * notice an export that silently lost a table.
 */
export default async function ExportPage() {
  const tables = exportTables();
  const counts = await exportCounts();
  const total = Object.values(counts).reduce((sum, rows) => sum + rows, 0);
  const omitted = Object.entries(REDACTIONS).flatMap(([table, columns]) =>
    Object.entries(columns).map(([column, reason]) => ({ table, column, reason })),
  );

  return (
    <>
      <PageHeader
        title="Export"
        subtitle="Everything in the database, as a file you keep."
      >
        {/* Not in the nav, which stays at six items, so the way back has to be here. */}
        <Link
          href="/plan"
          className="-my-2 inline-flex min-h-11 items-center text-sm text-ink-faint hover:text-ink-muted"
        >
          ← Plan
        </Link>
      </PageHeader>

      <div className="space-y-4">
        <Card>
          <h2 className="text-sm font-semibold text-ink">Full archive</h2>
          <p className="mt-2 text-sm text-ink-muted">
            One JSON file, one key per table, {tables.length} tables and{" "}
            <span className="tnum">{total.toLocaleString()}</span> rows. Keys are
            the database column names, numerics are numbers and timestamps are ISO
            instants, so it reads back without a schema. A whole-day column -{" "}
            <code className="text-xs">day</code>,{" "}
            <code className="text-xs">start_date</code> - is a training day in
            your own timezone rather than UTC.
          </p>
          <a
            href="/api/export"
            download
            className="mt-4 inline-flex h-14 items-center justify-center gap-2 rounded-field bg-accent px-5 text-base font-semibold text-accent-ink transition hover:brightness-105"
          >
            Download JSON
            <span aria-hidden="true">↓</span>
          </a>
          <p className="mt-2 text-xs text-ink-faint">
            training-export-{today()}.json
          </p>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-ink">One table as CSV</h2>
          <p className="mt-2 text-sm text-ink-muted">
            For a spreadsheet, where the nesting in the archive is in the way.
            Same columns, same names.
          </p>
          <ul className="mt-4 divide-y divide-line/60">
            {tables.map((entry) => {
              const rows = counts[entry.name] ?? 0;
              return (
                <li key={entry.name}>
                  <a
                    href={`/api/export?table=${entry.name}`}
                    download
                    className="flex min-h-14 items-center justify-between gap-3 rounded-field px-1 text-sm transition hover:text-accent"
                  >
                    <span className="min-w-0 truncate font-medium text-ink">
                      {entry.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="tnum text-xs text-ink-faint">
                        {rows.toLocaleString()} {rows === 1 ? "row" : "rows"}
                      </span>
                      <span aria-hidden="true" className="text-ink-faint">
                        ↓
                      </span>
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-ink">What is held back</h2>
          <ul className="mt-2 space-y-1.5 text-sm text-ink-muted">
            {omitted.map((entry) => (
              <li key={`${entry.table}.${entry.column}`}>
                <code className="text-xs text-ink">
                  {entry.table}.{entry.column}
                </code>{" "}
                - {entry.reason}, which a file in your downloads folder is the
                wrong place for. Reconnect WHOOP to replace it.
              </li>
            ))}
            <li>
              Memory-fact <code className="text-xs text-ink">embedding</code>{" "}
              vectors - a derived index, regenerable from the fact bodies that do
              ship, and an order of magnitude larger than the rest of the archive
              put together.
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}
