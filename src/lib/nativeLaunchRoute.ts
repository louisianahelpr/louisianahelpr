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
    const { data } = await supabase.auth.getSession();
    const session = data.session;

    // Guests → /browse (dashboard-style preview of open jobs).
    // Signed-in → /dashboard. ProtectedRoute will re-route to
    // /account-pending, /account-denied, /account-banned, or
    // /complete-profile if the profile state requires it. Admins can
    // still reach /admin via the in-app nav.
    return session?.user ? "/dashboard" : "/browse";
  } catch {
    return "/browse";
  }
}
