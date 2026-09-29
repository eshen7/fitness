"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NeedsMaxNote } from "@/components/needs-max-note";
import { Button, Card, Field, Tag, Textarea } from "@/components/ui";
import { acceptProposal, rejectProposalAction } from "@/lib/ai/actions";
import { diffWeeks, identityOrigins } from "@/lib/ai/edits";
import { formatUsd, costOf } from "@/lib/ai/pricing";
import type { StoredProposal } from "@/lib/ai/proposals";
import { formatDay } from "@/lib/days";
import {
  mesocycleDeclarationSchema,
  microcyclePlanSchema,
  type MesocycleDeclaration,
  type MicrocyclePlan,
} from "@/lib/engine/types";
import {
  equipmentLabels,
  forceVelocityLabels,
  mesocycleTypeLabels,
  motorAbilityLabels,
  movementPatternLabels,
  muscleGroupLabels,
} from "@/lib/labels";
import { liftsNeedingMax } from "@/lib/prescription";
import { useVerdictOutcome } from "./verdict-outcome";
import { WeekEditor, type PlanLoads, type WeekEdit } from "./week-editor";

/**
 * Stage 5 of the pipeline: the proposal, everything behind it, and a verdict.
 *
 * The order down the screen is the order the owner needs it in. The plan and its
 * rationale first, because that is the decision. Then what the machinery did to
 * get there - the gate report, what the normalizer silently fixed, the advisories,
 * the rules the model *claims* it satisfied - because that is what turns a verdict
 * from a guess into a judgement. The raw prompt and the raw proposal last, folded
 * away, because they are for the session where something has gone wrong.
 *
 * Claimed constraints sit next to the gate report deliberately. A model asserting
 * it honoured a rule the gate caught it breaking is the single most useful signal
 * for fixing the prompt, and it only reads that way when the two are adjacent.
 */

