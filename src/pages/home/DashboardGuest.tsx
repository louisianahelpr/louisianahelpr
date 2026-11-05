import { useEffect, useCallback, useState, useRef, lazy, Suspense } from "react";
import { browseFilteredEmptyCopy } from "@/lib/browseEmptyCopy";
import { usePersistedBrowseView } from "@/hooks/usePersistedBrowseView";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { Skeleton } from "@/components/ui/skeleton";
import { JobCardSkeleton } from "@/components/ui/skeletons/JobCardSkeleton";
import GuestBrowseSkeleton, { GUEST_FEED_GRID_CLASS, GUEST_FEED_RESERVE_CLASS } from "@/components/GuestBrowseSkeleton";
import { GuestEmptyStateActions } from "@/components/dashboard/GuestEmptyStateActions";
import JobCard from "@/components/dashboard/JobCard";
import { BrowseTasksToolbar } from "@/components/dashboard/BrowseTasksToolbar";
import { useDashboardFilters } from "@/hooks/useDashboardFilters";
// Lazy-load the map so the map chunk (and Apple's MapKit JS script) only
// loads when guests actually toggle to map view. List view stays cheap.
const BrowseMap = lazy(() =>
  import("@/components/BrowseMap").then((m) => ({ default: m.BrowseMap })),
);

