import type { ReactNode } from "react";

/**
 * A prescription's volume as a scoreboard figure: `3 × 5`, with the times sign
 * set quieter than the digits so the two numbers are what the eye lands on.
 * The data says `x`, which is what a prompt or an export should carry; the
 * glyph is presentation only.
 */
export function Volume({ value, className = "" }: { value: string; className?: string }) {
  const [sets, rest] = value.split(" x ");
  return (
    <span className={`numeral ${className}`}>
      {rest === undefined ? (
        value
      ) : (
        <>
          {sets}
          <span aria-hidden="true" className="px-[0.12em] font-medium text-ink-faint">
            ×
          </span>
          <span className="sr-only"> by </span>
          {rest}
        </>
      )}
    </span>
  );
}

/**
 * One line of a written session: the exercise and how to load it on the left,
 * the volume large on the right. Divided rather than boxed, so a block of five
 * lifts reads as one list instead of five small cards.
 */
export function PrescriptionRow({
  name,
  volume,
  load,
  detail,
  aside,
}: {
  name: ReactNode;
  volume: string;
  load?: string | null;
  detail?: string | null;
  aside?: ReactNode;
}) {
  return (
    <li className="flex items-start justify-between gap-4 border-t border-line py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="font-medium text-ink">{name}</p>
        {load ? <p className="mt-0.5 text-sm text-ink-muted">{load}</p> : null}
        {detail ? <p className="mt-0.5 text-xs text-ink-faint">{detail}</p> : null}
        {aside}
      </div>
      <Volume value={volume} className="-mt-0.5 shrink-0 text-2xl leading-none text-ink" />
    </li>
  );
}
