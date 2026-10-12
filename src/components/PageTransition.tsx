import { ReactNode, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useReducedMotion } from "@/lib/accessibility";
import { hasInAppHistory } from "@/lib/inAppHistory";

interface PageTransitionProps {
  children: ReactNode;
}

// Edge-swipe-back tuning. iOS only recognizes a back-swipe that begins in a
// thin strip hugging the left edge — starting mid-screen must stay free for
// horizontal content (carousels, sliders). The 44px strip matches the iOS
// touch-target minimum.
const EDGE_ZONE_PX = 44;
// Commit the back navigation once the drag passes either an absolute distance
// or a fast enough flick — mirrors UIKit's interactive pop completion logic.
const DISMISS_DISTANCE_PX = 110;
const DISMISS_VELOCITY = 520; // px per second
// Travel before the gesture picks an axis: a mostly-vertical start is a scroll
// and is left alone for the rest of that touch.
const AXIS_LOCK_PX = 6;
// The page follows the finger at 90% (the old dragElastic of 0.9) and fades
// to 0.6 by 200px, which reads as "peeling back".
const FOLLOW = 0.9;
const FADE_BY_PX = 200;
// Velocity is read over the last ~100ms of movement.
const VELOCITY_WINDOW_MS = 100;

/**
 * The route wrapper: no enter animation, only iPhone's swipe-from-the-left-edge
 * to go back (owner, 2026-10-12, Q1356: drop the page-change fade, keep the
 * swipe-back). It used to be a framer-motion div with a slide/fade on every
 * route, which made every visitor download framer-motion (~39 KB gzip) after
 * the first page settled. The gesture is plain pointer events now, and
 * scripts/check-deferred-vendors.mjs holds this file's built closure free of
 * framer-motion.
 *
 * A drag that begins inside the left edge zone and travels far or fast enough
 * calls `navigate(-1)`. Drags that start away from the edge are never touched,
 * so the browse map, carousels and sliders keep their own gestures.
 *
 * The wrapper carries NO transform and no will-change at rest (the framer div
 * always had `will-change: transform`). A transformed ancestor becomes the
 * containing block of AppShell's `position: fixed` frame, so it is set only
 * while a finger is dragging the page and cleared on release. At rest the
 * viewport contains the frame, the same as on a cold load before this chunk
 * arrives (App.tsx renders a plain keyed div until then).
 *
 * Keyed by location.key so every navigation mounts a fresh wrapper.
 * Under `prefers-reduced-motion` the page does not follow the finger, as before.
 */
const PageTransition = ({ children }: PageTransitionProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const reducedMotion = useReducedMotion();
  const pageRef = useRef<HTMLDivElement>(null);
  // Removes the window listeners of a gesture still in flight (unmount).
  const endGesture = useRef<(() => void) | null>(null);

  useEffect(() => () => endGesture.current?.(), []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Only a primary pointer starting inside the left edge zone arms the
    // gesture; anything else is the page's own input.
    if (reducedMotion || !e.isPrimary || e.button !== 0) return;
    if (e.clientX > EDGE_ZONE_PX) return;
    endGesture.current?.();

    const el = pageRef.current;
    if (!el) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    let axis: "x" | "y" | null = null;
    let dx = 0;
    const samples: { t: number; x: number }[] = [{ t: e.timeStamp, x: e.clientX }];

    const paint = (offset: number) => {
      if (offset <= 0) {
        el.style.transform = "";
        el.style.opacity = "";
        el.style.userSelect = "";
        return;
      }
      // A swipe is not a text selection (a mouse drag otherwise highlights
      // whatever the pointer crosses).
      if (!el.style.userSelect) {
        el.style.userSelect = "none";
        window.getSelection?.()?.removeAllRanges();
      }
      el.style.transform = `translate3d(${offset * FOLLOW}px, 0, 0)`;
      el.style.opacity = String(1 - 0.4 * Math.min(offset / FADE_BY_PX, 1));
    };

    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      endGesture.current = null;
      paint(0);
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const mx = ev.clientX - startX;
      const my = ev.clientY - startY;
      if (axis === null) {
        if (Math.abs(mx) < AXIS_LOCK_PX && Math.abs(my) < AXIS_LOCK_PX) return;
        axis = Math.abs(mx) > Math.abs(my) ? "x" : "y";
        // A vertical start is a scroll: let it go for the rest of the touch.
        if (axis === "y") {
          finish();
          return;
        }
      }
      if (ev.cancelable) ev.preventDefault();
      dx = Math.max(mx, 0);
      samples.push({ t: ev.timeStamp, x: ev.clientX });
      while (samples.length > 2 && ev.timeStamp - samples[0].t > VELOCITY_WINDOW_MS) samples.shift();
      paint(dx);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const first = samples[0];
      const last = samples[samples.length - 1];
      const dt = (last.t - first.t) / 1000;
      const velocity = dt > 0 ? (last.x - first.x) / dt : 0;
      const committed = axis === "x" && (dx > DISMISS_DISTANCE_PX || velocity > DISMISS_VELOCITY);
      finish();
      // ...but only if there is somewhere to go. A cold-opened deep link has no
      // entry behind it, and `navigate(-1)` there walks the user clean out of
      // the app — the same defect BackButton was fixed for. With no history the
      // swipe snaps back to rest, which is also what iOS does when you swipe at
      // the root of a navigation stack.
      if (committed && hasInAppHistory()) navigate(-1);
    };

    // The browser took the touch (a scroll, a system gesture): snap back.
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish();
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    endGesture.current = finish;
  };

  return (
    <div key={location.key} ref={pageRef} onPointerDownCapture={handlePointerDown}>
      {children}
    </div>
  );
};

export default PageTransition;
