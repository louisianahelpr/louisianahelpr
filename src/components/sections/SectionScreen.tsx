import { useState, type ReactNode } from "react";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { HeaderSearchSlot } from "./headerSearchSlot";
import AppShell from "@/components/AppShell";
import { AppTopBar } from "./AppTopBar";
import { usePageTitle } from "@/hooks/usePageTitle";
import { ExploreSearchEntry } from "./ExploreSearchEntry";
import type { SectionKey } from "./sectionsConfig";
import type { SectionMineMenu } from "./sectionMine";

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
  search,
  searchSlot = false,
  mine,
  fab,
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
  /**
   * THE VINTED HEADER (owner 11-08): on a phone the bar is this search (Filters inside it) with the bell (which holds
   * Messages) and the photo beside it; no visible title (a visually hidden h1 keeps the page's name). `tabs` is then
   * the row under it (Declutter: the category chips).
   */
  search?: ReactNode;
  /**
   * Phone: the bar holds a slot that the page's own SectionSearchRow draws itself into (headerSearchSlot.ts; Shops,
   * Homes). Ignored when `search` is given and on the desktop website.
   */
  searchSlot?: boolean;
  /** The section's "My …" menu under the photo (its lists, their to-do counts, its settings). */
  mine?: SectionMineMenu;
  /** A floating action (Declutter's "+ Sell"): drawn over the screen, with room under the last row so it covers none. */
  fab?: ReactNode;
  children: ReactNode;
}) {
  // D12 (Cowork audit 2026-10-20): every section screen names itself in the browser tab; a page that sets a more
  // specific title (its own usePageTitle) still wins, because a parent's effect runs after this child's.
  usePageTitle(`${title ?? "Dashboard"} — Helpr`);
  const desktop = useIsWebDesktop();
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  const slotted = searchSlot && search === undefined && !desktop;
  const barSearch = slotted ? <div ref={setSlotEl} data-header-search-slot="" className="min-w-0" /> : search;
  return (
    <AppShell scrollable={false} contentClassName="overflow-hidden" className="bg-premium-page pt-safe-top">
      {/* Declutter's Vinted header (owner 11-08) sits on 16px gutters; every other section keeps 20px. */}
      <div className={`container mx-auto ${barSearch !== undefined ? "px-4" : "px-5"} lg:px-6 xl:px-6 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden`}>
        {section && (
          // py/gap = JobsSection's header stack (section-shell-alignment): the bar, 4px, the tabs, 4px, the search.
          <div data-explore-header="" className="explore-header page-measure w-full shrink-0 flex flex-col gap-1">
            <AppTopBar title={title} explore section={section} search={barSearch} mine={mine} />
            {tabs}
            {globalSearch && <ExploreSearchEntry />}
          </div>
        )}
        <div data-app-page-scroll="" className="page-measure w-[calc(100%+1.5rem)] flex-1 min-h-0 overflow-y-auto px-3 -mx-3 pb-safe-nav">
          {!section && <AppTopBar title={title} search={search} mine={mine} />}
          <div className={`flex min-h-full flex-col gap-4 pt-1 ${fab ? "pb-20" : "pb-6"}`}>
            <HeaderSearchSlot.Provider value={slotted ? slotEl : null}>{children}</HeaderSearchSlot.Provider>
          </div>
          {fab}
        </div>
      </div>
    </AppShell>
  );
}
