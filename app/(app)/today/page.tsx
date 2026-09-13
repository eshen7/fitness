import { PageHeader, Placeholder } from "@/components/page-header";

export const metadata = { title: "Today" };

export default function TodayPage() {
  return (
    <>
      <PageHeader
        title="Today"
        subtitle="The generated session, with the reasoning behind it."
      />
      <Placeholder phase="Phase 5">
        Today shows the proposed session together with its rationale, the inputs
        the model saw, what the normalizer changed, and the gate report, so it can
        be accepted, edited, or rejected. It needs the rule engine and the
        generation pipeline first.
      </Placeholder>
    </>
  );
}
