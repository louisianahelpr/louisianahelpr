import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Routes that use document-scroll (long-form content, SEO landing pages).
 * Everything else gets the fixed app-shell viewport lock applied to <html>.
 */
const DOCUMENT_SCROLL_ROUTES = [
  "/",
  
  "/for-business",
  "/features",
  "/terms",
  "/privacy",
  "/data-rights",
  
  "/rules",
  "/jobs", // public marketing /jobs (uses Navbar + long page)
  "/browse", // guest dashboard preview
  "/support",
];

const isDocumentScrollRoute = (pathname: string) => {
  return DOCUMENT_SCROLL_ROUTES.some((route) =>
    route === "/" ? pathname === "/" : pathname === route || pathname.startsWith(`${route}/`),
  );
};

/**
 * Toggles the `app-shell` class on <html> based on the current route.
 * When present, the html/body/#root are locked to 100dvh with overflow:hidden,
 * forcing pages to use AppShell's internal scroll container.
 */
export const useAppShellViewport = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    const html = document.documentElement;
    if (isDocumentScrollRoute(pathname)) {
      html.classList.remove("app-shell");
    } else {
      html.classList.add("app-shell");
    }
    return () => {
      // Don't strip on unmount — the next route effect will set it correctly.
    };
  }, [pathname]);
};
