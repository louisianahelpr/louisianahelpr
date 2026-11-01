import { useState, type ReactNode } from "react";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { StatusBoxes } from "@/components/sections/StatusBoxes";
import { InlineListSearch } from "@/components/sections/InlineListSearch";
import { SearchTriggerSlot } from "@/components/ui/ScreenHeaderRow";
import { JOBS_TOOLBAR_ROW } from "@/components/sections/jobsToolbar";
import { POSTED_GROUP_LABEL, WORKING_GROUP_LABEL } from "@/components/job-card/ActivityBucketGroups";
import { JobsListLoadingFrame } from "@/components/JobsSectionSkeleton";

/**
 * The status chips over Jobs & Posts > Posted / Working (owner, 2026-10-19), after "All": every bucket, in the job's
 * own order. "Cancelled" joined them on 2026-10-28 (owner: "are we missing a button for cancelled?"); it wears each
 * tab's own word for that bucket (Posted "Cancelled", Working "Not picked"), and its count shows only when there is
 * one, like Done's. The collapsed Cancelled row at the foot of All stays, as Done's does: All is the overview, the
 * chip is the filter. Guard: src/test/activityOpensOnFirstBucketWithItems.test.ts.
 */
export const BOX_BUCKETS = ["needs_you", "waiting", "scheduled", "done", "cancelled"] as const;

/**
 * The status filters with the SAME words the status boxes show (H4, Cowork
 * audit 2026-10-20): the empty state and its jump button used the old filter
 * labels ("Scheduled") under boxes that say Upcoming / Booked / Not picked.
 */
export function boxLabelledFilters<F extends { key: string; label: string }>(tab: "posted" | "applied", filters: readonly F[]): F[] {
  const words: Record<string, string> = tab === "posted" ? POSTED_GROUP_LABEL : WORKING_GROUP_LABEL;
  return filters.map((f) => ({ ...f, label: words[f.key] ?? f.label }));
}

/** Tap a status chip = only that group; tap the lit chip again (or All) = every group ("all"). */
export function nextBoxFilter(current: string, tapped: string): string {
  return current === tapped ? "all" : tapped;
}

/**
 * The section's top bar + tabs. Jobs hands a function (JobsSection's makeHeader) so the tab's search can ride in the
 * tabs row; a plain node (component tests) is drawn as is, with no search in it.
 */
export type EmbeddedHeader = ReactNode | ((row?: { end?: ReactNode; onlySelected?: boolean }) => ReactNode);

/** The section's top bar + tabs (with this tab's search icon beside the gear), then the status boxes that filter the list. */
export function EmbeddedActivityHeader({
  header,
  tab,
  statusFilter,
  counts,
  onFilter,
  search,
  onSearch,
}: {
  header: EmbeddedHeader;
  tab: "posted" | "applied";
  statusFilter: string;
  counts: Record<string, number>;
  onFilter: (next: string) => void;
  /** The tab's own list search (useActivityFilters' searchQuery, mirrored to ?q=). */
  search: string;
  onSearch: (next: string) => void;
}) {
  const labels = tab === "posted" ? POSTED_GROUP_LABEL : WORKING_GROUP_LABEL;
  // While the search field is open on a phone the TABS row keeps only its selected tab and the field takes the rest
  // (Browse's rule, Dashboard's phoneBrowseEnd; audit F20 was the same squeeze in the old chip-row place). Desktop has room.
  const desktop = useIsWebDesktop();
  const [searchOpen, setSearchOpen] = useState(false);
  const value = (BOX_BUCKETS as readonly string[]).includes(statusFilter) ? (statusFilter as (typeof BOX_BUCKETS)[number]) : null;
  // THE SEARCH SITS BESIDE THE GEAR (owner 2026-10-31, Jobs > Posted at 375: "move it up into the tab row next to the
  // gear"): the icon ends the tabs row before the gear, as on Browse (owner 2026-10-28: "search and filter should be
  // next to gear"), and still opens IN PLACE, leftward (owner 2026-10-27). While the field is open the magnifier's 40px
  // box is HELD after it (src/test/searchDismissAndOverlay.test.tsx), so a tap on the X never lands on the trigger.
  // Guards: src/test/jobsSearchIsAnIcon.test.tsx, src/test/searchKeepsLitChip.test.tsx.
  const searchEnd = (
    <div data-activity-search-controls="" className={`flex items-center gap-0 self-center ${searchOpen ? "ml-2 min-w-0 flex-1" : "-ml-1 shrink-0"}`}>
      <InlineListSearch value={search} onChange={onSearch} label={tab === "posted" ? "Search posted jobs" : "Search jobs you're working"} onOpenChange={setSearchOpen} fill />
      {searchOpen && <SearchTriggerSlot width="40px" />}
    </div>
  );
  return (
    <div className="flex flex-col gap-4">
      {typeof header === "function" ? header({ end: searchEnd, onlySelected: searchOpen && !desktop }) : header}
      {/* The same row box as Browse's "N jobs" row (jobsToolbar.ts, owner 2026-10-27). */}
      <div data-jobs-toolbar="" className={JOBS_TOOLBAR_ROW}>
        <div className="min-w-0 flex-1">
          <StatusBoxes
            boxes={BOX_BUCKETS.map((k) => ({ key: k, label: labels[k], count: counts[k] ?? 0, hot: k === "needs_you" }))}
            value={value}
            onToggle={(k) => onFilter(nextBoxFilter(statusFilter, k))}
            // `all` is the length of the very list "All" shows (activityFilters: postedJobs.length / appliedApps.length).
            allCount={counts.all}
            emptyLine={false}
            // HELP-WORKIN (lead 10-31): the same right-edge fade as Declutter's chip row (AUD31-4); at 360 the 4th chip
            // starts past the edge, and the fade says the row scrolls.
            fade
          />
        </div>
      </div>
    </div>
  );
}

/** While the list loads, the section's top bar + tabs stay put over status-box and card bones (JobsSectionSkeleton). */
export function EmbeddedActivityLoading({ header, tab }: { header: EmbeddedHeader; tab: "posted" | "applied" }) {
  return <JobsListLoadingFrame header={typeof header === "function" ? header() : header} tab={tab} />;
}
