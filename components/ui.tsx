import Link from "next/link";
import { Fragment, type ComponentProps, type ReactNode } from "react";

/**
 * The shared visual primitives. Deliberately small and unabstracted: this is a
 * single-user app, and a design system with variants for cases that never occur
 * costs more to read than the duplication it removes.
 *
 * The one rule everything here follows is the 44px minimum interactive height,
 * rising to 56px for anything touched mid-set. Cold hands on a phone propped
 * against a rack are the design target.
 *
 * The other is `line-strong` rather than `line` on anything you operate. A field
 * whose border is a hairline is a field you cannot find without tapping around
 * for it, which is what WCAG 1.4.11's 3:1 on non-text boundaries is about.
 * Panels are the opposite case: they separate on fill, not outline, so the
 * controls inside them are the only things on a screen that carry a border.
 */

const FIELD =
  "w-full rounded-field border border-line-strong bg-surface-sunken px-3 text-ink " +
  "transition-[border-color,box-shadow] duration-150 " +
  "placeholder:text-ink-faint focus:border-accent focus:shadow-[0_0_0_3px_color-mix(in_oklch,var(--color-accent)_18%,transparent)] focus:outline-none " +
  "disabled:opacity-50";

/**
 * A panel: a flat fill a step up from the page, with a one-pixel top highlight
 * so it reads as a surface rather than as a box drawn around something.
 */
export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-box bg-surface p-4 shadow-[inset_0_1px_0_oklch(100%_0_0/0.045)] sm:p-5 ${className}`}
    >
      {children}
    </div>
  );
}

/** The small bib-style label above a group. See `.eyebrow` in `globals.css`. */
export function Eyebrow({
  children,
  as: Tag = "p",
  className = "",
}: {
  children: ReactNode;
  as?: "p" | "h2" | "h3" | "span";
  className?: string;
}) {
  return <Tag className={`eyebrow ${className}`}>{children}</Tag>;
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-muted">
        {label}
      </span>
      {children}
      {hint && !error ? (
        <span className="mt-1.5 block text-xs text-ink-faint">{hint}</span>
      ) : null}
      {error ? (
        <span className="mt-1.5 block text-xs text-bad" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input {...props} className={`${FIELD} h-11 ${className}`} />;
}

export function Textarea({ className = "", ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={`${FIELD} py-2.5 ${className}`} />;
}

export function Select({ className = "", ...props }: ComponentProps<"select">) {
  return (
    <select
      {...props}
      // `appearance-none` plus an explicit chevron: the native control renders a
      // light-mode arrow on some platforms even under `color-scheme: dark`.
      className={`${FIELD} h-11 appearance-none bg-[length:1.1rem] bg-[right_0.6rem_center] bg-no-repeat pr-9 ${className}`}
      style={{
        // `%23928f8a` is `--color-ink-faint` in sRGB. A data URI cannot read a
        // custom property and a mask would fight the field's own background, so
        // this one literal has to be changed with the token.
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23928f8a' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
    />
  );
}

type ButtonVariant = "primary" | "secondary" | "danger";
/** `lg` is for the one action a screen exists for, and anything hit mid-set. */
type ButtonSize = "md" | "lg";

/**
 * The button look, for the places a link has to wear it. A `<button>` inside an
 * `<a>` is two interactive elements in one, which a screen reader announces
 * twice and a keyboard stops on twice, so a link styled as a button is a link.
 */
export function buttonClass(
  variant: ButtonVariant = "primary",
  className = "",
  size: ButtonSize = "md",
) {
  const styles = {
    primary: "bg-accent text-accent-ink hover:brightness-[1.06]",
    secondary:
      "border border-line-strong bg-surface-raised text-ink hover:border-ink-faint",
    danger: "border border-bad/45 bg-transparent text-bad hover:bg-bad/10",
  }[variant];
  const height = size === "lg" ? "h-14 px-5 text-base" : "h-11 px-4 text-sm";
  return `press inline-flex select-none items-center justify-center gap-2 rounded-field font-semibold disabled:opacity-50 ${height} ${styles} ${className}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button {...props} className={buttonClass(variant, className, size)} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link {...props} className={buttonClass(variant, className, size)} />;
}

/**
 * An inline text link with an arrow, for "go and do this over there". The arrow
 * nudges on hover, which is the only affordance it needs.
 */
