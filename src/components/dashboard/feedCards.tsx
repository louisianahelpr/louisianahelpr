import type { Dispatch, SetStateAction } from "react";
import SwipeableJobCard from "@/components/dashboard/SwipeableJobCard";
import { CompactJobCard } from "@/components/dashboard/CompactJobCard";
import type { EnrichedJob } from "@/components/dashboard/types";

// The two card builders BrowseTasksFeed threads its shared props through,
// moved out of BrowseTasksFeed.tsx (component-size ratchet) unchanged.

/** Props every SwipeableJobCard needs, regardless of which list renders it. */
export interface JobCardCommonProps {
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
export function JobFeedCard({
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
export interface CompactCardCommonProps {
  effectiveFee: number;
  onSelect: Dispatch<SetStateAction<EnrichedJob | null>>;
  hoveredJobId?: string | null;
  setHoveredJobId?: Dispatch<SetStateAction<string | null>>;
}

/** Same de-dup as JobFeedCard, for the "compact" density's CompactJobCard rows. */
export function CompactFeedCard({
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
