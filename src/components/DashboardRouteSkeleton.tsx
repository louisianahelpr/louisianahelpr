import AppShell from "@/components/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { COMPACT_TOP_ROW } from "@/components/sections/browseHeaderSpacing";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { useEffect, useState } from "react";
import { isDesktopRailRoute } from "@/lib/desktopNavRoutes";
import { useLanguage } from "@/lib/i18n/language";

/**
 * Design audit area 02 #1 (11-18): with Home's reads failing (forced errors on every table, live main c3efd4d67f) a
 * signed-in visitor at `/` sat on these bones for good: no error, no Try again, no nav. Bones that outlive this wait
 * are not "still loading", so they give way to an error card with Try again (a fresh load: whatever is stuck, the
 * auth check, the profile read or Home's chunk, starts again).
 */
export const HOME_SKELETON_STUCK_MS = 8000;
function useStuck(ms: number): boolean {
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setStuck(true), ms);
    return () => clearTimeout(id);
  }, [ms]);
  return stuck;
}

/**
 * Suspense / auth-pending fallback for the `/home` route, which is the Home
 * DASHBOARD now (owner final decisions, 2026-10-19), not the job feed.
 *
 * It mirrors src/pages/home/HomeDashboard.tsx the way JobsSectionSkeleton
 * mirrors Jobs (Q2214): the same SectionScreen frame (AppShell, the container,
 * the page-measure scroll column), the same top bar on Home (AppTopBar: the
 * search bar on the left, the bell, the profile avatar at the far right; no "+"),
 * then (desktop website only) the greeting line, the Next up card, Coming up and the "Your
 * sections" chips, so a cold /home goes bones -> content with nothing moving. The
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
const DashboardRouteSkeleton = () => {
  const desktop = useIsWebDesktop();
  const stuck = useStuck(HOME_SKELETON_STUCK_MS);
  const { t } = useLanguage();
  // Design audit area 02 #1: on `/` (and /browse) the signed-in rail is not mounted (not a rail route), so the desktop
  // bones spanned the whole window and then jumped right when Home arrived with its rail. Off a rail route the bones
  // draw the rail's place too, so the page lands where Home will be.
  const railBones = desktop && typeof window !== "undefined" && !isDesktopRailRoute(window.location.pathname);
  return (
  <div role="status" aria-live="polite" aria-busy={!stuck} data-testid="dashboard-route-skeleton" style={railBones ? { paddingLeft: "var(--desktop-sidebar-w)" } : undefined}>
    <span className="sr-only">{stuck ? t("home.stuckTitle") : "Loading…"}</span>
    {railBones && (
      <aside aria-hidden data-testid="dashboard-route-skeleton-rail" className="fixed inset-y-0 left-0 z-10 flex flex-col gap-3 border-r border-border/70 bg-background px-4 pt-6" style={{ width: "var(--desktop-sidebar-w)" }}>
        <Skeleton className="h-8 w-32 rounded-ds-md mb-4" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-10 w-full rounded-ds-md" />
        ))}
      </aside>
    )}
    {stuck && (
      <div className="fixed inset-x-0 top-24 z-20 flex justify-center px-4" style={railBones ? { left: "var(--desktop-sidebar-w)" } : undefined}>
        <div data-testid="home-stuck-card" className="liquid-glass p-card flex w-full max-w-md flex-col items-start gap-2 shadow-lg">
          <p className="text-ds-18 font-bold leading-snug">{t("home.stuckTitle")}</p>
          <p className="text-ds-14 text-muted-foreground">{t("home.stuckBody")}</p>
          <button type="button" onClick={() => window.location.reload()} className="btn-press mt-1 h-11 rounded-full bg-primary px-5 text-ds-14 font-semibold text-primary-foreground">
            {t("core.tryAgain")}
          </button>
        </div>
      </div>
    )}
    {/* SectionScreen's frame, class for class. */}
    <AppShell scrollable={false} contentClassName="overflow-hidden" className="bg-premium-page pt-safe-top">
      <div className="container mx-auto px-4 lg:px-6 xl:px-6 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden" aria-hidden>
        <div className="page-measure w-[calc(100%+1.5rem)] h-full overflow-hidden px-3 -mx-3 pb-safe-nav">
          {/* AppTopBar on Dashboard (the compact top, owner 11-14): ONE row, the 44px search with the Inbox icon and the avatar
              inline on its right, each a 44px control ("+ Create" floats over the page). */}
          <div className={COMPACT_TOP_ROW}>
            <div className="min-w-0 flex-1">
              <Skeleton className="h-11 w-full rounded-full" />
            </div>
            <div className="flex items-center shrink-0">
              <span className="h-11 w-11 flex items-center justify-center">
                <Skeleton className="h-6 w-6 rounded-full" />
              </span>
              <span className="h-11 w-11 flex items-center justify-center">
                <Skeleton className="w-9 h-9 rounded-full" />
              </span>
            </div>
          </div>
          <div className="flex min-h-full flex-col gap-4 pt-1 pb-6">
            <div className="flex flex-col gap-section">
              {/* The desktop website's greeting line. A phone has none (owner 11-14, Depop/Vinted audit item 6), so its
                  copy here and in index.html (#lh-home-shell) opens on the Next up card. */}
              {desktop && (
                <div data-skeleton-part="greeting">
                  <Skeleton className="h-[25px] w-56 max-w-full rounded-ds-md" />
                </div>
              )}
              {/* The Next up card: label, title, one line, the action pill. */}
              <div className="liquid-glass p-card flex flex-col gap-1.5" data-skeleton-part="next-up">
                <Skeleton className="h-3.5 w-16 rounded-ds-md" />
                <Skeleton className="h-6 w-48 max-w-full rounded-ds-md" />
                <Skeleton className="h-4 w-40 max-w-full rounded-ds-md" />
                <Skeleton className="h-11 w-36 mt-2 rounded-full" />
              </div>
              {/* Coming up (board 7: before the sections): GroupSection's header + one card of rows. */}
              <div className="flex flex-col gap-2">
                <div className="px-1">
                  <Skeleton className="h-4 w-24 rounded-ds-md" />
                </div>
                <div className="liquid-glass overflow-hidden" data-skeleton-part="coming-up">
                  {[0, 1].map((i) => (
                    <div key={i} className={`flex items-center gap-3 px-4 py-3 ${i === 0 ? "border-b border-border/70" : ""}`}>
                      <Skeleton className="w-10 h-10 shrink-0 rounded-full" />
                      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                        <Skeleton className="h-4 w-40 max-w-full rounded-ds-md" />
                        <Skeleton className="h-3.5 w-52 max-w-full rounded-ds-md" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Your sections: header row, then the row of section chips (44px pills; design audit A D4, 11-08). */}
              <div className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between px-1">
                  <Skeleton className="h-4 w-28 rounded-ds-md" />
                  <Skeleton className="h-4 w-16 rounded-ds-md" />
                </div>
                <div className="grid grid-cols-2 gap-2" data-skeleton-part="tiles">
                  {[0, 1].map((i) => (
                    <Skeleton key={i} className="h-11 w-full rounded-full" />
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
};

export default DashboardRouteSkeleton;