export function ProposalReview({
  proposal,
  names,
  loads,
  canRegenerate,
}: {
  proposal: StoredProposal;
  names: Record<string, string>;
  loads: PlanLoads;
  canRegenerate?: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const announce = useVerdictOutcome();

  // A new proposal on screen makes the answer about the last one stale.
  useEffect(() => announce(null), [announce, proposal.id]);

  const week = parseWeek(proposal.normalized);
  const declaration = parseDeclaration(proposal.normalized);
  const edited = draft?.week ?? null;
  const shown = edited ?? week;
  // Opening the editor takes a working copy, which is not the same as having
  // changed something. The badge and the accept label track the diff, not the mode.
  const ownerEdits = draft && week ? diffWeeks(week, draft.week, draft.origins) : [];

  function accept() {
    setMessage(null);
    start(async () => {
      const result = await acceptProposal({
        proposalId: proposal.id,
        editedWeek: ownerEdits.length ? edited : null,
        sessionOrigins: ownerEdits.length ? draft?.origins : null,
      });
      // Success refreshes this review away, so its answer goes above it.
      if (result.ok) {
        announce(result.message);
        setDraft(null);
        router.refresh();
      } else {
        setMessage(result.message);
      }
    });
  }

  function reject() {
    setMessage(null);
    start(async () => {
      const result = await rejectProposalAction({ proposalId: proposal.id, reason });
      if (result.ok) {
        announce(result.message);
        setRejecting(false);
        router.refresh();
      } else {
        setMessage(result.message);
      }
    });
  }

  function change(edit: WeekEdit) {
    setDraft((current) =>
      current ? { ...current, week: applyEdit(current.week, edit) } : current,
    );
  }

  return (
    <Card className="space-y-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-ink">
            {proposal.scope === "mesocycle"
              ? `Proposed block${proposal.ask ? ` ${proposal.ask.ordinal}` : ""}`
              : `Proposed week${shown ? ` ${shown.ordinal}` : ""}`}
          </h2>
          {proposal.isFallback ? <Tag tone="bad">Fallback</Tag> : null}
          {proposal.passed ? (
            <Tag tone="accent">Gate passed</Tag>
          ) : proposal.violations.length ? (
            <Tag tone="bad">{proposal.violations.length} unresolved</Tag>
          ) : (
            <Tag tone="bad">No usable attempt</Tag>
          )}
          <Tag tone={proposal.repairAttempts > 0 ? "warn" : "neutral"}>
            {proposal.repairAttempts === 0
              ? "First attempt"
              : `${proposal.repairAttempts} repair${proposal.repairAttempts === 1 ? "" : "s"}`}
          </Tag>
          {ownerEdits.length ? <Tag tone="warn">Edited</Tag> : null}
        </div>
        <p className="text-xs text-ink-faint">
          {proposal.ask ? `From ${formatDay(proposal.ask.startDate)} · ` : ""}
          {proposal.model ?? "unknown model"}
          {proposal.usage
            ? ` · ${proposal.usage.inputTokens.toLocaleString()} in (${proposal.usage.cachedInputTokens.toLocaleString()} cached), ${proposal.usage.outputTokens.toLocaleString()} out · ${formatUsd(costOf(proposal.model ?? "", proposal.usage))}`
            : ""}
          {proposal.supersedesId ? ` · replaces #${proposal.supersedesId}` : ""}
        </p>
      </header>

      {proposal.isFallback ? (
        <p className="rounded-field border border-bad/40 bg-bad/5 px-3 py-2 text-sm text-ink-muted">
          The repair loop never converged, so this is the last session of each kind
          at reduced load rather than a new plan. Accepting it keeps training
          moving. Regenerating is worth it once whatever the gate report names has
          changed; before that it usually meets the same wall.
        </p>
      ) : null}

      {proposal.rationale ? (
        <section>
          <SectionTitle>Rationale</SectionTitle>
          <p className="mt-1.5 text-sm whitespace-pre-line text-ink-muted">
            {proposal.rationale}
          </p>
        </section>
      ) : null}

      {/* The plan itself. */}
      {declaration ? <DeclarationView declaration={declaration} names={names} /> : null}
      {shown ? (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionTitle>The week</SectionTitle>
            {week ? (
              <button
                type="button"
                onClick={() =>
                  setDraft(draft ? null : { week, origins: identityOrigins(week) })
                }
                className="text-xs font-semibold text-accent underline-offset-2 hover:underline"
              >
                {edited ? "Discard edits" : "Edit"}
              </button>
            ) : null}
          </div>
          <div className="mt-2">
            <WeekEditor
              week={shown}
              proposed={week ?? undefined}
              names={names}
              loads={loads}
              editing={edited !== null}
              sessionKeys={draft?.origins}
              onChange={change}
              onMoveSession={(session, to) =>
                setDraft((current) => (current ? moveSession(current, session, to) : current))
              }
              onDropSession={(session) =>
                setDraft((current) => (current ? dropSession(current, session) : current))
              }
              onDropItem={(session, exerciseId) =>
                setDraft((current) =>
                  current
                    ? { ...current, week: dropItem(current.week, session, exerciseId) }
                    : current,
                )
              }
            />
          </div>
          <div className="mt-2 empty:hidden">
            <NeedsMaxNote
              lifts={liftsNeedingMax(
                shown.sessions.flatMap((session) =>
                  session.blocks.flatMap((block) => block.items),
                ),
                loads.maxes,
              ).map((id) => ({
                name: names[String(id)] ?? `Exercise ${id}`,
                slug: loads.slugs[String(id)] ?? "",
              }))}
            />
          </div>
          {edited ? (
            <p className="mt-2 text-xs text-ink-faint">
              An edited week is re-normalized and re-gated before it is written, so
              rest and ordering are corrected again on accept. The gate can object
              and you can still accept; the disagreement is recorded.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* What the machinery said. */}
      {proposal.violations.length ? (
        <section>
          <SectionTitle>Gate report</SectionTitle>
          <ul className="mt-1.5 space-y-1.5">
            {proposal.violations.map((violation, index) => (
              <li
                key={`${violation.rule}-${index}`}
                className="rounded-field border border-bad/40 bg-bad/5 px-3 py-2 text-sm text-ink-muted"
              >
                <span className="font-mono text-xs text-bad">{violation.rule}</span>{" "}
                {violation.message}
                {violation.day ? (
                  <span className="text-ink-faint"> ({formatDay(violation.day)})</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {proposal.attempts.length > 1 ? (
        <section>
          <SectionTitle>Repair loop</SectionTitle>
          <ol className="mt-1.5 space-y-1">
            {proposal.attempts.map((attempt) => (
              <li key={attempt.attempt} className="text-sm [overflow-wrap:anywhere] text-ink-muted">
                <span className="text-ink-faint">Attempt {attempt.attempt}:</span>{" "}
                {attempt.error
                  ? attempt.error
                  : attempt.passed
                    ? "passed"
                    : `${attempt.violations.length} violation${attempt.violations.length === 1 ? "" : "s"} - ${ruleCounts(attempt.violations)}`}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {proposal.claimedConstraints.length ? (
        <section>
          <SectionTitle>What the model claims it satisfied</SectionTitle>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm text-ink-muted">
            {proposal.claimedConstraints.map((claim, index) => (
              <li key={index}>{claim}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {proposal.changes.length ? (
        <section>
          <SectionTitle>What the normalizer changed</SectionTitle>
          <ul className="mt-1.5 space-y-1">
            {proposal.changes.map((change, index) => (
              <li key={index} className="text-sm text-ink-muted">
                <span className="font-mono text-xs text-cool">{change.rule}</span>{" "}
                {names[String(change.exerciseId)] ?? `Exercise ${change.exerciseId}`}
                {" · "}
                {/* The day, because one exercise runs on several days of a week and
                    the same fix on each would otherwise read as a duplicated row. */}
                <span className="text-ink-faint">{formatDay(change.day)}</span>
                {" · "}
                <span className="text-ink-faint">{change.field}</span>{" "}
                <span className="tabular-nums">
                  {String(change.from ?? "unset")} → {String(change.to ?? "unset")}
                </span>
                <span className="block text-xs text-ink-faint">{change.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {proposal.advisories.length ? (
        <section>
          <SectionTitle>Advisories</SectionTitle>
          <ul className="mt-1.5 space-y-1.5">
            {proposal.advisories.map((advisory, index) => {
              // Stored as `[rule] message`, the shape the repair prompt uses. Split
              // it so the rule reads as a label here rather than as prose.
              const [, rule, message] =
                /^\[([^\]]+)]\s*([\s\S]*)$/.exec(advisory) ?? [];
              return (
                <li
                  key={index}
                  className="rounded-field border border-warn/40 bg-warn/5 px-3 py-2 text-sm text-ink-muted"
                >
                  {rule ? (
                    <span className="font-mono text-xs text-warn">{rule} </span>
                  ) : null}
                  {message ?? advisory}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <SuggestedExercises proposal={proposal.proposal} />

      {/* The receipts. */}
      <details className="rounded-field border border-line bg-surface-sunken px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium text-ink-muted">
          What the model saw
        </summary>
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-xs font-medium tracking-wide text-ink-faint uppercase">
              Stable prefix, cached
            </p>
            <pre className="mt-1 max-h-80 overflow-auto rounded-field border border-line bg-surface p-3 text-xs whitespace-pre-wrap text-ink-muted">
              {proposal.stable || "(not recorded)"}
            </pre>
          </div>
          <div>
            <p className="text-xs font-medium tracking-wide text-ink-faint uppercase">
              Volatile suffix
            </p>
            <pre className="mt-1 max-h-80 overflow-auto rounded-field border border-line bg-surface p-3 text-xs whitespace-pre-wrap text-ink-muted">
              {proposal.volatile || "(not recorded)"}
            </pre>
          </div>
          <div>
            <p className="text-xs font-medium tracking-wide text-ink-faint uppercase">
              Raw proposal, before the normalizer
            </p>
            <pre className="mt-1 max-h-80 overflow-auto rounded-field border border-line bg-surface p-3 text-xs text-ink-muted">
              {JSON.stringify(proposal.proposal, null, 2)}
            </pre>
          </div>
        </div>
      </details>

      {/* The verdict. */}
      <div className="space-y-3 border-t border-line pt-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={accept} disabled={pending || !canAccept(proposal, shown)}>
            {pending ? "Writing…" : ownerEdits.length ? "Accept as edited" : "Accept"}
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={() => setRejecting(!rejecting)}
            disabled={pending}
          >
            Reject
          </Button>
        </div>

        {rejecting ? (
          <div className="space-y-2">
            <Field
              label="Why"
              hint="Required. This is the strongest steer the generator gets."
            >
              <Textarea
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Too much bounding after Tuesday."
              />
            </Field>
            <Button
              type="button"
              variant="danger"
              onClick={reject}
              disabled={pending || reason.trim().length < 4}
            >
              Reject this proposal
            </Button>
          </div>
        ) : null}

        {proposal.scope === "mesocycle" && !canAccept(proposal, shown) ? (
          <p className="text-sm text-ink-faint">
            No attempt passed the rules, so there is nothing to accept. Reject it,
            fix what the messages above name, and declare the block again.
          </p>
        ) : canRegenerate === false && !shown ? (
          <p className="text-sm text-ink-faint">
            There is nothing to accept here. Regenerate, or fix the prompt first.
          </p>
        ) : null}

        {message ? (
          <p role="status" className="text-sm text-bad">
            {message}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-medium tracking-wide text-ink-faint uppercase">
      {children}
    </h3>
  );
}

/** A declaration reads as four facts and a list, so it is rendered as that. */
function DeclarationView({
  declaration,
  names,
}: {
  declaration: MesocycleDeclaration;
  names: Record<string, string>;
}) {
  return (
    <section className="space-y-3">
      <SectionTitle>The block</SectionTitle>
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="accent">{mesocycleTypeLabels.of(declaration.type)}</Tag>
        <Tag>{declaration.plannedMicrocycles} weeks</Tag>
        {declaration.targetAbilities.map((ability) => (
          <Tag key={ability} tone="cool">
            {motorAbilityLabels.of(ability)}
          </Tag>
        ))}
      </div>
      {declaration.technicalFocus.length ? (
        <p className="text-sm text-ink-muted">
          <span className="text-ink-faint">Technical focus: </span>
          {declaration.technicalFocus.join("; ")}
        </p>
      ) : null}
      <div>
        <p className="text-xs text-ink-faint">
          The stable complex, run through every week of the block.
        </p>
        <ul className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
          {declaration.complex.map((item) => (
            <li
              key={item.exerciseId}
              className="flex items-center justify-between gap-2 rounded-field border border-line bg-surface-sunken px-3 py-2"
            >
              <span className="min-w-0 truncate text-sm text-ink">
                {names[String(item.exerciseId)] ?? `Exercise ${item.exerciseId}`}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {item.isMain ? <Tag tone="accent">main</Tag> : null}
                <span className="text-xs text-ink-faint tabular-nums">
                  {item.targetWeeklyFrequency ?? 2}x/wk
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * The closed-set escape hatch, surfaced.
 *
 * The generator cannot invent an exercise, so when it wants one it files it here.
 * A suggestion nobody ever sees is the same as no suggestion, which would make the
 * closed set feel arbitrary instead of curated.
 */
function SuggestedExercises({ proposal }: { proposal: unknown }) {
  const suggestions = readSuggestions(proposal);
  if (!suggestions.length) return null;
  return (
    <section>
      <SectionTitle>Wanted, and not in the directory</SectionTitle>
      <ul className="mt-1.5 space-y-2">
        {suggestions.map((suggestion, index) => (
          <li
            key={index}
            className="rounded-field border border-line bg-surface-sunken px-3 py-2"
          >
            <p className="text-sm font-medium text-ink">{suggestion.name}</p>
            <p className="mt-0.5 text-sm text-ink-muted">{suggestion.rationale}</p>
            <p className="mt-1 flex flex-wrap gap-1.5 text-xs text-ink-faint">
              {[
                muscleGroupLabels.map[
                  suggestion.primaryMuscleGroup as keyof typeof muscleGroupLabels.map
                ] ?? suggestion.primaryMuscleGroup,
                movementPatternLabels.map[
                  suggestion.movementPattern as keyof typeof movementPatternLabels.map
                ] ?? suggestion.movementPattern,
                forceVelocityLabels.map[
                  suggestion.forceVelocity as keyof typeof forceVelocityLabels.map
                ] ?? suggestion.forceVelocity,
                ...suggestion.equipment.map(
                  (item) =>
                    equipmentLabels.map[item as keyof typeof equipmentLabels.map] ?? item,
                ),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Reading stored jsonb, tolerantly
// -----------------------------------------------------------------------------

type Suggestion = {
  name: string;
  rationale: string;
  primaryMuscleGroup: string;
  movementPattern: string;
  forceVelocity: string;
  equipment: string[];
};

function readSuggestions(proposal: unknown): Suggestion[] {
  if (proposal === null || typeof proposal !== "object") return [];
  const raw = (proposal as { suggestedExercises?: unknown }).suggestedExercises;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (entry === null || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== "string") return [];
    return [
      {
        name: record.name,
        rationale: typeof record.rationale === "string" ? record.rationale : "",
        primaryMuscleGroup: String(record.primaryMuscleGroup ?? ""),
        movementPattern: String(record.movementPattern ?? ""),
        forceVelocity: String(record.forceVelocity ?? ""),
        equipment: Array.isArray(record.equipment) ? record.equipment.map(String) : [],
      },
    ];
  });
}

/** Each broken rule once, with how often: five `closed-set`s read as one problem. */
function ruleCounts(violations: readonly { rule: string }[]): string {
  const counts = new Map<string, number>();
  for (const { rule } of violations) counts.set(rule, (counts.get(rule) ?? 0) + 1);
  return [...counts]
    .map(([rule, count]) => (count === 1 ? rule : `${rule} x${count}`))
    .join(", ");
}

function parseWeek(value: unknown): MicrocyclePlan | null {
  const parsed = microcyclePlanSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseDeclaration(value: unknown): MesocycleDeclaration | null {
  const parsed = mesocycleDeclarationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** A proposal with nothing usable in it cannot be accepted, only rejected. */
function canAccept(proposal: StoredProposal, week: MicrocyclePlan | null): boolean {
  if (proposal.scope === "mesocycle") {
    return parseDeclaration(proposal.normalized) !== null;
  }
  return week !== null;
}

// -----------------------------------------------------------------------------
// Edits
// -----------------------------------------------------------------------------

function applyEdit(week: MicrocyclePlan, edit: WeekEdit): MicrocyclePlan {
  // `sets` is required and at least one, so clearing the field means one set
  // rather than an unwritable plan.
  const value =
    edit.field === "sets" ? Math.max(1, Math.round(edit.value ?? 1)) : edit.value;
  return {
    ...week,
    sessions: week.sessions.map((session, index) =>
      index !== edit.session
        ? session
        : {
            ...session,
            blocks: session.blocks.map((block) => ({
              ...block,
              items: block.items.map((item) =>
                item.exerciseId === edit.exerciseId
                  ? { ...item, [edit.field]: value }
                  : item,
              ),
            })),
          },
    ),
  };
}

/**
 * The week being edited, with the proposed index each session came from, so the
 * diff can follow a session across a move that reorders the week.
 */
type Draft = { week: MicrocyclePlan; origins: number[] };

function moveSession(draft: Draft, moved: number, to: string): Draft {
  if (to === "") return draft;
  const rows = draft.week.sessions
    .map((session, index) => ({
      session: index === moved ? { ...session, day: to } : session,
      origin: draft.origins[index],
    }))
    .sort((a, b) => a.session.day.localeCompare(b.session.day));
  return {
    week: { ...draft.week, sessions: rows.map((row) => row.session) },
    origins: rows.map((row) => row.origin),
  };
}

function dropSession(draft: Draft, dropped: number): Draft {
  const kept = draft.week.sessions.flatMap((session, index) =>
    index === dropped ? [] : [{ session, origin: draft.origins[index] }],
  );
  return {
    week: { ...draft.week, sessions: kept.map((row) => row.session) },
    origins: kept.map((row) => row.origin),
  };
}

/**
 * Dropping an exercise drops its block too when it was the only one in it, because
 * a block with no prescriptions is unrepresentable and an empty heading is noise.
 */
function dropItem(
  week: MicrocyclePlan,
  target: number,
  exerciseId: number,
): MicrocyclePlan {
  return {
    ...week,
    sessions: week.sessions.map((session, index) =>
      index !== target
        ? session
        : {
            ...session,
            blocks: session.blocks
              .map((block) => ({
                ...block,
                items: block.items.filter((item) => item.exerciseId !== exerciseId),
              }))
              .filter((block) => block.items.length > 0),
          },
    ),
  };
}
