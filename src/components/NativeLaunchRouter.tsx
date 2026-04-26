import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { resolveNativeLaunchRoute } from "@/lib/nativeLaunchRoute";

/**
 * Mounted once inside <BrowserRouter>. On native cold launch only, if the
 * user lands on `/` and has an active session, it redirects to the right
 * post-auth route. Web is a no-op. Runs exactly once per app process.
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
      if (target && target !== initialPath) {
        navigate(target, { replace: true });
      }
    });
    // Intentionally only runs on initial mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
};

export default NativeLaunchRouter;
