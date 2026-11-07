import { forwardRef, type ButtonHTMLAttributes } from "react";
import { CHIP, CHIP_OFF, CHIP_ON } from "./chipClasses";

/**
 * The pressed / not-pressed chip built on ./chipClasses (Sell for me's blanks, the status boxes row): one shared
 * control instead of each caller writing `<button className={CHIP ...}>` by hand (Q2709, OWN-SHARED). Same
 * classes in the same order, so it draws exactly what those buttons drew.
 */
export const ChoiceChip = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "aria-pressed"> & { pressed: boolean }
>(({ pressed, className = "", children, ...props }, ref) => (
  // children written out (not left in props) so gradInkContrast's source reader sees the chip's label as text.
  <button
    ref={ref}
    type="button"
    aria-pressed={pressed}
    {...props}
    className={`${CHIP}${className ? ` ${className}` : ""} ${pressed ? CHIP_ON : CHIP_OFF}`}
  >
    {children}
  </button>
));
ChoiceChip.displayName = "ChoiceChip";
