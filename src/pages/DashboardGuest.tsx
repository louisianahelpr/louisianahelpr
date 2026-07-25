import { useEffect, useCallback, useState, useRef, lazy, Suspense } from "react";
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
import { queryKeys } from "@/lib/queryKeys";
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import type { EnrichedJob } from "@/components/dashboard/types";
import { usePageMeta } from "@/hooks/usePageMeta";
import HelprMark from "@/components/HelprMark";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
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
 * boundary — and the Browse toolbar itself is now the SAME component the
 * authenticated dashboard renders (BrowseTasksToolbar driven by
 * useDashboardFilters), so search, filters, category picker, the
 * active-filter chip row, and the list/map toggle behave identically.
 * SavedSearches is internally gated on a signed-in user, so it correctly
 * stays hidden for guests.
 */

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
  const { data: jobs = [], isLoading, isError, refetch } = useQuery({
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

      const rows = (rawJobs ?? []) as any[];
      if (rows.length === 0) return [];

      // Enrich with poster names + review stats so guests see the same
      // social-proof signals (avg rating, review count) authenticated users do.
      const posterIds = [...new Set(rows.map((j) => j.customer_id))];
      const [profilesRes, reviewStatsMap] = await Promise.all([
        supabase.rpc("get_safe_profiles", { user_ids: posterIds }),
        fetchRatingStats(posterIds),
      ]);

      const nameMap = new Map(
        profilesRes.data?.map((p) => [p.user_id, formatName(p.full_name)]) || [],
      );
      const avatarMap = new Map<string, string | null>(
        profilesRes.data?.map((p) => [p.user_id, p.avatar_url ?? null]) || [],
      );

      const now = new Date();
      return rows
        .filter((j) => !j.expires_at || new Date(j.expires_at) > now)
        .map((j) => {
          const isBoosted = !!j.boost_expires_at && new Date(j.boost_expires_at) > now;
          const stats = reviewStatsMap.get(j.customer_id);
          return {
            ...j,
            posterName: nameMap.get(j.customer_id) || "User",
            posterAvatarUrl: avatarMap.get(j.customer_id) ?? null,
            posterReviewCount: stats?.count ?? 0,
            posterAvgRating: stats?.avg ?? 0,
            posterCompletedJobs: 0,
            posterSubscriptionTier: null,
            isBoosted,
          } as EnrichedJob;
        });
    },
    staleTime: 60 * 1000,
  });

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
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session?.user) navigate("/dashboard", { replace: true });
    });
    return () => { cancelled = true; };
  }, [navigate]);

  // All interactive actions route to signup. Direct redirect matches what
  // authenticated users feel (immediate response, no toast noise).
  const requireSignup = useCallback(() => {
    navigate("/signup");
  }, [navigate]);

  // Read-only detail view for guests. Selecting a card opens the job's
  // public info; every action inside the dialog still routes to signup.
  const [detailJob, setDetailJob] = useState<EnrichedJob | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  // Mirror the open job into the URL (?job=<id>) so a jump to a sub-route from
  // inside the dialog — e.g. the Helper Pro "Learn more" → /subscription —
  // returns to the open job on Back, instead of dropping onto the bare feed.
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

  return (
    <PageScaffold
      maxWidth="narrow"
      animate
      header={
        /* Header — matches DashboardHeader's frosted-glass treatment, with
           guest-only Log in / Sign up actions in place of the menu/notif/etc. */
        <header className="glass-header sticky top-0 z-50 shrink-0">
        <div className="w-full flex h-14 items-center justify-between gap-2 px-5 lg:px-8 xl:px-12">
          <HelprMark to="/" size="md" />
          {/* Both header actions are deliberately un-filled so the only
              solid-green element on the guest dashboard is the bottom "+"
              FAB (the app-wide primary action, which gates guests to signup
              anyway). Log in is a plain text link; Get started is a quiet
              bark-tinted outline pill — clearly the CTA of the two, without
              competing with the FAB as a second filled-green target. */}
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate("/login")}
              className="text-ds-11 h-11 rounded-ds-md font-sans font-semibold"
              style={{ color: "hsl(var(--ink-deep) / 0.72)" }}
            >
              Log in
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/signup")}
              className="text-ds-11 h-11 rounded-ds-md font-sans font-semibold"
              style={{
                color: "hsl(var(--bark))",
                borderColor: "hsl(var(--bark) / 0.45)",
                background: "hsl(var(--bark) / 0.05)",
              }}
            >
              Get started
            </Button>
          </div>
        </div>
      </header>
      }
    >
            {/* Shared Browse toolbar — identical to the authenticated
                dashboard (title row, list/map toggle, expandable search with
                recent/popular suggestions, the unified FilterSheet, category
                picker row, and swipeable active-filter chips). `user={null}`
                keeps SavedSearches hidden for guests. */}
            <BrowseTasksToolbar
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
                    ctaLabel="Sign up to apply"
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
                    className="space-y-2.5"
                    style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px + 1rem)" }}
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
                                Show all locations
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={filters.clearFilters}
                              className="text-ds-11 font-semibold text-primary hover:underline btn-press"
                            >
                              Clear filters
                            </button>
                          )
                        ) : undefined
                      }
                    />
                    )}
                  </div>
                  );
                })() : (
                  <div
                    className="space-y-2.5 animate-in fade-in-0 duration-500"
                    style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px + 1rem)" }}
                  >
                    {filters.filteredJobs
                      .slice()
                      .sort((a, b) => Number(b.is_urgent ?? false) - Number(a.is_urgent ?? false))
                      .map((job, idx) => (
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
