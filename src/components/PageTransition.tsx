import { ReactNode, useRef } from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  useDragControls,
  type PanInfo,
} from "framer-motion";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";

import { useHiddenAtMount } from "@/hooks/useHiddenAtMount";
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
const DISMISS_VELOCITY = 520;

/**
 * Direction-aware native-style page transition.
 *
 * iOS navigation reads as a horizontal slide, not a web-page fade:
 *   - A forward navigation (PUSH / REPLACE) slides the incoming screen
 *     in from the right.
 *   - A back navigation (POP) slides it in from the left.
 *
 * The previous screen is unmounted by React Router immediately, so we
 * only animate the *incoming* screen — a self-contained enter animation,
 * which avoids needing AnimatePresence or a shared layout shell.
 *
 * It also hosts the interactive edge-swipe-back gesture: a drag that begins
 * inside the left edge zone and travels far/fast enough calls `navigate(-1)`,
 * reusing the same POP slide for a continuous feel. Drags that start away
 * from the edge are ignored so in-page horizontal gestures keep working.
 *
 * Keyed by location.key so every navigation (even same-component route
 * changes) replays the animation.
 *
 * Respects `prefers-reduced-motion`: falls back to a plain opacity fade
 * with no translation, and disables the interactive drag follow.
 */
const PageTransition = ({ children }: PageTransitionProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const reducedMotion = useReducedMotion();
  /* A route that mounts while the app is backgrounded has nobody to watch it
     arrive, and framer's rAF tween would leave it at `opacity: 0` — slid
     sideways by `offsetX` — until frames resume. That is the blank screen a
     user meets when a push deep-link or a resume restores a route. Render the
     settled state instead. See useHiddenAtMount. */
  const hiddenAtMount = useHiddenAtMount();

  // POP = back navigation. PUSH/REPLACE = forward.
  const isBack = navigationType === "POP";

  // Small horizontal offset reads as a gentle slide without a jarring jump
  // on tab switches (a larger offset made bottom-nav taps feel like the page
  // lurched sideways). Incoming-from-right on push, incoming-from-left on pop.
  const offsetX = reducedMotion ? 0 : isBack ? -10 : 10;

  // Tracks the live finger position so the page can follow the drag.
  const x = useMotionValue(0);
  // Fade the page slightly as it's dragged away — reads as "peeling back".
  const opacity = useTransform(x, [0, 200], [1, 0.6]);
  // Whether the active drag began inside the left edge zone. A drag that
  // starts mid-screen is left alone so horizontal content keeps its gestures.
  const fromEdge = useRef(false);
  const dragControls = useDragControls();

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const atEdge = e.clientX <= EDGE_ZONE_PX;
    fromEdge.current = atEdge;
    // Only ARM the page drag for a true left-edge start. Paired with
    // `dragListener={false}` below, framer won't translate the page on any
    // other pointerdown — so dragging mid-screen content (the Leaflet map,
    // carousels, sliders) can never slide the whole fixed app shell sideways.
    // Framer's automatic drag listener ignored this: it dragged the page from
    // anywhere and only gated the *navigation* on fromEdge, which is exactly
    // why panning the Browse map dragged the entire app left/right.
    if (atEdge) dragControls.start(e);
  };

  const handleDragEnd = (_e: unknown, info: PanInfo) => {
    const committed =
      fromEdge.current &&
      (info.offset.x > DISMISS_DISTANCE_PX ||
        info.velocity.x > DISMISS_VELOCITY);
    fromEdge.current = false;
    // ...but only if there is somewhere to go. A cold-opened deep link has no
    // entry behind it, and `navigate(-1)` there walks the user clean out of the
    // app — the same defect BackButton was fixed for, which the gesture never
    // inherited because the guard was a closure inside that component. With no
    // history the swipe snaps back to rest, which is also what iOS does when
    // you swipe at the root of a navigation stack: the screen you are on IS the
    // entry point, so the gesture has nothing to dismiss.
    if (committed && hasInAppHistory()) {
      navigate(-1);
      return;
    }
    // Released early — snap back to rest.
    x.set(0);
  };

  // Reduced motion: keep the simple fade, no interactive drag follow.
  if (hiddenAtMount) {
    return <div key={location.key}>{children}</div>;
  }

  if (reducedMotion) {
    return (
      <motion.div
        key={location.key}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
        style={{ willChange: "opacity" }}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      key={location.key}
      initial={{ opacity: 0, x: offsetX }}
      animate={{ opacity: 1, x: 0 }}
      transition={{
        duration: 0.22,
        // Matches the design system's `ds-out` easing curve.
        ease: [0.22, 1, 0.36, 1],
      }}
      onPointerDownCapture={handlePointerDown}
      // Only horizontal drag, and ONLY when armed from the left edge via
      // dragControls (see handlePointerDown). `dragListener={false}` stops
      // framer from auto-starting a drag on every pointerdown, so mid-screen
      // content (maps, carousels) keeps its own gestures and never drags the
      // page. `dragDirectionLock` still keeps a mostly-vertical scroll free.
      drag="x"
      dragListener={false}
      dragControls={dragControls}
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0, right: 0.9 }}
      dragMomentum={false}
      onDragEnd={handleDragEnd}
      style={{ x, opacity, willChange: "transform, opacity" }}
    >
      {children}
    </motion.div>
  );
};

export default PageTransition;
