import type { FormEvent, RefObject } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";

/**
 * THE ONE BROWSE SEARCH ROW (owner, 2026-10-19: "make layout consistent so the
 * shells are in the same place for each"). Every section's Browse (Jobs,
 * Declutter, Shops, Homes) opens on this exact row under its toggle: a
 * magnifier, a "Search <section>" field, Clear while there is text, and the
 * filter button INSIDE the row's right edge, wearing a count badge while a
 * filter is on. One component, so the four cannot drift apart again (Shops
 * had a plain "All shops" button; Homes was 4px taller).
 *
 * Below 360px the PLACEHOLDER steps down to 13px so the longest one ("Homes
 * for sale: City or ZIP") is whole at 320; what you type stays 15px.
 *
 * Geometry is pinned by e2e/prod-audit/section-shell-alignment.spec.ts.
 *
 * FOCUS: the pill is the one ring (deep audit #46, 2026-10-28). It is an OUTLINE on the form, because the T2
 * card rule in index.css pins every .bg-card box-shadow with !important, so a `ring-*` (a box-shadow) never
 * painted; and the input drops the global outline (`focus-visible:outline-none`), which had drawn a square
 * box around the words inside the pill. Guard: src/test/oneFocusRingOnFields.test.ts.
 */
export function SectionSearchRow({
  value,
  onChange,
  placeholder,
  searchLabel,
  onSubmit,
  filterCount = 0,
  filtersOpen = false,
  onFilters,
  filtersLabel,
  filtersButtonRef,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  /** "Search jobs", "Search shops", "City or ZIP"... */
  placeholder: string;
  /** The search landmark's name; defaults to the placeholder. */
  searchLabel?: string;
  /** Enter in the field (the list already filters as you type). */
  onSubmit?: () => void;
  /** Filters on; > 0 shows the count badge. */
  filterCount?: number;
  filtersOpen?: boolean;
  /** Opens the filters. Omitted where the filters are already on screen (Declutter's desktop column): no button then. */
  onFilters?: () => void;
  /** Overrides the button's name, e.g. "Filters, within 10 miles". */
  filtersLabel?: string;
  filtersButtonRef?: RefObject<HTMLButtonElement>;
  testId?: string;
}) {
  const active = filterCount > 0;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit?.();
  };
  return (
    <form
      role="search"
      aria-label={searchLabel ?? placeholder}
      onSubmit={submit}
      data-section-search=""
      data-testid={testId}
      className="flex items-center gap-2 h-10 pl-3.5 pr-1 rounded-full border border-border bg-card focus-within:outline focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-[hsl(var(--ring))]"
    >
      <Search className="w-[18px] h-[18px] text-muted-foreground shrink-0" aria-hidden />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        enterKeyHint="search"
        className="flex-1 min-w-0 bg-transparent text-ds-15 text-foreground outline-none focus-visible:outline-none placeholder:text-muted-foreground max-[359px]:placeholder:text-ds-13 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")} className="w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-muted-foreground">
          <X className="w-4 h-4" aria-hidden />
        </button>
      )}
      {onFilters && <button
        ref={filtersButtonRef}
        type="button"
        onClick={onFilters}
        aria-label={filtersLabel ?? (active ? `Filters (${filterCount} active)` : "Filters")}
        aria-expanded={filtersOpen}
        data-state={active ? "active" : "inactive"}
        className={`btn-press relative shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${active || filtersOpen ? "bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))]" : "text-muted-foreground"}`}
      >
        <SlidersHorizontal className="w-[18px] h-[18px]" aria-hidden />
        {active && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-ds-9 font-bold flex items-center justify-center">
            {filterCount}
          </span>
        )}
      </button>}
    </form>
  );
}
