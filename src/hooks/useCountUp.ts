// useCountUp — tween a number toward a target over a short window.
// Used by the hero status pill so the "N jobs open" count animates
// up/down on RPC refetch instead of snapping. Respects
// prefers-reduced-motion (snaps instantly when reduced motion is on).
//
// Pure JS interpolation — no animation library dependency. RAF-based
// so it idles at zero cost when the target hasn't changed.

import { useEffect, useState, useRef } from "react";

export interface UseCountUpOptions {
  /** Animation duration in ms. Default 800. */
  durationMs?: number;
}

export function useCountUp(target: number | null, opts: UseCountUpOptions = {}): number | null {
  const duration = opts.durationMs ?? 800;
  const [display, setDisplay] = useState<number | null>(target);
  const rafRef = useRef<number | null>(null);
  const prevTargetRef = useRef<number | null>(target);

  useEffect(() => {
    // Null target → reset display to null (e.g. RPC failed → fall back).
    if (target === null) {
      setDisplay(null);
      prevTargetRef.current = null;
      return;
    }
    // First non-null value or honor reduced motion → snap.
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prevTargetRef.current === null || reducedMotion) {
      setDisplay(target);
      prevTargetRef.current = target;
      return;
    }
    // Same target → no-op.
    if (prevTargetRef.current === target) return;

    const from = prevTargetRef.current;
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const t = Math.min(1, elapsed / duration);
      // ease-out-cubic: feels organic, faster start, gentle settle.
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(from + (target - from) * eased);
      setDisplay(value);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    prevTargetRef.current = target;

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return display;
}
