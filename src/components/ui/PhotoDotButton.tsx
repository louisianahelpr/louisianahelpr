import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * One dot under a photo strip that shows its photo when pressed (Declutter's item gallery, F060: a 32px-tall target
 * around a 10px dot, the current one a 20px bar). It was a hand-made <button> with exactly these classes (Q2709
 * "nothing hand-made"); plain concatenation, so the rendered class SET is the hand-made one. `current` sets
 * aria-current, data-dot-active and the bar; the caller passes the label ("Show photo 2 of 3") and onClick.
 *
 * Guard: src/test/declutterSharedControls.test.tsx.
 */
export const DOT_TARGET =
  "flex h-8 min-w-8 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const PhotoDotButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "className" | "children"> & { current: boolean; "aria-label": string }
>(({ current, ...props }, ref) => (
  <button ref={ref} type="button" {...props} aria-current={current ? "true" : undefined} data-dot-active={current ? "" : undefined} className={DOT_TARGET}>
    <span aria-hidden className={`block h-2.5 rounded-full transition-all ${current ? "w-5 bg-foreground/80" : "w-2.5 bg-foreground/30"}`} />
  </button>
));
PhotoDotButton.displayName = "PhotoDotButton";
