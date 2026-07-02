import { type ReactNode } from "react";
import { motion, useMotionValue, useTransform, animate, type PanInfo } from "framer-motion";
import { CHIP_SWIPE_THRESHOLD } from "./constants";

/**
 * Single filter chip with a horizontal swipe-left affordance. Pulling
 * the chip left past CHIP_SWIPE_THRESHOLD removes the underlying filter
 * (no confirm dialog — same model as the SwipeableJobCard dismiss).
 * The chip's body still renders the existing × button so tap remains
 * a first-class clear gesture.
 *
 * Memoised inline as a small functional component — there are at most
 * 5 chips and they re-render with their parent, so the lighter
 * inline component beats extracting to a separate file.
 */
export function SwipeableFilterChip({
  children,
  onClear,
  ariaLabel,
}: {
  children: ReactNode;
  onClear: () => void;
  ariaLabel: string;
}) {
  const x = useMotionValue(0);
  // Visual hint: the chip fades and tilts a touch as it crosses the
  // commit threshold so the user feels the action arrive before it
  // fires. Matches SwipeableJobCard's "you're crossing the line" cue.
  const opacity = useTransform(x, [CHIP_SWIPE_THRESHOLD * 1.5, CHIP_SWIPE_THRESHOLD, 0], [0.35, 0.7, 1]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x < CHIP_SWIPE_THRESHOLD) {
      onClear();
      return;
    }
    animate(x, 0, { type: "spring", stiffness: 500, damping: 30 });
  };

  return (
    <motion.span
      drag="x"
      dragConstraints={{ left: -120, right: 0 }}
      dragElastic={0.1}
      onDragEnd={handleDragEnd}
      style={{ x, opacity }}
      role="group"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-ds-md bg-[hsl(var(--bark)/0.1)] text-[hsl(var(--bark))] ring-1 ring-inset ring-[hsl(var(--bark)/0.22)] text-ds-11 font-medium touch-pan-y"
    >
      {children}
    </motion.span>
  );
}
