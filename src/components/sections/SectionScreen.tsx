import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";
import { AppTopBar } from "./AppTopBar";
import { usePageTitle } from "@/hooks/usePageTitle";
import { ExploreSearchEntry } from "./ExploreSearchEntry";
import { Skeleton } from "@/components/ui/skeleton";
import { sectionByKey, type SectionKey } from "./sectionsConfig";

/**
 * A section's screen frame (owner, 2026-10-19): the shared top bar over a scrolling column. Same fixed-shell
 * geometry as AppPage, so the content column sits where it always did.
 *
 * THE EXPLORE HEADER (owner, 2026-10-22): on one of the four sections the header is the section chips (with the
 * bell and the photo), then the section's thin tabs, then the search, and it is STEADY: it sits above the scroll
 * column, so nothing in it hides, shrinks or moves while the list scrolls under it (the Jobs header already sat
 * outside its scroll panel). No "early preview" banner over the content (owner, 2026-10-28: "remove coming soon
 * early preview. the bottom stuff already says that"): the chips' "Coming soon" and Browse's "Opens soon" say it.
 * Guard: src/test/exploreHeaderSteady.test.ts.
 */
export function SectionScreen({
  title,
  section,
  tabs,
  globalSearch = true,
  children,
}: {
  /** A section screen (not Home): draws the Explore header (chips row, tabs, search) above the scroll column. */
  section?: SectionKey;
  /** Omit on Home: the logo shows instead. */
  title?: string;
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
            <AppTopBar title={title} explore section={section} />
            {tabs}
            {globalSearch && <ExploreSearchEntry />}
          </div>
        )}
        <div data-app-page-scroll="" className="page-measure w-[calc(100%+1.5rem)] flex-1 min-h-0 overflow-y-auto px-3 -mx-3 pb-safe-nav">
          {!section && <AppTopBar title={title} />}
          <div className="flex flex-col gap-4 pt-1 pb-6">
            {children}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/**
 * A section's frame while its hidden switch's answer loads (Shops, Homes; Declutter's skeleton is the same frame
 * with bones). It draws EXACTLY the settled section header: the section's own title with no back arrow, the tabs'
 * place, no "Search all sections" field (Browse, where the section opens, draws its own search).
 *
 * Owner, 2026-10-28, desktop /shops hard reload: "it shows a back arrow to the left of Shops then goes away once
 * settled". The gates used to hold AppPage (a sub-screen frame: back arrow + title) while the switch loaded, so the
 * desktop bar read "<- Shops" for ~400ms, then "Shops". Guard: src/test/sectionLoadingHeaderIsSettled.test.tsx.
 */
export function SectionGateFrame({ section, label }: { section: SectionKey; label: string }) {
  const { label: title } = sectionByKey(section);
  return (
    <SectionScreen section={section} title={title} globalSearch={false} tabs={<Skeleton className="h-11 w-full rounded-ds-md" aria-hidden />}>
      <p role="status" className="sr-only">
        {label}
      </p>
    </SectionScreen>
  );
}
