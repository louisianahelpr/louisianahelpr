/**
 * Motion preference for the 25 Days page (the count-up and smooth scroll read
 * it). The page has no confetti: the classic Christmas restyle (owner
 * 2026-11-09, "no confetti") removed the burst this file used to hold.
 */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
