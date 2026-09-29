"use client";

import { useState, useTransition } from "react";
import { SubmitBar } from "@/components/submit-bar";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { logTest } from "@/lib/log/actions";
import type { ActionResult } from "@/lib/log/schemas";
import { measurementKindLabels } from "@/lib/labels";
import { TEST_KINDS, type TestKind, type UnitSystem } from "@/lib/taxonomy";
import { displayUnit, round1 } from "@/lib/units";

/**
 * A test sitting, entered as its attempts.
 *
 * Controlled state rather than an uncontrolled form: the number of attempt fields
 * changes as they are added, and React clears an uncontrolled form once its action
 * resolves, which would take the kind and the notes with it.
 */
const BLANK_ATTEMPTS = ["", "", ""];

/**
 * What number an attempt is. Nothing converts a touch height, so a vertical is
 * entered as the jump itself; asking for "(in)" alone invites the reading off
 * the wall.
 */
function attemptHint(kind: TestKind): string {
  if (kind === "broad_jump") return "Takeoff line to the back of the nearer heel.";
  return "The jump itself: touch height minus standing reach.";
}

export function TestForm({ unitSystem }: { unitSystem: UnitSystem }) {
  const [kind, setKind] = useState<TestKind>("standing_vertical");
  const [attempts, setAttempts] = useState<string[]>(BLANK_ATTEMPTS);
  const [boxHeight, setBoxHeight] = useState("");
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const unit = displayUnit("length", unitSystem);
  const isDepthJump = kind === "depth_jump_vertical";
  const entered = attempts
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
  const error = (path: string) => result?.errors?.[path];

  function setAttempt(index: number, value: string) {
    setAttempts((current) => current.map((v, i) => (i === index ? value : v)));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    start(async () => {
      const response = await logTest({ kind, attempts, boxHeight, notes });
      setResult(response);
      if (response.ok) {
        // The kind and the box height survive: the next sitting is usually the
        // same test, and re-picking it every time is friction for no reason.
        setAttempts(BLANK_ATTEMPTS);
        setNotes("");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4 pb-4">
      <Card>
        <Field label="Test">
          <Select
            value={kind}
            onChange={(event) => setKind(event.target.value as TestKind)}
          >
            {TEST_KINDS.map((value) => (
              <option key={value} value={value}>
                {measurementKindLabels.of(value)}
              </option>
            ))}
          </Select>
        </Field>

        {isDepthJump ? (
          <div className="mt-4">
            <Field
              label={`Drop height (${unit})`}
              hint="Required. Calibration fits jump height against box height and takes the vertex, so an attempt without a height cannot join the curve."
              error={error("boxHeight")}
            >
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="1"
                value={boxHeight}
                onChange={(event) => setBoxHeight(event.target.value)}
                className="tnum"
              />
            </Field>
          </div>
        ) : null}
      </Card>

      <Card>
        <h2 className="text-sm font-semibold text-ink">Attempts</h2>
        <p className="mt-1 text-xs text-ink-faint">
          Every attempt, not just the best one. The spread within a sitting is the
          measurement noise floor, and the smallest change the chart is allowed to
          call real is derived from it.
        </p>
        <p className="mt-1 text-xs text-ink-muted">{attemptHint(kind)}</p>

        <div className="mt-4 space-y-2">
          {attempts.map((value, index) => (
            <div key={index} className="flex items-start gap-2">
              <span className="tnum mt-3 w-4 text-right text-xs text-ink-faint">
                {index + 1}
              </span>
              <div className="flex-1">
                <Input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  value={value}
                  onChange={(event) => setAttempt(index, event.target.value)}
                  placeholder={unit}
                  aria-label={`Attempt ${index + 1} (${unit})`}
                  className="tnum"
                />
                {error(`attempts.${index}`) ? (
                  <span className="mt-1.5 block text-xs text-bad" role="alert">
                    {error(`attempts.${index}`)}
                  </span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() =>
                  setAttempts((current) =>
                    current.filter((_, i) => i !== index),
                  )
                }
                disabled={attempts.length === 1}
                aria-label={`Remove attempt ${index + 1}`}
                className="flex size-11 shrink-0 items-center justify-center rounded-field border border-line-strong text-ink-faint transition hover:border-ink-faint hover:text-ink-muted disabled:opacity-30"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M6 12h12" />
                </svg>
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setAttempts((current) => [...current, ""])}
          >
            Add attempt
          </Button>
          {entered.length ? (
            <span className="tnum text-xs text-ink-faint">
              best {round1(Math.max(...entered))} {unit} · mean{" "}
              {round1(entered.reduce((sum, v) => sum + v, 0) / entered.length)}{" "}
              {unit}
            </span>
          ) : null}
        </div>
      </Card>

      <Card>
        <Field
          label="Notes"
          hint="Surface, shoes, time of day, anything that would explain an outlier later."
        >
          <Textarea
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </Card>

      <SubmitBar pending={pending} label="Log test" result={result} />
    </form>
  );
}
