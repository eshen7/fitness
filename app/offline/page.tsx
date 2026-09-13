export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <h1 className="text-xl font-semibold text-ink">No connection</h1>
      <p className="mt-2 max-w-xs text-sm text-ink-faint">
        Anything you log while offline is kept on this device and sent as soon as
        signal comes back. Keep training.
      </p>
    </main>
  );
}
