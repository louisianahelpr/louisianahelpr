import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ActivityCardSkeleton, DashboardSkeleton } from "@/components/SkeletonLoaders";
import { ApplicationCardSkeleton } from "@/components/ui/skeletons/ApplicationCardSkeleton";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { EmptyStateSkeleton, useCachedListCount } from "@/components/ui/skeletons/EmptyStateSkeleton";
import type { AppliedActivity, PostedActivity } from "@/hooks/useActivityData";

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

/** Top bar (title, "+", bell, profile) + the Browse | Posted | Working toggle, as bones. */
function JobsHeaderBones() {
  return (
    <div className="explore-header flex flex-col gap-1" aria-hidden>
      {/* The Explore header's top row (AppTopBar `section`, phone): `app-top-bar h-12`, the section chips, the bell,
          the photo. The desktop bar keeps its title + "+" bones (the chips are phone only). */}
      <div className="app-top-bar flex items-center gap-1 h-12">
        <Skeleton className="explore-switcher-bone h-12 min-w-0 flex-1 rounded-full" />
        <Skeleton className="top-bar-title-bone h-8 w-[4.5rem] rounded-ds-md" />
        {/* The section "+" bone: desktop only, like the "+" itself (phones create from the bottom bar's center "+"). */}
        <Skeleton className="top-bar-add-bone w-10 h-10 rounded-full" />
        <span className="h-11 w-11 shrink-0 flex items-center justify-center">
          <Skeleton className="h-6 w-6 rounded-full" />
        </span>
        <span className="h-10 w-10 shrink-0 flex items-center justify-center">
          <Skeleton className="w-9 h-9 rounded-full" />
        </span>
      </div>
      {/* SectionTabs: thin underline tabs, 44px. */}
      <Skeleton className="h-11 w-full rounded-ds-md" />
    </div>
  );
}

/** The four status boxes (StatusBoxes: border + py-2.5 + 24px count + 2px + 16px label = 64px). */
function StatusBoxBones() {
  return (
    <div className="grid gap-2 grid-cols-4" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-16 rounded-2xl" />
      ))}
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
        ? [1, 2, 3, 4].map((i) => <ApplicationCardSkeleton key={i} />)
        : [1, 2, 3, 4].map((i) => <ActivityCardSkeleton key={i} />)}
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
    <PageScaffold animate oneBlur titleCard={isWebDesktop ? undefined : head} titleCardClassName="">
      {isWebDesktop && (
        <div className="shrink-0 px-5 py-1" style={{ borderBottom: "1px solid hsl(var(--olivewood) / 0.12)" }}>
          {head}
        </div>
      )}
      <div className="flex-1 min-h-0 flex flex-col" aria-busy="true">
        <JobsListBodyBones tab={tab} />
      </div>
    </PageScaffold>
  );
}

/** Browse loading frame: mirrors Dashboard.tsx's own `loading` branch (search row on phone, feed strip on desktop). */
function BrowseFrame({ header }: { header: ReactNode }) {
  const isWebDesktop = useIsWebDesktop();
  return (
    <PageScaffold
      animate
      panelElevation="raised"
      titleCard={
        <div className="flex flex-col gap-4">
          {header}
          {/* BrowseCompactSearchRow: one `h-10` pill. */}
          {!isWebDesktop && <Skeleton className="h-10 w-full rounded-full" aria-hidden />}
        </div>
      }
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
  return (
    <div role="status" aria-live="polite" aria-busy="true" data-testid="jobs-route-skeleton">
      {/* The screen's one <h1> while pending (the title is a bone here). */}
      <h1 className="sr-only">Jobs</h1>
      <span className="sr-only">Loading Jobs…</span>
      {tab === "browse" ? (
        <BrowseFrame header={<JobsHeaderBones />} />
      ) : (
        <JobsListLoadingFrame header={<JobsHeaderBones />} tab={tab === "posted" ? "posted" : "applied"} />
      )}
    </div>
  );
};

export default JobsSectionSkeleton;
