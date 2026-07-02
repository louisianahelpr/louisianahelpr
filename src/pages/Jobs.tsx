import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ArrowRight, Search, SlidersHorizontal, X, Lock, Briefcase } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import BackButton from "@/components/BackButton";
import { FilterSheet, type FilterSheetSection } from "@/components/dashboard/FilterSheet";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import PublicLayout from "@/components/marketing/PublicLayout";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useCurrentUser } from "@/hooks/useCurrentUser";
// Card-matching skeleton — mirrors the actual JobCard avatar/title/price
// layout so the loading→loaded transition doesn't shift. See task #121.
import { JobCardSkeleton } from "@/components/ui/skeletons/JobCardSkeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { VirtualList } from "@/components/VirtualList";
import { categoryLabels } from "@/components/activity/activityConstants";
import { TIER_PERKS } from "@/lib/subscriptionTiers";
import JobCard from "@/components/dashboard/JobCard";
import type { EnrichedJob } from "@/components/dashboard/types";
import { useJobRef } from "@/hooks/useJobRef";
import {
  ALL_CATEGORIES,
  CARDS_PER_ROW,
  DEBUG_AUTH,
  MAX_STAGGER_CARDS,
  noop,
  toEnrichedJob,
} from "./jobs/jobsConstants";
import { useOpenJobsFeed } from "./jobs/useOpenJobsFeed";

// Read-only job detail for logged-out visitors. Lazy so the guest browse
// grid paints without pulling the heavy dialog chunk until a card is tapped.
const JobDetailDialog = lazy(() => import("@/components/dashboard/JobDetailDialog"));

