"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { disconnectWhoop, syncWhoop } from "@/lib/whoop/actions";

/**
 * Sync and disconnect.
 *
 * A client island because both need a pending state and something to say
 * afterwards: a sync that quietly returns nothing is indistinguishable from a
 * sync that never ran, and this is the button pressed when the data looks wrong.
 */
export function WhoopControls() {
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function sync() {
    setMessage(null);
    start(async () => {
      const result = await syncWhoop(14);
      setMessage(
        result.ok
          ? `Pulled ${result.counts.sleeps} nights, ${result.counts.recoveries} recoveries and ${result.counts.cycles} cycles.`
          : result.error,
      );
    });
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={sync} disabled={pending}>
          {pending ? "Syncing..." : "Sync now"}
        </Button>
        {confirming ? (
          <>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => start(() => disconnectWhoop())}
            >
              Confirm disconnect
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            Disconnect
          </Button>
        )}
      </div>
      {confirming ? (
        <p className="mt-2 text-xs text-warn">
          Disconnecting drops the tokens. Records already pulled stay; nothing new
          arrives until WHOOP is authorized again.
        </p>
      ) : null}
      {message ? <p className="mt-2 text-xs text-ink-faint">{message}</p> : null}
    </div>
  );
}
