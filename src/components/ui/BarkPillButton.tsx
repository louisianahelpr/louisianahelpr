import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

/**
 * BarkPillButton — the bark-filled rounded pill used for the primary CTA
 * on empty-state cards (Browse tasks / Post a Job / Post the first job).
 *
 * Delegates entirely to `<Button variant="primary">` so there is a single
 * implementation of the bark style. Caller-supplied className/style still
 * merge in last; the public API is unchanged.
 */
export function BarkPillButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="primary"
      {...props}
      // h-auto + min-h-12 + whitespace-normal lets the label wrap onto a
      // second line on very narrow screens (320w / iPhone SE) instead of
      // forcing the pill wider than its container — the Button base
      // class is `whitespace-nowrap`, so without this override a long
      // CTA like "Get notified of new jobs" overflows the empty-state
      // card. On wider screens the label fits in one row anyway, so the
      // visual is unchanged at >=375w.
      className={cn(
        "rounded-ds-md px-6 h-auto min-h-12 py-2.5 max-w-full whitespace-normal text-center leading-tight",
        className,
      )}
    />
  );
}
