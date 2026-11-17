import { useEffect, useState } from "react";
import { postedTabChunkReady } from "@/components/job-card/activityTabChunks";
import { postedActivityBucket } from "@/components/job-card/activityFilters";
import { PostedListBones } from "@/components/ui/skeletons/ApplicationCardSkeleton";

/**
 * Q2705 (2026-11-17): Jobs > Posted paints its first cards from the LEAN posted core (useActivityData `partial`) while
 * the whole list loads. prod-audit 44032555275 read the first card at 10872 ms; cwv-lab (`npm run build`, Slow 4G + 4x,
 * 375, median of 3) 8848 -> 5084 ms. JobListPage's pieces of it live here (componentSizeRatchet: that file stays
 * under 600 lines).
 */

/** The filters the lean posted core holds whole ("all" draws its Done and Cancelled groups once the whole list lands). */
const LEAN_FIRST_FILTERS: ReadonlySet<string> = new Set(["all", "needs_you", "waiting", "scheduled"]);

/**
 * Posted may paint from the lean core only when the view needs nothing outside it: no deep link (each resolves against
 * the whole list), no search (it searches every job), and a filter the lean set holds whole (All, whose Done and
 * Cancelled groups join when the whole read lands, or Needs you / Waiting / Upcoming). Otherwise the list waits for the
 * whole read, as before.
 */
function isLeanFirstView(v: LeanFirstView): boolean {
  return v.tab === "posted" && !v.deepLinkJobId && !v.highlightJobId && !v.manageJobId && !v.applicantsJobId
    && !v.searchQuery.trim() && LEAN_FIRST_FILTERS.has(v.statusFilter);
}
type LeanFirstView = {
  tab: string; deepLinkJobId: string | null; highlightJobId: string | null; manageJobId: string | null;
  applicantsJobId: string | null; searchQuery: string; statusFilter: string;
};

/**
 * JobListPage's one call: whether this view may paint from the lean core (`leanFirst`), and whether the Posted tab's
 * chunk is in (`postedTabIn`; until then a lean-first load holds the whole posted read, useActivityData `holdWhole`).
 */
export function usePostedLeanFirst(v: LeanFirstView): { leanFirst: boolean; postedTabIn: boolean } {
  return { leanFirst: isLeanFirstView(v), postedTabIn: usePostedTabIn(v.tab) };
}

/** While the lean first cards show, All, Done and Cancelled print no count yet; the three lean groups' are the whole list's. */
export function leanFirstCounts(counts: Record<string, number>, partial: boolean): Record<string, number> {
  return partial ? { ...counts, all: 0, done: 0, cancelled: 0 } : counts;
}

/** True once the Posted tab's chunk is in; until then a lean-first load holds the whole posted read (`holdWhole`). */
function usePostedTabIn(tab: string): boolean {
  const [postedTabIn, setPostedTabIn] = useState(false);
  useEffect(() => {
    if (tab !== "posted") return;
    let live = true;
    void postedTabChunkReady().then(() => { if (live) setPostedTabIn(true); });
    return () => { live = false; };
  }, [tab]);
  return postedTabIn;
}

/**
 * The titles of the cards the Posted list draws first, in its order: on "All" (grouped, ActivityBucketGroups) the first
 * open group's first PREVIEW cards; on one status (flat) the list's first four.
 */
const BONES_GROUP_ORDER = ["needs_you", "waiting", "scheduled"] as const;
type BonesJob = Parameters<typeof postedActivityBucket>[0] & { id: string; title?: string | null };
function firstCardTitles(jobs: readonly BonesJob[], filter: string, pending: Record<string, number> | undefined): string[] {
  const title = (j: { title?: string | null }) => j.title ?? "";
  if (filter !== "all") return jobs.slice(0, 4).map(title);
  for (const b of BONES_GROUP_ORDER) {
    const group = jobs.filter((j) => postedActivityBucket(j, pending?.[j.id] ?? 0) === b);
    if (group.length) return group.slice(0, 3).map(title);
  }
  return [];
}

/**
 * The rows are read but the cards' code (PostedJobsTab's chunk) is still on its way: the MineJobFace-shaped bones,
 * carrying the first cards' real titles. Drawn by JobListPage directly, not only as its Suspense fallback: measured
 * (cwv-lab, local build, 375), that fallback never reached the screen while the chunk loaded (the list stayed blank
 * from 5.0 to 8.0 s).
 */
export function PostedTitleBones({ jobs, filter, pending }: { jobs: readonly BonesJob[]; filter: string; pending: Record<string, number> | undefined }) {
  return (
    <div className="px-0">
      <PostedListBones filter={filter} titles={firstCardTitles(jobs, filter, pending)} />
    </div>
  );
}
