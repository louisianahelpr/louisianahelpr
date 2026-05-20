import { Heart, type LucideIcon } from "lucide-react";
import { getCategoryIcon } from "@/lib/categoryIcons";

type CategoryPill = {
  icon: LucideIcon;
  label: string;
  nearby: number;
};

// Pills sourced from the canonical `job_category` icon map so the landing
// marquee can never drift from the icons used inside the app (Dashboard,
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
 * Category marquee — continuous left-scrolling loop of all 10 service
 * categories as frosted-glass pills (~20 % larger than the previous size,
 * with a "X nearby" sub-label so the platform reads as populated). The
 * list is duplicated in the DOM so the CSS animation translate(0 → -50%)
 * loops seamlessly. Pauses on hover, skipped on prefers-reduced-motion.
 */
const CategoryBento = ({ onSelect }: CategoryBentoProps) => {
  const loop = [...categories, ...categories];

  return (
    <div className="category-marquee-container overflow-hidden">
      <div className="category-marquee-float">
      <div className="category-marquee items-center gap-3 sm:gap-3.5">
        {loop.map((c, i) => {
          const Icon = c.icon;
          return (
            <button
              key={`${c.label}-${i}`}
              type="button"
              onClick={onSelect}
              aria-hidden={i >= categories.length}
              className="liquid-glass inline-flex items-center gap-2.5 px-5 py-3 rounded-full text-ds-13 sm:text-ds-15 font-sans font-medium tracking-tight whitespace-nowrap shrink-0 transition-transform duration-200 hover:-translate-y-0.5"
              style={{ color: "hsl(var(--olivewood))" }}
            >
              <Icon
                className="w-4 h-4 shrink-0"
                style={{ color: "hsl(var(--bark))" }}
                strokeWidth={1.5}
              />
              {c.label}
              <span
                className="text-ds-11 sm:text-[13px] font-normal"
                style={{ color: "hsl(var(--stormy-sky))" }}
              >
                · {c.nearby} nearby
              </span>
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
};

export default CategoryBento;
