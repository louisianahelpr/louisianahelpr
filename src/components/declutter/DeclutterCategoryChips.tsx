/**
 * Browse's category chips (owner 11-07, after reviewing Vinted; replaces the 10-21 "no chip row under Search items"):
 * one row at the top of the list, thumbed sideways on a phone. "All" first, then the categories that have something
 * for sale on this list, busiest first (a chip never opens an empty page), each with its icon; the chosen one stays
 * even if it has nothing. A chip sets the same category the filter sheet sets (one value, so the sheet, the saved
 * search and the URL agree); tapping the chosen chip again shows everything.
 *
 * Owner pick 4 (11-08, design audit B §4.6 / §5.13): no icons on this row (it fits about four chips at 375 instead of
 * 2.5; the icons stay in the category picker), and "Free" is a chip right after "All" (the same freeOnly filter the
 * sheet sets), so guests and members reach giveaways the same way.
 *
 * Built from the counts the list already holds: no read of its own. Chips are the shared FilterChip.
 * Guard: src/test/declutterBrowseChipsAndSaves.test.tsx.
 */
import { useMemo } from "react";
import { FilterChip } from "@/components/ui/FilterChip";
import { CATEGORIES, CATEGORY_LABEL } from "@/lib/declutter/categoryIcons";

export function DeclutterCategoryChips({ items, value, onChange, free = false, onFree }: {
  items: readonly { category: string; current_price_cents?: number }[];
  value: string | null;
  onChange: (category: string | null) => void;
  /** The Free chip is on (filters.freeOnly). */
  free?: boolean;
  /** Turns Free on or off; leave out for no Free chip. */
  onFree?: (on: boolean) => void;
}) {
  const chips = useMemo(() => {
    const n = new Map<string, number>();
    for (const i of items) n.set(i.category, (n.get(i.category) ?? 0) + 1);
    const order = new Map(CATEGORIES.map((c, i) => [c.key, i]));
    const keys = [...n.keys()].filter((k) => CATEGORY_LABEL[k]);
    if (value && CATEGORY_LABEL[value] && !n.has(value)) keys.push(value);
    return keys.sort((a, b) => (n.get(b) ?? 0) - (n.get(a) ?? 0) || (order.get(a) ?? 99) - (order.get(b) ?? 99));
  }, [items, value]);
  const anyFree = useMemo(() => items.some((i) => i.current_price_cents === 0), [items]);
  const freeChip = !!onFree && (anyFree || free);
  if (chips.length < 2 && !value && !freeChip) return null;
  return (
    <div role="group" aria-label="Categories" data-chip-row="categories" className="flex min-w-0 gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <FilterChip pressed={value === null && !free} onClick={() => { onChange(null); if (free) onFree?.(false); }} className="shrink-0" data-category-chip="all">All</FilterChip>
      {freeChip && (
        <FilterChip pressed={free} onClick={() => onFree?.(!free)} className="shrink-0" data-category-chip="free">Free</FilterChip>
      )}
      {chips.map((k) => (
        <FilterChip key={k} pressed={value === k} onClick={() => onChange(value === k ? null : k)} className="shrink-0" data-category-chip={k}>
          {CATEGORY_LABEL[k]}
        </FilterChip>
      ))}
    </div>
  );
}
