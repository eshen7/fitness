"use client";

import { useActionState } from "react";
import { unlock, type UnlockState } from "./actions";

export function UnlockForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<UnlockState, FormData>(unlock, {});

  return (
    <form action={action} className="mt-8 flex flex-col gap-3">
      {next ? <input type="hidden" name="next" value={next} /> : null}
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
        className="h-14 rounded-field border border-line bg-surface px-4 text-lg tracking-widest text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
        placeholder="Passcode"
      />
      <button
        type="submit"
        disabled={pending}
        className="h-14 rounded-field bg-accent text-base font-semibold text-accent-ink transition-opacity disabled:opacity-50"
      >
        {pending ? "Checking" : "Unlock"}
      </button>
      {state.error ? (
        <p id="passcode-error" role="alert" className="text-sm text-bad">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
