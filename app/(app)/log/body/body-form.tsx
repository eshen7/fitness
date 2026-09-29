"use client";

import { useState, useTransition } from "react";
import { SubmitBar } from "@/components/submit-bar";
import { Card, Field, Input, Select, Textarea } from "@/components/ui";
import { logBodyValue } from "@/lib/log/actions";
import type { ActionResult } from "@/lib/log/schemas";
import { measurementKindLabels } from "@/lib/labels";
import { BODY_KINDS, type BodyKind, type UnitSystem } from "@/lib/taxonomy";
import { dimensionOf, displayUnit } from "@/lib/units";

const HINTS: Record<BodyKind, string> = {
  bodyweight:
    "Daily, first thing, before eating. The trend is what everything reads against, and a filtered trend needs frequent points more than it needs careful ones.",
  lean_mass:
    "Only when it was actually measured. Comparing estimated 1RM change against lean mass change is what separates a neural gain from a hypertrophy one.",
  body_fat_pct: "Relative strength is what predicts jumping, so this is context for it.",
  reach_height:
    "Measured once, and again after a growth spurt. A touch height minus this is the vertical to log as a test.",
};

export function BodyForm({ unitSystem }: { unitSystem: UnitSystem }) {
  const [kind, setKind] = useState<BodyKind>("bodyweight");
  const [value, setValue] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const unit = displayUnit(dimensionOf(kind), unitSystem);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    start(async () => {
      const response = await logBodyValue({ kind, value, notes });
      setResult(response);
      if (response.ok) {
        setValue("");
        setNotes("");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-4">
      <Card className="space-y-4">
        <Field label="Measurement">
          <Select
            value={kind}
            onChange={(event) => setKind(event.target.value as BodyKind)}
          >
            {BODY_KINDS.map((option) => (
              <option key={option} value={option}>
                {measurementKindLabels.of(option)}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label={unit ? `Value (${unit})` : "Value"}
          hint={HINTS[kind]}
          error={result?.errors?.value}
        >
          <Input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoFocus
            className="tnum"
          />
        </Field>

        <Field label="Notes">
          <Textarea
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </Card>

      <SubmitBar pending={pending} label="Log" result={result} />
    </form>
  );
}
