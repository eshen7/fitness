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
        className="-my-2 inline-flex min-h-11 items-center text-xs font-semibold text-ink-faint underline-offset-2 hover:text-bad hover:underline"
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
        className="text-xs"
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
        className="inline-flex min-h-11 items-center px-1 text-xs text-ink-faint underline-offset-2 hover:underline"
      >
        Keep it
      </button>
      {message ? <span className="text-xs text-bad">{message}</span> : null}
    </div>
  );
}
