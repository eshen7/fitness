"use client";

import { createContext, useContext, useState } from "react";

/**
 * The result of a verdict, held above the proposal it was about.
 *
 * A successful accept or reject refreshes the page, the proposal is no longer
 * pending, and the review that asked unmounts with it. Its own state would take
 * the answer along - including "the gate still objects" on a week written as
 * edited - so the answer lives here, at a position the refresh leaves standing.
 */

type Outcome = { announce: (message: string | null) => void; message: string | null };

const OutcomeContext = createContext<Outcome>({ announce: () => {}, message: null });

export function VerdictOutcomeProvider({ children }: { children: React.ReactNode }) {
  const [message, announce] = useState<string | null>(null);
  return (
    <OutcomeContext.Provider value={{ announce, message }}>{children}</OutcomeContext.Provider>
  );
}

export function useVerdictOutcome() {
  return useContext(OutcomeContext).announce;
}

export function VerdictOutcome() {
  const { message } = useContext(OutcomeContext);
  if (!message) return null;
  return (
    <p
      role="status"
      className="border-l-2 border-line-strong py-0.5 pl-4 text-sm text-ink-muted"
    >
      {message}
    </p>
  );
}
