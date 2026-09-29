"use client";

import { useState, useTransition } from "react";
import { ScoreRow } from "@/components/score-row";
import { SubmitBar } from "@/components/submit-bar";
import { Card, Field, Input, Textarea } from "@/components/ui";
import { logReadiness } from "@/lib/log/actions";
import type { ActionResult } from "@/lib/log/schemas";
import { muscleGroupLabels } from "@/lib/labels";
import { MUSCLE_GROUPS, type MuscleGroup } from "@/lib/taxonomy";

export type ReadinessPrefill = {
  soreness: Partial<Record<MuscleGroup, number>>;
  motivation: number | null;
  priorSessionRpe: string;
  /** True when the RPE came from the last finished session, not a saved check-in. */
  priorSessionRpeFilled: boolean;
  notes: string;
};

/**
 * The daily check-in, prefilled from today's row if there is one.
 *
 * One row per day, upserted, so coming back to correct a number is the same action
 * as entering it. Soreness is per muscle group rather than a single number because
 * fatigue is specific to the type of muscular work: a posterior chain that cannot
 * take another session says nothing about whether upper pull can.
 */
export function ReadinessForm({ prefill }: { prefill: ReadinessPrefill }) {
  const [soreness, setSoreness] = useState<Partial<Record<MuscleGroup, number>>>(
    prefill.soreness,
  );
  /**
   * The one soreness region showing its buttons, if any.
   *
   * Eight regions at eleven buttons each is most of a phone screen scrolled twice,
   * for a question whose answer is usually zero everywhere. One open at a time
   * keeps the whole check-in visible while it is being filled in.
   */
  const [openGroup, setOpenGroup] = useState<MuscleGroup | null>(null);
  const [motivation, setMotivation] = useState<number | null>(prefill.motivation);
  const [priorSessionRpe, setPriorSessionRpe] = useState(prefill.priorSessionRpe);
  const [notes, setNotes] = useState(prefill.notes);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    start(async () => {
      const response = await logReadiness({
        soreness: Object.fromEntries(
          MUSCLE_GROUPS.map((group) => [group, soreness[group]?.toString() ?? ""]),
        ),
        motivation: motivation?.toString() ?? "",
        priorSessionRpe,
        notes,
      });
      setResult(response);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-4">
      <Card className="space-y-1">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Soreness</h2>
          <button
            type="button"
            onClick={() => {
              setSoreness(
                Object.fromEntries(MUSCLE_GROUPS.map((group) => [group, 0])),
              );
              setOpenGroup(null);
            }}
            className="-my-2 inline-flex min-h-11 items-center text-xs font-medium text-accent hover:underline"
          >
            None anywhere
          </button>
        </div>
        {MUSCLE_GROUPS.map((group) => {
          const value = soreness[group] ?? null;
          const open = openGroup === group;
          return (
            <div key={group}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenGroup(open ? null : group)}
                className={`flex h-11 w-full items-center justify-between gap-3 rounded-field px-3 text-left text-sm transition ${
                  open ? "bg-surface-sunken" : "hover:bg-surface-sunken/60"
                }`}
              >
                <span className="truncate text-ink-muted">
                  {muscleGroupLabels.of(group)}
                </span>
                <span
                  className={`tnum text-sm font-semibold ${
                    value === null
                      ? "text-ink-faint"
                      : value === 0
                        ? "text-ink-muted"
                        : "text-warn"
                  }`}
                >
                  {value ?? "-"}
                </span>
              </button>
              {open ? (
                <div className="px-3 pt-2 pb-3">
                  <ScoreRow
                    label={muscleGroupLabels.of(group)}
                    labelHidden
                    tone="warn"
                    value={value}
                    onChange={(next) => {
                      setSoreness((current) => {
                        const updated = { ...current };
                        if (next === null) delete updated[group];
                        else updated[group] = next;
                        return updated;
                      });
                      // Collapsing on answer makes eight regions two taps each
                      // rather than two taps plus a scroll.
                      setOpenGroup(null);
                    }}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </Card>

      <Card className="space-y-4">
        <ScoreRow
          label="Motivation"
          hint="0 flat, 10 keen"
          value={motivation}
          onChange={setMotivation}
        />

        <Field
          label="Prior session RPE"
          hint={`1 to 10, how hard the last session actually felt.${
            prefill.priorSessionRpeFilled && priorSessionRpe === prefill.priorSessionRpe
              ? " Filled in from what you gave when you finished it."
              : ""
          } Prescribed minus actual is the correction factor the generator calibrates against.`}
          error={result?.errors?.priorSessionRpe}
        >
          <Input
            type="number"
            inputMode="decimal"
            step="0.5"
            min="1"
            max="10"
            value={priorSessionRpe}
            onChange={(event) => setPriorSessionRpe(event.target.value)}
            className="tnum"
          />
        </Field>

        <Field
          label="Notes"
          hint="Sleep, stress, anything outside training. The reflection job reads this."
        >
          <Textarea
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </Card>

      <SubmitBar pending={pending} label="Check in" result={result} />
    </form>
  );
}
