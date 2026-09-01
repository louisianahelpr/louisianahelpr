import { Skeleton } from "@/components/ui/skeleton";
import { JobCardSkeleton } from "@/components/ui/skeletons/JobCardSkeleton";

/**
 * Suspense fallback for the /browse guest route's lazy chunk.
 *
 * /browse is a top-level guest entry point with no persistent app shell
 * behind it on a cold direct load, so the generic (visually empty)
 * RouteSuspenseFallback left a blank parchment area for the ~2-3s the
 * DashboardGuest chunk took to resolve. This paints the page's actual
 * structure — header, toolbar, card list — with shared <Skeleton> bars so
 * the surface reads as "loading content" instead of "broken / blank".
 *
 * The card list uses the same shape-matched <JobCardSkeleton> the guest
 * dashboard renders while its jobs query loads, so the chunk-load skeleton
 * and the data-load skeleton are identical — the surface never re-jumps as
 * one hands off to the other.
 *
 * Deliberately self-contained (only shared <Skeleton>-based primitives +
 * divs) so it stays in the eager bundle and renders instantly, before the
 * route chunk arrives.
 */
const GuestBrowseSkeleton = () => (
  <div
    role="status"
    aria-live="polite"
    aria-busy="true"
    className="w-full min-h-screen bg-premium-page"
    data-testid="guest-browse-skeleton"
  >
    <span className="sr-only">Loading jobs…</span>

    {/* Header row — mirrors the guest dashboard's logo + Log in / Sign up. */}
    <div className="glass-header sticky top-0 z-50">
      <div className="mx-auto w-full max-w-3xl lg:max-w-5xl flex h-14 items-center justify-between px-5 lg:px-8">
        <Skeleton className="h-7 w-24 rounded-ds-md" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-16 rounded-ds-md" />
          <Skeleton className="h-9 w-20 rounded-ds-md" />
        </div>
      </div>
    </div>

    <div className="mx-auto w-full max-w-3xl lg:max-w-5xl px-4 pt-4 space-y-4">
      {/* Browse toolbar — title, search bar, category pill row. */}
      <div className="space-y-3">
        <Skeleton className="h-6 w-40 rounded-ds-md" />
        <Skeleton className="h-11 w-full rounded-ds-md" />
        <div className="flex gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-20 rounded-full" />
          ))}
        </div>
      </div>

      {/* Job card list — shape-matched to the real feed cards. */}
      <div className="space-y-2.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <JobCardSkeleton key={i} />
        ))}
      </div>
    </div>
  </div>
);

export default GuestBrowseSkeleton;
