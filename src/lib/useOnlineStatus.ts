import { useEffect, useState } from "react";
import { isNativePlatform } from "@/lib/nativeInit";

/**
 * Reusable online/offline status hook.
 *
 * Returns `{ online, lastChangedAt }`:
 *   - `online`: connectivity state. On web this tracks `navigator.onLine`
 *     via the window `online` / `offline` events. On native (Capacitor)
 *     it additionally subscribes to `@capacitor/network`, which reports
 *     the OS-level reachability state (WiFi / cellular / none) rather
 *     than the WKWebView's `navigator.onLine` heuristic.
 *   - `lastChangedAt`: epoch-ms timestamp of the most recent
 *     transition. Consumers use this to drive short-lived UI like a
 *     "back online — refreshing" banner.
 *
 * This is the single source of truth for connectivity across the app —
 * every banner / gate / toast reads from here. The native query-pausing
 * side (TanStack `onlineManager`) is fed from the same `@capacitor/network`
 * source in `appLifecycle.ts`.
 */
export interface OnlineStatus {
  online: boolean;
  /** Epoch-ms of the most recent transition. Initial value is the hook mount time. */
  lastChangedAt: number;
}

export function useOnlineStatus(): OnlineStatus {
  const [status, setStatus] = useState<OnlineStatus>(() => ({
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    lastChangedAt: Date.now(),
  }));

  useEffect(() => {
    const goOnline = () => setStatus({ online: true, lastChangedAt: Date.now() });
    const goOffline = () => setStatus({ online: false, lastChangedAt: Date.now() });
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Native: layer @capacitor/network on top for accurate OS reachability.
  // WKWebView's navigator.onLine can report `true` on captive-portal /
  // "connected but no internet" states; the Network plugin reflects the
  // real transport. Dynamic import keeps the plugin chunk off the web
  // bundle. The web listeners above stay attached and harmless on native.
  useEffect(() => {
    if (!isNativePlatform) return;
    let cancelled = false;
    let removeListener: (() => void) | undefined;
    void (async () => {
      try {
        const { Network } = await import("@capacitor/network");
        const initial = await Network.getStatus();
        if (cancelled) return;
        setStatus((prev) =>
          prev.online === initial.connected ? prev : { online: initial.connected, lastChangedAt: Date.now() },
        );
        const handle = await Network.addListener("networkStatusChange", (s) => {
          setStatus((prev) =>
            prev.online === s.connected ? prev : { online: s.connected, lastChangedAt: Date.now() },
          );
        });
        removeListener = () => void handle.remove();
      } catch {
        /* plugin unavailable — the navigator.onLine path above still works */
      }
    })();
    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, []);

  return status;
}
