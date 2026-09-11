import { Skeleton } from "@/components/ui/skeleton";
import { ActivityCardSkeleton } from "@/components/SkeletonLoaders";
import { ApplicationCardSkeleton } from "@/components/ui/skeletons/ApplicationCardSkeleton";
import { PageScaffold } from "@/components/ui/PageScaffold";

/**
 * Suspense fallback for the `/my-jobs` and `/my-posts` routes' lazy chunk.
 *
 * Same defect, same fix as DashboardRouteSkeleton — read that file's header
 * first. Measured on a cold 375x812 slow-3G load, `/my-jobs` painted THREE
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
 * Built only from pieces already cheap to import eagerly (Skeleton
 * primitives + PageScaffold, which App.tsx already pulls in for
 * DashboardRouteSkeleton). It deliberately does NOT import `ActivityHeader`
 * — that module drags lucide icons, UnderlineTabs, ScreenHeaderRow and the
 * haptics bridge onto the entry chunk for a padding string.
 *
 * `/my-jobs` and `/my-posts` are AppShell (via PageScaffold) routes and are
 * correctly ABSENT from DOCUMENT_SCROLL_ROUTES; this fallback uses the same
 * primitive, so the shell choice still agrees with that list.
 */
const ActivityRouteSkeleton = ({ tab = "applied" }: { tab?: "applied" | "posted" }) => (
  <div role="status" aria-live="polite" aria-busy="true" data-testid="activity-route-skeleton">
    <span className="sr-only">{tab === "posted" ? "Loading your posts…" : "Loading your jobs…"}</span>
    <PageScaffold
      // Character-for-character the value ActivityHeader exports as
      // ACTIVITY_HEADER_PADDING (src/pages/activity/ActivityHeader.tsx).
      // Inlined rather than imported for the bundle reason above; if that
      // constant ever changes, change it here too — the two must match or
      // the title card thumps taller/shorter at the handoff.
      titleCardClassName="!py-1.5 lg:!py-2"
      titleCard={
        <div className="flex items-center" style={{ minHeight: "44px" }} aria-hidden>
          <Skeleton className="h-4 w-32 rounded" />
        </div>
      }
    >
      <div className="px-4 pt-3 space-y-2.5" aria-hidden>
        {tab === "applied"
          ? [1, 2, 3, 4].map((i) => <ApplicationCardSkeleton key={i} />)
          : [1, 2, 3, 4].map((i) => <ActivityCardSkeleton key={i} />)}
      </div>
    </PageScaffold>
  </div>
);

export default ActivityRouteSkeleton;
