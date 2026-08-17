import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { rememberRoute } from "@/lib/lastRoute";
import { isNativePlatform } from "@/lib/nativeInit";

/**
 * Records the current route so a native resume can come back to it.
 *
 * Mounted once inside <BrowserRouter>, alongside NativeLaunchRouter — which
 * is the component that READS this back (via resolveNativeLaunchRoute). See
 * lib/lastRoute.ts for why this is needed at all: iOS reloads the WKWebView
 * content process after jetsamming it in the background, which restarts our
 * JS at `/` while the native app itself never died.
 *
 * Native only. On web the browser keeps its own history and
 * resolveNativeLaunchRoute is a no-op, so writing here would be pure churn.
 */
const RouteMemory = () => {
  const location = useLocation();

  useEffect(() => {
    if (!isNativePlatform) return;
    // Search is included deliberately — tab state lives in the query string
    // (/profile?tab=security), so path alone restores the wrong panel.
    rememberRoute(`${location.pathname}${location.search}`);
  }, [location.pathname, location.search]);

  return null;
};

export default RouteMemory;
