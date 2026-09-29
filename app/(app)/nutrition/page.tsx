import { PageHeader } from "@/components/page-header";
import { Card, Notice } from "@/components/ui";
import { formatUsd } from "@/lib/ai/pricing";
import { formatDay } from "@/lib/days";
import { nutritionSnapshot } from "@/lib/nutrition/queries";
import type { MealSlot } from "@/lib/taxonomy";
import { formatTime } from "@/lib/time";
import { DayLog } from "./day-log";
import { DayTotals } from "./day-totals";
import { MealForm } from "./meal-form";
import { TargetsCard } from "./targets-card";
import { WeightChart } from "./weight-chart";

export const metadata = { title: "Food" };

/**
 * The food screen, in the order the questions are asked.
 *
 * What did you eat, what does that add up to, what was it, what should it be, and is
 * bodyweight moving the way the target asked. The log sits above the targets because
 * logging is the thing done several times a day and setting a target is done once a
 * block.
 */
export default async function NutritionPage() {
  const snapshot = await nutritionSnapshot();

  return (
    <>
      <PageHeader
        title="Food"
        eyebrow={formatDay(snapshot.day)}
        subtitle="Say what you ate the way you would say it. A food eaten before costs nothing to log again."
      >
        <span className="tnum text-xs text-ink-faint">
          {formatUsd(snapshot.spendUsd)} of {formatUsd(snapshot.spendCapUsd)} spent
        </span>
      </PageHeader>

      <div className="space-y-5">
        {!snapshot.hasKey ? (
          <Notice tone="warn">
            <p>
              <span className="font-semibold text-ink">No API key.</span> A food never
              seen before needs <code className="text-xs">OPENAI_API_KEY</code> in the
              environment to be estimated. Anything already in the cache still logs
              normally, which is most of a repeating diet.
            </p>
          </Notice>
        ) : null}

        <Card>
          <MealForm defaultMeal={mealNow()} />
        </Card>

        <DayTotals
          totals={snapshot.totals}
          target={snapshot.target}
          remaining={snapshot.remaining}
        />

        <section>
          <h2 className="eyebrow mb-2">Logged today</h2>
          <DayLog meals={snapshot.meals} hasHistory={snapshot.hasHistory} />
        </section>

        <TargetsCard
          target={snapshot.target}
          proposal={snapshot.proposal}
          stale={snapshot.stale}
          suggestedGoal={snapshot.suggestedGoal}
          cutRefusedBecause={snapshot.cutRefusedBecause}
          blockType={snapshot.blockType}
        />

        <WeightChart
          weight={snapshot.weight}
          unitSystem={snapshot.unitSystem}
          day={snapshot.day}
        />
      </div>
    </>
  );
}

/**
 * The meal a sentence typed now probably belongs to.
 *
 * A guess, and one the owner can always change in the dropdown, but the right guess
 * saves the most common interaction on the page. Read through `formatTime` so the
 * hour is the app's zone rather than the server's.
 */
function mealNow(): MealSlot {
  const hour = Number(formatTime(new Date()).slice(0, 2));
  if (hour < 10) return "breakfast";
  if (hour < 15) return "lunch";
  if (hour < 21) return "dinner";
  return "snack";
}
