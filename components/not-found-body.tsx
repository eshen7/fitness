import { ButtonLink, EmptyState } from "./ui";

/**
 * Shared body for both not-found boundaries.
 *
 * Next ships a default 404 that is white with black text, which in a dark app
 * reads as a crash rather than as a missing page, so every boundary renders this
 * instead. The nested boundary under `(app)` keeps the nav; the root one, which
 * catches paths outside the group, has no nav to keep and links back by hand.
 */
export function NotFoundBody() {
  return (
    <>
      <EmptyState title="That page does not exist">
        The link may be stale, or the URL may have a typo in it. Exercise slugs
        are immutable once seeded, so a link that worked before still works.
      </EmptyState>
      <div className="mt-5 flex gap-2">
        <ButtonLink href="/today">Today</ButtonLink>
        <ButtonLink href="/library" variant="secondary">
          Library
        </ButtonLink>
      </div>
    </>
  );
}
