import AppShell from "@/components/AppShell";
import { ProfilePageSkeleton } from "@/components/SkeletonLoaders";

/**
 * Suspense fallback for the `/profile` route's lazy chunk.
 *
 * Same defect and same fix as DashboardRouteSkeleton / ActivityRouteSkeleton:
 * `/profile` used routeEl's default `RouteSuspenseFallback`, so a cold
 * 375x812 slow-3G load painted the generic bones column (no shell, no header
 * inset, no dock clearance) → Profile.tsx's own `loading` branch → content.
 * Three frames, two of them different shapes.
 *
 * This is Profile.tsx's `loading` branch (`Profile.tsx:513-530`) lifted into
 * the eager bundle: the SAME `AppShell` props, the SAME container string, the
 * SAME `ProfilePageSkeleton`. Profile is the one main screen not built on
 * PageScaffold, so this must use AppShell directly — matching the page, per
 * CLAUDE.md's shell rule. `/profile` is correctly absent from
 * DOCUMENT_SCROLL_ROUTES (AppShell owns its own internal scroll container),
 * and this fallback does not change that.
 *
 * Cheap to import eagerly: AppShell is already in the entry chunk (PageScaffold
 * wraps it for DashboardRouteSkeleton) and SkeletonLoaders imports nothing but
 * the Skeleton primitive.
 */
const ProfileRouteSkeleton = () => (
  <div role="status" aria-live="polite" aria-busy="true" data-testid="profile-route-skeleton">
    <span className="sr-only">Loading your profile…</span>
    <AppShell
      scrollable={false}
      contentClassName="overflow-hidden"
      className="bg-premium-page pt-safe-top"
    >
      <div
        className="container mx-auto px-5 lg:px-8 xl:px-12 pt-3 lg:pt-5 pb-4 flex-1 min-h-0 overflow-y-auto"
        aria-hidden
      >
        <div className="page-measure mx-auto">
          <ProfilePageSkeleton />
        </div>
      </div>
    </AppShell>
  </div>
);

export default ProfileRouteSkeleton;
