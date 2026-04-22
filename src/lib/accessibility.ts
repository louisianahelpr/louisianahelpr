/**
 * Centralized accessibility helpers: Reduced Motion + Dynamic Type.
 *
 * Use prefersReducedMotion() to opt out of long animations.
 * useDynamicType() reads the OS text-size scale and exposes it as a
 * CSS variable (--user-text-scale) you can multiply against in CSS.
 */
import { useEffect, useState } from "react";

/** Snapshot — true if the user has Reduced Motion enabled. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Live React hook variant. Updates if the user toggles the preference. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

/**
 * Reads the user's preferred text size from the OS (Dynamic Type on iOS,
 * font-size scale on Android) and writes it to --user-text-scale on :root.
 * Pages that opt in can do `font-size: calc(1rem * var(--user-text-scale, 1))`.
 *
 * Call once at the app root.
 */
export function useDynamicTypeSync() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.documentElement;

    // Default WKWebView reports 16px as the base. Compute the user's actual scale.
    const computed = parseFloat(getComputedStyle(root).fontSize);
    const scale = isFinite(computed) && computed > 0 ? computed / 16 : 1;
    // Clamp to a sane range — don't let someone with 200% accessibility text
    // blow up our CTAs to occupy the entire screen.
    const clamped = Math.min(Math.max(scale, 0.85), 1.5);
    root.style.setProperty("--user-text-scale", String(clamped));
  }, []);
}
