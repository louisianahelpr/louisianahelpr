import { useEffect } from "react";

/**
 * useScrollFadeUp — toggles the `is-visible` class on every element with
 * `.observe-fade-up` once it scrolls into view. Pair with inline
 * `transitionDelay` to stagger items in a list. Skipped entirely when the
 * user prefers reduced motion (we add `is-visible` immediately so elements
 * are fully visible without animation).
 *
 * Uses a single IntersectionObserver + MutationObserver pair, so it picks
 * up elements rendered by lazy-loaded sections after the initial mount.
 *
 * Call once at the top of a page component.
 */
export function useScrollFadeUp() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const observed = new WeakSet<Element>();

    const intersectionObs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            intersectionObs.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.1 },
    );

    // Element is already in the viewport at observe-time when its rect
    // vertically overlaps the visible area. If it is, skip the
    // hide-then-fade dance entirely — otherwise a scroll-triggered fade
    // would flash a blank box above the fold on first paint.
    const isInViewport = (el: Element) => {
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      return rect.top < vh && rect.bottom > 0;
    };

    const observe = (el: Element) => {
      if (observed.has(el)) return;
      observed.add(el);
      if (reduceMotion || isInViewport(el)) {
        el.classList.add("is-visible");
      } else {
        // Only hide when we KNOW we'll animate the element in — that way
        // if the observer never fires (JS error, scroll never happens)
        // the base state is visible, not blank.
        el.classList.add("js-fade-hidden");
        intersectionObs.observe(el);
      }
    };

    // Initial pass — pick up everything already in the DOM.
    document.querySelectorAll(".observe-fade-up").forEach(observe);

    // Watch for elements added by lazy-loaded sections.
    const mutationObs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (node.classList.contains("observe-fade-up")) observe(node);
          node
            .querySelectorAll?.(".observe-fade-up")
            .forEach((el) => observe(el));
        });
      }
    });
    mutationObs.observe(document.body, { childList: true, subtree: true });

    return () => {
      intersectionObs.disconnect();
      mutationObs.disconnect();
    };
  }, []);
}
