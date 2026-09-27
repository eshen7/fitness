"use client";

import { useState, useTransition } from "react";
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
 */
export function RecomputeInsights() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function recompute() {
    setError(null);
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
        router.refresh();
      } catch {
        setError("Offline, so the suite could not be recomputed.");
      }
    });
  }

  return (
    <div className="flex flex-col items-end">
      <button
        type="button"
        onClick={recompute}
        disabled={pending}
        className="inline-flex h-11 shrink-0 items-center rounded-field px-2 text-xs font-medium text-ink-faint transition hover:text-ink disabled:opacity-50"
      >
        {pending ? "Recomputing" : "Recompute"}
      </button>
      {error ? (
        <p role="alert" className="-mt-1 text-xs text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}
