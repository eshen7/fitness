import Link from "next/link";
import { Fragment } from "react";
import { Notice } from "./ui";

/**
 * What a "needs a max" prescription is waiting for, and where to supply it.
 *
 * A percentage of a max nobody has recorded is a prescription that cannot be
 * followed as written, so rather than guess a load the plan says so once, under
 * the lines it applies to, and names the two ways to fix it. No hooks, so the
 * server pages and the client logger share it.
 */
export function NeedsMaxNote({ lifts }: { lifts: { name: string; slug: string }[] }) {
  if (lifts.length === 0) return null;
  return (
    <Notice tone="warn">
      <p>
        No max on record for{" "}
        {lifts.map((lift, index) => (
          <Fragment key={lift.slug}>
            {index === 0 ? null : index === lifts.length - 1 ? " or " : ", "}
            <Link
              href={`/library/${lift.slug}`}
              className="font-medium text-ink underline decoration-ink-faint underline-offset-3 hover:decoration-ink"
            >
              {lift.name}
            </Link>
          </Fragment>
        ))}
        , so {lifts.length === 1 ? "its percentage has" : "their percentages have"} no
        load yet. Log a heavy set, 1 to 10 reps with a load, or enter a tested max
        on the lift&apos;s page.
      </p>
    </Notice>
  );
}
