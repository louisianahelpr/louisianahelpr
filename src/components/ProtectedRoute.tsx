import { useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { RouteSuspenseFallback } from "@/components/RouteSuspenseFallback";
import { ErrorState } from "@/components/ui/ErrorState";
import { report } from "@/lib/errorLogger";
import { track, AhaEvent } from "@/lib/analytics";
import { rememberJobIntent } from "@/lib/jobIntent";

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
  /**
   * Fallback rendered during the "session not known yet" window below.
   * Defaults to the generic `RouteSuspenseFallback`. Pass a page-shaped
   * skeleton (e.g. `DashboardRouteSkeleton`) for a route whose own lazy
   * chunk already renders a page-shaped Suspense fallback (via `routeEl`'s
   * second argument) — otherwise the two fallbacks disagree and the user
   * sees the generic bones swap in for a beat before the real page-shaped
   * skeleton (Dashboard's own `loading` branch) takes over. Same shape in
   * both places collapses that hop into one continuous state.
   */
  fallback?: React.ReactNode;
}

// Routes a half-onboarded user is allowed to visit without being bounced
// back to /complete-profile. Anything else redirects to the gate.
const PROFILE_GATE_ALLOWED = new Set<string>([
  "/complete-profile",
  "/support",
  "/terms",
  "/privacy",
  "/rules",
]);

/**
 * `/data-rights` used to be on the list above so a half-onboarded user could
 * still exercise GDPR Art. 20 portability — the Privacy Policy is public and
 * links straight to the export, so someone mid-onboarding can and does click
 * through to it. On 2026-08-18 that page was merged into the Profile Legal
 * tab and the route became a redirect, which made its entry dead (a redirect
 * renders no ProtectedRoute, so the gate never evaluates there).
 *
 * The RIGHT did not move when the control did, so the allowance follows it to
 * its new address instead of being dropped. Scoped to `?tab=legal` only —
 * bare `/profile` stays gated, so payout, settings, membership and the rest
 * of the Profile surface are exactly as locked as they were before.
 *
 * ONE DELIBERATE WIDENING comes with the move, and it is not this function's
 * doing: `/data-rights` was `<ProtectedRoute>` with default props, so
 * `denied` / `pending` / email-unconfirmed accounts bounced to
 * /account-denied or /account-pending before they ever saw the export.
 * `/profile` is `<ProtectedRoute allowUnapproved>`, which skips that whole
 * block, so the export is now reachable by every non-banned account. That is
 * the intended outcome: GDPR Art. 20 portability does not depend on account
 * approval, and a rejected applicant has the STRONGEST claim to a copy of
 * what was collected about them. Banned users are unaffected — the ban check
 * runs before `allowUnapproved` and still bounces them.
 *
 * Exported for unit test: this predicate widens an auth gate off a query
 * param, so its exact contract is pinned in ProtectedRoute.test.ts rather
 * than left to inspection.
 */
export const isProfileGateAllowed = (pathname: string, search: string): boolean => {
  if (PROFILE_GATE_ALLOWED.has(pathname)) return true;
  return pathname === "/profile" && new URLSearchParams(search).get("tab") === "legal";
};

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
const PROFILE_GATE_FIELDS = [
  { key: "full_name", label: "Full name" },
  { key: "avatar_url", label: "Profile picture" },
  { key: "date_of_birth", label: "Date of birth" },
  { key: "phone", label: "Phone number" },
  { key: "location", label: "City" },
  // Government-issued ID is intentionally NOT a gate field. CompleteProfile
  // makes it optional (identity verification is deferred to first-post / IDV),
  // so requiring it here trapped freshly-completed profiles in a redirect loop
  // back to /complete-profile — the form reported 7/7 done and navigated to
  // /dashboard, but this gate bounced them right back. The two definitions of
  // "complete" must stay in sync; the form is the source of truth.
  //
  // Bio is ALSO not a gate field, same reasoning, same failure mode: it was
  // required here (20+ chars) after CompleteProfile made it optional and
  // stopped blocking submission on it — a profile could save with bio empty,
  // navigate to /dashboard, and get bounced straight back here forever.
] as const;

