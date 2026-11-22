import type { Ref } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The Filters square at the end of the desktop tabs row, for a Browse whose filter state is not Jobs'
 * useDashboardFilters (Declutter, owner 2026-10-28). Same look as Jobs' Filters button in BrowseTasksActions: the shared
 * compact icon Button (a 40px ghost circle in a 44px tap area), tinted while the panel is open or a filter is on, with
 * the count badge.
 *
 * `plain` (owner 11-21, Declutter's desktop row: "remove the circle around filter"): no circle, edge, ring or tint; the
 * same quiet square as the search icon beside it (InlineListSearch's closed state), olive while a filter is on, with the
 * count badge. 44px to tap. Inside the phone's search bar it stays the quiet ghost square.
 * Guard: src/test/declutterHeaderIcons1121.test.tsx.
 */
export function FiltersIconButton({
  open,
  count,
  onClick,
  buttonRef,
  plain = false,
}: {
  open: boolean;
  count: number;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
  plain?: boolean;
}) {
  const on = open || count > 0;
  const look = plain
    ? `ctl-tint ${on ? "text-[hsl(var(--bark))]" : "text-muted-foreground hover:text-foreground"}`
    : on
      ? "bg-[hsl(var(--bark)/0.12)] hover:!bg-[hsl(var(--bark)/0.16)] text-[hsl(var(--bark))] ring-1 ring-inset ring-[hsl(var(--bark)/0.40)]"
      : "text-muted-foreground hover:text-foreground hover:!bg-[hsl(var(--bark)/0.06)]";
  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      size="iconCompact"
      onClick={onClick}
      aria-label={count > 0 ? `Filters (${count} active)` : "Filters"}
      aria-expanded={open}
      data-filters-plain={plain ? "" : undefined}
      className={`relative shrink-0 btn-press focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${look}`}
    >
      <SlidersHorizontal className="w-5 h-5" aria-hidden />
      {count > 0 && (
        <span data-filters-count="" className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-ds-9 font-bold flex items-center justify-center">
          {count}
        </span>
      )}
    </Button>
  );
}
