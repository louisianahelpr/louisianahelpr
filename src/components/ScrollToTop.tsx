import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronUp } from "lucide-react";
import { useLocation } from "react-router-dom";

import { prefersReducedMotion } from "@/lib/accessibility";
import { hapticLight } from "@/lib/haptics";

// Reveal the affordance only after the user has scrolled well past the fold —
// several screens down — so it never clutters short pages. iOS exposes a
// "tap the status bar to scroll to top" gesture natively, but Capacitor's
// StatusBar plugin doesn't surface a tap event, so this floating button is
// the reachable equivalent.
const REVEAL_AFTER_PX = 1200;

/**
 * Two jobs:
 *  1. Resets scroll to the top on every pathname change (skipping hash
 *     anchors so in-page links still work).
 *  2. Renders a subtle floating "scroll to top" affordance for the AppShell
 *     internal scroll container — the iOS "tap status bar to scroll up"
 *     convention, surfaced as a tappable button since no native tap signal
 *     is available.
 *
 * Uses useLayoutEffect for the reset so it happens before the browser paints
 * the new route — preventing the brief "blank/bottom" flash some pages showed.
 */
const ScrollToTop = () => {
  const { pathname, hash } = useLocation();
  const [visible, setVisible] = useState(false);
  // The AppShell scroll container currently being watched.
  const scrollerRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (hash) return; // Let the browser handle anchor scrolling
    window.scrollTo(0, 0);
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    // Document-scroll routes use <main id="main-content"> as the scroll container.
    const mainEl = document.getElementById("main-content");
    if (mainEl) mainEl.scrollTop = 0;
    // Fixed-shell routes use AppShell's internal `.app-shell-scroll` div —
    // resetting only #main-content leaves stale scroll position when
    // navigating between fixed-shell routes (Dashboard → Messages, etc.).
    document.querySelectorAll<HTMLElement>(".app-shell-scroll").forEach((el) => {
      el.scrollTop = 0;
    });
    setVisible(false);
  }, [pathname, hash]);

  // Watch the active AppShell scroll container for the reveal threshold.
  // The container is owned by the route, so re-resolve it on each navigation.
  useEffect(() => {
    if (hash) return;
    const scroller = document.querySelector<HTMLElement>(".app-shell-scroll");
    scrollerRef.current = scroller;
    if (!scroller) {
      setVisible(false);
      return;
    }
    const onScroll = () => setVisible(scroller.scrollTop > REVEAL_AFTER_PX);
    onScroll();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [pathname, hash]);

  const scrollToTop = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    hapticLight();
    scroller.scrollTo({
      top: 0,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  };

  return (
    <AnimatePresence>
      {visible ? (
        <motion.button
          type="button"
          onClick={scrollToTop}
          aria-label="Scroll to top"
          initial={{ opacity: 0, scale: 0.8, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.8, y: 8 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          // Sit above the floating MobileNav dock + home indicator, hugging
          // the right edge. z below the nav (which is z-40+) so it never
          // overlaps the dock's controls.
          className="fixed right-4 z-30 inline-flex h-11 w-11 items-center justify-center rounded-full active:scale-[0.94]"
          style={{
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 112px)",
            background: "hsla(0, 0%, 100%, 0.7)",
            border: "1px solid hsl(var(--olivewood) / 0.18)",
            color: "hsl(var(--olivewood))",
            backdropFilter: "blur(10px) saturate(150%)",
            WebkitBackdropFilter: "blur(10px) saturate(150%)",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255, 255, 255, 0.55), " +
              "0 2px 6px hsl(var(--olivewood) / 0.10), " +
              "0 8px 18px -6px hsl(var(--olivewood) / 0.16)",
          }}
        >
          <ChevronUp className="h-5 w-5" strokeWidth={2.25} />
        </motion.button>
      ) : null}
    </AnimatePresence>
  );
};

export default ScrollToTop;
