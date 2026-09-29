import Link from "next/link";
import { QUIET_LINK } from "./ui";

/**
 * The top of every screen: an optional context line - usually the day - set as
 * a bib label above a condensed title, then at most one line of plain prose.
 * The date goes above rather than into a subtitle so the title stays the first
 * thing read and the subtitle is left for something worth saying.
 *
 * A screen reached from another one, rather than from the tab bar, names its way
 * back above everything else. Not among `children`, which sit beside the title
 * and wrap under the subtitle at phone widths, where a back link left-aligned
 * under a paragraph reads as one more line of prose.
 */
export function PageHeader({
  title,
  eyebrow,
  subtitle,
  back,
  children,
}: {
  title: string;
  eyebrow?: React.ReactNode;
  subtitle?: React.ReactNode;
  back?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-7 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      {back ? (
        <Link href={back.href} className={`${QUIET_LINK} w-full`}>
          <span aria-hidden="true">←</span> {back.label}
        </Link>
      ) : null}
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
        <h1 className="text-[2.25rem] leading-[0.95] font-bold text-ink uppercase sm:text-3xl sm:leading-[0.95]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-2 max-w-prose text-sm text-ink-muted">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </header>
  );
}

/**
 * Marks a route that exists so the shell is navigable but whose contents belong
 * to a later build phase. Explicit about which phase, so it is obvious this is a
 * placeholder rather than a broken page.
 */
export function Placeholder({
  phase,
  children,
}: {
  phase: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-l-2 border-accent py-1 pl-4">
      <p className="eyebrow text-accent">{phase}</p>
      <p className="mt-1.5 max-w-prose text-sm text-ink-muted">{children}</p>
    </div>
  );
}
