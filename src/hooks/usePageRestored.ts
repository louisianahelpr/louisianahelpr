import { useEffect, useRef } from "react";

/**
 * M2 (Declutter buy audit 11-08): Pay sets "Opening…", then the web leaves for Stripe's page with
 * `window.location.href`. When the buyer taps Back, iOS Safari and WKWebView (Facebook's in-app browser) can bring this
 * page back from the back-forward cache with React state intact, so Pay came back disabled as "Opening…" with nothing
 * to clear it (only the native return or an error did). A `pageshow` with `persisted` is exactly that restore: run
 * `onRestore` then. A normal first load (`persisted` false) does nothing.
 *
 * Guard: src/hooks/usePageRestored.test.tsx.
 */
export function usePageRestored(onRestore: () => void): void {
  const latest = useRef(onRestore);
  latest.current = onRestore;
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) latest.current();
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
}
