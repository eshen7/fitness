import { PageHeader } from "@/components/page-header";
import { Card, EmptyState } from "@/components/ui";
import { measurementKindLabels } from "@/lib/labels";
import { getUnitSystem, recentTests } from "@/lib/log/queries";
import { dayOf, formatDay, formatTime } from "@/lib/time";
import { displayUnit, round1, toDisplay } from "@/lib/units";
import { TestForm } from "./test-form";

export const metadata = { title: "Log a test" };

export default async function LogTestPage() {
  const [unitSystem, tests] = await Promise.all([
    getUnitSystem(),
    recentTests(6),
  ]);
  const unit = displayUnit("length", unitSystem);
  const show = (cm: number) => round1(toDisplay(cm, "length", unitSystem));

  return (
    <>
      <PageHeader
        back={{ href: "/log", label: "Log" }}
        title="Test"
        subtitle="Same warm-up, same surface, same time of day. A test only compares with one taken the same way."
      />

      <TestForm unitSystem={unitSystem} />

      <h2 className="eyebrow mt-9 mb-2">Recent sittings</h2>
      {tests.length === 0 ? (
        <EmptyState title="No tests logged yet">
          A standing vertical is the reference every other jump number is read
          against, and depth jump calibration starts from it, so it is the one
          worth logging first.
        </EmptyState>
      ) : (
        <Card className="py-1 sm:py-1">
          <ul>
            {tests.map((test) => (
              <li
                key={test.testGroup}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line py-3 first:border-t-0"
              >
                <div>
                  <p className="text-sm font-medium text-ink">
                    {measurementKindLabels.of(test.kind)}
                    {test.boxHeightCm !== null ? (
                      <span className="tnum ml-2 text-xs text-ink-faint">
                        from {show(test.boxHeightCm)} {unit}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {formatDay(dayOf(test.measuredAt))} ·{" "}
                    {formatTime(test.measuredAt)} ·{" "}
                    <span className="tnum">
                      {test.attempts.map((value) => show(value)).join(", ")}
                    </span>
                  </p>
                  {test.notes ? (
                    <p className="mt-1.5 text-xs text-ink-muted">
                      {test.notes}
                    </p>
                  ) : null}
                </div>
                <p className="tnum text-right">
                  <span className="numeral text-2xl text-ink">
                    {show(test.best)}
                  </span>
                  <span className="ml-1 text-xs text-ink-faint">{unit}</span>
                  <span className="mt-0.5 block text-xs text-ink-faint">
                    mean {show(test.mean)}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
