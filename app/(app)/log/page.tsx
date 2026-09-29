import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ButtonLink, Card, DetailLine, Tag, type Tone } from "@/components/ui";
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
 * one is a request to tap the row.
 */
function CheckIn({
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
  tone?: Tone;
}) {
  return (
    <li className="border-t border-line first:border-t-0">
      <Link
        href={href}
        className="press group -mx-4 flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-raised/50 sm:-mx-5 sm:px-5"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-ink">{title}</h3>
            {tag ? <Tag tone={tone}>{tag}</Tag> : null}
          </div>
          <p className="mt-0.5 text-sm text-ink-faint">{status}</p>
        </div>
        <Chevron />
      </Link>
    </li>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4 shrink-0 text-ink-faint transition-transform duration-150 group-hover:translate-x-0.5"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
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
      <PageHeader eyebrow={formatDay(snapshot.day)} title="Log" />

      <Card className="mb-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="eyebrow">Session</h2>
          {finished.length ? (
            <Tag tone="good">
              {finished.length === 1 ? "Done" : `${finished.length} done`}
            </Tag>
          ) : null}
        </div>
        {session ? (
          <>
            <p className="mt-2 font-display text-2xl font-bold text-ink">
              {session.title ?? sessionKindLabels.of(session.kind)}
            </p>
            {/*
              A planned session exists from the moment its week is accepted, so
              an open row with nothing in it is today's plan waiting rather than
              a workout left running.
            */}
            <p className="mt-1 text-sm text-ink-muted">
              {setsToday === 0 ? (
                session.microcycleId === null ? (
                  "Open, nothing logged yet."
                ) : (
                  "Planned for today."
                )
              ) : (
                <DetailLine
                  parts={[
                    ...(session.startedAt
                      ? [`Started ${formatTime(session.startedAt)}`]
                      : []),
                    <span key="sets" className="tnum">
                      {setsToday} {setsToday === 1 ? "set" : "sets"} logged
                    </span>,
                  ]}
                />
              )}
            </p>
            <ButtonLink
              href={`/log/session/${session.id}`}
              size="lg"
              className="mt-4 w-full sm:w-auto sm:min-w-56"
            >
              {setsToday === 0 ? "Start session" : "Continue session"}
            </ButtonLink>
          </>
        ) : (
          <>
            <p className="mt-2 mb-4 text-sm text-ink-muted">
              {finished.length
                ? "Nothing open. Another workout today is its own session, so each session's RPE still describes one workout."
                : "Nothing open. Off-plan work logged here still counts toward weekly volume and the contact total."}
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
          <ul className="mt-4 border-t border-line pt-1">
            {finished.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/log/session/${row.id}`}
                  className="flex min-h-11 items-center justify-between gap-3 text-sm hover:text-ink"
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

      <h2 className="eyebrow mb-2">Check-ins</h2>
      <Card className="py-1 sm:py-1">
        <ul>
          <CheckIn
            href="/log/readiness"
            title="Readiness"
            status={
              readiness
                ? `Checked in${readiness.motivation === null ? "" : `, motivation ${readiness.motivation}`}.`
                : "Not checked in today."
            }
            tag={readiness ? undefined : "Due"}
            tone="cool"
          />
          <CheckIn
            href="/log/body"
            title="Bodyweight"
            status={
              bodyweight
                ? `${formatMeasurement(bodyweight.value, "bodyweight", unitSystem)} on ${formatDay(dayOf(bodyweight.measuredAt))}.`
                : "Nothing logged yet."
            }
            tag={bodyweightIsToday ? undefined : "Due"}
            tone="cool"
          />
          <CheckIn
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
                ? `Phase ${Math.min(...flagged.map((row) => row.protocolPhase!))}`
                : tendonToday
                  ? undefined
                  : "Due"
            }
            tone={flagged.length ? "warn" : "cool"}
          />
          <CheckIn
            href="/log/test"
            title="Jump test"
            status={
              snapshot.lastTest
                ? `${measurementKindLabels.of(snapshot.lastTest.kind)}, best ${formatMeasurement(snapshot.lastTest.best, snapshot.lastTest.kind, unitSystem)} on ${formatDay(dayOf(snapshot.lastTest.measuredAt))}.`
                : "No jump test logged yet."
            }
            tag={snapshot.lastTest ? undefined : "Due"}
            tone="cool"
          />
        </ul>
      </Card>
    </>
  );
}
