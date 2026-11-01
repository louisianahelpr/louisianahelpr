import { useEffect, useRef, useState } from "react";
import { loginNotice } from "./loginNotice";
import { AlertCircle, Clock } from "lucide-react";
import { postAuthDestination, rememberSignupRedirect, signupUrlFor } from "@/lib/jobIntent";
import { rememberReferralFromUrl } from "@/lib/pendingReferral";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { HelprMark } from "@/components/HelprMark";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { signOutWithPushCleanup } from "@/lib/authSignOut";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff, Check, ShieldCheck, X } from "lucide-react";
import { usePageMeta } from "@/hooks/usePageMeta";
import { NOINDEX_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { useQueryClient } from "@tanstack/react-query";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import { SOCIAL_SIGN_IN_ENABLED } from "@/lib/socialAuth";
import { OrRule } from "@/components/auth/OrRule";
import AuthShell from "@/components/auth/AuthShell";
import { TurnstileField } from "@/components/auth/TurnstileField";
import { useCaptcha } from "@/hooks/useCaptcha";
import { signInWithTimeout, isTransportFailure } from "@/lib/loginTransport";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import { queryKeys } from "@/lib/queryKeys";
import { friendlyAuthError } from "@/lib/authErrors";
import { isExpectedSocialRefusal, takeOAuthRedirectError } from "@/lib/oauthRedirectError";
import { report } from "@/lib/errorLogger";
import {
  setLastAuthMethod,
} from "@/lib/lastAuthMethod";
import { LOGIN_ATTEMPT_LIMIT, LOGIN_ATTEMPT_WINDOW_MS, LOGIN_LOCKOUT_MS, clearAttemptState, readAttemptState, writeAttemptState, type LoginAttemptState } from "./loginAttempts";
import { safeInternalRedirect } from "@/lib/authRedirects";
import { useLanguage } from "@/lib/i18n/language";
import { LanguageToggle } from "@/components/LanguageToggle";
import "@/lib/i18n/enScreens"; // registers the screen words t() reads here

const Login = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // One-shot note from useSessionTimeout: the 30-minute inactivity sign-out
  // is otherwise silent, and being dumped here with no explanation reads as
  // a crash. Read-and-clear so a refresh doesn't repeat it.
  //
  // INTENTIONALLY DORMANT: idle sign-out is disabled app-wide — `SessionManager`
  // in App.tsx no longer calls `useSessionTimeout()`, so nothing writes
  // `helpr_signed_out_reason` and this banner cannot currently render. It is
  // kept, like the hook and its tests, so restoring idle sign-out stays the
  // one-line revert App.tsx documents. Do not read it as live behaviour.
  const [signedOutForInactivity] = useState<boolean>(() => {
    try {
      const hit = sessionStorage.getItem("helpr_signed_out_reason") === "inactivity";
      if (hit) sessionStorage.removeItem("helpr_signed_out_reason");
      return hit;
    } catch {
      // Silent by design: this only decides whether to show a one-shot
      // "you were signed out for inactivity" note. sessionStorage throws in
      // private mode; not showing an explanatory line is the correct
      // degradation, and there is nothing for anyone to act on.
      return false;
    }
  });
  // One-shot note from Signup's already-registered branch. That branch
  // deliberately refuses to confess whether the address exists (enumeration
  // oracle), but it used to redirect here in total silence — the user pressed
  // "Create account" and simply arrived on a different screen. The neutral
  // line its own comment promised is shown here instead.
  const [arrivedFromSignup] = useState<boolean>(() => {
    try {
      const hit = sessionStorage.getItem("helpr_signup_redirect") === "1";
      if (hit) sessionStorage.removeItem("helpr_signup_redirect");
      return hit;
    } catch {
      // Silent by design: same one-shot-note case as above — this only picks
      // whether to render the neutral line explaining the redirect from
      // Signup. Losing it degrades copy, nothing else.
      return false;
    }
  });
  // The default landing. "Log in → home" is still the rule for an ordinary
  // sign-in: a user who opens /login of their own accord lands on the
  // dashboard, and the app's main tabs are never a post-login destination the
  // user did not ask for.
  const postLoginDest = "/home";
  // ?redirect= is the ONE case that is not an ordinary sign-in. ProtectedRoute
  // writes it when it bounces a logged-out visitor off a route they had
  // already navigated to, so the param IS the user asking to go somewhere —
  // returning them there is not overriding the landing rule, it is completing
  // the interruption. It used to be read only to phrase the notice, so
  // /login?redirect=%2Fposts signed you in and dropped you on the dashboard
  // with the page you had asked for silently discarded.
  //
  // It rides the SAME storage + validation Signup already uses
  // (`rememberSignupRedirect` → `safeInternalRedirect`, applied on write and
  // again on read): same-origin leading-slash paths only, never an auth
  // screen, and the read is destructive so a stale target cannot hijack a
  // later unrelated sign-in. Going through storage rather than straight to
  // `navigate` is also what carries it across the MFA challenge, which
  // unmounts nothing but resolves in a second handler.
  const pendingRedirect = searchParams.get("redirect");
  useEffect(() => {
    rememberSignupRedirect(pendingRedirect);
    // A `?ref=` on a log-in link (an Apple/Google sign-up can start here): keep it for the Referrals card.
    rememberReferralFromUrl(window.location.search);
  }, [pendingRedirect]);
  const bouncedFromGatedRoute = Boolean(safeInternalRedirect(pendingRedirect));
  // Where a bounced guest was headed, in the one sign-up link form
  // (`/signup?redirect=`). A job link keeps its query (`/jobs/<id>?ref=share`).
  const signupHref = signupUrlFor(pendingRedirect);
  // ONE notice slot, highest-priority reason first — three independent banners
  // could otherwise stack into a wall of yellow above the form.
  // OA-018: a web Apple/Google sign-in the auth server refused (unverified
  // provider email, two accounts on one address, a banned account). Captured
  // at boot by oauthRedirectError.ts; read-and-clear, so it shows once.
  const [oauthError] = useState(() => takeOAuthRedirectError());
  // Reported here, not at capture: oauthRedirectError.ts runs before the
  // Supabase client and must not import errorLogger. A refusal that is the
  // person's own outcome stays quiet; anything else (a server_error from a
  // failing auth trigger, a disabled provider, two accounts on one address)
  // was showing copy while ops heard nothing (lh-silent-failure review, #1806).
  useEffect(() => {
    if (!oauthError || isExpectedSocialRefusal(oauthError.code)) return;
    // No marker (provider null): anyone can craft that URL, so no error-level alert (Q445).
    report(new Error(`web social sign-in refused: ${oauthError.code}`), {
      severity: oauthError.provider ? "error" : "warning",
      tags: { area: "auth", op: "webSocialRedirect", provider: oauthError.provider ?? "unknown", code: oauthError.code },
    });
  }, [oauthError]);
  const { accountChoice, notice, leadWithSignup } = loginNotice({ oauthError, connect: searchParams.get("connect"), signedOutForInactivity, sessionLost: searchParams.get("signed_out") === "session-lost", arrivedFromSignup, bouncedFromGatedRoute, redirect: safeInternalRedirect(pendingRedirect) });
  const queryClient = useQueryClient();
  // Q401a: the same table api/share.ts serves pre-JS (src/lib/publicPageMeta.mjs), noindex included.
  usePageMeta(NOINDEX_PAGE_META["/login"]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const captcha = useCaptcha();
  const [showPassword, setShowPassword] = useState(false);
  // Seed from durable storage so the lockout survives a force-quit.
  const [attemptState, setAttemptState] = useState<LoginAttemptState>(() =>
    readAttemptState(),
  );
  // When the signed-in user has a verified TOTP factor, the session lands at
  // AAL1 and we hold them here until they clear a 6-digit challenge (AAL2)
  // before routing into the app.
  const [mfaChallenge, setMfaChallenge] = useState<{ factorId: string } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaVerifying, setMfaVerifying] = useState(false);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  // Set once Log In has been tapped — lets an UNTOUCHED field surface its
  // "add this" error, which a purely value-driven check can never do.
  const [attempted, setAttempted] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  // Shared by the field's aria-invalid and the message under it, so a field
  // can never show one without the other. A malformed address complains as you
  // type; an empty one only after a submit attempt (SignupStep1's split).
  const emailError = (email.length > 0 && !emailValid) || (attempted && !email.trim());
  const passwordError = attempted && password.length === 0;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    // Field validation runs BEFORE the lockout check and before the network
    // call: an incomplete form is not a failed sign-in attempt and must not
    // count toward the 5-strike lockout, nor reach signInWithPassword.
    setAttempted(true);
    if (!emailValid) {
      hapticError();
      emailRef.current?.focus();
      return;
    }
    if (password.length === 0) {
      hapticError();
      passwordRef.current?.focus();
      return;
    }

    if (attemptState.lockedUntil && Date.now() < attemptState.lockedUntil) {
      const msLeft = attemptState.lockedUntil - Date.now();
      const minutesLeft = Math.ceil(msLeft / 60000);
      hapticError();
      toast.error(t("login.tooManyAttempts", { minutes: minutesLeft }),
      );
      return;
    }

    hapticMedium();
    setLoading(true);
    const { data, error } = await captcha.run((captchaToken) => signInWithTimeout(email, password, captchaToken))
      .catch((error: Error) => ({ data: { session: null }, error }));
    if (error) {
      setLoading(false);
      const now = Date.now();
      // A timeout or an unreachable auth server is not a wrong password, so it
      // must not spend one of the user's attempts (see isTransportFailure).
      if (isTransportFailure(error)) {
        hapticError();
        toast.error(friendlyAuthError(error.message));
        return;
      }
      const next: LoginAttemptState = {
        attempts: [
          ...attemptState.attempts.filter((t) => now - t < LOGIN_ATTEMPT_WINDOW_MS),
          now,
        ],
        lockedUntil: attemptState.lockedUntil,
      };
      if (next.attempts.length >= LOGIN_ATTEMPT_LIMIT) {
        next.lockedUntil = now + LOGIN_LOCKOUT_MS;
        // Reset the counter once we've crossed the line — next failed-then-locked
        // window starts fresh after the lockout expires.
        next.attempts = [];
      }
      setAttemptState(next);
      writeAttemptState(next);
      hapticError();
      if (next.lockedUntil && next.lockedUntil > now) {
        const minutesLeft = Math.ceil((next.lockedUntil - now) / 60000);
        toast.error(t("login.tooManyAttempts", { minutes: minutesLeft }));
      } else {
        toast.error(friendlyAuthError(error.message));
      }
      return;
    }
    // Success — clear the failed-attempt history.
    setAttemptState({ attempts: [], lockedUntil: null });
    clearAttemptState();

    const sessionUser = data.session?.user;
    if (sessionUser && !sessionUser.email_confirmed_at) {
      await signOutWithPushCleanup();
      setLoading(false);
      hapticError();
      toast.error(t("login.confirmEmailFirst"));
      return;
    }

    // Two-step gate: if the account has a verified TOTP factor, the password
    // sign-in only reaches AAL1. Hold the user on a 6-digit challenge until
    // the session is elevated to AAL2 before letting them into the app.
    try {
      const { data: aal, error: aalError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aalError) throw aalError;
      if (aal?.nextLevel === "aal2" && aal.currentLevel === "aal1") {
        const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
        if (factorsError) throw factorsError;
        const factor = factors?.totp.find((f) => f.status === "verified");
        if (factor) {
          setLoading(false);
          setMfaCode("");
          setMfaChallenge({ factorId: factor.id });
          return;
        }
      }
    } catch {
      // Fail closed: a dropped error here must never look identical to "no
      // MFA configured" — that would let an AAL1 session straight into the
      // app for a user who has 2FA enabled. Sign back out and make them retry.
      await signOutWithPushCleanup();
      setLoading(false);
      hapticError();
      toast.error(t("login.mfaCheckFailed"));
      return;
    }

    await finishLogin();
  };

  // Post-authentication routing, shared by the plain password path and the
  // post-MFA path. Remembers the method, warms the user cache, then routes
  // into the app.
  const finishLogin = async () => {
    setLastAuthMethod("email");
    void queryClient.invalidateQueries({ queryKey: queryKeys.currentUser.all });
    setLoading(false);
    hapticSuccess();
    // postAuthDestination spends whichever intent is pending: the ?redirect=
    // path a bounced visitor was trying to reach, else ?quickApply=<id> for a
    // job card tapped while logged out, else the home dashboard. See
    // lib/jobIntent. Shared with the MFA path below, which is why the target
    // lives in storage rather than in this closure.
    navigate(postAuthDestination(postLoginDest), { replace: true });
  };

  const handleVerifyMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaChallenge || mfaCode.trim().length !== 6 || mfaVerifying) return;
    setMfaVerifying(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({
      factorId: mfaChallenge.factorId,
      code: mfaCode.trim(),
    });
    setMfaVerifying(false);
    if (error) {
      hapticError();
      toast.error(t("login.mfaWrongCode"));
      return;
    }
    setMfaChallenge(null);
    await finishLogin();
  };

  const cancelMfa = async () => {
    setMfaChallenge(null);
    setMfaCode("");
    await signOutWithPushCleanup();
  };

  return (
    <AuthShell hideHeader hideBack centerColumn maxWidth="sm" noWebChrome>
      {/* Board 37 (owner, 2026-10-20): no back arrow above the card. The
          round H icon at the top of the card links home ("/"), the one
          predictable parent; history-back is never used (arriving from
          /forgot-password must not bounce back into password reset). */}
      {notice && (
        <div
          className="flex items-start gap-3 px-4 py-3 mb-4 rounded-2xl"
          style={{ background: "hsl(var(--bark) / 0.06)", border: "1px solid hsl(var(--bark) / 0.16)" }}
          role="status"
        >
          {oauthError ? (
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" strokeWidth={1.75} style={{ color: "hsl(var(--bark))" }} />
          ) : (
            <Clock className="w-5 h-5 shrink-0 mt-0.5" strokeWidth={1.75} style={{ color: "hsl(var(--bark))" }} />
          )}
          <div className="min-w-0 space-y-2">
            <p className="text-ds-13 leading-snug" style={{ color: "hsl(var(--ink-deep))" }}>
              {notice}
            </p>
            {/* AUD31-16: a shared Declutter link's guest is most likely new: sign-up first, here, not only the small last line. */}
            {leadWithSignup && (
              <Link to={signupHref} className="link-standard font-semibold" style={{ color: "hsl(var(--bark))" }} data-login-lead-signup="">
                {t("login.createAccount")}
              </Link>
            )}
          </div>
        </div>
      )}
      <div className="liquid-glass p-5 sm:p-6 lg:p-8 space-y-6">
        {/* Board 37 (owner 2026-10-20): the ROUND H app icon, "Log in" and one
            welcome line head the card; email + password come first, then "or"
            and the providers. Restyle only: every handler below is unchanged.
            Guard: src/test/loginBoard37.test.tsx. */}
        {!mfaChallenge && (
          <div className="flex flex-col items-center text-center gap-1.5" data-testid="login-card-head">
            {/* Board 37/55: no back arrow; the round H icon is the way home. */}
            <div className="mb-2">
              {/* The H mark used everywhere else (owner 2026-10-20: never in a circle). */}
              <HelprMark to="/" size="lg" emblemOnly />
            </div>
            <h1 className="text-page-title text-foreground">{t("login.title")}</h1>
            <p className="text-ds-14 text-muted-foreground">{t("login.welcome")}</p>
          </div>
        )}
        {/* No heading inside the card. The H emblem and the in-card heading
            are both gone: the emblem used to stack above a heading that sat
            above the card — three separate bands of vertical space before the
            user reached the email field. The single visible h1 is the one
            AuthShell renders in its `title` row above the card, so the card
            itself starts at the first input. The mark still appears in the
            back-nav and throughout the app; an auth screen does not need to
            re-announce the brand three times. */}
        {mfaChallenge ? (
          <div className="space-y-5">
            <div className="flex flex-col items-center text-center gap-2">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-primary" strokeWidth={1.75} />
              </div>
              <h2
                className="font-display font-bold leading-tight"
                style={{ fontSize: "clamp(1.2rem, 2vw + 0.4rem, 1.5rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
              >
                {t("login.mfaTitle")}
              </h2>
              <p
                className="font-sans text-ds-14"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {t("login.mfaBody")}
              </p>
            </div>
            <form onSubmit={handleVerifyMfa} className="space-y-3.5">
              <div className="space-y-2">
                <Label htmlFor="mfa-login-code" className="text-ds-13 font-sans font-medium">
                  {t("login.mfaCode")}
                </Label>
                <Input
                  id="mfa-login-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  enterKeyHint="done"
                  maxLength={6}
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  autoFocus
                  className="tracking-[0.3em] text-center font-mono rounded-ds-md bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)]"
                />
              </div>
              <Button
                variant="primary"
                type="submit"
                className="w-full"
                size="lg"
                disabled={mfaVerifying || mfaCode.length !== 6}
              >
                {mfaVerifying ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t("login.verifying")}</> : t("login.verify")}
              </Button>
              <button
                type="button"
                onClick={cancelMfa}
                className="w-full text-center text-ds-11 font-sans tracking-wide hover:opacity-70 active:opacity-50 transition-opacity"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                {t("login.differentAccount")}
              </button>
            </form>
          </div>
        ) : (
        <>
        {/* Two columns at lg+: credentials left, social right. The card is
            1024px, and a single-line email field stretched across all of it is
            what read as wrong. Splitting the two sign-in METHODS uses the width
            for something real instead of inflating one field. Stacks below lg,
            unchanged. */}
        <div className="grid gap-6 w-full [&>*]:min-w-0">
        {/* noValidate: `required` stays on both inputs for semantics, but the
            browser's own validation bubble would intercept the submit and
            replace our inline messages with a native tooltip — so the "name
            what's missing" path in handleLogin could never run. React owns
            the validation on this form. */}
        <form onSubmit={handleLogin} noValidate className="space-y-3.5">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-ds-13 font-sans font-medium">{t("login.email")}</Label>
            <div className="relative">
              <Input
                ref={emailRef}
                id="email"
                type="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                aria-invalid={emailError}
                aria-describedby={emailError ? "login-email-error" : undefined}
                className={`${emailValid ? "pr-10" : ""} rounded-ds-md bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)] placeholder:text-[hsl(var(--olivewood)/0.8)] ${emailError ? "!border-destructive focus-visible:!border-destructive" : ""}`}
              />
              {emailValid && (
                <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
              )}
            </div>
            {emailError && (
              <p id="login-email-error" role="alert" className="inline-flex items-center gap-1 text-ds-11 text-[hsl(var(--destructive-ink))]">
                <X className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden />
                {email.trim() ? t("login.emailInvalid") : t("login.emailMissing")}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="password" className="text-ds-13 font-sans font-medium">{t("login.password")}</Label>
              {/* Board 37: the recovery link sits on the Password label's row. */}
              {/* The typed email rides along in router state (never the URL, so it stays
                  out of history and logs): audit 2026-10-29 A3-C12. */}
              <Link
                to="/forgot-password"
                state={{ email: email.trim() }}
                className="min-h-[44px] -my-3 inline-flex items-center text-ds-13 font-sans font-bold hover:underline active:opacity-60 transition-opacity"
                style={{ color: "hsl(var(--bark))" }}
              >
                {t("login.forgot")}
              </Link>
            </div>
            <div className="relative">
              <Input
                ref={passwordRef}
                id="password"
                type={showPassword ? "text" : "password"}
                enterKeyHint="done"
                // No placeholder — and as of 2026-08-22 neither does Email.
                // Bullets here mimicked a FILLED password field, so the empty
                // state read as "already populated" alongside iOS autofill;
                // that stands. What changed is the other half: Email kept a
                // "you@example.com" placeholder, so the two fields in one card
                // were styled differently and the password field read as the
                // broken one. Signup already had zero placeholders, making
                // Login and ForgotPassword the outliers rather than the rule.
                // All three auth screens are now label-only.
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                aria-invalid={passwordError}
                aria-describedby={passwordError ? "login-password-error" : undefined}
                className={`pr-10 rounded-ds-md bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)] placeholder:text-[hsl(var(--olivewood)/0.8)] ${passwordError ? "!border-destructive focus-visible:!border-destructive" : ""}`}
              />
              <Button type="button" variant="ghost" size="iconCompact" onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")} className="absolute right-0 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground [&_svg]:size-4">
                {showPassword ? <EyeOff /> : <Eye />}
              </Button>
            </div>
            {passwordError && (
              <p id="login-password-error" role="alert" className="inline-flex items-center gap-1 text-ds-11 text-[hsl(var(--destructive-ink))]">
                <X className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden />
                {t("login.passwordMissing")}
              </p>
            )}
          </div>
          <TurnstileField ref={captcha.ref} action="login" />
          <Button
            variant="primary"
            type="submit"
            className="w-full rounded-full"
            size="lg"
            // Loading-only disable (owner, V5) — the pattern Signup's Continue
            // and Create Account already use. A greyed-out Log In is a dead
            // end that says something is wrong without saying WHAT; the button
            // now stays tappable and tapping it names the missing field inline
            // (and focuses it) instead of firing signInWithPassword.
            disabled={loading}
          >
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t("login.submitting")}</> : t("login.submit")}
          </Button>
          {/* No "By signing in you agree to our Terms · Rules · Privacy" here.
              Consent is CAPTURED on signup — Signup.tsx has real, recorded
              checkboxes (Terms + Privacy, the 18+ age gate, marketing opt-in),
              which is what actually satisfies the consent requirement. A
              returning user already accepted at signup, so restating it on the
              highest-frequency path was noise, not compliance. The policies stay
              one tap away in the footer, Profile → Legal & Policies, and on
              signup itself. (Owner decision 2026-08-08: drop from sign-in only.) */}
        </form>

        {/* Vertical OR rule, lg+ only — the horizontal one inside the right
            column still handles the stacked layout below lg. Its own grid
            column so it sits between the two methods rather than inside
            either. */}

        {/* Vertically centred against the taller credentials column, so the
            social buttons sit level with the form rather than hugging the top
            with dead space beneath them. */}
        <div className="space-y-6">
        {/* The OR rule only makes sense when the two methods are stacked. At
            lg+ they sit side by side, so the columns themselves do the
            separating. */}
        {/* The rule's colour and its two contrast measurements: OrRule.tsx. */}
        {SOCIAL_SIGN_IN_ENABLED && (
          <>
            <OrRule />
            <SocialAuthButtons initialChoice={accountChoice} />
          </>
        )}
        {/* Under the providers (owner). It has been outside the card and under
            both columns; back here, closing the social column. */}
        <p className="text-center text-ds-12 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          {t("login.newHere")}{" "}
          {/* Carries the job forward. `rememberJobIntent` (called by
              ProtectedRoute when it bounced this visitor) already stores the id
              durably, so this param is a FALLBACK — but a real one: if storage
              is blocked (Safari "Block All Cookies", a locked-down WebView,
              kiosk policy) safeStorage silently keeps nothing, and the URL is
              then the only thing carrying the job through signup. A guest who
              tapped a shared job link and lost it at the account step is the
              exact failure this whole path exists to prevent. */}
          <Link
            to={signupHref}
            className="font-semibold hover:underline whitespace-nowrap"
            style={{ color: "hsl(var(--bark))" }}
          >
            {t("login.createAccount")}
          </Link>
        </p>
        {/* Creating an account is the alternative to BOTH sign-in methods, so
            it closes the right column rather than floating under the card. */}
        </div>
        </div>

        </>
        )}
      </div>
      {/* English / Español (Spanish language option, 2026-10-29): under the card, remembered on this device. */}
      <div className="flex justify-center pt-3">
        <LanguageToggle />
      </div>

    </AuthShell>
  );
};

export default Login;
