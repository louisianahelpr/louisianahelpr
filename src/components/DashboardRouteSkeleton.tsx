import AppShell from "@/components/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import HelprMark from "@/components/HelprMark";

/**
 * Suspense / auth-pending fallback for the `/home` route, which is the Home
 * DASHBOARD now (owner final decisions, 2026-10-19), not the job feed.
 *
 * It mirrors src/pages/home/HomeDashboard.tsx the way JobsSectionSkeleton
 * mirrors Jobs (Q2214): the same SectionScreen frame (AppShell, the container,
 * the page-measure scroll column), the same top bar on Home (AppTopBar: the
 * emblem on the left, the bell, the profile avatar at the far right; no "+"),
 * then the greeting, the Next up card, the "Your sections" 2x2 tiles and
 * Coming up, so a cold /home goes bones -> content with nothing moving. The
 * old version drew the retired feed's title bar (emblem + search, filters,
 * bell), so a cold /home showed one shape and then another.
 *
 * Import-light on purpose so it can paint before the Home chunk: no Supabase,
 * no NotificationPanel, no useCurrentUser (the bell and avatar are bones).
 * Guard: src/test/routeSkeletonMirrorsItsTitleBar.test.ts.
 *
 * Used as the `/home` route's Suspense fallback and ProtectedRoute fallback,
 * and as MarketingRedirect's fallback on `/` and `/browse` (a signed-in visitor
 * there is on the way to Home).
 */
const DashboardRouteSkeleton = () => (
  <div role="status" aria-live="polite" aria-busy="true" data-testid="dashboard-route-skeleton">
    <span className="sr-only">Loading…</span>
    {/* SectionScreen's frame, class for class. */}
    <AppShell scrollable={false} contentClassName="overflow-hidden" className="bg-premium-page pt-safe-top">
      <div className="container mx-auto px-5 lg:px-6 xl:px-6 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden" aria-hidden>
        <div className="page-measure w-[calc(100%+1.5rem)] h-full overflow-hidden px-3 -mx-3 pb-safe-nav">
          {/* AppTopBar on Home: emblem left; bell (h-11) + avatar (h-10) right. */}
          <div className="app-top-bar flex items-center justify-between gap-2 h-16">
            <HelprMark to={null} size="sm" emblemOnly className="shrink-0" />
            <div className="flex items-center gap-1 min-[360px]:gap-1.5 shrink-0">
              <span className="h-11 w-11 flex items-center justify-center">
                <Skeleton className="h-6 w-6 rounded-full" />
              </span>
              <span className="h-10 w-10 flex items-center justify-center">
                <Skeleton className="w-9 h-9 rounded-full" />
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-4 pt-1 pb-6">
            <div className="flex flex-col gap-section">
              {/* Greeting (text-page-title) + the date line. */}
              <div>
                <Skeleton className="h-8 w-56 max-w-full rounded-ds-md" />
                <Skeleton className="h-4 w-32 mt-1.5 rounded-ds-md" />
              </div>
              {/* The Next up card: label, title, one line, the action pill. */}
              <div className="liquid-glass p-card flex flex-col gap-1.5" data-skeleton="next-up">
                <Skeleton className="h-3.5 w-16 rounded-ds-md" />
                <Skeleton className="h-6 w-48 max-w-full rounded-ds-md" />
                <Skeleton className="h-4 w-40 max-w-full rounded-ds-md" />
                <Skeleton className="h-11 w-36 mt-2 rounded-full" />
              </div>
              {/* Your sections: header row, then the 2x2 tiles. */}
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between px-1">
                  <Skeleton className="h-4 w-28 rounded-ds-md" />
                  <Skeleton className="h-4 w-16 rounded-ds-md" />
                </div>
                <div className="grid grid-cols-2 gap-3" data-skeleton="tiles">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="liquid-glass p-card flex flex-col gap-1 min-w-0">
                      <Skeleton className="w-6 h-6 rounded-ds-md" />
                      <Skeleton className="h-5 w-20 mt-2 rounded-ds-md" />
                      <Skeleton className="h-4 w-28 max-w-full rounded-ds-md" />
                    </div>
                  ))}
                </div>
              </div>
              {/* Coming up: GroupSection's header + one card of rows. */}
              <div className="flex flex-col gap-2">
                <div className="px-1">
                  <Skeleton className="h-4 w-24 rounded-ds-md" />
                </div>
                <div className="liquid-glass overflow-hidden" data-skeleton="coming-up">
                  {[0, 1].map((i) => (
                    <div key={i} className={`flex items-center gap-3 px-4 py-3 ${i === 0 ? "border-b border-border/70" : ""}`}>
                      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                        <Skeleton className="h-4 w-40 max-w-full rounded-ds-md" />
                        <Skeleton className="h-3.5 w-52 max-w-full rounded-ds-md" />
                      </div>
                      <Skeleton className="h-5 w-10 rounded-ds-md" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  </div>
);

export default DashboardRouteSkeleton;
