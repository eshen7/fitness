import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { QUIET_LINK } from "@/components/ui";
import { createExercise } from "@/lib/exercises/actions";
import { ExerciseForm } from "../exercise-form";

export const metadata = { title: "Add exercise" };

export default function NewExercisePage() {
  return (
    <>
      <PageHeader
        title="Add exercise"
        subtitle="Tag it honestly: the tags decide which weeks can use it, what it costs the tendons and where it lands in a session."
      >
        <Link href="/library" className={QUIET_LINK}>
          Cancel
        </Link>
      </PageHeader>

      <ExerciseForm action={createExercise} submitLabel="Add to directory" />
    </>
  );
}
