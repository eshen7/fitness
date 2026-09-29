"use client";

import { useMemo, useState, useTransition } from "react";
import { SubmitBar } from "@/components/submit-bar";
import { Card, Field, Input, Select, Textarea } from "@/components/ui";
import type { AthleteProfile } from "@/lib/ai/queries";
import { equipmentRule, type EquipmentNeeds } from "@/lib/engine/prefilter";
import {
  armSwingLabels,
  equipmentLabels,
  jumperTypeLabels,
  takeoffLegLabels,
  unitSystemLabels,
  WEEKDAYS,
} from "@/lib/labels";
import type { ActionResult } from "@/lib/log/schemas";
import { saveProfile } from "@/lib/profile/actions";
import {
  LENGTH_FIELDS,
  lengthText,
  MAX_GOALS,
  PROFILE_EQUIPMENT,
  type LengthField,
} from "@/lib/profile/form";
import {
  ARM_SWINGS,
  JUMPER_TYPES,
  TAKEOFF_LEGS,
  UNIT_SYSTEMS,
  type ArmSwing,
  type Equipment,
  type JumperType,
  type TakeoffLeg,
  type UnitSystem,
} from "@/lib/taxonomy";
import { displayUnit, toCanonical } from "@/lib/units";

/**
 * A length as the form holds it: the text in the field, and the centimetres it
 * stands for. Switching units rewrites the text from the centimetres rather than
 * from the text, so flipping to metric and back returns the number that was there
 * instead of one rounded twice.
 */
type LengthState = { text: string; cm: number | null };

const LENGTH_HINTS: Record<LengthField, string> = {
  heightCm: "Standing, without shoes.",
  reachCm: "Flat-footed, one arm up. Turns a touch height into a vertical.",
  femurCm: "Hip crease to knee joint. Longer limbs need more torque for the same force.",
  tibiaCm: "Knee joint to ankle bone.",
};

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {description ? (
        <p className="mt-1 text-xs text-ink-faint">{description}</p>
      ) : null}
      <div className="mt-4 space-y-4">{children}</div>
    </Card>
  );
}

/**
 * One of a few named options, as a row of buttons. A select hides two or three
 * choices behind a tap for no reason, and the current answer should be readable
 * without opening anything.
 */
