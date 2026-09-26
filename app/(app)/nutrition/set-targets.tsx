"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Select } from "@/components/ui";
import { applyTargets } from "@/lib/nutrition/actions";
import type { TargetGoal } from "@/lib/nutrition/targets";

/**
 * The goal, and nothing else.
 *
 * There is no field for the calories, on purpose. The one rule worth having here is
 * that a cut waits for healthy tendons and for a block that is not a peak, and a
 * number typed by hand would walk straight past it. So the owner picks a direction
 * and the server does the arithmetic against the state it can see: a cut asked for
 * and not allowed comes back as maintenance with the reason attached, rather than as
 * an error.
 */

/**
 * Short labels, because the control is 200px wide on a phone and a native select
 * truncates rather than wrapping. What each one means is the hint below it.
 */
const GOALS: { value: TargetGoal; label: string }[] = [
  { value: "gain", label: "Gain - a surplus" },
  { value: "hold", label: "Hold - maintenance" },
  { value: "cut", label: "Cut - a deficit" },
];

export function SetTargets({ defaultGoal }: { defaultGoal: TargetGoal }) {
  const router = useRouter();
  const [goal, setGoal] = useState<TargetGoal>(defaultGoal);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [pending, start] = useTransition();

  function submit() {
    setMessage(null);
    start(async () => {
      const result = await applyTargets({ goal });
      setOk(result.ok);
      setMessage(result.message);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {/*
        The hint sits below the row rather than inside `Field`, so that `items-end`
        lines the button up with the select rather than with the last line of two
        lines of explanation.
      */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-1">
          <Field label="Goal">
            <Select
              value={goal}
              onChange={(event) => setGoal(event.target.value as TargetGoal)}
            >
              {GOALS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={submit}
          disabled={pending}
          className="shrink-0"
        >
          {pending ? "Setting…" : "Set targets"}
        </Button>
      </div>

      <p className="-mt-1.5 text-xs text-ink-faint">
        The block&rsquo;s own suggestion is pre-selected. A cut the rules do not allow
        is written as maintenance, with the reason.
      </p>

      {message ? (
        <p role="status" className={`text-sm ${ok ? "text-ink-muted" : "text-bad"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
