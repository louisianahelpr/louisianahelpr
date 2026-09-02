/**
 * Centralized accessibility helpers: Reduced Motion + Dynamic Type.
 *
 * Use prefersReducedMotion() to opt out of long animations.
 * useDynamicType() reads the OS text-size scale and exposes it as a
 * CSS variable (--user-text-scale) you can multiply against in CSS.
 */
import { useEffect, useState } from "react";
import { osBodyPx, IOS_DEFAULT_BODY_PX } from "@/lib/simpleMode";

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
  // Measured in the state INITIALISER, not in the effect.
  //
  // It used to start at 1 ("no enlargement") and correct itself after mount.
  // That default is not neutral: App.tsx ORs this against `profile.senior_mode`
  // to drive the `senior-mode` class, and `initSimpleMode()` has ALREADY put
  // that class on <html> synchronously before first paint. So on any device
  // with iOS text size at xxLarge or above, the sequence was:
  //
  //   pre-paint  senior-mode ON   (initSimpleMode, correct)
  //   mount      senior-mode OFF  (this hook still reporting 1)  ← text shrinks
  //   +1 tick    senior-mode ON   (measurement lands)            ← text grows back
  //
  // i.e. the whole app opened at the large type scale and then visibly shrank,
  // on every screen. Measured on the iOS simulator at Dynamic Type
  // "accessibility-extra-large" (2026-08-27): the class was removed and
  // re-added within two mutations of mount. Owner: "profile review opens then
  // gets smaller", "all profile tabs open big then get smaller".
  //
  // The measurement is a synchronous DOM read with no side effects, so doing it
  // during the first render is safe and makes the first render already correct.
  // The effect stays for the CSS variable (a write, which does not belong in a
  // render) and is unchanged otherwise.
  const [scale] = useState(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return 1;
    return Math.min(Math.max(measureDynamicTypeScale(), 0.85), 1.5);
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    document.documentElement.style.setProperty("--user-text-scale", String(scale));
  }, [scale]);
  return scale;
}

/**
 * Returns the user's text-size scale relative to the platform default (1.0).
 *
 * The Dynamic Type reading itself comes from `osBodyPx()` in simpleMode.ts —
 * the single probe for the app. This used to carry its own copy, gated on
 * `CSS.supports("font", "-apple-system-body")`, which WebKit can answer false
 * to while still resolving the keyword; that gate made this hook report 1.0 on
 * exactly the devices it exists to serve. See the trace in that file.
 *
 * Default Dynamic Type ("Large") renders body at 17px, so dividing by
 * IOS_DEFAULT_BODY_PX puts the default at 1.0.
 *
 * Off-Apple the probe answers null, and there the root font-size DOES track
 * the browser/OS text scale, so fall back to it.
 */
function measureDynamicTypeScale(): number {
  const px = osBodyPx();
  // Never scale DOWN off this probe. Measured in real WebKit (Playwright
  // webkit 26.5, 2026-09-01): `-apple-system-body` resolves to **13px**, which
  // is macOS's system body size, not a Dynamic Type rung — macOS has no
  // Dynamic Type at all. Divided by 17 that is 0.765, clamped to 0.85, so
  // every desktop Safari user was being served the whole app ~15% smaller than
  // designed. Pre-existing, not introduced by consolidating the probe, and
  // invisible in Chromium (which drops the keyword) — which is why it survived
  // the audit.
  //
  // The floor is deliberate rather than a tighter band: this probe exists to
  // detect ENLARGED text, and iOS's smallest rung (xSmall, 14px) is not a
  // request to shrink our layout either. Shrinking still works through the
  // fallback below, where root font-size reflects a real browser/OS setting.
  if (px !== null) return Math.max(px / IOS_DEFAULT_BODY_PX, 1);

  const computed = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return isFinite(computed) && computed > 0 ? computed / 16 : 1;
}
