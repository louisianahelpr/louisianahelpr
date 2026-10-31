/**
 * Declutter Browse's filters, as Jobs' Browse lays out its own (owner 10-30: search and filter "beside the gear"): the
 * search (opens in place, leftward) and the Filters square ride at the END of the tabs row at every width
 * (DeclutterBrowseView's `end`), with the map toggle and Browse's count on desktop. The filter button opens the ONE
 * shared FilterSheet (the sheet on a phone, the centred panel on desktop), holding Declutter's sections
 * (DeclutterFilterPanel) with "Clear all" and a live "Show N items" footer; on a phone it also holds Jobs' "View"
 * (List / Map) choice. Any distance is the default (owner, 2026-10-19).
 */
import type { RefObject } from "react";
import { FilterSheet, type FilterSheetSection } from "@/components/dashboard/FilterSheet";
import { BrowseViewToggle } from "@/components/dashboard/browseTasksToolbar/BrowseViewToggle";
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
  /** A signed-out guest (BUY-16): no profile, so never "add your ZIP code in your profile" (AUD31-75). */
  guest?: boolean;
}

/** Whether to offer "Use my location" / "Try my location again": not while asking, not once the device gave a fix. */
export function offerAsk(ask: OriginAsk): boolean {
  const fromDevice = ask.origin.status === "ready" && ask.origin.source === "device";
  return !fromDevice && (!ask.asked || ask.canAskAgain);
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
