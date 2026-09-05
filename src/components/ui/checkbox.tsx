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
        // iOS-style checkbox: 20×20 px for a comfortable tap target feel
        // with a rounded-sm shape and brand-token checked state.
        "peer h-5 w-5 shrink-0 rounded-sm",
        "border border-[hsl(var(--ink-deep)/0.25)]",
        "ring-offset-background",
        // Checked: olivewood fill + white indicator.
        "data-[state=checked]:bg-[hsl(var(--olivewood))] data-[state=checked]:border-[hsl(var(--olivewood))] data-[state=checked]:text-white",
        // Smooth transition for fill and border color.
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--olivewood))] focus-visible:ring-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      onCheckedChange={handleCheckedChange}
      {...props}
    >
      <CheckboxPrimitive.Indicator className={cn("flex items-center justify-center text-current")}>
        {/* Slightly bolder, tighter check for a crisp iOS look. */}
        <Check className="h-3.5 w-3.5 stroke-[2.5]" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
