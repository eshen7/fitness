"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { Volume } from "@/components/prescription";
import { Button, Card, Field, Input, Select, Tag, Textarea } from "@/components/ui";
import { deleteLoggedSet, finishSession } from "@/lib/log/actions";
import {
  buildLoggedSet,
  carriesOut,
  EMPTY_FIELDS,
  nextLine,
  planProgress,
  prefill,
  type LoggerFields,
  type LoggerOuting,
  type PlanLine,
} from "@/lib/log/plan";
import {
  acknowledgeQueue,
  dequeue,
  enqueue,
  flushQueue,
  getQueueSnapshot,
  getServerQueueSnapshot,
  subscribeQueue,
} from "@/lib/log/queue";
import type { LoggedSetRow } from "@/lib/log/queries";
import {
  describePrescription,
  prescriptionDetail,
  prescriptionLoad,
  prescriptionVolume,
  type PrescriptionMaxes,
} from "@/lib/prescription";
import type {
  Equipment,
  MovementPattern,
  MuscleGroup,
  UnitSystem,
} from "@/lib/taxonomy";
import { displayUnit, round1, toDisplay } from "@/lib/units";

export type LoggerExercise = {
  id: number;
  name: string;
  movementPattern: MovementPattern;
  primaryMuscleGroup: MuscleGroup;
  equipment: Equipment[];
  equipmentAnyOf: Equipment[];
  highImpact: boolean;
  cues: string[];
};

/** A set as the list renders it, from the server or still on the device. */
type Entry = {
  key: string;
  clientId: string | null;
  id: number | null;
  exerciseId: number;
  prescribedSetId: number | null;
  setIndex: number;
  reps: number | null;
  holdSeconds: number | null;
  loadKg: number | null;
  boxHeightCm: number | null;
  rpe: number | null;
  qualityRating: number | null;
  pending: boolean;
};

/**
 * What the form is logging.
 *
 * `plan` follows the session: the current exercise is always the first planned
 * line with sets left, so logging the last set of one line moves on to the next
 * without a tap. A pick is the owner stepping off that path, to a line out of
 * order, an extra set on a finished one, or an exercise the plan never named.
 */
type Mode =
  | { kind: "plan" }
  | { kind: "picker" }
  | { kind: "pick"; exerciseId: number; lineId: number | null };

type Current = { exerciseId: number; line: PlanLine | null };

/**
 * The set fields: scoreboard digits, centred in a column a third of the card
 * wide, and 56px tall because they are hit between sets with chalked hands.
 */
const SET_FIELD = "numeral h-14 text-center text-2xl";

