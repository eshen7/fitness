"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Card } from "@/components/ui";
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
    <Card className="border-accent/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">Getting started</h2>
          <p className="tnum mt-0.5 text-xs text-ink-faint">
            {progress.done} of {progress.total} setup steps done
          </p>
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
          className="-my-2 -mr-2 inline-flex min-h-11 shrink-0 items-center px-2 text-xs font-semibold text-ink-faint underline-offset-2 hover:text-ink-muted hover:underline disabled:opacity-50"
        >
          {pending ? "Hiding…" : "Hide"}
        </button>
      </div>

      {next ? (
        <p className="mt-3 text-sm text-ink-muted">
          Next:{" "}
          <Link
            href={next.href}
            className="font-medium text-accent underline-offset-2 hover:underline"
          >
            {next.title}
            <span aria-hidden> →</span>
          </Link>
        </p>
      ) : null}

      <Link
        href="/guide"
        className="mt-3 inline-flex h-11 items-center justify-center rounded-field border border-line-strong bg-surface-raised px-4 text-sm font-semibold text-ink transition hover:border-ink-faint"
      >
        Open the guide
      </Link>

      {message ? (
        <p role="status" className="mt-2 text-sm text-bad">
          {message}
        </p>
      ) : null}
    </Card>
  );
}
