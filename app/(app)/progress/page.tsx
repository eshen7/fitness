import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { assertableInsightCount } from "@/lib/analytics/persist";
import { getUnitSystem } from "@/lib/log/queries";
import {
  blockBands,
  depthJumpReadings,
  jumpSittings,
  relativeStrength,
  sessionOutcomes,
  tendonWeeks,
} from "@/lib/progress/queries";
import { dayMinus } from "@/lib/time";
import { AdherenceChart } from "./adherence-chart";
import { DepthJumpCard } from "./depth-jump-card";
import { JumpChart } from "./jump-chart";
import { StrengthChart } from "./strength-chart";
import { TendonChart } from "./tendon-chart";

export const metadata = { title: "Progress" };

/**
 * The progress screens, in the order the questions get asked.
 *
 * Jump first, because it is the goal, and it is drawn on shaded mesocycle blocks
 * so an in-block dip reads as the load working rather than as a loss. Tendon load
 * second, because it is the thing that ends a season. Then relative strength,
 * which is the input the jump is bought with, then depth jump calibration, then
 * whether the plans themselves were calibrated.
 */
const JUMP_WINDOW_DAYS = 180;

export default async function ProgressPage() {
  const [unitSystem, sittings, blocks, weeks, strength, sessions, depthJump, insights] =
    await Promise.all([
      getUnitSystem(),
      jumpSittings(JUMP_WINDOW_DAYS),
      blockBands(dayMinus(JUMP_WINDOW_DAYS)),
      tendonWeeks(16),
      relativeStrength(180),
      sessionOutcomes(90),
      depthJumpReadings(365),
      assertableInsightCount(),
    ]);

  return (
    <>
      <PageHeader
        title="Progress"
        subtitle="Jump, tendon load, strength, adherence."
      >
        {/*
          The charts show what happened; the insight suite says which of it is more
          than noise. That distinction is the reason the statements live on their own
          screen instead of as captions here.
        */}
        {/*
          Accent and an arrow, because `PageHeader` wraps its children under the
          subtitle at phone widths: a grey sentence on its own line there is
          indistinguishable from the subtitle it sits below.
        */}
        <Link
          href="/plan/memory"
          className="text-sm font-medium text-accent underline-offset-2 hover:underline"
        >
          {insights === 0
            ? "What the numbers support"
            : `${insights} statement${insights === 1 ? "" : "s"} the numbers support`}
          <span aria-hidden> →</span>
        </Link>
      </PageHeader>
      <div className="space-y-4">
        <JumpChart
          sittings={sittings}
          blocks={blocks}
          unitSystem={unitSystem}
        />
        <TendonChart weeks={weeks} />
        <StrengthChart points={strength} unitSystem={unitSystem} />
        <DepthJumpCard
          standingCm={depthJump.standingCm}
          points={depthJump.points}
          matched={depthJump.matched}
          dropped={depthJump.dropped}
          unitSystem={unitSystem}
        />
        <AdherenceChart sessions={sessions} />
      </div>
    </>
  );
}
