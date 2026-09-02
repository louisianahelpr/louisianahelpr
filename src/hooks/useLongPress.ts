import { useCallback, useRef } from "react";

interface UseLongPressOptions {
  /** Press threshold in ms before onLongPress fires. */
  threshold?: number;
  /** Pixel-radius the finger may drift before the press cancels. */
  moveTolerance?: number;
  /** Called when the press crosses the threshold without canceling. */
  onLongPress: () => void;
  /** Optional callback for a normal short press (when the press
   *  released BEFORE the threshold). Lets a single component support
   *  both tap and long-press without an extra onClick. */
  onTap?: () => void;
}

/**
 * useLongPress — small touch + pointer helper that fires `onLongPress`
 * after a configurable press threshold (default 500ms) and cancels
 * cleanly if the user drags too far or lifts early. Returns an object
 * of props to spread on the target element so both touch and mouse
 * inputs are covered.
 *
 * The hook deliberately doesn't depend on Capacitor haptics — the
 * caller controls feedback so we don't fire a redundant tick on the
 * same gesture (the caller usually pairs the threshold-cross with a
 * `hapticMedium()` of its own).
 */
export function useLongPress({
  threshold = 500,
  moveTolerance = 8,
  onLongPress,
  onTap,
}: UseLongPressOptions) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startCoordsRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const clear = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    startCoordsRef.current = null;
  }, []);

  const begin = useCallback(
    (x: number, y: number) => {
      firedRef.current = false;
      startCoordsRef.current = { x, y };
      timeoutRef.current = setTimeout(() => {
        firedRef.current = true;
        onLongPress();
      }, threshold);
    },
    [onLongPress, threshold],
  );

  const checkDrift = useCallback(
    (x: number, y: number) => {
      const start = startCoordsRef.current;
      if (!start) return;
      const dx = x - start.x;
      const dy = y - start.y;
      if (Math.hypot(dx, dy) > moveTolerance) clear();
    },
    [clear, moveTolerance],
  );

  const release = useCallback(() => {
    const fired = firedRef.current;
    clear();
    if (!fired && onTap) onTap();
  }, [clear, onTap]);

  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      begin(t.clientX, t.clientY);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const t = e.touches[0];
      checkDrift(t.clientX, t.clientY);
    },
    onTouchEnd: () => release(),
    onTouchCancel: () => clear(),
    onMouseDown: (e: React.MouseEvent) => begin(e.clientX, e.clientY),
    onMouseMove: (e: React.MouseEvent) => checkDrift(e.clientX, e.clientY),
    onMouseUp: () => release(),
    onMouseLeave: () => clear(),
    /**
     * The system took the pointer away — cancel, never fire.
     *
     * `onTouchCancel` only covers the touch event model. A press that the
     * BROWSER converts into a gesture it owns (an iOS scroll/pan that wins the
     * touch, a WKWebView text-selection or callout, a drag, the app going to
     * the background mid-press) emits `pointercancel` and, in several of those
     * cases, no `touchcancel` at all — so the timer survived and the action
     * fired for a gesture the user had already lost control of. That is the
     * exact "slow scroll launched the map" misfire this hook exists to prevent.
     *
     * Additive: every existing consumer spreads this object onto an element,
     * so they all inherit the cancel without a call-site change.
     */
    onPointerCancel: () => clear(),
  };
}
