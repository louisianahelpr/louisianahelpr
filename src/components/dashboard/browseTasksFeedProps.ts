import type { Dispatch, Ref, SetStateAction } from "react";
import type { User as SupaUser } from "@supabase/supabase-js";
import type { SavedRead } from "@/components/dashboard/SavedOnlyState";
import type { EnrichedJob } from "@/components/dashboard/types";
import type { useDashboardFilters } from "@/hooks/useDashboardFilters";
import type { usePullToRefresh } from "@/hooks/usePullToRefresh";
import type { FeedDensity } from "@/components/dashboard/feedDensity";
import type { ViewerFeedExclusions } from "@/pages/home/viewerFeedExclusions";

/** BrowseTasksFeed's props (moved out of BrowseTasksFeed.tsx, Train app fixes 11-24, to keep it under the 600-line ratchet). */
type PullToRefresh = ReturnType<typeof usePullToRefresh>;

export interface BrowseTasksFeedProps {
  /** List vs Map view — selects which body renders. */
  view: "list" | "map";
  /** Back to the list, on the map (area 04 #9, MapShowListPill). Omitted on the desktop split map (list beside it). */
  onShowList?: () => void;
  /** Card density: comfortable (default full cards) or compact (single-line rows). */
  density: FeedDensity;
  /** Dashboard filter state (from useDashboardFilters). */
  filters: ReturnType<typeof useDashboardFilters>;
  user: SupaUser | null;
  /** Full loaded feed — only `.length` is read, for the error-state guard. */
  allJobs: EnrichedJob[];
  /** True once the open-jobs fetch has failed. */
  loadError: boolean;
  /** Offline (or the read paused) with no page in hand (feedPhase "offline-empty"): never the empty state. */
  offline?: boolean;
  /** Retries the feed fetch (ErrorState's retry handler). */
  refresh: () => void;
  recommendedJobs: EnrichedJob[];
  /** True while the feed's first page is still being fetched/refetched, so
   *  the recommended slot reserves space with skeletons instead of
   *  collapsing then popping in (CLS) once recommendations resolve. */
  recommendedLoading: boolean;
  /** Show ONLY saved jobs — see BrowseTasksActions' bookmark toggle. */
  savedOnly?: boolean;
  /** The saved-ids read (Q1701): whether it failed, its retry. */
  savedRead?: SavedRead;
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
  /** Past the trigger point: the same "release to refresh" state Posts, Jobs
   *  and Messages draw (owner, 2026-10-08, Q1560). */
  canTrigger?: PullToRefresh["canTrigger"];
  /** Infinite-scroll sentinel — observed by the page's IntersectionObserver. */
  loadMoreRef: Ref<HTMLDivElement>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  /** Desktop split-screen hover sync — the hovered job's map pin scales up. */
  hoveredJobId?: string | null;
  setHoveredJobId?: Dispatch<SetStateAction<string | null>>;
  /**
   * The viewer-local culls (applied / dismissed / "Only saved"), forwarded
   * whole to the map so its pins match this list and the header count.
   *
   * `filters.filteredJobs` ALREADY has them applied — useDashboardFilters
   * owns them now — so this component no longer re-applies any of them to the
   * feed. It used to, and that was the 2026-09-19 "map shows 7 jobs. list
   * shows 4": dismissing three jobs culled them here, one layer below the
   * header count and the map, which both still counted them.
   * See src/pages/home/viewerFeedExclusions.ts.
   */
  exclusions?: ViewerFeedExclusions;
  /** The list's last-read time; the map re-reads its pins when it moves. */
  mapRefreshKey?: number;
}
