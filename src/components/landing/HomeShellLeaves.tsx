import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { dropJobsShell, HOME_SHELL_ID } from "./homeShell";

/**
 * Q2705 B: index.html draws a signed-in phone's /home skeleton (#lh-home-shell) before the app arrives, and
 * HomeDashboard takes it away once its greeting is painted. When the app lands anywhere else instead (an expired
 * session sent to /login, a /home link forwarded to the job feed, the member tapping away), nothing on /home will
 * ever mount, so this removes it as soon as the route is not /home; the /jobs skeleton (#lh-jobs-shell) likewise. Guard: src/test/homeShellMatchesSkeleton.test.tsx.
 */
export function HomeShellLeaves() {
  const { pathname } = useLocation();
  useEffect(() => {
    if ((pathname.replace(/\/+$/, "") || "/") !== "/home") document.getElementById(HOME_SHELL_ID)?.remove();
    if ((pathname.replace(/\/+$/, "") || "/") !== "/jobs") dropJobsShell();
  }, [pathname]);
  return null;
}
