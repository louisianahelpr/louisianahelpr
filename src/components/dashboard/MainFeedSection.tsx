import { useMemo, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { VirtualizedJobList } from "@/components/dashboard/VirtualizedJobList";
import type { EnrichedJob } from "@/components/dashboard/types";
import type { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { JobFeedCard, type JobCardCommonProps } from "@/components/dashboard/feedCards";
import { QUIET_LINE, splitFartherAway } from "@/pages/home/fartherAwaySplit";

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
  splitFarther = false,
}: {
  jobs: EnrichedJob[];
  recommendedBadgeId: string | null;
  common: JobCardCommonProps;
  containerRef: PullToRefresh["containerRef"];
  setHoveredJobId?: Dispatch<SetStateAction<string | null>>;
  /** Under the last card, above the dock clearance (the Browse end card). */
  footer?: ReactNode;
  /**
   * Board 6: move jobs beyond 25 mi under a "Farther away" divider, and when
   * it is quiet near you (fewer than 5 within 25 mi) list the 25-50 mi jobs
   * nearest first with their distance (fartherAwaySplit.ts). Only under the
   * default order with no distance filter: an explicit sort or a radius is
   * the viewer's own order, and the split would override it or widen it.
   */
  splitFarther?: boolean;
}) {
  const { userLat, userLng } = common;
  const split = useMemo(
    () =>
      splitFarther
        ? splitFartherAway(jobs, userLat, userLng)
        : { ordered: jobs, fartherFrom: null, label: null, quietFrom: null, distanceLabels: new Map<string, string>() },
    [jobs, splitFarther, userLat, userLng],
  );
  return (
    <div
      className="px-0 lg:px-4 pt-1 lg:pt-3"
      style={{ paddingBottom: "calc(6rem + var(--safe-area-bottom, 0px))" }}
    >
      <VirtualizedJobList
        items={split.ordered}
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
            {i === split.fartherFrom && split.label && <FartherAwayDivider label={split.label} />}
            {i === split.quietFrom && <QuietLine />}
            {split.distanceLabels.has(job.id) && <AwayLabel label={split.distanceLabels.get(job.id)!} />}
            <JobFeedCard job={job} index={i} hero={i === 0} recommended={job.id === recommendedBadgeId} common={common} />
          </div>
        )}
      />
      {footer}
    </div>
  );
}

/** "Farther away · 25–60 mi": a hairline rule either side of a small caps caption (board 6). */
/** "Quiet near you" line above the first farther-out job: its own spacing, like the divider, so the row keeps the list pitch. */
function QuietLine() {
  return <p data-quiet-line="" className="pt-1 pb-2 text-ds-13 text-muted-foreground">{QUIET_LINE}</p>;
}

/** "25 mi away" over a farther-out job. */
function AwayLabel({ label }: { label: string }) {
  return <p data-away-label="" className="pb-1 text-ds-12 font-semibold text-muted-foreground">{label}</p>;
}

function FartherAwayDivider({ label }: { label: string }) {
  return (
    <div role="separator" aria-label={label} className="flex items-center gap-3 pt-2 pb-list">
      <span className="h-px flex-1 bg-border" aria-hidden />
      <span className="text-ds-11 font-semibold uppercase tracking-wide text-muted-foreground" aria-hidden>
        {label}
      </span>
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}
