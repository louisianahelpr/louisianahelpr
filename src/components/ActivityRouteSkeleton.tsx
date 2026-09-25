import { ActivityPageSkeleton } from "@/components/ActivityPageSkeleton";

/**
 * Suspense fallback for the `/jobs` and `/posts` routes' lazy chunk.
 *
 * Same defect, same fix as DashboardRouteSkeleton — read that file's header
 * first. Measured on a cold 375x812 slow-3G load, `/jobs` painted THREE
 * unrelated shapes before content:
 *
 *   1. the generic `RouteSuspenseFallback` (an unaligned bones column: no
 *      title card, no panel, no dock) while the Activity chunk downloads
 *   2. Activity.tsx's OWN `loading` branch — PageScaffold + title card +
 *      card-shaped bones — once the chunk landed but the queries had not
 *   3. the real page
 *
 * (1) is the frame that does not belong. This component IS (2), lifted into
 * the eager bundle so it can paint before the chunk exists: the same
 * `PageScaffold`, the same title-card padding, the same card skeletons, in
 * the same order. The chunk therefore lands INTO the frame it is going to
 * keep, and the only remaining visible change is bones → content.
 *
 * Built from Skeleton primitives + PageScaffold, through ActivityPageSkeleton,
 * which reads the title-card padding from each tab's own header module
 * (src/pages/posts/PostsHeader, src/pages/jobs/JobsHeader). App.tsx imports
 * this file through `skeletonOnDemand`.
 *
 * `/jobs` and `/posts` are AppShell (via PageScaffold) routes and are
 * correctly ABSENT from DOCUMENT_SCROLL_ROUTES; this fallback uses the same
 * primitive, so the shell choice still agrees with that list.
 */
const ActivityRouteSkeleton = ({ tab = "applied" }: { tab?: "applied" | "posted" }) => (
  <div role="status" aria-live="polite" aria-busy="true" data-testid="activity-route-skeleton">
    <span className="sr-only">{tab === "posted" ? "Loading your posts…" : "Loading your jobs…"}</span>
    <ActivityPageSkeleton tab={tab} />
  </div>
);

export default ActivityRouteSkeleton;
