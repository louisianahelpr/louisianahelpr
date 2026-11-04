import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A square photo you tap to open (Q2026, the profile's past-work grid): one shared tile instead of a hand-made
 * <button> per screen (OWN-SHARED). The caller passes the <img> as children and opens its own viewer in onClick.
 * Always a real button (keyboard and screen reader reachable), named by `aria-label`, with the app's focus ring.
 */
export const PhotoTileButton = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { "aria-label": string }
>(({ className, children, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    className={cn(
      "relative aspect-square rounded-ds-sm overflow-hidden bg-muted active:scale-[0.98] transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      className,
    )}
    {...props}
  >
    {children}
  </button>
));
PhotoTileButton.displayName = "PhotoTileButton";
