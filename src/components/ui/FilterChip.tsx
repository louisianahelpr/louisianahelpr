import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * The Jobs filter chip (Q2709 "nothing hand-made", Jobs packet, 2026-11-06): one chip of the Jobs filter sheet
 * (Sort, Category, Distance, When), the Running-late minutes and the Change-the-job day strip. These were hand-made
 * <button>s sharing one set of class strings exported from JobFilters.tsx; the strings live here now, unchanged, and
 * the chip is this component. Plain concatenation, not tailwind-merge, so the rendered class SET is the hand-made
 * one class for class (lead 11-06: convert only what stays look-identical).
 *
 * Not ToggleChip: that chip is 44px with a foreground/25 edge on the page fill; this one is the board-24 40px chip
 * on bg-card. Folding the two into one look is a design change for the owner, not a conversion.
 *
 * `pressed` drives both `aria-pressed` and the look. Leave it out for an action chip ("Need a new time"): no
 * aria-pressed (as before) and the idle look.
 *
 * Guard: src/test/filterChipShared.test.tsx.
 */

/**
 * Size (board 24, lead review 2026-10-20): the Declutter ChipGroup recipe (min-h-10, px-4, text-ds-13;
 * DeclutterSellSteps.tsx). Measured in Chromium on /jobs: each chip renders 40px tall (the global 44px button floor
 * does not reach these aria-pressed chips), the same as the Declutter chips.
 */
export const FILTER_CHIP =
  "inline-flex items-center gap-1.5 px-4 rounded-full text-ds-13 font-semibold whitespace-nowrap transition-colors duration-200 btn-press border min-h-10";
// Selected = the app's GLOSSY primary surface (`btn-grad-primary`), never a flat fill. Standing project rule: every
// green/bark primary button and every selected/active control wears it (this chip was the last flat one: an 18% bark
// TINT). `[&_*]` pins the CategoryIcon inside an active chip to parchment too, otherwise it keeps its per-category
// tint and disappears into the fill.
export const FILTER_CHIP_ON =
  "btn-grad-primary !text-[hsl(var(--parchment))] [&_*]:!text-[hsl(var(--parchment))] border-transparent";
export const FILTER_CHIP_OFF = "bg-card text-foreground border-border hover:bg-[hsl(var(--bark)/0.06)]";

const SIZES = {
  default: FILTER_CHIP,
  // Five chips (Any + four radii) on one line at 375 (lead, board 24 r2): px-3, not px-4.
  tight: FILTER_CHIP.replace("px-4", "px-3"),
  // A strip thumbed sideways on a phone (Change the job's days): the 44px floor.
  tall: FILTER_CHIP.replace("min-h-10", "min-h-11"),
} as const;

export const FilterChip = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-pressed"> & { pressed?: boolean; size?: keyof typeof SIZES }
>(({ pressed, size = "default", className = "", ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-pressed={pressed}
    {...props}
    className={`${SIZES[size]} ${pressed ? FILTER_CHIP_ON : FILTER_CHIP_OFF} ${className}`.trim()}
  />
));
FilterChip.displayName = "FilterChip";
