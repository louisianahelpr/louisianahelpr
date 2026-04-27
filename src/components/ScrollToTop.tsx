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
  }, [pathname, hash]);

  return null;
};

export default ScrollToTop;
