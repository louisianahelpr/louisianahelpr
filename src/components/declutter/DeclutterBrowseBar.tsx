/**
 * Declutter Browse's search and filters, laid out as Jobs' Browse lays out its own (owner 2026-10-28: "declutter
 * should have the same search filter and map view as jobs"):
 *   - phone: ONE compact row under the tabs, the shared SectionSearchRow ("Search items" with the filter button
 *     inside its right edge), as Jobs' "Search jobs" row;
 *   - desktop website: no row of its own. The search (opens in place, leftward), the Filters square and the map
 *     toggle ride at the END of the tabs row (DeclutterBrowseView's `end`), beside Browse's count.
 * Either way the filter button opens the ONE shared FilterSheet (the sheet on a phone, the centred panel on
 * desktop), holding Declutter's sections (DeclutterFilterPanel) with "Clear all" and a live "Show N items" footer;
 * on a phone it also holds Jobs' "View" (List / Map) choice. Any distance is the default (owner, 2026-10-19).
 */
import type { RefObject } from "react";
import { FilterSheet, type FilterSheetSection } from "@/components/dashboard/FilterSheet";
import { BrowseViewToggle } from "@/components/dashboard/browseTasksToolbar/BrowseViewToggle";
import { SectionSearchRow } from "@/components/sections/SectionSearchRow";
import type { DeclutterOrigin } from "./useDeclutterOrigin";

export interface OriginAsk {
  origin: DeclutterOrigin;
  asked: boolean;
  asking: boolean;
  canAskAgain: boolean;
  deviceNote: string | null;
  askDevice: () => void;
  /** The profile's ZIP code, for "Miles from 70501" (DA-10); absent where the screen does not name it. */
  zip?: string | null;
}

/** Whether to offer "Use my location" / "Try my location again": not while asking, not once the device gave a fix. */
export function offerAsk(ask: OriginAsk): boolean {
  const fromDevice = ask.origin.status === "ready" && ask.origin.source === "device";
  return !fromDevice && (!ask.asked || ask.canAskAgain);
}

/** The phone's one search row under the tabs. */
export function DeclutterBrowseBar({
  query,
  onQuery,
  filterCount,
  filtersOpen,
  onFilters,
  filtersButtonRef,
}: {
  query: string;
  onQuery: (q: string) => void;
  filterCount: number;
  filtersOpen: boolean;
  onFilters: () => void;
  filtersButtonRef?: RefObject<HTMLButtonElement>;
}) {
  return (
    <SectionSearchRow
      testId="declutter-browse-bar"
      value={query}
      onChange={onQuery}
      placeholder="Search items"
      filterCount={filterCount}
      filtersOpen={filtersOpen}
      onFilters={onFilters}
      filtersButtonRef={filtersButtonRef}
      filtersLabel={filterCount > 0 ? `Filters, ${filterCount} on` : "Filters"}
    />
  );
}

/** The shared filter sheet with Declutter's sections; `view` adds Jobs' List / Map choice (phone only). */
export function DeclutterFilterSheet({
  open,
  onOpenChange,
  sections,
  filterCount,
  shown,
  onClearAll,
  anchorRef,
  view,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sections: FilterSheetSection[];
  filterCount: number;
  shown: number;
  onClearAll: () => void;
  anchorRef?: RefObject<HTMLElement | null>;
  view?: { value: "list" | "map"; set: (v: "list" | "map") => void };
}) {
  const all: FilterSheetSection[] = view
    ? [{ key: "view", title: "View", content: <BrowseViewToggle view={view.value} setView={view.set} onSelect={() => onOpenChange(false)} /> }, ...sections]
    : sections;
  return (
    <FilterSheet
      open={open}
      onOpenChange={onOpenChange}
      anchorRef={anchorRef}
      title="Filters"
      sections={all}
      activeFilterCount={filterCount}
      onClearAll={onClearAll}
      resultCount={shown}
      resultNoun={["item", "items"]}
    />
  );
}
