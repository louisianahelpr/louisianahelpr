import {
  Leaf,
  Sparkles,
  Truck,
  ShoppingBag,
  Wrench,
  Paintbrush,
  Package,
  PawPrint,
  Hammer,
  Heart,
} from "lucide-react";

type CategoryPill = {
  icon: typeof Leaf;
  label: string;
  nearby: number;
};

const categories: CategoryPill[] = [
  { icon: Leaf, label: "Yard Work", nearby: 12 },
  { icon: Sparkles, label: "Cleaning", nearby: 14 },
  { icon: Truck, label: "Moving", nearby: 5 },
  { icon: ShoppingBag, label: "Errands", nearby: 9 },
  { icon: Wrench, label: "Handyman", nearby: 7 },
  { icon: Paintbrush, label: "Painting", nearby: 4 },
  { icon: Package, label: "Delivery", nearby: 8 },
  { icon: PawPrint, label: "Pet Care", nearby: 6 },
  { icon: Hammer, label: "Assembly", nearby: 3 },
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
              className="liquid-glass inline-flex items-center gap-2.5 px-5 py-3 rounded-full text-sm sm:text-base font-sans font-medium tracking-tight whitespace-nowrap shrink-0 transition-transform duration-200 hover:-translate-y-0.5"
              style={{ color: "hsl(var(--olivewood))" }}
            >
              <Icon
                className="w-4 h-4 shrink-0"
                style={{ color: "hsl(var(--bark))" }}
                strokeWidth={1.5}
              />
              {c.label}
              <span
                className="text-xs sm:text-[13px] font-normal"
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
