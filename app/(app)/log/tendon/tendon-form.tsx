"use client";

import { useState, useTransition } from "react";
import { ScoreRow } from "@/components/score-row";
import { SubmitBar } from "@/components/submit-bar";
import { Button, Card, Field, Select, Tag, Textarea } from "@/components/ui";
import { logTendonCheckin } from "@/lib/log/actions";
import type { ActionResult } from "@/lib/log/schemas";
import { PROTOCOL_PHASES, tendonSiteLabels } from "@/lib/labels";
import { TENDON_SITES, type TendonSite } from "@/lib/taxonomy";

type SiteState = {
  painDuringLoad: number | null;
  painAfterLoad: number | null;
  morningStiffness: number | null;
  protocolPhase: string;
};

export type TendonPrefill = Record<TendonSite, { protocolPhase: string }>;

const blank = (protocolPhase: string): SiteState => ({
  painDuringLoad: null,
  painAfterLoad: null,
  morningStiffness: null,
  protocolPhase,
});

/** All three scores at zero, which is what "nothing to report" means numerically. */
const CLEAR = { painDuringLoad: 0, painAfterLoad: 0, morningStiffness: 0 } as const;

export function TendonForm({ prefill }: { prefill: TendonPrefill }) {
  const [sites, setSites] = useState<Record<TendonSite, SiteState>>(() =>
    Object.fromEntries(
      TENDON_SITES.map((site) => [site, blank(prefill[site].protocolPhase)]),
    ) as Record<TendonSite, SiteState>,
  );
  /**
   * Which sites are showing their score rows.
   *
   * Collapsed by default, because on almost every day nothing hurts anywhere and
   * the honest answer to all twelve questions is zero. A site already on a
   * protocol opens itself: it is under active management, so its daily number is
   * the point of the check-in rather than an exception to it.
   */
  const [open, setOpen] = useState<Record<TendonSite, boolean>>(() =>
    Object.fromEntries(
      TENDON_SITES.map((site) => [site, prefill[site].protocolPhase !== ""]),
    ) as Record<TendonSite, boolean>,
  );
  const [notes, setNotes] = useState("");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  function update(site: TendonSite, patch: Partial<SiteState>) {
    setSites((current) => ({ ...current, [site]: { ...current[site], ...patch } }));
  }

  function clearAll() {
    setSites((current) =>
      Object.fromEntries(
        TENDON_SITES.map((site) => [site, { ...current[site], ...CLEAR }]),
      ) as Record<TendonSite, SiteState>,
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    start(async () => {
      const payload = Object.fromEntries(
        TENDON_SITES.map((site) => {
          const state = sites[site];
          return [
            site,
            {
              painDuringLoad: state.painDuringLoad?.toString() ?? "",
              painAfterLoad: state.painAfterLoad?.toString() ?? "",
              morningStiffness: state.morningStiffness?.toString() ?? "",
              protocolPhase: state.protocolPhase,
            },
          ];
        }),
      );
      const response = await logTendonCheckin({ sites: payload, notes });
      setResult(response);
      if (response.ok) {
        setSites(
          Object.fromEntries(
            TENDON_SITES.map((site) => [site, blank(sites[site].protocolPhase)]),
          ) as Record<TendonSite, SiteState>,
        );
        setNotes("");
      } else if (response.errors) {
        // A rejected site is named in `errors`, and a collapsed card would hide
        // the very rows the message is asking to be filled in.
        const flagged = response.errors;
        setOpen((current) =>
          Object.fromEntries(
            TENDON_SITES.map((site) => [site, current[site] || site in flagged]),
          ) as Record<TendonSite, boolean>,
        );
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 pb-4">
      <Card className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          Nothing hurt anywhere today?
        </p>
        <Button type="button" variant="secondary" onClick={clearAll}>
          All clear
        </Button>
      </Card>

      {TENDON_SITES.map((site) => {
        const state = sites[site];
        const scores = [
          state.painDuringLoad,
          state.painAfterLoad,
          state.morningStiffness,
        ];
        const answered = scores.filter((score) => score !== null).length;
        const worst = Math.max(0, ...scores.filter((s): s is number => s !== null));
        const expanded = open[site];
        return (
          <Card key={site} className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setOpen((c) => ({ ...c, [site]: !c[site] }))}
                aria-expanded={expanded}
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-semibold text-ink"
              >
                <span className="truncate">{tendonSiteLabels.of(site)}</span>
                {answered === 0 ? (
                  <Tag>Skipped</Tag>
                ) : answered < 3 ? (
                  <Tag tone="warn">Incomplete</Tag>
                ) : worst === 0 ? (
                  <Tag tone="accent">Clear</Tag>
                ) : (
                  <Tag tone="warn">Worst {worst}</Tag>
                )}
                {state.protocolPhase ? (
                  <Tag tone="cool">Phase {state.protocolPhase}</Tag>
                ) : null}
              </button>
              {expanded ? null : (
                <button
                  type="button"
                  onClick={() => update(site, CLEAR)}
                  className="text-xs font-medium whitespace-nowrap text-accent hover:underline"
                >
                  All clear
                </button>
              )}
            </div>

            {expanded ? (
              <>
                <ScoreRow
                  label="Pain during load"
                  hint="0 none, 10 unbearable"
                  tone="warn"
                  value={state.painDuringLoad}
                  onChange={(value) => update(site, { painDuringLoad: value })}
                />
                <ScoreRow
                  label="Pain after load"
                  hint="Next few hours"
                  tone="warn"
                  value={state.painAfterLoad}
                  onChange={(value) => update(site, { painAfterLoad: value })}
                />
                <ScoreRow
                  label="Morning stiffness"
                  hint="The morning after"
                  tone="warn"
                  value={state.morningStiffness}
                  onChange={(value) => update(site, { morningStiffness: value })}
                />

                <Field
                  label="Protocol phase"
                  hint="Phase 1 or 2 removes every exercise loading this site from the candidate set, apart from the protocol's own prescriptions, until it changes."
                >
                  <Select
                    value={state.protocolPhase}
                    onChange={(event) =>
                      update(site, { protocolPhase: event.target.value })
                    }
                  >
                    <option value="">Not on a protocol</option>
                    {PROTOCOL_PHASES.map((phase) => (
                      <option key={phase.value} value={phase.value}>
                        {phase.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            ) : null}
          </Card>
        );
      })}

      <Card>
        <Field
          label="Notes"
          hint="Function and pain only. What you could and could not do, never a guess at what the tissue looks like."
        >
          <Textarea
            rows={3}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
      </Card>

      <SubmitBar pending={pending} label="Record check-in" result={result} />
    </form>
  );
}
