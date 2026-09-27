"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, Textarea } from "@/components/ui";
import {
  confirmFactAction,
  correctFactAction,
  forgetFactAction,
} from "@/lib/memory/actions";
import type { MemoryResult } from "@/lib/memory/requests";

/**
 * The controls on one remembered fact.
 *
 * The plan's bargain on memory is that inferred facts commit themselves and safety
 * comes from reversibility rather than from asking first. These three buttons are the
 * other half of it, which is why they sit on the fact itself rather than behind a menu:
 * if a wrong fact is two taps from gone, auto-commit is defensible, and if it is five
 * it is not.
 *
 * Correcting opens a textarea rather than submitting immediately, because a correction
 * is a sentence the generator will read cold in six months and the owner is the only
 * one who can write it. Deleting does not, because it asks nothing.
 */

function useFactAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(call: () => Promise<MemoryResult>, onOk?: () => void) {
    setError(null);
    start(async () => {
      const result = await call();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onOk?.();
      router.refresh();
    });
  }

  return { pending, error, run };
}

/** Small enough to read as a caption, still 44px of thumb. */
function MicroButton({
  tone = "muted",
  ...props
}: React.ComponentProps<"button"> & { tone?: "muted" | "accent" | "danger" }) {
  const styles = {
    muted: "text-ink-faint hover:text-ink",
    accent: "text-accent hover:bg-accent/10",
    danger: "text-bad hover:bg-bad/10",
  }[tone];
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex h-11 shrink-0 items-center rounded-field px-2 text-xs font-medium transition disabled:opacity-50 ${styles}`}
    />
  );
}

export function FactActions({
  id,
  body,
  pending: awaitingConfirmation,
}: {
  id: number;
  body: string;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const { pending, error, run } = useFactAction();

  return (
    <div>
      {/*
        Negative margins for the same reason the nutrition row uses them: the 44px hit
        area is padding, so without this every fact would be 44px taller than its text.
      */}
      <div className="-mt-1 -mb-2 flex flex-wrap items-center justify-end gap-x-1">
        {awaitingConfirmation ? (
          <MicroButton
            tone="accent"
            disabled={pending}
            onClick={() => run(() => confirmFactAction({ id }))}
          >
            Approve
          </MicroButton>
        ) : null}
        <MicroButton onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Cancel" : "Correct"}
        </MicroButton>
        <MicroButton
          tone="danger"
          disabled={pending}
          onClick={() => run(() => forgetFactAction({ id }))}
        >
          Delete
        </MicroButton>
      </div>

      {open ? (
        <CorrectForm id={id} body={body} onDone={() => setOpen(false)} />
      ) : null}

      {error ? (
        <p role="alert" className="mt-1 text-right text-xs text-bad">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function CorrectForm({
  id,
  body,
  onDone,
}: {
  id: number;
  body: string;
  onDone: () => void;
}) {
  const [text, setText] = useState(body);
  const { pending, error, run } = useFactAction();

  return (
    <div className="mt-3 border-t border-line pt-3">
      <Field
        label="In your words"
        hint="Saved as something you said, which outranks any later inference and supersedes this one."
        error={error ?? undefined}
      >
        <Textarea
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      <div className="mt-3 flex justify-end">
        <Button
          disabled={pending || text.trim() === body.trim()}
          onClick={() => run(() => correctFactAction({ id, body: text }), onDone)}
        >
          {pending ? "Saving" : "Save correction"}
        </Button>
      </div>
    </div>
  );
}
