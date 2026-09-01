import { Skeleton } from "@/components/ui/skeleton";
import { DashboardSkeleton } from "@/components/SkeletonLoaders";
import { PageScaffold } from "@/components/ui/PageScaffold";
import { TITLE_BAR_PADDING } from "@/components/dashboard/DashboardTitleBar";
import HelprMark from "@/components/HelprMark";

/**
 * Suspense / auth-pending fallback for the `/dashboard` route.
 *
 * Owner: "the home dashboard webpage goes through like 3 different loading
 * screens then opens." Measured cause: three DIFFERENT-shaped surfaces
 * rendered in sequence before real content —
 *
 *   1. the generic `RouteSuspenseFallback` bones (routeEl's default
 *      Suspense fallback, shown while the Dashboard chunk downloads)
 *   2. Dashboard.tsx's OWN `loading` branch — PageScaffold + a real title
 *      bar + `DashboardSkeleton` (shown once the chunk has loaded but the
 *      feed query hasn't resolved)
 *   3. the real Dashboard
 *
 * (1) and (2) are visually unrelated shapes (an unaligned bones column vs.
 * the actual two-card PageScaffold), so the chunk-download → data-load
 * handoff read as a whole extra loading screen even though Dashboard.tsx's
 * own comment already promises "loading state mirrors the exact loaded
 * layout" — that promise just didn't cover the moment before the chunk
 * itself had arrived.
 *
 * This component holds that promise one step earlier: it is built ONLY from
 * pieces already cheap to import eagerly (Skeleton primitives, HelprMark —
 * an image + Link, no Supabase) so it can sit in App.tsx's entry bundle and
 * paint instantly, in the exact shape Dashboard.tsx's `loading` branch uses
 * (PageScaffold, `TITLE_BAR_PADDING`, `DashboardSkeleton`). The one thing it
 * does NOT reuse is `DashboardTitleBar` itself — that component pulls in
 * `NotificationPanel`, which queries Supabase for the unread count, and
 * doing that eagerly would put Supabase back on this route's entry chunk.
 * A static emblem + bell-shaped bone holds the same 44px row instead.
 *
 * Used as BOTH:
 *   - the `/dashboard` route's Suspense fallback (`routeEl`'s second arg
 *     in App.tsx), replacing the generic `RouteSuspenseFallback` for this
 *     route only
 *   - `ProtectedRoute`'s `fallback` prop on that same route, so the (rare,
 *     cold-direct-load) moment where auth is still resolving AFTER the
 *     chunk has already loaded shows the same shape too, instead of a
 *     third one.
 */
const DashboardRouteSkeleton = () => (
  <div role="status" aria-live="polite" aria-busy="true" data-testid="dashboard-route-skeleton">
    <span className="sr-only">Loading…</span>
    <PageScaffold
      animate
      panelElevation="raised"
      titleCard={
        <div className="flex items-center justify-between" aria-hidden>
          <HelprMark to={null} emblemOnly size="md" />
          <Skeleton className="h-11 w-11 rounded-full" />
        </div>
      }
      titleCardClassName={TITLE_BAR_PADDING}
    >
      <DashboardSkeleton />
    </PageScaffold>
  </div>
);

export default DashboardRouteSkeleton;
