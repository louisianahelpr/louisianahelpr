import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";
import { AppTopBar } from "./AppTopBar";
import { ExploreSwitcher } from "./ExploreSwitcher";
import type { SectionKey } from "./sectionsConfig";

/**
 * A section's screen frame (owner, 2026-10-19): the shared top bar (title,
 * the section's "+", bell, avatar) over a scrolling column. Same fixed-shell
 * geometry as AppPage, so the content column sits where it always did; only
 * the title row changes (AppPage's back-chevron header becomes AppTopBar).
 */
export function SectionScreen({
  title,
  heading,
  add,
  section,
  children,
}: {
  /** A section screen (not Home): draws Explore's section switcher under the top bar. */
  section?: SectionKey;
  /** A section's title. Home passes `heading` (its greeting) instead. */
  title?: string;
  heading?: ReactNode;
  add?: { label: string; path: string };
  children: ReactNode;
}) {
  return (
    <AppShell scrollable={false} contentClassName="overflow-hidden" className="bg-premium-page pt-safe-top">
      <div className="container mx-auto px-5 lg:px-6 xl:px-6 pb-0 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div data-app-page-scroll="" className="page-measure w-[calc(100%+1.5rem)] h-full overflow-y-auto px-3 -mx-3 pb-safe-nav">
          <AppTopBar title={title} heading={heading} add={add} explore={!!section} />
          {section && <ExploreSwitcher current={section} />}
          <div className="flex flex-col gap-4 pt-1 pb-6">{children}</div>
        </div>
      </div>
    </AppShell>
  );
}
