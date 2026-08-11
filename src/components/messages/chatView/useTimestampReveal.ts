import { useCallback, useEffect, useRef, useState } from "react";

/** How far the timeline slides, and therefore how wide the time column is. */
export const REVEAL_WIDTH = 64;

/**
 * useTimestampReveal — iMessage's drag-left-to-see-times gesture.
 *
 * Returns a `reveal` distance in px (0…REVEAL_WIDTH) and the pointer handlers
 * to spread onto the scrolling timeline.
 *
 * ── Why this isn't just a horizontal drag listener ─────────────────────
 * The element it attaches to is the vertical scroller for the whole thread.
 * A naive implementation eats vertical scrolling, which is the primary
 * gesture on this screen and would be a catastrophic trade for a convenience
 * feature. So the gesture stays UNCLAIMED until the movement is clearly
 * horizontal: at least 10px of travel and steeper than 2:1 against the
 * vertical axis. Until that threshold, every event passes straight through to
 * the browser's own scrolling.
 *
 * Only leftward drags count. Dragging right is how iOS users trigger swipe-
 * back navigation, and stealing it would break the way out of the thread.
 */
export function useTimestampReveal(enabled = true) {
  const [reveal, setReveal] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const claimed = useRef(false);
  const pointer = useRef<number | null>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Mouse users have no equivalent affordance and would trigger this by
      // accident while selecting text, so it is touch/pen only.
      if (!enabled || e.pointerType === "mouse") return;
      start.current = { x: e.clientX, y: e.clientY };
      claimed.current = false;
      pointer.current = e.pointerId;
    },
    [enabled],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!start.current || pointer.current !== e.pointerId) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;

      if (!claimed.current) {
        // Vertical intent wins outright — release and never look again for
        // this gesture, so a long scroll can't accidentally cross the
        // threshold on a wobble.
        if (Math.abs(dy) > Math.abs(dx)) {
          start.current = null;
          return;
        }
        if (dx > -10 || Math.abs(dx) < Math.abs(dy) * 2) return;
        claimed.current = true;
      }

      // Rubber-band past the stop rather than hard-clamping: the resistance
      // is what tells a finger it has reached the end.
      const raw = Math.min(REVEAL_WIDTH, Math.max(0, -dx));
      setReveal(raw);
    },
    [],
  );

  const release = useCallback(() => {
    start.current = null;
    claimed.current = false;
    pointer.current = null;
    // Always springs back. The times are a glance, not a mode — leaving the
    // timeline shifted would be a state the user has to undo.
    setReveal(0);
  }, []);

  // A pointercancel (an incoming call, the app backgrounding, iOS taking over
  // the gesture) would otherwise leave the timeline stuck mid-slide.
  useEffect(() => {
    if (!enabled) setReveal(0);
  }, [enabled]);

  return {
    reveal,
    /** True while the gesture owns the pointer — used to suppress transitions. */
    dragging: reveal > 0,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: release,
      onPointerCancel: release,
    },
  };
}
