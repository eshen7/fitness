import { ConnectionBanner } from "@/components/connection-banner";
import { Nav } from "@/components/nav";

/**
 * Every screen behind the passcode reads the database, and none of it is shared
 * with anyone: the answer to "what did I do today" is different a minute later.
 * Without this the whole group prerenders at build time and ships a snapshot of
 * whatever the database held while the build ran, which looks like a working app
 * right up to the moment it silently stops updating.
 */
export const dynamic = "force-dynamic";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // Content first in the DOM; the nav is visually last on mobile (bottom bar)
    // and moved to the left edge from `md` up.
    <div className="flex min-h-dvh flex-col md:flex-row">
      <main className="min-w-0 flex-1 px-4 pt-6 pb-8 md:order-last md:px-8 md:pt-8">
        {/* Outside the measure below so it can go full-bleed and stay stuck to
            the top of the viewport while a long screen scrolls under it. */}
        <ConnectionBanner />
        {/* Capped measure: prose and set rows both get unreadable at 1000px. */}
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>
      <Nav />
    </div>
  );
}
