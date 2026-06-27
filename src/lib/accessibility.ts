/**
 * Centralized accessibility helpers: Reduced Motion + Dynamic Type.
 *
 * Use prefersReducedMotion() to opt out of long animations.
 * useDynamicType() reads the OS text-size scale and exposes it as a
 * CSS variable (--user-text-scale) you can multiply against in CSS.
 */
import { useEffect, useState } from "react";

/**
 * Above this measured Dynamic Type scale we auto-enable the larger-text
 * "senior mode" styling. 1.2 ≈ iOS "xxLarge" and up (and all accessibility
 * sizes), so default/small/moderate settings are left untouched.
 */
export const OS_LARGE_TEXT_THRESHOLD = 1.2;

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
 * Returns the clamped scale so callers can react (e.g. auto-enable a
 * larger-text mode when the OS reports an accessibility text size).
 *
 * Call once at the app root.
 */
export function useDynamicTypeSync(): number {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.documentElement;
    const clamped = Math.min(Math.max(measureDynamicTypeScale(), 0.85), 1.5);
    root.style.setProperty("--user-text-scale", String(clamped));
    setScale(clamped);
  }, []);
  return scale;
}

/**
 * Returns the user's text-size scale relative to the platform default (1.0).
 *
 * iOS/iPadOS WKWebView (and desktop Safari) do NOT surface Dynamic Type on the
 * root font-size — `getComputedStyle(root).fontSize` is pinned at 16px no
 * matter how large the user's OS text setting is. The size IS reflected in the
 * computed font of the `-apple-system-body` keyword, so we probe that. The
 * default Dynamic Type size ("Large") renders body text at 17px, so we divide
 * by 17 to get a scale of 1.0 at default.
 *
 * On platforms without that keyword (Android WebView, non-Safari desktop) the
 * root font-size *does* track the browser/OS text scale, so we fall back to it.
 */
function measureDynamicTypeScale(): number {
  const supportsAppleBody =
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("font", "-apple-system-body");

  if (supportsAppleBody && typeof document !== "undefined" && document.body) {
    const probe = document.createElement("span");
    probe.setAttribute("aria-hidden", "true");
    probe.textContent = "M";
    probe.style.cssText =
      "font: -apple-system-body;position:absolute;visibility:hidden;pointer-events:none;height:0;overflow:hidden;";
    document.body.appendChild(probe);
    const probed = parseFloat(getComputedStyle(probe).fontSize);
    document.body.removeChild(probe);
    if (isFinite(probed) && probed > 0) return probed / 17;
  }

  const computed = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return isFinite(computed) && computed > 0 ? computed / 16 : 1;
}
