import { useEffect, useState } from "react";

/**
 * Reusable online/offline status hook.
 *
 * Returns `{ online, lastChangedAt }`:
 *   - `online`: tracks `navigator.onLine`, updated via the window
 *     `online` / `offline` events.
 *   - `lastChangedAt`: epoch-ms timestamp of the most recent
 *     transition. Consumers use this to drive short-lived UI like a
 *     "back online — refreshing" banner.
 *
 * Capacitor note: this hook intentionally relies only on
 * `navigator.onLine` + the standard window events. `@capacitor/network`
 * would give a more accurate signal on native iOS/Android (it reports
 * the system reachability state rather than the browser's heuristic),
 * but it is NOT currently a project dependency and we don't want to add
 * a new native plugin just for this. On Capacitor WebViews
 * `navigator.onLine` is reasonably reliable for our needs (it flips when
 * the OS reports no transport), with the known caveat that captive-
 * portal / "connected but no internet" states may report `true`. If we
 * ever install `@capacitor/network`, this is the single place to wire it
 * in — every banner / gate / toast already reads from this hook.
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

  return status;
}
