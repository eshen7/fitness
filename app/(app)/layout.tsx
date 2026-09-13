import { Nav } from "@/components/nav";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // Content first in the DOM; the nav is visually last on mobile (bottom bar)
    // and moved to the left edge from `md` up.
    <div className="flex min-h-dvh flex-col md:flex-row">
      <main className="min-w-0 flex-1 px-4 pt-6 pb-8 md:order-last md:px-8 md:pt-8">
        {/* Capped measure: prose and set rows both get unreadable at 1000px. */}
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>
      <Nav />
    </div>
  );
}
