import { lazy, Suspense, useCallback, useMemo, useRef, useEffect, useState } from "react";
import type { Dispatch, Ref, SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import type { User as SupaUser } from "@supabase/supabase-js";
import { Search, Plus, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { BarkPillButton } from "@/components/ui/BarkPillButton";
import PullToRefreshWrapper from "@/components/PullToRefreshWrapper";
import SwipeableJobCard from "@/components/dashboard/SwipeableJobCard";
import { VirtualizedJobList } from "@/components/dashboard/VirtualizedJobList";
import { CompactJobCard } from "@/components/dashboard/CompactJobCard";
import {
  JobCardSkeleton,
  RecommendedJobCardSkeleton,
} from "@/components/ui/skeletons/JobCardSkeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { getCachedUserLocation } from "@/hooks/useUserLocation";
import { compareJobsBySortMode } from "@/lib/smartSort";
import { useProfile } from "@/hooks/useProfile";
import { useHelprActivity } from "@/hooks/useHelprActivity";
import type { EnrichedJob } from "@/components/dashboard/types";
import type { useDashboardFilters } from "@/hooks/useDashboardFilters";
import type { usePullToRefresh } from "@/hooks/usePullToRefresh";
import type { FeedDensity } from "@/components/dashboard/feedDensity";

// Lazy-load BrowseMap so the map chunk (and the MapKit JS script it pulls
// from Apple's CDN) only loads when an authenticated user toggles to map
// view. List view stays cheap.
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

/** Props every SwipeableJobCard needs, regardless of which list renders it. */
interface JobCardCommonProps {
  effectiveFee: number;
  currentUserId?: string;
  onApply: (jobId: string) => void;
  onReport: Dispatch<SetStateAction<string | null>>;
  onSelect: Dispatch<SetStateAction<EnrichedJob | null>>;
  onDismiss: (jobId: string) => void;
  expandedCardId: string | null;
  onToggleExpand: (id: string) => void;
  savedJobIds: Set<string>;
  onToggleSave: (jobId: string, saved: boolean) => void;
  userLat: number | null;
  userLng: number | null;
}

/**
 * JobFeedCard — the single place that threads the (long) shared prop list
 * onto SwipeableJobCard. Both the "Recommended" band and the "Everything
 * else" feed render the same card with the same props; only their list
 * wrapper differs (animated vs virtualized), so only the wrapper stays
 * duplicated per call site — the card itself is built here once.
 */
function JobFeedCard({
  job,
  index,
  recommended,
  common,
}: {
  job: EnrichedJob;
  index: number;
  recommended?: boolean;
  common: JobCardCommonProps;
}) {
  return (
    <SwipeableJobCard
      job={job}
      effectiveFee={common.effectiveFee}
      currentUserId={common.currentUserId}
      recommended={recommended}
      onApply={common.onApply}
      onReport={common.onReport}
      onSelect={common.onSelect}
      onDismiss={common.onDismiss}
      index={index}
      isExpanded={common.expandedCardId === job.id}
      onToggleExpand={common.onToggleExpand}
      isSaved={common.savedJobIds.has(job.id)}
      onToggleSave={common.onToggleSave}
      userLat={common.userLat}
      userLng={common.userLng}
    />
  );
}

/** Props every CompactJobCard row needs, regardless of which list renders it. */
interface CompactCardCommonProps {
  effectiveFee: number;
  onSelect: Dispatch<SetStateAction<EnrichedJob | null>>;
  hoveredJobId?: string | null;
  setHoveredJobId?: Dispatch<SetStateAction<string | null>>;
}

/** Same de-dup as JobFeedCard, for the "compact" density's CompactJobCard rows. */
function CompactFeedCard({
  job,
  recommended,
  common,
}: {
  job: EnrichedJob;
  recommended?: boolean;
  common: CompactCardCommonProps;
}) {
  return (
    <CompactJobCard
      job={job}
      effectiveFee={common.effectiveFee}
      recommended={recommended}
      onSelect={(j) => common.onSelect(j)}
      isHighlighted={common.hoveredJobId === job.id}
      onMouseEnter={() => common.setHoveredJobId?.(job.id)}
      onMouseLeave={() => common.setHoveredJobId?.(null)}
    />
  );
}

/**
 * MainFeedSection — the WHOLE comfortable-density feed, ONE list (owner,
 * 2026-08-30, repeated instruction: "all jobs belong in one component
 * period"). Recommended picks and everything else used to be two separately
 * rendered sections (an AnimatePresence band, then a virtualized list) —
 * now it's one virtualized list over `jobs`, where the caller has already
 * put recommended picks first. `recommendedCount` only decides which single
 * card (index 0, when >0) gets the "Recommended" pill — it no longer
 * selects a different list primitive or a different wrapper.
 *
 * `px-4` matches the toolbar row directly above it (owner: "same spacing" —
 * the feed used to sit 4px further left than the "N jobs" label introducing
 * it).
 */
function MainFeedSection({
  jobs,
  recommendedBadgeId,
  common,
  containerRef,
  setHoveredJobId,
}: {
  jobs: EnrichedJob[];
  recommendedBadgeId: string | null;
  common: JobCardCommonProps;
  containerRef: PullToRefresh["containerRef"];
  setHoveredJobId?: Dispatch<SetStateAction<string | null>>;
}) {
  return (
    <div
      className="px-4 pt-3"
      style={{ paddingBottom: "calc(6rem + var(--safe-area-bottom, 0px))" }}
    >
      <VirtualizedJobList
        items={jobs}
        scrollElementRef={containerRef}
        getKey={(job) => job.id}
        renderItem={(job, i) => (
          // Gap between cards — `space-y-*` can't apply once the
          // virtualizer absolutely-positions rows, so the gap is bottom
          // padding measured as part of the row height.
          <div
            className="pb-2 lg:pb-2.5 xl:pb-3"
            onMouseEnter={() => setHoveredJobId?.(job.id)}
            onMouseLeave={() => setHoveredJobId?.(null)}
          >
            <JobFeedCard job={job} index={i} recommended={job.id === recommendedBadgeId} common={common} />
          </div>
        )}
      />
    </div>
  );
}

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
      setInfiniteScrollMsg(`${added} more task${added === 1 ? "" : "s"} loaded`);
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
        // Hide jobs already rendered by the Recommended section above.
        //
        // This used to ALSO drop anything in `filters.nearbyJobs`, dating from
        // a time when the feed rendered a separate "Nearby" band. That band is
        // gone — `nearbyJobs` is not rendered by this component or by
        // Dashboard.tsx — so the exclusion was deleting open jobs from the
        // feed with no section showing them instead. Proven at runtime: with 6
        // jobs in the user's own city and 3 skill-matching jobs elsewhere,
        // `nearbyJobs` claimed the first 5 local jobs while `recommendedJobs`
        // (skill score 3 > location score 2) held the 3 out-of-town ones plus
        // 2 local, leaving 3 local jobs excluded here and rendered nowhere.
        // Only exclude what a section actually renders.
        if (!filters.hasFilters && recommendedJobs.some(rj => rj.id === j.id)) return false;
        return true;
      })
      // Two-sided liquidity signal — float urgent jobs to the top of the
      // "Everything else" feed. Stable sort: equal-urgency rows keep the
      // feed's existing order, so this only lifts urgent jobs. Applied
      // ONLY under the default "smart" sort — when the user picked an
      // explicit Sort By mode, re-lifting urgent jobs here would scramble
      // the order useDashboardFilters just produced (e.g. a $368 urgent
      // job jumping above higher-paying ones under "Highest pay").
      .slice()
      .sort((a, b) =>
        filters.sortBy === "smart"
          ? Number(b.is_urgent ?? false) - Number(a.is_urgent ?? false)
          : 0,
      );
    // No "Picked for you" band while filtering to saved — the user asked for
    // one specific list, and a personalised section above it is the app
    // answering a question it wasn't asked.
    //
    // Order within the band follows the Sort By control (except "smart",
    // which keeps the recommendation-score order that IS this band's
    // notion of "smart"). Without this, Sort By on the default unfiltered
    // feed looked like a no-op: this band holds up to 5 of the visible
    // jobs and never reordered when sortBy changed, since it was built
    // purely from the recommendation score. See compareJobsBySortMode.
    const recommended = !filters.hasFilters && !savedOnly
      ? recommendedJobs
          .filter(j => !dismissedJobIds.has(j.id))
          .slice()
          .sort((a, b) => filters.sortBy === "smart" ? 0 : compareJobsBySortMode(a, b, filters.sortBy))
      : [];
    return { visibleJobs: visible, recommendedVisible: recommended };
  }, [filters.filteredJobs, filters.hasFilters, filters.sortBy, recommendedJobs, dismissedJobIds, savedOnly, savedJobIds]);

  // ONE list — recommended picks first, then everything else — EXCEPT
  // boosted jobs, which pin above everything (including recommended) while
  // their boost is active. `useDashboardFilters` already floats boosted
  // jobs to the top of `filteredJobs`, but the recommended band is built
  // from a separate (non-boost-aware) score in useDashboardData and was
  // always spliced in front of it, silently burying an active boost below
  // up to 5 recommended picks. Re-partition after merging so a boosted job
  // never sits below an unboosted one, recommended or not.
  const combinedVisible = useMemo(() => {
    const merged = [...recommendedVisible, ...visibleJobs];
    const boosted = merged.filter((j) => j.isBoosted);
    if (boosted.length === 0) return merged;
    const rest = merged.filter((j) => !j.isBoosted);
    return [...boosted, ...rest];
  }, [recommendedVisible, visibleJobs]);

  // The "Recommended" pill goes on the first combined-list card that is
  // actually a recommended pick — not always index 0, now that a boosted
  // (but unrecommended) job can sit ahead of the recommended band.
  const recommendedBadgeId = useMemo(() => {
    if (recommendedVisible.length === 0) return null;
    const recommendedIds = new Set(recommendedVisible.map((j) => j.id));
    return combinedVisible.find((j) => recommendedIds.has(j.id))?.id ?? null;
  }, [combinedVisible, recommendedVisible]);

  // Built once per render and handed to both list call sites (recommended +
  // everything-else) so JobFeedCard/CompactFeedCard don't each need a dozen
  // individual props threaded through — see JobFeedCard above.
  const cardCommon: JobCardCommonProps = {
    effectiveFee,
    currentUserId: user?.id,
    onApply: handleApplyRequest,
    onReport: setReportJobId,
    onSelect: setDetailJob,
    onDismiss: handleDismissRequest,
    expandedCardId,
    onToggleExpand: handleToggleExpand,
    savedJobIds,
    onToggleSave: handleToggleSave,
    userLat,
    userLng,
  };
  const compactCardCommon: CompactCardCommonProps = {
    effectiveFee,
    onSelect: setDetailJob,
    hoveredJobId,
    setHoveredJobId,
  };

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
              // Apply from a pin opens the SAME job-detail dialog as tapping
              // a feed card (`setDetailJob`) — not the standalone quick-apply
              // sheet `handleApplyRequest` opens for the feed's swipe/Apply
              // affordance. One apply surface, reached the same way, whether
              // you found the job on the map or in the list.
              onJobAction={(jobId) => {
                const job = filters.filteredJobs.find((j) => j.id === jobId);
                if (job) setDetailJob(job);
              }}
              currentUserId={user?.id}
              filters={filters.mapFilter}
              onClearFilters={filters.clearFilters}
              hoveredJobId={hoveredJobId}
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
        // While the feed's first page is still resolving and we don't yet
        // know whether any of the ALREADY-rendered jobs are about to become
        // recommended picks, don't paint the real list at all. It used to:
        // render `visibleJobs` (recommended candidates included, in their
        // ordinary position) immediately, then — once `recommendedJobs`
        // resolved a beat later — yank 1-2 of those same jobs out of the
        // middle of the list and re-insert them at the top via
        // `combinedVisible`. Every other row was already sitting still, so
        // the two that got promoted visibly jumped from wherever they'd
        // been up to the top (owner, 2026-08-30: "the effect like all the
        // jobs are there then these top 2 scroll in"). Holding the WHOLE
        // list behind one skeleton until recommendations are known removes
        // the reorder entirely — the list paints once, already in its
        // final order.
        const showFullSkeleton =
          recommendedLoading && !filters.hasFilters && !savedOnly && recommendedVisible.length === 0;
        return (
          <>
            {showFullSkeleton && density === "comfortable" && (
              <div
                className="px-3 pt-3 pb-1 space-y-2.5 lg:space-y-3"
                aria-hidden
              >
                {/* Recommended-section variant — matches the real recommended
                    card geometry (sienna rail, longer title row, taller price
                    tile) — up front, then plain rows for the rest of the
                    first page, so the WHOLE visible feed has a placeholder
                    rather than just the top slot. */}
                {[0, 1].map((i) => (
                  <RecommendedJobCardSkeleton key={`rec-skel-${i}`} />
                ))}
                {[0, 1, 2, 3, 4].map((i) => (
                  <JobCardSkeleton key={`row-skel-${i}`} />
                ))}
              </div>
            )}
            {/* ONE list, recommended picks first then everything else —
                not two components (owner, 2026-08-30, repeated instruction:
                "all jobs belong in one component period"). The recommended/
                everything-else split is still real (it drives sort order
                and which single card gets the "Recommended" pill), but it's
                now just how `combinedVisible` is ORDERED, not two separate
                rendered lists. Suppressed entirely during `showFullSkeleton`
                (above) so the real rows only ever paint once, already in
                their settled order. */}
            {showFullSkeleton ? null : density === "compact" ? (
              /* Compact: plain list of 48px rows — no virtualizer needed
                 at this row height for typical feed sizes. */
              <ul
                style={{
                  paddingBottom: "calc(6rem + var(--safe-area-bottom, 0px))",
                }}
              >
                {combinedVisible.map((job) => (
                  <CompactFeedCard key={job.id} job={job} recommended={job.id === recommendedBadgeId} common={compactCardCommon} />
                ))}
              </ul>
            ) : (
              <MainFeedSection
                jobs={combinedVisible}
                recommendedBadgeId={recommendedBadgeId}
                common={cardCommon}
                containerRef={containerRef}
                setHoveredJobId={setHoveredJobId}
              />
            )}
            {/* Infinite scroll sentinel + manual fallback */}
            {hasNextPage && (
              <div ref={loadMoreRef} className="px-4 py-4 flex justify-center">
                {isFetchingNextPage ? (
                  <span className="text-ds-11 text-muted-foreground inline-flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full border-2 border-primary/30 border-t-primary motion-safe:animate-spin" />
                    Loading more tasks…
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
