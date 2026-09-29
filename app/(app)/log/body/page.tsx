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
      <PageHeader
        back={{ href: "/log", label: "Log" }}
        title="Body"
        subtitle="Weigh in the same way each morning. The trend is what the targets read, not any one day."
      />

      <BodyForm unitSystem={unitSystem} />

      <h2 className="eyebrow mt-9 mb-2">Recent bodyweight</h2>
      {weights.length === 0 ? (
        <EmptyState title="No bodyweight logged yet">
          Relative strength, meaning a lift over the trend bodyweight, is what
          the ebook ties jumping to, so this series is an input to most of the
          strength insights rather than a vanity number.
        </EmptyState>
      ) : (
        <Card className="py-1 sm:py-1">
          <ul>
            {weights.map((row) => (
              <li
                key={row.id}
                className="flex min-h-14 items-center justify-between gap-4 border-t border-line py-2.5 first:border-t-0"
              >
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
                  <span className="numeral text-xl text-ink">
                    {formatMeasurement(row.value, "bodyweight", unitSystem)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
