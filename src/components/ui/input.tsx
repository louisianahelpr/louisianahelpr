import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          // Preserve existing height/tap-target (h-12 = 48 px ≥ 40 px minimum).
          "flex h-12 w-full rounded-2xl border px-4 py-2 text-ds-15",
          // Idle border: faint ink-deep so the field is visible but quiet.
          "border-[hsl(var(--ink-deep)/0.15)] glass-field",
          "ring-offset-background",
          "file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
          "placeholder:text-muted-foreground/80",
          // iOS-feel focus ring: olivewood accent, no double outline.
          "focus-visible:outline-none",
          "focus-visible:border-[hsl(var(--olivewood)/0.6)]",
          "focus-visible:ring-2 focus-visible:ring-[hsl(var(--olivewood)/0.25)] focus-visible:ring-offset-0",
          "disabled:cursor-not-allowed disabled:opacity-50",
          // Smooth color + ring transitions.
          "transition-[border-color,box-shadow] duration-200",
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
