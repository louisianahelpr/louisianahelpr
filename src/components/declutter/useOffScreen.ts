/**
 * The item page's pinned bar trigger, shared by the paid item (OfferPanel: Offer / Buy) and the free item
 * (FreeClaimPanel: Ask for it, Q2560): moved out of DeclutterOfferPanel.tsx unchanged.
 */
import { useEffect, useState, type RefObject } from "react";

/**
 * How much of the screen's bottom edge the dock (MobileNav's `.mobile-nav-frame`) covers, in px; 0 where there is
 * none (desktop hides it). Measured, because `--bottom-nav-h` is only ever zeroed, never set. The dock keeps its box
 * while it yields (`visibility: hidden`), so the answer does not change when the bar takes its place.
 */
function dockCoverPx(): number {
  const dock = document.querySelector<HTMLElement>(".mobile-nav-frame");
  if (!dock) return 0;
  const r = dock.getBoundingClientRect();
  return r.height > 0 ? Math.max(0, Math.round(window.innerHeight - r.top)) : 0;
}

/**
 * True until `el` is fully in view ABOVE the dock (IntersectionObserver). False where the observer does not exist,
 * so the in-page buttons are then the only ones.
 *
 * Audit 1030 DB-14: the observer used to count the strip behind the dock as on screen. At 375 the in-page Buy now
 * sat in that strip on a short-titled item, so it was hidden under the dock while the bar stayed away. The strip is
 * now cut off the observed screen (rootMargin), and a group only partly clear of the dock still gets the bar.
 */
export function useOffScreen(el: RefObject<HTMLElement>): boolean {
  const [off, setOff] = useState(false);
  useEffect(() => {
    const node = el.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setOff(!entry.isIntersecting || (entry.intersectionRatio ?? 1) < 0.99),
      { rootMargin: `0px 0px -${dockCoverPx()}px 0px`, threshold: [0, 0.99] },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [el]);
  return off;
}
