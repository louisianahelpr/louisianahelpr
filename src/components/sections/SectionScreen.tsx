import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";
import { AppTopBar } from "./AppTopBar";
import { usePageTitle } from "@/hooks/usePageTitle";
import { ExploreSwitcher } from "./ExploreSwitcher";
import { ExploreSearchEntry } from "./ExploreSearchEntry";
import type { SectionKey } from "./sectionsConfig";

/**
 * A section's screen frame (owner, 2026-10-19): the shared top bar (title,
 * the section's "+", bell, avatar) over a scrolling column. Same fixed-shell
 * geometry as AppPage, so the content column sits where it always did; only
 * the title row changes (AppPage's back-chevron header becomes AppTopBar).
 */
export function SectionScreen({
  title,
  add,
  section,
  globalSearch = true,
  children,
}: {
  /** A section screen (not Home): draws Explore's section switcher under the top bar. */
  section?: SectionKey;
  /** Omit on Home: the logo shows instead. */
  title?: string;
  add?: { label: string; path: string };
  /**
   * Explore's "Search all sections" field. ONE search per screen (owner
   * 2026-10-21: two search bars stacked on Browse): a tab that draws its own
   * section search (SectionSearchRow) passes false, and the global field shows
   * only where there is no section search.
   */
  globalSearch?: boolean;
  children: ReactNode;
}) {
  // D12 (Cowork audit 2026-10-20): the browser tab named the jobs-only landing
  // page ("Helpr — Louisiana's Local Job Partner | Hire or Find Work") on
  // Home, Declutter, Shops and Homes. Every section screen names itself; a
  // page that sets a more specific title (its own usePageTitle) still wins,
  // because a parent's effect runs after this child's.
  usePageTitle(`${title ?? "Home"} — Helpr`);
  return (
    <AppShell scrollable={false} contentClassName="overflow-hidden" className="bg-premium-page pt-safe-top">
      <div className="container mx-auto px-5 lg:px-6 xl:px-6 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div data-app-page-scroll="" className="page-measure w-[calc(100%+1.5rem)] h-full overflow-y-auto px-3 -mx-3 pb-safe-nav">
          <AppTopBar title={title} add={add} explore={!!section} />
          {/* py-1 = the 4px gaps JobsSection's header gets from gap-1 (section-shell-alignment). */}
          {section && globalSearch && <div className="py-1"><ExploreSearchEntry /></div>}
          {/* Without the field, keep JobsSection's 4px bar-to-switcher gap. */}
          {section && !globalSearch && <div className="h-1" aria-hidden />}
          {section && <ExploreSwitcher current={section} />}
          <div className="flex flex-col gap-4 pt-1 pb-6">{children}</div>
        </div>
      </div>
    </AppShell>
  );
}
