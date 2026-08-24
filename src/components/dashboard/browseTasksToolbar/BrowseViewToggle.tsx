import { startTransition } from "react";
import { List, Map as MapIcon } from "lucide-react";
import { hapticLight } from "@/lib/haptics";

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
 * The Browse feed's List ⇄ Map choice — two labelled chips inside the filter
 * sheet's "View" section.
 *
 * It used to be a bare icon button in the feed's header row, one of four
 * (view · saved · search · filters) that cost a horizontal strip of their own.
 * Owner's call: "move saved filters and map view into the filter option and
 * move the rest up into the 1 column". So this control moved into the sheet
 * and grew words.
 *
 * It is deliberately NOT a filter chip even though it borrows `chipStyles` for
 * its size and shape (one control language per sheet). Two things keep it
 * reading as a view choice: it sits alone under its own "View" heading ABOVE
 * every filter section, and both options are always present with exactly one
 * selected — a filter chip toggles a constraint on and off, this one answers
 * "how do you want to look at these jobs?" and always has an answer.
 *
 * `aria-pressed`, not `role="radio"`: the HIG 44px floor in index.css
 * deliberately skips role=radio/checkbox/switch, so a radio here would render
 * a 36px tap target. Same idiom as SortContent's chips.
 *
 * Omitted entirely on the desktop web (`hideViewToggle`), where the feed and
 * the map are both on screen at once and there is nothing to switch between.
 */
export function BrowseViewToggle({ view, setView, onSelect }: BrowseViewToggleProps) {
  return (
    // A joined segmented control, deliberately SMALLER than the filter chips:
    // it rides the "Sort by" eyebrow line (FilterSheetSection.trailing), so it
    // must read as a mode switch attached to the section, not another chip
    // row. h-7 inside a bordered pill; the active half fills brand olive.
    <div
      role="group"
      aria-label="Feed view"
      className="inline-flex items-center rounded-ds-md squircle border border-border/60 bg-white/70 dark:bg-card/60 backdrop-blur p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = view === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (active) return;
              hapticLight();
              startTransition(() => setView(value));
              onSelect?.();
            }}
            className={`inline-flex items-center gap-1 h-7 px-2.5 rounded-[12px] text-ds-11 font-semibold whitespace-nowrap transition-all duration-200 btn-press ${
              active
                ? "bg-[hsl(var(--bark))] text-[hsl(var(--parchment))]"
                : "text-foreground/80 hover:text-foreground"
            }`}
          >
            <Icon className="w-3 h-3 shrink-0" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default BrowseViewToggle;
