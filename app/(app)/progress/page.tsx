import { PageHeader, Placeholder } from "@/components/page-header";

export const metadata = { title: "Progress" };

export default function ProgressPage() {
  return (
    <>
      <PageHeader
        title="Progress"
        subtitle="Jump, strength, tendon load, adherence."
      />
      <Placeholder phase="Phase 3">
        Jump height is drawn with mesocycle blocks shaded and labelled, because an
        in-block dip is the expected outcome of a hard accumulation phase rather
        than a failure. Also relative strength, tendon pain against high-impact
        contacts, and RPE against prescribed load.
      </Placeholder>
    </>
  );
}
