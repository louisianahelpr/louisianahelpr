/**
 * LoadingHeading — the heading + status announcement a skeleton screen owes
 * its user.
 *
 * Every full-page skeleton in this app used to render pure shimmer: no
 * `<h1>`, no words. Sighted users at least see the page's shape; a screen
 * reader landed on an unlabelled document with nothing announced, and the
 * "exactly one <h1> per screen" invariant held only in the LOADED state.
 * The error-state sweep (e2e/happy-path/error-state-sweep.spec.ts) measures
 * that invariant in every state, which is how the gap surfaced: /my-posts,
 * /my-jobs and /dashboard all reported `h1Count: 0` while pending.
 *
 * Deliberately visually hidden. The skeleton IS the visible loading design;
 * this only restores the semantics the shimmer can't carry, so nothing about
 * the rendered page changes.
 *
 *   <LoadingHeading title="My Posts" message="Loading your posts…" />
 */
interface LoadingHeadingProps {
  /** The page's real title — becomes the screen's single `<h1>` while pending. */
  title: string;
  /**
   * Plain-language status, announced politely. Defaults to
   * `Loading {title}…`; pass a warmer sentence where one reads better.
   */
  message?: string;
}

export function LoadingHeading({ title, message }: LoadingHeadingProps) {
  return (
    <>
      <h1 className="sr-only">{title}</h1>
      <p className="sr-only" role="status" aria-live="polite">
        {message ?? `Loading ${title}…`}
      </p>
    </>
  );
}
