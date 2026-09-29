import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button, Card, Tag } from "@/components/ui";
import { measurementKindLabels, sessionKindLabels } from "@/lib/labels";
import { getUnitSystem, logSnapshot } from "@/lib/log/queries";
import { TENDON_SITES } from "@/lib/taxonomy";
import { dayOf, formatDay, formatTime } from "@/lib/time";
import { formatMeasurement } from "@/lib/units";
import { StartSession } from "./start-session";

export const metadata = { title: "Log" };

/**
 * A destination with its current state, so the hub answers "what is missing".
 *
 * The tag is passed in rather than derived from the tone, because "you have not
 * done this yet" and "this is flagged" are different statements and only the first
 * one is a request to tap the tile.
 */
function Tile({
  href,
  title,
  status,
  tag,
  tone = "neutral",
}: {
  href: string;
  title: string;
  status: string;
  tag?: string;
  tone?: "neutral" | "accent" | "warn" | "bad" | "cool";
}) {
  return (
    <Link href={href} className="block rounded-box">
      <Card className="h-full transition hover:border-ink-faint">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {tag ? <Tag tone={tone}>{tag}</Tag> : null}
        </div>
        <p className="mt-1.5 text-xs text-ink-faint">{status}</p>
      </Card>
    </Link>
  );
}

export default async function LogPage() {
  const [snapshot, unitSystem] = await Promise.all([
    logSnapshot(),
    getUnitSystem(),
  ]);
  const {
    session,
    finished,
    setsToday,
    bodyweight,
    bodyweightIsToday,
    readiness,
    tendon,
  } = snapshot;

  const staleTendon = TENDON_SITES.filter((site) => !tendon.has(site));
  const flagged = [...tendon.values()].filter(
    (row) => row.protocolPhase !== null && row.protocolPhase <= 2,
  );
  const tendonToday = [...tendon.values()].some(
    (row) => dayOf(row.recordedAt) === snapshot.day,
  );

  return (
    <>
      <PageHeader title="Log" subtitle={formatDay(snapshot.day)} />

      <Card className="mb-4">
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Session</h2>
          {finished.length ? (
            <Tag tone="accent">
              {finished.length === 1 ? "done" : `${finished.length} done`}
            </Tag>
          ) : null}
        </div>
        {session ? (
          <>
            {/*
              A planned session exists from the moment its week is accepted, so
              an open row with nothing in it is today's plan waiting rather than
              a workout left running.
            */}
            <p className="mt-1.5 text-xs text-ink-faint">
              {session.title ?? sessionKindLabels.of(session.kind)}
              {setsToday === 0
                ? session.microcycleId === null
                  ? " · open, nothing logged yet"
                  : " · planned for today"
                : `${session.startedAt ? ` · started ${formatTime(session.startedAt)}` : ""} · ${setsToday} ${setsToday === 1 ? "set" : "sets"} logged`}
            </p>
            <Link href={`/log/session/${session.id}`} className="mt-3 block">
              <Button className="w-full sm:w-auto">
                {setsToday === 0 ? "Start session" : "Continue session"}
              </Button>
            </Link>
          </>
        ) : (
          <>
            <p className="mt-1.5 mb-3 text-xs text-ink-faint">
              {finished.length
                ? "Nothing open. A second workout today is a second session, so per-session RPE keeps meaning one workout."
                : "Nothing open. Starting one here logs off-plan work, which still counts toward weekly volume and the contact total."}
            </p>
            {/* Client island: it needs the returned id to navigate. */}
            <StartSession />
          </>
        )}

        {/*
          Finished sessions stay on the hub for the rest of the day. They are
          read-only from here: the set list lives on the session screen, and
          reopening it to fix a number is a deliberate trip rather than a tap
          away from the button that starts a new one.
        */}
        {finished.length ? (
          <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
            {finished.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/log/session/${row.id}`}
                  className="flex items-baseline justify-between gap-2 text-xs"
                >
                  <span className="truncate text-ink-muted">
                    {row.title ?? sessionKindLabels.of(row.kind)}
                  </span>
                  <span className="tnum shrink-0 text-ink-faint">
                    {row.sets} {row.sets === 1 ? "set" : "sets"}
                    {row.sessionRpe === null ? "" : ` · RPE ${row.sessionRpe}`} ·{" "}
                    {formatTime(row.completedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <Tile
          href="/log/readiness"
          title="Readiness"
          status={
            readiness
              ? `Checked in${readiness.motivation === null ? "" : `, motivation ${readiness.motivation}`}.`
              : "Not checked in today."
          }
          tag={readiness ? undefined : "due"}
          tone="cool"
        />
        <Tile
          href="/log/body"
          title="Bodyweight"
          status={
            bodyweight
              ? `${formatMeasurement(bodyweight.value, "bodyweight", unitSystem)} on ${formatDay(dayOf(bodyweight.measuredAt))}.`
              : "Nothing logged yet."
          }
          tag={bodyweightIsToday ? undefined : "due"}
          tone="cool"
        />
        <Tile
          href="/log/tendon"
          title="Tendon"
          status={
            flagged.length
              ? `${flagged.length === 1 ? "One site" : `${flagged.length} sites`} on the protocol.${tendonToday ? "" : " Not checked in today."}`
              : staleTendon.length === TENDON_SITES.length
                ? "No check-in recorded yet."
                : staleTendon.length
                  ? `${staleTendon.length} of ${TENDON_SITES.length} sites never recorded.`
                  : tendonToday
                    ? "All four sites recorded today."
                    : "All four sites recorded, none today."
          }
          // A flagged site outranks a missing check-in, since it is the thing that
          // is actually removing exercises from every plan until it changes.
          tag={
            flagged.length
              ? `phase ${Math.min(...flagged.map((row) => row.protocolPhase!))}`
              : tendonToday
                ? undefined
                : "due"
          }
          tone={flagged.length ? "warn" : "cool"}
        />
        <Tile
          href="/log/test"
          title="Test"
          status={
            snapshot.lastTest
              ? `${measurementKindLabels.of(snapshot.lastTest.kind)}, best ${formatMeasurement(snapshot.lastTest.best, snapshot.lastTest.kind, unitSystem)} on ${formatDay(dayOf(snapshot.lastTest.measuredAt))}.`
              : "No jump test logged yet."
          }
          tag={snapshot.lastTest ? undefined : "due"}
          tone="cool"
        />
      </div>
    </>
  );
}