export function TextLink({
  children,
  className = "",
  ...props
}: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className={`group/link -my-2 inline-flex min-h-11 items-center text-sm font-medium text-accent underline-offset-4 hover:underline ${className}`}
    >
      {children}
      <span
        aria-hidden
        className="ml-1 transition-transform duration-150 group-hover/link:translate-x-0.5"
      >
        →
      </span>
    </Link>
  );
}

/**
 * A secondary link in a page header or beside a heading: quiet, because the
 * screen's own primary action is the thing that should be loud.
 */
export const QUIET_LINK =
  "press -my-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-ink-muted underline-offset-4 hover:text-ink hover:underline";

export type Tone = "neutral" | "accent" | "good" | "warn" | "bad" | "cool";

/**
 * Something the owner should know before acting, as a ruled aside rather than a
 * tinted box: the rule's colour says what kind of note it is and the prose
 * stays at reading contrast.
 */
export function Notice({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  const rule = {
    neutral: "border-line-strong",
    accent: "border-accent",
    good: "border-good",
    cool: "border-cool",
    warn: "border-warn",
    bad: "border-bad",
  }[tone];
  return (
    <div className={`border-l-2 py-0.5 pl-4 text-sm text-ink-muted ${rule} ${className}`}>
      {children}
    </div>
  );
}

/**
 * A short state label. Squared off and set in the display face, like the
 * printing on a bib, rather than the outlined pill every component kit ships:
 * a pill reads as a button, and nothing here is one.
 */
export function Tag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  const styles = {
    neutral: "bg-ink/[0.07] text-ink-muted",
    accent: "bg-accent/[0.13] text-accent",
    good: "bg-good/[0.12] text-good",
    cool: "bg-cool/[0.12] text-cool",
    warn: "bg-warn/[0.13] text-warn",
    bad: "bg-bad/[0.13] text-bad",
  }[tone];

  return (
    <span
      className={`inline-flex h-5.5 items-center rounded-[0.3125rem] px-1.5 font-display text-[0.8125rem] leading-none font-semibold tracking-[0.04em] whitespace-nowrap uppercase ${styles}`}
    >
      {children}
    </span>
  );
}

/**
 * A 1-to-5 rating as filled pips. Faster to compare down a list than a digit is,
 * and it reads as a scale rather than as a measurement.
 */
export function Pips({
  value,
  max = 5,
  tone = "neutral",
  label,
}: {
  value: number;
  max?: number;
  tone?: "neutral" | "warn";
  label: string;
}) {
  const on = tone === "warn" ? "bg-warn" : "bg-ink-muted";
  return (
    <span className="inline-flex items-center gap-1" title={`${label}: ${value}/${max}`}>
      <span className="sr-only">{`${label} ${value} of ${max}`}</span>
      {Array.from({ length: max }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full ${i < value ? on : "bg-line"}`}
        />
      ))}
    </span>
  );
}

/**
 * Nothing here yet, and what to do about it. Left-aligned and unboxed: a dashed
 * frame around centred grey text is the most recognisable placeholder on the
 * web, and it makes an ordinary rest day look like a broken page.
 */
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  /** The one thing to do about it, under the explanation. */
  action?: ReactNode;
}) {
  return (
    <div className="border-l-2 border-line-strong py-1 pl-4">
      <p className="font-display text-lg leading-tight font-semibold text-ink">
        {title}
      </p>
      {children ? (
        <p className="mt-1 max-w-prose text-sm text-ink-muted">{children}</p>
      ) : null}
      {action ? <div className="mt-2 flex">{action}</div> : null}
    </div>
  );
}

/**
 * A short run of facts, `A · B · C`, that wraps only between facts.
 *
 * Each separator travels with the fact after it, so a wrapped line starts with
 * one instead of the line above ending on one: a separator left hanging at the
 * edge of a card reads as a missing value. The breakable space is the one before
 * the separator; the nowrap span keeps the separator with its fact.
 */
export function DetailLine({ parts }: { parts: readonly ReactNode[] }) {
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? " " : null}
          <span className="whitespace-nowrap">
            {index > 0 ? <span aria-hidden="true">{"· "}</span> : null}
            {part}
          </span>
        </Fragment>
      ))}
    </>
  );
}
