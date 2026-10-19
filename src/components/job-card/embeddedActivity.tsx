import type { ReactNode } from "react";
import { StatusBoxes } from "@/components/sections/StatusBoxes";
import { POSTED_GROUP_LABEL, WORKING_GROUP_LABEL } from "@/components/job-card/ActivityBucketGroups";
import { JobsListLoadingFrame } from "@/components/JobsSectionSkeleton";

/** The four status boxes over Jobs & Posts > Posted / Working (owner, 2026-10-19). */
export const BOX_BUCKETS = ["needs_you", "waiting", "scheduled", "done"] as const;

/** Tap a status box = only that group; tap the lit box again = every group ("all"). */
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
}: {
  header: ReactNode;
  tab: "posted" | "applied";
  statusFilter: string;
  counts: Record<string, number>;
  onFilter: (next: string) => void;
}) {
  const labels = tab === "posted" ? POSTED_GROUP_LABEL : WORKING_GROUP_LABEL;
  const value = (BOX_BUCKETS as readonly string[]).includes(statusFilter) ? (statusFilter as (typeof BOX_BUCKETS)[number]) : null;
  return (
    <div className="flex flex-col gap-3 pb-1">
      {header}
      <StatusBoxes
        boxes={BOX_BUCKETS.map((k) => ({ key: k, label: labels[k], count: counts[k] ?? 0, hot: k === "needs_you" }))}
        value={value}
        onToggle={(k) => onFilter(nextBoxFilter(statusFilter, k))}
      />
    </div>
  );
}

/** While the list loads, the section's top bar + tabs stay put over status-box and card bones (JobsSectionSkeleton). */
export function EmbeddedActivityLoading({ header, tab }: { header: ReactNode; tab: "posted" | "applied" }) {
  return <JobsListLoadingFrame header={header} tab={tab} />;
}
