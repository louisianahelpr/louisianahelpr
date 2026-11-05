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
 * Guard: src/test/listRowShared.test.tsx.
 */
export const ListRow = React.forwardRef<
  HTMLButtonElement,
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> & { trailing?: React.ReactNode }
>(({ className, children, trailing, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    {...props}
    className={cn(
      "flex min-h-11 w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left ctl-tint",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
      className,
    )}
  >
    {children}
    {trailing}
  </button>
));
ListRow.displayName = "ListRow";
