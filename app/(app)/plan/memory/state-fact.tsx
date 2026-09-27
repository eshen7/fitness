"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Select, Textarea } from "@/components/ui";
import { memoryFactTypeLabels } from "@/lib/labels";
import { stateFactAction } from "@/lib/memory/actions";
import { MEMORY_FACT_TYPES, type MemoryFactType } from "@/lib/taxonomy";

/**
 * Telling the app something directly, rather than waiting for it to work it out.
 *
 * A stated fact is confirmed on arrival whatever it says, including the tendon and
 * retirement cases the gate holds an inference back for. The gate exists so a guess
 * does not act unasked; a person typing one is the asking.
 */
export function StateFact() {
  const router = useRouter();
  const [type, setType] = useState<MemoryFactType>("preference");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setError(null);
    start(async () => {
      const result = await stateFactAction({ type, body });
      if (!result.ok) {
        setError(result.errors?.body ?? result.message);
        return;
      }
      setBody("");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-[11rem_1fr] sm:items-start">
      {/* The wrapper is sized, not the field: `FIELD` already carries `w-full`. */}
      <Field label="Kind">
        <Select
          value={type}
          onChange={(event) => setType(event.target.value as MemoryFactType)}
        >
          {MEMORY_FACT_TYPES.map((value) => (
            <option key={value} value={value}>
              {memoryFactTypeLabels.of(value)}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="The fact"
        hint="One sentence, as the planner will read it."
        error={error ?? undefined}
      >
        <Textarea
          rows={2}
          value={body}
          placeholder="No access to a squat rack on Sundays."
          onChange={(event) => setBody(event.target.value)}
        />
      </Field>
      <div className="sm:col-start-2 sm:justify-self-end">
        <Button disabled={pending || body.trim().length < 8} onClick={submit}>
          {pending ? "Saving" : "Remember this"}
        </Button>
      </div>
    </div>
  );
}
