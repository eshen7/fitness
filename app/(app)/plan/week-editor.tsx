"use client";

import { DetailLine, Input, Tag } from "@/components/ui";
import type { MicrocyclePlan, PlannedSet } from "@/lib/engine/types";
import { loadTypeLabels, sessionKindLabels } from "@/lib/labels";
import { formatDay } from "@/lib/days";
import {
  describePrescription,
  prescriptionDetail,
  type PrescriptionMaxes,
} from "@/lib/prescription";
import type { UnitSystem } from "@/lib/taxonomy";

/**
 * The proposed week, readable first and editable second.
 *
 * Read-only is the normal case, so the rendering is the same in both modes and
 * editing swaps the numbers for inputs in place. A separate edit screen would mean
 * accepting a plan you are no longer looking at.
 *
 * Only the fields an owner actually overrules are editable: how many sets, how
 * many reps, how much load, which day. Rest, ordering and coupling labels belong
 * to the normalizer, so they are shown and not typed into - an editable rest field
 * would be overwritten by the re-normalization that follows the edit, which is a
 * worse experience than not offering it.
 */

/**
 * The fields the editor exposes, with the step and unit each one reads in. The
 * label names the stored unit, because the read-only prescription above converts
 * to the owner's units and a bare "45" under a line reading "17.7 in box" is a
 * number nobody can place.
 */
const NUMERIC_FIELDS = [
  { field: "sets", label: "Sets", step: 1, suffix: "" },
  { field: "reps", label: "Reps", step: 1, suffix: "" },
  { field: "loadKg", label: "Load kg", step: 2.5, suffix: " kg" },
  { field: "loadPctOf1rm", label: "%1RM", step: 1, suffix: "%" },
  { field: "boxHeightCm", label: "Box cm", step: 5, suffix: " cm" },
  { field: "holdSeconds", label: "Hold s", step: 5, suffix: " s" },
  { field: "targetRpe", label: "RPE", step: 0.5, suffix: " RPE" },
] as const satisfies readonly {
  field: keyof PlannedSet;
  label: string;
  step: number;
  suffix: string;
}[];

/**
 * What turns a percentage of 1RM into a load on the bar: the owner's units, each
 * lift's current max from `prescriptionMaxes`, and each lift's slug so a lift with no max can
 * link to the page where one is entered. Keyed by exercise id as a string.
 */
export type PlanLoads = {
  unitSystem: UnitSystem;
  maxes: PrescriptionMaxes;
  slugs: Record<string, string>;
};

export type WeekEdit = {
  /** The session's index in the week shown, since two sessions can share a day. */
  session: number;
  exerciseId: number;
  field: (typeof NUMERIC_FIELDS)[number]["field"];
  value: number | null;
};

/**
 * The numeric fields each exercise carries in the week as proposed. The editor
 * offers these rather than whatever is set right now, so clearing a field to type
 * a new number does not take the input away mid-edit.
 */
function editableFields(week: MicrocyclePlan) {
  const fields = new Map<number, Set<keyof PlannedSet>>();
  for (const session of week.sessions) {
    for (const block of session.blocks) {
      for (const item of block.items) {
        const held = fields.get(item.exerciseId) ?? new Set<keyof PlannedSet>();
        for (const { field } of NUMERIC_FIELDS) {
          if (item[field] != null) held.add(field);
        }
        fields.set(item.exerciseId, held);
      }
    }
  }
  return fields;
}