// Guests may open a job preview (Apple "preview before signup"): title, category, parish, budget (JOBS-29).
import { GuestJobPreview } from "@/components/dashboard/GuestJobPreview";
import { queryKeys } from "@/lib/queryKeys";
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import type { EnrichedJob } from "@/components/dashboard/types";
import { usePageMeta } from "@/hooks/usePageMeta";
import { PUBLIC_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { DashboardTitleBar, TITLE_BAR_PADDING } from "@/components/dashboard/DashboardTitleBar";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { signupUrlFor, NOTIFY_SIGNUP_URL } from "@/lib/jobIntent";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import { PublicHeaderPage } from "@/components/marketing/PublicHeaderPage";
import { isNativePlatform } from "@/lib/nativeInit";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { feedPhase } from "@/lib/feedPhase";
import { fetchGuestJobs, useBrowseShellHandoff } from "./fetchGuestJobs";
import { useArrivalGate } from "@/hooks/useArrivalGate";
import { GuestAuthActions } from "./GuestAuthActions";
import { useGuestPosterEnrichment } from "./useGuestPosterEnrichment";
import { useGuestSessionCheck } from "./useGuestSessionCheck";

/**
 * DashboardGuest — read-only "browse" view shown to logged-out visitors,
 * reached natively (the iOS/Android app's guest home) and on the web at
 * `/browse`.
 *
 * SHELL SPLITS ON `isNativePlatform`, the same axis PublicLayout itself
 * already uses for Legal/Help/Support (see PublicLayout.tsx's `useAppChrome`)
 * — not a new role-based branch, the established one:
 *
 *   - Native: the in-app dashboard chrome (PageScaffold's two-card layout —
 *     greeting card on top, Browse Tasks card extending to the viewport
 *     bottom) so a guest inside the app sees the actual marketplace surface,
 *     not marketing chrome it can't be part of yet.
 *   - Web: `PublicLayout` — the SAME shell as /legal, /help and /support
 *     (marketing Navbar with its own Log in / Get Started, and the site
 *     Footer with Company/Legal links). A signed-out visitor landing on
 *     /browse in a browser was getting the app's fixed-viewport dashboard
 *     frame with no footer and no way back to the rest of the site — the
 *     one guest-reachable page that didn't look like it belonged to the same
 *     site as Terms/Rules/Privacy.
 *
 * Every interactive action still routes to /signup so Apple's "preview
 * before signup" requirement is met without exposing private data.
 *
 * Lives parallel to Dashboard.tsx because Dashboard pervasively assumes
 * an authenticated user (Supabase calls scoped by user.id, approval
 * gating, stripe checks). Sharing layout, not logic, is the cleanest
 * boundary — and the Browse toolbar itself is the SAME component the
 * authenticated dashboard renders (BrowseTasksToolbar driven by
 * useDashboardFilters), so the category picker, the active-filter chip row
 * and the feed itself behave identically. SavedSearches is internally gated
 * on a signed-in user, so it correctly stays hidden for guests.
 *
 * On native, the chrome matches Home too: a brand row — emblem, then
 * "Log in" / "Join free" where Home puts its live-job pill and its bell.
 * There is no app bar. The one deliberate difference from Home is that this
 * row carries NO search or filter icons (see the DashboardTitleBar comment
 * below); Home does. On web, search/filters live in PageHeader's
 * `titleActions` instead — Navbar already owns the brand row and the auth
 * actions there.
 */

/**
 * The guest feed's card grid — ONE constant so the loading skeletons and the
 * loaded cards cannot drift out of shape (they did not share a class before,
 * and a skeleton that lays out differently from what replaces it is a
 * guaranteed layout shift the moment the query lands).
 *
 * Two columns from `md` up, matching /jobs (Jobs.tsx renders
 * `grid grid-cols-1 md:grid-cols-2 gap-4`, CARDS_PER_ROW = 2). V9 of the
 * 2026-08-24 visual audit: the two guest browse surfaces rendered the SAME
 * JobCard differently — /jobs in a 2-col grid, /browse as a full-width
 * single-column stack that stranded one narrow column in a wide panel on
 * desktop. The panel really is wide here: PageScaffold's `narrow` column is
 * `max-w-xl ds-desktop-wide`, and `ds-desktop-wide` lifts the cap to
 * `max-width: none` on web-desktop AND in the ≥768 tablet/native band
 * (index.css), so above `md` there was always room for two.
 *
 * `md`, not `lg`, is deliberate and is what makes the two surfaces actually
 * agree: /jobs is web-only (it redirects native visitors here — see the
 * Capacitor guard in Jobs.tsx), so 768–1023px is a band where BOTH are
 * reachable in a browser. Breaking to two columns at `lg` would have left
 * /jobs at two columns and /browse at one across that whole band — the same
 * finding, one breakpoint further along.
 *
 * The mobile rendering is untouched: below `md` this is a single column at
 * the shared 12px `gap-list` pitch (Q213a). Only at `md`+ does it widen to /jobs'
 * `gap-4`, which is the gutter a two-column layout needs.
 */
// Defined beside GuestBrowseSkeleton so the chunk-load placeholder lays its
// bones out on the very grid the cards land on (Q169).
const FEED_GRID_CLASS = GUEST_FEED_GRID_CLASS;

const DashboardGuest = () => {
  const navigate = useNavigate();
  // Title/description/canonical/og come from the table api/share.ts also
  // serves pre-JS (src/lib/publicPageMeta.mjs), so the two cannot drift.
  usePageMeta({
    ...PUBLIC_PAGE_META["/browse"],
    geoRegion: "US-LA",
    geoPlacename: "Louisiana",
  });

  const [view, setView] = usePersistedBrowseView("list");

  // Public open-jobs feed — no auth required (open_jobs_browse view is RLS-public).
  // TWO queries, deliberately, not one.
  //
  // This used to be a single queryFn that awaited the job list and THEN awaited
  // poster names + rating stats before resolving — so `isLoading` stayed true
  // for the whole chain and the feed showed a skeleton until every request had
  // landed. Measured on production: the page painted at 244ms, the job list
  // arrived at ~1.3s, and the cards did not appear until ~2.3s. That last
  // second bought nothing the card actually renders.
  //
  // JobCard reads exactly ONE enrichment field — the rating badge, and only
  // when reviewCount > 0. posterName/posterAvatarUrl are not rendered on this
  // surface at all. So the cards are complete without the second request, and
  // waiting on it was pure dead time.
  //
  // Split, the enrichment starts the moment the list lands, and the list waits
  // for it for at most ARRIVAL_CAP_MS (see `feedReady` below, Q169) rather than
  // for the whole chain. Every enrichment field is optional on EnrichedJob and
  // the card already hides the signals when they are absent.
  const {
    data: baseJobs = [],
    status: jobsStatus,
    fetchStatus: jobsFetchStatus,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.dashboard.guestJobs(),
    // The read, the prefetch hand-over and each crew's open-spot count (Q1409).
    queryFn: fetchGuestJobs,
    staleTime: 60 * 1000,
  });

  // Social-proof enrichment (poster names, avatars, tiers, ratings); the feed waits at most for it to settle.
  const { jobs, enrichmentSettled } = useGuestPosterEnrichment(baseJobs);

  // Q332: "is the list in" is the query's STATUS, never `!isLoading` — a query
  // paused offline is not loading and has no data (see feedPhase).
  const { online } = useOnlineStatus();
  const phase = feedPhase({ status: jobsStatus, fetchStatus: jobsFetchStatus }, online);
  const feedReady = useArrivalGate(phase === "ready" || phase === "error", enrichmentSettled);

  // Same filter engine the authenticated dashboard uses — search, category,
  // budget range, location radius, expiry, sort. Guests pass no user /
  // profile / availability.
  //
  // Guests now WAIT THE FULL 20 MINUTES, like any other free viewer.
  // This call used to pass `earlyAccessExempt: true`, on the reasoning that a
  // conversion preview shouldn't impose a subscriber perk's delay on someone
  // evaluating signup. That exemption was the bypass: Early Access is sold as
  // "see new jobs before non-subscribers", and a free member could sign out —
  // or just open a private window — and read the same early jobs for nothing.
  // A perk anyone can have by clicking Log out is not a perk. Owner decided on
  // 2026-09-01: guest 20 min, free 20 min, Basic 15, Pro 10, Elite 0.
  //
  // The flag is gone entirely rather than left passing `false`: it is enforced
  // server-side now (`public.early_access_cutoff()`), so a client flag could
  // not have re-granted the exemption anyway, and a no-op prop that reads as
  // live is exactly the failure mode this codebase keeps hitting.
  const filters = useDashboardFilters({
    allJobs: jobs,
    userId: undefined,
    profile: null,
    helprTier: null,
    helperAvailability: [],
    // A guest has no tier, so every card here renders at the free rate — the
    // pay sorts must use the same one or the order won't match the numbers.
    effectiveFee: TIER_PERKS.free.platformFeePercent,
  });

  // Held until the session answer is in; a signed-in visitor is sent to /home (useGuestSessionCheck).
  const sessionChecked = useGuestSessionCheck(navigate);

  // All interactive actions route to signup. Direct redirect matches what
  // authenticated users feel (immediate response, no toast noise).
  //
  // Every action worth gating happens ON a job, so the job rides along as
  // `?redirect=/jobs/<id>`. Signup persists it (see lib/jobIntent) and the
  // signup-pending screen spends it the moment the email is confirmed, so
  // the visitor lands back on the job that motivated them to sign up instead
  // of on a bare dashboard with no trace of it. `signupUrlFor` sanitizes the
  // path; the handful of call sites with no job in scope pass nothing and get
  // a plain `/signup`.
  const requireSignup = useCallback((jobId?: string) => {
    navigate(signupUrlFor(jobId ? `/jobs/${jobId}` : null));
  }, [navigate]);

  // Read-only detail view for guests. Selecting a card opens the job's
  // public info; every action inside the dialog still routes to signup.
  const [detailJob, setDetailJob] = useState<EnrichedJob | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // JOBS-29 (lead decision 2026-10-31, under the owner's 9-2 rule): tapping a card shows the job first, then
  // "Sign up to apply". The preview is GuestJobPreview: title, category, parish and budget only (no poster, address,
  // coordinates or description). This reverses the 2026-08-22 tap-straight-to-sign-up. The id rides in ?job= so a
  // back or a reload restores it (below), and Sign up carries the job as `?redirect=/jobs/<id>` (lib/jobIntent).
  const openDetailJob = useCallback((job: EnrichedJob) => {
    setDetailJob(job);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("job", job.id);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const closeDetailJob = useCallback(() => {
    setDetailJob(null);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("job");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Re-open the detail dialog from the URL on mount (?job=<id>). One-shot and
  // add-only: it restores the dialog after returning from /subscription, but
  // never clears the param (close handles that), so it can't race the writers
  // above. Retries until the guest feed has loaded.
  // Anchors the desktop-web filter popover to the Filters button, exactly as
  // Dashboard does — the sheet is rendered by BrowseTasksToolbar, a different
  // component, so the two are joined by this ref.
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  const restoredJobParam = useRef(false);
  useEffect(() => {
    if (restoredJobParam.current) return;
    const id = searchParams.get("job");
    if (!id) {
      restoredJobParam.current = true;
      return;
    }
    const match = jobs.find((j) => j.id === id);
    if (match) {
      setDetailJob(match);
      restoredJobParam.current = true;
    }
  }, [searchParams, jobs]);

  // Pull-to-refresh: re-runs the guestDashboardJobs query so swiping down on
  // the empty-state / list surface fetches fresh open_jobs_browse rows.
  // Mirrors the pattern used in the authenticated Dashboard at the page root.
  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } = usePullToRefresh({
    onRefresh: async () => { await refetch(); },
  });
  useBrowseShellHandoff(sessionChecked && (feedReady || phase === "offline-empty")); // PERF-SHELL (Q652)
  // Never paint the guest surface before we know whether there's a session.
  if (!sessionChecked) return <GuestBrowseSkeleton />;

  // Web (non-native) scrolls the document, so "clear filters" scrolls the
  // window instead of reaching into the native branch's internal
  // PullToRefreshWrapper container — there is no such container on web (see
  // the shell-split note atop this component).
  const scrollFeedToTop = () => {
    if (isNativePlatform) {
      const el = containerRef.current;
      if (el) el.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  // Shared Browse toolbar — the category picker row and the active-filter
  // chips. Search and the filter sheet open from `titleActions`/`actions`
  // in each shell's header below. `user={null}` keeps SavedSearches hidden
  // for guests. Identical on both shells; only the surrounding chrome
  // differs.
  const toolbar = (
    <BrowseTasksToolbar
      // Same anchor the Filters button carries, so the desktop-web popover
      // opens against it instead of floating.
      filtersAnchorRef={filtersButtonRef}
      titleSrOnly
      // WEB renders this page through `PublicHeaderPage title="Browse Jobs"`,
      // which draws a visible <h1>. Without this the toolbar's own sr-only
      // heading made a SECOND one on the same page. Native has no visible
      // title (PageScaffold's card is the H logo), so there the toolbar's
      // heading is the only one and must stay.
      renderHeading={isNativePlatform}
      filters={filters}
      user={null}
      helperAvailability={[]}
      view={view}
      setView={setView}
      onClearAllFilters={scrollFeedToTop}
    />
  );

  const mapView = (
    <Suspense
      fallback={
        <div className="p-4">
          <Skeleton className="h-full w-full rounded-2xl" />
        </div>
      }
    >
      <BrowseMap
        onJobAction={requireSignup}
        filters={filters.mapFilter}
        onClearFilters={filters.clearFilters}
        // Guests have no tier, so they see the free-plan rate — the same
        // assumption the guest JobCard below already makes, so list and map
        // quote one number.
        effectiveFee={TIER_PERKS.free.platformFeePercent}
        emptyStateCta={{
          label: "Get pinged when a job lands",
          onClick: () => navigate(NOTIFY_SIGNUP_URL),
        }}
      />
    </Suspense>
  );

  // `feedBottomClass` fills the slot `pb-safe-nav` filled before (dock
  // clearance for MobileNav, which never renders for guests — see the
  // original comment this replaced): on web the page ends in the real
  // Footer, not a bottom dock, so a small fixed gap stands in for it instead.
  const feedBottomClass = isNativePlatform ? "pb-safe-nav" : "pb-4";
  // Web: no screen-tall reserve (Q1312: it left a big blank gap above the
  // footer). The Footer waits for the feed instead (the page's footer prop is feedSettled):
  // a footer first painted under settled content is a new node, not a shift.
  const emptyWrapperClass = isNativePlatform ? "flex-1 min-h-full flex" : "flex";
  // Settled = whatever replaces the loading bones is on screen: the list, the
  // empty state, the error state or the offline notice.
  const feedSettled = feedReady || phase === "offline-empty";

  const feedList = (
    <>
      {phase === "offline-empty" ? (
        /* Offline with nothing loaded yet (Q332): say exactly that. Not the
           skeleton (nothing is coming) and not the empty state (we do not
           know that there are no jobs). The query resumes by itself when
           the connection returns (TanStack onlineManager). */
        <div className={emptyWrapperClass}>
          <EmptyState
            icon={WifiOff}
            title="You're offline."
            body="Open jobs will load here as soon as you're back online."
            action={
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Try again
              </Button>
            }
          />
        </div>
      ) : !feedReady ? (
        /* Loading feed — shape-matched JobCardSkeletons (the dashboard's
           primitive), so the cards swap in with no layout shift. A cold
           visit draws them too (owner at launch, 2026-10-07, Q1368: real
           jobs are public now, so an "empty" outline would flash first). */
        <div
          role="status"
          aria-live="polite"
          aria-busy="true"
          // Reserve (Q169): the same class the chunk-load skeleton uses; see
          // GUEST_FEED_RESERVE_CLASS for the measured reason.
          className={`${FEED_GRID_CLASS} ${feedBottomClass} ${GUEST_FEED_RESERVE_CLASS}`}
        >
          <span className="sr-only">Loading jobs…</span>
          {/* Six, GuestBrowseSkeleton's count: the chunk-load frame's picture. */}
          {Array.from({ length: 6 }).map((_, i) => (
            <JobCardSkeleton key={i} />
          ))}
        </div>
      ) : filters.filteredJobs.length === 0 ? (() => {
        // Geo-aware empty copy mirrors the authed BrowseTasksFeed
        // (#690 parity): when "Near me" is active and coords
        // resolved, suggest a concrete wider radius rather than a
        // generic "widen your parish".
        // Only a radius that RAN (A2-B5): before location is shared it keeps every job.
        const nearbyActive = filters.nearbyApplied;
        const currentMiles = filters.nearbyMiles ?? 0;
        const nextMiles =
          currentMiles < 5 ? 10 : currentMiles < 10 ? 25 : currentMiles < 25 ? 50 : 100;
        return (
        <div className={emptyWrapperClass}>
          {isError ? (
          <ErrorState
            title="We couldn't load jobs."
            body="Pull down to refresh, or tap Try again. If it sticks, our end is having a hiccup — not yours."
            onRetry={() => refetch()}
          />
          ) : (
          <EmptyState
            icon={Search}
            title={
              filters.hasFilters
                ? browseFilteredEmptyCopy({ searchQuery: filters.searchQuery, activeFilterCount: filters.activeFilterCount, nearbyActive, currentMiles, nextMiles }).title
                : "Nothing today, neighbor."
            }
            body={
              filters.hasFilters
                ? browseFilteredEmptyCopy({ searchQuery: filters.searchQuery, activeFilterCount: filters.activeFilterCount, nearbyActive, currentMiles, nextMiles }).body
                : "New jobs post throughout the day — fresh work lands here as neighbors post it. Check back soon."
            }
            action={
              <GuestEmptyStateActions
                hasFilters={filters.hasFilters}
                nearbyActive={nearbyActive}
                nextMiles={nextMiles}
                onWiden={() => filters.setLocationFilter(`nearby:${nextMiles}`)}
                onShowAllLocations={() => filters.setLocationFilter("")}
                onClearFilters={filters.clearFilters}
                clearLabel={browseFilteredEmptyCopy({ searchQuery: filters.searchQuery, activeFilterCount: filters.activeFilterCount, nearbyActive, currentMiles, nextMiles }).clearLabel}
                onNotify={() => navigate(NOTIFY_SIGNUP_URL)}
                onHire={() => navigate("/signup")}
              />
            }
          />
          )}
        </div>
        );
      })() : (
        // No fade-in (Q169; a 500ms fade left a blank frame). No reserve (Q1312):
        // the Footer mounts only once the feed has settled, so nothing is pulled up.
        <div className={`${FEED_GRID_CLASS} ${feedBottomClass}`}>
          {/* No re-sort here: useDashboardFilters already sorts
              urgent-first (then boosted etc.), so a second
              urgent-only sort was a redundant pass that could only
              ever scramble the tie-breaks below it. */}
          {filters.filteredJobs.map((job, idx) => (
            <JobCard
              key={job.id}
              job={job}
              variant="guest"
              effectiveFee={TIER_PERKS.free.platformFeePercent}
              currentUserId={undefined}
              showApply
              onApply={requireSignup}
              onReport={requireSignup}
              onSelect={openDetailJob}
              onToggleSave={requireSignup}
              index={idx}
            />
          ))}
        </div>
      )}
    </>
  );

  const detailDialog = detailJob && (
    <GuestJobPreview job={detailJob} onClose={closeDetailJob} onSignUp={requireSignup} />
  );

  if (isNativePlatform) {
    return (
      /* Bottom clearance uses the `pb-safe-nav` token, never a hardcoded 96px.
         The token resolves to
         `calc(safe-area-bottom + var(--bottom-nav-h, 96px) + 1rem)`, and
         MobileNav sets `--bottom-nav-h: 0px` (through the `no-bottom-nav`
         class) on every surface where the dock does not render. This is one
         of them: MobileNav.tsx:284 returns null for guests. Inlining the
         96px opted out of that signal, so the guest feed reserved ~146px of
         clearance under the last card for a dock that is never there. */
      <PageScaffold
        maxWidth="narrow"
        animate
        // No `header` — the guest feed carried a sticky app bar whose only job
        // was to state the brand and hold the two auth actions. Both now live in
        // the title card's single row below, exactly as Home's emblem + bell do,
        // so the screen is one band of chrome over a large title instead of a
        // bar over a card over a title. PageScaffold takes on the top safe-area
        // inset itself when no header is passed.
        titleCard={
          <DashboardTitleBar
            // The crest points at the marketing landing, not at this feed: a
            // signed-out visitor tapping it wants the front door.
            emblemTo="/"
            // No `status` — the live-job pill is a signed-in thing.
            //
            // NO SEARCH, NO FILTERS on the guest feed (owner, 2026-09-11:
            // "just remove the filters here and the search. its not needed").
            // This REVERSES the 2026-09-07 decision that put them here
            // ("/browse can have the filters"), and the reversal is deliberate
            // — the argument recorded for adding them was that the filter
            // sheet, the sort control and the List/Map toggle were already
            // mounted and unreachable without an entry point. That is true and
            // is no longer a reason: the owner's answer is that a signed-out
            // visitor does not need to refine a preview at all.
            //
            // Consequence, recorded rather than discovered later: the filter
            // sheet, the sort control and the List/Map toggle are once again
            // mounted with no way to open them on this surface, so `view` is
            // effectively pinned to "list" and the browse map is unreachable
            // for guests. That is the owner's call, the same one made on
            // 2026-08-19, not an oversight. Restoring any of it means putting
            // an entry point back in this row — not re-adding an inline chip
            // row.
            trailing={<GuestAuthActions onLogin={() => navigate("/login")} onSignup={() => navigate("/signup")} />}
          />
        }
        titleCardClassName={TITLE_BAR_PADDING}
      >
        {/* The inline List ⇄ Map chips were REMOVED here (owner, 2026-08-19:
            "Don't give the list or map option in the guest page like this.
            Remove it and move jobs up").

            Consequence, recorded deliberately: the guest title bar carries
            no filter icon, and the filter sheet is where this control lives
            on every other surface — so a signed-out visitor now has no route
            to the map at all, and `view` is effectively pinned to "list"
            here. That is the owner's call, not an oversight. Restoring map
            access means putting the filter icon back in the guest title bar
            (pass `actions` to DashboardTitleBar), NOT re-adding this row. */}
        {toolbar}

        {/* Inner scroll area — list of cards or map. Map renders flush
            with no padding so its tiles can fill the panel edge-to-edge. */}
        {view === "map" ? (
          <div className="flex-1 min-h-0 overflow-hidden">{mapView}</div>
        ) : (
          <PullToRefreshWrapper
            ref={containerRef}
            pullDistance={pullDistance}
            refreshing={refreshing}
            isPulling={isPulling}
            canTrigger={canTrigger}
            className="flex-1 min-h-0 px-4 pt-3 pb-0"
          >
            {feedList}
          </PullToRefreshWrapper>
        )}
        {detailDialog}
      </PageScaffold>
    );
  }

  // Web: the SAME shell as /legal, /help and /support — marketing Navbar
  // (which already renders Jobs | Log in · Join free for a signed-out visitor)
  // above, the site Footer (Company/Legal columns) below. See the shell-split
  // note atop this component for why this diverges from the native branch.
  // PublicHeaderPage, NOT a hand-rolled PublicLayout + PageHeader + padded
  // body. This first shipped as that hand-rolled skeleton, which is precisely
  // the thing PublicHeaderPage was extracted to stop anyone writing again
  // (owner, 2026-08-30: "legal help center and jobs should all be one
  // component and share the same shell") — and it drifted immediately and in
  // exactly the documented way: a stray `pt-3` on the feed wrapper stacked
  // onto PageHeader's own `pb-6`, so the title-to-content gap here was 36px
  // while /help and /legal held at 24. That is the SAME defect, to the class
  // of value, that PublicHeaderPage's own header comment records Legal and
  // Help Center growing with a stray `pt-4`. The header owns the full gap
  // above and below the title; a body under it must never add its own.
  return (
    // No `titleActions` — see the note on the native branch's DashboardTitleBar
    // above. The search and filter icons are gone from BOTH shells, because
    // this page is ONE surface: diverging them would give the phone-sized
    // website a control the native app does not have.
    <PublicHeaderPage
      title="Browse jobs"
      width="public"
      bottomPaddingClassName="pb-16"
      footer={feedSettled}
    >
      <div className="mx-auto page-measure">
        {toolbar}
        {view === "map" ? (
          <div className="h-[70vh] min-h-[420px] overflow-hidden rounded-2xl mt-3">
            {mapView}
          </div>
        ) : (
          feedList
        )}
      </div>
      {detailDialog}
    </PublicHeaderPage>
  );
};

export default DashboardGuest;
