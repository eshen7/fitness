import type {
  CouplingClass,
  Equipment,
  ForceVelocity,
  Laterality,
  MesocycleType,
  MotorAbility,
  MovementPattern,
  MuscleGroup,
  Plane,
  SessionKind,
  TendonSite,
} from "@/lib/taxonomy";

/**
 * Human-readable names for the enum values.
 *
 * Kept in one place because the same value is shown in the library, in a session
 * card, and in a proposal diff, and three different spellings of `short_ssc`
 * would read as three different things. The database keeps the machine value; the
 * UI never invents its own.
 *
 * Each map is typed against its taxonomy union, so adding a value there without a
 * label here is a compile error rather than a raw `short_ssc` leaking to screen.
 */

function labels<T extends string>(map: Record<T, string>) {
  return {
    map,
    of: (value: T) => map[value] ?? value,
    entries: () => Object.entries(map) as [T, string][],
  };
}

export const muscleGroupLabels = labels<MuscleGroup>({
  posterior_chain: "Posterior chain",
  knee_extensors: "Knee extensors",
  lower_leg: "Lower leg",
  core: "Core",
  upper_push: "Upper push",
  upper_pull: "Upper pull",
  shoulders: "Shoulders",
  full_body: "Full body",
});

export const movementPatternLabels = labels<MovementPattern>({
  squat: "Squat",
  hinge: "Hinge",
  lunge: "Lunge",
  calf_raise: "Calf raise",
  jump_bilateral: "Jump, two foot",
  jump_unilateral: "Jump, one foot",
  bound: "Bound",
  hop: "Hop",
  depth_drop: "Depth drop",
  sprint: "Sprint",
  throw: "Throw",
  push_horizontal: "Push, horizontal",
  push_vertical: "Push, vertical",
  pull_horizontal: "Pull, horizontal",
  pull_vertical: "Pull, vertical",
  carry: "Carry",
  brace: "Brace",
  isometric_hold: "Isometric hold",
  mobility: "Mobility",
});

export const forceVelocityLabels = labels<ForceVelocity>({
  max_strength: "Max strength",
  speed_strength: "Speed strength",
  reactive: "Reactive",
  shock: "Shock method",
  non_specific: "Non-specific",
});

export const equipmentLabels = labels<Equipment>({
  none: "None",
  barbell: "Barbell",
  dumbbell: "Dumbbell",
  kettlebell: "Kettlebell",
  trap_bar: "Trap bar",
  machine: "Machine",
  cable: "Cable",
  band: "Band",
  bench: "Bench",
  rack: "Rack",
  box: "Box",
  hurdle: "Hurdle",
  sled: "Sled",
  medicine_ball: "Medicine ball",
  pullup_bar: "Pull-up bar",
  dip_station: "Dip station",
  ab_wheel: "Ab wheel",
  weight_vest: "Weight vest",
  landmine: "Landmine",
  gym_rings: "Rings",
});

export const lateralityLabels = labels<Laterality>({
  bilateral: "Bilateral",
  unilateral: "Unilateral",
  alternating: "Alternating",
});

export const planeLabels = labels<Plane>({
  sagittal: "Sagittal",
  frontal: "Frontal",
  transverse: "Transverse",
  multi: "Multi-plane",
});

export const couplingClassLabels = labels<CouplingClass>({
  short_ssc: "Short SSC",
  long_ssc: "Long SSC",
  non_classical: "Non-classical",
  not_plyometric: "Not plyometric",
});

export const tendonSiteLabels = labels<TendonSite>({
  patellar_left: "Patellar, left",
  patellar_right: "Patellar, right",
  achilles_left: "Achilles, left",
  achilles_right: "Achilles, right",
});

export const mesocycleTypeLabels = labels<MesocycleType>({
  accumulation: "Accumulation",
  transmutation: "Transmutation",
  realization: "Realization",
});

export const motorAbilityLabels = labels<MotorAbility>({
  max_strength: "Max strength",
  explosive_strength: "Explosive strength",
  reactive_strength: "Reactive strength",
  speed_strength: "Speed strength",
  rate_of_force_development: "Rate of force development",
  elastic_capacity: "Elastic capacity",
  strength_endurance: "Strength endurance",
  hypertrophy: "Hypertrophy",
  sprint_speed: "Sprint speed",
  work_capacity: "Work capacity",
  mobility: "Mobility",
});

export const sessionKindLabels = labels<SessionKind>({
  strength: "Strength",
  plyometric: "Plyometric",
  jump_technique: "Jump technique",
  sprint: "Sprint",
  mixed: "Mixed",
  tendon_protocol: "Tendon protocol",
  mobility: "Mobility",
  test: "Test",
  rest: "Rest",
});

/** 1 gentle to 5 severe, and 1 trivial to 5 highly technical. */
export const RATING_SCALE = [1, 2, 3, 4, 5] as const;
