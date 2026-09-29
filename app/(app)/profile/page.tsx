import { PageHeader } from "@/components/page-header";
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
      <PageHeader
        title="Profile"
        back={{ href: "/plan", label: "Plan" }}
        subtitle="What the planner builds around: your gym, your week, and you."
      />

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
