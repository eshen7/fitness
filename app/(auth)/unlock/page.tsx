import { UnlockForm } from "./unlock-form";

export const metadata = { title: "Unlock" };

export default async function UnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold text-ink">Training</h1>
        <p className="mt-1 text-sm text-ink-faint">
          Jump, athleticism, upper body.
        </p>
        <UnlockForm next={next} />
      </div>
    </main>
  );
}
