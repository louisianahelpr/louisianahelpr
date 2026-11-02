import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";
import { hapticLight } from "@/lib/haptics";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, onCheckedChange, ...props }, ref) => {
  const handleCheckedChange = React.useCallback(
    (checked: boolean | "indeterminate") => {
      // Light haptic on every state change — no-ops silently on web.
      void hapticLight();
      onCheckedChange?.(checked);
    },
    [onCheckedChange],
  );

  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        // An 18 px box with a 12 px tick (owner 2026-11-01: "The check boxes
        // are quite large"). The tap target is the label row around it
        // (min-h-11), never the box. Guard: src/test/checkboxesAreEighteenPx.test.ts.
        "peer h-[18px] w-[18px] shrink-0 rounded-sm",
        "border border-[hsl(var(--ink-deep)/0.25)]",
        "ring-offset-background",
        // Checked: THE BRAND PRIMARY, and its own paired foreground.
        //
        // This was `--olivewood`, which is not a brand colour — it is the
        // primary TEXT token. In light mode that painted every checked box
        // #2E2F22, near-black, next to olive-green primary buttons on the same
        // form; in dark mode `--olivewood` inverts to a near-white 36 15% 80%,
        // so the box filled rgb(212,206,196) and the hardcoded white check on
        // it measured 1.31:1 — the tick was, in practice, invisible at exactly
        // the moment it is the only thing telling you the box is ticked.
        //
        // `--primary` / `--primary-foreground` is the pair that already
        // inverts correctly together (parchment ink on bark in light,
        // near-black ink on lightened bark in dark — the same pairing
        // `btn-grad-primary` uses), so the checkbox now reads as the same
        // control family as the primary button beside it. Measured after:
        // 6.0:1 light, 6.5:1 dark.
        "data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground",
        // Smooth transition for fill and border color.
        "transition-colors duration-150",
        "ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--olivewood))] focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      onCheckedChange={handleCheckedChange}
      {...props}
    >
      <CheckboxPrimitive.Indicator className={cn("flex items-center justify-center text-current")}>
        {/* A 12 px tick, slightly bolder for a crisp iOS look. */}
        <Check className="h-3 w-3 stroke-[2.5]" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
