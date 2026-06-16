import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { resolveNativeLaunchRoute } from "@/lib/nativeLaunchRoute";
import { wasDeepLinkClaimed } from "@/lib/nativeLaunchMutex";

/**
 * Mounted once inside <BrowserRouter>. On native cold launch only, if the
 * user lands on `/` and has an active session, it redirects to the right
 * post-auth route. Web is a no-op. Runs exactly once per app process.
 *
 * Cold-launch race: when the app was opened from a Universal Link, the
 * deep-link handler in nativePush.ts may navigate concurrently with this
 * resolver. We honor whoever lands first via a shared module-level flag
 * (`nativeLaunchMutex`) so a /m/abc deep link doesn't get overridden by
 * the default post-auth route this resolver would otherwise pick.
 */
const NativeLaunchRouter = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    // Capture the path at mount — we don't want to fight subsequent
    // user-initiated navigations.
    const initialPath = location.pathname;
    void resolveNativeLaunchRoute(initialPath).then((target) => {
      if (!target || target === initialPath) return;
      // If a deep-link handler already navigated us somewhere, do NOT
      // override it with the default post-auth route.
      if (wasDeepLinkClaimed()) return;
      navigate(target, { replace: true });
    });
    // Intentionally only runs on initial mount.

  }, []);

  return null;
};

export default NativeLaunchRouter;
