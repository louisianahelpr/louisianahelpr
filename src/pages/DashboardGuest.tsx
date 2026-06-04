import { useEffect, useMemo, useState, useCallback, lazy, Suspense } from "react";
import { usePersistedBrowseView } from "@/hooks/usePersistedBrowseView";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Briefcase, List, Map as MapIcon, X, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { Skeleton } from "@/components/ui/skeleton";
import JobCard from "@/components/dashboard/JobCard";
// Live payout ticker (#87) — sits above the Browse Tasks header so
// guests see proof of real recent payouts before they start scanning
// the job feed. Lazy-loaded so guests on slow networks aren't blocked
// on the supabase chunk for the ticker before they see jobs.
const PayoutTicker = lazy(() => import("@/components/landing/PayoutTicker"));

// Lazy-load the map so the ~45KB leaflet bundle only ships when guests
// actually toggle to map view. List view stays cheap by default.
const BrowseMap = lazy(() =>
  import("@/components/BrowseMap").then((m) => ({ default: m.BrowseMap })),
);
import JobFilters, { categoryLabels } from "@/components/dashboard/JobFilters";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import { queryKeys } from "@/lib/queryKeys";
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
 * boundary.
 */

const DashboardGuest = () => {
  const navigate = useNavigate();
  usePageMeta({
    title: "Browse Local Jobs — Helpr",
    description: "See what your Louisiana neighbors need help with right now. No account needed to look.",
    canonical: "https://www.louisianahelpr.com/browse",
    ogTitle: "Browse Local Jobs — Helpr",
    ogDescription: "Browse open tasks across Louisiana — cleaning, yard work, moving, errands, and more. No signup required to look.",
    geoRegion: "US-LA",
    geoPlacename: "Louisiana",
  });

  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [maxBudget, setMaxBudget] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [sortBy, setSortBy] = useState("boosted");
  const [expiresWithin, setExpiresWithin] = useState("");
  const [boostedOnly, setBoostedOnly] = useState(false);
  // Guests don't have helper availability set up; the JobFilters panel
  // auto-hides the "match my availability" option when hasAvailability=false.
  const [view, setView] = usePersistedBrowseView("list");

  // Public open-jobs feed — no auth required (open_jobs_browse view is RLS-public).
  const { data: jobs = [], isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.dashboard.guestJobs(),
    queryFn: async (): Promise<EnrichedJob[]> => {
      const { data: rawJobs, error } = await supabase
        .from("open_jobs_browse")
        .select(
          "id, title, description, category, budget, date_needed, location, customer_id, status, created_at, updated_at, is_urgent, urgent_fee, is_flexible_schedule, is_recurring, is_group_job, helpers_needed, estimated_hours, special_requirements, photos, boosted_at, boost_expires_at, expires_at, start_time, recurrence_interval, recurrence_end_date, parent_job_id, payment_status",
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
      const [profilesRes, reviewsRes] = await Promise.all([
        supabase.rpc("get_safe_profiles", { user_ids: posterIds }),
        supabase
          .from("reviews")
          .select("reviewee_id, rating, jobs!inner(status)")
          .in("reviewee_id", posterIds)
          .neq("jobs.status", "cancelled"),
      ]);

      const nameMap = new Map(
        profilesRes.data?.map((p) => [p.user_id, formatName(p.full_name)]) || [],
      );
      const avatarMap = new Map<string, string | null>(
        profilesRes.data?.map((p) => [p.user_id, p.avatar_url ?? null]) || [],
      );
      const reviewStatsMap = new Map<string, { count: number; avg: number }>();
      for (const r of reviewsRes.data ?? []) {
        const existing = reviewStatsMap.get(r.reviewee_id);
        if (existing) {
          existing.count += 1;
          existing.avg = (existing.avg * (existing.count - 1) + r.rating) / existing.count;
        } else {
          reviewStatsMap.set(r.reviewee_id, { count: 1, avg: r.rating });
        }
      }

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

  // Bounce already-authenticated users straight to the real dashboard so
  // they never see the guest surface (would confuse anyone with a session).
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session?.user) navigate("/dashboard", { replace: true });
    });
    return () => { cancelled = true; };
  }, [navigate]);

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const loc = locationFilter.trim().toLowerCase();
    // Number.parseFloat returns NaN on bad input — guard so the budget
    // filter falls through cleanly instead of silently never matching.
    const parsedBudget = maxBudget.trim() ? Number.parseFloat(maxBudget) : NaN;
    const maxBudgetNum = Number.isFinite(parsedBudget) ? parsedBudget : null;
    const parsedExpires = expiresWithin ? Number.parseInt(expiresWithin, 10) : NaN;
    const expiresMs = Number.isFinite(parsedExpires) ? parsedExpires * 60 * 60 * 1000 : null;
    const now = Date.now();

    const list = jobs.filter((j) => {
      if (selectedCategory && j.category !== selectedCategory) return false;
      if (q && !`${j.title} ${j.location} ${j.description}`.toLowerCase().includes(q)) return false;
      if (loc && !(j.location || "").toLowerCase().includes(loc)) return false;
      if (maxBudgetNum !== null && j.budget > maxBudgetNum) return false;
      if (boostedOnly && !j.isBoosted) return false;
      if (expiresMs && j.expires_at && new Date(j.expires_at).getTime() - now > expiresMs) return false;
      return true;
    });

    // Sort by selected mode — matches authed Dashboard's options.
    const sorted = [...list];
    switch (sortBy) {
      case "newest":
        sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        break;
      case "budget-high":
        sorted.sort((a, b) => b.budget - a.budget);
        break;
      case "budget-low":
        sorted.sort((a, b) => a.budget - b.budget);
        break;
      case "boosted":
      default:
        // Already in boosted-first order from the query
        break;
    }
    return sorted;
  }, [jobs, search, selectedCategory, locationFilter, maxBudget, boostedOnly, expiresWithin, sortBy]);

  // All interactive actions route to signup. Direct redirect matches what
  // authenticated users feel (immediate response, no toast noise).
  const requireSignup = useCallback(() => {
    navigate("/signup");
  }, [navigate]);

  // Count any active filter so the badge on the Filters icon + the
  // "Filtered" eyebrow + the empty-state "Clear filters" action all
  // stay in sync with the full filter surface.
  const activeFilterCount =
    (selectedCategory ? 1 : 0) +
    (search.trim() ? 1 : 0) +
    (maxBudget.trim() ? 1 : 0) +
    (locationFilter.trim() ? 1 : 0) +
    (expiresWithin ? 1 : 0) +
    (boostedOnly ? 1 : 0) +
    (sortBy !== "boosted" ? 1 : 0);
  const hasFilters = activeFilterCount > 0;

  const clearAllFilters = useCallback(() => {
    setSelectedCategory(null);
    setSearch("");
    setMaxBudget("");
    setLocationFilter("");
    setExpiresWithin("");
    setBoostedOnly(false);
    setSortBy("boosted");
  }, []);

  // Pull-to-refresh: re-runs the guestDashboardJobs query so swiping down on
  // the Quiet today / list surface fetches fresh open_jobs_browse rows.
  // Mirrors the pattern used in the authenticated Dashboard at the page root.
  const { containerRef, pullDistance, refreshing, isPulling, canTrigger } = usePullToRefresh({
    onRefresh: async () => { await refetch(); },
  });

  return (
    <PageScaffold
      maxWidth="narrow"
      animate
      titleCardClassName="!py-2.5 lg:!py-3"
      header={
        /* Header — matches DashboardHeader's frosted-glass treatment, with
           guest-only Log in / Sign up actions in place of the menu/notif/etc. */
        <header className="glass-header sticky top-0 z-50 shrink-0">
        <div className="w-full flex h-14 items-center justify-between gap-2 px-5 lg:px-8 xl:px-12">
          <HelprMark to="/" size="md" />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate("/login")}
              className="text-ds-11 h-11 rounded-ds-md font-sans font-semibold"
              style={{ color: "hsl(var(--ink-deep))" }}
            >
              Log in
            </Button>
            <Button
              variant="bark"
              size="sm"
              onClick={() => navigate("/signup")}
              className="text-ds-11 h-11 rounded-ds-md"
            >
              Sign up
            </Button>
          </div>
        </div>
      </header>
      }
      titleCard={
        // Compact hero strip — a single inline headline. The in-card
        // "Sign up free" CTA and "Already on Helpr? Log in" link were
        // removed 2026-05-19 because the page header (rendered above)
        // already shows both `Log in` and `Sign up` buttons in the corner.
        // Duplicating them here doubled the card's height and dominated
        // the guest dashboard without adding any new conversion path.
        //
        // The "A first look" eyebrow and the "Post a task in a minute…"
        // subline were dropped 2026-05-20 (TestFlight 19 feedback: "the
        // top bar that says like need help is still too big"). The
        // subline was redundant with the browse feed rendered directly
        // below the card; the eyebrow consumed a full line for no real
        // signal. If A/B testing later shows the corner CTAs are missed
        // by guest users, reintroduce a single inline link rather than
        // the full bark Button + secondary text-link stack.
        //
        // 2026-06-03: an inline "Sign up free" link was tried here, but it
        // sat directly under the header's own "Sign up" button and read as a
        // duplicate CTA. Removed again — the header owns the sign-up action;
        // this strip stays a single quiet headline that frames the feed.
        <div className="min-w-0">
          <h1
            className="leading-[1.12]"
            style={{
              fontFamily: '"Bodoni Moda", Georgia, serif',
              fontStyle: "italic",
              fontWeight: 600,
              fontSize: "clamp(0.95rem, 0.8vw + 0.35rem, 1.05rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.022em",
            }}
          >
            Need help, or want to{" "}
            <em
              className="signature"
              style={{ fontStyle: "normal", color: "hsl(var(--burnt-sienna))" }}
            >
              earn
            </em>
            ?
          </h1>
        </div>
      }
    >
            {/* Payout ticker (#87) — thin social-proof strip above the
                Browse Tasks header. Hides itself silently when there's
                no recent payout data or the public RPC isn't deployed
                yet, so a quiet platform shows zero visual weight here
                instead of an empty placeholder strip. */}
            <div className="shrink-0 px-4 pt-1 empty:pt-0">
              <Suspense fallback={null}>
                <PayoutTicker />
              </Suspense>
            </div>

            {/* Header row — title block + view toggle + search button.
                Top padding trimmed so the hero card and this "Browse Tasks"
                block read as one tight unit (the empty payout-ticker wrapper
                above collapses via `empty:pt-0` when no payout data shows). */}
            <div
              className="shrink-0 flex items-center justify-between gap-3 px-4 pt-1.5 pb-2.5"
              style={{ borderBottom: searchOpen ? "none" : "1px solid hsl(var(--olivewood) / 0.1)" }}
            >
              <div className="flex flex-col leading-none min-w-0">
                <span
                  className="font-serif italic tracking-[0.16em] uppercase text-[11px]"
                  style={{ color: "hsl(var(--burnt-sienna) / 0.78)" }}
                >
                  {hasFilters
                    ? `Filtered · ${activeFilterCount} active`
                    : `${filteredJobs.length} ${filteredJobs.length === 1 ? "task" : "tasks"} available`}
                </span>
                <h2
                  className="font-display italic font-bold leading-tight mt-0.5"
                  style={{
                    fontSize: "1.3rem",
                    color: "hsl(var(--ink-deep))",
                    letterSpacing: "-0.018em",
                  }}
                >
                  {hasFilters ? "Filtered Results" : "Browse Tasks"}
                </h2>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {/* List ⇄ Map toggle — single icon that flips to the
                    opposite view on tap. Collapses the previous two-button
                    pill into one tap target so the header reads as three
                    equally-weighted icon buttons (view / search / filter). */}
                <button
                  type="button"
                  onClick={() => setView(view === "list" ? "map" : "list")}
                  aria-label={view === "list" ? "Switch to map view" : "Switch to list view"}
                  className="h-8 w-8 rounded-ds-md flex items-center justify-center btn-press transition text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                >
                  {view === "list" ? <MapIcon className="w-4 h-4" /> : <List className="w-4 h-4" />}
                </button>
                {view === "list" && (
                  <>
                    <button
                      type="button"
                      onClick={() => { setSearchOpen(!searchOpen); if (filtersOpen) setFiltersOpen(false); }}
                      aria-label="Search jobs"
                      aria-expanded={searchOpen}
                      className={`h-8 w-8 rounded-ds-md flex items-center justify-center btn-press transition ${
                        searchOpen || search
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                      }`}
                    >
                      <Search className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => { setFiltersOpen(!filtersOpen); if (searchOpen) setSearchOpen(false); }}
                      aria-label={activeFilterCount ? `Filters (${activeFilterCount} active)` : "Filters"}
                      aria-expanded={filtersOpen}
                      className={`h-8 w-8 rounded-ds-md flex items-center justify-center btn-press transition relative ${
                        filtersOpen || activeFilterCount > 0
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                      }`}
                    >
                      <SlidersHorizontal className="w-4 h-4" />
                      {activeFilterCount > 0 && (
                        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-ds-9 font-bold flex items-center justify-center">
                          {activeFilterCount}
                        </span>
                      )}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Expandable search bar — same pattern as Dashboard. */}
            {searchOpen && view === "list" && (
              <div
                className="shrink-0 overflow-hidden animate-in fade-in slide-in-from-top-1 duration-200"
                style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.1)" }}
              >
                <div className="relative px-4 py-3">
                  <Search className="absolute left-7 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    autoFocus
                    type="search"
                    aria-label="Search jobs"
                    placeholder="Search jobs by title, location…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-10 pr-9 h-10 text-ds-13 rounded-ds-md border border-border/50 bg-muted/30 focus:bg-background focus:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/10 transition-all placeholder:text-muted-foreground"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      aria-label="Clear search"
                      className="absolute right-7 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground btn-press"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Expandable filters panel — full JobFilters component so
                guests see the same Category + Budget + Location + Sort +
                Expires-Within + Boosted controls as the authenticated
                /dashboard. matchAvailability is hidden via hasAvailability=false
                since guests have no helper-availability config. */}
            {filtersOpen && view === "list" && (
              <div
                className="shrink-0 overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-200"
                data-allow-scroll="true"
                style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.1)", maxHeight: "50vh" }}
              >
                <JobFilters
                  searchQuery={search}
                  setSearchQuery={setSearch}
                  selectedCategory={selectedCategory}
                  setSelectedCategory={setSelectedCategory}
                  maxBudget={maxBudget}
                  setMaxBudget={setMaxBudget}
                  locationFilter={locationFilter}
                  setLocationFilter={setLocationFilter}
                  sortBy={sortBy}
                  setSortBy={setSortBy}
                  filtersOpen={true}
                  setFiltersOpen={setFiltersOpen}
                  expiresWithin={expiresWithin}
                  setExpiresWithin={setExpiresWithin}
                  matchAvailability={false}
                  setMatchAvailability={() => {}}
                  hasAvailability={false}
                  boostedOnly={boostedOnly}
                  setBoostedOnly={setBoostedOnly}
                />
              </div>
            )}

            {/* Active filter chip — shown only when a category is selected and
                the filters panel is closed. Matches the authenticated Dashboard. */}
            {!filtersOpen && selectedCategory && view === "list" && (
              <div
                className="shrink-0 flex flex-wrap gap-1.5 px-4 py-2.5"
                style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.1)" }}
              >
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-ds-md bg-primary/10 text-primary text-ds-11 font-medium">
                  {categoryLabels[selectedCategory] ?? selectedCategory}
                  <button
                    type="button"
                    onClick={() => setSelectedCategory(null)}
                    aria-label="Clear category filter"
                    className="hover:text-primary/70 btn-press"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              </div>
            )}

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
                  <div
                    className="space-y-3"
                    style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px + 1rem)" }}
                  >
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-44 w-full rounded-2xl" />
                    ))}
                  </div>
                ) : filteredJobs.length === 0 ? (
                  // Empty / error state — a liquid-glass card that fills the
                  // panel and bleeds beneath the dock (flat bottom, no hard
                  // edge), matching the Dashboard / Messages pattern.
                  <div className="flex-1 min-h-full flex">
                    {isError ? (
                    // "Nearby" was misleading — the open_jobs_browse feed
                    // isn't location-gated, and the failures we've seen here
                    // are server-side (see PR #357 for the authed-Dashboard
                    // version of the same fix). Use the same honest copy.
                    <ErrorState
                      title="We couldn't load jobs."
                      onRetry={() => refetch()}
                    />
                    ) : (
                    <EmptyState
                      icon={Briefcase}
                      eyebrow="Quiet today"
                      title="No matching jobs right now."
                      body="Try clearing filters or check back later — new tasks land throughout the day."
                      action={
                        hasFilters && (
                          <button
                            type="button"
                            onClick={clearAllFilters}
                            className="text-ds-11 font-semibold text-primary hover:underline btn-press"
                          >
                            Clear filters
                          </button>
                        )
                      }
                    />
                    )}
                  </div>
                ) : (
                  <div
                    className="space-y-3 animate-in fade-in-0 duration-500"
                    style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px + 1rem)" }}
                  >
                    {filteredJobs.map((job, idx) => (
                      <JobCard
                        key={job.id}
                        job={job}
                        effectiveFee={10}
                        currentUserId={undefined}
                        showApply
                        onApply={requireSignup}
                        onReport={requireSignup}
                        onSelect={requireSignup}
                        onToggleSave={requireSignup}
                        index={idx}
                        guestPricing
                      />
                    ))}
                  </div>
                )}
              </PullToRefreshWrapper>
            )}
    </PageScaffold>
  );
};

export default DashboardGuest;
