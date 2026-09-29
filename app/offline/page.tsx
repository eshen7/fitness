import { QueuedSets } from "@/app/offline/queued-sets";
import { buttonClass } from "@/components/ui";

export const metadata = { title: "Offline" };

/**
 * The service worker's navigation fallback.
 *
 * Public, and holding nothing from the database, for two reasons: behind the
 * passcode it is a redirect to `/unlock`, which cannot be cached at all, and the
 * moment it is needed is the moment nothing server-side can be reached anyway.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <h1 className="text-3xl leading-none font-bold text-ink uppercase">No connection</h1>
      <QueuedSets />
      {/* A link to the address it is on, so retrying needs no JavaScript. */}
      <a
        href=""
        className={buttonClass("primary", "mt-7 px-8", "lg")}
      >
        Try again
      </a>
    </main>
  );
}
