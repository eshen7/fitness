import { PageHeader, Placeholder } from "@/components/page-header";

export const metadata = { title: "Food" };

export default function NutritionPage() {
  return (
    <>
      <PageHeader title="Food" subtitle="Plain-language logging, phase-aware targets." />
      <Placeholder phase="Phase 6">
        Meals are typed as sentences and resolved to full macros against a cached
        food library, so the same meal twice gives the same numbers. Targets track
        the current block, and a cut is only offered when tendon sites are healthy.
      </Placeholder>
    </>
  );
}
