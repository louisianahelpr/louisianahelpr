import { useEffect, type RefObject } from "react";

/** How far below the visible list a lazy card photo starts loading: about two rows of cards at 375. */
export const LOAD_AHEAD_PX = 1200;

/** The nearest ancestor that scrolls (AppShell's internal scroller), or null for the page itself. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if (y === "auto" || y === "scroll") return p;
  }
  return null;
}

/**
 * PRELOAD THE NEXT CARDS' PHOTOS WHILE SCROLLING (owner 10-31: "When you're scrolling on declutter it takes the
 * pictures awhile to load"). A lazy <img> waits for the browser's own margin, which in WebKit (the iPhone app) is
 * close to the screen edge, so a photo starts only as its card scrolls in. This flips a lazy photo to eager once it
 * is within LOAD_AHEAD_PX below what the list shows, measured against the list's own scroller (an observer on the
 * window would see a card clipped by the scroller and never fire early).
 */
export function useLoadPhotoAhead(ref: RefObject<HTMLImageElement | null>, enabled: boolean) {
  useEffect(() => {
    const img = ref.current;
    if (!enabled || !img || img.getAttribute("loading") !== "lazy" || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        img.setAttribute("loading", "eager");
        io.disconnect();
      },
      { root: scrollParent(img), rootMargin: `0px 0px ${LOAD_AHEAD_PX}px 0px` },
    );
    io.observe(img);
    return () => io.disconnect();
  }, [ref, enabled]);
}
