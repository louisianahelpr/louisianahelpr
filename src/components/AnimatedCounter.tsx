import { useEffect, useRef, useState } from "react";

interface AnimatedCounterProps {
  /** Target numeric value to animate to. Currency or count. */
  value: number;
  /** Animation duration in ms. Default 700. */
  duration?: number;
  /** Decimals to render. Default 2 for currency. Set to 0 for counts. */
  decimals?: number;
  /** Optional prefix (e.g. "$"). */
  prefix?: string;
  /** Optional suffix. */
  suffix?: string;
  /** Pass-through className for the span. */
  className?: string;
  /** Inline style override. */
  style?: React.CSSProperties;
}

/**
 * Smoothly counts up to a numeric value when it changes. Honors
 * prefers-reduced-motion — falls back to a static value with no
 * animation for users who've opted out of UI motion.
 *
 * Uses easeOutCubic for a small "settle" feel at the end. Skips
 * animation entirely on the first render when the initial value is 0
 * so a $0.00 → $0.00 mount doesn't pretend to count.
 */
export function AnimatedCounter({
  value,
  duration = 700,
  decimals = 2,
  prefix = "",
  suffix = "",
  className,
  style,
}: AnimatedCounterProps) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced || value === fromRef.current) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }
    const start = performance.now();
    const from = fromRef.current;
    const delta = value - from;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic — punchy start, soft settle.
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + delta * eased);
      if (t < 1) {
        frameRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(value);
        fromRef.current = value;
        frameRef.current = null;
      }
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [value, duration]);

  const formatted = display.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span className={className} style={style}>
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}
