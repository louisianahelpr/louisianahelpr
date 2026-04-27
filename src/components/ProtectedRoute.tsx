import { useEffect } from "react";
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, location.pathname]);

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

  // Banned users — explain the situation, never bounce back to /login.
  if (
    profile?.ban_status &&
    ["banned", "temp_banned", "permanently_banned"].includes(profile.ban_status)
  ) {
    return <Navigate to="/account-banned" replace />;
  }

  if (!allowUnapproved) {
    // Stage 1: Email verification (auth user is the source of truth)
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

  // Stage 2: Universal "Big 7" verification gate.
  // Legacy users (created before today's cutoff) bypass the gate.
  const isLegacy = profile?.is_legacy_user === true;
  if (
    !isLegacy &&
    user.email_confirmed_at &&
    !isProfileComplete(profile) &&
    !PROFILE_GATE_ALLOWED.has(location.pathname)
  ) {
    return <Navigate to="/complete-profile" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
