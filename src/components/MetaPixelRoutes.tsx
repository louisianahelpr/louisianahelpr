import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { metaPixelRoute } from "@/lib/metaPixel";

/**
 * Tells the Meta Pixel about each route, from React Router's location (owner, 2026-11-22). The first route schedules
 * the pixel for after load + idle; each later path change counts one PageView. Renders nothing; a no-op in the app,
 * under automation and on localhost (src/lib/metaPixel.ts). Mounted by VercelInsights, which App.tsx loads lazily
 * inside the router, so it adds nothing to any page's boot download.
 */
export function MetaPixelRoutes() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    metaPixelRoute(pathname, search);
  }, [pathname, search]);
  return null;
}
