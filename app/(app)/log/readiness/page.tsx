import { PageHeader } from "@/components/page-header";
import { Card, Tag } from "@/components/ui";
import { lastReportedSessionRpe, readinessForDay } from "@/lib/log/queries";
import { priorRpePrefill } from "@/lib/log/readiness";
import type { MuscleGroup } from "@/lib/taxonomy";
import { formatDay, today } from "@/lib/time";
import { ReadinessForm, type ReadinessPrefill } from "./readiness-form";
import { WhoopCard } from "./whoop-card";

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

export default async function ReadinessPage({
  searchParams,
}: {
  searchParams: Promise<{ whoop?: string; reason?: string }>;
}) {
  const day = today();
  const [row, lastRpe, { whoop, reason }] = await Promise.all([
    readinessForDay(day),
    lastReportedSessionRpe(),
    searchParams,
  ]);
  const priorRpe = priorRpePrefill(row, lastRpe);

  const prefill: ReadinessPrefill = {
    soreness: (row?.sorenessByRegion ?? {}) as Partial<Record<MuscleGroup, number>>,
    motivation: row?.motivation ?? null,
    priorSessionRpe: priorRpe.value,
    priorSessionRpeFilled: priorRpe.filled,
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
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink">From WHOOP</h2>
            {row.dayStrain === null ? null : (
              <Tag tone="cool">strain {Number(row.dayStrain).toFixed(1)}</Tag>
            )}
          </div>
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
          {/*
            The split matters more than the total for reactive work, and it is the
            input to the slow-wave and REM insight, so it is shown rather than
            being folded into one number.
          */}
          {row.slowWaveMinutes === null && row.remMinutes === null ? null : (
            <p className="mt-3 text-xs text-ink-faint">
              {row.slowWaveMinutes === null
                ? ""
                : `${row.slowWaveMinutes} min slow wave`}
              {row.slowWaveMinutes !== null && row.remMinutes !== null ? " · " : ""}
              {row.remMinutes === null ? "" : `${row.remMinutes} min REM`}
              {row.sleepPerformancePct === null
                ? ""
                : ` · ${row.sleepPerformancePct}% of need`}
            </p>
          )}
        </Card>
      ) : null}

      <WhoopCard status={whoop} reason={reason} />

      <ReadinessForm prefill={prefill} />
    </>
  );
}
