import { useEffect, useState } from "react";
import { isNativePlatform } from "@/lib/nativeInit";

/**
 * True only on the wide *browser* desktop — the exact same gate that
 * useAppShellViewport uses to toggle the `web-desktop` class on <html>:
 *
 *   web-desktop  ⟺  !isNativePlatform  &&  matchMedia('(min-width: 900px)')
 *
 * The native iOS/Android shell is NEVER web-desktop (even on an iPad ≥1024px),
 * and phone-width browsers are not either, so consumers that branch on this
 * leave the native + mobile-web rendering byte-for-byte unchanged. Used to
 * swap the window-virtualized Activity list for a plain two-column grid that
 * the CSS (`html.web-desktop .ds-activity-grid`) can lay out.
 *
 * Mirrors WEB_DESKTOP_QUERY in useAppShellViewport.ts — keep the two in sync.
 */
/* 900, not 1024. The desktop website — left rail, wide layout — used to begin
   at 1024, which meant a docked browser pane (commonly 600-1020px) never
   qualified and always got the phone/tablet treatment. Lowered so a normal
   split-screen window gets the real desktop site.

   MUST stay in sync with `lg` in tailwind.config.ts and with the twin copy of
   this query in the other hook. If the JS gate and the `lg:` utilities
   disagree, the shell paints desktop chrome while the components inside it
   are still laying out for mobile. */
const WEB_DESKTOP_QUERY = "(min-width: 900px)";

// Lazy initializer — evaluated synchronously on the FIRST render (not in a
// post-mount effect), so a hard-loaded desktop-web tab already has the right
// value before AppShell ever paints its `topBarOffset`. The old `useState(false)`
// + `apply()` inside `useEffect` meant every desktop pageload painted one frame
// as if it were mobile (0 offset for the fixed DesktopTopNav bar) and then
// reflowed the instant the effect ran — the flash-of-wrong-width bug. Effects
// still run after paint in React, so only computing the value up front (where
// `matchMedia` is synchronously available) removes the gap; the effect below
// is now purely for keeping it in sync with live resizes.
function computeIsWebDesktop(): boolean {
  if (isNativePlatform || typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(WEB_DESKTOP_QUERY).matches;
}

export function useIsWebDesktop() {
  const [isWebDesktop, setIsWebDesktop] = useState(computeIsWebDesktop);

  useEffect(() => {
    if (isNativePlatform || typeof window.matchMedia !== "function") return;

    const mql = window.matchMedia(WEB_DESKTOP_QUERY);
    const apply = () => setIsWebDesktop(mql.matches);
    apply();

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", apply);
      return () => mql.removeEventListener("change", apply);
    }
    mql.addListener(apply);
    return () => mql.removeListener(apply);
  }, []);

  return isWebDesktop;
}
