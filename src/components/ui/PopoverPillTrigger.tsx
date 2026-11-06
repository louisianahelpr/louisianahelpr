import { forwardRef, type ButtonHTMLAttributes } from "react";

/**
 * Q2709 "nothing hand-made" (Builder 2, 2026-11-06): the 44 px Filter / Sort pill that opens a popover on Saved Helprs
 * (Profile), and Schedule's Upcoming filter (`compact`). Each was hand-made <button>s with this one class set and inline fill; this is that exact look, nothing
 * new. `on` (a filter is set) wears the shared glossy primary with its ink declared inline; off is the sand fill with an
 * olive edge and ink. Classes are joined, not tailwind-merged, so the set is exactly the hand-made one. A forwardRef
 * with the props spread, so Radix's `PopoverTrigger asChild` can own it.
 */
const POPOVER_PILL_TRIGGER_CLS =
  "shrink-0 inline-flex items-center gap-1.5 rounded-ds-md h-11 px-3 text-ds-11 font-sans font-semibold active:scale-[0.96] transition-all";
/** `compact`: Schedule's Upcoming filter pill, the same pill at 32 px and fully round (its hand-made look, kept). */
const POPOVER_PILL_TRIGGER_COMPACT_CLS =
  "shrink-0 inline-flex items-center gap-1.5 rounded-full h-8 px-3 text-ds-11 font-sans font-semibold active:scale-[0.96] transition-all";
const OFF_STYLE = {
  background: "hsl(var(--ivory-sand) / 0.65)",
  border: "1px solid hsl(var(--olivewood) / 0.18)",
  color: "hsl(var(--olivewood))",
} as const;

export const PopoverPillTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { on?: boolean; compact?: boolean }>(
  function PopoverPillTrigger({ on = false, compact = false, className, style, children, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        {...props}
        className={[compact ? POPOVER_PILL_TRIGGER_COMPACT_CLS : POPOVER_PILL_TRIGGER_CLS, on ? "btn-grad-primary text-[hsl(var(--parchment))]" : "", className ?? ""].join(" ").trim()}
        style={on ? style : { ...OFF_STYLE, ...style }}
      >
        {children}
      </button>
    );
  },
);
