import { PageHeader, Placeholder } from "@/components/page-header";

export const metadata = { title: "Library" };

export default function LibraryPage() {
  return (
    <>
      <PageHeader title="Library" subtitle="The exercise directory." />
      <Placeholder phase="Phase 2">
        Browse, add, edit, disable, and re-tag exercises. Anything marked
        unavailable is filtered out before the generator ever sees it, so a stock
        entry that cannot be done is invisible rather than proposed and rejected.
      </Placeholder>
    </>
  );
}
