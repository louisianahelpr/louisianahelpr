import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * The round Previous / Next arrow over a swipeable photo strip, for a mouse (a phone swipes; hidden below sm).
 * Q2709 "nothing hand-made", Declutter packet, 2026-11-06: the Declutter item gallery's two arrows were hand-made
 * <button>s with exactly this class set; they are this now. Plain concatenation, not tailwind-merge, so the
 * rendered class SET is the hand-made one (lead 11-06: convert only what stays look-identical). The caller passes
 * the side inset (`left-3` / `right-3`), the label, the glyph and its handlers. A disabled arrow fades out
 * (disabled:opacity-0) at the strip's ends.
 *
 * Guard: src/test/photoArrowButtonShared.test.tsx.
 */
const PHOTO_ARROW =
  "absolute top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-opacity disabled:opacity-0 sm:flex";

export const PhotoArrowButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">>(
  ({ className = "", ...props }, ref) => (
    <button ref={ref} type="button" {...props} className={`${PHOTO_ARROW} ${className}`.trim()} />
  ),
);
PhotoArrowButton.displayName = "PhotoArrowButton";
