import type { ButtonHTMLAttributes } from "react";

/**
 * Q2709 "nothing hand-made" (Builder 2, 2026-11-06): the small bark filter chip on a member's public profile Reviews
 * (pages/user/ReviewsSection.tsx: the category chips and the star buckets). Both rows were hand-made
 * <button aria-pressed>s with this one class set and inline fill; this is that exact look, nothing new (it is not
 * ToggleChip's 44 px pill: moving onto that is a look change for the owner). Pressed: solid bark with parchment ink;
 * not: a bark tint. Classes are joined, not tailwind-merged, so the set is exactly the hand-made one.
 */
export const REVIEW_FILTER_CHIP_CLS =
  "inline-flex items-center gap-1 px-2 py-1 rounded-ds-md text-ds-11 font-sans font-semibold transition-colors";

export function ReviewFilterChip({ pressed, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      {...props}
      className={className ? `${REVIEW_FILTER_CHIP_CLS} ${className}` : REVIEW_FILTER_CHIP_CLS}
      style={{
        color: pressed ? "hsl(var(--parchment))" : "hsl(var(--bark))",
        background: pressed ? "hsl(var(--bark))" : "hsl(var(--bark) / 0.08)",
        border: `0.5px solid hsl(var(--bark) / ${pressed ? "0.6" : "0.18"})`,
      }}
    >
      {children}
    </button>
  );
}
