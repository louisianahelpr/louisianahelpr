import { lazy, Suspense, useCallback, useMemo, useRef, useEffect, useState } from "react";
import type { Dispatch, Ref, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import type { User as SupaUser } from "@supabase/supabase-js";
import { Star, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/lib/accessibility";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import SwipeableJobCard from "@/components/dashboard/SwipeableJobCard";
import { VirtualizedJobList } from "@/components/dashboard/VirtualizedJobList";
import type { EnrichedJob } from "@/components/dashboard/types";
import type { useDashboardFilters } from "@/hooks/useDashboardFilters";
import type { usePullToRefresh } from "@/hooks/usePullToRefresh";

// Lazy-load BrowseMap so the ~45KB leaflet bundle only ships when an
// authenticated user toggles to map view. List view stays cheap.
const BrowseMap = lazy(() =>
  import("@/components/BrowseMap").then((m) => ({ default: m.BrowseMap })),
);

type PullToRefresh = ReturnType<typeof usePullToRefresh>;

interface BrowseTasksFeedProps {
  /** List vs Map view — selects which body renders. */
  view: "list" | "map";
  /** Dashboard filter state (from useDashboardFilters). */
  filters: ReturnType<typeof useDashboardFilters>;
  user: SupaUser | null;
  /** Full loaded feed — only `.length` is read, for the error-state guard. */
  allJobs: EnrichedJob[];
  /** True once the open-jobs fetch has failed. */
  loadError: boolean;
  /** Retries the feed fetch (ErrorState's retry handler). */
  refresh: () => void;
  recommendedJobs: EnrichedJob[];
  dismissedJobIds: Set<string>;
  /** Platform commission percentage, forwarded to each job card. */
  effectiveFee: number;
  handleApplyRequest: (jobId: string) => void;
  handleDismissRequest: (jobId: string) => void;
  handleToggleSave: (jobId: string, saved: boolean) => void;
  confirmDismissJobId: string | null;
  expandedCardId: string | null;
  setExpandedCardId: Dispatch<SetStateAction<string | null>>;
  savedJobIds: Set<string>;
  setReportJobId: Dispatch<SetStateAction<string | null>>;
  setDetailJob: Dispatch<SetStateAction<EnrichedJob | null>>;
  /** Pull-to-refresh wiring, owned by the page's usePullToRefresh hook. */
  containerRef: PullToRefresh["containerRef"];
  pullDistance: PullToRefresh["pullDistance"];
  refreshing: PullToRefresh["refreshing"];
  isPulling: PullToRefresh["isPulling"];
  /** Infinite-scroll sentinel — observed by the page's IntersectionObserver. */
  loadMoreRef: Ref<HTMLDivElement>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}

/**
 * BrowseTasksFeed — the Dashboard feed body: the Map view, and the
 * pull-to-refresh job list (error / empty states, the "Picked for you"
 * + "Everything else" sections, and the infinite-scroll sentinel).
 *
 * Extracted verbatim from Dashboard.tsx (a step in splitting that
 * file) — the JSX is unchanged and every value it reads is now a prop.
 */
export function BrowseTasksFeed({
  view,
  filters,
  user,
  allJobs,
  loadError,
  refresh,
  recommendedJobs,
  dismissedJobIds,
  effectiveFee,
  handleApplyRequest,
  handleDismissRequest,
  handleToggleSave,
  confirmDismissJobId,
  expandedCardId,
  setExpandedCardId,
  savedJobIds,
  setReportJobId,
  setDetailJob,
  containerRef,
  pullDistance,
  refreshing,
  isPulling,
  loadMoreRef,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: BrowseTasksFeedProps) {
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();

  // Stable per-card expand toggle. Previously an inline arrow was created
  // for every card on every render — that defeated SwipeableJobCard's
  // React.memo, since each card got a fresh `onToggleExpand` reference.
  // The functional setState form keeps this callback free of an
  // `expandedCardId` dependency, so it never changes identity.
  const handleToggleExpand = useCallback(
    (id: string) => {
      setExpandedCardId((current) => (current === id ? null : id));
    },
    [setExpandedCardId],
  );

  // Track previous job count to announce newly appended pages to screen
  // readers via an aria-live="polite" region, without moving focus.
  const prevJobCountRef = useRef(filters.filteredJobs.length);
  const [infiniteScrollMsg, setInfiniteScrollMsg] = useState("");

  useEffect(() => {
    const prev = prevJobCountRef.current;
    const next = filters.filteredJobs.length;
    if (next > prev && !isFetchingNextPage) {
      const added = next - prev;
      setInfiniteScrollMsg(`${added} more job${added === 1 ? "" : "s"} loaded`);
    }
    prevJobCountRef.current = next;
  }, [filters.filteredJobs.length, isFetchingNextPage]);

  // Derive the "Everything else" list and the Recommended slice once per
  // dependency change rather than on every render (dialog toggles, expand
  // state, banners all re-render this component). Pure derivation.
  const { visibleJobs, recommendedVisible } = useMemo(() => {
    const visible = filters.filteredJobs
      .filter(j => !dismissedJobIds.has(j.id))
      .filter(j => {
        // Hide jobs already shown in Recommended or Nearby sections
        if (!filters.hasFilters) {
          const inRecommended = recommendedJobs.some(rj => rj.id === j.id);
          const inNearby = filters.nearbyJobs.some(nj => nj.id === j.id);
          if (inRecommended || inNearby) return false;
        }
        return true;
      })
      // Two-sided liquidity signal — float urgent jobs to the top of the
      // "Everything else" feed. Stable sort: equal-urgency rows keep the
      // feed's existing order, so this only lifts urgent jobs.
      .slice()
      .sort((a, b) => Number(b.is_urgent ?? false) - Number(a.is_urgent ?? false));
    const recommended = !filters.hasFilters
      ? recommendedJobs.filter(j => !dismissedJobIds.has(j.id))
      : [];
    return { visibleJobs: visible, recommendedVisible: recommended };
  }, [filters.filteredJobs, filters.hasFilters, filters.nearbyJobs, recommendedJobs, dismissedJobIds]);

  return (
    <>
      {/* Visually hidden aria-live region — announces newly loaded page
          of jobs to screen readers after infinite scroll without moving
          focus or interrupting the user mid-scroll. */}
      <p
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {infiniteScrollMsg}
      </p>

      {view === "map" && (
        <div className="flex-1 min-h-0 px-3 pt-2 pb-0">
          <Suspense fallback={<div className="h-full w-full rounded-t-2xl bg-muted/30 animate-pulse" />}>
            <BrowseMap
              onJobAction={handleApplyRequest}
              ctaLabel="Apply"
              currentUserId={user?.id}
            />
          </Suspense>
        </div>
      )}

      <PullToRefreshWrapper
        ref={containerRef}
        pullDistance={pullDistance}
        refreshing={refreshing}
        isPulling={isPulling}
        className="flex-1 min-h-0 flex flex-col overscroll-contain scrollbar-hide pb-0"
        style={view === "map" ? { display: "none" } : undefined}
      >
      {/* Job list — rendered directly in the PageScaffold panel (which is
          already a frosted liquid-glass surface), mirroring the Messages /
          Activity layout. No nested glass box: the panel IS the Browse
          Tasks surface, so the home page reads as two clean cards (title
          card + panel) like every other tab. */}
      {loadError && allJobs.length === 0 ? (
      <div className="px-3 pt-4 flex-1 min-h-0 flex">
        <ErrorState
          title="We couldn't load jobs."
          body="Pull down to refresh, or tap Try again. If it sticks, our end is having a hiccup — not yours."
          onRetry={refresh}
        />
      </div>
      ) : filters.filteredJobs.length === 0 ? (
      <div className="px-3 pt-4 flex-1 min-h-0 flex">
        <EmptyState
          icon={Search}
          eyebrow={filters.hasFilters ? "No matches" : "All quiet — for now"}
          title={filters.hasFilters ? "No jobs match your filters." : "Nothing today, neighbor."}
          body={
            filters.hasFilters
              ? filters.boostedOnly
                ? "No boosted jobs right now — try clearing the filter to see all open work."
                : "Try widening your parish, raising your budget, or clearing a filter."
              : "New jobs post throughout the day — fresh work lands here as neighbors post it. Check back soon."
          }
          action={
            // Filtered: offer a way out. Quiet but unfiltered authenticated
            // board: no CTA — posting lives in the bottom nav and the
            // notify opt-in lives elsewhere, so repeating them here was
            // redundant. Only the (rare) signed-out fallback keeps a CTA.
            filters.hasFilters ? (
              <Button variant="outline" onClick={filters.clearFilters} className="rounded-ds-md">
                Clear filters
              </Button>
            ) : user ? undefined : (
              <BarkPillButton onClick={() => navigate("/post-job")}>
                Post the first job
              </BarkPillButton>
            )
          }
        />
      </div>
      ) : (() => {
        return (
          <>
            {recommendedVisible.length > 0 && (
              <>
                <div
                  className="px-4 pt-3 pb-1.5 flex items-center justify-between"
                  style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.06)" }}
                >
                  <div className="flex items-center gap-2">
                    <Star
                      className="w-3.5 h-3.5"
                      style={{ color: "hsl(var(--burnt-sienna))" }}
                      strokeWidth={2}
                      fill="hsl(var(--burnt-sienna) / 0.2)"
                    />
                    <span
                      className="text-[0.7rem] font-serif italic uppercase tracking-[0.18em]"
                      style={{ color: "hsl(var(--burnt-sienna))" }}
                    >
                      Picked for you
                    </span>
                  </div>
                  <span
                    className="text-[0.7rem] font-sans"
                    style={{ color: "hsl(var(--olivewood) / 0.55)" }}
                  >
                    {recommendedVisible.length}
                  </span>
                </div>
                <div className="px-3 pt-3 pb-1 space-y-2.5 lg:space-y-4 xl:space-y-5">
                  {/* AnimatePresence with initial={false} — only NEW
                      recommended jobs slide in (e.g. when a fresh match
                      arrives or the user dismisses a sibling). The
                      first paint stays static so the section doesn't
                      feel laggy when the dashboard loads. The virtualized
                      "Everything else" list below is intentionally NOT
                      wrapped — animating across an absolute-positioned
                      virtualizer fights its layout math. */}
                  <AnimatePresence initial={false}>
                    {recommendedVisible.map((job, i) => (
                      <motion.div
                        key={`rec-${job.id}`}
                        initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
                        animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                        exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -12 }}
                        transition={reducedMotion ? { duration: 0 } : { duration: 0.2, ease: "easeOut" }}
                      >
                        <SwipeableJobCard job={job} effectiveFee={effectiveFee} currentUserId={user?.id} onApply={handleApplyRequest} onReport={setReportJobId} onSelect={setDetailJob} onDismiss={handleDismissRequest} dismissPending={confirmDismissJobId === job.id} index={i} isExpanded={expandedCardId === job.id} onToggleExpand={handleToggleExpand} isSaved={savedJobIds.has(job.id)} onToggleSave={handleToggleSave} />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
                {visibleJobs.length > 0 && (
                  <div
                    className="px-4 pt-3 pb-1.5"
                    style={{
                      borderTop: "1px solid hsl(var(--olivewood) / 0.06)",
                      borderBottom: "1px solid hsl(var(--olivewood) / 0.06)",
                    }}
                  >
                    <span
                      className="text-[0.7rem] font-serif italic uppercase tracking-[0.18em]"
                      style={{ color: "hsl(var(--burnt-sienna))" }}
                    >
                      Everything else
                    </span>
                  </div>
                )}
              </>
            )}
            {/* Main "Everything else" feed — virtualized. This is the
                only unbounded list on the dashboard (50+ rows after
                infinite scroll, each mounting framer-motion drag state),
                so it scrolls via an element-scroll virtualizer that
                renders just the visible window. The recommended section,
                section headers, and the infinite-scroll sentinel stay as
                normal DOM — recommended is capped at 5 and the rest are
                fixed-size. The outer div keeps the horizontal padding,
                top padding, and dock clearance; per-card vertical spacing
                is baked into each virtualized row so it survives the
                absolute positioning the virtualizer applies. */}
            <div
              className="px-3 pt-3"
              style={{
                // Dock clearance — last jobs scroll *under* the
                // floating bottom nav, so we add safe room below
                // the final card to let the user reach it.
                paddingBottom: "calc(6rem + env(safe-area-inset-bottom, 0px))",
              }}
            >
              <VirtualizedJobList
                items={visibleJobs}
                scrollElementRef={containerRef}
                getKey={(job) => job.id}
                renderItem={(job, i) => (
                  // Gap between cards — `space-y-*` can't apply once the
                  // virtualizer absolutely-positions rows, so the gap is
                  // bottom padding measured as part of the row height.
                  <div className="pb-2.5 lg:pb-4 xl:pb-5">
                    <SwipeableJobCard job={job} effectiveFee={effectiveFee} currentUserId={user?.id} onApply={handleApplyRequest} onReport={setReportJobId} onSelect={setDetailJob} onDismiss={handleDismissRequest} dismissPending={confirmDismissJobId === job.id} index={i} isExpanded={expandedCardId === job.id} onToggleExpand={handleToggleExpand} isSaved={savedJobIds.has(job.id)} onToggleSave={handleToggleSave} />
                  </div>
                )}
              />
            </div>
            {/* Infinite scroll sentinel + manual fallback */}
            {hasNextPage && (
              <div ref={loadMoreRef} className="px-4 py-4 flex justify-center">
                {isFetchingNextPage ? (
                  <span className="text-ds-11 text-muted-foreground inline-flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                    Loading more jobs…
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fetchNextPage()}
                    className="text-ds-11 text-muted-foreground hover:text-foreground rounded-ds-md btn-press"
                  >
                    Load more
                  </Button>
                )}
              </div>
            )}
            {!hasNextPage && visibleJobs.length >= 25 && (
              <div className="px-4 py-4 text-center text-ds-11 text-muted-foreground">
                You've reached the end of the feed.
              </div>
            )}
          </>
        );
      })()}
      </PullToRefreshWrapper>
    </>
  );
}
