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
 * Built from the counts the list already holds: no read of its own. Chips are the shared FilterChip, in its `tall`
 * size (audit 11-10 F313: the default chip is 40px; a strip thumbed sideways on a phone keeps the 44px tap floor).
 *
 * F053 (UI audit 11-09): with a mouse there was no way to see the chips past the right edge (cut in half, no arrow).
 * On the desktop website the row now fades at an edge that has more and shows a round arrow there, which scrolls it
 * most of a row. Both sit over the row (absolute), so nothing moves when they appear. A phone keeps the thumb swipe.
 * Guard: src/test/declutterBrowseChipsAndSaves.test.tsx.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RowNudgeButton } from "@/components/ui/RowNudgeButton";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { FilterChip } from "@/components/ui/FilterChip";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { CATEGORIES, CATEGORY_LABEL } from "@/lib/declutter/categoryIcons";
import { useLanguage } from "@/lib/i18n/language";
import type { MsgKey } from "@/lib/i18n/en";
import "@/lib/i18n/enDeclutter";

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
    // L021 (landing audit 11-09): "Other" sat mid-row among the real categories (it sorted by count like them). It is
    // always the last chip.
    const last = (k: string) => (k === "other" ? 1 : 0);
    return keys.sort((a, b) => last(a) - last(b) || (n.get(b) ?? 0) - (n.get(a) ?? 0) || (order.get(a) ?? 99) - (order.get(b) ?? 99));
  }, [items, value]);
  const anyFree = useMemo(() => items.some((i) => i.current_price_cents === 0), [items]);
  const freeChip = !!onFree && (anyFree || free);
  const desktop = useIsWebDesktop();
  const { t } = useLanguage();
  const row = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = row.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }));
  }, []);
  useEffect(() => {
    const el = row.current;
    if (!el || !desktop) return;
    measure();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [desktop, measure, chips.length, freeChip]);
  const nudge = (dir: 1 | -1) => {
    const el = row.current;
    if (el) el.scrollBy({ left: dir * Math.max(120, el.clientWidth * 0.8), behavior: "smooth" });
  };
  if (chips.length < 2 && !value && !freeChip) return null;
  const list = (
    <div ref={row} onScroll={desktop ? measure : undefined} role="group" aria-label={t("decl.categories")} data-chip-row="categories" className="flex min-w-0 gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <FilterChip pressed={value === null && !free} onClick={() => { onChange(null); if (free) onFree?.(false); }} size="tall" className="shrink-0" data-category-chip="all">{t("decl.chip.all")}</FilterChip>
      {freeChip && (
        <FilterChip pressed={free} onClick={() => onFree?.(!free)} size="tall" className="shrink-0" data-category-chip="free">{t("decl.chip.free")}</FilterChip>
      )}
      {chips.map((k) => (
        <FilterChip key={k} pressed={value === k} onClick={() => onChange(value === k ? null : k)} size="tall" className="shrink-0" data-category-chip={k}>
          {CATEGORY_LABEL[k] && t(`decl.cat.${k}` as MsgKey)}
        </FilterChip>
      ))}
    </div>
  );
  if (!desktop) return list;
  return (
    <div className="relative min-w-0" data-chip-row-wrap="">
      {list}
      {more.left && (
        <div data-chip-edge="left" className="pointer-events-none absolute inset-y-0 left-0 flex w-16 items-start bg-gradient-to-r from-background via-background/90 to-transparent pb-1">
          <RowNudgeButton aria-label={t("decl.earlierCategories")} onClick={() => nudge(-1)}>
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </RowNudgeButton>
        </div>
      )}
      {more.right && (
        <div data-chip-edge="right" className="pointer-events-none absolute inset-y-0 right-0 flex w-16 items-start justify-end bg-gradient-to-l from-background via-background/90 to-transparent pb-1">
          <RowNudgeButton aria-label={t("decl.moreCategories")} onClick={() => nudge(1)}>
            <ChevronRight className="h-5 w-5" aria-hidden />
          </RowNudgeButton>
        </div>
      )}
    </div>
  );
}
