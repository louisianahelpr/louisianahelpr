import type { ReactNode, RefObject } from "react";
import {
  Sheet,
  SheetContent,
  SheetHero,
} from "@/components/ui/sheet";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { FilterSheetFooter } from "@/components/dashboard/filterSheet/FilterSheetFooter";

/**
 * FilterSheet — the ONE filter presentation used across the app.
 *
 * One shared `Sheet`: on phone and native the slide-up sheet glued to the
 * bottom edge (grab handle, owner 2026-10-18 tweak 6); on desktop web the
 * centred 520px modal (lead review of board 24, 2026-10-20; it used to be a
 * dropdown docked off the Filters button that opened ~1070px wide over the
 * list and half the map). It stacks filter controls as titled sections. Every
 * surface that needs filters (Browse / Dashboard, Activity, Guest) opens
 * this same component so the UX is identical everywhere.
 *
 * It's section-agnostic: each surface passes the `sections` it supports and
 * the sheet renders only those. The job surfaces build theirs with
 * `buildJobFilterSections` (filterSheet/jobFilterSections.tsx).
 *
 * Board 24: a sticky footer on both presentations, "Clear all" (olive text
 * link) on the left and one primary "Show jobs" on the right that closes the
 * panel. The button carries a number ONLY when the caller passes an exact
 * count for the whole filtered set (`resultCount`); a count of loaded pages
 * is never shown.
 */

export interface FilterSheetSection {
  /** Stable key for React. */
  key: string;
  /** Uppercase section eyebrow, e.g. "Sort by". */
  title: string;
  /** The section's controls. */
  content: ReactNode;
  /**
   * Optional compact control rendered on the SAME line as the eyebrow,
   * right-aligned — for a mode switch that belongs with a section but does
   * not earn a section of its own (Browse mounts the List⇄Map toggle here,
   * on Sort by). Keep it to one small control; anything taller than the
   * eyebrow line belongs in `content`.
   */
  trailing?: ReactNode;
}

interface FilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sections to render, top to bottom. */
  sections: FilterSheetSection[];
  /** Count of currently-active filters — drives the header subtitle. */
  activeFilterCount: number;
  /** Clears every filter this sheet controls ("Clear all" in the footer). */
  onClearAll?: () => void;
  /** Heading, e.g. "Filter jobs". */
  title?: string;
  /** Exact size of the whole filtered set, or null/undefined when it is not
   *  known exactly (more pages to load, still loading): the button then
   *  reads "Show jobs" with no number. */
  resultCount?: number | null;
  /** [singular, plural] noun for the button, e.g. ["job", "jobs"]. */
  resultNoun?: readonly [string, string];
  /**
   * The Filters button that opens this sheet. It lives in a different
   * component (BrowseTasksActions / SectionSearchRow), so it cannot be a
   * SheetTrigger; closing returns focus to it through this ref.
   */
  anchorRef?: RefObject<HTMLElement | null>;
  /** Action rows rendered after the last section, above the footer —
   *  for rows that OPEN something (Saved Searches) rather than filter. */
  footer?: ReactNode;
}

/** Uppercase eyebrow + content, the standard section shell. The eyebrow is
 *  brand olive rather than gray — the section labels are the sheet's skeleton,
 *  and painting them in the brand's structural color is what makes this
 *  surface read as OURS instead of unstyled Radix (see the density &
 *  brand-surface-fit block in the audit standard). */
function Section({ title, trailing, children }: { title: string; trailing?: ReactNode; children: ReactNode }) {
  return (
    <div className="pt-2.5 first:pt-0 border-t border-[hsl(var(--bark)/0.10)] first:border-t-0">
      <div className="flex items-center justify-between gap-3 mb-1">
        {/* Quiet gray sans eyebrow — owner's explicit pick (2026-08-24) over
            both the olive sans and the sienna-serif variants tried in the
            brand pass. The sheet's brand voice lives in the chips, switches
            and surface; the labels stay quiet. */}
        <p className="text-ds-10 font-semibold text-muted-foreground uppercase tracking-widest">
          {title}
        </p>
        {trailing}
      </div>
      {children}
    </div>
  );
}

/** The panel's contents — the titled sections and the action rows.
 *  Shared by the phone sheet and the desktop modal so the two
 *  presentations cannot drift into two different filter sets. */
function FilterBody({
  sections,
  footer,
}: Pick<FilterSheetProps, "sections" | "footer">) {
  return (
    <>
      <div className="px-5 pb-3 space-y-2.5">
        {sections.map((s) => (
          <Section key={s.key} title={s.title} trailing={s.trailing}>
            {s.content}
          </Section>
        ))}
      </div>

      {/* Action rows (open-a-dialog things like Saved Searches) sit here with
          the footer — the actions live together at the end, after every
          control, instead of one wearing a filter section's clothes. */}
      {footer && <div className="px-5 pb-2">{footer}</div>}

    </>
  );
}

export function FilterSheet({
  open,
  onOpenChange,
  sections,
  activeFilterCount,
  onClearAll,
  anchorRef,
  footer,
  title = "Filters",
  resultCount,
  resultNoun = ["result", "results"],
}: FilterSheetProps) {
  const webDesktop = useIsWebDesktop();
  const hero = <SheetHero title={title} />;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        // Phone + native: the slide-up sheet glued to the bottom edge with a
        // grab handle (owner 2026-10-18, tweak 6). Desktop web: the centred
        // modal, 520px wide (lead review of board 24, 2026-10-20: the old
        // dropdown off the Filters button opened ~1070px wide over the list
        // and half the map).
        floor={!webDesktop}
        // The Filters button that opened this is outside the sheet, so Radix
        // has no trigger to hand focus back to; return it there ourselves.
        onCloseAutoFocus={(event) => {
          const button = anchorRef?.current;
          if (!button) return;
          event.preventDefault();
          button.focus({ preventScroll: true });
        }}
        // THE HEADER NEVER SCROLLS (owner 2026-10-21: "Filter jobs" cut off at
        // the top-left, over the sheet edge). The whole sheet used to be the
        // scroller, so the first flick slid the title, the grab handle and the
        // X up under the rounded top edge. Now the sheet is a fixed column:
        // title row, then ONE scrolling body, then the footer.
        // Guard: src/test/browseCategoryGroups.test.tsx.
        className={`max-h-[85dvh] flex flex-col overflow-hidden p-0 sm:p-0 gap-0 bg-premium-page ${webDesktop ? "sm:max-w-[520px]" : ""}`}
      >
        {/* Title only: no eyebrow, no subtitle. The active-filter count shows
            as a badge on the Filters button, and the footer carries Clear all. */}
        {/* The floor sheet pads its hero in index.css (.sheet-floor.p-0); the
            desktop modal drops the sheet's own padding for the sticky footer, so
            it pads the hero here. */}
        {webDesktop ? <div className="px-5 pt-5 pb-1">{hero}</div> : hero}

        <div data-filter-sheet-body="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <FilterBody sections={sections} footer={footer} />
        </div>
        <FilterSheetFooter
          activeFilterCount={activeFilterCount}
          onClearAll={onClearAll}
          onDone={() => onOpenChange(false)}
          resultCount={resultCount}
          resultNoun={resultNoun}
        />
      </SheetContent>
    </Sheet>
  );
}
