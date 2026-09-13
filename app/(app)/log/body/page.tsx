import { PageHeader } from "@/components/page-header";
import { Card, EmptyState, Tag } from "@/components/ui";
import { getUnitSystem, recentBodyValues } from "@/lib/log/queries";
import { dayOf, formatDay, formatTime } from "@/lib/time";
import { formatMeasurement } from "@/lib/units";
import { BodyForm } from "./body-form";

export const metadata = { title: "Log bodyweight" };

export default async function LogBodyPage() {
  const [unitSystem, weights] = await Promise.all([
    getUnitSystem(),
    recentBodyValues("bodyweight", 10),
  ]);

  return (
    <>
      <PageHeader title="Body" subtitle="Bodyweight and composition." />

      <BodyForm unitSystem={unitSystem} />

      <h2 className="mt-8 mb-3 text-sm font-semibold text-ink">
        Recent bodyweight
      </h2>
      {weights.length === 0 ? (
        <EmptyState title="No bodyweight logged yet.">
          Relative strength, meaning a lift over the trend bodyweight, is what the
          ebook ties jumping to, so this series is an input to most of the strength
          insights rather than a vanity number.
        </EmptyState>
      ) : (
        <ul className="space-y-2">
          {weights.map((row) => (
            <li key={row.id}>
              <Card className="flex items-baseline justify-between gap-4">
                <div>
                  <p className="text-sm text-ink-muted">
                    {formatDay(dayOf(row.measuredAt))}
                    <span className="tnum ml-2 text-xs text-ink-faint">
                      {formatTime(row.measuredAt)}
                    </span>
                  </p>
                  {row.notes ? (
                    <p className="mt-1 text-xs text-ink-faint">{row.notes}</p>
                  ) : null}
                </div>
                <div className="flex items-baseline gap-2">
                  {row.source !== "manual" ? (
                    <Tag tone="cool">{row.source}</Tag>
                  ) : null}
                  <span className="tnum font-display text-lg font-semibold text-ink">
                    {formatMeasurement(row.value, "bodyweight", unitSystem)}
                  </span>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
