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
import { Button, Card, Field, Input, Select, Tag, Textarea } from "@/components/ui";
import { deleteLoggedSet, finishSession } from "@/lib/log/actions";
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
import type { LoggedSetInput } from "@/lib/log/schemas";
import type {
  Equipment,
  MovementPattern,
  MuscleGroup,
  UnitSystem,
} from "@/lib/taxonomy";
import { displayUnit, round1, toCanonical, toDisplay } from "@/lib/units";

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

export type LoggerLastSet = {
  reps: number | null;
  loadKg: number | null;
  holdSeconds: number | null;
  boxHeightCm: number | null;
  rpe: number | null;
};

/** A set as the list renders it, from the server or still on the device. */
type Entry = {
  key: string;
  clientId: string | null;
  id: number | null;
  exerciseId: number;
  setIndex: number;
  reps: number | null;
  holdSeconds: number | null;
  loadKg: number | null;
  boxHeightCm: number | null;
  rpe: number | null;
  qualityRating: number | null;
  pending: boolean;
};

const EMPTY_FIELDS = {
  reps: "",
  load: "",
  hold: "",
  box: "",
  rpe: "",
  quality: null as number | null,
};

export function SetLogger({
  sessionId,
  exercises,
  serverSets,
  lastSets,
  unitSystem,
  finished,
}: {
  sessionId: number;
  exercises: LoggerExercise[];
  serverSets: LoggedSetRow[];
  lastSets: Record<number, LoggerLastSet>;
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
  const [exerciseId, setExerciseId] = useState<number | null>(null);
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const [sessionRpe, setSessionRpe] = useState("");
  const [sessionNotes, setSessionNotes] = useState("");
  const [busy, start] = useTransition();

  const massUnit = displayUnit("mass", unitSystem);
  const lengthUnit = displayUnit("length", unitSystem);
  const exercise = exercises.find((row) => row.id === exerciseId) ?? null;

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
    if (!text) return exercises.slice(0, 8);
    return exercises
      .filter((row) => row.name.toLowerCase().includes(text))
      .slice(0, 8);
  }, [exercises, query]);

  const entries = useMemo<Entry[]>(() => {
    const confirmed = new Set(
      serverSets.map((row) => row.clientId).filter(Boolean) as string[],
    );
    const fromServer: Entry[] = serverSets.map((row) => ({
      key: `db:${row.id}`,
      clientId: row.clientId,
      id: row.id,
      exerciseId: row.exerciseId,
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

  /** Picking an exercise prefills from this session, then from its last outing. */
  function pick(id: number) {
    setExerciseId(id);
    setQuery("");
    const inSession = byExercise.get(id)?.at(-1);
    const last: LoggerLastSet | undefined = inSession
      ? {
          reps: inSession.reps,
          loadKg: inSession.loadKg,
          holdSeconds: inSession.holdSeconds,
          boxHeightCm: inSession.boxHeightCm,
          rpe: inSession.rpe,
        }
      : lastSets[id];
    setFields({
      reps: last?.reps?.toString() ?? "",
      load:
        last?.loadKg == null
          ? ""
          : String(round1(toDisplay(last.loadKg, "mass", unitSystem))),
      hold: last?.holdSeconds?.toString() ?? "",
      box:
        last?.boxHeightCm == null
          ? ""
          : String(round1(toDisplay(last.boxHeightCm, "length", unitSystem))),
      // RPE is not carried over: it is how the set that just happened felt, and a
      // prefilled one would be a guess dressed up as a measurement.
      rpe: "",
      quality: null,
    });
  }

  function logSet() {
    if (!exercise) return;
    const number = (value: string) => {
      const parsed = Number(value.trim());
      return value.trim() && Number.isFinite(parsed) ? parsed : null;
    };
    const reps = number(fields.reps);
    const hold = number(fields.hold);
    if (reps === null && hold === null) {
      setFormError("A set needs either reps or a hold time.");
      return;
    }

    const load = number(fields.load);
    const box = number(fields.box);
    const item: LoggedSetInput = {
      clientId: crypto.randomUUID(),
      sessionId,
      exerciseId: exercise.id,
      setIndex: (byExercise.get(exercise.id)?.length ?? 0) + 1,
      reps,
      holdSeconds: hold,
      loadKg: load === null ? null : toCanonical(load, "mass", unitSystem),
      boxHeightCm: box === null ? null : toCanonical(box, "length", unitSystem),
      rpe: number(fields.rpe),
      qualityRating: fields.quality,
      performedAt: new Date().toISOString(),
    };

    enqueue(item);
    setFormError(null);
    setFields((current) => ({ ...current, rpe: "", quality: null }));
    flush();
  }

  function removeEntry(entry: Entry) {
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
        <div className="flex items-start justify-between gap-3 rounded-field border border-warn/40 bg-warn/10 px-3 py-2.5">
          <p role="status" className="text-sm text-warn">
            {notice}
          </p>
          <button
            type="button"
            onClick={() => {
              setFormError(null);
              acknowledgeQueue();
            }}
            className="-my-2 inline-flex min-h-11 shrink-0 items-center text-xs font-medium text-warn hover:underline"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {!finished ? (
        <Card>
          {exercise ? (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-display text-lg font-semibold text-ink">
                    {exercise.name}
                  </h2>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    Set {(byExercise.get(exercise.id)?.length ?? 0) + 1}
                    {exercise.highImpact ? " · counts as a contact" : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setExerciseId(null)}
                >
                  Change
                </Button>
              </div>

              {exercise.cues.length ? (
                <ul className="mt-3 space-y-1 text-xs text-ink-muted">
                  {exercise.cues.slice(0, 3).map((cue) => (
                    <li key={cue} className="flex gap-2">
                      <span aria-hidden="true" className="text-ink-faint">
                        ·
                      </span>
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
                      min="1"
                      max="500"
                      value={fields.reps}
                      onChange={(event) =>
                        setFields((f) => ({ ...f, reps: event.target.value }))
                      }
                      className="tnum h-14 text-lg"
                    />
                  </Field>
                ) : null}
                {showHold ? (
                  <Field label="Hold (s)">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      min="0"
                      value={fields.hold}
                      onChange={(event) =>
                        setFields((f) => ({ ...f, hold: event.target.value }))
                      }
                      className="tnum h-14 text-lg"
                    />
                  </Field>
                ) : null}
                <Field label={`Load (${massUnit})`}>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min="0"
                    placeholder={bodyweightOnly ? "bodyweight" : undefined}
                    value={fields.load}
                    onChange={(event) =>
                      setFields((f) => ({ ...f, load: event.target.value }))
                    }
                    className="tnum h-14 text-lg"
                  />
                </Field>
                {showBox ? (
                  <Field label={`Drop height (${lengthUnit})`}>
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      min="0"
                      value={fields.box}
                      onChange={(event) =>
                        setFields((f) => ({ ...f, box: event.target.value }))
                      }
                      className="tnum h-14 text-lg"
                    />
                  </Field>
                ) : null}
                <Field label="RPE">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    min="1"
                    max="10"
                    value={fields.rpe}
                    onChange={(event) =>
                      setFields((f) => ({ ...f, rpe: event.target.value }))
                    }
                    className="tnum h-14 text-lg"
                  />
                </Field>
              </div>

              <div className="mt-3">
                <span className="mb-1.5 block text-sm font-medium text-ink-muted">
                  Quality
                </span>
                {/* Only well-executed reps count toward adaptation, so a set that
                    fell apart is worth marking as one at the time. */}
                <div className="grid grid-cols-5 gap-1.5">
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
                      className={`tnum h-11 rounded-field border text-sm font-medium transition ${
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

              <Button
                type="button"
                onClick={logSet}
                className="mt-4 h-14 w-full text-base"
              >
                Log set
              </Button>
            </>
          ) : (
            <>
              <h2 className="text-sm font-semibold text-ink">Exercise</h2>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find an exercise"
                autoComplete="off"
                className="mt-3"
                aria-label="Find an exercise"
              />
              <ul className="mt-2 space-y-1.5">
                {matches.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => pick(row.id)}
                      className="flex min-h-11 w-full items-center justify-between gap-3 rounded-field border border-line-strong bg-surface-sunken px-3 py-2 text-left text-sm text-ink transition hover:border-ink-faint"
                    >
                      <span>{row.name}</span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {byExercise.has(row.id) ? (
                          <Tag tone="accent">
                            {byExercise.get(row.id)!.length}
                          </Tag>
                        ) : null}
                        {row.highImpact ? <Tag tone="warn">impact</Tag> : null}
                      </span>
                    </button>
                  </li>
                ))}
                {matches.length === 0 ? (
                  <li className="px-1 py-2 text-sm text-ink-faint">
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
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">
            Logged
            <span className="tnum ml-2 text-xs font-normal text-ink-faint">
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
            Nothing yet. Sets are saved on this device first, so they survive a dead
            spot in the gym and send themselves when signal returns.
          </p>
        ) : (
          <div className="mt-3 space-y-4">
            {[...byExercise.entries()].map(([id, list]) => {
              const row = exercises.find((e) => e.id === id);
              return (
                <div key={id}>
                  <p className="text-xs font-medium text-ink-muted">
                    {row?.name ?? `Exercise ${id}`}
                  </p>
                  <ul className="mt-1.5 divide-y divide-line/60">
                    {list.map((entry) => (
                      <li
                        key={entry.key}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <span className="tnum text-sm text-ink">
                          <span className="mr-2 text-xs text-ink-faint">
                            {entry.setIndex}
                          </span>
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
                        <span className="flex shrink-0 items-center gap-2">
                          {entry.pending ? <Tag>unsent</Tag> : null}
                          <button
                            type="button"
                            onClick={() => removeEntry(entry)}
                            disabled={busy}
                            aria-label={`Remove set ${entry.setIndex}`}
                            className="-my-1 flex size-11 items-center justify-center rounded-field text-ink-faint transition hover:text-bad disabled:opacity-40"
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
          <h2 className="text-sm font-semibold text-ink">Finish</h2>
          <Field
            label="Session RPE"
            hint="How hard the whole session was, 1 to 10. Prescribed minus actual is what the generator calibrates against."
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
          <Field label="Notes" hint="Read by the reflection job after the session.">
            <Textarea
              rows={3}
              value={sessionNotes}
              onChange={(event) => setSessionNotes(event.target.value)}
            />
          </Field>
          {queued.length ? (
            <p className="text-xs text-warn">
              {queued.length} {queued.length === 1 ? "set is" : "sets are"} still on
              this device.{" "}
              {queued.length === 1 ? "It sends itself" : "They send themselves"} when
              the connection returns; finish after that so the session closes over a
              complete log.
            </p>
          ) : null}
          <Button
            type="button"
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
