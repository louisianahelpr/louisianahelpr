import { lazy, Suspense, type ReactNode } from "react";

// Its own chunk: the quotes reader and copy stay off every signed-in first screen while the switch is off.
const WantsQuotesFeed = lazy(() => import("@/components/quotes/WantsQuotesFeed").then(m => ({ default: m.WantsQuotesFeed })));

/** The Jobs feed slot: the job feed (children), or the Wants Quotes list while that lens is on. */
export function WantsQuotesSlot({ active, onShowAllJobs, children }: {
  active: boolean;
  onShowAllJobs: () => void;
  children: ReactNode;
}) {
  if (!active) return <>{children}</>;
  return (
    <Suspense fallback={<p role="status" className="px-4 pt-3 text-sm text-muted-foreground">Loading open requests…</p>}>
      <WantsQuotesFeed onShowAllJobs={onShowAllJobs} />
    </Suspense>
  );
}
