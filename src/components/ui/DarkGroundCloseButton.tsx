import { forwardRef, type ButtonHTMLAttributes } from "react";
import { X } from "lucide-react";

/**
 * The close X on a photo viewer's black scrim (the job photo lightbox and the chat photo viewer), one shared
 * control instead of two copies (Q2709, OWN-SHARED). A frosted white disc, 40px: `.ctl-tint-invert` is the
 * hover tone for chrome on a permanently dark ground (src/index.css). The rest fill is a CLASS, never an inline
 * `backgroundColor`: an inline fill beats the stylesheet, so the hover tint could never land (the bug both
 * copies once had). Never `hover:scale-*`: it grew the target under a cursor still arriving at it (owner
 * 2026-09-19). Both viewers' name, "Close photo viewer", is written here, so scripts/back-control-inventory.mjs sees
 * this exit (src/test/backControlSameness.test.ts); the classes are written in the tag for the same reason.
 */
const FROSTED = {
  backdropFilter: "blur(20px) saturate(150%)",
  WebkitBackdropFilter: "blur(20px) saturate(150%)",
  border: "0.5px solid rgba(255, 255, 255, 0.2)",
  color: "white",
} as const;

export const DarkGroundCloseButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "children">
>(({ className = "", style, ...props }, ref) => (
  <button ref={ref} type="button" aria-label="Close photo viewer" {...props} className={`absolute top-3 right-3 w-10 h-10 ctl-exit bg-white/[0.12] ctl-tint-invert flex items-center justify-center transition-all active:scale-95 ${className}`.trim()} style={{ ...FROSTED, ...style }}>
    <X className="w-5 h-5" />
  </button>
));
DarkGroundCloseButton.displayName = "DarkGroundCloseButton";
