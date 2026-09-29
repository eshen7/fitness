"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { declareBlock } from "@/lib/ai/actions";
import { mesocycleTypeLabels } from "@/lib/labels";
import { MESOCYCLE_TYPES } from "@/lib/taxonomy";

/**
 * Opening a block: the start date, how long it runs, and anything the owner wants
 * the generator to know.
 *
 * The type is a preference and labelled as one. The declaration still has to
 * satisfy the block-scope rules, and a type that cannot carry the targets the
 * state calls for would fail every attempt, so forcing it would trade a good
 * block for an obeyed dropdown.
 */
export function DeclareBlock({
  defaultStartDate,
  disabled,
}: {
  defaultStartDate: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [weeks, setWeeks] = useState("4");
  const [preferredType, setPreferredType] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();

  function submit() {
    setMessage(null);
    start(async () => {
      const result = await declareBlock({
        startDate,
        weeks: Number(weeks),
        preferredType: preferredType === "" ? null : preferredType,
        note: note.trim() === "" ? null : note.trim(),
      });
      setOk(result.ok);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts">
          <Input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </Field>
        <Field label="Weeks" hint="Two to six. Four is the usual mesocycle.">
          <Input
            type="number"
            min={2}
            max={6}
            step={1}
            value={weeks}
            onChange={(event) => setWeeks(event.target.value)}
          />
        </Field>
      </div>

      <Field
        label="Preferred type"
        hint="A preference, not an instruction: the gate still decides."
      >
        <Select
          value={preferredType}
          onChange={(event) => setPreferredType(event.target.value)}
        >
          <option value="">Let the generator choose</option>
          {MESOCYCLE_TYPES.map((type) => (
            <option key={type} value={type}>
              {mesocycleTypeLabels.of(type)}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="Anything it should know"
        hint="Travel, a sore knee, a date you want to peak for."
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
          {pending ? "Generating…" : "Declare block"}
        </Button>
        {pending ? (
          <span className="text-xs text-ink-faint">
            One call plus up to three repairs. This takes a moment.
          </span>
        ) : null}
      </div>

      {message ? (
        <p
          role="status"
          className={`text-sm [overflow-wrap:anywhere] ${ok ? "text-ink-muted" : "text-bad"}`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
