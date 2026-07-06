import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronUp } from "lucide-react";
import { useLocation, useNavigationType } from "react-router-dom";

import { prefersReducedMotion, useReducedMotion } from "@/lib/accessibility";
import { hapticLight } from "@/lib/haptics";

// Reveal the affordance only after the user has scrolled well past the fold —
// several screens down — so it never clutters short pages. iOS exposes a
// "tap the status bar to scroll to top" gesture natively, but Capacitor's
// StatusBar plugin doesn't surface a tap event, so this floating button is
// the reachable equivalent.
const REVEAL_AFTER_PX = 1200;

// Per-history-entry scroll offsets, keyed by react-router's `location.key`.
// Module-level so it survives the AppShell remounting between routes (but
// resets on a full reload, which matches browser-native scroll restoration).
const scrollPositions = new Map<string, number>();

/**
 * Two jobs:
 *  1. Browser-style scroll restoration: on a forward navigation (PUSH/REPLACE)
 *     reset to the top; on a back/forward navigation (POP) restore the offset
 *     the user left that entry at — so backing out of a settings sub-page
 *     lands them where they were, not at the top. Hash anchors are skipped so
 *     in-page links still work.
 *  2. Renders a subtle floating "scroll to top" affordance for the AppShell
 *     internal scroll container — the iOS "tap status bar to scroll up"
 *     convention, surfaced as a tappable button since no native tap signal
 *     is available.
 *
 * Uses useLayoutEffect for the reset/restore so it happens before the browser
 * paints the new route — preventing the brief "blank/bottom" flash some pages
 * showed.
 */
const ScrollToTop = () => {
  const { pathname, hash, key } = useLocation();
  const navigationType = useNavigationType();
  const [visible, setVisible] = useState(false);
  const reducedMotion = useReducedMotion();
  // The AppShell scroll container currently being watched.
  const scrollerRef = useRef<HTMLElement | null>(null);
  // Last pathname we reset for. A query-only change (e.g. a URL-driven tab
  // switcher calling setSearchParams) mints a fresh location.key but keeps the
  // pathname — those must NOT scroll the page to the top.
  const prevPathnameRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (hash) return; // Let the browser handle anchor scrolling

    const samePathname = prevPathnameRef.current === pathname;
    prevPathnameRef.current = pathname;

    const mainEl = document.getElementById("main-content");
    const saved = scrollPositions.get(key);

    // POP = back/forward button. Restore the saved offset for this history
    // entry. Content may not be fully laid out on the first frame (data still
    // loading), so re-apply on the next animation frame to land accurately.
    if (navigationType === "POP" && saved != null && saved > 0) {
      const apply = () => {
        const scroller = document.querySelector<HTMLElement>(".app-shell-scroll");
        if (scroller) scroller.scrollTop = saved;
        if (mainEl) mainEl.scrollTop = saved;
        window.scrollTo(0, saved);
      };
      apply();
      requestAnimationFrame(apply);
      return;
    }

    // Query-only change on the same page (e.g. a URL-driven tab switcher) —
    // keep the user's scroll position; don't yank them to the top.
    if (samePathname) {
      return;
    }

    // Forward navigation — reset every possible scroll container to the top.
    window.scrollTo(0, 0);
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
    // Document-scroll routes use <main id="main-content"> as the scroll container.
    if (mainEl) mainEl.scrollTop = 0;
    // Fixed-shell routes use AppShell's internal `.app-shell-scroll` div —
    // resetting only #main-content leaves stale scroll position when
    // navigating between fixed-shell routes (Dashboard → Messages, etc.).
    document.querySelectorAll<HTMLElement>(".app-shell-scroll").forEach((el) => {
      el.scrollTop = 0;
    });
    setVisible(false);
  }, [pathname, hash, key, navigationType]);

  // Watch the active scroll container for the reveal threshold AND continuously
  // record its offset against the current history entry, so a later POP back to
  // this entry can restore it. The container is owned by the route, so
  // re-resolve it on each navigation; document-scroll routes fall back to the
  // window.
  useEffect(() => {
    if (hash) return;
    const scroller = document.querySelector<HTMLElement>(".app-shell-scroll");
    scrollerRef.current = scroller;
    const readPos = () => (scroller ? scroller.scrollTop : window.scrollY);
    const onScroll = () => {
      const pos = readPos();
      setVisible(pos > REVEAL_AFTER_PX);
      scrollPositions.set(key, pos);
    };
    onScroll();
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    return () => target.removeEventListener("scroll", onScroll);
  }, [pathname, hash, key]);

  const scrollToTop = () => {
    hapticLight();
    const behavior = prefersReducedMotion() ? "auto" : "smooth";
    // Fixed-shell routes scroll AppShell's inner container; document-scroll
    // routes (multi-step forms, legal, marketing) scroll the window. Mirror
    // the reveal watcher's `scroller ?? window` fallback — otherwise the
    // button renders on document-scroll pages but the click does nothing.
    const scroller = scrollerRef.current;
    if (scroller) {
      scroller.scrollTo({ top: 0, behavior });
    } else {
      window.scrollTo({ top: 0, behavior });
    }
  };

  return (
    <AnimatePresence>
      {visible ? (
        <motion.button
          type="button"
          onClick={scrollToTop}
          aria-label="Scroll to top"
          initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.8, y: 8 }}
          transition={reducedMotion ? { duration: 0.12 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
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
