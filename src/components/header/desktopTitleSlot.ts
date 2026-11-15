import { useSyncExternalStore } from "react";

/**
 * The desktop top bar's title slot: a DOM node the bar registers and a page's PageTitleBar portals its row into.
 * Its own tiny module (no JSX, nothing beyond React) so the bar's pending frame in App.tsx (DesktopTopBarPending)
 * can register the slot before DesktopTopNav's own chunk arrives, without pulling PageTitleBar and BackButton into
 * the entry chunk. When the pending frame gives way to the real bar, React detaches the old ref (null) in the
 * mutation phase and attaches the new one in the layout phase of the same commit, so the slot ends on the real bar.
 */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

/** The top bar's ref callback for its left area (DesktopTopNav, and its pending frame while its chunk loads). */
export function registerDesktopTitleSlot(el: HTMLElement | null): void {
  if (slot === el) return;
  slot = el;
  listeners.forEach((l) => l());
}

export function useDesktopTitleSlot(): HTMLElement | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => slot,
    () => null,
  );
}
