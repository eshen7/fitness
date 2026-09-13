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
    <div className="sticky bottom-14 z-10 -mx-4 border-t border-line bg-surface-sunken/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:px-0 md:backdrop-blur-none">
      {result ? (
        <p
          role="status"
          className={`mb-2.5 text-sm ${result.ok ? "text-good" : "text-bad"}`}
        >
          {result.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Saving…" : label}
      </Button>
    </div>
  );
}
