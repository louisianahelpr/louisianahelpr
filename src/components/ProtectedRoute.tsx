import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { RouteSuspenseFallback } from "@/components/RouteSuspenseFallback";
import { ErrorState } from "@/components/ui/ErrorState";
import { report } from "@/lib/errorLogger";
import { track, AhaEvent } from "@/lib/analytics";

// Auth debug logging is dev-only by default. In dev it's still noisy —
// a single tab hop can print ~15 lines and drown real errors. Devs who
// want the trace opt in via `?debug_auth=1` on any URL; everyone else
// gets a quiet console. Prod always stays silent.
const DEBUG_AUTH =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("debug_auth");

interface ProtectedRouteProps {
  children: React.ReactNode;
  /**
   * Fully bypasses the approval gate — pending, email-unconfirmed *and*
   * denied users are all let through. Used for routes that an account in
   * any state must be able to reach (e.g. /complete-profile, /profile).
   */
  allowUnapproved?: boolean;
  /**
   * Progressive activation: lets `pending` / email-unconfirmed users reach
   * the route so they can browse, save and apply during the verification
   * window — without dropping the `denied` redirect. `denied` and banned
   * users are still bounced exactly as strictly as before. Verification
   * gates that genuinely require it (IDV-before-accept in Activity.tsx,
   * payout setup) live in the page components, not here, so they remain
   * fully enforced for pending users.
   */
  allowPending?: boolean;
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
  // Government-issued ID is intentionally NOT a gate field. CompleteProfile
  // makes it optional (identity verification is deferred to first-post / IDV),
  // so requiring it here trapped freshly-completed profiles in a redirect loop
  // back to /complete-profile — the form reported 7/7 done and navigated to
  // /dashboard, but this gate bounced them right back. The two definitions of
  // "complete" must stay in sync; the form is the source of truth.
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

const ProtectedRoute = ({
  children,
  allowUnapproved = false,
  allowPending = false,
}: ProtectedRouteProps) => {
  const { user, profile, isLoading, isError, refresh } = useCurrentUser();
  const location = useLocation();
  const [retrying, setRetrying] = useState(false);

  // Note: previously this component fired a `refresh()` on every mount,
  // doubling cold-start latency by issuing a redundant Supabase profile
  // fetch on top of useCurrentUser's own load. `useCurrentUser` already
  // refetches on session change, and post-profile-edit flows update the
  // local cache via their own mutations, so the per-mount refresh was
  // pure overhead. Removed to make cold start + every navigation snappier.

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

  // Block ONLY on the session being unknown. Once we have a `user` (the
  // session resolved), render children optimistically and let the profile
  // arrive in the background. Profile-based gates below fail-open while the
  // profile is loading; once it lands, the resulting re-render fires any
  // redirect that applies. This shaves 1-3s off cold-start dashboard paint
  // on cellular, where the profile fetch dominates first-paint latency.
  //
  // The brief flash visible to a banned/denied user before the redirect is
  // acceptable: all mutation endpoints enforce server-side RLS, so they
  // cannot *act* on the page in that window — only see it.
  if (isLoading && !user) {
    // Cold-start moment only: no session known yet. Use the calm, static
    // brand-mark + skeleton fallback (same one the per-route Suspense
    // boundary uses) instead of the spinning H.
    return <RouteSuspenseFallback />;
  }

  if (!user) {
    // Preserve where the user was headed so /login can return them there
    // after they sign in, instead of silently dumping them on /dashboard.
    const intended = location.pathname + location.search;
    const to =
      intended && intended !== "/"
        ? `/login?redirect=${encodeURIComponent(intended)}`
        : "/login";
    if (DEBUG_AUTH) console.log("[auth] ProtectedRoute redirect", { path: location.pathname, to, reason: "no-user-after-ready" });
    return <Navigate to={to} replace />;
  }

  // SECURITY: profile fetch errored (after retries) — DO NOT fall through.
  // The optimistic fail-open below assumes the profile is still in flight
  // and will land on a subsequent render. When the fetch has actually
  // failed, no re-render is coming for the rest of the session, so a
  // banned / denied / unverified user would otherwise get full UI access
  // to /dashboard, /post-job, /admin etc.
  //
  // We MUST NOT render protected children here — but we must also NOT bounce
  // to /login. The session (`user`) is still valid; a profile-fetch failure
  // is almost always a transient network/timeout blip in the iOS WebView
  // (the same blip that fails the parallel jobs query). Redirecting a
  // logged-in user to /login on a transient read error reads as a silent
  // mid-session logout — the #1 churn complaint from the native audit. A
  // genuinely dead session is handled by the `!user` branch above (auth
  // emits SIGNED_OUT → user becomes null → that branch fires the real
  // /login redirect). So here we show a recoverable, in-app error screen
  // that just re-fetches the profile, keeping the user signed in.
  if (isError && !profile) {
    if (DEBUG_AUTH) console.log("[auth] ProtectedRoute recoverable error", { path: location.pathname, reason: "profile-fetch-error" });
    // Observability — this exact failure silently absorbed PR #355 + #358
    // for hours before manual diagnosis. Reporting it gives Sentry a
    // dedicated tag to alert on. Note: useCurrentUser has already retried
    // 2x and reported the underlying PostgrestError; this is the route-level
    // signal that the user hit the non-fatal error gate.
    report(new Error("ProtectedRoute: profile fetch error (recoverable, session kept)"), {
      severity: "error",
      tags: { source: "ProtectedRoute.profileFetchError" },
      context: { path: location.pathname, userId: user.id },
    });
    track(AhaEvent.ForcedLogoutBounce, { reason: "profile_fetch_error", path: location.pathname });
    return (
      <div className="min-h-screen flex bg-premium-page">
        <ErrorState
          title="We couldn't load your account."
          body="Looks like a brief connection hiccup — you're still signed in. Tap Try again."
          retryDisabled={retrying}
          onRetry={() => {
            setRetrying(true);
            void refresh().finally(() => setRetrying(false));
          }}
        />
      </div>
    );
  }

  // Profile-based gates: only fire once the profile has actually loaded.
  // While `profile` is still null we fall through to render the children
  // optimistically; the next render (after the profile fetch lands) will
  // re-evaluate these guards and navigate away if needed.
  if (profile) {
    // Banned users — explain the situation, never bounce back to /login.
    if (
      profile.ban_status &&
      ["banned", "temp_banned", "permanently_banned"].includes(profile.ban_status)
    ) {
      if (DEBUG_AUTH) console.log("[auth] ProtectedRoute redirect", { path: location.pathname, to: "/account-banned", reason: profile.ban_status });
      return <Navigate to="/account-banned" replace />;
    }

    if (!allowUnapproved) {
      // `denied` is a hard stop on every non-`allowUnapproved` route. It is
      // NOT relaxed by `allowPending` — progressive activation only opens
      // the app for users still inside the verification window, never for
      // those who have already been rejected.
      if (profile.approval_status === "denied") {
        if (DEBUG_AUTH) console.log("[auth] ProtectedRoute redirect", { path: location.pathname, to: "/account-denied", reason: "approval-denied" });
        return <Navigate to="/account-denied" replace />;
      }

      // Progressive-activation routes (`allowPending`) let a pending or
      // email-unconfirmed user through so they can browse/save/apply while
      // they wait. Every other route still bounces them to /account-pending.
      if (!allowPending) {
        // Stage 1: Email verification (auth user is the source of truth)
        if (!user.email_confirmed_at) {
          if (DEBUG_AUTH) console.log("[auth] ProtectedRoute redirect", { path: location.pathname, to: "/account-pending", reason: "email-unconfirmed" });
          return <Navigate to="/account-pending" replace />;
        }
        if (profile.approval_status === "pending") {
          if (DEBUG_AUTH) console.log("[auth] ProtectedRoute redirect", { path: location.pathname, to: "/account-pending", reason: "approval-pending" });
          return <Navigate to="/account-pending" replace />;
        }
      }
    }

    // Stage 2: Universal "Big 7" verification gate.
    // Legacy users (created before the cutoff) bypass the gate entirely.
    const isLegacy = profile.is_legacy_user === true;
    if (
      !isLegacy &&
      user.email_confirmed_at &&
      !isProfileComplete(profile) &&
      !PROFILE_GATE_ALLOWED.has(location.pathname)
    ) {
      if (DEBUG_AUTH) console.log("[auth] ProtectedRoute redirect", { path: location.pathname, to: "/complete-profile", reason: "profile-incomplete" });
      return <Navigate to="/complete-profile" replace />;
    }
  }

  // Either profile is loaded and every gate passed, or profile is still
  // loading and we are rendering optimistically — either way, show children.
  return <>{children}</>;
};

export default ProtectedRoute;
