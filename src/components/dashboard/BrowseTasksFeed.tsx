import { lazy, Suspense, useCallback, useMemo, useRef, useEffect, useState } from "react";
import type { Dispatch, Ref, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import type { User as SupaUser } from "@supabase/supabase-js";
import { Search, Plus, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/lib/accessibility";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import SwipeableJobCard from "@/components/dashboard/SwipeableJobCard";
import { VirtualizedJobList } from "@/components/dashboard/VirtualizedJobList";
import { CompactJobCard } from "@/components/dashboard/CompactJobCard";
import {
  RecommendedJobCardSkeleton,
} from "@/components/ui/skeletons/JobCardSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { getCachedUserLocation } from "@/hooks/useUserLocation";
import { useProfile } from "@/hooks/useProfile";
import { useHelprActivity } from "@/hooks/useHelprActivity";
import type { EnrichedJob } from "@/components/dashboard/types";
import type { useDashboardFilters } from "@/hooks/useDashboardFilters";
import type { usePullToRefresh } from "@/hooks/usePullToRefresh";
import type { FeedDensity } from "@/components/dashboard/feedDensity";

// Lazy-load BrowseMap so the ~45KB leaflet bundle only ships when an
// authenticated user toggles to map view. List view stays cheap.
//
// A slow chunk fetch over a weak connection makes the toggle feel frozen
// with zero observability. Bracket the dynamic import in a User Timing
// mark/measure so the cost of the map-chunk load shows up in the
// Performance panel / any RUM that reads `performance.getEntriesByType`.
// One-shot: only the first load is timed (the chunk is cached after).
let mapChunkTimed = false;
const BrowseMap = lazy(() => {
  const timed = !mapChunkTimed && typeof performance !== "undefined";
  if (timed) {
    mapChunkTimed = true;
    performance.mark("browse-map:load-start");
  }
  return import("@/components/BrowseMap").then((m) => {
    if (timed) {
      try {
        performance.mark("browse-map:load-end");
        performance.measure("browse-map:load", "browse-map:load-start", "browse-map:load-end");
      } catch {
        /* measure can throw if marks were cleared — never block the map */
      }
    }
    return { default: m.BrowseMap };
  });
});

type PullToRefresh = ReturnType<typeof usePullToRefresh>;

interface BrowseTasksFeedProps {
  /** List vs Map view — selects which body renders. */
  view: "list" | "map";
  /** Card density: comfortable (default full cards) or compact (single-line rows). */
  density: FeedDensity;
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
  /** True while the feed's first page is still being fetched/refetched, so
   *  the recommended slot reserves space with skeletons instead of
   *  collapsing then popping in (CLS) once recommendations resolve. */
  recommendedLoading: boolean;
  dismissedJobIds: Set<string>;
  /** Show ONLY saved jobs — see BrowseTasksActions' bookmark toggle. */
  savedOnly?: boolean;
  /** Platform commission percentage, forwarded to each job card. */
  effectiveFee: number;
  handleApplyRequest: (jobId: string) => void;
  handleDismissRequest: (jobId: string) => void;
  handleToggleSave: (jobId: string, saved: boolean) => void;
  /** Long-press on a JobCard — opens the quick-action sheet. */
  handleLongPressCard?: (jobId: string) => void;
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
  /** Desktop split-screen hover sync — the hovered job's map pin scales up. */
  hoveredJobId?: string | null;
  setHoveredJobId?: Dispatch<SetStateAction<string | null>>;
}

/**
 * BrowseTasksFeed — the Dashboard feed body: the Map view, and the
 * pull-to-refresh job list (error / empty states, the relevance-sorted
 * feed with recommended picks marked by a pill, and the infinite-scroll
 * sentinel).
 *
 * Extracted verbatim from Dashboard.tsx (a step in splitting that
 * file) — the JSX is unchanged and every value it reads is now a prop.
 */
export function BrowseTasksFeed({
  view,
  density,
  filters,
  user,
  allJobs,
  loadError,
  refresh,
  recommendedJobs,
  recommendedLoading,
  dismissedJobIds,
  savedOnly = false,
  effectiveFee,
  handleApplyRequest,
  handleDismissRequest,
  handleToggleSave,
  handleLongPressCard,
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
  hoveredJobId,
  setHoveredJobId,
}: BrowseTasksFeedProps) {
  // Personalize the signed-in empty state — greet by first name instead of
  // the generic "neighbor" the guest screen uses. Falls back to "neighbor"
  // when we don't yet have a name (unauthed OR still-loading profile) so
  // the copy never reads as broken.
  const { data: myProfile } = useProfile(user?.id ?? null);
  // Supply-side proof for the EMPTY feed (audit F1/L7). This exact signal was
  // already built and shown on checkout — where it preaches to someone who has
  // already decided to pay. Here it is the difference between "this
  // marketplace is dead" and "this marketplace is waiting for you".
  //
  // Same RPC, same restraint rule: the hook returns null below 3 helprs, so a
  // genuinely thin parish shows nothing rather than a discouraging number.
  const { activity: helprActivity } = useHelprActivity(
    (myProfile as { parish?: string | null } | null)?.parish ?? null,
  );
  const emptyStateGreeting = (() => {
    const first = (myProfile?.full_name ?? "").trim().split(/\s+/)[0]?.replace(/[^a-zA-Z'-]/g, "");
    return first || "neighbor";
  })();
  // Lift the viewer's cached coords out of filters.userLoc — or fall back
  // to the module-level cache populated by any prior useUserLocation()
  // call elsewhere (the BrowseMap, the "nearby" filter, JobTracking) so
  // we never re-prompt just to render a distance pill. Passing primitives
  // down (not the full GeoState object) keeps SwipeableJobCard's memo
  // stable across unrelated dashboard re-renders.
  const filterLoc = filters.userLoc?.status === "ready"
    ? { lat: filters.userLoc.lat, lng: filters.userLoc.lng }
    : null;
  const fallbackLoc = filterLoc ?? getCachedUserLocation();
  const userLat = fallbackLoc?.lat ?? null;
  const userLng = fallbackLoc?.lng ?? null;
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
      // Saved-only runs BEFORE the recommended/nearby de-dup below, so the
      // saved list is a plain flat list rather than a saved job vanishing
      // because it also happened to be a recommendation.
      .filter(j => !savedOnly || savedJobIds.has(j.id))
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
    // No "Picked for you" band while filtering to saved — the user asked for
    // one specific list, and a personalised section above it is the app
    // answering a question it wasn't asked.
    const recommended = !filters.hasFilters && !savedOnly
      ? recommendedJobs.filter(j => !dismissedJobIds.has(j.id))
      : [];
    return { visibleJobs: visible, recommendedVisible: recommended };
  }, [filters.filteredJobs, filters.hasFilters, filters.nearbyJobs, recommendedJobs, dismissedJobIds, savedOnly, savedJobIds]);

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
          <Suspense fallback={<Skeleton className="h-full w-full rounded-t-2xl" />}>
            <BrowseMap
              onJobAction={handleApplyRequest}
              ctaLabel="Apply"
              currentUserId={user?.id}
              filters={filters.mapFilter}
              onClearFilters={filters.clearFilters}
              // Same fee the cards below use — so a pin popup and the card for
              // the same job print the same take-home, not gross vs net.
              effectiveFee={effectiveFee}
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
      ) : savedOnly && visibleJobs.length === 0 ? (
        /* Saved-only with nothing saved. Handled BEFORE the generic empty
           state below, which reads `filters.filteredJobs` — that list is full
           (there are jobs, they just aren't saved), so without this branch the
           feed rendered an empty panel with no explanation at all. */
        <div className="px-3 pt-4 flex-1 min-h-0 flex">
          <ErrorState
            title="Nothing saved yet"
            body="Tap the bookmark on a job to keep it here. Saved jobs stay put until you unsave them or they're filled."
          />
        </div>
      ) : filters.filteredJobs.length === 0 ? (() => {
        // Geo-aware empty copy: when the "Near me" radius filter is
        // active and the user's coords resolved, suggest a concrete
        // wider radius rather than the generic "widen your parish".
        // Falls back gracefully when coords aren't known or no radius
        // is set, so the message never reads as broken.
        const nearbyActive = filters.nearbyMiles !== null && filters.locationFilter.startsWith("nearby:");
        const currentMiles = filters.nearbyMiles ?? 0;
        // Next-rung suggestion — round-numbered radii (5/10/25/50) read
        // cleaner in a sentence than the previous value × 2 ("13 mi").
        const nextMiles = currentMiles < 5 ? 10 : currentMiles < 10 ? 25 : currentMiles < 25 ? 50 : 100;
        return (
      <div className="px-3 pt-4 flex-1 min-h-0 flex">
        <EmptyState
          icon={Search}
          eyebrow={filters.hasFilters ? (nearbyActive ? "Nothing within range" : "No matches") : "All quiet — for now"}
          title={
            filters.hasFilters
              ? (nearbyActive
                ? `No tasks within ${currentMiles} mi of you.`
                : "No tasks match your filters.")
              : `Nothing today, ${emptyStateGreeting}.`
          }
          body={
            filters.hasFilters
              ? filters.boostedOnly
                ? "No boosted jobs right now — try clearing the filter to see all open work."
                : nearbyActive
                  ? `Try widening to ${nextMiles} mi, or clear the radius to see all open work across your parish.`
                  : "Try a different category, a wider time window, or clearing a filter."
              // Supply-side proof when we have an honest number for it. An
              // empty feed reads as "this marketplace is dead"; the parish
              // count reframes it as "waiting for a job", which is what is
              // actually true. Same sentence the checkout uses, so the claim
              // stays identical on both screens — and it simply falls back to
              // the original copy when the hook withholds a thin count.
              : helprActivity
                ? `${helprActivity.count} Helprs have worked jobs in ${helprActivity.parish} — the work just hasn't landed yet today. Fresh jobs post throughout the day.`
                : "New jobs post throughout the day — fresh work lands here as neighbors post it. Check back soon."
          }
          action={
            // Filtered: offer a way out. Otherwise — for both signed-in
            // and signed-out users — surface BOTH a Post and a Notify CTA
            // side by side. App is never role-based per
            // [[app-is-never-role-based]]: every account can post AND do
            // jobs, so an empty feed should let them flip to the other
            // side of the marketplace right here (Post your first task)
            // OR opt in to be pinged when a match lands (Notify me),
            // instead of dead-ending on body copy.
            filters.hasFilters ? (
              nearbyActive ? (
                <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-3">
                  <BarkPillButton onClick={() => filters.setLocationFilter(`nearby:${nextMiles}`)}>
                    Widen to {nextMiles} mi
                  </BarkPillButton>
                  <Button
                    variant="ghost"
                    onClick={() => filters.setLocationFilter("")}
                    className="rounded-ds-md font-sans font-medium"
                    style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                  >
                    Show All Locations
                  </Button>
                </div>
              ) : (
                <Button variant="outline" onClick={filters.clearFilters} className="rounded-ds-md">
                  Clear Filters
                </Button>
              )
            ) : (
              // Both actions used to be `ghost` at the same olivewood/80, so the
              // screen's only real primary was an unlabelled floating "+" and
              // the two visible options were indistinguishable. The old comment
              // reasoned that keeping them quiet avoided duplicating the FAB —
              // sound, but the outcome was a screen with no primary at all.
              //
              // The fork itself stays (every account can post AND work — this
              // product has no roles). Equal importance does not require equal
              // visual weight: an empty feed is itself proof there is no work to
              // take, so posting leads and Notify is the quiet second line.
              <div className="flex flex-col items-center gap-3">
                <Button
                  onClick={() => navigate("/post-job")}
                  className="rounded-ds-md"
                >
                  <Plus className="w-4 h-4 mr-1" strokeWidth={2.25} />
                  Post Your First Job
                </Button>
                <Button
                  variant="ghost"
                  onClick={() =>
                    navigate(user ? "/profile?tab=notifications" : "/signup")
                  }
                  className="rounded-ds-md font-sans font-medium"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  <Bell className="w-4 h-4 mr-1" strokeWidth={2.25} />
                  Notify Me When One Lands
                </Button>
              </div>
            )
          }
        />
      </div>
        );
      })() : (() => {
        // Show the recommended slot as skeletons while the feed's first page
        // is still resolving and we don't yet have any picks — reserving the
        // header + a couple of card-height placeholders keeps the section
        // from collapsing and then popping in (CLS) once matches arrive.
        const showRecommendedSkeleton =
          recommendedLoading && !filters.hasFilters && recommendedVisible.length === 0;
        return (
          <>
            {showRecommendedSkeleton && density === "comfortable" && (
              <div
                className="px-3 pt-3 pb-1 space-y-2.5 lg:space-y-3"
                aria-hidden
              >
                {/* Recommended-section variant — matches the real recommended
                    card geometry (sienna rail, longer title row, taller price
                    tile). A generic feed skeleton here mis-sizes the slot and
                    the swap bumps the list down when matches arrive. */}
                {[0, 1].map((i) => (
                  <RecommendedJobCardSkeleton key={`rec-skel-${i}`} />
                ))}
              </div>
            )}
            {recommendedVisible.length > 0 && (
              <>
                {density === "compact" ? (
                  <ul>
                    {recommendedVisible.map((job, i) => (
                      <CompactJobCard
                        key={job.id}
                        job={job}
                        effectiveFee={effectiveFee}
                        recommended={i === 0}
                        onSelect={(j) => setDetailJob(j)}
                        isHighlighted={hoveredJobId === job.id}
                        onMouseEnter={() => setHoveredJobId?.(job.id)}
                        onMouseLeave={() => setHoveredJobId?.(null)}
                      />
                    ))}
                  </ul>
                ) : (
                  <div className="px-3 pt-3 pb-1 space-y-2.5 lg:space-y-3">
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
                          onMouseEnter={() => setHoveredJobId?.(job.id)}
                          onMouseLeave={() => setHoveredJobId?.(null)}
                        >
                          <SwipeableJobCard job={job} effectiveFee={effectiveFee} currentUserId={user?.id} recommended={i === 0} onApply={handleApplyRequest} onReport={setReportJobId} onSelect={setDetailJob} onDismiss={handleDismissRequest} dismissPending={confirmDismissJobId === job.id} index={i} isExpanded={expandedCardId === job.id} onToggleExpand={handleToggleExpand} isSaved={savedJobIds.has(job.id)} onToggleSave={handleToggleSave} userLat={userLat} userLng={userLng} onLongPress={handleLongPressCard} />
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </>
            )}
            {/* Main "Everything else" feed */}
            {density === "compact" ? (
              /* Compact: plain list of 48px rows — no virtualizer needed
                 at this row height for typical feed sizes. */
              <ul
                style={{
                  paddingBottom: "calc(6rem + var(--safe-area-bottom, 0px))",
                }}
              >
                {visibleJobs.map((job) => (
                  <CompactJobCard
                    key={job.id}
                    job={job}
                    effectiveFee={effectiveFee}
                    onSelect={(j) => setDetailJob(j)}
                    isHighlighted={hoveredJobId === job.id}
                    onMouseEnter={() => setHoveredJobId?.(job.id)}
                    onMouseLeave={() => setHoveredJobId?.(null)}
                  />
                ))}
              </ul>
            ) : (
              /* Comfortable: virtualized — this is the only unbounded list
                 on the dashboard (50+ rows after infinite scroll, each
                 mounting framer-motion drag state), so it scrolls via an
                 element-scroll virtualizer that renders just the visible
                 window. The recommended section, section headers, and the
                 infinite-scroll sentinel stay as normal DOM — recommended
                 is capped at 5 and the rest are fixed-size. The outer div
                 keeps the horizontal padding, top padding, and dock
                 clearance; per-card vertical spacing is baked into each
                 virtualized row so it survives the absolute positioning
                 the virtualizer applies. */
              <div
                /* px-4, matching the toolbar row directly above it. The feed was px-3
           and the toolbar px-4, so the cards sat 4px further left than the
           "N jobs nearby" label introducing them — two edges 4px apart is the
           kind of misalignment that reads as sloppiness without being
           nameable (owner: "same spacing"). */
        className="px-4 pt-3"
                style={{
                  paddingBottom: "calc(6rem + var(--safe-area-bottom, 0px))",
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
                    <div
                      className=/* 8 / 10 / 12, not 10 / 16 / 20 (owner: "tighter together").
                       The gap GREW with viewport width while the card it
                       separates stayed 85px tall, so the desktop feed spent a
                       fifth of a card's height on the space between every pair.
                       A list reads as a list when the rows are closer to each
                       other than they are tall. */
                    "pb-2 lg:pb-2.5 xl:pb-3"
                      onMouseEnter={() => setHoveredJobId?.(job.id)}
                      onMouseLeave={() => setHoveredJobId?.(null)}
                    >
                      <SwipeableJobCard job={job} effectiveFee={effectiveFee} currentUserId={user?.id} onApply={handleApplyRequest} onReport={setReportJobId} onSelect={setDetailJob} onDismiss={handleDismissRequest} dismissPending={confirmDismissJobId === job.id} index={i} isExpanded={expandedCardId === job.id} onToggleExpand={handleToggleExpand} isSaved={savedJobIds.has(job.id)} onToggleSave={handleToggleSave} userLat={userLat} userLng={userLng} onLongPress={handleLongPressCard} />
                    </div>
                  )}
                />
              </div>
            )}
            {/* Infinite scroll sentinel + manual fallback */}
            {hasNextPage && (
              <div ref={loadMoreRef} className="px-4 py-4 flex justify-center">
                {isFetchingNextPage ? (
                  <span className="text-ds-11 text-muted-foreground inline-flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full border-2 border-primary/30 border-t-primary motion-safe:animate-spin" />
                    Loading more jobs…
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fetchNextPage()}
                    className="text-ds-11 text-muted-foreground hover:text-foreground rounded-ds-md btn-press"
                  >
                    Load More
                  </Button>
                )}
              </div>
            )}
          </>
        );
      })()}
      </PullToRefreshWrapper>
    </>
  );
}
