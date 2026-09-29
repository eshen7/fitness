import { SERIES } from "@/components/chart";
import { Card, Tag } from "@/components/ui";
import { energySplit, type Macros } from "@/lib/nutrition/macros";
import type { DailyTarget, RemainingTarget } from "@/lib/nutrition/targets";

/**
 * The day against its target.
 *
 * Bars rather than four numbers, because the question being asked is "how much of
 * today is left", and that is a length. A bar past its target does not grow beyond
 * the track: it turns, because the only thing worth knowing at that point is by how
 * much, and the number beside it says that.
 *
 * With no target set the bars are dropped rather than drawn against a guess. A
 * calorie count with nothing to read it against is still worth having, so the totals
 * stay.
 */

const MACRO_COLOR = {
  protein: SERIES[0],
  carbs: SERIES[1],
  fat: SERIES[2],
} as const;

export function DayTotals({
  totals,
  target,
  remaining,
}: {
  totals: Macros;
  target: DailyTarget | null;
  remaining: RemainingTarget | null;
}) {
  const split = energySplit(totals);

  return (
    <Card>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <p className="eyebrow">Eaten today</p>
          <p className="numeral mt-1.5 text-[3.25rem] leading-none text-ink">
            {totals.kcal}
            <span className="ml-1.5 font-sans text-base font-normal text-ink-faint">kcal</span>
          </p>
        </div>
        {target && remaining ? (
          <p className="tnum text-right text-sm text-ink-muted">
            <span
              className={`numeral text-2xl ${remaining.kcal < 0 ? "text-warn" : "text-ink"}`}
            >
              {Math.abs(remaining.kcal)}
            </span>{" "}
            {remaining.kcal < 0 ? "over" : "left"}
            <span className="block text-xs text-ink-faint">
              of {target.kcal} kcal
            </span>
          </p>
        ) : (
          <Tag tone="warn">No target set</Tag>
        )}
      </div>

      <div className="mt-5 space-y-3">
        <Meter
          label="Calories"
          eaten={totals.kcal}
          target={target?.kcal ?? null}
          unit="kcal"
          color="var(--color-accent)"
          decimals={0}
        />
        <Meter
          label="Protein"
          eaten={totals.proteinG}
          target={target?.proteinG ?? null}
          unit="g"
          color={MACRO_COLOR.protein}
        />
        <Meter
          label="Carbs"
          eaten={totals.carbsG}
          target={target?.carbsG ?? null}
          unit="g"
          color={MACRO_COLOR.carbs}
        />
        <Meter
          label="Fat"
          eaten={totals.fatG}
          target={target?.fatG ?? null}
          unit="g"
          color={MACRO_COLOR.fat}
        />
      </div>

      {split ? (
        <div className="mt-5">
          <p className="eyebrow">Where the energy came from</p>
          <div
            className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-surface-sunken"
            role="img"
            aria-label={`Protein ${split.proteinPct.toFixed(0)}%, carbohydrate ${split.carbsPct.toFixed(0)}%, fat ${split.fatPct.toFixed(0)}% of energy`}
          >
            <span
              style={{ width: `${split.proteinPct}%`, backgroundColor: MACRO_COLOR.protein }}
            />
            <span
              style={{ width: `${split.carbsPct}%`, backgroundColor: MACRO_COLOR.carbs }}
            />
            <span
              style={{ width: `${split.fatPct}%`, backgroundColor: MACRO_COLOR.fat }}
            />
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
            {(
              [
                ["Protein", split.proteinPct, MACRO_COLOR.protein],
                ["Carbs", split.carbsPct, MACRO_COLOR.carbs],
                ["Fat", split.fatPct, MACRO_COLOR.fat],
              ] as const
            ).map(([label, pct, color]) => (
              <li
                key={label}
                className="flex items-center gap-1.5 text-xs text-ink-muted"
              >
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: color }}
                />
                {label}
                <span className="tnum font-medium text-ink">{pct.toFixed(0)}%</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-4 text-xs text-ink-faint">
        {totals.fiberG === null
          ? "Fibre was not estimated for anything logged today."
          : `Fibre ${totals.fiberG} g.`}
        {target?.fluidMl ? ` Fluid target ${(target.fluidMl / 1000).toFixed(1)} L.` : ""}
      </p>
    </Card>
  );
}

/**
 * One macro, as a length against its target.
 *
 * The track is the target, so the fill is capped at full and the overshoot is told
 * by colour and by the number rather than by a bar running out of the card.
 */
function Meter({
  label,
  eaten,
  target,
  unit,
  color,
  decimals = 1,
}: {
  label: string;
  eaten: number;
  target: number | null;
  unit: string;
  color: string;
  decimals?: number;
}) {
  const over = target !== null && eaten > target;
  const pct = target === null || target <= 0 ? 0 : Math.min(100, (eaten / target) * 100);
  const shown = decimals === 0 ? Math.round(eaten) : Number(eaten.toFixed(decimals));

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="text-ink-muted">{label}</span>
        <span className="tnum text-ink-faint">
          <span className={over ? "font-medium text-warn" : "font-medium text-ink"}>
            {shown}
          </span>
          {target === null ? ` ${unit}` : ` / ${target} ${unit}`}
        </span>
      </div>
      {target === null ? null : (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-sunken">
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              backgroundColor: over ? "var(--color-warn)" : color,
            }}
          />
        </div>
      )}
    </div>
  );
}
