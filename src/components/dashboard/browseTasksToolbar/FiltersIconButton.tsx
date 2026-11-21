import type { Ref } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The Filters square at the end of the desktop tabs row, for a Browse whose filter state is not Jobs'
 * useDashboardFilters (Declutter, owner 2026-10-28). Same look as Jobs' Filters button in BrowseTasksActions: the shared
 * compact icon Button (a 40px ghost circle in a 44px tap area), tinted while the panel is open or a filter is on, with
 * the count badge.
 *
 * `outlined` (owner 11-21, Declutter header polish): beside Declutter's outlined "Use my location" pill on the desktop
 * row, the 44px circle wears the SAME outline variant and edge (iconCompact's transparent 2px edge swapped for the
 * outline's 1.5px ink edge), so the row's two buttons read as one pair instead of a pill and a loose icon. Inside the phone's search bar it stays the quiet ghost square.
 */
export function FiltersIconButton({
  open,
  count,
  onClick,
  buttonRef,
  outlined = false,
}: {
  open: boolean;
  count: number;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
  outlined?: boolean;
}) {
  const on = open || count > 0;
  return (
    <Button
      ref={buttonRef}
      type="button"
      variant={outlined ? "outline" : "ghost"}
      size="iconCompact"
      onClick={onClick}
      aria-label={count > 0 ? `Filters (${count} active)` : "Filters"}
      aria-expanded={open}
      data-filters-outlined={outlined ? "" : undefined}
      className={`relative shrink-0 btn-press focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${outlined ? "!border-[1.5px] !border-foreground/70 " : ""}${
        on
          ? "bg-[hsl(var(--bark)/0.12)] hover:!bg-[hsl(var(--bark)/0.16)] text-[hsl(var(--bark))] ring-1 ring-inset ring-[hsl(var(--bark)/0.40)]"
          : "text-muted-foreground hover:text-foreground hover:!bg-[hsl(var(--bark)/0.06)]"
      }`}
    >
      <SlidersHorizontal className="w-5 h-5" aria-hidden />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-ds-9 font-bold flex items-center justify-center">
          {count}
        </span>
      )}
    </Button>
  );
}
