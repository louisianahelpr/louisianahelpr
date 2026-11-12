import type { ReactNode } from "react";
import { SectionAddButton } from "@/components/sections/AppTopBar";
import { Skeleton } from "@/components/ui/skeleton";
import { JOBS_TOOLBAR_ROW } from "@/components/sections/jobsToolbar";
import { DashboardSkeleton } from "@/components/SkeletonLoaders";
import { PostedListBones, WorkingListBones } from "@/components/ui/skeletons/ApplicationCardSkeleton";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { PageTitleBar, useHeaderInDesktopBar } from "@/components/header/PageTitleBar";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { jobChipsRowSeen } from "@/lib/jobChipsSeen";
import { EmptyStateSkeleton, useCachedListCount } from "@/components/ui/skeletons/EmptyStateSkeleton";
import type { AppliedActivity, PostedActivity } from "@/hooks/useActivityData";
import { SEARCH_BAR_PAD } from "@/components/sections/browseHeaderSpacing";

/**
 * ONE silhouette for the Jobs section (/jobs: Browse | Posted | Working), in
 * the three frames a cold open paints (owner, 2026-10-19; Q2205):
 *   1. the route fallback while the section's chunk downloads (default export,
 *      App.tsx through `skeletonOnDemand`);
 *   2. the list's own loading frame once the chunk is in (JobsListLoadingFrame,
 *      drawn by EmbeddedActivityLoading with the REAL top bar + tabs; the feed
 *      draws its own in Dashboard.tsx);
 *   3. the loaded screen.
 * All three share the scaffold, the header stack (top bar, tabs, then the
 * Browse search row or the four status boxes) and the list's padding, so the
 * only change a reader sees is bones -> content (VN-32). Import-light on
 * purpose: no Supabase, no NotificationPanel (the bell is a bone here).
 */

/**
 * Top bar (phone: title, bell, profile, then the search row; desktop: title, "+") + (desktop) the Browse | Posted |
 * Working tabs, as bones.
 * The Browse | Posted | Working tabs row is drawn on every width and tab (F152, owner audit 11-09).
 */
function JobsHeaderBones({ chips = false }: { chips?: boolean }) {
  const desktop = useIsWebDesktop();
  return (
    <div className="explore-header flex flex-col gap-1" aria-hidden>
      {/* The section header's top row. On the DESKTOP WEBSITE it is the settled bar itself: the real "Jobs" title in
          the global top bar with its soft "+ Post a job", no back arrow (owner 2026-10-28: the loading frame draws exactly the settled
          header; src/test/sectionLoadingHeaderIsSettled.test.tsx), then the tabs row. On a phone (the Vinted header,
          owner 11-08; one pattern since F148, owner UI audit 11-09): the title, then the bell and the photo, as bones,
          and the search as its own 44px row under the bar (AppTopBar's app-top-bar-search, 8px under it). */}
      <PageTitleBar
        title="Jobs"
        desktopGap={false}
        actions={<SectionAddButton section="jobs" />}
        phone={
          <>
            <div className="app-top-bar flex items-center justify-between gap-2 h-16">
              <span className="sr-only">Jobs</span>
              <Skeleton className="h-7 w-20 rounded-ds-md" />
              <div className="flex items-center gap-1 shrink-0">
                <span className="h-11 w-11 shrink-0 flex items-center justify-center">
                  <Skeleton className="h-6 w-6 rounded-full" />
                </span>
                <span className="h-11 w-11 shrink-0 flex items-center justify-center">
                  <Skeleton className="w-9 h-9 rounded-full" />
                </span>
              </div>
            </div>
            <div className={`${SEARCH_BAR_PAD} min-w-0`}>
              <Skeleton className="h-11 w-full rounded-full" />
            </div>
          </>
        }
      />
      {/* SectionTabs: thin underline tabs, 44px, on a phone too since F152 (owner audit 11-09). */}
      <Skeleton className="h-11 w-full rounded-ds-md" />
      {/* Browse's category chips row (phone; JobCategoryChips: 40px chips + 4px scroller pad), only when the last
          loaded Browse drew it (jobChipsSeen.ts), so the list does not jump down when the chips arrive. */}
      {!desktop && chips && (
        <div data-chips-bone="" className="flex min-w-0 gap-2 overflow-hidden pb-1">
          <Skeleton className="h-10 w-14 shrink-0 rounded-full" />
          <Skeleton className="h-10 w-24 shrink-0 rounded-full" />
          <Skeleton className="h-10 w-32 shrink-0 rounded-full" />
        </div>
      )}
    </div>
  );
}

/**
 * The status chips' row (StatusBoxes in embeddedActivity: one row of 44px chips in JOBS_TOOLBAR_ROW, 46px with the
 * scroller's 2px). Q1695: it drew the old four 64px status tiles, 18px taller than the chip row that replaced them;
 * the loading-states refresh of 2026-11-02 01:07Z measured /posts row 623 -> 641 (+18px) on both test accounts.
 * The bones are chip-sized: "All" and three bucket chips, the scroller's left inset and the row's own height.
 */
function StatusBoxBones() {
  return (
    <div data-jobs-toolbar="" className={JOBS_TOOLBAR_ROW} aria-hidden>
      <div className="min-w-0 flex-1 flex gap-2 overflow-hidden pl-1 pb-0.5">
        {["w-14", "w-28", "w-24", "w-28"].map((w, i) => (
          <Skeleton key={i} data-status-chip-bone="" className={`h-11 ${w} shrink-0 rounded-full`} />
        ))}
      </div>
    </div>
  );
}

