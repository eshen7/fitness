import { type NextRequest, NextResponse } from "next/server";
import { archiveFilename, findExportTable, toCsv } from "@/lib/export/archive";
import { buildArchive, exportRows } from "@/lib/export/queries";
import { dayOf } from "@/lib/time";

/**
 * The data export.
 *
 * `GET /api/export` is the whole archive as JSON; `GET /api/export?table=<name>`
 * is one table as CSV. Behind the passcode like every other route, since it is a
 * complete copy of everything in the database.
 *
 * A download rather than a rendered page: the point of an export is to end up as
 * a file the owner keeps, so the response carries `Content-Disposition` and a
 * filename stamped with the training day.
 *
 * Deliberately not cached anywhere. `no-store` keeps it out of the service
 * worker's reach as well, which matters because a stale archive is exactly the
 * kind of thing that gets restored months later and looks current.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = {
  "cache-control": "no-store, max-age=0",
} as const;

function attachment(filename: string) {
  return `attachment; filename="${filename}"`;
}

export async function GET(request: NextRequest) {
  const day = dayOf();
  const requested = request.nextUrl.searchParams.get("table");

  if (requested) {
    const entry = findExportTable(requested);
    if (!entry) {
      return NextResponse.json(
        { error: "unknown table", table: requested },
        { status: 404, headers: NO_STORE },
      );
    }

    const rows = await exportRows(entry);
    return new NextResponse(toCsv(entry.columns, rows), {
      headers: {
        ...NO_STORE,
        // `charset=utf-8` explicitly: exercise cues and food names carry
        // non-ASCII, and a spreadsheet that guesses the encoding guesses wrong.
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": attachment(
          archiveFilename(day, "csv", entry.name),
        ),
      },
    });
  }

  const archive = await buildArchive();
  return new NextResponse(JSON.stringify(archive, null, 2), {
    headers: {
      ...NO_STORE,
      "content-type": "application/json; charset=utf-8",
      "content-disposition": attachment(archiveFilename(day, "json")),
    },
  });
}
