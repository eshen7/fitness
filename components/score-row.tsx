"use client";

/**
 * A 0 to 10 self-report, as a grid of buttons.
 *
 * Twelve targets in two rows of six, which at 390px leaves each one comfortably
 * over the 44px minimum. A slider would be smaller to hit and would make the
 * unanswered state impossible to express, and that state matters: the pre-filter
 * treats "no pain today" and "did not check today" differently, so `null` has to
 * be reachable and visibly distinct from 0.
 */
export function ScoreRow({
  label,
  hint,
  value,
  onChange,
  tone = "neutral",
  labelHidden = false,
}: {
  label: string;
  hint?: string;
  value: number | null;
  onChange: (value: number | null) => void;
  /** `warn` colours a nonzero answer, for the pain fields. */
  tone?: "neutral" | "warn";
  /**
   * Drops the visible label where something else already names the question, such
   * as the row of an accordion. The label still reaches the radiogroup, so the
   * control is never anonymous to a screen reader.
   */
  labelHidden?: boolean;
}) {
  const scores = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  return (
    <div>
      {labelHidden && !hint ? null : (
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          {labelHidden ? (
            <span />
          ) : (
            <span className="text-sm font-medium text-ink-muted">{label}</span>
          )}
          {hint ? <span className="text-xs text-ink-faint">{hint}</span> : null}
        </div>
      )}
      <div
        role="radiogroup"
        aria-label={label}
        className="grid grid-cols-6 gap-1.5"
      >
        {scores.map((score) => {
          const selected = value === score;
          const warn = tone === "warn" && score > 0;
          return (
            <button
              key={score}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(score)}
              className={`tnum h-11 rounded-field border text-sm font-medium transition ${
                selected
                  ? warn
                    ? "border-warn bg-warn/15 text-warn"
                    : "border-accent bg-accent/15 text-accent"
                  : "border-line-strong bg-surface-sunken text-ink-muted hover:border-ink-faint"
              }`}
            >
              {score}
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          onClick={() => onChange(null)}
          title="Not checked"
          className={`h-11 rounded-field border text-xs font-medium transition ${
            value === null
              ? "border-ink-faint bg-surface-raised text-ink-muted"
              : "border-line-strong border-dashed bg-transparent text-ink-faint hover:border-ink-faint"
          }`}
        >
          Skip
        </button>
      </div>
    </div>
  );
}
