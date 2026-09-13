import { PageHeader, Placeholder } from "@/components/page-header";

export const metadata = { title: "Log" };

export default function LogPage() {
  return (
    <>
      <PageHeader title="Log" subtitle="Sets, jumps, tendon, readiness." />
      <Placeholder phase="Phase 3">
        The set logger, manual jump entry, and the tendon and readiness check-ins,
        all writable offline and flushed from a local queue when signal returns.
      </Placeholder>
    </>
  );
}
