export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-ink-faint">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </header>
  );
}

/**
 * Marks a route that exists so the shell is navigable but whose contents belong
 * to a later build phase. Explicit about which phase, so it is obvious this is a
 * placeholder rather than a broken page.
 */
export function Placeholder({
  phase,
  children,
}: {
  phase: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-box border border-line border-dashed bg-surface/40 p-6">
      <p className="text-xs font-medium tracking-wide text-accent uppercase">
        {phase}
      </p>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">{children}</p>
    </div>
  );
}
