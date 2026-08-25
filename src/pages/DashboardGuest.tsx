import { useEffect, useCallback, useState, useRef, useMemo, lazy, Suspense } from "react";
import { usePersistedBrowseView } from "@/hooks/usePersistedBrowseView";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { Skeleton } from "@/components/ui/skeleton";
import { JobCardSkeleton } from "@/components/ui/skeletons/JobCardSkeleton";
import GuestBrowseSkeleton from "@/components/GuestBrowseSkeleton";
import JobCard from "@/components/dashboard/JobCard";
import { BrowseTasksToolbar } from "@/components/dashboard/BrowseTasksToolbar";
import { useDashboardFilters } from "@/hooks/useDashboardFilters";
// Lazy-load the map so the ~45KB leaflet bundle only ships when guests
// actually toggle to map view. List view stays cheap by default.
const BrowseMap = lazy(() =>
  import("@/components/BrowseMap").then((m) => ({ default: m.BrowseMap })),
);

// Guests may open a read-only job detail (Apple "preview before signup").
// Apply/contact/save/report inside the dialog stay gated to /signup.
const JobDetailDialog = lazy(() => import("@/components/dashboard/JobDetailDialog"));
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { fetchRatingStats } from "@/lib/reviewStats";
import { report } from "@/lib/errorLogger";
import { queryKeys } from "@/lib/queryKeys";
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import type { EnrichedJob } from "@/components/dashboard/types";
import { usePageMeta } from "@/hooks/usePageMeta";
import { DashboardTitleBar, TITLE_BAR_PADDING } from "@/components/dashboard/DashboardTitleBar";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { signupUrlFor } from "@/lib/jobIntent";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";

/**
 * DashboardGuest — read-only home shown to logged-out iOS visitors.
 *
 * Mirrors the authenticated /dashboard's two-card layout (greeting card
 * on top, Browse Tasks card extending to the viewport bottom) so guests
 * see the actual marketplace surface, not a marketing landing. Every
 * interactive action routes to /signup so Apple's "preview before
 * signup" requirement is met without exposing private data.
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
 * The chrome matches too: a brand row — emblem, then "Log in" / "Get started"
 * where Home puts its live-job pill and its bell. There is no app bar on
 * either screen. The one deliberate difference is that this row carries NO
 * search or filter icons (see the DashboardTitleBar comment below); Home does.
 */

/**
 * The guest feed's trailing controls — the signed-out counterpart to Home's
 * notification bell, occupying the same slot at the end of the title bar's
 * single row.
 *
 * "Log in" is a plain text control; "Get Started" is the SOLID primary button,
 * matching the marketing nav's signup CTA (Navbar.tsx) so the one conversion
 * action on the site looks the same wherever a guest meets it. That parity is
 * the point — /jobs and /browse are the two guest browse surfaces, and V9 of
 * the 2026-08-24 visual audit found them disagreeing about how to draw it.
 *
 * This button used to be a quiet bark-tinted OUTLINE pill, on the stated
 * grounds that "the only solid-green element on the guest feed stays the
 * bottom '+' FAB". That rationale was already void when it was written:
 * MobileNav.tsx returns null for guests (`if (isGuest) return null`), so the
 * guest feed has no dock and no FAB. There was nothing to avoid competing
 * with — the screen simply had no primary-weight target at all.
 *
 * The fill itself comes from the `default` variant's `btn-grad-primary` — a
 * background-IMAGE gradient, not a background-color, so `backgroundColor`
 * computes as transparent on this button and a probe that samples only that
 * property will wrongly report it unfilled. Check the gradient or the pixels.
 *
 * The inline parchment `color` is belt-and-braces on top of the variant's own
 * `!text-…` pinning, kept for the reason Navbar documents: the
 * text-primary-foreground → --parchment token chain has repeatedly resolved
 * dark-on-olive in the iOS WebView, and this is the guest surface that WebView
 * actually shows.
 *
 * These two are the entire conversion path of the screen, so they stay
 * full-width labelled controls at every breakpoint: never collapsed to icons,
 * never folded into an overflow menu, never below the 44px tap floor. What
 * yields first if the row ever runs out of room is the emblem (see
 * DashboardTitleBar) — a visitor can find the front door again; they cannot
 * guess a hidden CTA. With no search/filter icons sharing the row, the pair
 * has room to spare even at 320.
 *
 * Tight horizontal padding rather than the button default (`sm` = px-4): it is
 * the only slack in this row that costs nothing — the labels and the 44px tap
 * heights are untouched. "Log in" keeps `px-2` (a text control needs no box);
 * the solid "Get Started" takes `px-3` so its filled pill has room to read as
 * a button rather than a label with a background.
 *
 * Measured at 375 after the change: the title card is 335px wide, "Log in" is
 * 51px at x=190, and "Get Started" is 88px ending at x=334 — 21px of card
 * padding still to spare, and documentElement.scrollWidth === clientWidth.
 * Going solid cost the button 6px (82 → 88); the row absorbed it.
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
 * the original `gap-2.5` rhythm. Only at `md`+ does it widen to /jobs'
 * `gap-4`, which is the gutter a two-column layout needs.
 */
