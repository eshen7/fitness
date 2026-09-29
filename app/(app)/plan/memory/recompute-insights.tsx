"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * Runs the insight suite now rather than waiting for tonight.
 *
 * The recompute is nightly because the false-discovery correction is over the whole
 * suite and has to be done whole, not because it is expensive: there is no model call
 * anywhere in `lib/analytics/`, so this costs database time and nothing else. Without a
 * button, a test day logged this morning shows up in nothing until tomorrow, which
 * reads as the insight list being broken rather than as it being on a schedule.
 *
 * Posts to `/api/insights` rather than calling a server action, so the scheduler and
 * the owner run the same code path and only one of them can be wrong.
 *
 * It says what the run found. Early on the suite computes nothing, and a list that
 * looks the same before and after the press reads as a button that does nothing.
 * The heading row is rendered here so that line can sit under it at full width.
 */
export function RecomputeInsights({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  function recompute() {
    setError(null);
    setOutcome(null);
    start(async () => {
      try {
        const response = await fetch("/api/insights", { method: "POST" });
        if (!response.ok) {
          setError(
            response.status === 401
              ? "Locked out. Unlock and try again."
              : `Recompute failed (${response.status}).`,
          );
          return;
        }
        const body = (await response.json()) as { computed: number; assertable: number };
        setOutcome(
          body.computed === 0
            ? "Recomputed just now. Nothing has enough data yet."
            : `Recomputed just now. ${body.assertable} of ${body.computed} statements clear the gate.`,
        );
        router.refresh();
      } catch {
        setError("Offline, so the suite could not be recomputed.");
      }
    });
  }

  return (
    <div>
      {/*
        Negative bottom margin on the row, not the button: the button's 44px hit
        area is padding, so a heading row sized by it would sit a thumb's width
        above the list it labels.
      */}
      <div className="-mb-1 flex items-center justify-between gap-3">
        {children}
        <button
          type="button"
          onClick={recompute}
          disabled={pending}
          className="-mr-3 inline-flex h-11 min-w-11 shrink-0 items-center justify-center press rounded-field px-3 text-xs font-medium text-ink-faint hover:text-ink disabled:opacity-50"
        >
          {pending ? "Recomputing" : "Recompute"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-1 mb-2 text-xs text-bad">
          {error}
        </p>
      ) : null}
      <p role="status" className="mt-1 mb-2 text-xs text-ink-muted empty:hidden">
        {outcome}
      </p>
    </div>
  );
}
