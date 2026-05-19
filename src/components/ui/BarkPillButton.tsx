import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";

/**
 * BarkPillButton — the bark-filled rounded pill used for the primary CTA
 * on empty-state cards (Browse tasks / Post a Job / Post the first job).
 *
 * Delegates entirely to `<Button variant="bark">` so there is a single
 * implementation of the bark style. Caller-supplied className/style still
 * merge in last; the public API is unchanged.
 */
export function BarkPillButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="bark"
      {...props}
      className={cn("rounded-full px-6 h-12", className)}
    />
  );
}
