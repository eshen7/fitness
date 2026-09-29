import Link from "next/link";
import { loadDirectory, loadProfile } from "@/lib/ai/queries";
import { getUnitSystem } from "@/lib/log/queries";
import { ProfileForm } from "./profile-form";

export const metadata = { title: "Profile" };

/**
 * The owner's profile: what the planner is allowed to assume.
 *
 * Equipment and training days come first because they decide what a generated
 * block can contain at all - an empty equipment list is read literally as
 * bodyweight only - while the body dimensions and the jumping style only colour
 * what the model is told.
 */
export default async function ProfilePage() {
  const [profile, unitSystem, { exercises }] = await Promise.all([
    loadProfile(),
    getUnitSystem(),
    loadDirectory(),
  ]);

  return (
    <>
      {/* The memory screen's header: reached from Plan, so the way back is above the title. */}
      <header className="mb-6">
        <Link
          href="/plan"
          className="-my-2 inline-flex min-h-11 items-center text-sm text-ink-faint hover:text-ink-muted"
        >
          ← Plan
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-ink">Profile</h1>
        <p className="mt-1 text-sm text-ink-faint">
          What the planner builds around: your gym, your week, and you.
        </p>
      </header>

      <ProfileForm
        profile={profile}
        unitSystem={unitSystem}
        exercises={exercises.map(({ id, name, available, equipment, equipmentAnyOf }) => ({
          id,
          name,
          available,
          equipment,
          equipmentAnyOf,
        }))}
      />
    </>
  );
}