function Segmented<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
  labelOf,
}: {
  label: string;
  hint?: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  labelOf: (value: T) => string;
}) {
  return (
    <div>
      <span className="mb-1.5 block text-sm font-medium text-ink-muted">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => {
          const selected = option === value;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option)}
              className={`min-h-11 rounded-field border px-2 py-2 text-sm font-medium transition ${
                selected
                  ? "border-accent bg-accent/15 text-accent"
                  : "border-line-strong bg-surface-sunken text-ink-muted hover:border-ink-faint"
              }`}
            >
              {labelOf(option)}
            </button>
          );
        })}
      </div>
      {hint ? <p className="mt-1.5 text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

export function ProfileForm({
  profile,
  unitSystem: initialSystem,
  exercises,
}: {
  profile: AthleteProfile;
  unitSystem: UnitSystem;
  exercises: EquipmentNeeds[];
}) {
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(initialSystem);
  const [lengths, setLengths] = useState<Record<LengthField, LengthState>>(() => {
    const entry = (cm: number | null) => ({ text: lengthText(cm, initialSystem), cm });
    return {
      heightCm: entry(profile.heightCm),
      reachCm: entry(profile.reachCm),
      femurCm: entry(profile.femurCm),
      tibiaCm: entry(profile.tibiaCm),
    };
  });
  const [trainingAge, setTrainingAge] = useState(
    profile.trainingAgeYears?.toString() ?? "",
  );
  const [takeoffLeg, setTakeoffLeg] = useState(profile.dominantTakeoffLeg as TakeoffLeg);
  const [jumperType, setJumperType] = useState(profile.jumperType as JumperType);
  const [armSwing, setArmSwing] = useState(profile.preferredArmSwing as ArmSwing);
  const [goals, setGoals] = useState(profile.goals.join("\n"));
  const [equipment, setEquipment] = useState<Equipment[]>([...profile.availableEquipment]);
  const [weekdays, setWeekdays] = useState<number[]>([...profile.trainableWeekdays]);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const lengthUnit = displayUnit("length", unitSystem);
  const error = (field: string) => (result?.ok ? undefined : result?.errors?.[field]);

  // The same rule the pre-filter applies, so the count is what the planner will
  // actually be offered rather than an estimate of it.
  const eligible = useMemo(() => {
    const gym = new Set(equipment);
    return exercises.filter((exercise) => equipmentRule(exercise, gym) === null).length;
  }, [equipment, exercises]);

  function switchUnits(next: UnitSystem) {
    setUnitSystem(next);
    setLengths((current) => {
      const converted = { ...current };
      for (const key of Object.keys(current) as LengthField[]) {
        const { cm } = current[key];
        if (cm !== null) converted[key] = { text: lengthText(cm, next), cm };
      }
      return converted;
    });
  }

  function typeLength(key: LengthField, text: string) {
    const value = Number(text);
    const cm =
      text.trim() && Number.isFinite(value) && value > 0
        ? toCanonical(value, "length", unitSystem)
        : null;
    setLengths((current) => ({ ...current, [key]: { text, cm } }));
  }

  function toggleEquipment(item: Equipment) {
    setEquipment((current) =>
      current.includes(item) ? current.filter((x) => x !== item) : [...current, item],
    );
  }

  function toggleWeekday(day: number) {
    setWeekdays((current) =>
      current.includes(day) ? current.filter((x) => x !== day) : [...current, day],
    );
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    start(async () => {
      const response = await saveProfile({
        displayName,
        unitSystem,
        heightCm: lengths.heightCm.text,
        reachCm: lengths.reachCm.text,
        femurCm: lengths.femurCm.text,
        tibiaCm: lengths.tibiaCm.text,
        trainingAgeYears: trainingAge,
        dominantTakeoffLeg: takeoffLeg,
        jumperType,
        preferredArmSwing: armSwing,
        goals,
        availableEquipment: equipment,
        trainableWeekdays: weekdays,
      });
      setResult(response);
    });
  }

  const allTicked = equipment.length === PROFILE_EQUIPMENT.length;

  return (
    <form onSubmit={submit} className="space-y-4 pb-4">
      <Section
        title="Training days"
        description="Sessions are only planned on these days. With none ticked, the planner picks its own."
      >
        <div>
          <div
            role="group"
            aria-label="Training days"
            className="grid grid-cols-7 gap-1.5"
          >
            {WEEKDAYS.map((day) => {
              const on = weekdays.includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  aria-pressed={on}
                  aria-label={day.long}
                  onClick={() => toggleWeekday(day.value)}
                  className={`h-11 rounded-field border text-sm font-medium transition ${
                    on
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-line-strong bg-surface-sunken text-ink-muted hover:border-ink-faint"
                  }`}
                >
                  {day.short}
                </button>
              );
            })}
          </div>
          {error("trainableWeekdays") ? (
            <p className="mt-1.5 text-xs text-bad" role="alert">
              {error("trainableWeekdays")}
            </p>
          ) : null}
        </div>
      </Section>

      <Section
        title="Equipment"
        description={
          <>
            What you can actually reach. The planner only offers exercises this covers,
            and nothing ticked means bodyweight only.{" "}
            <span className="tnum text-ink-muted">
              {eligible} of {exercises.length}
            </span>{" "}
            library exercises fit.
          </>
        }
      >
        <div>
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-ink-muted">
              <span className="tnum">{equipment.length}</span> of{" "}
              <span className="tnum">{PROFILE_EQUIPMENT.length}</span> ticked
            </span>
            <button
              type="button"
              onClick={() => setEquipment(allTicked ? [] : [...PROFILE_EQUIPMENT])}
              className="-my-2 inline-flex min-h-11 items-center text-sm font-medium text-accent underline-offset-2 hover:underline"
            >
              {allTicked ? "Clear all" : "Tick all"}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {PROFILE_EQUIPMENT.map((item) => (
              <label
                key={item}
                className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-field border border-line-strong bg-surface-sunken px-3 py-2 text-sm text-ink-muted has-checked:border-accent/50 has-checked:text-ink"
              >
                <input
                  type="checkbox"
                  checked={equipment.includes(item)}
                  onChange={() => toggleEquipment(item)}
                  className="size-4 shrink-0 accent-[var(--color-accent)]"
                />
                {equipmentLabels.of(item)}
              </label>
            ))}
          </div>
          {error("availableEquipment") ? (
            <p className="mt-1.5 text-xs text-bad" role="alert">
              {error("availableEquipment")}
            </p>
          ) : null}
        </div>
      </Section>

      <Section
        title="Goals"
        description="Read by the planner with every block it writes."
      >
        <Field
          label="What you are training for"
          hint={`One per line, up to ${MAX_GOALS}. Specific beats general: "Dunk off two feet" over "jump higher".`}
          error={error("goals")}
        >
          <Textarea rows={3} value={goals} onChange={(event) => setGoals(event.target.value)} />
        </Field>
      </Section>

      <Section
        title="Jumping"
        description="An experienced jumper's strategy is already set, so the planner works with it rather than trying to switch it."
      >
        <Segmented
          label="Jumper type"
          hint="Set by the free leg during knee drive: foot low and long is power, foot recovering toward the butt is speed."
          options={JUMPER_TYPES}
          value={jumperType}
          onChange={setJumperType}
          labelOf={jumperTypeLabels.of}
        />
        <Segmented
          label="Dominant takeoff leg"
          options={TAKEOFF_LEGS}
          value={takeoffLeg}
          onChange={setTakeoffLeg}
          labelOf={takeoffLegLabels.of}
        />
        <Field label="Preferred arm swing" error={error("preferredArmSwing")}>
          <Select
            value={armSwing}
            onChange={(event) => setArmSwing(event.target.value as ArmSwing)}
          >
            {ARM_SWINGS.map((option) => (
              <option key={option} value={option}>
                {armSwingLabels.of(option)}
              </option>
            ))}
          </Select>
        </Field>
      </Section>

      <Section
        title="Body"
        description="Stored in centimetres whichever units you pick, so switching never changes a measurement."
      >
        <Segmented
          label="Units"
          hint="What every form and chart in the app speaks."
          options={UNIT_SYSTEMS}
          value={unitSystem}
          onChange={switchUnits}
          labelOf={unitSystemLabels.of}
        />
        <div className="grid grid-cols-2 gap-4">
          {(Object.keys(LENGTH_FIELDS) as LengthField[]).map((key) => (
            <Field
              key={key}
              label={`${LENGTH_FIELDS[key].label} (${lengthUnit})`}
              hint={LENGTH_HINTS[key]}
              error={error(key)}
            >
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                value={lengths[key].text}
                onChange={(event) => typeLength(key, event.target.value)}
                className="tnum"
              />
            </Field>
          ))}
        </div>
      </Section>

      <Section title="You">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Training age (years)"
            hint="Years of structured training. Zero is a fine answer."
            error={error("trainingAgeYears")}
          >
            <Input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              max="60"
              value={trainingAge}
              onChange={(event) => setTrainingAge(event.target.value)}
              className="tnum"
            />
          </Field>
          <Field label="Name" hint="Optional." error={error("displayName")}>
            <Input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={80}
              autoComplete="name"
            />
          </Field>
        </div>
      </Section>

      <SubmitBar pending={pending} label="Save profile" result={result} />
    </form>
  );
}
