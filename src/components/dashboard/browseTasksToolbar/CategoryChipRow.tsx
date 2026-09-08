import { useEffect, useRef } from "react";
import { categoryLabels, chipStyles } from "@/components/dashboard/JobFilters";
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
  // Same chip vocabulary as the filter sheet — `chipStyles` is the one place
  // the selected look is defined, and the rule there is that a selected chip
  // wears the gloss (`btn-grad-primary`). This row used to carry its own
  // 12% bark tint for the active chip, which left "Pet Care" selected in the
  // sheet rendering glossy olive and the very same selection, echoed in this
  // row a second later, rendering as flat grey-green with darker text. One
  // control, one selected state.
  const { chipBase, chipActive, chipIdle } = chipStyles;
  const base = `${chipBase} shrink-0 motion-safe:transition-colors`;
  const active = chipActive;
  const idle = chipIdle;

  // Keep the pressed chip on screen. The row scrolls horizontally and the
  // filter sheet can select any category, so "Pet Care" (the eighth chip)
  // was aria-pressed but sitting at x≈730 in a 375px viewport — the row
  // showed "All / Cleaning / Yard Work" with nothing lit, and the active
  // filter was invisible. Scroll the ROW only (never the page: a
  // `scrollIntoView` here would also yank the vertical scroll container).
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const pressed = row.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!pressed) return;
    const left = pressed.offsetLeft - row.clientWidth / 2 + pressed.offsetWidth / 2;
    row.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [selectedCategory]);

  return (
    <div
      ref={rowRef}
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
              // `chipActive` pins every descendant to parchment, so the
              // per-category tint is only applied to the idle chip.
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
