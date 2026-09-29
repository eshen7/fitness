"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ButtonLink, Card } from "@/components/ui";
import { dismissGuide } from "@/lib/guide/actions";
import { STEP_COPY, type SetupProgress } from "@/lib/guide/steps";

/**
 * The getting-started prompt, for an owner who has not finished setting up.
 *
 * It names the next step as a link rather than just pointing at the guide,
 * because on a fresh install the next step is the whole answer. Hiding it is
 * one tap and permanent; the guide itself stays under Guide in Today's header.
 */
export function GuidePrompt({ progress }: { progress: SetupProgress }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const next = progress.next ? STEP_COPY[progress.next] : null;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow text-accent">
            Setup{" "}
            <span className="tnum">
              {progress.done} of {progress.total}
            </span>
          </p>
          <h2 className="mt-1 font-display text-xl font-bold text-ink">Getting started</h2>
        </div>
        <button
          type="button"
          aria-label="Hide getting started"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await dismissGuide();
              if (!result.ok) {
                setMessage(result.message);
                return;
              }
              router.refresh();
            })
          }
          className="press -my-2 -mr-2 inline-flex min-h-11 shrink-0 items-center px-2 text-sm font-medium text-ink-faint hover:text-ink-muted disabled:opacity-50"
        >
          {pending ? "Hiding…" : "Hide"}
        </button>
      </div>

      {/* One segment per step, filled as the database answers each. */}
      <div aria-hidden="true" className="mt-3 flex gap-1">
        {Array.from({ length: progress.total }, (_, i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full ${i < progress.done ? "bg-accent" : "bg-surface-raised"}`}
          />
        ))}
      </div>

      {next ? (
        <p className="mt-4 text-sm text-ink-muted">
          Next:{" "}
          <Link
            href={next.href}
            className="font-medium text-ink underline decoration-ink-faint underline-offset-3 hover:decoration-ink"
          >
            {next.title}
          </Link>
        </p>
      ) : null}

      <ButtonLink href="/guide" variant="secondary" className="mt-4">
        Open the guide
      </ButtonLink>

      {message ? (
        <p role="status" className="mt-2 text-sm text-bad">
          {message}
        </p>
      ) : null}
    </Card>
  );
}
