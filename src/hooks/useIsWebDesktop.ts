import { useEffect, useState } from "react";
import { isNativePlatform } from "@/lib/nativeInit";

/**
 * True only on the wide *browser* desktop — the exact same gate that
 * useAppShellViewport uses to toggle the `web-desktop` class on <html>:
 *
 *   web-desktop  ⟺  !isNativePlatform  &&  matchMedia('(min-width: 1024px)')
 *
 * The native iOS/Android shell is NEVER web-desktop (even on an iPad ≥1024px),
 * and phone-width browsers are not either, so consumers that branch on this
 * leave the native + mobile-web rendering byte-for-byte unchanged. Used to
 * swap the window-virtualized Activity list for a plain two-column grid that
 * the CSS (`html.web-desktop .ds-activity-grid`) can lay out.
 *
 * Mirrors WEB_DESKTOP_QUERY in useAppShellViewport.ts — keep the two in sync.
 */
const WEB_DESKTOP_QUERY = "(min-width: 1024px)";

export function useIsWebDesktop() {
  const [isWebDesktop, setIsWebDesktop] = useState(false);

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
