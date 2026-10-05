import { Skeleton } from "@/components/ui/skeleton";
import { JobCardSkeleton } from "@/components/ui/skeletons/JobCardSkeleton";
import { EmptyStateSkeleton, useCachedListCount } from "@/components/ui/skeletons/EmptyStateSkeleton";
import PageHeader from "@/components/PageHeader";
import { isNativePlatform } from "@/lib/nativeInit";

/**
 * The guest feed's card grid. ONE definition, shared with DashboardGuest, so
 * this placeholder and the page it stands in for cannot lay their cards out
 * differently.
 */
export const GUEST_FEED_GRID_CLASS = "grid grid-cols-1 gap-list md:grid-cols-2 md:gap-4";

/**
 * The loading grid's reserve (Q169). At phone width a screenful, so the site
 * footer stays below the fold until the cards are in: six bones end ~560px
 * down and the footer used to paint under them and be shoved off-screen when
 * the list landed (CLS 0.042 at 375). From md the grid is two columns and a
 * screenful over-reserves (a short real list then pulled the footer UP,
 * CLS 0.049 at 1440), so the bones' own height is the reserve there.
 */
export const GUEST_FEED_RESERVE_CLASS = "min-h-screen md:min-h-0 content-start";

/**
 * Suspense fallback for the /browse guest route's lazy chunk (and the frame
 * DashboardGuest shows while it checks for a session).
 *
 * WEB paints the page's REAL frame (Q169, owner 2026-09-23: "most of the
 * skeletons are not even the page shape"). The web page is PublicHeaderPage:
 * the fixed marketing nav, its spacer, the shared PageHeader ("← Browse
 * Jobs"), then the card column. This used to draw a native-style header, a
 * search bar and a chip row the web page does not have; measured at 375 the
 * first bone sat at y=212 against the first card's y=148, 16px left of it and
 * 8px wider, with no title at all. Now the header is the real PageHeader, the
 * nav strip is the nav's own box, and the grid is the page's grid, so the
 * bones stand exactly where the cards will land. The nav's own component is
 * not used because it pulls the auth client into the eager bundle; its box
 * (glass-nav, h-[var(--public-nav-h)], safe-area top padding) and the layout's spacer are
 * restated from Navbar.tsx / PublicLayout.tsx.
 *
 * NATIVE keeps the PageScaffold-shaped placeholder below: that is the native
 * branch's shell (DashboardGuest's PageScaffold + DashboardTitleBar).
 *
 * Deliberately light (Skeleton, JobCardSkeleton, PageHeader) so it stays in
 * the eager bundle and renders before the route chunk arrives.
 */
/**
 * The guest feed's "Nothing today, neighbor." state as an outline, measured
 * at 375 on prod (2026-10-05): hidden eyebrow, 23px title, 3-line body
 * (63px), two 44px actions ("Notify Me When Work Lands", "Or Hire Someone
 * for a Job"). Shared by the chunk fallback and DashboardGuest's own loading
 * frame so the two are one picture (Q722). `className` is the wrapper the
 * real empty state sits in; `announce` makes the wrapper the live "Loading
 * jobs…" status (DashboardGuest's frame; the chunk fallback's root already is).
 */
export const GuestFeedEmptySkeleton = ({ className, announce, testId }: { className: string; announce?: boolean; testId?: string }) => (
  <div className={className} {...(announce ? { role: "status", "aria-live": "polite" as const, "aria-busy": true } : {})}>
    {announce && <span className="sr-only">Loading jobs…</span>}
    <EmptyStateSkeleton hiddenEyebrow titleH={23} bodyLines={3} bodyH={63} actionHeights={[44, 44]} testId={testId} />
  </div>
);

const GuestBrowseSkeleton = () => {
  // Data-aware (Q722): the guest feed the cache already holds. 0 = cold visit.
  const cachedJobs = useCachedListCount<unknown[]>(["guestDashboardJobs"], (d) => (Array.isArray(d) ? d.length : 0));
  const cold = cachedJobs === 0;
  if (isNativePlatform) {
    return (
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
      {/* Job card list — shape-matched to the real feed cards. */}
      {cold ? (
        <GuestFeedEmptySkeleton className="flex-1 min-h-full flex" />
      ) : (
        <div className="space-y-list">
          {Array.from({ length: 5 }).map((_, i) => (
            <JobCardSkeleton key={i} />
          ))}
        </div>
      )}
    </div>
  </div>

    );
  }
  // Outer box: the documented document-scroll wrapper (/browse is a
  // DOCUMENT_SCROLL_ROUTES route); inner box: PublicLayout's own root, so the
  // ground colour is the page's.
  return (
  <div className="min-h-screen bg-premium-page">
  <div
    role="status"
    aria-live="polite"
    aria-busy="true"
    className="min-h-screen page-warmth relative flex flex-col overflow-x-clip"
    data-testid="guest-browse-skeleton"
  >
    <span className="sr-only">Loading jobs…</span>
    <div aria-hidden className="mesh-gradient-global" />
    <div
      aria-hidden
      className="fixed top-0 left-0 right-0 z-50 glass-nav"
      style={{ paddingTop: "max(var(--safe-area-top, 0px), 0.25rem)" }}
    >
      <div className="w-full flex items-center justify-end gap-2 h-[var(--public-nav-h)] px-5 sm:px-8 lg:px-12">
        <Skeleton className="h-9 w-16 rounded-ds-md" />
        <Skeleton className="h-9 w-24 rounded-ds-md" />
      </div>
    </div>
    {/* PublicLayout's nav spacer, verbatim. src/test/listArrivesInOneWave
        compares the two strings, so this cannot drift from the page again. */}
    <div aria-hidden style={{ height: "calc(max(var(--safe-area-top, 0px), 0.25rem) + var(--public-nav-h))" }} />
    <PageHeader title="Browse Jobs" backTo="/" width="public" topInsetHandled />
    <div className="px-5 sm:px-8 lg:px-12 pb-16">
      <div className="mx-auto page-measure">
        {cold ? (
          // Cold visit (no feed in the cache): the empty state's outline, the
          // same picture DashboardGuest's own loading frame draws (Q722).
          <GuestFeedEmptySkeleton className="min-h-screen md:min-h-[50vh] flex" />
        ) : (
          <div className={`${GUEST_FEED_GRID_CLASS} ${GUEST_FEED_RESERVE_CLASS}`}>
            {Array.from({ length: 6 }).map((_, i) => (
              <JobCardSkeleton key={i} />
            ))}
          </div>
        )}
      </div>
    </div>
  </div>
  </div>
  );
};

export default GuestBrowseSkeleton;
