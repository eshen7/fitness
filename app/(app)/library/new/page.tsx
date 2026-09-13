import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { createExercise } from "@/lib/exercises/actions";
import { ExerciseForm } from "../exercise-form";

export const metadata = { title: "Add exercise" };

export default function NewExercisePage() {
  return (
    <>
      <PageHeader
        title="Add exercise"
        subtitle="Everything tagged here is read by the pre-filter, the normalizer, or the session ordering."
      >
        <Link href="/library" className="text-sm text-ink-faint hover:text-ink-muted">
          Cancel
        </Link>
      </PageHeader>

      <ExerciseForm action={createExercise} submitLabel="Add to directory" />
    </>
  );
}