/**
 * The Posted / Working list while it loads. A COLD visit (nothing in the query
 * cache) draws the empty state's outline, in the same `flex-1 min-h-0` box
 * JobListPage and ActivityEmptyState give the real one (owner 2026-10-05,
 * Q722; Working too since 2026-10-07, Q201 b). A warm visit keeps the cards,
 * at the loaded list's `px-4 pt-3 space-y-list` pitch (Q213a).
 */
function JobsListBodyBones({ tab }: { tab: "posted" | "applied" }) {
  const cachedPosts = useCachedListCount<PostedActivity>(["activity", "posted"], (d) => d.postedJobs?.length ?? 0);
  const cachedApps = useCachedListCount<AppliedActivity>(["activity", "applied"], (d) => d.appliedApps?.length ?? 0);
  const coldEmpty = tab === "posted" ? cachedPosts === 0 : cachedApps === 0;
  if (coldEmpty) {
    return (
      <div className="flex-1 min-h-0 pb-0 flex flex-col">
        <div className="flex-1 min-h-full flex">
          <EmptyStateSkeleton testId={tab === "posted" ? "posts-empty-skeleton" : "jobs-empty-skeleton"} />
        </div>
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 px-0 lg:px-4 pt-1 lg:pt-3 pb-0 space-y-list" aria-hidden>
      {tab === "applied"
        ? <WorkingListBones filter={filterFromUrl()} />
        : <PostedListBones filter={filterFromUrl()} />}
    </div>
  );
}

/**
 * Posted / Working loading frame: the header stack in the title card on phone,
 * inside the panel under a hairline on the desktop website — exactly where
 * JobListPage puts the loaded one.
 */
export function JobsListLoadingFrame({ header, tab }: { header: ReactNode; tab: "posted" | "applied" }) {
  const isWebDesktop = useIsWebDesktop();
  const head = (
    <div className="flex flex-col gap-4">
      {header}
      <StatusBoxBones />
    </div>
  );
  return (
    <PageScaffold animate oneBlur tightGutter titleCard={isWebDesktop ? undefined : head} titleCardClassName="">
      {isWebDesktop && (
        <div className="shrink-0 -ml-px -mt-px pb-1" style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.12)" }}>
          {/* Same corner as Browse and JobListPage (tabs never move, owner 2026-10-25). */}
          {head}
        </div>
      )}
      <div className="flex-1 min-h-0 flex flex-col" aria-busy="true">
        <JobsListBodyBones tab={tab} />
      </div>
    </PageScaffold>
  );
}

/** Browse loading frame: mirrors Dashboard.tsx's own `loading` branch (no search row on a phone since owner 2026-10-28). */
function BrowseFrame({ header }: { header: ReactNode }) {
  const isWebDesktop = useIsWebDesktop();
  return (
    <PageScaffold
      animate
      tightGutter
      tightPanelGap
      panelElevation="raised"
      // No search row under the tabs on any width (owner 2026-10-28): Browse's search is an icon in the tabs row.
      titleCard={header}
      titleCardClassName=""
    >
      {isWebDesktop ? (
        <div className="flex flex-1 min-h-0 overflow-hidden">
          <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
            <div
              className="shrink-0 flex items-center gap-2 px-4 py-2"
              style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.12)" }}
              aria-hidden
            >
              <div className="h-10" />
            </div>
            <DashboardSkeleton />
          </div>
        </div>
      ) : (
        <DashboardSkeleton />
      )}
    </PageScaffold>
  );
}

/** The Working list's status filter from the URL (JobListPage reads `filter` the same way; absent is "all"). Q833. */
function filterFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("filter");
}

/** Which tab a cold /jobs URL will open on — JobsSection.resolveJobsTab's rule, read before its chunk exists. */
function tabFromUrl(): "browse" | "posted" | "working" {
  if (typeof window === "undefined") return "browse";
  if (window.location.pathname.startsWith("/posts")) return "posted"; // /posts redirects to ?tab=posted
  const p = new URLSearchParams(window.location.search);
  const t = p.get("tab");
  if (t === "posted" || t === "working") return t;
  if (t) return "browse";
  return ["job", "filter", "highlight", "q"].some((k) => p.has(k)) ? "working" : "browse";
}

/** The /jobs route fallback (and ProtectedRoute's, on the same route). */
const JobsSectionSkeleton = () => {
  const tab = tabFromUrl();
  // On the desktop website the real "Jobs" h1 is in the top bar (PageTitleBar above), so this one stays out.
  const titleInBar = useHeaderInDesktopBar();
  return (
    <div role="status" aria-live="polite" aria-busy="true" data-testid="jobs-route-skeleton">
      {/* The screen's one <h1> while pending on a phone (the chips row there has no visible title). */}
      {!titleInBar && <h1 className="sr-only">Jobs</h1>}
      <span className="sr-only">Loading Jobs…</span>
      {tab === "browse" ? (
        <BrowseFrame header={<JobsHeaderBones chips={jobChipsRowSeen()} />} />
      ) : (
        <JobsListLoadingFrame header={<JobsHeaderBones />} tab={tab === "posted" ? "posted" : "applied"} />
      )}
    </div>
  );
};

export default JobsSectionSkeleton;
