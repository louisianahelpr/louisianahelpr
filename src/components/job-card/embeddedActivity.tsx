import type { ReactNode } from "react";
import { StatusBoxes } from "@/components/sections/StatusBoxes";
import { InlineListSearch } from "@/components/sections/InlineListSearch";
import { JOBS_TOOLBAR_ROW } from "@/components/sections/jobsToolbar";
import { POSTED_GROUP_LABEL, WORKING_GROUP_LABEL } from "@/components/job-card/ActivityBucketGroups";
import { JobsListLoadingFrame } from "@/components/JobsSectionSkeleton";

/** The four status boxes over Jobs & Posts > Posted / Working (owner, 2026-10-19). */
export const BOX_BUCKETS = ["needs_you", "waiting", "scheduled", "done"] as const;

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

/** The section's top bar + tabs, then the status boxes that filter the list. */
export function EmbeddedActivityHeader({
  header,
  tab,
  statusFilter,
  counts,
  onFilter,
  search,
  onSearch,
}: {
  header: ReactNode;
  tab: "posted" | "applied";
  statusFilter: string;
  counts: Record<string, number>;
  onFilter: (next: string) => void;
  /** The tab's own list search (useActivityFilters' searchQuery, mirrored to ?q=). */
  search: string;
  onSearch: (next: string) => void;
}) {
  const labels = tab === "posted" ? POSTED_GROUP_LABEL : WORKING_GROUP_LABEL;
  const value = (BOX_BUCKETS as readonly string[]).includes(statusFilter) ? (statusFilter as (typeof BOX_BUCKETS)[number]) : null;
  return (
    <div className="flex flex-col gap-4">
      {header}
      {/* The same row box as Browse's "N jobs" row (jobsToolbar.ts, owner 2026-10-27). */}
      <div data-jobs-toolbar="" className={JOBS_TOOLBAR_ROW}>
        <div className="min-w-0 flex-1">
          <StatusBoxes
            boxes={BOX_BUCKETS.map((k) => ({ key: k, label: labels[k], count: counts[k] ?? 0, hot: k === "needs_you" }))}
            value={value}
            onToggle={(k) => onFilter(nextBoxFilter(statusFilter, k))}
            // `all` is the length of the very list "All" shows (activityFilters: postedJobs.length / appliedApps.length).
            allCount={counts.all}
            // Search is an ICON at the row's end, like Browse's (owner 2026-10-25: "i prefer the search not expanded"),
            // and it opens IN PLACE, leftward out of the icon (owner 2026-10-27: "search should just open where its at").
            end={<InlineListSearch value={search} onChange={onSearch} label={tab === "posted" ? "Search posted jobs" : "Search jobs you're working"} />}
          />
        </div>
      </div>
    </div>
  );
}

/** While the list loads, the section's top bar + tabs stay put over status-box and card bones (JobsSectionSkeleton). */
export function EmbeddedActivityLoading({ header, tab }: { header: ReactNode; tab: "posted" | "applied" }) {
  return <JobsListLoadingFrame header={header} tab={tab} />;
}
