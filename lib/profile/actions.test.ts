import { beforeEach, describe, expect, it, vi } from "vitest";
import { FIXTURE_PROFILE } from "@/lib/ai/fixtures";
import type { AthleteProfile } from "@/lib/ai/queries";

/**
 * The action end to end, short of Postgres: what it hands the driver, and that a
 * rejected submission hands it nothing. CI starts no database, so the driver is
 * a recorder standing in for one.
 */

const written: { values?: Record<string, unknown>; set?: Record<string, unknown>; target?: unknown }[] =
  [];
let stored: AthleteProfile;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/ai/queries", () => ({ loadProfile: vi.fn(async () => stored) }));

vi.mock("@/lib/db", async () => {
  const { schema } = await vi.importActual<typeof import("@/lib/db")>("@/lib/db");
  return {
    schema,
    getDb: () => ({
      insert: (table: unknown) => {
        expect(table).toBe(schema.profile);
        const entry: (typeof written)[number] = {};
        written.push(entry);
        return {
          values: (values: Record<string, unknown>) => {
            entry.values = values;
            return {
              onConflictDoUpdate: async (config: { target: unknown; set: Record<string, unknown> }) => {
                entry.target = config.target;
                entry.set = config.set;
              },
            };
          },
        };
      },
    }),
  };
});

const { saveProfile } = await import("./actions");
const { schema } = await import("@/lib/db");
const { revalidatePath } = await import("next/cache");

const BLANK: AthleteProfile = {
  displayName: null,
  heightCm: null,
  reachCm: null,
  femurCm: null,
  tibiaCm: null,
  trainingAgeYears: null,
  dominantTakeoffLeg: "unknown",
  jumperType: "unknown",
  preferredArmSwing: "unknown",
  goals: [],
  availableEquipment: [],
  trainableWeekdays: [],
};

function submission(overrides: Record<string, unknown> = {}) {
  return {
    displayName: "",
    unitSystem: "imperial",
    heightCm: "",
    reachCm: "",
    femurCm: "",
    tibiaCm: "",
    trainingAgeYears: "",
    dominantTakeoffLeg: "unknown",
    jumperType: "unknown",
    preferredArmSwing: "unknown",
    goals: "",
    availableEquipment: [],
    trainableWeekdays: [],
    ...overrides,
  };
}

beforeEach(() => {
  written.length = 0;
  stored = BLANK;
  vi.mocked(revalidatePath).mockClear();
});

describe("saveProfile", () => {
  it("upserts row 1, so a database the seed never ran on still gets a profile", async () => {
    const result = await saveProfile(
      submission({ availableEquipment: ["barbell", "rack"], trainableWeekdays: [1, 3, 5] }),
    );

    expect(result).toEqual({ ok: true, message: "Saved." });
    expect(written).toHaveLength(1);
    const [entry] = written;
    expect(entry.target).toBe(schema.profile.id);
    expect(entry.values).toMatchObject({
      id: 1,
      availableEquipment: ["barbell", "rack"],
      trainableWeekdays: [1, 3, 5],
    });
    expect(entry.set).toMatchObject({
      availableEquipment: ["barbell", "rack"],
      trainableWeekdays: [1, 3, 5],
    });
    expect(entry.set?.updatedAt).toBeInstanceOf(Date);
    // Never the key: the update half must not be able to move the row.
    expect(entry.set).not.toHaveProperty("id");
  });

  it("revalidates the whole app, since the unit system is read everywhere", async () => {
    await saveProfile(submission());
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("keeps a stored length the owner did not touch", async () => {
    stored = { ...FIXTURE_PROFILE, heightCm: 180 };
    // 180.0 cm is shown as 70.9 in, which converts back to 180.1 cm.
    await saveProfile(submission({ heightCm: "70.9", trainableWeekdays: [2] }));
    expect(written[0].values?.heightCm).toBe("180.0");
  });

  it("writes nothing for a rejected submission, and says which field is wrong", async () => {
    const result = await saveProfile(submission({ trainableWeekdays: [9] }));
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual({ "trainableWeekdays.0": "Weekdays are 0 to 6." });
    expect(written).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("rejects input that is not a profile at all", async () => {
    const result = await saveProfile("equipment=barbell");
    expect(result.ok).toBe(false);
    expect(written).toHaveLength(0);
  });
});
