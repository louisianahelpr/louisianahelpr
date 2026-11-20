import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

/**
 * One small square thumbnail under a photo gallery that shows its photo when pressed (owner 11-20, Declutter item page
 * polish #2: on a computer a row of thumbnails replaces the dots). A 64px square, the photo cropped to fill it
 * (`PHOTO_THUMB_IMG` on the caller's <img>), the current one ringed and fully opaque. `current` sets aria-current and
 * data-thumb-active; the caller passes the label ("Show photo 2 of 3"), onClick and the image as children.
 */
const PHOTO_THUMB_TARGET =
  "relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border bg-photo-empty transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background";
/** The thumbnail's image: fills the square, cropped (the whole photo is in the frame above it). */
export const PHOTO_THUMB_IMG = "h-full w-full object-cover";

export const PhotoThumbButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "className"> & { current: boolean; "aria-label": string; children: ReactNode }
>(({ current, children, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    {...props}
    aria-current={current ? "true" : undefined}
    data-thumb-active={current ? "" : undefined}
    className={`${PHOTO_THUMB_TARGET} ${current ? "border-foreground/70" : "border-border opacity-80"}`}
  >
    {children}
  </button>
));
PhotoThumbButton.displayName = "PhotoThumbButton";
