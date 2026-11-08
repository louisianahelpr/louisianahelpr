import * as React from "react";

import { cn } from "@/lib/utils";
import { FIELD_SURFACE_CLS } from "./fieldSurface";

/**
 * The Declutter Sell form's field look (52 px, 14 px corners, on the card colour, olive edge on focus): the
 * `look="card"` Input below, and the className the Sell form's description Textarea and address field share
 * (SellFormParts' SELL_INPUT). Q2709 Declutter packet, 2026-11-06: the Sell / Edit title boxes were hand-made
 * <input>s with exactly this class set; they are `<Input look="card">` now. Plain concatenation, not
 * tailwind-merge, so the rendered class SET is the hand-made one (lead 11-06: convert only what stays
 * look-identical). Guard: src/test/inputCardLookShared.test.tsx.
 */
export const CARD_FIELD_CLS =
  "w-full h-[52px] rounded-[14px] border border-border bg-card px-4 text-ds-15 text-foreground focus:border-primary focus:outline-none placeholder:text-muted-foreground";

type InputProps = React.ComponentProps<"input"> & {
  /**
   * "card": the Sell form's field look (CARD_FIELD_CLS), class for class; the default is the shared glass field.
   * "bare": no surface of its own, for a field drawn inside a composed surface that already is the field's box (the
   * section search bar, owner 11-08: its rounded bar holds the magnifier, the words, the clear and Filters).
   */
  look?: "field" | "card" | "bare";
};

/**
 * look="bare": the field's focus is painted by the composed surface around it, never by the input: every caller rings
 * its wrapper on focus-within (one ring, deep audit #46). Guard: src/test/focusableHasVisibleFocus.test.ts ("a bare
 * Input's wrapper rings on focus-within").
 */
const BARE_FIELD_CLS = "w-full min-w-0 bg-transparent focus-visible:outline-none";

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, look = "field", ...props }, ref) => {
    if (look === "bare") {
      return <input type={type} className={cn(BARE_FIELD_CLS, className)} ref={ref} {...props} />;
    }
    if (look === "card") {
      return <input type={type} className={`${CARD_FIELD_CLS} ${className ?? ""}`.trim()} ref={ref} {...props} />;
    }
    return (
      <input
        type={type}
        className={cn(
          // Preserve existing height/tap-target (h-12 = 48 px ≥ 40 px minimum).
          "flex h-12 w-full",
          FIELD_SURFACE_CLS,
          "ring-offset-background",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          "placeholder:text-muted-foreground",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
