import { Navigate, useLocation } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowUnapproved?: boolean;
}

// Routes a half-onboarded user is allowed to visit without being bounced
// back to /complete-profile. Anything else redirects to the gate.
const PROFILE_GATE_ALLOWED = new Set<string>([
  "/complete-profile",
  "/support",
  "/terms",
  "/privacy",
  "/rules",
  "/data-rights",
]);

/**
 * Hard requirements for using the app. Helpers + customers are unified
 * and auto-approved via Stripe Express verification (see
 * mem://features/auto-approval-flow), so we no longer require ID upload,
 * bio length, avatar, etc. — those are optional profile-completeness items
 * surfaced as inline CTAs on the Profile screen.
 *
 * The ONLY hard gate is having a non-empty full_name, which is captured
 * on signup. If a legacy/OAuth account is missing that, route them to
 * /complete-profile once; otherwise let them into the app.
 */
const isProfileComplete = (
  profile: { full_name?: string | null } | null,
): boolean => {
  if (!profile) return false;
  return Boolean(profile.full_name && profile.full_name.trim().length > 0);
};

const ProtectedRoute = ({ children, allowUnapproved = false }: ProtectedRouteProps) => {
  const { user, profile, isLoading } = useCurrentUser();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Banned users (temp or permanent) — send to dedicated page that explains
  // the situation and shows support contact, never back to /login (which would
  // create a redirect loop the moment they sign in again).
  if (profile?.ban_status && ["banned", "temp_banned", "permanently_banned"].includes(profile.ban_status)) {
    return <Navigate to="/account-banned" replace />;
  }

  if (!allowUnapproved) {
    // Email verification gate — must verify email before reaching the dashboard.
    // The auth user object holds the source of truth (email_confirmed_at).
    if (user && !user.email_confirmed_at) {
      return <Navigate to="/account-pending" replace />;
    }
    if (profile?.approval_status === "pending") {
      return <Navigate to="/account-pending" replace />;
    }
    if (profile?.approval_status === "denied") {
      return <Navigate to="/account-denied" replace />;
    }
  }

  // Profile completion gate — catches OAuth signups that bypass the form,
  // and any legacy account missing required data. Always allowed on the
  // gate page itself and a small set of legal/support pages.
  if (
    user.email_confirmed_at &&
    !isProfileComplete(profile) &&
    !PROFILE_GATE_ALLOWED.has(location.pathname)
  ) {
    return <Navigate to="/complete-profile" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
