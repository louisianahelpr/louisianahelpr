import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import { useBugReportScreen } from "@/hooks/useBugReportScreen";

/**
 * Page-level error boundary, re-keyed by route. A render crash on one
 * page shows the fallback inside <main> only — the header, nav, and
 * banners stay mounted — and navigating elsewhere clears it. The root
 * ErrorBoundary in <App> still backstops crashes in the shell itself.
 *
 * No outer <Suspense> here on purpose: every lazy route element brings
 * its own per-route Suspense (see `routeEl()` in App.tsx). A single shared
 * Suspense at this level would tear down the active route's UI during a
 * nav transition — by scoping the fallback per route, the previous
 * route's content stays mounted until the next chunk resolves, so the
 * persistent shell never flashes blank between pages.
 *
 * Moved out of App.tsx (Q2615, componentSizeRatchet) unchanged.
 */
export function RoutedBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  // "Report a bug" names the screen the person came from (Q1028).
  useBugReportScreen(location);
  return <ErrorBoundary resetKey={location.pathname}>{children}</ErrorBoundary>;
}
