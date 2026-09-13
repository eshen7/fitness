import { PageHeader, Placeholder } from "@/components/page-header";

export const metadata = { title: "Plan" };

export default function PlanPage() {
  return (
    <>
      <PageHeader title="Plan" subtitle="Blocks up front, weeks rolling." />
      <Placeholder phase="Phase 5">
        A mesocycle is declared here: type, one or two target abilities, the
        technical focus, and the stable exercise complex. Weeks are then generated
        one at a time inside that declaration, and regenerating a week is a normal
        action rather than a workaround.
      </Placeholder>
    </>
  );
}
