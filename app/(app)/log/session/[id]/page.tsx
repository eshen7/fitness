import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { DetailLine, Tag } from "@/components/ui";
import { listExercises } from "@/lib/exercises/queries";
import { sessionKindLabels } from "@/lib/labels";
import {
  getUnitSystem,
  lastSetsByExercise,
  loggedSetsForSession,
  plannedSetsForSession,
  sessionById,
} from "@/lib/log/queries";
import { prescriptionMaxes } from "@/lib/prescription";
import { currentOneRms } from "@/lib/strength/queries";
import type { SessionKind } from "@/lib/taxonomy";
import { formatDay, formatTime } from "@/lib/time";
import { SetLogger, type LoggerExercise } from "./set-logger";

type Params = Promise<{ id: string }>;

/** A generated session has a name; an ad-hoc one is known by its kind. */
function sessionName(session: { title: string | null; kind: SessionKind }) {
  return session.title ?? `${sessionKindLabels.of(session.kind)} session`;
}

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  const session = await sessionById(Number(id));
  return { title: session ? sessionName(session) : "Not found" };
}

export default async function SessionPage({ params }: { params: Params }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const session = await sessionById(id);
  if (!session) notFound();

  const [rows, plan, sets, lastSets, unitSystem, current] = await Promise.all([
    listExercises(),
    plannedSetsForSession(id),
    loggedSetsForSession(id),
    lastSetsByExercise(id),
    getUnitSystem(),
    currentOneRms(),
  ]);

  // Available ones, plus whatever the plan prescribes: the search offers what the
  // pre-filter would offer, so a retired exercise cannot quietly come back through
  // the log, but a line already in the plan is logged whatever happened to the
  // directory since the week was generated.
  const planned = new Set(plan.map((line) => line.exerciseId));
  const exercises: LoggerExercise[] = rows
    .filter((row) => row.available || planned.has(row.id))
    .map((row) => ({
    id: row.id,
    name: row.name,
    movementPattern: row.movementPattern,
    primaryMuscleGroup: row.primaryMuscleGroup,
    equipment: row.equipment,
    equipmentAnyOf: row.equipmentAnyOf,
    highImpact: row.highImpact,
    cues: row.cues,
  }));

  const finished = session.completedAt !== null || session.skippedAt !== null;

  return (
    <>
      <PageHeader
        back={{ href: "/log", label: "Log" }}
        title={sessionName(session)}
        eyebrow={
          <DetailLine
            parts={[
              ...(session.title ? [sessionKindLabels.of(session.kind)] : []),
              formatDay(session.day),
              ...(session.startedAt ? [`Started ${formatTime(session.startedAt)}`] : []),
            ]}
          />
        }
      >
        {finished ? (
          <Tag tone={session.completedAt ? "good" : "bad"}>
            {session.completedAt
              ? `Finished ${formatTime(session.completedAt)}`
              : "Skipped"}
          </Tag>
        ) : (
          <Tag tone="accent">Open</Tag>
        )}
      </PageHeader>

      <SetLogger
        sessionId={id}
        exercises={exercises}
        plan={plan}
        serverSets={sets}
        lastSets={lastSets}
        maxes={prescriptionMaxes(rows, current)}
        unitSystem={unitSystem}
        finished={finished}
      />
    </>
  );
}
