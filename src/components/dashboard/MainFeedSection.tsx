import type { Dispatch, ReactNode, SetStateAction } from "react";
import { VirtualizedJobList } from "@/components/dashboard/VirtualizedJobList";
import type { EnrichedJob } from "@/components/dashboard/types";
import type { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { JobFeedCard, type JobCardCommonProps } from "@/components/dashboard/feedCards";

// Moved out of BrowseTasksFeed.tsx unchanged (component-size ratchet, Q806).
type PullToRefresh = ReturnType<typeof usePullToRefresh>;

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
 * `lg:px-4` matches the desktop toolbar row directly above it (owner: "same
 * spacing"). On a phone it is NONE: the page's 20px gutter is the inset, the
 * same as Declutter, Shops and Homes (owner, 2026-10-19, one section shell),
 * so the cards line up with the search row above them, and the first card
 * sits 16px under it (the 12px shell gap + pt-1). Q2222.
 */
export function MainFeedSection({
  jobs,
  recommendedBadgeId,
  common,
  containerRef,
  setHoveredJobId,
  footer,
}: {
  jobs: EnrichedJob[];
  recommendedBadgeId: string | null;
  common: JobCardCommonProps;
  containerRef: PullToRefresh["containerRef"];
  setHoveredJobId?: Dispatch<SetStateAction<string | null>>;
  /** Under the last card, above the dock clearance (the Browse end card). */
  footer?: ReactNode;
}) {
  return (
    <div
      className="px-0 lg:px-4 pt-1 lg:pt-3"
      style={{ paddingBottom: "calc(6rem + var(--safe-area-bottom, 0px))" }}
    >
      <VirtualizedJobList
        items={jobs}
        scrollElementRef={containerRef}
        getKey={(job) => job.id}
        // Card renders ~83px tall (single-line title + one meta row) plus
        // the 12px --list-gap row pitch (Q213a) — 95 tracks that instead of the generic
        // 132 default, which was reserving ~60% more slot height than any
        // row actually needs and reads as excess whitespace before
        // measureElement corrects it.
        estimateSize={95}
        renderItem={(job, i) => (
          // Gap between cards — `space-y-*` can't apply once the
          // virtualizer absolutely-positions rows, so the gap is bottom
          // padding measured as part of the row height.
          <div
            className="pb-list"
            onMouseEnter={() => setHoveredJobId?.(job.id)}
            onMouseLeave={() => setHoveredJobId?.(null)}
          >
            <JobFeedCard job={job} index={i} recommended={job.id === recommendedBadgeId} common={common} />
          </div>
        )}
      />
      {footer}
    </div>
  );
}
