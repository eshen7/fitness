"use client";

import { useActionState } from "react";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { exerciseFormFields, type FormState } from "@/lib/exercises/form";
import type { ExerciseRow } from "@/lib/exercises/queries";
import {
  couplingClassLabels,
  equipmentLabels,
  forceVelocityLabels,
  lateralityLabels,
  movementPatternLabels,
  muscleGroupLabels,
  planeLabels,
  RATING_SCALE,
  tendonSiteLabels,
} from "@/lib/labels";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

const EMPTY: FormState = { ok: false };

/** Multi-select as checkboxes: a native multiple-select is unusable on a phone. */
function CheckGroup({
  name,
  entries,
  selected,
  columns = 2,
}: {
  name: string;
  entries: [string, string][];
  selected: readonly string[];
  columns?: 2 | 3;
}) {
  return (
    <div
      className={`grid gap-1.5 ${columns === 3 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2"}`}
    >
      {entries.map(([value, label]) => (
        <label
          key={value}
          className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-field border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-muted has-checked:border-accent/50 has-checked:text-ink"
        >
          <input
            type="checkbox"
            name={name}
            value={value}
            defaultChecked={selected.includes(value)}
            className="size-4 shrink-0 accent-[var(--color-accent)]"
          />
          {label}
        </label>
      ))}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {description ? (
        <p className="mt-1 text-xs text-ink-faint">{description}</p>
      ) : null}
      <div className="mt-4 space-y-4">{children}</div>
    </Card>
  );
}

