import { List } from "lucide-react";
import { MAP_DOCK_CLEARANCE } from "@/components/browseMap/config";

/**
 * Back to the list from the map, on the map itself (design audit area 04 #9, 11-18): the only way back was
 * Filters › View, and the choice is remembered, so a Helpr who tried the map came back to it with no visible exit.
 * Bottom-left, on the my-location control's floor (bottom-right): the top-left holds the shaded-areas key.
 */
export function MapShowListPill({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      data-testid="browse-map-show-list"
      onClick={onClick}
      className="btn-press absolute left-6 z-[420] inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-ds-13 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--ring))]"
      style={{ bottom: MAP_DOCK_CLEARANCE, background: "hsl(var(--card))", border: "1px solid hsl(var(--olivewood) / 0.22)", color: "hsl(var(--olivewood))", boxShadow: "0 4px 14px -4px hsl(var(--olivewood) / 0.22)" }}
    >
      <List className="w-4 h-4" aria-hidden="true" />
      List
    </button>
  );
}
