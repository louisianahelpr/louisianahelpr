import * as React from "react";

import { cn } from "@/lib/utils";
import { FIELD_SURFACE_CLS } from "./fieldSurface";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
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
