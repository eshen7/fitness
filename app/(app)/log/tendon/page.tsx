import { PageHeader } from "@/components/page-header";
import { Card, Pips, Tag } from "@/components/ui";
import { tendonSiteLabels } from "@/lib/labels";
import { latestTendonBySite } from "@/lib/log/queries";
import { TENDON_SITES, type TendonSite } from "@/lib/taxonomy";
import { dayOf, formatDay } from "@/lib/time";
import { TendonForm, type TendonPrefill } from "./tendon-form";

export const metadata = { title: "Tendon check-in" };

export default async function LogTendonPage() {
  const latest = await latestTendonBySite();

  // The phase carries forward because it is a state, not an event: a tendon in
  // phase 2 yesterday is in phase 2 today unless it was progressed. The pain
  // scores never carry forward, because those are today's measurement.
  const prefill = Object.fromEntries(
    TENDON_SITES.map((site) => [
      site,
      { protocolPhase: latest.get(site)?.protocolPhase?.toString() ?? "" },
    ]),
  ) as TendonPrefill;

  const known = TENDON_SITES.filter((site) => latest.has(site));

  return (
    <>
      <PageHeader
        back={{ href: "/log", label: "Log" }}
        title="Tendon"
        subtitle="Pain during load and what the tendon can do, site by site. Pain is a signal about load, not a verdict on the tendon."
      />

      {known.length ? (
        <Card className="mb-5">
          <h2 className="eyebrow">Last recorded</h2>
          <ul className="mt-2">
            {known.map((site: TendonSite) => {
              const row = latest.get(site)!;
              return (
                <li
                  key={site}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line py-2 first:border-t-0"
                >
                  <span className="flex items-center gap-2 text-sm text-ink-muted">
                    {tendonSiteLabels.of(site)}
                    {row.protocolPhase !== null ? (
                      <Tag tone={row.protocolPhase <= 2 ? "warn" : "cool"}>
                        Phase {row.protocolPhase}
                      </Tag>
                    ) : null}
                  </span>
                  <span className="flex items-center gap-3">
                    <Pips
                      value={row.painDuringLoad}
                      max={10}
                      tone={row.painDuringLoad > 0 ? "warn" : "neutral"}
                      label="Pain during load"
                    />
                    <span className="text-xs text-ink-faint">
                      {formatDay(dayOf(row.recordedAt))}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <TendonForm prefill={prefill} />
    </>
  );
}
