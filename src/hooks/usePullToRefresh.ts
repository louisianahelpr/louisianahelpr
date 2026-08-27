import { useState, useRef, useCallback, useEffect } from "react";
import { hapticMedium, hapticImpactForce } from "@/lib/haptics";
import { prefersReducedMotion } from "@/lib/accessibility";

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  threshold?: number;
  disabled?: boolean;
}

/**
 * Minimum time the `refreshing` flag stays true once a refresh fires.
 * A cached or fast refresh resolves in a few ms, which would flip
 * `refreshing` true→false within a single frame and flash the
 * pull-to-refresh indicator and the recommended-section skeleton
 * (both gated on `refreshing`). Holding it for a perceptible floor
 * removes the flicker without delaying content — the job list renders
 * independently of this flag.
 */
const MIN_REFRESH_VISIBLE_MS = 500;

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
  // Latest pull value awaiting a frame, and the queued frame's id. Refs, not
  // state: writing them must not itself cause a render.
  const pendingDistance = useRef(0);
  const rafId = useRef<number | null>(null);
  const cancelPendingFrame = useCallback(() => {
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
  }, []);

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
        // Reduce Motion: skip the rubber-band animation curve, snap the
        // visible indicator to the linear value, and only commit a
        // refresh once the user has pulled well past the threshold (so
        // the lack of animation feedback doesn't cause an accidental
        // refresh from a small flick).
        const reduceMotion = prefersReducedMotion();
        const translated = reduceMotion ? diff : rubberBand(diff, threshold);
        // Coalesce to ONE state write per animation frame.
        //
        // touchmove fires 60-120x a second, and this used to call
        // setPullDistance on every single one. Each call re-rendered the
        // wrapper AND everything inside it — on Home that is the entire job
        // feed — so the pull competed with a full React render per touch
        // event and arrived in visible steps. Owner: "it's like not a smooth
        // pull it's jumpy."
        //
        // The pull is a VISUAL, so it only needs to be correct once per
        // painted frame. Storing the latest value in a ref and flushing it in
        // rAF keeps the finger-tracking exact while capping renders at the
        // refresh rate. The queued frame is cancelled on release and unmount
        // so a flush can never land after the gesture ends and re-open the
        // indicator.
        pendingDistance.current = translated;
        if (rafId.current === null) {
          rafId.current = requestAnimationFrame(() => {
            rafId.current = null;
            setPullDistance(pendingDistance.current);
          });
        }

        // Fire a single haptic tick exactly when the pull crosses the
        // threshold — the "click" moment that tells the user "release
        // to refresh".  Guard prevents repeat fires on subsequent frames.
        //
        // Reduce Motion: the threshold-crossing haptic is a passive
        // motion feedback (it punctuates the visual rubber-band), so it
        // is suppressed under `prefers-reduced-motion`. The release
        // haptic below still fires because that's user-initiated action
        // confirmation, not ambient motion.
        if (
          translated >= threshold &&
          !didFireThresholdHaptic.current &&
          !reduceMotion
        ) {
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
    cancelPendingFrame();
    setPulling(false);
    didFireThresholdHaptic.current = false;

    // Read the REF, not the state. `pendingDistance` is written synchronously
    // on every touchmove, while `pullDistance` only catches up on the next
    // animation frame — so a quick flick-and-release fires touchend before the
    // queued frame lands, and comparing the state would see 0 and silently
    // refuse to refresh. The unit test caught exactly that.
    if (pendingDistance.current >= threshold) {
      // Light confirmation tap when the refresh actually fires. This
      // explicit, user-initiated action haptic uses the `Force` variant
      // so it still fires under `prefers-reduced-motion` — the haptic
      // confirms an action the user took, not ambient motion. (See
      // hapticImpactForce in src/lib/haptics.ts.)
      hapticImpactForce();
      setRefreshing(true);
      pendingDistance.current = 0;
      setPullDistance(0);
      const startedAt = Date.now();
      try {
        await onRefresh();
      } finally {
        const remaining = MIN_REFRESH_VISIBLE_MS - (Date.now() - startedAt);
        if (remaining > 0) {
          await new Promise((resolve) => setTimeout(resolve, remaining));
        }
        setRefreshing(false);
      }
    } else {
      // Snap back: let CSS spring/ease do the animation; just zero the
      // distance so the transition plays from wherever the indicator is.
      pendingDistance.current = 0;
      setPullDistance(0);
    }
  }, [pulling, disabled, cancelPendingFrame, threshold, onRefresh]);

  // Latest handlers, read through a ref so the listeners below can be bound
  // ONCE for the life of the container instead of being torn down and rebound
  // on every render.
  //
  // Rebinding per render is what wedged the pull. The old cleanup ran on every
  // handler-identity change (i.e. every single frame of the drag, since
  // `pullDistance` state feeds `refreshing`/`pulling` deps) and it called
  // `cancelAnimationFrame(rafId.current)` WITHOUT resetting `rafId.current` to
  // null. Cancel a frame that was queued in the same frame a render landed in,
  // and `rafId.current` stays permanently non-null — so the
  // `if (rafId.current === null)` guard in handleTouchMove never passes again
  // and NO further frame is ever scheduled. Measured: the indicator froze at
  // its 24px floor for all 60 frames of a drag and the hook re-rendered twice
  // total. That is the "laggy / not smooth" pull the owner reported: it wasn't
  // slow, it had stopped tracking the finger altogether.
  const handlers = useRef({ handleTouchStart, handleTouchMove, handleTouchEnd });
  handlers.current = { handleTouchStart, handleTouchMove, handleTouchEnd };

  // The node the listeners are currently attached to, plus their detach fn.
  const bound = useRef<{ el: HTMLDivElement; off: () => void } | null>(null);

  // No dep array on purpose: several callers render the scroll container
  // conditionally (Profile hides it while loading), so `containerRef.current`
  // can be null on the first commit and only appear on a later one. This runs
  // after every render but no-ops unless the node actually changed, so it is
  // an identity check — not a rebind — on the frames that matter.
  useEffect(() => {
    const el = containerRef.current;
    if (bound.current?.el === el) return;
    bound.current?.off();
    bound.current = null;
    if (!el) return;
    const onStart = (e: TouchEvent) => handlers.current.handleTouchStart(e);
    const onMove = (e: TouchEvent) => handlers.current.handleTouchMove(e);
    const onEnd = () => handlers.current.handleTouchEnd();
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    el.addEventListener("touchend", onEnd);
    bound.current = {
      el,
      off: () => {
        el.removeEventListener("touchstart", onStart);
        el.removeEventListener("touchmove", onMove);
        el.removeEventListener("touchend", onEnd);
      },
    };
  });

  // Unmount only. Detaching (and cancelling the queued frame) belongs here and
  // NOT in the per-render effect above — that is what used to fire mid-drag.
  useEffect(
    () => () => {
      bound.current?.off();
      bound.current = null;
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    },
    []
  );

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
