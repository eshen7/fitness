import type { ComponentProps, ReactNode } from "react";

/**
 * The shared visual primitives. Deliberately small and unabstracted: this is a
 * single-user app, and a design system with variants for cases that never occur
 * costs more to read than the duplication it removes.
 *
 * The one rule everything here follows is the 44px minimum interactive height,
 * rising to 56px for anything touched mid-set. Cold hands on a phone propped
 * against a rack are the design target.
 */

const FIELD =
  "w-full rounded-field border border-line bg-surface-sunken px-3 text-ink " +
  "placeholder:text-ink-faint focus:border-accent focus:outline-none " +
  "disabled:opacity-50";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-box border border-line bg-surface p-4 sm:p-5 ${className}`}
    >
      {children}
    </div>
  );
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
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a8f94' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
    />
  );
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-accent text-accent-ink hover:brightness-105",
    secondary:
      "border border-line bg-surface-raised text-ink hover:border-ink-faint",
    danger: "border border-bad/40 bg-transparent text-bad hover:bg-bad/10",
  }[variant];

  return (
    <button
      {...props}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-field px-4 text-sm font-semibold transition disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Tag({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "warn" | "bad" | "cool";
}) {
  const styles = {
    neutral: "border-line text-ink-muted",
    accent: "border-accent/40 text-accent",
    cool: "border-cool/40 text-cool",
    warn: "border-warn/40 text-warn",
    bad: "border-bad/40 text-bad",
  }[tone];

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${styles}`}
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

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-box border border-line border-dashed bg-surface/40 px-6 py-10 text-center">
      <p className="text-sm font-medium text-ink-muted">{title}</p>
      {children ? (
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-faint">{children}</p>
      ) : null}
    </div>
  );
}
