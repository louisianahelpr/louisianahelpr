import { useEffect, useState } from "react";

/**
 * Tracks the on-screen keyboard height in CSS pixels.
 *
 * Strategy:
 * 1. Prefer the Capacitor Keyboard plugin events when running natively (iOS/Android).
 * 2. Fall back to window.visualViewport for mobile web / PWA.
 *
 * Returned value can be applied as paddingBottom on the chat container so
 * the input bar lifts above the keyboard.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    let cleanupCap: (() => void) | undefined;
    let cancelled = false;

    // Try Capacitor Keyboard plugin (native only)
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (Capacitor.isNativePlatform()) {
          const { Keyboard } = await import("@capacitor/keyboard");
          const showSub = await Keyboard.addListener("keyboardWillShow", (info) => {
            if (!cancelled) setInset(info.keyboardHeight);
          });
          const hideSub = await Keyboard.addListener("keyboardWillHide", () => {
            if (!cancelled) setInset(0);
          });
          cleanupCap = () => {
            showSub.remove();
            hideSub.remove();
          };
          return;
        }
      } catch {
        // plugin not available — fall through to visualViewport
      }
    })();

    // visualViewport fallback (web)
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return () => { cancelled = true; cleanupCap?.(); };

    const update = () => {
      const diff = window.innerHeight - vv.height - vv.offsetTop;
      setInset(diff > 80 ? diff : 0); // ignore tiny browser-chrome offsets
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();

    return () => {
      cancelled = true;
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      cleanupCap?.();
    };
  }, []);

  return inset;
}
