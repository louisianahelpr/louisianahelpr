/**
 * Browse's chip row (board 25; HELPR-DESIGN-SPEC v2 §4.2 "search pill, a
 * horizontal chip row, then content"): "All", the quick filters that are real
 * today ("Price drops" only while some listing is on the nightly drop plan;
 * "Porch pickup"), then one chip per category (one tap shows only that
 * category, a second tap shows everything again: the lead's 2026-10-19 tiles,
 * now in the board's chip style). Wanted, Ships and Consignment chips wait for
 * their features (spec §1.8). Desktop (lg) shows the filter column instead
 * (board 39), so the row is phone and tablet only. Selected chips wear the
 * shared selected look (btn-grad-primary).
 */
import { CATEGORY_WORD } from "@/lib/declutter/categoryIcons";
import { NO_FILTERS, type DeclutterFilters } from "@/lib/declutter/browseFilters";

const CHIP = "flex h-10 shrink-0 items-center rounded-full px-4 text-ds-13 font-semibold whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const OFF = "border border-border bg-card text-foreground";

export function DeclutterChipRow({
  filters,
  onChange,
  showDrops,
}: {
  filters: DeclutterFilters;
  onChange: (f: DeclutterFilters) => void;
  showDrops: boolean;
}) {
  const allOn = !filters.category && !filters.porchOnly && !filters.dropsOnly;
  return (
    <div data-chip-row="" className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 lg:hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button type="button" aria-pressed={allOn} className={`${CHIP} ${allOn ? "btn-grad-primary !text-[hsl(var(--parchment))]" : OFF}`}
        onClick={() => onChange({ ...filters, category: NO_FILTERS.category, porchOnly: false, dropsOnly: false })}
      >
        All
      </button>
      {showDrops && (
        <button type="button" aria-pressed={filters.dropsOnly} className={`${CHIP} ${filters.dropsOnly ? "btn-grad-primary !text-[hsl(var(--parchment))]" : OFF}`}
          onClick={() => onChange({ ...filters, dropsOnly: !filters.dropsOnly })}
        >
          Price drops
        </button>
      )}
      <button type="button" aria-pressed={filters.porchOnly} className={`${CHIP} ${filters.porchOnly ? "btn-grad-primary !text-[hsl(var(--parchment))]" : OFF}`}
        onClick={() => onChange({ ...filters, porchOnly: !filters.porchOnly })}
      >
        Porch pickup
      </button>
      <ul aria-label="Categories" data-category-tiles="" className="flex gap-2">
        {Object.keys(CATEGORY_WORD).map((key) => {
          const on = filters.category === key;
          return (
            <li key={key} className="shrink-0">
              <button
                type="button"
                aria-pressed={on}
                data-category-tile={key}
                onClick={() => onChange({ ...filters, category: on ? null : key })}
                className={`${CHIP} ${on ? "btn-grad-primary !text-[hsl(var(--parchment))]" : OFF}`}
              >
                {CATEGORY_WORD[key]}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
