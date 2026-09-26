"use client";

import { useState, useTransition, type ComponentProps } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Input } from "@/components/ui";
import { foodUnitLabels } from "@/lib/labels";
import { correctEntry, deleteFoodEntry, repeatEntry } from "@/lib/nutrition/actions";
import type { Macros } from "@/lib/nutrition/macros";
import type { NutritionResult } from "@/lib/nutrition/requests";
import type { FoodUnit } from "@/lib/taxonomy";

/**
 * The controls on a logged line.
 *
 * Two grains, because there are two ways a log is wrong. A portion belongs to the
 * entry and is corrected on it; the macros belong to the cached food and correcting
 * them rewrites it for every future logging, which is the cache earning its keep and
 * is why the form says so out loud.
 *
 * Every control is 44px tall even though it reads as small text, since the target is
 * a thumb on a phone. The label is what is small, not the button.
 */

function useNutritionAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(call: () => Promise<NutritionResult>, onOk?: () => void) {
    setError(null);
    start(async () => {
      const result = await call();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onOk?.();
      router.refresh();
    });
  }

  return { pending, error, run };
}

function MicroButton({
  tone = "muted",
  className = "",
  ...props
}: ComponentProps<"button"> & { tone?: "muted" | "danger" }) {
  const styles =
    tone === "danger"
      ? "text-bad hover:bg-bad/10"
      : "text-ink-faint hover:text-ink";
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-11 shrink-0 items-center rounded-field px-2 text-xs font-medium transition disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

/** `g`, `slice`, `scoop` - and `item`, whose label is a sign rather than a word. */
function unitWord(unit: FoodUnit) {
  return unit === "item" ? "item" : foodUnitLabels.of(unit);
}

export function EntryActions({
  entryId,
  quantity,
  unit,
  perUnit,
}: {
  entryId: number;
  quantity: number;
  unit: FoodUnit;
  perUnit: Macros;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run } = useNutritionAction();

  return (
    <div>
      {/*
        Pulled tight against the row above and below: the buttons carry their 44px
        hit area as padding, so without this every line would be 44px taller than
        the text it holds.
      */}
      <div className="-mt-1 -mb-2 flex flex-wrap items-center justify-end gap-x-1">
        <MicroButton onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Cancel" : "Correct"}
        </MicroButton>
        <MicroButton
          tone="danger"
          disabled={pending}
          onClick={() => run(() => deleteFoodEntry({ id: entryId, scope: "item" }))}
        >
          Remove
        </MicroButton>
      </div>

      {open ? (
        <CorrectForm
          entryId={entryId}
          quantity={quantity}
          unit={unit}
          perUnit={perUnit}
          onDone={() => setOpen(false)}
        />
      ) : null}

      {error ? (
        <p role="alert" className="mt-1 text-right text-xs text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CorrectForm({
  entryId,
  quantity,
  unit,
  perUnit,
  onDone,
}: {
  entryId: number;
  quantity: number;
  unit: FoodUnit;
  perUnit: Macros;
  onDone: () => void;
}) {
  const word = unitWord(unit);
  const { pending, error, run } = useNutritionAction();
  const [portion, setPortion] = useState(String(quantity));
  const [kcal, setKcal] = useState(String(perUnit.kcal));
  const [protein, setProtein] = useState(String(perUnit.proteinG));
  const [carbs, setCarbs] = useState(String(perUnit.carbsG));
  const [fat, setFat] = useState(String(perUnit.fatG));
  const [fiber, setFiber] = useState(perUnit.fiberG === null ? "" : String(perUnit.fiberG));

  function submit() {
    run(
      () =>
        correctEntry({
          entryId,
          quantity: Number(portion),
          perUnit: {
            kcal: Number(kcal),
            proteinG: Number(protein),
            carbsG: Number(carbs),
            fatG: Number(fat),
            fiberG: fiber.trim() === "" ? null : Number(fiber),
          },
        }),
      onDone,
    );
  }

  return (
    <div className="mt-3 border-t border-line pt-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Field label={`Portion (${word})`}>
          <Input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={portion}
            onChange={(event) => setPortion(event.target.value)}
          />
        </Field>
        <Field label={`kcal per ${word}`}>
          <Input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={kcal}
            onChange={(event) => setKcal(event.target.value)}
          />
        </Field>
        <Field label={`Protein g per ${word}`}>
          <Input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={protein}
            onChange={(event) => setProtein(event.target.value)}
          />
        </Field>
        <Field label={`Carbs g per ${word}`}>
          <Input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={carbs}
            onChange={(event) => setCarbs(event.target.value)}
          />
        </Field>
        <Field label={`Fat g per ${word}`}>
          <Input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={fat}
            onChange={(event) => setFat(event.target.value)}
          />
        </Field>
        <Field label={`Fibre g per ${word}`}>
          <Input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            placeholder="Unknown"
            value={fiber}
            onChange={(event) => setFiber(event.target.value)}
          />
        </Field>
      </div>

      <p className="mt-3 text-xs text-ink-faint">
        The macros belong to the cached food, so correcting them here fixes every
        future logging of it too, and no later estimate overwrites yours.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="button" onClick={submit} disabled={pending}>
          {pending ? "Saving…" : "Save correction"}
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * What can be done to a whole sentence: log it again, or take all of it back.
 *
 * `Repeat` is the phrase cache made into a button. It re-runs the same sentence
 * through the same resolution rather than copying rows, so what it proves is exactly
 * what the cache promises: identical macros, and nothing spent.
 */
export function SentenceActions({
  entryId,
  itemCount,
}: {
  entryId: number;
  itemCount: number;
}) {
  const { pending, error, run } = useNutritionAction();

  return (
    <div className="flex shrink-0 flex-col items-end">
      <div className="-my-2 flex items-center gap-x-1">
        <MicroButton
          disabled={pending}
          onClick={() => run(() => repeatEntry({ id: entryId }))}
          title="Log this sentence again, on today"
        >
          {pending ? "Repeating…" : "Repeat"}
        </MicroButton>
        {itemCount > 1 ? (
          <MicroButton
            tone="danger"
            disabled={pending}
            onClick={() => run(() => deleteFoodEntry({ id: entryId, scope: "sentence" }))}
          >
            Remove all {itemCount}
          </MicroButton>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
