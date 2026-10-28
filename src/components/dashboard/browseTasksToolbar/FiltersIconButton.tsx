import type { Ref } from "react";
import { SlidersHorizontal } from "lucide-react";

/**
 * The Filters square at the end of the desktop tabs row, for a Browse whose filter state is not Jobs'
 * useDashboardFilters (Declutter, owner 2026-10-28). Same look as Jobs' Filters button in BrowseTasksActions: a 40px
 * ghost square, tinted while the panel is open or a filter is on, with the count badge.
 */
export function FiltersIconButton({
  open,
  count,
  onClick,
  buttonRef,
}: {
  open: boolean;
  count: number;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const on = open || count > 0;
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={onClick}
      aria-label={count > 0 ? `Filters (${count} active)` : "Filters"}
      aria-expanded={open}
      className={`relative h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-ds-md btn-press focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] ${
        on
          ? "bg-[hsl(var(--bark)/0.12)] hover:bg-[hsl(var(--bark)/0.16)] text-[hsl(var(--bark))] ring-1 ring-inset ring-[hsl(var(--bark)/0.40)]"
          : "text-muted-foreground hover:text-foreground hover:bg-[hsl(var(--bark)/0.06)]"
      }`}
    >
      <SlidersHorizontal className="w-5 h-5" aria-hidden />
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-ds-9 font-bold flex items-center justify-center">
          {count}
        </span>
      )}
    </button>
  );
}
