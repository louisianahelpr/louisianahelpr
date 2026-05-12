import { useEffect, useMemo, useState, useCallback, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Briefcase, List, Map as MapIcon, X, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import JobCard from "@/components/dashboard/JobCard";

// Lazy-load the map so the ~45KB leaflet bundle only ships when guests
// actually toggle to map view. List view stays cheap by default.
const BrowseMap = lazy(() =>
  import("@/components/BrowseMap").then((m) => ({ default: m.BrowseMap })),
);
import JobFilters, { categoryLabels } from "@/components/dashboard/JobFilters";
import { supabase } from "@/integrations/supabase/client";
import { formatName } from "@/lib/utils";
import type { EnrichedJob } from "@/components/dashboard/types";
import { usePageTitle } from "@/hooks/usePageTitle";
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
  usePageTitle("Browse Jobs — Helpr");

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
  const [view, setView] = useState<"list" | "map">("list");

  // Public open-jobs feed — no auth required (open_jobs_browse view is RLS-public).
  const { data: jobs = [], isLoading, refetch } = useQuery({
    queryKey: ["guestDashboardJobs"],
    queryFn: async (): Promise<EnrichedJob[]> => {
      const { data: rawJobs } = await supabase
        .from("open_jobs_browse")
        .select(
          "id, title, description, category, budget, date_needed, location, customer_id, status, created_at, updated_at, is_urgent, urgent_fee, is_flexible_schedule, is_recurring, is_group_job, helpers_needed, estimated_hours, special_requirements, photos, boosted_at, boost_expires_at, expires_at, start_time, recurrence_interval, recurrence_end_date, parent_job_id, payment_status",
        )
        .neq("payment_status", "abandoned")
        .order("boosted_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(40);

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
  const { containerRef, pullDistance, refreshing, isPulling } = usePullToRefresh({
    onRefresh: async () => { await refetch(); },
  });

  return (
    <PullToRefreshWrapper ref={containerRef} pullDistance={pullDistance} refreshing={refreshing} isPulling={isPulling}>
    <div
      className="h-[100dvh] max-h-[100dvh] bg-premium-page flex flex-col overflow-hidden animate-in fade-in-0 duration-500"
    >
      {/* Header — matches DashboardHeader's frosted-glass treatment, with
          guest-only Log in / Sign up actions in place of the menu/notif/etc. */}
      <header
        className="sticky top-0 z-50 border-b border-white/20 bg-white/60 dark:bg-white/5 backdrop-blur-[12px] backdrop-saturate-150 shadow-[0_4px_20px_-8px_hsl(0_0%_0%/0.08)] shrink-0"
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", WebkitBackdropFilter: "blur(12px) saturate(1.5)" }}
      >
        <div className="w-full flex h-14 items-center justify-between gap-2 px-5 lg:px-8 xl:px-12">
          <HelprMark to="/" size="md" />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => navigate("/login")}
              className="text-ds-11 h-11 rounded-ds-md"
            >
              Log in
            </Button>
            <Button
              size="sm"
              onClick={() => navigate("/signup")}
              className="text-ds-11 h-11 rounded-ds-md"
            >
              Sign up
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-5 lg:px-8 xl:px-12 pt-3 lg:pt-5 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="w-full max-w-3xl lg:max-w-5xl mx-auto flex-1 min-h-0 flex flex-col gap-3 lg:gap-4 overflow-hidden">

          {/* Greeting card — editorial liquid-glass surface mirroring the
              authenticated dashboard's "Good morning, X" pane. */}
          <section
            className="liquid-glass shrink-0 px-4 py-3 lg:px-5 lg:py-4 relative overflow-hidden"
            style={{
              backgroundImage:
                "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 55%), " +
                "radial-gradient(60% 80% at 0% 100%, hsl(165 18% 78% / 0.18) 0%, transparent 60%)",
              boxShadow:
                "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
                "inset 0 -1px 1px 0 rgba(0, 0, 0, 0.04), " +
                "0 1px 2px hsl(var(--olivewood) / 0.05), " +
                "0 6px 14px -6px hsl(var(--olivewood) / 0.1), " +
                "0 14px 24px -10px hsl(var(--olivewood) / 0.12)",
            }}
          >
            <span
              className="font-serif italic uppercase text-ds-9"
              style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
            >
              A first look
            </span>
            <h1
              className="font-display italic font-bold leading-tight mt-0.5"
              style={{
                fontSize: "clamp(1.15rem, 1.6vw + 0.3rem, 1.4rem)",
                color: "hsl(var(--ink-deep))",
                letterSpacing: "-0.022em",
              }}
            >
              Welcome to <em className="signature" style={{ fontStyle: "normal", color: "hsl(var(--burnt-sienna))" }}>Helpr</em>.
            </h1>
            <p
              className="font-serif italic mt-1 text-ds-13 leading-snug"
              style={{ color: "hsl(var(--olivewood) / 0.7)" }}
            >
              Browse what your Louisiana neighbors need. Sign up free to apply or post your own task.
            </p>
          </section>

          {/* Browse Tasks card — extends to the viewport bottom (flat
              bottom corners) so it reads as continuing under the dock. */}
          <section
            className="liquid-glass overflow-hidden flex-1 min-h-0 flex flex-col"
            style={{
              borderBottomLeftRadius: 0,
              borderBottomRightRadius: 0,
              borderBottom: "none",
              boxShadow:
                "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
                "0 1px 2px hsl(var(--olivewood) / 0.06), " +
                "0 14px 30px -8px hsl(var(--olivewood) / 0.14), " +
                "0 36px 64px -16px hsl(var(--olivewood) / 0.18)",
            }}
          >
            {/* Header row — title block + view toggle + search button. */}
            <div
              className="shrink-0 flex items-center justify-between gap-3 px-4 py-3"
              style={{ borderBottom: searchOpen ? "none" : "1px solid hsl(var(--olivewood) / 0.1)" }}
            >
              <div className="flex flex-col leading-none min-w-0">
                <span
                  className="font-serif italic tracking-[0.18em] uppercase text-ds-10"
                  style={{ color: "hsl(var(--burnt-sienna) / 0.78)" }}
                >
                  {hasFilters ? "Filtered" : "For you, today"} · {filteredJobs.length} {filteredJobs.length === 1 ? "job" : "jobs"}
                </span>
                <h2
                  className="font-display italic font-bold leading-tight mt-1"
                  style={{
                    fontSize: "1.25rem",
                    color: "hsl(var(--ink-deep))",
                    letterSpacing: "-0.018em",
                  }}
                >
                  {hasFilters ? "Filtered Results" : "Browse Tasks"}
                </h2>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {/* List ⇄ Map toggle — compact two-button pill */}
                <div className="flex items-center gap-0.5 p-0.5 bg-secondary/50 rounded-ds-md">
                  <button
                    onClick={() => setView("list")}
                    aria-label="List view"
                    className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${
                      view === "list"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <List className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setView("map")}
                    aria-label="Map view"
                    className={`h-7 w-7 rounded-lg flex items-center justify-center transition-colors ${
                      view === "map"
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <MapIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
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
                  <BrowseMap onJobAction={requireSignup} ctaLabel="Sign up to apply" />
                </Suspense>
              </div>
            ) : (
              <div
                data-allow-scroll="true"
                className="flex-1 min-h-0 overflow-y-auto px-4 pt-3"
                style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px + 1rem)" }}
              >
                {isLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-44 w-full rounded-2xl" />
                    ))}
                  </div>
                ) : filteredJobs.length === 0 ? (
                  // min-h-full + flex centering pins the empty state to the
                  // middle of the scroll viewport instead of letting it
                  // hug the top with a tall dead-zone underneath.
                  <div className="min-h-full flex flex-col items-center justify-center text-center px-6 gap-3 py-10">
                    <div
                      className="w-16 h-16 rounded-full flex items-center justify-center"
                      style={{
                        backgroundColor: "hsla(0, 0%, 100%, 0.55)",
                        backdropFilter: "blur(16px) saturate(150%)",
                        WebkitBackdropFilter: "blur(16px) saturate(150%)",
                        border: "1px solid hsl(var(--olivewood) / 0.10)",
                        boxShadow:
                          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
                          "0 1px 2px hsl(var(--olivewood) / 0.05), " +
                          "0 8px 22px -6px hsl(var(--olivewood) / 0.12)",
                      }}
                    >
                      <Briefcase className="w-7 h-7" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.5} />
                    </div>
                    <div className="space-y-1.5">
                      <span className="text-display-eyebrow">Quiet today</span>
                      <p
                        className="font-display italic font-bold leading-tight"
                        style={{
                          fontSize: "clamp(1.05rem, 1.5vw + 0.4rem, 1.35rem)",
                          color: "hsl(var(--ink-deep))",
                          letterSpacing: "-0.02em",
                        }}
                      >
                        No matching jobs right now.
                      </p>
                      <p
                        className="font-serif italic text-ds-13 leading-relaxed max-w-sm mx-auto"
                        style={{ color: "hsl(var(--olivewood) / 0.7)" }}
                      >
                        Try clearing filters or check back later — new tasks land throughout the day.
                      </p>
                    </div>
                    {hasFilters && (
                      <button
                        type="button"
                        onClick={clearAllFilters}
                        className="mt-1 text-ds-11 font-semibold text-primary hover:underline btn-press"
                      >
                        Clear filters
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3 animate-in fade-in-0 duration-500">
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
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
    </PullToRefreshWrapper>
  );
};

export default DashboardGuest;
