"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Select, Textarea } from "@/components/ui";
import { mealSlotLabels } from "@/lib/labels";
import { logMeal } from "@/lib/nutrition/actions";
import type { NutritionResult } from "@/lib/nutrition/requests";
import { MEAL_SLOTS, type MealSlot } from "@/lib/taxonomy";

/**
 * A meal, typed as a sentence.
 *
 * Never disabled for a missing API key, unlike the generation forms. A sentence
 * logged before is replayed from the phrase cache with no model call at all, so
 * refusing to submit without a key would block exactly the logging that costs
 * nothing; the action refuses, and says why, only when it actually needs the model.
 *
 * The text survives a failure and is cleared on success, because a sentence that did
 * not parse is a sentence about to be re-worded rather than retyped.
 */
export function MealForm({ defaultMeal }: { defaultMeal: MealSlot }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [meal, setMeal] = useState<MealSlot>(defaultMeal);
  const [result, setResult] = useState<NutritionResult | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    setResult(null);
    start(async () => {
      const outcome = await logMeal({ text, meal });
      setResult(outcome);
      if (outcome.ok) {
        setText("");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4">
      <Field
        label="What did you eat?"
        hint="Plain language, one meal at a time: “200 g greek yoghurt, a banana and a scoop of whey”."
        error={result?.errors?.text}
      >
        <Textarea
          rows={3}
          value={text}
          placeholder="Two eggs on toast and a coffee"
          onChange={(event) => setText(event.target.value)}
        />
      </Field>

      {/*
        The field is sized by its wrapper rather than by a `w-*` on `Select`, which
        already carries `w-full`, and the button is `shrink-0` beside it.
      */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40 flex-1">
          <Field label="Meal" error={result?.errors?.meal}>
            <Select
              value={meal}
              onChange={(event) => setMeal(event.target.value as MealSlot)}
            >
              {MEAL_SLOTS.map((slot) => (
                <option key={slot} value={slot}>
                  {mealSlotLabels.of(slot)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button
          type="button"
          onClick={submit}
          disabled={pending || text.trim().length < 2}
          className="shrink-0"
        >
          {pending ? "Resolving…" : "Log it"}
        </Button>
      </div>

      {/*
        Three tones rather than two. A sentence that logged two of its three foods
        succeeded and failed at once, and painting the whole line green reports the
        half the owner does not need to act on.
      */}
      {result ? (
        <p role="status" className={`text-sm ${toneFor(result)}`}>
          {result.message}
        </p>
      ) : null}
    </div>
  );
}

function toneFor(result: NutritionResult) {
  if (!result.ok) return "text-bad";
  return result.unresolved?.length ? "text-warn" : "text-good";
}
