import { forwardRef, type ButtonHTMLAttributes } from "react";
import { X } from "lucide-react";

/**
 * One "filter on" chip that removes its filter when pressed: its words, then a small X (Declutter Browse's row of
 * filters on, F054). It was a hand-made <button> with exactly this class set (Q2709 "nothing hand-made"); plain
 * concatenation, not tailwind-merge, so the rendered class SET is the hand-made one. The caller passes the words as
 * children, a label that says what pressing it does ("Remove filter: Free"), and onClick.
 *
 * Not FilterChip: that is the min-height Jobs chip in semibold with an on/off look; this one is a fixed 40px,
 * medium weight, always "on". Guard: src/test/declutterSharedControls.test.tsx.
 */
export const REMOVE_CHIP =
  "inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-ds-13 font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export const RemoveFilterChip = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "className"> & { "aria-label": string }>(
  ({ children, ...props }, ref) => (
    <button ref={ref} type="button" {...props} className={REMOVE_CHIP}>
      {children}
      <X className="h-3.5 w-3.5" aria-hidden />
    </button>
  ),
);
RemoveFilterChip.displayName = "RemoveFilterChip";
