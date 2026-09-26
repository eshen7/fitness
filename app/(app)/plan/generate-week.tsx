"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { generateNextWeek } from "@/lib/ai/actions";
import { formatDay } from "@/lib/days";

/**
 * Generating the next week, or regenerating one.
 *
 * A regeneration passes `supersedesId`, which is what makes the old proposal a
 * superseded row rather than an overwritten one. Same button, same note field:
 * the note is the steer, and "too much bounding" is the most useful thing the
 * owner can say at the moment they are throwing a week away.
 */
export function GenerateWeek({
  mesocycleId,
  ordinal,
  startDate,
  supersedesId,
  label,
  disabled,
}: {
  mesocycleId: number;
  ordinal: number;
  startDate: string;
  supersedesId?: number;
  label?: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [day, setDay] = useState(startDate);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [open, setOpen] = useState(supersedesId === undefined);
  const [pending, start] = useTransition();

  function submit() {
    setMessage(null);
    start(async () => {
      const result = await generateNextWeek({
        mesocycleId,
        startDate: day,
        note: note.trim() === "" ? null : note.trim(),
        supersedesId: supersedesId ?? null,
      });
      setOk(result.ok);
      setMessage(result.message);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        {label ?? "Regenerate"}
      </Button>
    );
  }

  return (
    <div className="space-y-4">
      <Field
        label={supersedesId ? "Regenerate week starting" : `Week ${ordinal} starts`}
        hint={`Defaults to ${formatDay(startDate)}.`}
      >
        <Input
          type="date"
          value={day}
          onChange={(event) => setDay(event.target.value)}
        />
      </Field>

      <Field
        label={supersedesId ? "What was wrong with it" : "Anything it should know"}
        hint={
          supersedesId
            ? "This goes into the next attempt, so be specific."
            : "Soreness, a missed session, a day you cannot train."
        }
      >
        <Textarea
          rows={3}
          value={note}
          placeholder="Optional"
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" onClick={submit} disabled={pending || disabled}>
          {pending
            ? "Generating…"
            : (label ?? (supersedesId ? "Regenerate" : `Generate week ${ordinal}`))}
        </Button>
        {supersedesId ? (
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        ) : null}
        {pending ? (
          <span className="text-xs text-ink-faint">
            One call plus up to three repairs. This takes a moment.
          </span>
        ) : null}
      </div>

      {message ? (
        <p role="status" className={`text-sm ${ok ? "text-ink-muted" : "text-bad"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
