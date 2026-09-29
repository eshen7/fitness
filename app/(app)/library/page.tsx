import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ButtonLink, EmptyState, Pips, Tag } from "@/components/ui";
import { listExercises, type ExerciseRow } from "@/lib/exercises/queries";
import {
  couplingClassLabels,
  forceVelocityLabels,
  movementPatternLabels,
  muscleGroupLabels,
} from "@/lib/labels";
import { AvailabilityToggle } from "./availability-toggle";
import { LibraryFilters } from "./filters";

export const metadata = { title: "Library" };

type Search = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const params = await searchParams;

  const exercises = await listExercises({
    q: one(params.q),
    group: one(params.group) as ExerciseRow["primaryMuscleGroup"] | undefined,
    pattern: one(params.pattern) as ExerciseRow["movementPattern"] | undefined,
    forceVelocity: one(params.fv) as ExerciseRow["forceVelocity"] | undefined,
    include:
      one(params.include) === "all"
        ? "all"
        : one(params.include) === "unavailable"
          ? "unavailable"
          : "available",
  });

  // Already ordered by group then name, so a single pass builds the sections.
  const groups: { group: ExerciseRow["primaryMuscleGroup"]; rows: ExerciseRow[] }[] =
    [];
  for (const row of exercises) {
    const last = groups.at(-1);
    if (last?.group === row.primaryMuscleGroup) last.rows.push(row);
    else groups.push({ group: row.primaryMuscleGroup, rows: [row] });
  }

  return (
    <>
      <PageHeader
        title="Library"
        subtitle="Everything a plan can draw on. Switch off what you cannot do here and the generator never offers it."
      >
        <ButtonLink href="/library/new" variant="secondary">
          Add exercise
        </ButtonLink>
      </PageHeader>

      <LibraryFilters resultCount={exercises.length} />

      {exercises.length === 0 ? (
        <div className="mt-4">
          <EmptyState title="Nothing matches those filters">
            Clear a filter, or add the exercise if the directory is genuinely
            missing it.
          </EmptyState>
        </div>
      ) : (
        <div className="mt-6 space-y-7">
          {groups.map(({ group, rows }) => (
            <section key={group}>
              <h2 className="eyebrow mb-2">
                {muscleGroupLabels.of(group)}
                <span className="tnum ml-2 font-normal">{rows.length}</span>
              </h2>
              <ul className="divide-y divide-line overflow-hidden rounded-box bg-surface shadow-[inset_0_1px_0_oklch(100%_0_0/0.045)]">
                {rows.map((row) => (
                  <li key={row.slug} className="flex items-center gap-3 px-4 transition-colors hover:bg-surface-raised/50 sm:px-5">
                    <Link
                      href={`/library/${row.slug}`}
                      className="min-w-0 flex-1 py-3 focus-visible:outline-offset-4"
                    >
                      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                        <span
                          className={`font-medium ${row.available ? "text-ink" : "text-ink-faint line-through"}`}
                        >
                          {row.name}
                        </span>
                        {!row.isStock ? <Tag tone="cool">Custom</Tag> : null}
                        {row.highImpact ? <Tag tone="warn">Impact</Tag> : null}
                        {row.forceVelocity === "shock" ? (
                          <Tag tone="bad">Shock</Tag>
                        ) : null}
                      </span>
                      {/* Coupling class gets its own line rather than a third
                          dot-separated item, which wraps at 390px and leaves the
                          separator stranded at a line break. */}
                      <span className="mt-1 block text-xs text-ink-faint">
                        {movementPatternLabels.of(row.movementPattern)}
                        <span className="mx-2" aria-hidden="true">
                          ·
                        </span>
                        {forceVelocityLabels.of(row.forceVelocity)}
                      </span>
                      {row.couplingClass !== "not_plyometric" ? (
                        <span className="block text-xs text-ink-faint">
                          {couplingClassLabels.of(row.couplingClass)}
                        </span>
                      ) : null}
                    </Link>

                    <Pips
                      value={row.tendonLoadRating}
                      tone={row.tendonLoadRating >= 4 ? "warn" : "neutral"}
                      label="Tendon load"
                    />
                    <AvailabilityToggle
                      slug={row.slug}
                      name={row.name}
                      available={row.available}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
