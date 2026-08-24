import { useState } from "react";

/**
 * True when the document was HIDDEN at the moment this component mounted.
 *
 * Every page-entry animation in the app starts from `opacity: 0` — PageScaffold's
 * panel rise, PageTransition's slide, the `ds-page-in` keyframe. Framer Motion
 * drives its half on `requestAnimationFrame`, and a browser tab (or a
 * backgrounded Capacitor WebView) produces no frames, so those animations FREEZE
 * at their initial keyframe. The route mounts, the page is invisible and offset,
 * and it stays that way until frames resume.
 *
 * Which means: navigate while the app is backgrounded — a push notification
 * deep-link, a resume that restores the last route, an OS app-switcher preview —
 * and the user comes back to a blank screen that then fades in from nothing.
 * Measured directly: on a hidden tab the panel sat at `opacity: 0,
 * translateY(8px)` two and a half seconds after mount, and only advanced once
 * something forced a frame.
 *
 * An entrance animation exists to be watched. If nobody could watch it, there is
 * nothing to play — render the final state. Read once via lazy `useState` so it
 * reflects mount time and never re-triggers mid-life: a page that mounted
 * visible keeps its animation even if the user tabs away halfway through, and a
 * page that mounted hidden stays settled rather than suddenly animating when
 * they come back.
 */
export function useHiddenAtMount(): boolean {
  const [hidden] = useState(
    () => typeof document !== "undefined" && document.visibilityState === "hidden",
  );
  return hidden;
}

export default useHiddenAtMount;
