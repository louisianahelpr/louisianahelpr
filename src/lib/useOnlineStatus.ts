import { useEffect, useSyncExternalStore } from "react";
import { getConnectivity, setConnectivity, subscribeConnectivity, type OnlineStatus } from "@/lib/connectivity";
import { isNativePlatform } from "@/lib/nativeInit";

/**
 * Reusable online/offline status hook.
 *
 * Returns `{ online, lastChangedAt }`:
 *   - `online`: connectivity state. On web this reads the shared store in
 *     src/lib/connectivity.ts: a `navigator.onLine === false` / `offline`
 *     event is only a hint, confirmed by a short backend probe before the
 *     app says offline (owner, 10-31: Chrome reported offline while she was
 *     online). On native (Capacitor)
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
export type { OnlineStatus } from "@/lib/connectivity";

export function useOnlineStatus(): OnlineStatus {
  // Web: the shared store (src/lib/connectivity.ts). navigator.onLine=false is
  // only a hint there; it is confirmed by a probe before anything says offline.
  const status = useSyncExternalStore(subscribeConnectivity, getConnectivity, getConnectivity);

  // Native: layer @capacitor/network on top for accurate OS reachability.
  // WKWebView's navigator.onLine can report `true` on captive-portal /
  // "connected but no internet" states; the Network plugin reflects the
  // real transport. Dynamic import keeps the plugin chunk off the web
  // bundle. The store's web listeners stay attached and harmless on native.
  useEffect(() => {
    if (!isNativePlatform) return;
    let cancelled = false;
    let removeListener: (() => void) | undefined;
    void (async () => {
      try {
        const { Network } = await import("@capacitor/network");
        const initial = await Network.getStatus();
        if (cancelled) return;
        setConnectivity(initial.connected);
        const handle = await Network.addListener("networkStatusChange", (s) => {
          setConnectivity(s.connected);
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
