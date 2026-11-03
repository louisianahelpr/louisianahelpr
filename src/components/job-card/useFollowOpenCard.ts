import { useEffect, useMemo, useRef } from "react";
import type { AppliedApp, Job } from "./activityConstants";
import { appliedActivityBucket, jobIsUnfundedDraft, postedActivityBucket } from "./activityFilters";

/**
 * AN OPEN CARD FOLLOWS ITS JOB INTO ITS NEW BUCKET (e2e-journeys 41728838626, 11-03).
 *
 * The Helpr opened the revision job from `/jobs?tab=working&job=<id>&open=1`. The first list read was a beat
 * behind, so the link resolved it to Waiting and the card opened there. Seconds later the list refreshed, the
 * job (now revision_requested) moved to Needs you, and the open card vanished from under the Helpr: the Waiting
 * filter stayed selected and the screen showed only other jobs. The same thing happens whenever a job changes
 * bucket while its card is open (the other side acts, a realtime refresh lands).
 *
 * Rule: when a card that is OPEN, and was showing in the selected bucket, moves to a different bucket, the
 * selected bucket follows it. Cards that were not showing (open under another bucket earlier) never move the
 * filter, and "all" shows every bucket, so it never needs to move.
 */
export function followedBucket(
  prev: ReadonlyMap<string, string>,
  open: ReadonlySet<string>,
  now: ReadonlyMap<string, string>,
  filter: string,
): string | null {
  if (filter === "all") return null;
  for (const id of open) {
    const was = prev.get(id);
    const is = now.get(id);
    if (was === filter && is && is !== filter) return is;
  }
  return null;
}

export function useFollowOpenCard(opts: {
  tab: "posted" | "applied";
  postedJobs: ReadonlyArray<Job>;
  appliedApps: ReadonlyArray<AppliedApp>;
  pendingApplicantCounts?: Record<string, number> | null;
  expandedJobIds: ReadonlySet<string>;
  statusFilter: string;
  setStatusFilter: (bucket: string) => void;
}): void {
  const { tab, postedJobs, appliedApps, pendingApplicantCounts, expandedJobIds, statusFilter, setStatusFilter } = opts;
  // Job id -> the bucket it is in right now, on this tab (Working cards open by JOB id too).
  const buckets = useMemo(() => {
    const m = new Map<string, string>();
    if (tab === "posted") {
      for (const j of postedJobs) {
        if (!jobIsUnfundedDraft(j)) m.set(j.id, postedActivityBucket(j, pendingApplicantCounts?.[j.id] ?? 0));
      }
    } else {
      for (const a of appliedApps) m.set(a.job_id, appliedActivityBucket(a));
    }
    return m;
  }, [tab, postedJobs, appliedApps, pendingApplicantCounts]);
  const last = useRef<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    const to = followedBucket(last.current, expandedJobIds, buckets, statusFilter);
    last.current = buckets;
    if (to) setStatusFilter(to);
  }, [buckets, expandedJobIds, statusFilter, setStatusFilter]);
}
