"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Input, Select } from "@/components/ui";
import {
  forceVelocityLabels,
  movementPatternLabels,
  muscleGroupLabels,
} from "@/lib/labels";

/**
 * Filters live in the URL rather than in component state, so a filtered view is
 * shareable, survives a reload, and comes back on the browser's back button
 * after opening an exercise.
 */
export function LibraryFilters({ resultCount }: { resultCount: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  function set(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    startTransition(() => {
      router.replace(next.size ? `${pathname}?${next}` : pathname, {
        scroll: false,
      });
    });
  }

  const q = params.get("q") ?? "";
  const active = ["q", "group", "pattern", "fv", "include"].filter((k) =>
    params.get(k),
  ).length;

  // The query box is typed into, so it holds its own value and pushes to the URL
  // on a short delay. A directly controlled input would show the previous
  // character until the server round trip landed, which drops fast typing.
  //
  // It initialises from the URL and is only ever reset from here, which is enough:
  // arriving from anywhere else, including the back button off an exercise page,
  // mounts this component fresh with the query already in hand.
  const [text, setText] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function search(value: string) {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => set("q", value), 200);
  }

  return (
    <div
      className={`space-y-2 transition-opacity ${pending ? "opacity-60" : ""}`}
      aria-busy={pending}
    >
      {/* `Input` rather than a hand-rolled copy of its classes, which had already
          drifted: the shared field is where the border weight is decided. */}
      <Input
        type="search"
        value={text}
        onChange={(event) => search(event.target.value)}
        placeholder="Search exercises"
        aria-label="Search exercises"
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select
          aria-label="Muscle group"
          value={params.get("group") ?? ""}
          onChange={(event) => set("group", event.target.value)}
        >
          <option value="">Any group</option>
          {muscleGroupLabels.entries().map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Movement pattern"
          value={params.get("pattern") ?? ""}
          onChange={(event) => set("pattern", event.target.value)}
        >
          <option value="">Any pattern</option>
          {movementPatternLabels.entries().map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Force velocity"
          value={params.get("fv") ?? ""}
          onChange={(event) => set("fv", event.target.value)}
        >
          <option value="">Any speed</option>
          {forceVelocityLabels.entries().map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Availability"
          value={params.get("include") ?? ""}
          onChange={(event) => set("include", event.target.value)}
        >
          <option value="">Available only</option>
          <option value="all">Include unavailable</option>
          <option value="unavailable">Unavailable only</option>
        </Select>
      </div>

      <p className="flex items-center gap-3 text-xs text-ink-faint">
        <span className="tnum">
          {resultCount} {resultCount === 1 ? "exercise" : "exercises"}
        </span>
        {active > 0 ? (
          <button
            type="button"
            onClick={() => {
              clearTimeout(timer.current);
              setText("");
              startTransition(() => router.replace(pathname));
            }}
            className="text-accent underline-offset-2 hover:underline"
          >
            Clear filters
          </button>
        ) : null}
      </p>
    </div>
  );
}
