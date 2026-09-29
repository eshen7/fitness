/**
 * What a tap on a tab shows while the server builds the screen. Every page here
 * is dynamic, so without this a navigation waits on the database with nothing
 * moving; with it the tab answers on the same frame. The blocks echo a page
 * header and its first panels, so the real content lands roughly where the
 * placeholder stood instead of shoving it down.
 */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Loading</span>
      <div aria-hidden="true" className="mb-7">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton mt-2.5 h-9 w-44" />
      </div>
      <div aria-hidden="true" className="skeleton h-40 rounded-box" />
      <div aria-hidden="true" className="skeleton h-24 rounded-box" />
      <div aria-hidden="true" className="skeleton h-24 rounded-box" />
    </div>
  );
}