const FEED_GRID_CLASS = "grid grid-cols-1 gap-2.5 md:grid-cols-2 md:gap-4";

function GuestAuthActions({ onLogin, onSignup }: { onLogin: () => void; onSignup: () => void }) {
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        onClick={onLogin}
        className="text-ds-11 h-11 px-2 rounded-ds-md font-sans font-semibold"
        style={{ color: "hsl(var(--ink-deep) / 0.72)" }}
      >
        Log In
      </Button>
      <Button
        size="sm"
        onClick={onSignup}
        className="text-ds-11 h-11 px-3 rounded-ds-md font-sans font-semibold btn-press"
        style={{ color: "hsl(var(--parchment))" }}
      >
        Get Started
      </Button>
    </>
  );
}

const DashboardGuest = () => {
  const navigate = useNavigate();
  usePageMeta({
    title: "Browse Local Jobs — Helpr",
    description: "See what your Louisiana neighbors need help with right now. No account needed to look.",
    canonical: "https://www.louisianahelpr.com/browse",
    ogTitle: "Browse Local Jobs — Helpr",
    ogDescription: "Browse open jobs across Louisiana — cleaning, yard work, moving, errands, and more. No signup required to look.",
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
  // Split, the list paints as soon as it arrives and the rating badge appears
  // when it is ready. Every enrichment field is optional on EnrichedJob and the
  // card already hides the signals when they are absent.
  const {
    data: baseJobs = [],
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: queryKeys.dashboard.guestJobs(),
    queryFn: async (): Promise<EnrichedJob[]> => {
      const { data: rawJobs, error } = await supabase
        .from("open_jobs_browse")
        .select(
          "id, title, description, category, budget, date_needed, location, customer_id, status, created_at, updated_at, is_urgent, urgent_fee, is_flexible_schedule, is_recurring, is_group_job, helpers_needed, estimated_hours, special_requirements, photos, boosted_at, boost_expires_at, expires_at, start_time, recurrence_interval, recurrence_end_date, parent_job_id, payment_status, pricing_mode",
        )
        .neq("payment_status", "abandoned")
        .order("boosted_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;

      const now = new Date();
      return ((rawJobs ?? []) as any[])
        .filter((j) => !j.expires_at || new Date(j.expires_at) > now)
        .map((j) => ({
          ...j,
          isBoosted: !!j.boost_expires_at && new Date(j.boost_expires_at) > now,
        })) as EnrichedJob[];
    },
    staleTime: 60 * 1000,
  });

  const posterIds = useMemo(
    () => [...new Set(baseJobs.map((j) => j.customer_id))],
    [baseJobs],
  );

  // Social-proof enrichment. Runs only once the job list exists (it needs the
  // poster ids), and the feed never blocks on it.
  const { data: posterInfo } = useQuery({
    queryKey: queryKeys.dashboard.guestJobPosters(posterIds),
    enabled: posterIds.length > 0,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const [profilesRes, reviewStatsMap] = await Promise.all([
        supabase.rpc("get_safe_profiles", { user_ids: posterIds }),
        fetchRatingStats(posterIds),
      ]);

      // Enrichment only — deliberately non-fatal (a name lookup failure must
      // not blank the whole feed), but never silent: without this the poster
      // of every job quietly becomes "User" with nothing in error_logs to say
      // why. (CLAUDE.md: never drop the Supabase error.)
      if (profilesRes.error) {
        report(profilesRes.error, { tags: { source: "DashboardGuest.posterNames" } });
      }
      return {
        nameMap: new Map(
          profilesRes.data?.map((p) => [p.user_id, formatName(p.full_name)]) || [],
        ),
        avatarMap: new Map<string, string | null>(
          profilesRes.data?.map((p) => [p.user_id, p.avatar_url ?? null]) || [],
        ),
        reviewStatsMap,
      };
    },
  });

  const jobs = useMemo<EnrichedJob[]>(() => {
    if (!posterInfo) return baseJobs;
    return baseJobs.map((j) => {
      const stats = posterInfo.reviewStatsMap.get(j.customer_id);
      return {
        ...j,
        posterName: posterInfo.nameMap.get(j.customer_id) || "a neighbor",
        posterAvatarUrl: posterInfo.avatarMap.get(j.customer_id) ?? null,
        posterReviewCount: stats?.count ?? 0,
        posterAvgRating: stats?.avg ?? 0,
        posterCompletedJobs: 0,
        posterSubscriptionTier: null,
      };
    });
  }, [baseJobs, posterInfo]);

  // Same filter engine the authenticated dashboard uses — search, category,
  // budget range, location radius, expiry, sort. Guests pass no user /
  // profile / availability, and are `earlyAccessExempt` so the logged-out
  // preview shows every open job immediately (the 20-min no-tier delay is a
  // subscriber perk, not something to impose on prospects evaluating signup).
  const filters = useDashboardFilters({
    allJobs: jobs,
    userId: undefined,
    profile: null,
    helprTier: null,
    helperAvailability: [],
    earlyAccessExempt: true,
  });

  // Bounce already-authenticated users straight to the real dashboard so
  // they never see the guest surface (would confuse anyone with a session).
  //
  // The redirect alone was NOT enough, and the comment above was describing an
  // intent the code did not deliver: getSession() is async, so the guest
  // surface rendered first and only bounced a beat later. A signed-in user
  // watched the logged-out page — "browse as a guest", signup CTAs — flash up
  // before being thrown to the dashboard. Reported as "once I log in it should
  // never redirect me to the guest pages".
  //
  // So the render is now HELD until the session answer is in. Until then this
  // shows the same skeleton the route already uses as its Suspense fallback,
  // so a genuine guest sees no extra delay in kind — just the loading state
  // they were going to see anyway — while a signed-in user never sees the
  // guest surface at all.
  //
  // Fast-path: if localStorage has no auth token we are definitely a guest —
  // resolve synchronously without an async getSession() round-trip.
  // supabase-js always writes a key matching /^sb-.+-auth-token$/ on sign-in,
  // so an absent key is a reliable "no session" signal and avoids a hang when
  // getSession() stalls during internal initialisation.
  const [sessionChecked, setSessionChecked] = useState(() => {
    try {
      const hasStoredSession = Object.keys(localStorage).some(
        (k) => /^sb-.+-auth-token$/.test(k),
      );
      return !hasStoredSession;
    } catch {
      return false; // storage unavailable — fall through to async check
    }
  });
  useEffect(() => {
    if (sessionChecked) return; // already resolved via the synchronous pre-check
    let cancelled = false;
    // Belt-and-suspenders timeout: if getSession() stalls (e.g. during
    // supabase-js internal lock acquisition), show the guest surface rather
    // than hanging on the skeleton forever.
    const fallback = setTimeout(() => {
      if (!cancelled) setSessionChecked(true);
    }, 5_000);
    supabase.auth.getSession()
      .then(({ data }) => {
        clearTimeout(fallback);
        if (cancelled) return;
        if (data.session?.user) navigate("/dashboard", { replace: true });
        else setSessionChecked(true);
      })
      .catch(() => {
        clearTimeout(fallback);
        if (!cancelled) setSessionChecked(true);
      });
    return () => { cancelled = true; clearTimeout(fallback); };
  }, [navigate, sessionChecked]);

  // All interactive actions route to signup. Direct redirect matches what
  // authenticated users feel (immediate response, no toast noise).
  //
  // Every action worth gating happens ON a job, so the job rides along as
  // `?redirect=/jobs/<id>`. Signup persists it (see lib/jobIntent) and the
  // account-pending screen spends it the moment the account is admitted, so
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

  // Tapping a card sends a logged-out visitor to /signup rather than opening
  // the read-only preview — matching /jobs, the web guest feed (Jobs.tsx:173).
  // Owner decision 2026-08-22: the two guest browse surfaces had diverged
  // (native previewed the job, web walled it), and this is the direction they
  // were reconciled in.
  //
  // The preview dialog is NOT dead code: a direct link (/browse?job=<id>) still
  // restores it below, same as its /jobs sibling. Only the in-feed tap changed.
  //
  // The tapped job rides to signup as `?redirect=/jobs/<id>` and survives the
  // whole journey — including the email verification round-trip, which a query
  // param alone cannot (see lib/jobIntent for why it has to be storage).
  const openDetailJob = useCallback((job: EnrichedJob) => {
    navigate(signupUrlFor(`/jobs/${job.id}`));
  }, [navigate]);

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

  // Never paint the guest surface before we know whether there's a session.
  if (!sessionChecked) return <GuestBrowseSkeleton />;

  return (
    /* Bottom clearance uses the `pb-safe-nav` token, never a hardcoded 96px.
       The token resolves to
       `calc(safe-area-bottom + var(--bottom-nav-h, 96px) + 1rem)`, and
       MobileNav sets `--bottom-nav-h: 0px` (through the `no-bottom-nav` class)
       on every surface where the dock does not render. This is one of them:
       MobileNav.tsx:284 returns null for guests. Inlining the 96px opted out
       of that signal, so the guest feed reserved ~146px of clearance under the
       last card for a dock that is never there. */
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
          // No `actions` and no `searchBar` either, and that is the one place
          // this surface deliberately diverges from Home. A signed-out visitor
          // is not running a refined search; they are being shown that the
          // marketplace is alive. What this row has to carry is the emblem
          // plus the "Log in" / "Get started" pair — the screen's whole
          // purpose — and those come first. Adding search + filter icons put
          // four controls in one 375px row and spent the top of the page on
          // tools for a job nobody is here to do yet. Home keeps them; a
          // visitor who signs up gets them the moment they land on /dashboard.
          //
          // `searchBar` goes with them rather than being left as a dead
          // branch: the search icon was the only way to set `filters.searchOpen`
          // on this surface, so the slot could never fire again. `filters`
          // itself stays — the feed and its empty states are built on it.
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

            {/* Shared Browse toolbar — the category picker row and the
                active-filter chips. Search and the filter sheet are not
                reachable on this surface (no icons in the title bar), so in
                practice this renders the sr-only heading and nothing else
                until a filter is set some other way. `user={null}` keeps
                SavedSearches hidden for guests. */}
            <BrowseTasksToolbar
              titleSrOnly
              // `null` keeps SavedSearches out of the icon cluster — it is a
              // signed-in feature.
              filters={filters}
              user={null}
              helperAvailability={[]}
              view={view}
              setView={setView}
              onClearAllFilters={() => {
                const el = containerRef.current;
                if (el) el.scrollTo({ top: 0, behavior: "smooth" });
              }}
            />

            {/* Inner scroll area — list of cards or map. Map renders flush
                with no padding so its tiles can fill the panel edge-to-edge. */}
            {view === "map" ? (
              <div className="flex-1 min-h-0 overflow-hidden">
                <Suspense
                  fallback={
                    <div className="p-4">
                      <Skeleton className="h-full w-full rounded-2xl" />
                    </div>
                  }
                >
                  <BrowseMap
                    onJobAction={requireSignup}
                    ctaLabel="Sign Up to Apply"
                    filters={filters.mapFilter}
                    onClearFilters={filters.clearFilters}
                    // Guests have no tier, so they see the free-plan rate —
                    // the same assumption the guest JobCard below already
                    // makes, so list and map quote one number.
                    effectiveFee={TIER_PERKS.free.platformFeePercent}
                    emptyStateCta={{
                      label: "Get pinged when a job lands",
                      onClick: () => navigate("/signup"),
                    }}
                  />
                </Suspense>
              </div>
            ) : (
              <PullToRefreshWrapper
                ref={containerRef}
                pullDistance={pullDistance}
                refreshing={refreshing}
                isPulling={isPulling}
                canTrigger={canTrigger}
                className="flex-1 min-h-0 px-4 pt-3 pb-0"
              >
                {isLoading ? (
                  /* Loading feed — shape-matched JobCardSkeletons (the same
                     primitive the authenticated dashboard uses) so the cards
                     swap in without shifting the layout (no CLS). Reserves the
                     same vertical rhythm as the real list below. */
                  <div
                    role="status"
                    aria-live="polite"
                    aria-busy="true"
                    className={`${FEED_GRID_CLASS} pb-safe-nav`}
                  >
                    <span className="sr-only">Loading jobs…</span>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <JobCardSkeleton key={i} />
                    ))}
                  </div>
                ) : filters.filteredJobs.length === 0 ? (() => {
                  // Geo-aware empty copy mirrors the authed BrowseTasksFeed
                  // (#690 parity): when "Near me" is active and coords
                  // resolved, suggest a concrete wider radius rather than a
                  // generic "widen your parish".
                  const nearbyActive =
                    filters.nearbyMiles !== null && filters.locationFilter.startsWith("nearby:");
                  const currentMiles = filters.nearbyMiles ?? 0;
                  const nextMiles =
                    currentMiles < 5 ? 10 : currentMiles < 10 ? 25 : currentMiles < 25 ? 50 : 100;
                  return (
                  <div className="flex-1 min-h-full flex">
                    {isError ? (
                    <ErrorState
                      title="We couldn't load jobs."
                      body="Pull down to refresh, or tap Try again. If it sticks, our end is having a hiccup — not yours."
                      onRetry={() => refetch()}
                    />
                    ) : (
                    <EmptyState
                      icon={Search}
                      eyebrow={
                        filters.hasFilters
                          ? nearbyActive
                            ? "Nothing within range"
                            : "No matches"
                          : "All quiet — for now"
                      }
                      title={
                        filters.hasFilters
                          ? nearbyActive
                            ? `No jobs within ${currentMiles} mi of you.`
                            : "No jobs match your filters."
                          : "Nothing today, neighbor."
                      }
                      body={
                        filters.hasFilters
                          ? nearbyActive
                            ? `Try widening to ${nextMiles} mi, or clear the radius to see all open work across your parish.`
                            : "Try a different category, a wider time window, or clearing a filter."
                          : "New jobs post throughout the day — fresh work lands here as neighbors post it. Check back soon."
                      }
                      action={
                        filters.hasFilters ? (
                          nearbyActive ? (
                            <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
                              <button
                                type="button"
                                onClick={() => filters.setLocationFilter(`nearby:${nextMiles}`)}
                                className="text-ds-11 font-semibold text-primary hover:underline btn-press"
                              >
                                Widen to {nextMiles} mi
                              </button>
                              <button
                                type="button"
                                onClick={() => filters.setLocationFilter("")}
                                className="text-ds-11 font-semibold text-muted-foreground hover:underline btn-press"
                              >
                                Show All Locations
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={filters.clearFilters}
                              className="text-ds-11 font-semibold text-primary hover:underline btn-press"
                            >
                              Clear Filters
                            </button>
                          )
                        ) : (
                          /* Unfiltered empty state used to pass NO action, so a
                             visitor who landed on Browse before any jobs were
                             posted read "check back soon" and had nowhere to go
                             — a dead end at the exact moment they were most
                             curious. The signed-in version of this same state
                             offers two ways forward; the guest one offered
                             none.

                             Both routes lead to signup because both require an
                             account, but they are named for what the visitor
                             wants rather than for the gate: watching for work,
                             or hiring someone. */
                          <div className="flex flex-col items-center gap-2.5">
                            {/* `outline`, not the filled primary. This is an
                                EMPTY state — there is nothing here to act on,
                                so a full-weight green CTA slab was shouting
                                about an absence. The outline keeps the way
                                forward available without making "no jobs
                                today" look like the most important thing on
                                the screen. */}
                            <Button
                              variant="outline"
                              onClick={() => navigate("/signup")}
                              className="rounded-ds-md h-11 px-5 font-semibold"
                            >
                              Notify Me When Work Lands
                            </Button>
                            <button
                              type="button"
                              onClick={() => navigate("/signup")}
                              className="text-ds-11 font-semibold text-muted-foreground hover:underline btn-press"
                            >
                              Or Hire Someone for a Job
                            </button>
                          </div>
                        )
                      }
                    />
                    )}
                  </div>
                  );
                })() : (
                  <div
                    className={`${FEED_GRID_CLASS} animate-in fade-in-0 duration-500 pb-safe-nav`}
                  >
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
              </PullToRefreshWrapper>
            )}
      {detailJob && (
        <Suspense fallback={null}>
          <JobDetailDialog
            guest
            job={detailJob}
            effectiveFee={TIER_PERKS.free.platformFeePercent}
            onClose={closeDetailJob}
            onApply={requireSignup}
            onReport={requireSignup}
          />
        </Suspense>
      )}
    </PageScaffold>
  );
};

export default DashboardGuest;
