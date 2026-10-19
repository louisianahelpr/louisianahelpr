import { forwardRef } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

/**
 * A section's primary action as a pill (owner, 2026-10-19): Declutter's
 * "Sell an item", Shops' "Open a shop" / "My shop", Homes' "Add a property"
 * and My Posts' "Post a job" share this one shape, in the house olive (or
 * outline) colours. The bottom-nav "+" is gone, so these are each section's
 * own way to add.
 */
const SECTION_ACTION_PILL = "section-action-pill rounded-full whitespace-nowrap px-4";

export const SectionActionPill = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, size = "sm", type = "button", ...props }, ref) => (
    <Button ref={ref} type={type} size={size} className={className ? `${SECTION_ACTION_PILL} ${className}` : SECTION_ACTION_PILL} {...props} />
  ),
);
SectionActionPill.displayName = "SectionActionPill";
