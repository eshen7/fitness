"use client";

import { useState, useTransition } from "react";
import { Button, Card, Input } from "@/components/ui";
import { formatDay } from "@/lib/days";
import { logTestedMax } from "@/lib/log/actions";
import type { ActionResult } from "@/lib/log/schemas";
import type { CurrentOneRm } from "@/lib/strength/one-rm";
import type { UnitSystem } from "@/lib/taxonomy";
import { formatMeasurement } from "@/lib/units";

/**
 * The lift's current max and where it came from, with a field to enter one the
 * owner actually tested. A tested max is what "% 1RM" prescriptions load from
 * ahead of the estimate, so this is also the fix for a lift that has none yet.
 */
export function TestedMax({
  exerciseId,
  current,
  unitSystem,
}: {
  exerciseId: number;
  current: CurrentOneRm | null;
  unitSystem: UnitSystem;
}) {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  const unit = unitSystem === "imperial" ? "lb" : "kg";

  function submit(event: React.FormEvent) {
    event.preventDefault();
    start(async () => {
      const response = await logTestedMax({ exerciseId, value });
      setResult(response);
      if (response.ok) setValue("");
    });
  }

  return (
    <Card className="mb-4">
      <h2 className="text-sm font-medium text-ink-muted">One-rep max</h2>
      {current ? (
        <p className="mt-1 text-sm text-ink-faint">
          <span className="tnum text-xl font-semibold text-ink">
            {formatMeasurement(current.kg, "tested_1rm", unitSystem)}
          </span>{" "}
          {current.source === "tested" ? "tested" : "estimated from a heavy set"},{" "}
          <span className="tnum">{formatDay(current.day)}</span>
        </p>
      ) : (
        <p className="mt-1 text-sm text-ink-faint">
          None yet. Log a set of 1 to 10 reps or enter a tested max, and every
          &ldquo;% 1RM&rdquo; prescription of this lift becomes a load.
        </p>
      )}

      <form onSubmit={submit} className="mt-4">
        <label htmlFor="tested-max" className="mb-1.5 block text-sm font-medium text-ink-muted">
          Tested max ({unit})
        </label>
        <div className="flex gap-2">
          <Input
            id="tested-max"
            type="number"
            inputMode="decimal"
            step="0.5"
            min="0"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            aria-invalid={result?.ok === false}
            className="tnum"
          />
          <Button type="submit" variant="secondary" disabled={pending} className="shrink-0">
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
        {result ? (
          <p
            role="status"
            className={`mt-1.5 text-xs ${result.ok ? "text-good" : "text-bad"}`}
          >
            {result.message}
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-ink-faint">
            Takes precedence over the estimate until a later set beats it.
          </p>
        )}
      </form>
    </Card>
  );
}
