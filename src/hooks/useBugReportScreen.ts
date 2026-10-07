import { useEffect } from "react";
import type { Location } from "react-router-dom";
import { noteScreen } from "@/lib/bugReportContext";

/**
 * Remembers the last screen the person was on (its route and its title), so a
 * "Something's not working" report names the screen being reported rather
 * than the support form (Q1028). The title is read once the screen has had a
 * moment to set it (usePageMeta runs in the page's own effect).
 */
export function useBugReportScreen(location: Pick<Location, "pathname" | "search">): void {
  const { pathname, search } = location;
  useEffect(() => {
    const t = setTimeout(() => noteScreen(pathname, search, typeof document !== "undefined" ? document.title : ""), 600);
    return () => clearTimeout(t);
  }, [pathname, search]);
}
