import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui";
import { readinessForDay } from "@/lib/log/queries";
import type { MuscleGroup } from "@/lib/taxonomy";
import { formatDay, today } from "@/lib/time";
import { ReadinessForm, type ReadinessPrefill } from "./readiness-form";

export const metadata = { title: "Readiness" };

/** A device-filled number, shown read-only next to the form that asks the rest. */
function Stat({
  label,
  value,
  unit,
}: {
  label: string;
  value: number | string | null;
  unit?: string;
}) {
  return (
    <div>
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="tnum mt-0.5 font-display text-lg font-semibold text-ink">
        {value === null ? "-" : value}
        {value !== null && unit ? (
          <span className="ml-1 text-xs font-normal text-ink-faint">{unit}</span>
        ) : null}
      </p>
    </div>
  );
}

export default async function ReadinessPage() {
  const day = today();
  const row = await readinessForDay(day);

  const prefill: ReadinessPrefill = {
    soreness: (row?.sorenessByRegion ?? {}) as Partial<Record<MuscleGroup, number>>,
    motivation: row?.motivation ?? null,
    priorSessionRpe: row?.priorSessionRpe ? String(Number(row.priorSessionRpe)) : "",
    notes: row?.notes ?? "",
  };

  return (
    <>
      <PageHeader
        title="Readiness"
        subtitle={`${formatDay(day)}. One check-in per day, editable.`}
      />

      {row?.whoopFilled ? (
        <Card className="mb-4">
          <h2 className="text-sm font-semibold text-ink">From WHOOP</h2>
          <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Recovery" value={row.recoveryScore} unit="%" />
            <Stat
              label="HRV"
              value={row.hrvMs === null ? null : Number(row.hrvMs).toFixed(0)}
              unit="ms"
            />
            <Stat label="Resting HR" value={row.restingHeartRate} unit="bpm" />
            <Stat
              label="Sleep"
              value={
                row.sleepMinutes === null
                  ? null
                  : `${Math.floor(row.sleepMinutes / 60)}h ${row.sleepMinutes % 60}m`
              }
            />
          </div>
        </Card>
      ) : null}

      <ReadinessForm prefill={prefill} />
    </>
  );
}
