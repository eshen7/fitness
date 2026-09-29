"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Select } from "@/components/ui";
import { startAdHocSession } from "@/lib/log/actions";
import { sessionKindLabels } from "@/lib/labels";
import { SESSION_KINDS, type SessionKind } from "@/lib/taxonomy";

/**
 * Opens a session with no generated plan behind it, which is what off-plan
 * training is. Those sets still count toward weekly volume and the contact total,
 * so they need a session to hang from.
 *
 * `rest` is excluded: nothing is logged into a rest day, and offering it here would
 * invite opening one by accident.
 */
const KINDS = SESSION_KINDS.filter((kind) => kind !== "rest");

export function StartSession() {
  const router = useRouter();
  const [kind, setKind] = useState<SessionKind>("strength");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function open() {
    start(async () => {
      const result = await startAdHocSession(kind);
      if (result.ok && result.sessionId) {
        router.push(`/log/session/${result.sessionId}`);
        return;
      }
      setMessage(result.message);
    });
  }

  return (
    <div>
      <div className="flex gap-2">
        <Select
          value={kind}
          onChange={(event) => setKind(event.target.value as SessionKind)}
          aria-label="Session kind"
          className="flex-1"
        >
          {KINDS.map((option) => (
            <option key={option} value={option}>
              {sessionKindLabels.of(option)}
            </option>
          ))}
        </Select>
        <Button type="button" onClick={open} disabled={pending} className="shrink-0">
          {pending ? "Opening…" : "Start"}
        </Button>
      </div>
      {message ? (
        <p role="status" className="mt-2 text-sm text-bad">
          {message}
        </p>
      ) : null}
    </div>
  );
}
