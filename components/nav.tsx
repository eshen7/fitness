"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SVGProps } from "react";

/**
 * Bottom bar on mobile, because that is where a thumb is when the phone is
 * propped against a rack. Sidebar from `md` up.
 *
 * Icon over label rather than label alone: six text-only cells at 390px leave
 * "Progress" filling its entire 65px column, and a glanceable shape reads faster
 * mid-set than a word does.
 */
function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

const ITEMS = [
  {
    href: "/today",
    label: "Today",
    // An approach curve into an upward takeoff.
    icon: (c: string) => (
      <Icon className={c}>
        <path d="M3 20h18" />
        <path d="M5 16.5c3.5 0 6-3 8-9.5" />
        <path d="M9.5 8.5 13 7l1.5 3.5" />
      </Icon>
    ),
  },
  {
    href: "/log",
    label: "Log",
    // A loaded barbell.
    icon: (c: string) => (
      <Icon className={c}>
        <path d="M3 9v6M6 7v10M18 7v10M21 9v6" />
        <path d="M6 12h12" />
      </Icon>
    ),
  },
  {
    href: "/progress",
    label: "Progress",
    // A dip then a rise, which is the whole point of block-aware charting.
    icon: (c: string) => (
      <Icon className={c}>
        <path d="M3 20V4" />
        <path d="M3 20h18" />
        <path d="M6 12c2.5 4 4 4 6 0s3.5-6 6-8" />
      </Icon>
    ),
  },
  {
    href: "/nutrition",
    label: "Food",
    // A plate.
    icon: (c: string) => (
      <Icon className={c}>
        <circle cx="12" cy="12" r="8.5" />
        <circle cx="12" cy="12" r="4" />
      </Icon>
    ),
  },
  {
    href: "/plan",
    label: "Plan",
    // Microcycles stacked into a block.
    icon: (c: string) => (
      <Icon className={c}>
        <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
        <path d="M3.5 9.5h17M9 4.5v15" />
      </Icon>
    ),
  },
  {
    href: "/library",
    label: "Library",
    // Stacked entries.
    icon: (c: string) => (
      <Icon className={c}>
        <path d="M4 6h16M4 12h16M4 18h10" />
      </Icon>
    ),
  },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Sections"
      className="sticky bottom-0 z-20 border-t border-line bg-surface-sunken/92 backdrop-blur-md md:sticky md:top-0 md:h-dvh md:w-56 md:shrink-0 md:border-t-0 md:border-r md:bg-surface-sunken md:backdrop-blur-none"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {/* The wordmark: a lane line and the word, nothing more. */}
      <div className="hidden items-center gap-2.5 px-5 pt-7 pb-6 md:flex">
        <span aria-hidden="true" className="h-4 w-1 -skew-x-12 rounded-[1px] bg-accent" />
        <span className="font-display text-xl leading-none font-bold tracking-[0.06em] text-ink uppercase">
          Training
        </span>
      </div>
      <ul className="flex md:flex-col md:gap-0.5 md:px-3">
        {ITEMS.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                // 56px minimum: gym-usable target with cold or taped hands.
                className={`press relative flex h-14 flex-col items-center justify-center gap-1 rounded-field md:h-11 md:flex-row md:justify-start md:gap-3 md:px-3 ${
                  active
                    ? "text-ink md:bg-surface"
                    : "text-ink-faint hover:text-ink-muted md:hover:bg-surface/60"
                }`}
              >
                {/* Colour alone is a weak active signal on a dark bar, so the
                    current section also carries a volt mark: a top rule on the
                    phone, a left one on the sidebar. */}
                <span
                  aria-hidden="true"
                  className={`absolute top-0 h-0.5 w-8 rounded-full bg-accent transition-opacity duration-150 md:top-1/2 md:left-0 md:h-5 md:w-0.5 md:-translate-y-1/2 ${
                    active ? "opacity-100" : "opacity-0"
                  }`}
                />
                {item.icon(`size-5.5 shrink-0 md:size-5 ${active ? "text-accent" : ""}`)}
                <span className="font-display text-[0.8125rem] leading-none font-semibold tracking-[0.05em] uppercase md:font-sans md:text-sm md:font-medium md:tracking-normal md:normal-case">
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
