"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { closeOpenBlock } from "@/lib/ai/actions";

/**
 * Ends a block early. Confirmed in two taps rather than one, because closing a
 * block is what makes the next generation declare a new one, and an accidental
 * close is only visible several screens later.
 */
export function CloseBlock() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="press -my-2 inline-flex min-h-11 items-center text-sm font-medium text-ink-faint underline-offset-4 hover:text-bad hover:underline"
      >
        End block
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="danger"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await closeOpenBlock();
            setMessage(result.ok ? null : result.message);
            setConfirming(false);
            router.refresh();
          })
        }
      >
        {pending ? "Closing…" : "End it"}
      </Button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="press inline-flex min-h-11 items-center px-1 text-sm text-ink-muted underline-offset-4 hover:text-ink hover:underline"
      >
        Keep it
      </button>
      {message ? <span className="text-sm text-bad">{message}</span> : null}
    </div>
  );
}
