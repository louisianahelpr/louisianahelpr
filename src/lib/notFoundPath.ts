import { useSyncExternalStore } from "react";

/**
 * The pathname the `path="*"` catch-all (NotFound) is showing, or null. NotFound reports itself through
 * `setNotFoundPathname` (src/hooks/useAppShellViewport.ts), which writes here.
 *
 * A store, not a module variable, because the bottom bar reads it too (L8, iOS design audit 2026-11-16): a signed-in
 * member on a 404 had no dock and no header, so the only way out was the page's own button. MobileNav and
 * PublicLayout subscribe and treat the 404's own pathname as a dock route. Guard: src/test/notFoundKeepsTheDock.test.tsx.
 */
let current: string | null = null;
const listeners = new Set<() => void>();

export const getNotFoundPathname = () => current;

/** Returns true when the value changed. */
export function writeNotFoundPathname(pathname: string | null): boolean {
  if (current === pathname) return false;
  current = pathname;
  listeners.forEach((l) => l());
  return true;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const useNotFoundPathname = () => useSyncExternalStore(subscribe, getNotFoundPathname, getNotFoundPathname);
