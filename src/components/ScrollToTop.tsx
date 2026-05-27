import { useLayoutEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Resets window scroll (and the document/body scroll containers) to the top
 * on every pathname change. Skips when navigating to a hash anchor so that
 * in-page links still work and respect `scroll-behavior: smooth`.
 *
 * Uses useLayoutEffect so the reset happens before the browser paints the
 * new route — preventing the brief "blank/bottom" flash some pages showed.
 */
const ScrollToTop = () => {
  const { pathname, hash } = useLocation();

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
  }, [pathname, hash]);

  return null;
};

export default ScrollToTop;
