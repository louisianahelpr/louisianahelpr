import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

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
    let cancelled = false;

    // NATIVE: the Capacitor Keyboard events ONLY. NB-010: this used to sit in
    // an un-awaited async IIFE whose `return` left only the IIFE, so native also
    // attached the visualViewport listeners below. With Keyboard.resize = 'body'
    // (capacitor.config.ts) the body shrinks with the keyboard, visualViewport
    // then measures ~0 and overwrote the real keyboardHeight.
    if (Capacitor.isNativePlatform()) {
      const subs: Array<{ remove: () => void }> = [];
      (async () => {
        const { Keyboard } = await import("@capacitor/keyboard");
        const show = await Keyboard.addListener("keyboardWillShow", (info) => {
          if (!cancelled) setInset(info.keyboardHeight);
        });
        const hide = await Keyboard.addListener("keyboardWillHide", () => {
          if (!cancelled) setInset(0);
        });
        if (cancelled) { show.remove(); hide.remove(); return; }
        subs.push(show, hide);
      })().catch(() => {
        // plugin not available: no inset; the WebView resizes the body itself.
      });
      return () => {
        cancelled = true;
        subs.forEach((s) => s.remove());
      };
    }

    // WEB: visualViewport.
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;

    const update = () => {
      const diff = window.innerHeight - vv.height - vv.offsetTop;
      setInset(diff > 80 ? diff : 0); // ignore tiny browser-chrome offsets
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
