import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const DEBUG_AUTH = import.meta.env.DEV;

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

type GateProfile = {
  full_name?: string | null;
  avatar_url?: string | null;
  id_document_url?: string | null;
  bio?: string | null;
  date_of_birth?: string | null;
  phone?: string | null;
  location?: string | null;
  is_legacy_user?: boolean | null;
};

/**
 * "Big 7" verification gate enforced for every NEW user (created on/after
 * the legacy cutoff). Existing users carry `is_legacy_user = true` and
 * bypass the gate so they don't wake up to a locked app. See
 * mem://features/auto-approval-flow for the broader signup contract.
 */
export const PROFILE_GATE_FIELDS = [
  { key: "full_name", label: "Full name" },
  { key: "avatar_url", label: "Profile picture" },
  { key: "bio", label: "About you (20+ characters)" },
  { key: "date_of_birth", label: "Date of birth" },
  { key: "phone", label: "Phone number" },
  { key: "location", label: "City" },
  { key: "id_document_url", label: "Government-issued ID" },
] as const;

export const isFieldComplete = (
  profile: GateProfile | null,
  key: (typeof PROFILE_GATE_FIELDS)[number]["key"],
): boolean => {
  if (!profile) return false;
  const v = profile[key];
  if (typeof v !== "string") return false;
  const trimmed = v.trim();
  if (!trimmed) return false;
  if (key === "bio") return trimmed.length >= 20;
  return true;
};

export const isProfileComplete = (profile: GateProfile | null): boolean => {
  if (!profile) return false;
  return PROFILE_GATE_FIELDS.every((f) => isFieldComplete(profile, f.key));
};

const ProtectedRoute = ({ children, allowUnapproved = false }: ProtectedRouteProps) => {
  const { user, profile, isLoading, refresh } = useCurrentUser();
  const location = useLocation();

  // Force a fresh DB fetch on every mount so a user who just completed
  // their profile (or had an admin update them) sees the new state
  // immediately instead of hitting a stale-cache redirect loop.
  useEffect(() => {
    if (user?.id) void refresh();
     
  }, [user?.id, location.pathname]);

  useEffect(() => {
    if (!DEBUG_AUTH) return;
    console.log("[auth] ProtectedRoute", {
      path: location.pathname,
      isLoading,
      hasUser: !!user,
      userId: user?.id ?? null,
      hasProfile: !!profile,
      allowUnapproved,
    });
  }, [allowUnapproved, isLoading, location.pathname, profile, user?.id]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (!user) {
    if (DEBUG_AUTH) console.log("[auth] ProtectedRoute redirect", { path: location.pathname, to: "/login", reason: "no-user-after-ready" });
    return <Navigate to="/login" replace />;
  }

  // Banned users — explain the situation, never bounce back to /login.
  if (
    profile?.ban_status &&
    ["banned", "temp_banned", "permanently_banned"].includes(profile.ban_status)
  ) {
    if (DEBUG_AUTH) console.log("[auth] ProtectedRoute redirect", { path: location.pathname, to: "/account-banned", reason: profile.ban_status });
    return <Navigate to="/account-banned" replace />;
  }

  if (!allowUnapproved) {
    // Stage 1: Email verification (auth user is the source of truth)
    if (user && !user.email_confirmed_at) {
      if (DEBUG_AUTH) console.log("[auth] ProtectedRoute redirect", { path: location.pathname, to: "/account-pending", reason: "email-unconfirmed" });
      return <Navigate to="/account-pending" replace />;
    }
    if (profile?.approval_status === "pending") {
      if (DEBUG_AUTH) console.log("[auth] ProtectedRoute redirect", { path: location.pathname, to: "/account-pending", reason: "approval-pending" });
      return <Navigate to="/account-pending" replace />;
    }
    if (profile?.approval_status === "denied") {
      if (DEBUG_AUTH) console.log("[auth] ProtectedRoute redirect", { path: location.pathname, to: "/account-denied", reason: "approval-denied" });
      return <Navigate to="/account-denied" replace />;
    }
  }

  // Stage 2: Universal "Big 7" verification gate.
  // Legacy users (created before the cutoff) bypass the gate entirely.
  // IMPORTANT: only redirect when we actually have a profile row in hand. If
  // the profile fetch timed out or RLS hiccupped (`profile === null`), we
  // **fail open** so legacy users don't get bounced to /complete-profile on
  // a slow network or transient error. The gate will re-evaluate on the
  // next render once the profile loads.
  const isLegacy = profile?.is_legacy_user === true;
  if (
    profile &&
    !isLegacy &&
    user.email_confirmed_at &&
    !isProfileComplete(profile) &&
    !PROFILE_GATE_ALLOWED.has(location.pathname)
  ) {
    if (DEBUG_AUTH) console.log("[auth] ProtectedRoute redirect", { path: location.pathname, to: "/complete-profile", reason: "profile-incomplete" });
    return <Navigate to="/complete-profile" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
