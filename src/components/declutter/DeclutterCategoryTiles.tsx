/**
 * Browse's category tiles (lead, 2026-10-19, as on OfferUp / Marketplace): ONE
 * sideways row under the search row, an icon and one word per category.
 * Declutter's categories have no sub-categories, so it is one step: a tap
 * shows only that category, a second tap on it shows everything again. The
 * chosen tile wears the shared selected look (btn-grad-primary).
 */
import { CATEGORY_ICON, CATEGORY_WORD } from "@/lib/declutter/categoryIcons";

export function DeclutterCategoryTiles({ value, onChange }: { value: string | null; onChange: (category: string | null) => void }) {
  return (
    <ul aria-label="Categories" data-category-tiles="" className="-mx-3 flex gap-1 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {Object.keys(CATEGORY_WORD).map((key) => {
        const Icon = CATEGORY_ICON[key];
        const on = value === key;
        return (
          <li key={key} className="shrink-0">
            <button
              type="button"
              aria-pressed={on}
              data-category-tile={key}
              onClick={() => onChange(on ? null : key)}
              className="flex w-[76px] flex-col items-center gap-1.5 rounded-2xl py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={`flex h-14 w-14 items-center justify-center rounded-2xl ${on ? "btn-grad-primary text-primary-foreground" : "bg-card text-[hsl(var(--bark))] border border-border dark:text-foreground"}`}
              >
                <Icon className="h-6 w-6" aria-hidden />
              </span>
              <span className={`text-xs leading-tight ${on ? "font-bold text-foreground" : "font-medium text-muted-foreground"}`}>{CATEGORY_WORD[key]}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
