import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Search, SlidersHorizontal, X, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import BackButton from "@/components/BackButton";
import {
  FilterSheet,
  buildJobFilterSections,
  type FilterSheetSection,
} from "@/components/dashboard/FilterSheet";
import { chipStyles } from "@/components/dashboard/JobFilters";
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
  // Remaining filters mirror the signed-in browse sheet 1:1 — same value
  // conventions ("" = unset budget bound, "24h"/"3d"/"7d" expiry windows,
  // "smart" default sort) so both surfaces behave identically.
  const [minBudget, setMinBudget] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [expiresWithin, setExpiresWithin] = useState("");
  const [boostedOnly, setBoostedOnly] = useState(false);
  const [sortBy, setSortBy] = useState("smart");
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
  } = useOpenJobsFeed({
    search,
    selectedCategory,
    pricingMode,
    minBudget,
    maxBudget,
    expiresWithin,
    boostedOnly,
    sortBy,
  });

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
  // Counted the same way the authed toolbar counts (sort is a presentation
  // choice, not a filter, so it's excluded there and here).
  const activeFilterCount = [
    pricingMode !== "all",
    !!selectedCategory,
    !!minBudget,
    !!maxBudget,
    !!expiresWithin,
    boostedOnly,
  ].filter(Boolean).length;

  // "Did the visitor narrow the feed?" — drives the empty state's copy and its
  // clear affordance. Counts the search box too (which lives outside the sheet
  // and so isn't part of activeFilterCount).
  const isNarrowed = !!search || activeFilterCount > 0;

  const clearAllFilters = useCallback(() => {
    setPricingMode("all");
    setSelectedCategory(null);
    setMinBudget("");
    setMaxBudget("");
    setExpiresWithin("");
    setBoostedOnly(false);
    setSortBy("smart");
  }, []);

  // Guest filter sheet — built by the SAME `buildJobFilterSections` the
  // signed-in browse toolbar uses, so the two sheets can't drift: Sort by,
  // Category, Budget range, When (expires within), Boosted only. Two authed
  // sections are deliberately withheld because a signed-out visitor has no
  // data to make them mean anything:
  //   • Nearby radius — the public feed (get_ranked_open_jobs) masks every
  //     address to "City, ST" and returns no coordinates, and a guest has no
  //     saved location/parish for the authed string-match fallback. The chips
  //     could not filter anything.
  //   • Only my hours — reads the account's saved weekly availability rows.
  // Pricing (open-to-bids vs set-budget) is appended after: it's guest-only
  // framing that the authed sheet doesn't carry.
  const guestFilterSections = useMemo<FilterSheetSection[]>(() => [
    ...buildJobFilterSections({
      selectedCategory, setSelectedCategory,
      minBudget, setMinBudget,
      maxBudget, setMaxBudget,
      sortBy, setSortBy,
      expiresWithin, setExpiresWithin,
      boostedOnly, setBoostedOnly,
      showNearby: false,
      showAvailability: false,
    }),
    {
      key: "pricing",
      title: "Pricing",
      content: (
        <div role="group" aria-label="Filter by pricing type" className="flex flex-wrap gap-1.5">
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
                // Shared chip recipe from JobFilters so this guest-only
                // section looks native beside the shared sections above.
                className={`${chipStyles.chipBase} ${isActive ? chipStyles.chipActive : chipStyles.chipIdle}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      ),
    },
  ], [pricingMode, selectedCategory, minBudget, maxBudget, expiresWithin, boostedOnly, sortBy]);

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
    // No `noNavSpacer`: /jobs used to opt out of PublicLayout's shared nav
    // spacer and hand-roll `pt-20` instead, which put its H1 8px lower than
    // /for-business, /subscription, and /help. All four now clear the fixed
    // Navbar through the SAME spacer, so their titles land at one offset.
    // `hideHomeLink` because this page renders the canonical in-content
    // <BackButton /> next to its H1 — without it the mobile-only "Back to
    // home" link stacks a second back affordance directly above it.
    <PublicLayout showCtaBand={false} hideHomeLink>
      {/* The bottom padding clears the floating MobileNav (96px) plus
          the iOS home-indicator safe area, with a 16px gap so the
          last action isn't kissing the dock. pb-32 was barely 2px
          short on notched phones. */}
      <div className="pb-[calc(env(safe-area-inset-bottom,0px)+96px+1rem)] md:pb-safe-nav px-5">
        <div className="container mx-auto max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]">
          {/* Header — canonical BackButton sits to the LEFT of the title block
              (same row, chevron as lead-in), matching PageHeader everywhere.
              The icon-button cluster (Search + Filters) sits on the right,
              mirroring the logged-in BrowseTasksToolbar collapsed toolbar.

              Search expands INSIDE this row (the title yields its space to the
              input) rather than dropping a second row underneath. `flex-wrap`
              plus the input's `min-w-[220px]` floor is the narrow-phone
              escape hatch: the input drops to a second line intact instead of
              being squeezed toward zero width. */}
          <div className="flex flex-wrap items-center gap-3 mt-2 md:mt-6 mb-6 md:mb-8 animate-in fade-in slide-in-from-bottom-4 duration-400">
            <div className="shrink-0">
              <BackButton />
            </div>

            {searchOpen ? (
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  aria-label="Search jobs"
                  placeholder="Search by title or location…"
                  enterKeyHint="search"
                  inputMode="search"
                  autoComplete="off"
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  // focus:ring-inset — an outset ring on a full-width input
                  // paints outside the row's edge and clips against the page
                  // gutter. Inset keeps it on the field.
                  className="w-full h-10 pl-9 pr-9 text-ds-13 rounded-ds-md squircle glass-field focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary/40 transition-shadow placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  onClick={() => { setSearch(""); setSearchOpen(false); }}
                  aria-label="Close search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 inline-flex items-center justify-center rounded-full btn-press text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex flex-col leading-none min-w-0 flex-1">
                <h1 className="text-page-title leading-tight truncate">
                  Browse jobs
                </h1>
              </div>
            )}

            <div className="flex items-center gap-1 shrink-0">
              {!searchOpen && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => { setSearchOpen(true); if (filtersOpen) setFiltersOpen(false); }}
                  className={`h-10 w-10 rounded-ds-md btn-press focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${search ? "bg-[hsl(var(--bark)/0.12)] hover:!bg-[hsl(var(--bark)/0.16)] text-[hsl(var(--bark))] ring-1 ring-inset ring-[hsl(var(--bark)/0.40)]" : "text-muted-foreground hover:text-foreground hover:!bg-[hsl(var(--bark)/0.06)]"}`}
                  aria-label="Search jobs"
                  aria-expanded={searchOpen}
                >
                  <Search className="w-5 h-5" />
                </Button>
              )}
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
              Same sheet AND same section builder the signed-in dashboard uses;
              see `guestFilterSections` above for the two sections a guest
              can't be given and why. */}
          <FilterSheet
            open={filtersOpen}
            onOpenChange={setFiltersOpen}
            activeFilterCount={activeFilterCount}
            onClearAll={clearAllFilters}
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
            <div>
              <ErrorState onRetry={() => refetch()} />
            </div>
          ) : filtered.length === 0 ? (
            <div>
              <EmptyState
                variant="inline"
                icon={isNarrowed ? Search : Briefcase}
                title={isNarrowed ? "No jobs found" : "No open jobs right now"}
                body="New jobs are posted across Louisiana every day."
                action={
                  isNarrowed ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setSearch(""); clearAllFilters(); }}
                      className="squircle"
                    >
                      Clear filters
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      className="squircle"
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

          {/* No sign-up CTA band here — "Get started" is already pinned in the
              top nav on every guest page, so repeating it at the bottom of the
              board was a second copy of the same action. */}
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