export function ExerciseForm({
  action,
  exercise,
  submitLabel,
}: {
  action: Action;
  exercise?: ExerciseRow;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY);
  const error = (field: string) => state.errors?.[field]?.join(" ");

  // React clears an uncontrolled form once the action resolves, so the fields
  // render from what the server last saw rather than from the row on mount.
  const v = state.fields ?? exerciseFormFields(exercise);

  // Keyed on those values, which remounts every field once a response comes back.
  // Without it only the text inputs would pick up the echoed values: React writes
  // a changed `defaultValue` through to a live input, but a `<select>` or a
  // checkbox keeps whatever it mounted with, so a rejected submission would come
  // back half restored.
  return (
    <form
      key={JSON.stringify(v)}
      action={formAction}
      className="space-y-4 pb-4"
    >
      <Section title="Identity">
        <Field label="Name" error={error("name")}>
          <Input
            name="name"
            defaultValue={v.name}
            required
            maxLength={80}
            autoComplete="off"
          />
        </Field>

        {exercise ? (
          <Field
            label="Slug"
            hint="Immutable: the seed file, any prescription, and the generator's candidate set all refer to it."
          >
            <Input value={exercise.slug} readOnly disabled />
          </Field>
        ) : (
          <Field
            label="Slug"
            hint="Optional. Derived from the name if left blank."
            error={error("slug")}
          >
            <Input
              name="slug"
              defaultValue={v.slug}
              placeholder="auto"
              maxLength={80}
              autoComplete="off"
            />
          </Field>
        )}
      </Section>

      <Section
        title="Classification"
        description="These drive session ordering and which candidate set the exercise lands in."
      >
        <Field label="Primary muscle group" error={error("primaryMuscleGroup")}>
          <Select
            name="primaryMuscleGroup"
            defaultValue={v.primaryMuscleGroup}
          >
            {muscleGroupLabels.entries().map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Secondary muscle groups" error={error("secondaryMuscleGroups")}>
          <CheckGroup
            name="secondaryMuscleGroups"
            entries={muscleGroupLabels.entries()}
            selected={v.secondaryMuscleGroups}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Movement pattern" error={error("movementPattern")}>
            <Select
              name="movementPattern"
              defaultValue={v.movementPattern}
            >
              {movementPatternLabels.entries().map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Force velocity"
            hint="Max strength helps power; power does not help max strength."
            error={error("forceVelocity")}
          >
            <Select
              name="forceVelocity"
              defaultValue={v.forceVelocity}
            >
              {forceVelocityLabels.entries().map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Laterality" error={error("laterality")}>
            <Select name="laterality" defaultValue={v.laterality}>
              {lateralityLabels.entries().map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Plane" error={error("plane")}>
            <Select name="plane" defaultValue={v.plane}>
              {planeLabels.entries().map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Technical complexity"
          hint="1 trivial to 5 highly technical. The most demanding work is ordered first, while rested."
          error={error("technicalComplexity")}
        >
          <Select
            name="technicalComplexity"
            defaultValue={v.technicalComplexity}
          >
            {RATING_SCALE.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
      </Section>

      <Section
        title="Plyometric attributes"
        description="Leave as not plyometric for anything that is not a jump or drill. Shock method requires ground contact under 0.15 s, and nothing slower may be labelled as shock."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Coupling class" error={error("couplingClass")}>
            <Select
              name="couplingClass"
              defaultValue={v.couplingClass}
            >
              {couplingClassLabels.entries().map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field
            label="Typical ground contact (s)"
            hint="Short SSC under 0.25 s, long SSC over."
            error={error("typicalContactSeconds")}
          >
            <Input
              name="typicalContactSeconds"
              type="number"
              step="0.005"
              min="0.05"
              max="9.999"
              inputMode="decimal"
              defaultValue={v.typicalContactSeconds}
              placeholder="0.180"
              className="tnum"
            />
          </Field>
        </div>

        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-field border border-line bg-surface-sunken px-3 py-2.5">
          <input
            type="checkbox"
            name="highImpact"
            defaultChecked={v.highImpact}
            className="mt-0.5 size-4 shrink-0 accent-[var(--color-accent)]"
          />
          <span className="text-sm">
            <span className="font-medium text-ink">High impact</span>
            <span className="mt-0.5 block text-xs text-ink-faint">
              Every rep counts toward the weekly contact ceiling that pain risk is
              modelled against.
            </span>
          </span>
        </label>
      </Section>

      <Section
        title="Tendon load"
        description="This drives the pre-filter. A site in protocol phase 1 or 2 removes every exercise listing it from the candidate set entirely, so be honest rather than optimistic."
      >
        <Field label="Loads these sites" error={error("loadsTendonSites")}>
          <CheckGroup
            name="loadsTendonSites"
            entries={tendonSiteLabels.entries()}
            selected={v.loadsTendonSites}
          />
        </Field>

        <Field
          label="Tendon load rating"
          hint="1 gentle to 5 severe. One-foot jumping loads a leg at up to 14 times bodyweight and sits at 5."
          error={error("tendonLoadRating")}
        >
          <Select
            name="tendonLoadRating"
            defaultValue={v.tendonLoadRating}
          >
            {RATING_SCALE.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
      </Section>

      <Section
        title="Equipment"
        description="Only equipment that is actually available is eligible, so this is what the pre-filter matches against."
      >
        <Field label="Equipment" error={error("equipment")}>
          <CheckGroup
            name="equipment"
            entries={equipmentLabels.entries()}
            selected={v.equipment}
            columns={3}
          />
        </Field>
      </Section>

      <Section title="Coaching">
        <Field label="Cues" hint="One per line. Shown on the session card while lifting.">
          <Textarea name="cues" rows={4} defaultValue={v.cues} />
        </Field>

        <Field label="Notes" hint="Why this exercise exists in the directory, and when to use it.">
          <Textarea name="notes" rows={4} defaultValue={v.notes} />
        </Field>
      </Section>

      {state.message ? (
        <p
          role="status"
          className={`text-sm ${state.ok ? "text-good" : "text-bad"}`}
        >
          {state.message}
        </p>
      ) : null}

      {/* Sticky above the 56px tab bar on mobile, where the form is long and the
          submit would otherwise be a scroll away. From `md` up the content is a
          capped measure inside a much wider main, so a floating band would end
          mid-screen with the form visible past its edge: it becomes an ordinary
          footer instead. */}
      <div className="sticky bottom-14 z-10 -mx-4 border-t border-line bg-surface-sunken/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:backdrop-blur-none">
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
