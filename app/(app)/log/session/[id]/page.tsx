import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { Tag } from "@/components/ui";
import { listExercises } from "@/lib/exercises/queries";
import { sessionKindLabels } from "@/lib/labels";
import {
  getUnitSystem,
  lastSetsByExercise,
  loggedSetsForSession,
  sessionById,
} from "@/lib/log/queries";
import { formatDay, formatTime } from "@/lib/time";
import { SetLogger, type LoggerExercise } from "./set-logger";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  const session = await sessionById(Number(id));
  return { title: session ? `${sessionKindLabels.of(session.kind)} session` : "Not found" };
}

export default async function SessionPage({ params }: { params: Params }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const session = await sessionById(id);
  if (!session) notFound();

  const [rows, sets, lastSets, unitSystem] = await Promise.all([
    // Available only: the logger offers what the pre-filter would offer, so a
    // retired exercise cannot quietly come back through the log.
    listExercises({ include: "available" }),
    loggedSetsForSession(id),
    lastSetsByExercise(),
    getUnitSystem(),
  ]);

  const exercises: LoggerExercise[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    movementPattern: row.movementPattern,
    primaryMuscleGroup: row.primaryMuscleGroup,
    equipment: row.equipment,
    highImpact: row.highImpact,
    cues: row.cues,
  }));

  const finished = session.completedAt !== null || session.skippedAt !== null;

  return (
    <>
      <PageHeader
        title={sessionKindLabels.of(session.kind)}
        subtitle={`${formatDay(session.day)}${
          session.startedAt ? ` · started ${formatTime(session.startedAt)}` : ""
        }`}
      >
        {finished ? (
          <Tag tone="cool">
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
        serverSets={sets}
        lastSets={lastSets}
        unitSystem={unitSystem}
        finished={finished}
      />
    </>
  );
}
