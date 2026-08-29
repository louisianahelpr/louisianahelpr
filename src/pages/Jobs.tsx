import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { Search, Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import BackButton from "@/components/BackButton";
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
import { useSearchParamMirror } from "@/hooks/useSearchParamMirror";
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
      "Browse open jobs across Louisiana — yard work, moving help, errands, and more. Every job has payment held safely until the work is done, and every poster is verified.",
    canonical: "https://www.louisianahelpr.com/jobs",
    ogTitle: "Browse open jobs on Louisiana Helpr",
    ogDescription:
      "Find jobs near you and start earning. Helpr holds every payment safely — you're paid once the work is confirmed.",
  });
  // Capture ?ref= attribution from share/external links (e.g. ?ref=share
  // from the Share Sheet) so we can attribute traffic source for job views.
  useJobRef();
  // Seeded from — and mirrored back into — the URL, exactly like the authed
  // browse feed (useDashboardFilters). Without it every history entry for this
  // page was identical, so backing out of a job dropped the visitor onto an
  // unfiltered feed. See useSearchParamMirror.
  const [initialParams] = useState(() => new URLSearchParams(window.location.search));
  const seed = (key: string) => initialParams.get(key) ?? "";
  const [search, setSearch] = useState(() => seed("q"));
  const [selectedCategory, setSelectedCategory] = useState<string | null>(
    () => initialParams.get("cat"),
  );
  // No pricing-style filter. It offered "All / Open to bids / Set budget",
  // and with bidding removed (PRICING_MODE_REMOVED in BudgetSection) every job
  // is a set-budget job — so two of the three options matched nothing and the
  // third matched everything.
  // Remaining filters mirror the signed-in browse sheet 1:1 — same value
  // conventions ("" = unset budget bound, "24h"/"3d"/"7d" expiry windows,
  // "smart" default sort) so both surfaces behave identically.
  const [minBudget, setMinBudget] = useState(() => seed("min"));
  const [maxBudget, setMaxBudget] = useState(() => seed("max"));
  const [expiresWithin, setExpiresWithin] = useState(() => seed("exp"));
  const [boostedOnly, setBoostedOnly] = useState(() => seed("boost") === "1");
  const [urgentOnly, setUrgentOnly] = useState(() => seed("urgent") === "1");
  const [sortBy, setSortBy] = useState("smart");
  // NOTE: there is no search box and no filter sheet on this surface any more.
  // The public web board matches the native guest board (/browse, DashboardGuest),
  // which carries no title-bar search/filter icons — a signed-out visitor has
  // nothing saved to filter against and hasn't been given a reason to narrow
  // anything, so those controls spent the top strip of the page answering a
  // question nobody asked. The filter STATE above survives on purpose: it is
  // seeded from and mirrored back into the URL, so marketing/SEO/share deep
  // links (/jobs?cat=cleaning, /jobs?q=lawn) still narrow the feed.
  // The job a guest tapped to preview — opens the read-only JobDetailDialog.
  const [detailJob, setDetailJob] = useState<EnrichedJob | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useCurrentUser();

  // Keep those filters on the history entry (and adopt them back on a pop).
  // `?job=` and `?ref=` are untouched — the mirror only owns the keys it
  // lists.
  useSearchParamMirror(
    {
      q: search.trim(),
      cat: selectedCategory ?? "",
      min: minBudget,
      max: maxBudget,
      exp: expiresWithin,
      boost: boostedOnly ? "1" : "",
      urgent: urgentOnly ? "1" : "",
    },
    (read) => {
      setSearch(read("q"));
      setSelectedCategory(read("cat") || null);
      setMinBudget(read("min"));
      setMaxBudget(read("max"));
      setExpiresWithin(read("exp"));
      setBoostedOnly(read("boost") === "1");
      setUrgentOnly(read("urgent") === "1");
    },
    "jobs",
  );

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
    minBudget,
    maxBudget,
    expiresWithin,
    boostedOnly,
    urgentOnly,
    sortBy,
  });

  // Mirror the open job into the URL (?job=<id>) so a jump to a sub-route from
  // inside the dialog — e.g. the Helper Pro "Learn more" → /subscription —
  // returns to the open job on Back, instead of dropping onto the bare feed.
  // Tapping a card sends a logged-out visitor to /signup rather than opening
  // the read-only preview. `?job=` is carried through so signup can bounce them
  // back to the job they were actually interested in.
  //
  // The preview dialog is NOT dead code: a direct link (/jobs?job=<id>, shared
  // or from search) still restores it below, and /jobs/:id remains a public,
  // indexable route. Only the in-feed tap changed.
  const openDetailJob = useCallback((job: EnrichedJob) => {
    navigate(`/signup?job=${job.id}`);
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

  // With the Filters icon gone this no longer drives a badge — it feeds
  // `isNarrowed`, which decides whether the empty state offers "Clear Filters".
  // A URL deep link is the only thing that can set these now, so this is what
  // tells a guest who landed on /jobs?cat=… with no matches that the board is
  // narrowed rather than empty, and gives them the way out.
  // Counted the same way the authed toolbar counts (sort is a presentation
  // choice, not a filter, so it's excluded there and here).
  // Budget counts ONCE, not once per bound: a budget band ("$50 – $150") sets
  // min AND max together, so counting both reported "2 filters active" for a
  // single tapped chip. Matches useDashboardFilters on the authed side.
  const activeFilterCount = [
    !!selectedCategory,
    !!minBudget || !!maxBudget,
    !!expiresWithin,
    boostedOnly,
    urgentOnly,
  ].filter(Boolean).length;

  // "Did the visitor narrow the feed?" — drives the empty state's copy and its
  // clear affordance. Counts the search box too (which lives outside the sheet
  // and so isn't part of activeFilterCount).
  const isNarrowed = !!search || activeFilterCount > 0;

  const clearAllFilters = useCallback(() => {
    setSelectedCategory(null);
    setMinBudget("");
    setMaxBudget("");
    setExpiresWithin("");
    setBoostedOnly(false);
    setSortBy("smart");
  }, []);

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
    // /subscription and /help. All of them now clear the fixed
    // Navbar through the SAME spacer, so their titles land at one offset.
    // This page renders the canonical in-content <BackButton /> next to its
    // H1, which is its only back affordance.
    <PublicLayout>
      {/* The bottom padding clears the floating MobileNav (96px) plus
          the iOS home-indicator safe area, with a 16px gap so the
          last action isn't kissing the dock. pb-32 was barely 2px
          short on notched phones. */}
      <div className="pb-safe-nav px-5 sm:px-8 lg:px-12">
        <div className="page-measure">
          {/* Header — canonical BackButton sits to the LEFT of the title block
              (same row, chevron as lead-in), matching PageHeader everywhere.
              Nothing sits on the right: the Search + Filters icon cluster that
              used to mirror the logged-in BrowseTasksToolbar was removed so
              this board matches the native guest board (/browse), which has
              never carried them. With only two children left there is no wrap
              to orchestrate, so the `order-*` classes went with them. */}
          <div className="flex items-center gap-3 mt-4 mb-3 md:mt-5 md:mb-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 duration-400">
            <div className="shrink-0">
{/* to="/" — NOT bare history-back. These are top-nav / footer
                  destinations reachable from anywhere, so `navigate(-1)` sent
                  you to whatever you happened to view last: opening Terms, then
                  Jobs, then pressing Back landed on Terms. A top-level page
                  needs one predictable parent, and consistently the same one
                  across all of them. */}
              <BackButton to="/" />
            </div>

            <div className="flex flex-col leading-none min-w-0 flex-1">
              <h1 className="text-page-title leading-tight truncate">
                Browse Jobs
              </h1>
            </div>
          </div>

          {/* One-tap category switcher — only renders when a category is set,
              which now happens ONLY via a URL deep link (/jobs?cat=cleaning
              from marketing/SEO/share links), since this page no longer has a
              filter sheet to set one from.

              It is deliberately NOT removed with the rest of the filter UI: it
              is the only in-page way out of a deep-linked category when that
              category still matches jobs. The empty state's "Clear Filters"
              button only renders at zero results, so without this row a guest
              who arrived on /jobs?cat=cleaning and sees three cleaning jobs
              would be stuck on a permanently narrowed board with no affordance
              to see the rest. Mirrors the logged-in CategoryChipRow. */}
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

          {/* Jobs Grid */}
          {jobsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4" role="status" aria-busy="true" aria-label="Loading jobs">
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
                      Clear Filters
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      className="squircle"
                    >
                      <Link to="/signup">Sign Up to Get Notified</Link>
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
                        className="block w-full h-full text-left rounded-2xl cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 duration-300"
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
                {isFetchingNextPage ? "Loading…" : "Load More Jobs"}
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