export function SetLogger({
  sessionId,
  exercises,
  plan,
  serverSets,
  lastSets,
  maxes,
  unitSystem,
  finished,
}: {
  sessionId: number;
  exercises: LoggerExercise[];
  /** The session's prescription lines in order; empty for an ad-hoc session. */
  plan: PlanLine[];
  serverSets: LoggedSetRow[];
  lastSets: Record<number, LoggerOuting[]>;
  /** Each lift's current max in kilograms, keyed by exercise id, for "% 1RM" lines. */
  maxes: PrescriptionMaxes;
  unitSystem: UnitSystem;
  finished: boolean;
}) {
  const router = useRouter();
  const queue = useSyncExternalStore(
    subscribeQueue,
    getQueueSnapshot,
    getServerQueueSnapshot,
  );
  const queued = queue.items;
  /** Only what this form rejected. Flush outcomes come from the queue itself. */
  const [formError, setFormError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>(
    plan.length ? { kind: "plan" } : { kind: "picker" },
  );
  /** The fields, and the exercise and line they were filled for. */
  const [form, setForm] = useState<{ key: string | null; fields: LoggerFields }>({
    key: null,
    fields: EMPTY_FIELDS,
  });
  const fields = form.fields;
  const setFields = (update: (current: LoggerFields) => LoggerFields) =>
    setForm((current) => ({ ...current, fields: update(current.fields) }));
  const [sessionRpe, setSessionRpe] = useState("");
  const [sessionNotes, setSessionNotes] = useState("");
  const [busy, start] = useTransition();
  /** The last set this form logged, confirmed under the button until the next. */
  const [lastLogged, setLastLogged] = useState<{
    key: string;
    exerciseId: number;
    text: string;
  } | null>(null);

  const massUnit = displayUnit("mass", unitSystem);
  const lengthUnit = displayUnit("length", unitSystem);

  // The outcome lands in the queue store, so all this has to do is pull the
  // server's copy of the session forward once something was actually written.
  const flush = useCallback(() => {
    void flushQueue().then((outcome) => {
      if (outcome.accepted) router.refresh();
    });
  }, [router]);

  // Anything left from a previous visit goes as soon as this mounts, and again
  // whenever the connection comes back, so a session logged in a dead spot lands
  // without the owner having to remember to do anything.
  useEffect(() => {
    flush();
    const onOnline = () => flush();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flush]);

  const matches = useMemo(() => {
    const text = query.trim().toLowerCase();
    // With a plan above it, the search is the way off the plan rather than the way
    // into the session, so it lists nothing until asked.
    if (!text) return plan.length ? [] : exercises.slice(0, 8);
    return exercises
      .filter((row) => row.name.toLowerCase().includes(text))
      .slice(0, 8);
  }, [exercises, plan.length, query]);

  const entries = useMemo<Entry[]>(() => {
    const confirmed = new Set(
      serverSets.map((row) => row.clientId).filter(Boolean) as string[],
    );
    const fromServer: Entry[] = serverSets.map((row) => ({
      key: `db:${row.id}`,
      clientId: row.clientId,
      id: row.id,
      exerciseId: row.exerciseId,
      prescribedSetId: row.prescribedSetId,
      setIndex: row.setIndex,
      reps: row.reps,
      holdSeconds: row.holdSeconds,
      loadKg: row.loadKg,
      boxHeightCm: row.boxHeightCm,
      rpe: row.rpe,
      qualityRating: row.qualityRating,
      pending: false,
    }));
    // A set can briefly be in both places: written to the device, accepted by the
    // server, and not yet gone from this tab's copy of the queue.
    const fromQueue: Entry[] = queued
      .filter(
        (item) =>
          item.sessionId === sessionId && !confirmed.has(item.clientId),
      )
      .map((item) => ({
        key: `q:${item.clientId}`,
        clientId: item.clientId,
        id: null,
        exerciseId: item.exerciseId,
        prescribedSetId: item.prescribedSetId ?? null,
        setIndex: item.setIndex,
        reps: item.reps ?? null,
        holdSeconds: item.holdSeconds ?? null,
        loadKg: item.loadKg ?? null,
        boxHeightCm: item.boxHeightCm ?? null,
        rpe: item.rpe ?? null,
        qualityRating: item.qualityRating ?? null,
        pending: true,
      }));
    return [...fromServer, ...fromQueue];
  }, [queued, serverSets, sessionId]);

  const byExercise = useMemo(() => {
    const groups = new Map<number, Entry[]>();
    for (const entry of entries) {
      const list = groups.get(entry.exerciseId);
      if (list) list.push(entry);
      else groups.set(entry.exerciseId, [entry]);
    }
    for (const list of groups.values()) list.sort((a, b) => a.setIndex - b.setIndex);
    return groups;
  }, [entries]);

  // Counted over queued sets as well as stored ones, so a line finished in a dead
  // spot reads as finished and the next set is not linked to it a fourth time.
  const progress = useMemo(() => planProgress(plan, entries), [plan, entries]);
  const upNext = nextLine(progress);

  const current: Current | null =
    mode.kind === "pick"
      ? {
          exerciseId: mode.exerciseId,
          line: plan.find((line) => line.id === mode.lineId) ?? null,
        }
      : mode.kind === "plan" && upNext
        ? { exerciseId: upNext.exerciseId, line: upNext }
        : null;
  const exercise = current
    ? (exercises.find((row) => row.id === current.exerciseId) ?? null)
    : null;
  const lineProgress = current?.line
    ? progress.find(({ line }) => line.id === current.line!.id)
    : undefined;
  /** Null while the form is on an unplanned exercise or past the line's sets. */
  const linkedTo = carriesOut(progress, current?.line?.id ?? null);

  // The fields refill whenever the form moves to a different exercise or line,
  // including when the plan moves on by itself after the last set of a line.
  // Adjusted during render rather than in an effect, so the new exercise never
  // shows for a frame with the old one's numbers in it.
  const formKey = current ? `${current.exerciseId}:${current.line?.id ?? "-"}` : null;
  if (current && form.key !== formKey) {
    setForm({
      key: formKey,
      fields: prefill({
        line: current.line,
        sessionSets: byExercise.get(current.exerciseId) ?? [],
        outings: lastSets[current.exerciseId] ?? [],
        unitSystem,
        oneRmKg: maxes[String(current.exerciseId)],
      }),
    });
  }

  /**
   * Ground contacts today, counted in reps rather than in sets.
   *
   * A contact is one landing, so six depth jumps is six contacts and not one. This
   * is the number the tendon load ceiling is expressed in, and counting sets here
   * would understate it by whatever the rep scheme happens to be. A high-impact
   * entry with no rep count is a single effort, so it counts as one.
   */
  const contacts = entries.reduce((total, entry) => {
    const row = exercises.find((e) => e.id === entry.exerciseId);
    if (!row?.highImpact) return total;
    return total + (entry.reps ?? 1);
  }, 0);

  /** A planned line, done or not: a finished one takes extra sets, unlinked. */
  function pickLine(line: PlanLine) {
    forgetLastLoggedUnless(line.exerciseId);
    setMode({ kind: "pick", exerciseId: line.exerciseId, lineId: line.id });
    setQuery("");
  }

  /**
   * An exercise from the search. One the plan still has sets of is logged
   * against that line, since finding it by name rather than in the plan list
   * does not make it any less the prescribed work.
   */
  function pickExercise(id: number) {
    const open = progress.find(
      ({ line, done }) => line.exerciseId === id && done < line.sets,
    );
    forgetLastLoggedUnless(id);
    setMode({ kind: "pick", exerciseId: id, lineId: open?.line.id ?? null });
    setQuery("");
  }

  function forgetLastLoggedUnless(exerciseId: number) {
    if (lastLogged && lastLogged.exerciseId !== exerciseId) setLastLogged(null);
  }

  function logSet() {
    if (!exercise || !current) return;
    const item = buildLoggedSet({
      clientId: crypto.randomUUID(),
      sessionId,
      exerciseId: exercise.id,
      prescribedSetId: linkedTo,
      setIndex: (byExercise.get(exercise.id)?.length ?? 0) + 1,
      fields,
      unitSystem,
      performedAt: new Date(),
    });
    if ("error" in item) {
      setFormError(item.error);
      return;
    }

    enqueue(item);
    setFormError(null);
    setLastLogged({
      key: item.clientId,
      exerciseId: exercise.id,
      text: `${exercise.name}, set ${item.setIndex} logged`,
    });
    setFields((current) => ({ ...current, rpe: "", quality: null }));
    // A picked line that this set finished hands back to the plan, which then
    // opens on whatever is next rather than inviting a set past the prescription.
    if (
      mode.kind === "pick" &&
      lineProgress &&
      linkedTo !== null &&
      lineProgress.done + 1 >= lineProgress.line.sets
    ) {
      setMode({ kind: "plan" });
    }
    flush();
  }

  function removeEntry(entry: Entry) {
    if (entry.clientId && entry.clientId === lastLogged?.key) setLastLogged(null);
    if (entry.id === null) {
      if (entry.clientId) dequeue([entry.clientId]);
      return;
    }
    start(async () => {
      await deleteLoggedSet(entry.id!);
      router.refresh();
    });
  }

  function finish() {
    start(async () => {
      const rpe = sessionRpe.trim() ? Number(sessionRpe) : null;
      const result = await finishSession(sessionId, rpe, sessionNotes || null);
      if (result.ok) router.push("/log");
      else setFormError(result.message);
    });
  }

  /** The plan as the picker lists it: lines under their block, in order. */
  const planBlocks: { label: string; rows: typeof progress }[] = [];
  for (const row of progress) {
    const last = planBlocks.at(-1);
    if (last && last.label === row.line.blockLabel) last.rows.push(row);
    else planBlocks.push({ label: row.line.blockLabel, rows: [row] });
  }

  const setLabel = current?.line
    ? linkedTo !== null && lineProgress
      ? `${current.line.blockLabel} · Set ${lineProgress.done + 1} of ${current.line.sets}`
      : `Extra set · the plan's ${current.line.sets} are done`
    : plan.length
      ? "Not in the plan"
      : `Set ${(byExercise.get(current?.exerciseId ?? 0)?.length ?? 0) + 1}`;
  // The plan's own cue for this line leads, since it was written for this session.
  const cues = [
    ...(current?.line?.cueOverride ? [current.line.cueOverride] : []),
    ...(exercise?.cues ?? []),
  ].slice(0, 3);

  const showReps = exercise?.movementPattern !== "isometric_hold";
  const showHold = exercise?.movementPattern === "isometric_hold";
  const showBox = exercise?.movementPattern === "depth_drop";
  const bodyweightOnly =
    exercise !== null &&
    exercise.equipmentAnyOf.length === 0 &&
    exercise.equipment.every((item) => item === "none");

  const rejected = queue.rejected;
  const notice =
    formError ??
    (rejected.length
      ? `${rejected.length === 1 ? "One set was" : `${rejected.length} sets were`} refused and dropped: ${rejected[0].message}`
      : queue.error);

  return (
    <div className="space-y-4 pb-4">
      {notice ? (
        <div className="flex items-start justify-between gap-3 border-l-2 border-warn bg-warn/[0.07] py-2 pr-2 pl-4">
          <p role="status" className="text-sm text-warn">
            {notice}
          </p>
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              acknowledgeQueue();
            }}
            className="press -my-2 inline-flex min-h-11 shrink-0 items-center px-2 text-sm font-medium text-warn hover:underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {!finished ? (
        <Card>
          {current && exercise ? (
            <form
              // Enter walks the fields in order and logs the set from the last
              // one, so a keyboard never has to reach for the button and a
              // stray Enter in the reps field never logs a half-filled set.
              onSubmit={(event) => {
                event.preventDefault();
                logSet();
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || !(event.target instanceof HTMLInputElement)) {
                  return;
                }
                const inputs = [
                  ...event.currentTarget.querySelectorAll<HTMLInputElement>("input[data-set-field]"),
                ];
                const at = inputs.indexOf(event.target);
                if (at >= 0 && at < inputs.length - 1) {
                  event.preventDefault();
                  inputs[at + 1].focus();
                  inputs[at + 1].select();
                }
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p
                    className={`eyebrow tnum ${linkedTo !== null ? "text-accent" : ""}`}
                  >
                    {setLabel}
                  </p>
                  <h2 className="mt-1.5 font-display text-2xl leading-tight font-bold text-ink">
                    {exercise.name}
                  </h2>
                  {exercise.highImpact ? (
                    <p className="mt-0.5 text-xs text-ink-faint">Counts toward contacts</p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setMode({ kind: "picker" })}
                  className="-mt-0.5 shrink-0"
                >
                  Change
                </Button>
              </div>

              {current.line && lineProgress ? (
                // Where this set sits in the line: done, this one, still to come.
                <div aria-hidden="true" className="mt-3 flex gap-1">
                  {Array.from({ length: current.line.sets }, (_, i) => (
                    <span
                      key={i}
                      className={`h-1 flex-1 rounded-full ${
                        i < lineProgress.done
                          ? "bg-good"
                          : i === lineProgress.done && linkedTo !== null
                            ? "bg-accent"
                            : "bg-surface-raised"
                      }`}
                    />
                  ))}
                </div>
              ) : null}

              {current.line ? (
                <div className="mt-4 flex items-end justify-between gap-4 border-y border-line py-3">
                  <div className="min-w-0">
                    <p className="eyebrow">Target</p>
                    {prescriptionLoad(
                      current.line,
                      unitSystem,
                      maxes[String(current.exerciseId)],
                    ) ? (
                      <p className="mt-1 text-sm text-ink-muted">
                        {prescriptionLoad(
                          current.line,
                          unitSystem,
                          maxes[String(current.exerciseId)],
                        )}
                      </p>
                    ) : null}
                    {prescriptionDetail(current.line) ? (
                      <p className="mt-0.5 text-xs text-ink-faint">
                        {prescriptionDetail(current.line)}
                      </p>
                    ) : null}
                  </div>
                  <Volume
                    value={prescriptionVolume(current.line)}
                    className="shrink-0 text-3xl leading-none text-ink"
                  />
                </div>
              ) : null}

              {cues.length ? (
                <ul className="mt-3 space-y-1 text-sm text-ink-muted">
                  {cues.map((cue) => (
                    <li key={cue} className="flex gap-2.5">
                      <span
                        aria-hidden="true"
                        className="mt-[0.6em] h-px w-2.5 shrink-0 bg-ink-faint"
                      />
                      {cue}
                    </li>
                  ))}
                </ul>
              ) : null}

              {/*
                Three fields or four, never two, since load and RPE are always
                present and exactly one of reps or hold is. Sizing the columns to
                the count keeps the last field from dangling in a half-empty row,
                which at a glance reads as a field someone forgot to fill in.
              */}
              <div
                className={`mt-4 grid gap-3 ${showBox ? "grid-cols-2" : "grid-cols-3"}`}
              >
                {showReps ? (
                  <Field label="Reps">
                    <Input
                      type="number"
                      inputMode="numeric"
                      enterKeyHint="next"
                      data-set-field=""
                      min="1"
                      max="500"
                      value={fields.reps}
                      onChange={(event) =>
                        setFields((f) => ({ ...f, reps: event.target.value }))
                      }
                      onFocus={(event) => event.target.select()}
                      className={SET_FIELD}
                    />
                  </Field>
                ) : null}
                {showHold ? (
                  <Field label="Hold (s)">
                    <Input
                      type="number"
                      inputMode="decimal"
                      enterKeyHint="next"
                      data-set-field=""
                      step="0.5"
                      min="0"
                      value={fields.hold}
                      onChange={(event) =>
                        setFields((f) => ({ ...f, hold: event.target.value }))
                      }
                      onFocus={(event) => event.target.select()}
                      className={SET_FIELD}
                    />
                  </Field>
                ) : null}
                <Field label={`Load (${massUnit})`}>
                  <Input
                    type="number"
                    inputMode="decimal"
                    enterKeyHint="next"
                    data-set-field=""
                    step="any"
                    min="0"
                    value={fields.load}
                    onChange={(event) =>
                      setFields((f) => ({ ...f, load: event.target.value }))
                    }
                    onFocus={(event) => event.target.select()}
                    className={SET_FIELD}
                  />
                </Field>
                {showBox ? (
                  <Field label={`Drop height (${lengthUnit})`}>
                    <Input
                      type="number"
                      inputMode="decimal"
                      enterKeyHint="next"
                      data-set-field=""
                      step="any"
                      min="0"
                      value={fields.box}
                      onChange={(event) =>
                        setFields((f) => ({ ...f, box: event.target.value }))
                      }
                      onFocus={(event) => event.target.select()}
                      className={SET_FIELD}
                    />
                  </Field>
                ) : null}
                <Field label="RPE">
                  <Input
                    type="number"
                    inputMode="decimal"
                    enterKeyHint="done"
                    data-set-field=""
                    step="0.5"
                    min="1"
                    max="10"
                    value={fields.rpe}
                    onChange={(event) =>
                      setFields((f) => ({ ...f, rpe: event.target.value }))
                    }
                    onFocus={(event) => event.target.select()}
                    className={SET_FIELD}
                  />
                </Field>
              </div>
              {/* A hint line rather than a placeholder: the load column is a
                  third of the card at 390px, too narrow for the word. */}
              {bodyweightOnly ? (
                <p className="mt-1.5 text-xs text-ink-faint">
                  Load is added weight. Leave it empty for bodyweight.
                </p>
              ) : null}

              <div className="mt-4">
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-ink-muted">Quality</span>
                  <span className="text-xs text-ink-faint">1 fell apart · 5 clean</span>
                </div>
                {/* Only well-executed reps count toward adaptation, so a set that
                    fell apart is worth marking as one at the time. */}
                <div
                  role="group"
                  aria-label="Quality, 1 fell apart, 5 clean"
                  className="grid grid-cols-5 gap-1.5"
                >
                  {[1, 2, 3, 4, 5].map((score) => (
                    <button
                      key={score}
                      type="button"
                      aria-pressed={fields.quality === score}
                      onClick={() =>
                        setFields((f) => ({
                          ...f,
                          quality: f.quality === score ? null : score,
                        }))
                      }
                      className={`press numeral h-12 rounded-field border text-lg ${
                        fields.quality === score
                          ? "border-accent bg-accent/15 text-accent"
                          : "border-line-strong bg-surface-sunken text-ink-muted hover:border-ink-faint"
                      }`}
                    >
                      {score}
                    </button>
                  ))}
                </div>
              </div>

              <Button type="submit" size="lg" className="mt-5 w-full">
                Log set
              </Button>
              {/* Room reserved, so the confirmation never pushes the list down. */}
              <p
                role="status"
                className="mt-2 flex min-h-5 items-center gap-1.5 text-sm text-good"
              >
                {lastLogged ? (
                  <>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="size-4 shrink-0"
                    >
                      <path d="m5 12.5 4.5 4.5L19 7.5" />
                    </svg>
                    <span key={lastLogged.key} className="truncate">
                      {lastLogged.text}
                    </span>
                  </>
                ) : null}
              </p>
            </form>
          ) : (
            <>
              {plan.length ? (
                <>
                  <h2 className="font-display text-xl font-bold text-ink">
                    {upNext ? "Pick a line" : "Plan complete"}
                  </h2>
                  {upNext ? null : (
                    <p className="mt-1 text-sm text-ink-muted">
                      Every planned set is logged. Anything more goes in as extra
                      work, outside the prescription.
                    </p>
                  )}
                  <div className="mt-4 space-y-4">
                    {planBlocks.map(({ label, rows }, index) => (
                      <div key={`${label}-${index}`}>
                        <p className="eyebrow">{label}</p>
                        <ul className="mt-1">
                          {rows.map(({ line, done }) => (
                            <li key={line.id} className="border-t border-line first:border-t-0">
                              <button
                                type="button"
                                onClick={() => pickLine(line)}
                                className="press -mx-2 flex min-h-14 w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-field px-2 py-2 text-left hover:bg-surface-raised/60"
                              >
                                <span className="min-w-0">
                                  <span className="block text-ink">
                                    {exercises.find((row) => row.id === line.exerciseId)
                                      ?.name ?? `Exercise ${line.exerciseId}`}
                                  </span>
                                  <span className="block text-sm text-ink-faint">
                                    {describePrescription(
                                      line,
                                      unitSystem,
                                      maxes[String(line.exerciseId)],
                                    )}
                                  </span>
                                </span>
                                <Tag tone={done >= line.sets ? "good" : "neutral"}>
                                  {done >= line.sets ? "Done" : `${done} of ${line.sets}`}
                                </Tag>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                  <h2 className="eyebrow mt-6">Something else</h2>
                  <p className="mt-1 text-sm text-ink-faint">
                    An exercise the plan does not name goes in as extra work.
                  </p>
                </>
              ) : (
                <h2 className="font-display text-xl font-bold text-ink">
                  Pick an exercise
                </h2>
              )}
              <Input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find an exercise"
                autoComplete="off"
                enterKeyHint="search"
                className="mt-3"
                aria-label="Find an exercise"
              />
              <ul className="mt-1">
                {matches.map((row) => (
                  <li key={row.id} className="border-t border-line first:border-t-0">
                    <button
                      type="button"
                      onClick={() => pickExercise(row.id)}
                      className="press -mx-2 flex min-h-12 w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-field px-2 py-2 text-left text-ink hover:bg-surface-raised/60"
                    >
                      <span>{row.name}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {byExercise.has(row.id) ? (
                          <Tag tone="good">
                            {byExercise.get(row.id)!.length} logged
                          </Tag>
                        ) : null}
                        {row.highImpact ? <Tag tone="warn">Impact</Tag> : null}
                      </span>
                    </button>
                  </li>
                ))}
                {matches.length === 0 && query.trim() ? (
                  <li className="py-3 text-sm text-ink-faint">
                    Nothing matches. The directory is a closed set: add it in the
                    library first so it carries its attributes.
                  </li>
                ) : null}
              </ul>
            </>
          )}
        </Card>
      ) : null}

      <Card>
        <div className="flex items-center justify-between gap-3">
          <h2 className="eyebrow">
            Logged
            <span className="tnum ml-2 text-ink-muted">
              {entries.length} {entries.length === 1 ? "set" : "sets"}
              {contacts
                ? ` · ${contacts} ${contacts === 1 ? "contact" : "contacts"}`
                : ""}
            </span>
          </h2>
          {queued.length ? (
            <Tag tone="warn">{queued.length} unsent</Tag>
          ) : null}
        </div>

        {entries.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">
            Nothing yet. Sets save to this phone first, so a dead spot in the gym
            loses nothing: they send themselves when signal returns.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            {[...byExercise.entries()].map(([id, list]) => {
              const row = exercises.find((e) => e.id === id);
              return (
                <div key={id}>
                  <p className="font-medium text-ink">{row?.name ?? `Exercise ${id}`}</p>
                  <ul className="mt-1">
                    {list.map((entry) => (
                      <li
                        key={entry.key}
                        className={`flex min-h-11 items-center justify-between gap-3 border-t border-line first:border-t-0 ${
                          entry.pending ? "opacity-70" : ""
                        }`}
                      >
                        <span className="flex min-w-0 items-baseline gap-3">
                          <span className="numeral w-4 shrink-0 text-right text-ink-faint">
                            {entry.setIndex}
                          </span>
                          <span className="tnum text-sm text-ink">
                            {entry.reps !== null ? `${entry.reps} reps` : null}
                            {entry.holdSeconds !== null
                              ? `${entry.holdSeconds}s hold`
                              : null}
                            {entry.loadKg !== null
                              ? ` · ${round1(toDisplay(entry.loadKg, "mass", unitSystem))} ${massUnit}`
                              : null}
                            {entry.boxHeightCm !== null
                              ? ` · from ${round1(toDisplay(entry.boxHeightCm, "length", unitSystem))} ${lengthUnit}`
                              : null}
                            {entry.rpe !== null ? ` · RPE ${entry.rpe}` : null}
                            {entry.qualityRating !== null
                              ? ` · Q${entry.qualityRating}`
                              : null}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {plan.length && entry.prescribedSetId === null ? (
                            <Tag tone="cool">Extra</Tag>
                          ) : null}
                          {entry.pending ? <Tag>Unsent</Tag> : null}
                          <button
                            type="button"
                            onClick={() => removeEntry(entry)}
                            disabled={busy}
                            aria-label={`Remove set ${entry.setIndex}`}
                            className="press -my-1 -mr-2.5 flex size-11 items-center justify-center rounded-field text-ink-faint hover:text-bad disabled:opacity-40"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="size-4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth={2}
                              strokeLinecap="round"
                              aria-hidden="true"
                            >
                              <path d="M6 6l12 12M18 6L6 18" />
                            </svg>
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {!finished ? (
        <Card className="space-y-4">
          <h2 className="eyebrow">Finish</h2>
          <Field
            label="Session RPE"
            hint="How hard the whole session was, 1 to 10. Prescribed against actual is what the next week is calibrated on."
          >
            <Select
              value={sessionRpe}
              onChange={(event) => setSessionRpe(event.target.value)}
            >
              <option value="">Not rated</option>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((score) => (
                <option key={score} value={score}>
                  {score}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Notes" hint="Anything worth remembering. Read after the session to shape the next one.">
            <Textarea
              rows={3}
              value={sessionNotes}
              onChange={(event) => setSessionNotes(event.target.value)}
            />
          </Field>
          {queued.length ? (
            <p className="text-sm text-warn">
              {queued.length} {queued.length === 1 ? "set is" : "sets are"} still on
              this device.{" "}
              {queued.length === 1 ? "It sends itself" : "They send themselves"} when
              the connection returns; finish after that so the session closes over a
              complete log.
            </p>
          ) : null}
          <Button
            type="button"
            variant="secondary"
            onClick={finish}
            disabled={busy || queued.length > 0}
            className="w-full sm:w-auto"
          >
            {busy ? "Closing…" : "Finish session"}
          </Button>
        </Card>
      ) : null}
    </div>
  );
}