const Jobs = () => {
  usePageMeta({
    title: "Browse Jobs — Helpr",
    description:
      "Browse open jobs across Louisiana — yard work, moving help, errands, and more. Every job is escrow-protected and posted by a verified neighbor.",
    canonical: "https://www.louisianahelpr.com/jobs",
    ogTitle: "Browse open jobs on Louisiana Helpr",
    ogDescription:
      "Find jobs near you and start earning. Helpr Escrow keeps every transaction safe.",
  });
  // Capture ?ref= attribution from share/external links (e.g. ?ref=share
  // from the Share Sheet) so we can attribute traffic source for job views.
  useJobRef();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  // Pricing-style filter: "all" | "bids" (open to bids) | "budget" (set price).
  const [pricingMode, setPricingMode] = useState<"all" | "bids" | "budget">("all");
  // Collapsed-toolbar state mirroring the logged-in BrowseTasksToolbar: search
  // and filters are hidden behind icon buttons and expand on tap, instead of
  // sitting always-open. Search expands inline; filters open the shared sheet.
  const [searchOpen, setSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The job a guest tapped to preview — opens the read-only JobDetailDialog.
  const [detailJob, setDetailJob] = useState<EnrichedJob | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useCurrentUser();

  // The landing "See all jobs" links sit far down the page, so the window is
  // deep-scrolled when they're clicked. VirtualList uses a *window* virtualizer
  // that reads scrollY on init — against that stale offset it renders the
  // bottom of the list and lands the visitor mid-page. Force the top on mount,
  // re-applying next frame to beat the post-data layout shift.
  useEffect(() => {
    window.scrollTo(0, 0);
    const raf = requestAnimationFrame(() => window.scrollTo(0, 0));
    return () => cancelAnimationFrame(raf);
  }, []);

  // /jobs is the PUBLIC, guest-only browse surface — every card/dialog renders
  // the read-only "Sign up to apply" treatment. A signed-in visitor who lands
  // here (shared link, footer, deep-scrolled landing CTA) would otherwise be
  // stuck in guest mode seeing a sign-up CTA despite having an account. Mirror
  // the /jobs/:id sibling (which already redirects authed users into the apply
  // flow): send them to the canonical deep link when a specific job is targeted,
  // otherwise to their authed home. Guests are untouched — this only fires for
  // an authenticated session, so the "reachable WITHOUT auth" contract holds.
  useEffect(() => {
    if (authLoading || !user) return;
    const id = searchParams.get("job");
    navigate(id ? `/dashboard?quickApply=${id}` : "/dashboard", { replace: true });
  }, [authLoading, user, searchParams, navigate]);

  const {
    jobs,
    filtered,
    rows,
    jobsLoading,
    jobsError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useOpenJobsFeed({ search, selectedCategory, pricingMode });

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
  // above. Retries until the open-jobs feed has loaded.
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
      setDetailJob(toEnrichedJob(match));
      restoredJobParam.current = true;
    }
  }, [searchParams, jobs]);

  useEffect(() => {
    if (!DEBUG_AUTH) return;
    console.log("[auth] Jobs page", {
      authLoading,
      hasUser: !!user,
      userId: user?.id ?? null,
      jobsLoading,
      route: window.location.pathname,
    });
  }, [authLoading, jobsLoading, user?.id]);

  // Drives the badge on the Filters icon + the sheet's "Clear all" gate.
  const activeFilterCount =
    (pricingMode !== "all" ? 1 : 0) + (selectedCategory ? 1 : 0);

  // Guest filter sheet sections — pricing style + category. No auth-only
  // controls (location/availability/boosted), so the sheet stays lean.
  const guestFilterSections = useMemo<FilterSheetSection[]>(() => [
    {
      key: "pricing",
      title: "Pricing",
      content: (
        <div
          role="group"
          aria-label="Filter by pricing type"
          className="inline-flex gap-1 p-1 rounded-ds-md bg-white/60 dark:bg-card/60 backdrop-blur border border-border/60 squircle"
        >
          {([
            { key: "all", label: "All" },
            { key: "bids", label: "Open to bids" },
            { key: "budget", label: "Set budget" },
          ] as const).map(({ key, label }) => {
            const isActive = pricingMode === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setPricingMode(key)}
                aria-pressed={isActive}
                className={`inline-flex items-center min-h-[36px] px-3.5 rounded-ds-sm text-ds-12 font-semibold whitespace-nowrap transition-all duration-200 btn-press ${
                  isActive
                    ? "bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))]"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      ),
    },
    {
      key: "category",
      title: "Category",
      content: (
        <div className="flex flex-wrap gap-2">
          {[{ key: null as string | null, label: "All" }, ...ALL_CATEGORIES.map((c) => ({ key: c, label: categoryLabels[c] }))].map(({ key, label }) => {
            const isActive = selectedCategory === key;
            return (
              <button
                key={label ?? "all"}
                type="button"
                onClick={() => setSelectedCategory(isActive ? null : key)}
                aria-pressed={isActive}
                className={`inline-flex items-center min-h-[36px] px-3.5 py-2 rounded-ds-md text-ds-12 font-semibold whitespace-nowrap transition-all duration-200 btn-press squircle border ${
                  isActive
                    ? "bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))] border-[hsl(var(--bark)/0.40)]"
                    : "bg-white/60 dark:bg-card/60 backdrop-blur text-foreground border-border/60 hover:border-primary/50 hover:bg-white/90 dark:hover:bg-card/90"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      ),
    },
  ], [pricingMode, selectedCategory]);

  // Native app: /jobs is the WEB SEO browse surface — it carries the marketing
  // Navbar + Footer per the "every web page carries chrome" rule, which must
  // NOT leak into the iOS/Android shell. The native guest browse is /browse
  // (DashboardGuest), same as the "/" NativeRedirect. Send native visitors
  // there, preserving a ?job= deep link (DashboardGuest re-opens it from the
  // URL); authed users bounce onward to /dashboard via DashboardGuest's guard.
  if (Capacitor.isNativePlatform()) {
    const nativeJobId = searchParams.get("job");
    return <Navigate to={nativeJobId ? `/browse?job=${nativeJobId}` : "/browse"} replace />;
  }

  return (
    <PublicLayout showCtaBand={false} noNavSpacer>
      {/* pt-20 sits flush under the fixed Navbar (h-14 + safe-area).
          The bottom padding clears the floating MobileNav (96px) plus
          the iOS home-indicator safe area, with a 16px gap so the
          last action isn't kissing the dock. pb-32 was barely 2px
          short on notched phones. */}
      <div className="pt-20 pb-[calc(env(safe-area-inset-bottom,0px)+96px+1rem)] md:pb-safe-nav px-5">
        <div className="container mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]">
          {/* Header — canonical BackButton sits to the LEFT of the title block
              (same row, chevron as lead-in), matching PageHeader everywhere.
              The icon-button cluster (Search + Filters) sits on the right,
              mirroring the logged-in BrowseTasksToolbar collapsed toolbar. */}
          <div className="flex items-center gap-3 mt-2 md:mt-6 mb-6 md:mb-8 animate-in fade-in slide-in-from-bottom-4 duration-400">
            <div className="shrink-0">
              <BackButton />
            </div>
            <div className="flex flex-col leading-none min-w-0 flex-1">
              <span
                className="font-serif italic uppercase text-[0.62rem]"
                style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
              >
                Open across Louisiana
              </span>
              <h1 className="text-page-title leading-tight truncate mt-1">
                Browse jobs
              </h1>
              <span className="font-serif italic mt-0.5 text-[0.78rem]" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                <span className="font-semibold tabular-nums" style={{ color: "hsl(var(--ink-deep))" }}>{filtered.length}</span>{" "}
                {filtered.length === 1 ? "job" : "jobs"}{" "}
                <span style={{ color: "hsl(var(--burnt-sienna) / 0.4)" }}>·</span>{" "}
                Live now
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <span className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full squircle bg-primary/10 text-primary text-ds-11 font-bold tracking-wider uppercase border border-primary/15">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                Live
              </span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { setSearchOpen((v) => !v); if (filtersOpen) setFiltersOpen(false); }}
                className={`h-10 w-10 rounded-ds-md btn-press focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${searchOpen || search ? "bg-[hsl(var(--bark)/0.12)] hover:!bg-[hsl(var(--bark)/0.16)] text-[hsl(var(--bark))] ring-1 ring-inset ring-[hsl(var(--bark)/0.40)]" : "text-muted-foreground hover:text-foreground hover:!bg-[hsl(var(--bark)/0.06)]"}`}
                aria-label="Search jobs"
                aria-expanded={searchOpen}
              >
                <Search className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => { setFiltersOpen((v) => !v); if (searchOpen) setSearchOpen(false); }}
                className={`h-10 w-10 rounded-ds-md btn-press relative focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${filtersOpen || activeFilterCount > 0 ? "bg-[hsl(var(--bark)/0.12)] hover:!bg-[hsl(var(--bark)/0.16)] text-[hsl(var(--bark))] ring-1 ring-inset ring-[hsl(var(--bark)/0.40)]" : "text-muted-foreground hover:text-foreground hover:!bg-[hsl(var(--bark)/0.06)]"}`}
                aria-label={activeFilterCount > 0 ? `Filters (${activeFilterCount} active)` : "Filters"}
                aria-expanded={filtersOpen}
              >
                <SlidersHorizontal className="w-5 h-5" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-ds-9 font-bold flex items-center justify-center">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </div>
          </div>

          {/* Expandable search bar — hidden until the Search icon is tapped,
              matching the logged-in toolbar's collapse behavior. */}
          <AnimatePresence>
            {searchOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="overflow-hidden mb-4"
              >
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="search"
                    aria-label="Search jobs"
                    placeholder="Search by title or location…"
                    enterKeyHint="search"
                    inputMode="search"
                    autoComplete="off"
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-10 pr-9 h-11 text-ds-13 rounded-2xl squircle glass-field focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/15 transition-all placeholder:text-muted-foreground"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      aria-label="Clear search"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground btn-press"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* One-tap category switcher — hidden until a category is picked in
              the filter sheet, then expands so guests can switch/clear with a
              single tap. Mirrors the logged-in CategoryChipRow. */}
          {selectedCategory && (
            <div className="-mx-5 px-5 mb-5 overflow-x-auto scrollbar-hide overscroll-x-contain">
              <div className="flex gap-2 w-max">
                {[{ key: null as string | null, label: "All" }, ...ALL_CATEGORIES.map((c) => ({ key: c, label: categoryLabels[c] }))].map(({ key, label }) => {
                  const isActive = selectedCategory === key;
                  return (
                    <button
                      key={label ?? "all"}
                      type="button"
                      onClick={() => setSelectedCategory(isActive ? null : key)}
                      aria-pressed={isActive}
                      className={`inline-flex items-center min-h-[36px] px-3.5 py-2 rounded-ds-md text-ds-11 font-semibold whitespace-nowrap shrink-0 transition-all duration-200 btn-press squircle border ${
                        isActive
                          ? "bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))] border-[hsl(var(--bark)/0.40)]"
                          : "bg-white/60 dark:bg-card/60 backdrop-blur text-foreground border-border/60 hover:border-primary/50 hover:bg-white/90 dark:hover:bg-card/90"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Shared filter bottom sheet — the Filters icon toggles it open.
              Guests get pricing-style + category sections (no auth-only
              controls), rendered in the same sheet the dashboard uses. */}
          <FilterSheet
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            activeFilterCount={activeFilterCount}
            onClearAll={() => { setPricingMode("all"); setSelectedCategory(null); }}
            sections={guestFilterSections}
          />

          {/* Jobs Grid */}
          {jobsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4" aria-label="Loading jobs">
              {Array.from({ length: 4 }).map((_, i) => (
                <JobCardSkeleton key={i} />
              ))}
            </div>
          ) : jobsError && jobs.length === 0 ? (
            <div className="max-w-md mx-auto">
              <ErrorState onRetry={() => refetch()} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="max-w-md mx-auto">
              <EmptyState
                variant="inline"
                icon={(search || selectedCategory) ? Search : Briefcase}
                title={(search || selectedCategory) ? "No jobs found" : "No open jobs right now"}
                body="New jobs are posted across Louisiana every day."
                action={
                  (search || selectedCategory) ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setSearch(""); setSelectedCategory(null); setPricingMode("all"); }}
                      className="squircle rounded-full"
                    >
                      Clear filters
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      className="squircle rounded-full"
                    >
                      <Link to="/signup">Sign up to get notified</Link>
                    </Button>
                  )
                }
              />
            </div>
          ) : (
            // Virtualized single-column list: each VirtualList row is one
            // card. The window virtualizer keeps the DOM small on long lists.
            <VirtualList
              items={rows}
              getKey={(row, i) => `row-${i}-${row[0]?.id ?? "empty"}`}
              estimateSize={250}
              overscan={3}
              renderItem={(row, rowIndex) => (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4">
                  {row.map((job, colIndex) => {
                    const flatIndex = rowIndex * CARDS_PER_ROW + colIndex;
                    const enriched = toEnrichedJob(job);
                    return (
                      // Tapping a card opens a read-only detail preview (guest
                      // mode). Phones have no hover state, so the whole card is
                      // tappable. This is a <div role="button">, NOT a real
                      // <button>: the JobPrice chip inside renders its own
                      // <button> (tap-to-reveal earnings), and a <button> may
                      // not nest inside a <button> (validateDOMNesting). The
                      // role="button" + key handler give the same semantics
                      // without the invalid nesting — matching the authed feed,
                      // where JobCard's root is likewise a div role="button".
                      <div
                        key={job.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => openDetailJob(enriched)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openDetailJob(enriched);
                          }
                        }}
                        aria-label={`View details for ${job.title}`}
                        className="block w-full text-left rounded-2xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary animate-in fade-in slide-in-from-bottom-2 duration-300"
                        style={
                          flatIndex < MAX_STAGGER_CARDS
                            ? { animationDelay: `${flatIndex * 40}ms`, animationFillMode: "both" }
                            : undefined
                        }
                      >
                        <JobCard
                          job={enriched}
                          variant="guest"
                          effectiveFee={TIER_PERKS.free.platformFeePercent}
                          onApply={noop}
                          onReport={noop}
                          onSelect={noop}
                          index={flatIndex}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            />
          )}

          {/* Load More */}
          {hasNextPage && !jobsLoading && filtered.length > 0 && (
            <div className="text-center mt-6">
              <Button
                variant="outline"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? "Loading…" : "Load more jobs"}
              </Button>
            </div>
          )}

          {/* CTA */}
          <div className="text-center mt-12 space-y-4">
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-8 max-w-lg mx-auto space-y-4">
              <Lock className="w-8 h-8 text-primary mx-auto" />
              <h3 className="text-ds-17 font-bold text-foreground">Join the Helpr community</h3>
              <p className="text-ds-11 text-muted-foreground">
                Sign up to apply for jobs, message posters, and start earning — or post your own job and find help today.
              </p>
              <Button
                variant="hero"
                size="lg"
                onClick={() => navigate("/signup")}
                className="group"
              >
                Get started
                <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Read-only guest preview. `guest` skips every authed look-up and
          replaces apply/message/save/report with a single sign-up CTA. */}
      {detailJob && (
        <Suspense fallback={null}>
          <JobDetailDialog
            guest
            job={detailJob}
            effectiveFee={TIER_PERKS.free.platformFeePercent}
            onClose={closeDetailJob}
            onApply={noop}
            onReport={noop}
          />
        </Suspense>
      )}
    </PublicLayout>
  );
};

export default Jobs;
