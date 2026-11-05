import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * The app's tappable list row: a full-width button with its label on the left and an optional trailing mark
 * (a chevron, a count) on the right. FAQ disclosure rows, the inbox's "show all" bar row, a picker's option row.
 *
 * Built from the shared row tokens the category picker already wears (src/components/ui/TwoStepCategoryPicker.tsx,
 * Q2709 11-04): 44px floor, rounded-xl, px-3 py-2, the sanctioned hover TINT (`ctl-tint`, never a fade or a lift:
 * controlInteractionSameness.test.ts), and the app's focus ring with the page-coloured offset. A caller sets only
 * its own spacing and type; the hover, ring and tap floor are the row's.
 *
 * `variant="flush"` (Q2709, 11-04 night, lead's call): a row INSIDE an existing grouped list (a rounded card with
 * dividers, e.g. Declutter's Manage listing sheet). No radius and no offset (the card clips both), the ring drawn
 * inset, the grouped list's 60px floor and px-4 py-3.5 padding, and the same tint. Its siblings in that list that
 * are not buttons (a router Link, a switch row, a child row handed `rowClassName`) wear LIST_ROW_FLUSH, so the
 * whole list keeps ONE look; a tappable sibling adds LIST_ROW_TINT.
 *
 * Guard: src/test/listRowShared.test.tsx.
 */
export const LIST_ROW_FLUSH =
  "flex w-full items-center gap-3 px-4 py-3.5 text-left min-h-[60px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** The hover tint a tappable flush row wears (the shared, sanctioned one). */
export const LIST_ROW_TINT = "ctl-tint";

const CARD =
  "flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left ctl-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background";

export const ListRow = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { trailing?: React.ReactNode; variant?: "card" | "flush" }
>(({ className, children, trailing, variant = "card", ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    {...props}
    className={cn(variant === "flush" ? `${LIST_ROW_FLUSH} ${LIST_ROW_TINT}` : CARD, className)}
  >
    {children}
    {trailing}
  </button>
));
ListRow.displayName = "ListRow";
