import { useState, useRef, useCallback, useEffect } from "react";
import { hapticLight, hapticMedium } from "@/lib/haptics";

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  disabled?: boolean;
}

/**
 * Rubber-band resistance curve for the pull translation.
 *
 * Below the threshold the drag maps 1:1 so the indicator tracks the
 * finger exactly. Past the threshold it follows an asymptotic curve
 * (√-based) so the overscroll "gets harder" just like on iOS — the
 * indicator never stops moving entirely, but the rate of gain decays.
 *
 * Formula: threshold + √(excess) * dampFactor
 * The dampFactor keeps the post-threshold growth gentle.
 */
function rubberBand(raw: number, threshold: number): number {
  if (raw <= 0) return 0;
  if (raw <= threshold) return raw;
  const excess = raw - threshold;
  const dampFactor = Math.sqrt(threshold) * 0.8;
  return threshold + Math.sqrt(excess) * dampFactor;
}

export const usePullToRefresh = ({
  onRefresh,
  threshold = 80,
  disabled = false,
}: UsePullToRefreshOptions) => {
  const [pulling, setPulling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);

  const startY = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Tracks raw finger travel so we can derive the rubber-band value.
  const rawDiff = useRef(0);

  // Guards the threshold-crossing haptic so it fires exactly once per pull.
  const didFireThresholdHaptic = useRef(false);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (disabled || refreshing) return;
      const el = containerRef.current;
      if (el && el.scrollTop === 0) {
        startY.current = e.touches[0].clientY;
        rawDiff.current = 0;
        didFireThresholdHaptic.current = false;
        setPulling(true);
      }
    },
    [disabled, refreshing]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!pulling || disabled || refreshing) return;
      const diff = e.touches[0].clientY - startY.current;
      if (diff > 0) {
        rawDiff.current = diff;
        const translated = rubberBand(diff, threshold);
        setPullDistance(translated);

        // Fire a single haptic tick exactly when the pull crosses the
        // threshold — the "click" moment that tells the user "release
        // to refresh".  Guard prevents repeat fires on subsequent frames.
        if (translated >= threshold && !didFireThresholdHaptic.current) {
          didFireThresholdHaptic.current = true;
          // Medium at the threshold — more perceptible than light, mirrors
          // iOS's own pull-to-refresh tick.
          hapticMedium();
        }
      }
    },
    [pulling, disabled, refreshing, threshold]
  );

  const handleTouchEnd = useCallback(async () => {
    if (!pulling || disabled) return;
    setPulling(false);
    didFireThresholdHaptic.current = false;

    if (pullDistance >= threshold) {
      // Light confirmation tap when the refresh actually fires.
      hapticLight();
      setRefreshing(true);
      setPullDistance(0);
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
      }
    } else {
      // Snap back: let CSS spring/ease do the animation; just zero the
      // distance so the transition plays from wherever the indicator is.
      setPullDistance(0);
    }
  }, [pulling, disabled, pullDistance, threshold, onRefresh]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: true });
    el.addEventListener("touchend", handleTouchEnd);
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return {
    containerRef,
    pullDistance,
    refreshing,
    isPulling: pulling && pullDistance > 0,
    /** True once the user has pulled past the trigger threshold — UI can
     *  flip its "Pull to refresh" copy to "Release to refresh." */
    canTrigger: pulling && pullDistance >= threshold,
  };
};
