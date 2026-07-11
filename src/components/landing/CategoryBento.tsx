import { Heart, type LucideIcon } from "lucide-react";
import { getCategoryIcon } from "@/lib/categoryIcons";

type CategoryPill = {
  icon: LucideIcon;
  label: string;
  nearby: number;
};

// Tiles sourced from the canonical `job_category` icon map so the landing
// grid can never drift from the icons used inside the app (Dashboard,
// JobCard, JobFilters, PostJob picker). "Senior Help" is intentionally
// extra here — it's a marketing aspiration, not a real DB enum value, so
// it stays defined inline.
const categories: CategoryPill[] = [
  { icon: getCategoryIcon("yard_work"), label: "Yard Work", nearby: 12 },
  { icon: getCategoryIcon("cleaning"), label: "Cleaning", nearby: 14 },
  { icon: getCategoryIcon("moving"), label: "Moving", nearby: 5 },
  { icon: getCategoryIcon("errands"), label: "Errands", nearby: 9 },
  { icon: getCategoryIcon("handyman"), label: "Handyman", nearby: 7 },
  { icon: getCategoryIcon("painting"), label: "Painting", nearby: 4 },
  { icon: getCategoryIcon("delivery"), label: "Delivery", nearby: 8 },
  { icon: getCategoryIcon("pet_care"), label: "Pet Care", nearby: 6 },
  { icon: getCategoryIcon("assembly"), label: "Assembly", nearby: 3 },
  { icon: Heart, label: "Senior Help", nearby: 5 },
];

interface CategoryBentoProps {
  onSelect: () => void;
}

/**
 * Category tile grid — a static, utility-first bento of all 10 service
 * categories rendered as icon + label + "N nearby" tiles. Layout is
 * `grid-cols-2` on mobile, `sm:grid-cols-4`, `lg:grid-cols-5`, so the whole
 * catalog is visible at once above the fold and reads like a real product
 * finder (Thumbtack / Angi / HomeAdvisor pattern) rather than marketing
 * chrome.
 *
 * Each tile is its own `<button>` firing the shared `onSelect` handler —
 * the previous marquee used a single outer button wrapping decorative
 * pills to work around a responsive-audit false positive on off-canvas
 * animated pills. A static grid has no off-canvas nodes, so per-tile
 * semantics are safe and give better a11y (each tile carries its own
 * "Browse {label} jobs" name).
 */
const CategoryBento = ({ onSelect }: CategoryBentoProps) => {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-4">
      {categories.map((c) => {
        const Icon = c.icon;
        return (
          <button
            key={c.label}
            type="button"
            onClick={onSelect}
            aria-label={`Browse ${c.label} jobs`}
            className="group flex flex-col items-center justify-center gap-2 p-4 sm:p-5 rounded-2xl bg-white border border-[hsl(var(--olivewood)/0.12)] hover:border-[hsl(var(--burnt-sienna)/0.4)] hover:shadow-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--burnt-sienna))] focus-visible:ring-offset-2"
          >
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center bg-[hsl(var(--burnt-sienna)/0.08)] group-hover:bg-[hsl(var(--burnt-sienna)/0.14)] transition-colors">
              <Icon
                className="w-5 h-5"
                style={{ color: "hsl(var(--burnt-sienna))" }}
                strokeWidth={1.75}
              />
            </div>
            <span className="text-ds-13 sm:text-ds-15 font-sans font-semibold text-[hsl(var(--ink-deep))] text-center leading-tight">
              {c.label}
            </span>
            <span className="text-ds-11 font-sans text-[hsl(var(--olivewood)/0.7)]">
              {c.nearby} nearby
            </span>
          </button>
        );
      })}
    </div>
  );
};

export default CategoryBento;
