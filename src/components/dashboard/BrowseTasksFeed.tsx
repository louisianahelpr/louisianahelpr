import { lazy, Suspense, useCallback } from "react";
import type { Dispatch, Ref, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import type { User as SupaUser } from "@supabase/supabase-js";
import { Star, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
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

  return (
    <>
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
        className="flex-1 min-h-0 overscroll-contain scrollbar-hide px-3 pt-3 pb-0"
        style={view === "map" ? { display: "none" } : undefined}
      >
        {/* Always-visible elevated content box. Empty state and the
            job list both render INSIDE this box so the dashboard
            never reads as "bare rows on the page" — the box is the
            identity of the Browse Tasks area. Bottom corners
            drop their radius so the box reads as continuing under
            the floating dock. */}
        <div
          className="liquid-glass glass-paper-mesh min-h-full overflow-hidden"
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
      {/* Job list */}
      {loadError && allJobs.length === 0 ? (
      <div className="px-4 pt-4 flex-1 min-h-0 flex">
        <ErrorState
          title="We couldn't load nearby jobs."
          onRetry={refresh}
        />
      </div>
      ) : filters.filteredJobs.length === 0 ? (
      <div className="px-4 pt-4 flex-1 min-h-0 flex">
        <EmptyState
          icon={Search}
          eyebrow={filters.hasFilters ? "No matches" : "All quiet — for now"}
          title={filters.hasFilters ? "No jobs match your filters." : "Nothing today, neighbor."}
          body={
            filters.hasFilters
              ? filters.boostedOnly
                ? "No boosted jobs right now — try clearing the filter to see all open work."
                : "Try widening your parish, raising your budget, or clearing a filter."
              : (() => {
                  // Rotating friendly tip — picks one of 4 every hour so
                  // the empty state feels alive on repeat visits instead
                  // of static. Deterministic per hour keeps it from
                  // flickering on every render.
                  const tips = [
                    "New jobs post throughout the day. Helprs often check in around lunch and after work.",
                    "Most posts go up on weekday evenings. Pull down to refresh anytime.",
                    "Saved a search? Helpr will ping you the moment a matching job hits the board.",
                    "Quiet days happen. The neighborhood circles back — usually before sundown.",
                  ];
                  return tips[new Date().getHours() % tips.length];
                })()
          }
          action={
            filters.hasFilters ? (
              <Button variant="outline" onClick={filters.clearFilters} className="rounded-ds-md">
                Clear filters
              </Button>
            ) : (
              <BarkPillButton onClick={() => navigate("/post-job")}>
                Post the first job
              </BarkPillButton>
            )
          }
        />
      </div>
      ) : (() => {
        const visibleJobs = filters.filteredJobs
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
          // Two-sided liquidity signal — float urgent jobs to the top of
          // the "Everything else" feed so the helpr side sees the work
          // that needs them most (and the bonus that comes with it)
          // first. Stable sort: equal-urgency rows keep the feed's
          // existing order, so this only lifts urgent jobs without
          // reshuffling everything else.
          .slice()
          .sort((a, b) => Number(b.is_urgent ?? false) - Number(a.is_urgent ?? false));
        const recommendedVisible = !filters.hasFilters
          ? recommendedJobs.filter(j => !dismissedJobIds.has(j.id))
          : [];
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
                  {recommendedVisible.map((job, i) => (
                    <div key={`rec-${job.id}`}>
                      <SwipeableJobCard job={job} effectiveFee={effectiveFee} currentUserId={user?.id} onApply={handleApplyRequest} onReport={setReportJobId} onSelect={setDetailJob} onDismiss={handleDismissRequest} dismissPending={confirmDismissJobId === job.id} index={i} isExpanded={expandedCardId === job.id} onToggleExpand={handleToggleExpand} isSaved={savedJobIds.has(job.id)} onToggleSave={handleToggleSave} />
                    </div>
                  ))}
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
              <div className="px-4 py-4 text-center text-[11px] text-muted-foreground">
                You've reached the end of the feed.
              </div>
            )}
          </>
        );
      })()}
        </div>
      </PullToRefreshWrapper>
    </>
  );
}
