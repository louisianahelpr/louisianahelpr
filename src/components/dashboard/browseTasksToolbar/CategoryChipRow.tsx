import { categoryLabels } from "@/components/dashboard/JobFilters";
import { categoryColors } from "@/components/activity/activityConstants";
import { CategoryIcon } from "@/components/job/CategoryIcon";
import { hapticLight } from "@/lib/haptics";

/**
 * CategoryChipRow — a one-tap category picker. A horizontally
 * scrollable strip of every job category (plus a leading "All" chip)
 * that reads and writes the same `selectedCategory` filter the filter
 * sheet and active-filter recap chips use, so all three stay in sync.
 *
 * This is a *picker* (all categories, one selected), distinct from the
 * active-filter recap row below (which only echoes applied filters).
 * Tapping the already-active chip toggles back to "All" (null).
 */
export function CategoryChipRow({
  selectedCategory,
  setSelectedCategory,
}: {
  selectedCategory: string | null;
  setSelectedCategory: (v: string | null) => void;
}) {
  // Each chip: ≥44px tall hit area (h-11), brand tokens via hsl(var(--…)),
  // active state mirrors the bark-wash used by the filter-sheet chips.
  const base =
    "inline-flex items-center gap-1.5 shrink-0 h-11 px-3.5 rounded-ds-md text-ds-12 font-semibold tracking-tight border btn-press squircle motion-safe:transition-colors";
  const active =
    "bg-[hsl(var(--bark)/0.12)] text-[hsl(var(--bark))] border-[hsl(var(--bark)/0.40)]";
  const idle =
    "bg-white/70 dark:bg-card/60 backdrop-blur text-foreground border-border/60 hover:border-primary/50 hover:bg-white/90 dark:hover:bg-card/90";

  return (
    <div
      className="shrink-0 flex items-center gap-1.5 px-4 py-2.5 overflow-x-auto scrollbar-hide border-b border-border/30"
      role="group"
      aria-label="Filter by category"
    >
      <button
        type="button"
        onClick={() => {
          hapticLight();
          setSelectedCategory(null);
        }}
        aria-pressed={!selectedCategory}
        className={`${base} ${!selectedCategory ? active : idle}`}
      >
        All
      </button>
      {Object.entries(categoryLabels).map(([key, label]) => {
        const isActive = selectedCategory === key;
        const titleColor = (categoryColors[key] || categoryColors.other).title;
        return (
          <button
            key={key}
            type="button"
            onClick={() => {
              hapticLight();
              // Toggle: tapping the active chip clears back to "All".
              setSelectedCategory(isActive ? null : key);
            }}
            aria-pressed={isActive}
            className={`${base} ${isActive ? active : idle}`}
          >
            <CategoryIcon
              category={key}
              aria-hidden
              className={`w-3 h-3 ${isActive ? "" : titleColor}`}
              strokeWidth={2.25}
            />
            {label}
          </button>
        );
      })}
    </div>
  );
}
