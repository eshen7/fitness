import { QueuedSets } from "@/app/offline/queued-sets";

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
      <h1 className="text-xl font-semibold text-ink">No connection</h1>
      <QueuedSets />
    </main>
  );
}
