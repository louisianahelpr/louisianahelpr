import { startTransition } from "react";
import { List, Map as MapIcon } from "lucide-react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";

export interface BrowseViewToggleProps {
  /** List vs Map view selection. */
  view: "list" | "map";
  setView: (next: "list" | "map") => void;
  /** Called after the view actually CHANGES (not on re-picking the current
   *  one). The toolbar closes the filter sheet with it — you asked to look at
   *  the map, so the sheet gets out of the way. */
  onSelect?: () => void;
}

const OPTIONS = [
  { value: "list", label: "List", Icon: List },
  { value: "map", label: "Map", Icon: MapIcon },
] as const;

/**
 * The Browse feed's List ⇄ Map choice inside the filter sheet's "View" section:
 * the shared SegmentedControl, full width (board 24, lead review 2026-10-20).
 *
 * It used to be a bare icon button in the feed's header row, one of four
 * (view · saved · search · filters) that cost a horizontal strip of their own.
 * Owner's call: "move saved filters and map view into the filter option and
 * move the rest up into the 1 column". So this control moved into the sheet
 * and grew words.
 *
 * A segmented control, not chips: both options are always present with exactly
 * one selected, so it reads as "how do you want to look at these jobs?", never
 * as a filter you toggle. Picking a view closes the sheet (`onSelect`, fired by
 * SegmentedControl only on an actual change). It is a radiogroup named
 * "Feed view" with List / Map radios.
 *
 * Omitted entirely on the desktop web (`hideViewToggle`), where the feed and
 * the map are both on screen at once and there is nothing to switch between.
 */
export function BrowseViewToggle({ view, setView, onSelect }: BrowseViewToggleProps) {
  return (
    <SegmentedControl
      ariaLabel="Feed view"
      value={view}
      onChange={(next) => {
        startTransition(() => setView(next));
        onSelect?.();
      }}
      className="w-full"
      optionClassName="flex-1"
      options={OPTIONS.map(({ value, label, Icon }) => ({
        value,
        label,
        icon: <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />,
      }))}
    />
  );
}
