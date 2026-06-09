import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";
import { hapticLight } from "@/lib/haptics";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root>
>(({ className, onCheckedChange, ...props }, ref) => {
  const handleCheckedChange = React.useCallback(
    (checked: boolean) => {
      // Light haptic tick on every toggle — no-ops silently on web.
      void hapticLight();
      onCheckedChange?.(checked);
    },
    [onCheckedChange],
  );

  return (
    <SwitchPrimitives.Root
      className={cn(
        // iOS-style track: 31×51 px, pill shape, smooth transition.
        "peer inline-flex h-[31px] w-[51px] shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent",
        // Checked → olivewood tint; unchecked → muted neutral.
        "data-[state=checked]:bg-[hsl(var(--olivewood))]",
        "data-[state=unchecked]:bg-[hsl(var(--ink-deep)/0.18)]",
        // Inner shadow gives the sunken-track feel iOS uses.
        "shadow-inner",
        // Smooth color + focus transitions.
        "transition-colors duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--olivewood))] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      onCheckedChange={handleCheckedChange}
      {...props}
      ref={ref}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          // Thumb: white pill, subtle drop shadow, iOS-precise dimensions.
          "pointer-events-none block h-[27px] w-[27px] rounded-full bg-white",
          "shadow-[0_2px_4px_rgba(0,0,0,0.20),0_1px_2px_rgba(0,0,0,0.12)]",
          "ring-0 transition-transform duration-200 ease-in-out",
          "data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0",
        )}
      />
    </SwitchPrimitives.Root>
  );
});
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
