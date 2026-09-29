"use client";

import type { ActionResult } from "@/lib/log/schemas";
import { Button } from "./ui";

/**
 * Submit control and result line for the log forms.
 *
 * Sticky above the 56px tab bar on mobile, where a check-in is long enough that
 * the button would otherwise be a scroll away. From `md` up the content is a
 * capped measure inside a much wider main, so a floating band would end mid-screen
 * with the form visible past its edge: it becomes an ordinary footer instead.
 */
export function SubmitBar({
  pending,
  label,
  result,
}: {
  pending: boolean;
  label: string;
  result: ActionResult | null;
}) {
  return (
    <div
      // A fade above the band rather than a rule: a rule drawn across the screen
      // is right while the band floats over the form and wrong on a short form
      // where it sits in the flow, and a fade into the page colour is invisible
      // in the second case.
      className="sticky z-10 -mx-4 bg-surface-sunken/92 px-4 py-3 backdrop-blur-md before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-t before:from-surface-sunken/92 before:to-transparent md:static md:mx-0 md:bg-transparent md:px-0 md:backdrop-blur-none md:before:hidden"
      // The tab bar grows by the home-indicator inset in an installed PWA, so the
      // band has to sit on top of that too or the bar covers its lower edge.
      style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom))" }}
    >
      {result ? (
        <p
          role="status"
          className={`mb-2.5 text-sm ${result.ok ? "text-good" : "text-bad"}`}
        >
          {result.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full sm:w-auto sm:min-w-40">
        {pending ? "Saving…" : label}
      </Button>
    </div>
  );
}