const isFieldComplete = (
  profile: GateProfile | null,
  key: (typeof PROFILE_GATE_FIELDS)[number]["key"],
): boolean => {
  if (!profile) return false;
  const v = profile[key];
  if (typeof v !== "string") return false;
  const trimmed = v.trim();
  if (!trimmed) return false;
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
  fallback = <RouteSuspenseFallback />,
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
  /**
   * A GUEST BOUNCED OFF A JOB LINK MUST NOT LOSE THE JOB.
   *
   * `/jobs/:id` became signed-in-only on 2026-09-02, and the bounce below sends
   * the visitor to /login. That is correct, but on its own it ends the journey:
   * sign-in deliberately lands on the home dashboard ("log in → home", Login's
   * `postLoginDest`), so a guest who tapped a SHARED job link created an account
   * and arrived at a bare dashboard with no trace of the job that brought them.
   * Measured live before this fix: /login with no job context, and nothing
   * carried the destination through signup.
   *
   * The mechanism to fix it already existed and simply was not wired to this
   * path. `rememberJobIntent` stores the id in tracked safeStorage, mirrored
   * into Capacitor Preferences, so it survives a reload AND the email
   * verification round-trip that can kill the app on native. Login and Signup
   * both already consume it via `postAuthDestination`, landing on
   * /dashboard?quickApply=<id> — the same screen a signed-in visitor opening
   * the same link reaches, so guest and member converge. The two guest browse
   * feeds already fed it via `?job=`; only the bounce did not.
   *
   * Written in an effect, not during render: this is a side effect, and the
   * <Navigate> below unmounts this component on the same tick.
   */
  useEffect(() => {
    if (isLoading || user) return;
    const m = location.pathname.match(/^\/jobs\/([^/]+)$/);
    if (m?.[1]) rememberJobIntent(m[1]);
  }, [isLoading, user, location.pathname]);

  if (isLoading && !user) {
    // Cold-start moment only: no session known yet. Use the calm, static
    // brand-mark + skeleton fallback (same one the per-route Suspense
    // boundary uses by default) instead of the spinning H — or the
    // caller's page-shaped `fallback`, so a route whose Suspense boundary
    // already shows a page-shaped skeleton doesn't swap to the generic
    // bones for this one beat.
    return <>{fallback}</>;
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

      // Stage 1: Email verification (auth user is the source of truth).
      // Stays AHEAD of the completeness gate below, because until the address
      // is confirmed there is nothing productive to send the user to — and
      // /account-pending's unconfirmed variant is the screen that actually
      // helps them (it holds the Resend button). Progressive-activation
      // routes (`allowPending`) let them through to browse while they wait.
      if (!allowPending && !user.email_confirmed_at) {
        if (DEBUG_AUTH) console.log("[auth] ProtectedRoute redirect", { path: location.pathname, to: "/account-pending", reason: "email-unconfirmed" });
        return <Navigate to="/account-pending" replace />;
      }
    }

    // Stage 2: Universal "Big 7" verification gate.
    // Legacy users (created before the cutoff) bypass the gate entirely.
    //
    // ORDER MATTERS, AND IT USED TO BE WRONG. This gate ran AFTER the
    // `approval_status === "pending"` bounce below, so a user whose profile
    // was incomplete AND still pending — the exact state left behind when
    // `complete-signup` fails partway through `Signup.tsx`, or when an
    // account is created outside the signup form — was sent to
    // /account-pending from every route instead of to the one screen that
    // could fix them. /account-pending then told them "Our team is reviewing
    // your credentials" and showed "Final admin review — Waiting", about a
    // review that does not exist: `complete-signup` sets `approved`
    // unconditionally, and prod holds 30/30 approved and 0 ever pending
    // (verified 2026-09-01). It offers no link to /complete-profile, and
    // `cleanup-abandoned-accounts` deletes a still-`pending` account at day
    // 30 with no warning email. The only way out was the "Explore Jobs While
    // You Wait" button, whose destination (/dashboard) happens to be
    // `allowPending` and therefore falls through to this gate by accident.
    //
    // An incomplete profile is a thing the USER can fix, so it is now
    // answered before any queue-shaped screen. `pending` is checked after,
    // and only for a profile that is already complete.
    const isLegacy = profile.is_legacy_user === true;
    if (
      !isLegacy &&
      user.email_confirmed_at &&
      !isProfileComplete(profile) &&
      !isProfileGateAllowed(location.pathname, location.search)
    ) {
      if (DEBUG_AUTH) console.log("[auth] ProtectedRoute redirect", { path: location.pathname, to: "/complete-profile", reason: "profile-incomplete" });
      // Carry the destination across the gate. `<Navigate to="/complete-profile">`
      // dropped it entirely — path AND query — so a user who followed a push
      // deep link, a shared job URL or an email link into the app finished
      // the form and landed on /dashboard with no idea what they had lost.
      // `safeInternalRedirect` re-validates on the far side, so an
      // attacker-crafted `?next=` cannot turn this into an open redirect.
      const intended = location.pathname + location.search;
      const to =
        intended && intended !== "/" && !intended.startsWith("/complete-profile")
          ? `/complete-profile?next=${encodeURIComponent(intended)}`
          : "/complete-profile";
      return <Navigate to={to} replace />;
    }

    // Stage 3: approval still pending. Reached only by an account whose
    // profile IS complete (Stage 2 above catches the rest), so the screen it
    // lands on is genuinely "waiting on us", not "waiting on you".
    if (!allowUnapproved && !allowPending && profile.approval_status === "pending") {
      if (DEBUG_AUTH) console.log("[auth] ProtectedRoute redirect", { path: location.pathname, to: "/account-pending", reason: "approval-pending" });
      return <Navigate to="/account-pending" replace />;
    }
  }

  // Either profile is loaded and every gate passed, or profile is still
  // loading and we are rendering optimistically — either way, show children.
  return <>{children}</>;
};

export default ProtectedRoute;
