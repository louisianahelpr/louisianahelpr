/**
 * Browse's category chips (owner 11-07, after reviewing Vinted; replaces the 10-21 "no chip row under Search items"):
 * one row at the top of the list, thumbed sideways on a phone. "All" first, then the categories that have something
 * for sale on this list, busiest first (a chip never opens an empty page), each with its icon; the chosen one stays
 * even if it has nothing. A chip sets the same category the filter sheet sets (one value, so the sheet, the saved
 * search and the URL agree); tapping the chosen chip again shows everything.
 *
 * Built from the counts the list already holds: no read of its own. Chips are the shared FilterChip.
 * Guard: src/test/declutterBrowseChipsAndSaves.test.tsx.
 */
import { useMemo } from "react";
import { FilterChip } from "@/components/ui/FilterChip";
import { CATEGORIES, CATEGORY_LABEL, categoryIcon } from "@/lib/declutter/categoryIcons";

export function DeclutterCategoryChips({ items, value, onChange }: {
  items: readonly { category: string }[];
  value: string | null;
  onChange: (category: string | null) => void;
}) {
  const chips = useMemo(() => {
    const n = new Map<string, number>();
    for (const i of items) n.set(i.category, (n.get(i.category) ?? 0) + 1);
    const order = new Map(CATEGORIES.map((c, i) => [c.key, i]));
    const keys = [...n.keys()].filter((k) => CATEGORY_LABEL[k]);
    if (value && CATEGORY_LABEL[value] && !n.has(value)) keys.push(value);
    return keys.sort((a, b) => (n.get(b) ?? 0) - (n.get(a) ?? 0) || (order.get(a) ?? 99) - (order.get(b) ?? 99));
  }, [items, value]);
  if (chips.length < 2 && !value) return null;
  return (
    <div role="group" aria-label="Categories" data-chip-row="categories" className="flex min-w-0 gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <FilterChip pressed={value === null} onClick={() => onChange(null)} className="shrink-0" data-category-chip="all">All</FilterChip>
      {chips.map((k) => {
        const Icon = categoryIcon(k);
        return (
          <FilterChip key={k} pressed={value === k} onClick={() => onChange(value === k ? null : k)} className="shrink-0" data-category-chip={k}>
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {CATEGORY_LABEL[k]}
          </FilterChip>
        );
      })}
    </div>
  );
}
