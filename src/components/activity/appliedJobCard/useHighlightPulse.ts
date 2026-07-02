import { useEffect, type RefObject } from "react";

/**
 * Deep-link highlight — scroll into view + apply pulse ring once on mount
 * when this card is the target of a ?highlight= notification link.
 * The CSS class drives the animation; prefers-reduced-motion is handled
 * entirely in the stylesheet (scroll still fires regardless).
 */
export function useHighlightPulse(highlight: boolean, cardRef: RefObject<HTMLDivElement>) {
  useEffect(() => {
    if (!highlight) return;
    const el = cardRef.current;
    if (!el) return;
    // Small delay so the list has finished laying out before we scroll.
    const raf = requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("highlight-pulse");
      // Remove the class after the animation ends so a future re-render
      // doesn't re-apply it and so the outline doesn't persist.
      const onEnd = () => el.classList.remove("highlight-pulse");
      el.addEventListener("animationend", onEnd, { once: true });
    });
    return () => cancelAnimationFrame(raf);
    // Run once on mount — `highlight` is stable (set from initial URL param).
  }, []);
}
