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
        {/* The same wordmark as the sidebar: a lane line and the word. */}
        <h1 className="flex items-center gap-3 text-[2.75rem] leading-none font-bold tracking-[0.04em] text-ink uppercase">
          <span aria-hidden="true" className="h-9 w-1.5 -skew-x-12 rounded-[1px] bg-accent" />
          Training
        </h1>
        <p className="mt-3 text-sm text-ink-muted">Jump higher. Stay healthy doing it.</p>
        <UnlockForm next={next} />
      </div>
    </main>
  );
}
