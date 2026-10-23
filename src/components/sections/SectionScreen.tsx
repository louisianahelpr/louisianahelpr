import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";
import { AppTopBar } from "./AppTopBar";
import { usePageTitle } from "@/hooks/usePageTitle";
import { ExploreSearchEntry } from "./ExploreSearchEntry";
import { SectionPreviewBanner } from "./SectionPreviewBanner";
import type { SectionKey } from "./sectionsConfig";

/**
 * A section's screen frame (owner, 2026-10-19): the shared top bar over a scrolling column. Same fixed-shell
 * geometry as AppPage, so the content column sits where it always did.
 *
 * THE EXPLORE HEADER (owner, 2026-10-22): on one of the four sections the header is the section chips (with the
 * bell and the photo), then the section's thin tabs, then the search, and it is STEADY: it sits above the scroll
 * column, so nothing in it hides, shrinks or moves while the list scrolls under it (the Jobs header already sat
 * outside its scroll panel). A section open to the viewer only as a tester opens with the "Coming soon – early
 * preview" banner. Guard: src/test/exploreHeaderSteady.test.ts.
 */
export function SectionScreen({
  title,
  add,
  section,
  tabs,
  globalSearch = true,
  children,
}: {
  /** A section screen (not Home): draws the Explore header (chips row, tabs, search) above the scroll column. */
  section?: SectionKey;
  /** Omit on Home: the logo shows instead. */
  title?: string;
  add?: { label: string; path: string };
  /** The section's tabs (SectionTabs), the header's second row. */
  tabs?: ReactNode;
  /**
   * Explore's "Search all sections" field. ONE search per screen (owner 2026-10-21: two search bars stacked on
   * Browse): a tab that draws its own section search (SectionSearchRow) passes false, and the global field shows
   * only where there is no section search.
   */
  globalSearch?: boolean;
  children: ReactNode;
}) {
  // D12 (Cowork audit 2026-10-20): every section screen names itself in the browser tab; a page that sets a more
  // specific title (its own usePageTitle) still wins, because a parent's effect runs after this child's.
  usePageTitle(`${title ?? "Home"} — Helpr`);
  return (
    <AppShell scrollable={false} contentClassName="overflow-hidden" className="bg-premium-page pt-safe-top">
      <div className="container mx-auto px-5 lg:px-6 xl:px-6 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden">
        {section && (
          // py/gap = JobsSection's header stack (section-shell-alignment): the bar, 4px, the tabs, 4px, the search.
          <div data-explore-header="" className="explore-header page-measure w-full shrink-0 flex flex-col gap-1">
            <AppTopBar title={title} add={add} explore section={section} />
            {tabs}
            {globalSearch && <ExploreSearchEntry />}
          </div>
        )}
        <div data-app-page-scroll="" className="page-measure w-[calc(100%+1.5rem)] flex-1 min-h-0 overflow-y-auto px-3 -mx-3 pb-safe-nav">
          {!section && <AppTopBar title={title} add={add} />}
          <div className="flex flex-col gap-4 pt-1 pb-6">
            {section && <SectionPreviewBanner section={section} />}
            {children}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
