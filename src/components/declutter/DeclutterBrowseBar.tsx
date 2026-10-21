/**
 * Browse's ONE compact row (owner, 2026-10-19): a slim search field with the
 * filter button inside its right edge (the shared SectionSearchRow every Browse
 * wears). The filter button opens the slide-up sheet holding the ONE filter
 * panel (DeclutterFilterPanel; board 39 shows the same panel as a column on
 * desktop), with "Clear all" and a live "Show N items" footer. Any distance is
 * the default (owner, 2026-10-19).
 */
import { useState, type ReactNode } from "react";
import { Sheet, SheetContent, SheetFooter, SheetHero, SheetPrimaryAction, SheetSecondaryAction } from "@/components/ui/sheet";
import { SectionSearchRow } from "@/components/sections/SectionSearchRow";
import type { DeclutterOrigin } from "./useDeclutterOrigin";

export interface OriginAsk {
  origin: DeclutterOrigin;
  asked: boolean;
  asking: boolean;
  canAskAgain: boolean;
  deviceNote: string | null;
  askDevice: () => void;
}

export function DeclutterBrowseBar({
  query,
  onQuery,
  filterCount,
  panel,
  shown,
  onClearAll,
  columnFilters = false,
}: {
  query: string;
  onQuery: (q: string) => void;
  filterCount: number;
  panel: ReactNode;
  shown: number;
  onClearAll: () => void;
  /**
   * The filter panel is already open beside the list (desktop column, board 39):
   * no filter button and no sheet, so the filters live in ONE place (audit #33).
   */
  columnFilters?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <SectionSearchRow
        testId="declutter-browse-bar"
        value={query}
        onChange={onQuery}
        placeholder="Search items"
        filterCount={filterCount}
        filtersOpen={open}
        onFilters={columnFilters ? undefined : () => setOpen(true)}
        filtersLabel={filterCount > 0 ? `Filters, ${filterCount} on` : "Filters"}
      />
      <Sheet open={open && !columnFilters} onOpenChange={setOpen}>
        <SheetContent side="bottom" floor className="max-h-[85dvh] overflow-y-auto overscroll-contain bg-premium-page">
          <SheetHero title="Filters" />
          <div className="mt-2">{panel}</div>
          <SheetFooter className="sticky bottom-0 bg-premium-page pt-4 pb-4">
            <SheetSecondaryAction onClick={onClearAll}>Clear all</SheetSecondaryAction>
            <SheetPrimaryAction onClick={() => setOpen(false)}>
              {shown === 1 ? "Show 1 item" : `Show ${shown} items`}
            </SheetPrimaryAction>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
