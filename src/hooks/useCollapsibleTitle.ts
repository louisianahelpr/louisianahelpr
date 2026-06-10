import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { prefersReducedMotion } from "@/lib/accessibility";

/** Scroll distance (px) over which the large title shrinks into its
 *  compact form. Kept short so the collapse completes within the first
 *  flick, matching the iOS large-title cadence. */
const COLLAPSE_DISTANCE = 64;

/**
 * useCollapsibleTitle — drives an iOS-style large title that shrinks into
 * a compact header as the user scrolls. Returns a `progress` value in
 * [0, 1]: 0 = fully expanded (large), 1 = fully collapsed (compact).
 *
 * Pass the scroll container ref (the `PullToRefreshWrapper` div that every
 * PageScaffold page already owns via `usePullToRefresh`). The listener is
 * passive and rAF-throttled so it never blocks scrolling.
 *
 * Under Reduce Motion the title stays at its expanded rest state — no
 * scroll-linked transform — so motion-sensitive users get a stable header.
 */
export function useCollapsibleTitle(
  scrollRef: RefObject<HTMLElement | null>,
): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || prefersReducedMotion()) return;

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const next = Math.min(1, Math.max(0, el.scrollTop / COLLAPSE_DISTANCE));
        setProgress(next);
      });
    };

    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scrollRef]);

  return progress;
}
