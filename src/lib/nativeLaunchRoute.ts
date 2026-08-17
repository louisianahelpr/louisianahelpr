/**
 * Native cold-launch router.
 *
 * On iOS/Android, when the user opens the app from the home screen the
 * web entrypoint is always `/`. That's the right destination for guests
 * (App Store reviewers and curious installs need to see the landing page
 * before being asked to authenticate — Apple Guideline 5.1.1 / 4.0), but
 * a poor experience for signed-in users who want their dashboard.
 *
 * This helper checks the current Supabase session once on cold launch
 * and returns the route the app should land on. It does NOT handle
 * approval / ban / profile-completion gating — that's `ProtectedRoute`'s
 * job and runs automatically once we navigate to a protected route.
 *
 * Web is a no-op (returns null) so deep links and SEO entry points are
 * never overridden.
 */
import { supabase } from "@/integrations/supabase/client";
import { isNativePlatform } from "@/lib/nativeInit";
import { readRestorableRoute } from "@/lib/lastRoute";

// Routes that should "stick" on cold launch even for signed-in users.
// Anything else falls through to the auth-aware default.
const PRESERVE_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/account-pending",
  "/account-denied",
  "/account-banned",
  "/complete-profile",
  "/admin",
  "/messages",
  "/profile",
  "/post-job",
  "/dashboard",
  "/activity",
  "/my-jobs",
  "/my-posts",
  "/support",
  "/saved-helpers",
  "/schedule",
  "/availability",
  "/user/",
  "/payment-success",
];

export async function resolveNativeLaunchRoute(
  currentPath: string,
): Promise<string | null> {
  if (!isNativePlatform) return null;

  // Only intervene on the bare landing route. Deep links, push taps, and
  // direct navigations to specific pages must be left alone.
  if (currentPath !== "/" && currentPath !== "") return null;

  // Anything in PRESERVE_PATHS shouldn't trigger this anyway (we already
  // bailed for non-"/"), but kept here as a guard if the matcher is ever
  // loosened.
  if (PRESERVE_PATHS.some((p) => currentPath.startsWith(p) && p !== "/")) {
    return null;
  }

  try {
    const { data, error } = await supabase.auth.getSession();
    // A failed session lookup is treated the same as no session: fall
    // through to the guest route. ProtectedRoute will re-gate properly
    // once a real navigation happens, so a transient error here just
    // means a signed-in user briefly lands on /browse instead of the
    // dashboard — acceptable, and never a blank screen.
    if (error) return "/browse";
    const session = data.session;

    // Guests → /browse (dashboard-style preview of open jobs).
    if (!session?.user) return "/browse";

    // Signed-in. Before falling back to the dashboard, honour where the user
    // actually was: on iOS the WKWebView content process gets jetsammed while
    // backgrounded and reloaded on resume, which re-runs our JS from `/` with
    // the native process still very much alive (hence no splash screen). To
    // this function that is indistinguishable from a cold launch, so it used
    // to send the user to /dashboard every time they glanced at a
    // notification. See lastRoute.ts for the freshness window that keeps a
    // genuine next-morning cold start landing on the dashboard.
    const restored = readRestorableRoute();
    if (restored) return restored;

    // Otherwise /dashboard. ProtectedRoute will re-route to
    // /account-pending, /account-denied, /account-banned, or
    // /complete-profile if the profile state requires it. Admins can
    // still reach /admin via the in-app nav.
    return "/dashboard";
  } catch {
    return "/browse";
  }
}
