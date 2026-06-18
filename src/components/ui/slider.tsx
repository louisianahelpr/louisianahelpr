import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

/**
 * Slider — the standard shadcn Slider wrapper over @radix-ui/react-slider,
 * styled with the project's brand tokens (bark track-range, olivewood
 * thumbs). Supports a single value OR a range: pass a two-element
 * `value`/`defaultValue` array and Radix renders one grabbable thumb per
 * entry, which the budget range filter relies on.
 *
 * Thumbs are 22px so they clear the 20px minimum and stay easy to grab on
 * a touch surface; the track is tall enough (5px) to read as a solid rail.
 */
const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => {
  // One thumb per value entry — covers both the single-value and the
  // dual-handle range presentations from the same component.
  const thumbCount =
    (Array.isArray(props.value)
      ? props.value
      : Array.isArray(props.defaultValue)
        ? props.defaultValue
        : [props.value ?? props.defaultValue ?? 0]
    ).length;

  return (
    <SliderPrimitive.Root
      ref={ref}
      className={cn(
        "relative flex w-full touch-none select-none items-center",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-[5px] w-full grow overflow-hidden rounded-full bg-[hsl(var(--ink-deep)/0.14)]">
        <SliderPrimitive.Range className="absolute h-full rounded-full bg-[hsl(var(--bark))]" />
      </SliderPrimitive.Track>
      {Array.from({ length: thumbCount }).map((_, i) => (
        <SliderPrimitive.Thumb
          key={i}
          className={cn(
            "block h-[22px] w-[22px] rounded-full border-2 border-[hsl(var(--olivewood))] bg-white",
            "shadow-[0_2px_5px_rgba(0,0,0,0.20),0_1px_2px_rgba(0,0,0,0.12)]",
            "transition-transform duration-150 ease-out",
            "hover:scale-105 active:scale-110",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--olivewood))] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        />
      ))}
    </SliderPrimitive.Root>
  );
});
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
