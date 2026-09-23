import { Children, isValidElement, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { RouteSuspenseFallback } from "@/components/RouteSuspenseFallback";
import { ErrorState } from "@/components/ui/ErrorState";
import { report } from "@/lib/errorLogger";
import { track, AhaEvent } from "@/lib/analytics";
import { rememberJobIntent } from "@/lib/jobIntent";
import { hasPreload } from "@/lib/lazyWithPreload";
import { isLockedOut } from "@/lib/banStatus";

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
   * RETIRED (Q193, owner 2026-09-23): there is no approval gate any more —
   * every signup is auto-approved and bans are automated, so the pending and
   * denied screens were deleted. This prop and `allowPending` are accepted and
   * IGNORED so the route table in App.tsx (edited by a parallel lane at the
   * time) did not have to change in the same commit; stripping them from
   * App.tsx is queued in docs/OPEN.md. Neither ever bypasses the email gate
   * (Q180) or the ban gate.
   */
  allowUnapproved?: boolean;
  /** RETIRED (Q193) — see `allowUnapproved`. Accepted and ignored. */
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
    });
  }, [isLoading, location.pathname, profile, user?.id]);

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

  /**
   * START THE PAGE'S JS CHUNK NOW, NOT AFTER AUTH ANSWERS.
   *
   * The `isLoading && !user` early-return below means `children` is never
   * rendered during the cold-start beat — and React only begins a `lazy()`
   * import when the element renders. So the route chunk fetch sat strictly
   * BEHIND the session/profile round-trip, despite depending on none of it.
   * Measured on prod at /my-posts: the app bundle was done at ~1.2s and
   * `Activity-*.js` was not requested until 2046ms, the millisecond the
   * `profiles` response landed. See `lazyWithPreload` for the full trace.
   *
   * `preload()` only warms the module cache: nothing mounts, no query runs,
   * so a visitor about to be bounced to /login pays one chunk fetch and
   * gains nothing they could not already request by hand. Runs on first
   * render regardless of auth state, which is the entire point.
   */
  useEffect(() => {
    Children.forEach(children, (child) => {
      if (isValidElement(child) && hasPreload(child.type)) child.type.preload();
    });
  }, [children]);

  // AUTO-HEAL THE RECOVERABLE PROFILE-FETCH ERROR.
  //
  // The card below keeps the user signed in and offers a manual "Try again".
  // But the profile query fails to that card only after its whole budget is
  // spent (~12.5s: one 6s attempt, a retry, and the orphan-reuse window) — and
  // on a slow-but-working connection the read would have landed given more
  // time. Stranding the user behind a tap turns a recoverable stall into a
  // dead end; it is also the single biggest source of nightly false-reds
  // (a11y-webkit-prod, e2e, press) whenever the CI runner's hop to prod is
  // slower than that budget.
  //
  // So while the error card is up, retry on a widening backoff. `refresh()`
  // re-runs the query (with its own timeout/retry budget again); the moment the
  // profile lands the branch below stops rendering and this effect's cleanup
  // clears the timer. The manual button still works and is unaffected. Backoff
  // caps at 30s so a genuinely dead or 4xx connection is polled gently (≤2/min),
  // never hammered.
  const showingProfileError = !!user && isError && !profile;
  useEffect(() => {
    if (!showingProfileError) return;
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay = Math.min(4000 * 2 ** attempt, 30000);
      timer = setTimeout(() => {
        if (cancelled) return;
        attempt += 1;
        void refresh().finally(() => { if (!cancelled) schedule(); });
      }, delay);
    };
    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [showingProfileError, refresh]);

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
    // (per the shared client policy) and reported the underlying
    // PostgrestError; this is the route-level signal that the user hit the
    // non-fatal error gate.
    report(new Error("ProtectedRoute: profile fetch error (recoverable, session kept)"), {
      severity: "error",
      tags: { source: "ProtectedRoute.profileFetchError", screen: location.pathname },
      context: { path: location.pathname, userId: user.id },
    });
    track(AhaEvent.ForcedLogoutBounce, { reason: "profile_fetch_error", path: location.pathname });
    return (
      /**
       * `data-auth-retrying` is the HONEST MACHINE-READABLE SIGNAL that this
       * card is not a dead end: the effect above is armed and will re-fetch
       * the profile on its own (first attempt at 4s). Automated harnesses used
       * to classify this card at t≈0 and call the route broken, so a stall
       * that healed perfectly at 4s still failed the run — a false red by
       * construction. `scripts/audit/pressLoadHealth.mjs` reads this attribute,
       * treats it as "not yet settled", and only fails the route if the card is
       * STILL up after the heal's bound. `aria-busy` says the same thing to
       * assistive tech: the region's content is being refreshed.
       *
       * It is set unconditionally because the retry effect's condition is the
       * same one that renders this branch (`showingProfileError`) — the card
       * cannot be up without the heal running. If that ever stops being true,
       * gate the attribute on `showingProfileError` rather than dropping it.
       */
      <div className="min-h-screen flex bg-premium-page" data-auth-retrying="true" aria-busy="true">
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
    // `isLockedOut` mirrors the server's own carve-out: a `temp_banned` row
    // whose `auto_suspended_until` has already passed is a suspension the
    // server considers over, waiting on a scheduled sweep to say so. Testing
    // ban_status membership alone kept those users at /account-banned — being
    // shown an expiry date in the past — until the sweeper next ran.
    if (isLockedOut(profile.ban_status, profile.auto_suspended_until)) {
      if (DEBUG_AUTH) console.log("[auth] ProtectedRoute redirect", { path: location.pathname, to: "/account-banned", reason: profile.ban_status });
      return <Navigate to="/account-banned" replace />;
    }
    // No approval gate (Q193, owner 2026-09-23): every signup is
    // auto-approved and bans are automated, so `approval_status` routes
    // nobody anywhere. The pending and denied screens were deleted; a ban is
    // the only account state with a screen of its own. Pinned by
    // src/test/retiredAccountStateScreens.test.ts.
  }

  // Stage 1: Email verification (auth user is the source of truth), on EVERY
  // protected route — `allowPending` and `allowUnapproved` included. Owner
  // rule, 2026-09-23 (Q180): "in order to actually finish sign up they must
  // verify their email ... They can't enter until they verify email." The
  // `allowPending` routes (dashboard, my-jobs, my-posts, messages) used to
  // skip this so an unconfirmed account could browse while it waited; that is
  // exactly what the rule forbids.
  //
  // It reads `user`, not `profile`, so it fires even while the profile is
  // still in flight: the optimistic render below must never show an
  // unconfirmed account the app for a beat. It stays AHEAD of the
  // completeness gate, because until the address is confirmed there is
  // nothing productive to send the user to, and /signup-pending is the
  // screen that helps them: the 3-step "Check Your Email" page, which names
  // their address, holds Resend, and refreshes the session so a link clicked
  // on another device lets this tab in (Q193 — it replaced the old
  // /account-pending card; owner: "no duplicate pages with the same info").
  //
  // Server-side, Supabase Auth "confirm email" is on (`mailer_autoconfirm:
  // false` from /auth/v1/settings, measured 2026-09-23), so a password
  // sign-in for an unconfirmed address gets no session at all; this gate is
  // the client half of the same rule, for any session that arrives otherwise.
  if (!user.email_confirmed_at) {
    if (DEBUG_AUTH) console.log("[auth] ProtectedRoute redirect", { path: location.pathname, to: "/signup-pending", reason: "email-unconfirmed" });
    return <Navigate to="/signup-pending" replace />;
  }

  if (profile) {

    // Stage 2: Universal "Big 7" verification gate.
    // Legacy users (created before the cutoff) bypass the gate entirely.
    // (History: this gate once ran AFTER an `approval_status === "pending"`
    // bounce, trapping half-onboarded users on a review screen for a review
    // that did not exist. That bounce and its screen are gone — Q193.)
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
  }

  // Either profile is loaded and every gate passed, or profile is still
  // loading and we are rendering optimistically — either way, show children.
  return <>{children}</>;
};

export default ProtectedRoute;
