import { ScrollAwaySpacer } from "@/components/sections/ScrollAwayScope";
import { DashboardSkeleton } from "@/components/SkeletonLoaders";

/**
 * What Browse's loading frame draws inside its PageScaffold (moved out of Dashboard.tsx unchanged, 11-15:
 * componentSizeRatchet). The frame itself (the real title card) stays in Dashboard so it matches the loaded page.
 */
export function DashboardLoadingBody({ isWebDesktop, mapVisible }: { isWebDesktop: boolean; mapVisible: boolean }) {
  return (
    <>
      {/* The screen's one <h1> is the section top bar's ("Jobs", in the title card above); this only
          announces the wait. */}
      <p className="sr-only" role="status" aria-live="polite">Loading jobs near you…</p>
      {isWebDesktop ? (
        <div className="flex flex-1 min-h-0 flex-col overflow-hidden" data-testid="dashboard-desktop-loading">
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
              <DashboardSkeleton />
            </div>
            {mapVisible && (
              <div
                className="w-[48%] shrink-0 min-h-0"
                style={{ borderLeft: "1px solid hsl(var(--olivewood) / 0.12)" }}
                aria-hidden
              />
            )}
          </div>
        </div>
      ) : (
        <>
          {/* /jobs at 375 (prod-audit run 43691657529, page-settle 0.097 at ~497 ms): the tabs and chips switch to
              overlaying the feed only once a spacer is drawn. The loading frame drew none, so the title card was
              the full 151px, and when the feed's spacer arrived it dropped to 58px and the whole panel moved up
              93px. The loading frame draws the same spacer, so the overlay (and the panel's place) holds from the
              first frame; the feed's spacer takes over in the same commit. Guard:
              src/test/jobsBrowseLoadingKeepsOverlay.test.tsx. */}
          <ScrollAwaySpacer />
          <DashboardSkeleton />
        </>
      )}
    </>
  );
}
