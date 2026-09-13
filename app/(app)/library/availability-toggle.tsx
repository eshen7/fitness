"use client";

import { useTransition } from "react";
import { setExerciseAvailability } from "@/lib/exercises/actions";

/**
 * Availability triage, one tap. This is the flag the pre-filter reads, so turning
 * something off here is what stops the generator ever proposing it, rather than
 * proposing it and getting rejected.
 */
export function AvailabilityToggle({
  slug,
  name,
  available,
  size = "sm",
}: {
  slug: string;
  name: string;
  available: boolean;
  size?: "sm" | "md";
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={available}
      aria-label={`${name} available`}
      disabled={pending}
      onClick={() =>
        startTransition(() => setExerciseAvailability(slug, !available))
      }
      title={available ? "Available. Tap to disable." : "Unavailable. Tap to enable."}
      className={`relative shrink-0 rounded-full border transition disabled:opacity-50 ${
        size === "md" ? "h-7 w-12" : "h-6 w-10"
      } ${available ? "border-accent/50 bg-accent/25" : "border-line bg-surface-sunken"}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-1/2 -translate-y-1/2 rounded-full transition-all ${
          size === "md" ? "h-5 w-5" : "h-4 w-4"
        } ${
          available
            ? "bg-accent " + (size === "md" ? "left-6" : "left-5")
            : "bg-ink-faint left-1"
        }`}
      />
    </button>
  );
}
