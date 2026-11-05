import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * The app's toggle chip: one on/off chip of a filter or status row, where any
 * number can be on at once (Declutter's filter sheet, the Buying/Selling
 * status chips). A toggle button (`aria-pressed`), NOT `role="radio"`: a
 * multi-select row is not a radiogroup. For one-of-many use ChoicePill.
 *
 * Built from ChoicePill's tokens (Q2709, 11-04): the same 44px pill, type,
 * focus ring (offset = the page colour, ringOffsetIsThePageNotWhite.test.ts)
 * and SELECTED surface (`btn-grad-primary`, the shared glossy primary, never a
 * flat tint: glossyPrimaryInvariant.test.ts), with its ink declared inline so
 * the gradInkContrast resolver can rebuild it. UNSELECTED keeps the firm edge
 * on the page's own fill that Declutter's filter chip took on 2026-10-28 (lead:
 * on Wanted's card, bg-card + border-border vanished in dark mode), so it shows
 * on a card and on the page alike.
 *
 * Guard: src/test/toggleChipShared.test.tsx (one look, aria-pressed, and the
 * ratchet on hand-written aria-pressed chips).
 */
export function ToggleChip({
  pressed,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      {...props}
      className={cn(
        "flex min-h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-4 font-sans text-ds-13 font-semibold transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
        pressed ? "btn-grad-primary !text-[hsl(var(--parchment))]" : "border border-foreground/25 bg-background text-foreground",
        className,
      )}
    >
      {/* Written out, not left in the props spread, so the gradInkContrast resolver sees the label it scores. */}
      {children}
    </button>
  );
}
