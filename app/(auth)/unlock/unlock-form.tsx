"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui";
import { unlock, type UnlockState } from "./actions";

export function UnlockForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<UnlockState, FormData>(unlock, {});

  return (
    <form action={action} className="mt-8 flex flex-col gap-3">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {/*
        There is one user and no username, but a password manager files a
        credential against one, and without it the browser warns on every visit
        and the saved passcode has no name. A fixed, hidden value costs nothing.
      */}
      <input
        type="text"
        name="username"
        value="owner"
        autoComplete="username"
        readOnly
        hidden
      />
      <label htmlFor="passcode" className="sr-only">
        Passcode
      </label>
      <input
        id="passcode"
        name="passcode"
        type="password"
        inputMode="numeric"
        autoComplete="current-password"
        autoFocus
        aria-invalid={state.error ? true : undefined}
        aria-describedby={state.error ? "passcode-error" : undefined}
        className="h-14 rounded-field border border-line-strong bg-surface-sunken px-4 text-lg tracking-widest text-ink transition-[border-color,box-shadow] duration-150 placeholder:tracking-normal placeholder:text-ink-faint focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-accent)_18%,transparent)] focus:outline-none"
        placeholder="Passcode"
      />
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? "Checking…" : "Unlock"}
      </Button>
      {state.error ? (
        <p id="passcode-error" role="alert" className="text-sm text-bad">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