export function WeekEditor({
  week,
  proposed = week,
  names,
  loads,
  editing,
  onChange,
  onMoveSession,
  onDropSession,
  onDropItem,
  sessionKeys,
}: {
  week: MicrocyclePlan;
  /** The week as the model proposed it, before any edit. Defaults to `week`. */
  proposed?: MicrocyclePlan;
  names: Record<string, string>;
  loads: PlanLoads;
  editing: boolean;
  onChange?: (edit: WeekEdit) => void;
  onMoveSession?: (session: number, to: string) => void;
  onDropSession?: (session: number) => void;
  onDropItem?: (session: number, exerciseId: number) => void;
  /** A stable identity per session, so a move that reorders the week moves its card. */
  sessionKeys?: readonly number[];
}) {
  const editable = editableFields(proposed);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
        <Tag tone={week.loadType === "stimulating" ? "accent" : "cool"}>
          {loadTypeLabels.of(week.loadType)}
        </Tag>
        <span>
          <DetailLine
            parts={[
              `Week ${week.ordinal}`,
              `from ${formatDay(week.startDate)}`,
              <span key="load" className="tnum">
                relative load {week.relativeLoad.toFixed(2)}
              </span>,
            ]}
          />
        </span>
      </div>

      {week.sessions.length === 0 ? (
        <p className="text-sm text-ink-faint">No sessions.</p>
      ) : null}

      {week.sessions.map((session, sessionIndex) => (
        <div
          key={sessionKeys?.[sessionIndex] ?? sessionIndex}
          className="rounded-box bg-surface-sunken p-3 sm:p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="font-display text-lg leading-tight font-bold text-ink">
                  {session.title ?? sessionKindLabels.of(session.kind)}
                </h4>
                <Tag>{sessionKindLabels.of(session.kind)}</Tag>
                <Tag tone={session.plannedIntensity >= 8 ? "warn" : "neutral"}>
                  intensity {session.plannedIntensity}
                </Tag>
              </div>
              {editing ? (
                <div className="mt-2 flex items-center gap-2">
                  {/* No width class on the field: `Input` is `w-full` by design and
                      a `w-*` here only races it. It takes the room the button leaves. */}
                  <Input
                    type="date"
                    aria-label={`Day for ${session.title ?? sessionKindLabels.of(session.kind)}`}
                    value={session.day}
                    onChange={(event) =>
                      onMoveSession?.(sessionIndex, event.target.value)
                    }
                    className="h-11 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => onDropSession?.(sessionIndex)}
                    aria-label={`Drop ${session.title ?? sessionKindLabels.of(session.kind)} on ${formatDay(session.day)}`}
                    className="h-11 shrink-0 rounded-field border border-bad/40 press px-3 text-xs font-semibold whitespace-nowrap text-bad hover:bg-bad/10"
                  >
                    Drop session
                  </button>
                </div>
              ) : (
                <p className="mt-0.5 text-xs text-ink-faint">{formatDay(session.day)}</p>
              )}
            </div>
          </div>

          <div className="mt-3 space-y-3">
            {session.blocks.map((block, blockIndex) => (
              <div key={`${block.label}-${blockIndex}`}>
                <div className="flex items-center gap-2">
                  <p className="eyebrow">
                    {block.label}
                  </p>
                  {block.complexPair ? <Tag tone="cool">complex pair</Tag> : null}
                </div>
                <ul className="mt-1">
                  {block.items.map((item) => (
                    <li
                      key={item.exerciseId}
                      className="border-t border-line py-2.5 first:border-t-0"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="text-sm text-ink">
                          {names[String(item.exerciseId)] ?? `Exercise ${item.exerciseId}`}
                        </span>
                        {editing ? null : (
                          <span className="tnum text-sm text-ink-muted">
                            {describePrescription(
                              item,
                              loads.unitSystem,
                              loads.maxes[String(item.exerciseId)],
                            )}
                          </span>
                        )}
                      </div>

                      {editing ? (
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          {NUMERIC_FIELDS.filter(
                            ({ field }) =>
                              item[field] != null ||
                              editable.get(item.exerciseId)?.has(field),
                          ).map(({ field, label, step }) => (
                            // Flex rather than a fixed width: four fixed 80px
                            // fields and Drop overrun a phone's row and strand the
                            // last two on a line of their own. Sizing the label and
                            // not the Input keeps FIELD's `w-full` uncontested.
                            <label key={field} className="block w-0 max-w-20 min-w-12 flex-1">
                              <span className="mb-0.5 block text-xs text-ink-faint">
                                {label}
                              </span>
                              <Input
                                type="number"
                                step={step}
                                min={0}
                                value={String(item[field] ?? "")}
                                aria-label={`${label} for ${names[String(item.exerciseId)] ?? item.exerciseId}`}
                                onChange={(event) =>
                                  onChange?.({
                                    session: sessionIndex,
                                    exerciseId: item.exerciseId,
                                    field,
                                    value:
                                      event.target.value === ""
                                        ? null
                                        : Number(event.target.value),
                                  })
                                }
                                className="tnum h-11 text-sm"
                              />
                            </label>
                          ))}
                          <button
                            type="button"
                            onClick={() => onDropItem?.(sessionIndex, item.exerciseId)}
                            aria-label={`Drop ${names[String(item.exerciseId)] ?? `exercise ${item.exerciseId}`} from ${session.title ?? sessionKindLabels.of(session.kind)}`}
                            className="h-11 shrink-0 rounded-field border border-bad/40 press px-3 text-xs font-semibold text-bad hover:bg-bad/10"
                          >
                            Drop
                          </button>
                        </div>
                      ) : (
                        <p className="mt-0.5 text-xs text-ink-faint">
                          {prescriptionDetail(item)}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
