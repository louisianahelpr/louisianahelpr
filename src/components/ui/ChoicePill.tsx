import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * The app's choice pill: one option of a single-choice row (auto-tip amounts).
 * Declutter's sell-step ChipGroup still draws its own 40px copy and moves onto
 * this in the next Declutter slice. `role="radio"` with `aria-checked`, so the
 * parent is a `role="radiogroup"`.
 *
 * SELECTED wears `btn-grad-primary`, the shared glossy primary surface, never a
 * flat tint (`glossyPrimaryInvariant.test.ts`), with its ink declared inline so
 * the gradInkContrast resolver can rebuild it. `min-h-11` is declared because
 * the global `button { min-height: 44px }` EXCLUDES `[role="radio"]`. The focus
 * ring's offset is the page colour (`ring-offset-background`), never the white
 * Tailwind default (ringOffsetIsThePageNotWhite.test.ts).
 */
export function ChoicePill({
  selected,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      {...props}
      className={cn(
        "flex min-h-11 items-center rounded-full px-4 font-sans text-ds-13 font-semibold transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
        selected ? "btn-grad-primary !text-[hsl(var(--parchment))]" : "border border-border bg-card text-foreground",
        className,
      )}
    >
      {/* Written out, not left in the props spread, so the gradInkContrast resolver sees the label it scores. */}
      {children}
    </button>
  );
}
