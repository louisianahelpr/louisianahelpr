import { useEffect, useRef } from "react";

/**
 * "You tapped the tab you are already on." The bottom nav and the desktop rail
 * announce it; a screen that resets on a re-tap listens. Home uses it to fold
 * its To do list back up (owner, 2026-10-19: Home always arrives collapsed,
 * including on tapping the Home tab).
 */
const EVENT = "helpr:tab-reselect";

export function announceTabReselect(path: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: path }));
}

export function useOnTabReselect(path: string, onReselect: () => void) {
  const cb = useRef(onReselect);
  cb.current = onReselect;
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail === path) cb.current();
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [path]);
}
