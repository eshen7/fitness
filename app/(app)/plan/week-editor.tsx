"use client";

import { Input, Tag } from "@/components/ui";
import { formatSeconds } from "@/lib/engine/classify";
import type { MicrocyclePlan, PlannedSet } from "@/lib/engine/types";
import { couplingClassLabels, loadTypeLabels, sessionKindLabels } from "@/lib/labels";
import { formatDay } from "@/lib/days";

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

/** The fields the editor exposes, with the step and unit each one reads in. */
const NUMERIC_FIELDS = [
  { field: "sets", label: "sets", step: 1, suffix: "" },
  { field: "reps", label: "reps", step: 1, suffix: "" },
  { field: "loadKg", label: "kg", step: 2.5, suffix: " kg" },
  { field: "loadPctOf1rm", label: "%1RM", step: 1, suffix: "%" },
  { field: "boxHeightCm", label: "box", step: 5, suffix: " cm" },
  { field: "holdSeconds", label: "hold", step: 5, suffix: " s" },
  { field: "targetRpe", label: "RPE", step: 0.5, suffix: " RPE" },
] as const satisfies readonly {
  field: keyof PlannedSet;
  label: string;
  step: number;
  suffix: string;
}[];

export type WeekEdit = {
  day: string;
  exerciseId: number;
  field: (typeof NUMERIC_FIELDS)[number]["field"];
  value: number | null;
};

export function WeekEditor({
  week,
  names,
  editing,
  onChange,
  onMoveSession,
  onDropSession,
  onDropItem,
}: {
  week: MicrocyclePlan;
  names: Record<string, string>;
  editing: boolean;
  onChange?: (edit: WeekEdit) => void;
  onMoveSession?: (from: string, to: string) => void;
  onDropSession?: (day: string) => void;
  onDropItem?: (day: string, exerciseId: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
        <Tag tone={week.loadType === "stimulating" ? "accent" : "cool"}>
          {loadTypeLabels.of(week.loadType)}
        </Tag>
        <span>Week {week.ordinal}</span>
        <span aria-hidden="true">·</span>
        <span>from {formatDay(week.startDate)}</span>
        <span aria-hidden="true">·</span>
        <span>relative load {week.relativeLoad.toFixed(2)}</span>
      </div>

      {week.sessions.length === 0 ? (
        <p className="text-sm text-ink-faint">No sessions.</p>
      ) : null}

      {week.sessions.map((session) => (
        <div
          key={`${session.kind}-${session.day}`}
          className="rounded-box border border-line bg-surface-sunken p-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-ink">
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
                    aria-label={`Day for ${sessionKindLabels.of(session.kind)}`}
                    value={session.day}
                    onChange={(event) =>
                      onMoveSession?.(session.day, event.target.value)
                    }
                    className="h-9 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => onDropSession?.(session.day)}
                    className="h-9 shrink-0 rounded-field border border-bad/40 px-3 text-xs font-semibold whitespace-nowrap text-bad transition hover:bg-bad/10"
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
                  <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
                    {block.label}
                  </p>
                  {block.complexPair ? <Tag tone="cool">complex pair</Tag> : null}
                </div>
                <ul className="mt-1.5 space-y-1.5">
                  {block.items.map((item) => (
                    <li
                      key={item.exerciseId}
                      className="rounded-field border border-line/70 bg-surface px-3 py-2"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="text-sm text-ink">
                          {names[String(item.exerciseId)] ?? `Exercise ${item.exerciseId}`}
                        </span>
                        {editing ? null : (
                          <span className="text-xs tabular-nums text-ink-muted">
                            {describe(item)}
                          </span>
                        )}
                      </div>

                      {editing ? (
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          {NUMERIC_FIELDS.filter(
                            ({ field }) => item[field] !== null && item[field] !== undefined,
                          ).map(({ field, label, step }) => (
                            <label key={field} className="block">
                              <span className="mb-0.5 block text-[0.6875rem] text-ink-faint">
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
                                    day: session.day,
                                    exerciseId: item.exerciseId,
                                    field,
                                    value:
                                      event.target.value === ""
                                        ? null
                                        : Number(event.target.value),
                                  })
                                }
                                className="h-9 w-20 text-xs tabular-nums"
                              />
                            </label>
                          ))}
                          <button
                            type="button"
                            onClick={() => onDropItem?.(session.day, item.exerciseId)}
                            className="h-9 rounded-field border border-bad/40 px-3 text-xs font-semibold text-bad transition hover:bg-bad/10"
                          >
                            Drop
                          </button>
                        </div>
                      ) : (
                        <p className="mt-0.5 text-xs text-ink-faint">
                          {[
                            item.restSeconds == null
                              ? null
                              : `${formatSeconds(item.restSeconds)} rest`,
                            item.couplingClass
                              ? couplingClassLabels.of(item.couplingClass)
                              : null,
                            item.tempo ? `tempo ${item.tempo}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
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

/** The prescription in one line: `4 x 8 at 85%, 45 cm`. */
function describe(item: PlannedSet) {
  const reps =
    item.reps != null
      ? `${item.sets} x ${item.reps}`
      : item.holdSeconds != null
        ? `${item.sets} x ${item.holdSeconds}s`
        : `${item.sets} sets`;
  const load = [
    item.loadPctOf1rm != null ? `${item.loadPctOf1rm}% 1RM` : null,
    item.loadKg != null ? `${item.loadKg} kg` : null,
    item.boxHeightCm != null ? `${item.boxHeightCm} cm box` : null,
    item.targetRpe != null ? `RPE ${item.targetRpe}` : null,
  ].filter(Boolean);
  return load.length ? `${reps} at ${load.join(", ")}` : reps;
}
