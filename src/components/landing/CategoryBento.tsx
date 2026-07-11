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
 *
 * Why one outer `<button>` wrapping decorative `<div>` pills (not one
 * `<button>` per pill): the marquee track is `width: max-content` and
 * spans ~4000 px even on a 320 px viewport, so every pill the animation
 * places beyond the container right edge had `getBoundingClientRect()`
 * extending past the viewport. The responsive audit's per-element overflow
 * heuristic flagged them all as "off-canvas controls". `overflow: hidden`
 * on the container clips the *paint*, not the layout rect. Because every
 * pill triggers the same `onSelect` (post-job CTA), we collapse the
 * semantics into one focusable `<button>` wrapper — same UX, but only the
 * wrapper's rect is queried (and that rect is the container's rect,
 * fully inside the viewport at every breakpoint).
 */
const CategoryBento = ({ onSelect }: CategoryBentoProps) => {
  const loop = [...categories, ...categories];

  const pillClassName =
    "liquid-glass inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-ds-13 sm:text-ds-15 font-sans font-medium tracking-tight whitespace-nowrap shrink-0 transition-transform duration-200 hover:-translate-y-0.5";

  return (
    // Single outer button wraps the whole marquee surface. The visible
    // pills are decorative (`<div>`) — they share one click target. An
    // explicit aria-label keeps the accessible name short and intent-led
    // instead of concatenating every visible pill label.
    <button
      type="button"
      onClick={onSelect}
      aria-label="Browse jobs by category"
      className="category-marquee-container block w-full text-left overflow-hidden cursor-pointer bg-transparent border-0 p-0 m-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--burnt-sienna))] focus-visible:ring-offset-2 rounded-md"
    >
      <div className="category-marquee-float">
        <div
          aria-hidden="true"
          className="category-marquee items-center gap-3 sm:gap-3.5"
        >
          {loop.map((c, i) => {
            const Icon = c.icon;
            // Every pill renders as a non-interactive `<div>` — the
            // surrounding `<button>` carries the semantics + keyboard
            // handler. Both the original and the duplicate half stay
            // visually identical so the seamless 0→-50% scroll loop
            // works the same as before.
            return (
              <div
                key={`${c.label}-${i}`}
                className={pillClassName}
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
              </div>
            );
          })}
        </div>
      </div>
    </button>
  );
};

export default CategoryBento;
