import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * The app's tappable glass tile (Q2709 "nothing hand-made", 2026-11-06): a whole-card button on the liquid-glass
 * surface with the shared press feedback, its content stacked. Home's section tiles and money tiles are it.
 *
 * The tile's own classes are exactly the ones those tiles wore by hand (btn-press liquid-glass text-left flex
 * flex-col min-w-0); a caller adds only its padding, gap and grid span. Plain concatenation, not tailwind-merge,
 * so the rendered class set is the hand-made one class for class (the look cannot move).
 * Guard: src/test/glassTileButtonShared.test.tsx.
 */
const GLASS_TILE = "btn-press liquid-glass text-left flex flex-col min-w-0";

export const GlassTileButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">>(
  ({ className = "", ...props }, ref) => (
    <button ref={ref} type="button" {...props} className={`${GLASS_TILE} ${className}`.trim()} />
  ),
);
GlassTileButton.displayName = "GlassTileButton";
