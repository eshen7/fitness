import { eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, QUIET_LINK, Tag } from "@/components/ui";
import { getDb, schema } from "@/lib/db";
import { updateExercise } from "@/lib/exercises/actions";
import { getExerciseBySlug } from "@/lib/exercises/queries";
import { equipmentLabels, muscleGroupLabels } from "@/lib/labels";
import { getUnitSystem } from "@/lib/log/queries";
import { estimatesOneRm } from "@/lib/strength/one-rm";
import { currentOneRms } from "@/lib/strength/queries";
import { AvailabilityToggle } from "../availability-toggle";
import { ExerciseForm } from "../exercise-form";
import { TestedMax } from "./tested-max";

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const { slug } = await params;
  const exercise = await getExerciseBySlug(slug);
  // Metadata is resolved for the segment even when the page itself throws
  // `notFound()`, so the missing case names the 404 rather than a nonexistent
  // exercise.
  return { title: exercise?.name ?? "Not found" };
}

/**
 * Progression links are seeded rather than edited here, so they are shown as
 * read-only context: they are a property of the directory's structure, and
 * rewiring them from a detail page would let a chain point at itself.
 */
async function progressionLinks(ids: (number | null)[]) {
  const wanted = ids.filter((id): id is number => id !== null);
  if (wanted.length === 0) return new Map<number, { slug: string; name: string }>();

  const rows = await getDb()
    .select({
      id: schema.exercises.id,
      slug: schema.exercises.slug,
      name: schema.exercises.name,
    })
    .from(schema.exercises)
    .where(inArray(schema.exercises.id, wanted));

  return new Map(rows.map((r) => [r.id, { slug: r.slug, name: r.name }]));
}

export default async function ExercisePage({ params }: { params: Params }) {
  const { slug } = await params;
  const exercise = await getExerciseBySlug(slug);
  if (!exercise) notFound();

  const links = await progressionLinks([
    exercise.progressionOfId,
    exercise.regressionOfId,
  ]);
  const easier = exercise.progressionOfId
    ? links.get(exercise.progressionOfId)
    : undefined;
  const harder = exercise.regressionOfId
    ? links.get(exercise.regressionOfId)
    : undefined;

  const [usage] = await getDb()
    .select({ id: schema.prescribedSets.id })
    .from(schema.prescribedSets)
    .where(eq(schema.prescribedSets.exerciseId, exercise.id))
    .limit(1);

  const oneRm = estimatesOneRm(exercise)
    ? await Promise.all([currentOneRms(), getUnitSystem()])
    : null;

  return (
    <>
      <header className="mb-7">
        <Link
          href="/library"
          className={QUIET_LINK}
        >
          <span aria-hidden="true">←</span> Library
        </Link>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="eyebrow mb-1.5">
              {muscleGroupLabels.of(exercise.primaryMuscleGroup)}
            </p>
            <h1 className="text-[2.25rem] leading-[0.95] font-bold text-ink uppercase sm:text-3xl">
              {exercise.name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-1.5 empty:hidden">
              {!exercise.isStock ? <Tag tone="cool">Custom</Tag> : null}
              {exercise.highImpact ? <Tag tone="warn">Impact</Tag> : null}
              {exercise.protocolPhase !== null ? (
                <Tag tone="cool">Protocol phase {exercise.protocolPhase}</Tag>
              ) : null}
              {exercise.forceVelocity === "shock" ? <Tag tone="bad">Shock</Tag> : null}
              {!exercise.available ? <Tag tone="bad">Unavailable</Tag> : null}
              {usage ? <Tag>Prescribed before</Tag> : null}
            </div>
          </div>
          <AvailabilityToggle
            slug={exercise.slug}
            name={exercise.name}
            available={exercise.available}
            size="md"
          />
        </div>
      </header>

      {exercise.equipment.length > 0 ||
      exercise.equipmentAnyOf.length > 0 ||
      easier ||
      harder ? (
        <Card className="mb-5">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            {exercise.equipment.length > 0 ? (
              <div>
                <dt className="eyebrow">Equipment</dt>
                <dd className="mt-2 flex flex-wrap gap-1.5">
                  {exercise.equipment.map((item) => (
                    <Tag key={item}>{equipmentLabels.of(item)}</Tag>
                  ))}
                </dd>
              </div>
            ) : null}

            {exercise.equipmentAnyOf.length > 0 ? (
              <div>
                <dt className="eyebrow">
                  {exercise.equipment.length > 0 ? "Plus one of" : "Any one of"}
                </dt>
                <dd className="mt-2 flex flex-wrap gap-1.5">
                  {exercise.equipmentAnyOf.map((item) => (
                    <Tag key={item}>{equipmentLabels.of(item)}</Tag>
                  ))}
                </dd>
              </div>
            ) : null}

            {easier || harder ? (
              <div>
                <dt className="eyebrow">Progression chain</dt>
                <dd className="mt-2 space-y-1">
                  {easier ? (
                    <p>
                      <span className="text-ink-faint">Regresses to </span>
                      <Link
                        href={`/library/${easier.slug}`}
                        className="font-medium text-ink underline decoration-ink-faint underline-offset-3 hover:decoration-ink"
                      >
                        {easier.name}
                      </Link>
                    </p>
                  ) : null}
                  {harder ? (
                    <p>
                      <span className="text-ink-faint">Progresses to </span>
                      <Link
                        href={`/library/${harder.slug}`}
                        className="font-medium text-ink underline decoration-ink-faint underline-offset-3 hover:decoration-ink"
                      >
                        {harder.name}
                      </Link>
                    </p>
                  ) : null}
                </dd>
              </div>
            ) : null}
          </dl>
        </Card>
      ) : null}

      {oneRm ? (
        <TestedMax
          exerciseId={exercise.id}
          current={oneRm[0][String(exercise.id)] ?? null}
          unitSystem={oneRm[1]}
        />
      ) : null}

      <ExerciseForm
        action={updateExercise.bind(null, exercise.slug)}
        exercise={exercise}
        submitLabel="Save changes"
      />
    </>
  );
}
