import { useRef, useState } from "react";
import { Clock } from "lucide-react";
import { postAuthDestination } from "@/lib/jobIntent";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { signOutWithPushCleanup } from "@/lib/authSignOut";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff, Mail, Lock, Check, ShieldCheck, X } from "lucide-react";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useQueryClient } from "@tanstack/react-query";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import AuthShell from "@/components/auth/AuthShell";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import { queryKeys } from "@/lib/queryKeys";
import { friendlyAuthError } from "@/lib/authErrors";
import {
  setLastAuthMethod,
} from "@/lib/lastAuthMethod";
import { safeStorage } from "@/lib/safeStorage";

const LOGIN_TIMEOUT_MS = 15000;

// Anti-bruteforce: 5 failed attempts in a rolling 5-minute window triggers
// a soft lockout. Persisted to safeStorage so a force-quit doesn't reset
// the counter — otherwise an attacker on a stolen phone could kill the app
// between guesses and ignore the cooldown.
const LOGIN_ATTEMPTS_KEY = "helpr_login_attempts";
const LOGIN_ATTEMPT_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_LOCKOUT_MS = 5 * 60 * 1000;

interface LoginAttemptState {
  /** Epoch ms timestamps of failed attempts inside the rolling window. */
  attempts: number[];
  /** If non-null, the epoch ms when the lockout expires. */
  lockedUntil: number | null;
}

function readAttemptState(): LoginAttemptState {
  try {
    const raw = safeStorage.getItem(LOGIN_ATTEMPTS_KEY);
    if (!raw) return { attempts: [], lockedUntil: null };
    const parsed = JSON.parse(raw) as LoginAttemptState;
    const now = Date.now();
    return {
      attempts: (parsed.attempts ?? []).filter(
        (t) => typeof t === "number" && now - t < LOGIN_ATTEMPT_WINDOW_MS,
      ),
      lockedUntil:
        parsed.lockedUntil && parsed.lockedUntil > now ? parsed.lockedUntil : null,
    };
  } catch {
    return { attempts: [], lockedUntil: null };
  }
}

function writeAttemptState(state: LoginAttemptState): void {
  try {
    safeStorage.setItem(LOGIN_ATTEMPTS_KEY, JSON.stringify(state));
  } catch { /* ignore quota */ }
}

function clearAttemptState(): void {
  safeStorage.removeItem(LOGIN_ATTEMPTS_KEY);
}

const signInWithTimeout = async (email: string, password: string) => {
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      supabase.auth.signInWithPassword({ email, password }),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(() => reject(
          Object.assign(new Error("Login timed out. Please check your connection and try again."), { isTransport: true }),
        ), LOGIN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
};

/**
 * A failure that says nothing about the credentials: our own 15s race timeout,
 * or a fetch that never reached the auth server. These must NOT enter the
 * failed-attempt ledger — flaky wifi would otherwise soft-lock a legitimate
 * user out for LOGIN_LOCKOUT_MS while their password was correct all along.
 * A wrong password still counts, which is the point of the ledger.
 */
const isTransportFailure = (error: unknown): boolean => {
  const e = error as { isTransport?: boolean; name?: string; message?: string } | null;
  if (!e) return false;
  if (e.isTransport === true) return true;
  // supabase-js wraps an unreachable/5xx auth endpoint in this retryable class.
  if (e.name === "AuthRetryableFetchError") return true;
  return /failed to fetch|networkerror|network error|load failed|timed out/i.test(e.message ?? "");
};

const Login = () => {
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
    } catch { return false; }
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
    } catch { return false; }
  });
  // A safe ?redirect= target set by ProtectedRoute when it bounced a
  // logged-out user off a gated route. We use it ONLY to explain the bounce
  // in the header copy. Sign-in always lands on the home dashboard — the
  // app's main tabs (My Posts, etc.) should never be the post-login landing;
  // the user explicitly wants "log in → home". Deep content links surface
  // their own in-app routing once the user is home.
  const postLoginDest = "/dashboard";
  // ProtectedRoute writes ?redirect= when it bounces a logged-out visitor off
  // a gated route. The comment above has always said it is read "ONLY to
  // explain the bounce in the header copy" — but nothing read it, so a guest
  // following a deep link was dumped here with no idea why. It explains the
  // bounce now; sign-in still lands on the dashboard, unchanged.
  const bouncedFromGatedRoute = Boolean(searchParams.get("redirect"));
  // ONE notice slot, highest-priority reason first — three independent banners
  // could otherwise stack into a wall of yellow above the form.
  const notice =
    signedOutForInactivity
      ? "You were signed out after 30 minutes of inactivity. Log back in to pick up where you left off."
      : arrivedFromSignup
        ? "If that email already has an account, log in below. Forgot your password? Reset it and you'll be back in."
        : bouncedFromGatedRoute
          ? "That page needs an account. Log in and we'll take you to your dashboard."
          : null;
  const queryClient = useQueryClient();
  usePageMeta({
    title: "Log In — Helpr",
    description: "Log in to your Helpr account.",
    canonical: "https://www.louisianahelpr.com/login",
    ogTitle: "Log In — Helpr",
    ogDescription: "Log in to your Helpr account to post jobs or pick up local work across Louisiana.",
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
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
      toast.error(`Too many attempts — try again in ${minutesLeft} min.`,
      );
      return;
    }

    hapticMedium();
    setLoading(true);
    const { data, error } = await signInWithTimeout(email, password).catch((error: Error) => ({ data: { session: null }, error }));
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
        toast.error(`Too many attempts — try again in ${minutesLeft} min.`);
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
      toast.error("Check your inbox first — you'll need to confirm your email before signing in.");
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
      toast.error("Couldn't verify your security settings — try again?");
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
    // postAuthDestination keeps this on the home dashboard per the note above;
    // it only appends ?quickApply=<id> when the visitor got here from a job
    // card they tapped while logged out. See lib/jobIntent.
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
      toast.error("That code didn't match. Check your app and try again.");
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
    <AuthShell hideHeader centerColumn backTo="/" maxWidth="2xl" title="Log In" noWebChrome>
      {/* The [back] [Log In] row now comes from AuthShell's `title` prop —
          it was hand-rolled here, then hand-copied (and drifted) into
          ForgotPassword, Signup and SignupPending. One implementation, in the
          shell, so all ten auth screens carry the identical row.

          `backTo="/"` — NOT bare history-back. Without an explicit target
          BackButton falls through to history.back(), so arriving at /login
          FROM /forgot-password made Back bounce you straight back into
          password reset. Sign-in is a top-level destination reached from all
          over; it needs one predictable parent. */}
      {notice && (
        <div
          className="flex items-start gap-3 px-4 py-3 mb-4 rounded-2xl"
          style={{ background: "hsl(var(--bark) / 0.06)", border: "1px solid hsl(var(--bark) / 0.16)" }}
          role="status"
        >
          <Clock className="w-5 h-5 shrink-0 mt-0.5" strokeWidth={1.75} style={{ color: "hsl(var(--bark))" }} />
          <p className="text-ds-13 leading-snug" style={{ color: "hsl(var(--ink-deep))" }}>
            {notice}
          </p>
        </div>
      )}
      <div className="liquid-glass p-5 sm:p-6 lg:p-10 space-y-6 lg:space-y-6">
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
                className="font-display italic font-bold leading-tight"
                style={{ fontSize: "clamp(1.2rem, 2vw + 0.4rem, 1.5rem)", color: "hsl(var(--ink-deep))", letterSpacing: "-0.025em" }}
              >
                Two-step verification
              </h2>
              <p
                className="font-serif italic text-ds-14"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                Enter the 6-digit code from your authenticator app to finish signing in.
              </p>
            </div>
            <form onSubmit={handleVerifyMfa} className="space-y-3.5">
              <div className="space-y-2">
                <Label htmlFor="mfa-login-code" className="text-ds-13 font-sans font-medium">
                  Authentication code
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
                className="w-full rounded-ds-md"
                size="lg"
                disabled={mfaVerifying || mfaCode.length !== 6}
              >
                {mfaVerifying ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Verifying…</> : "Verify"}
              </Button>
              <button
                type="button"
                onClick={cancelMfa}
                className="w-full text-center text-ds-11 font-sans tracking-wide hover:opacity-70 active:opacity-50 transition-opacity"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                Use a Different Account
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
        <div className="grid gap-6 lg:grid-cols-[1fr_auto_1fr] lg:gap-14 lg:items-stretch">
        {/* noValidate: `required` stays on both inputs for semantics, but the
            browser's own validation bubble would intercept the submit and
            replace our inline messages with a native tooltip — so the "name
            what's missing" path in handleLogin could never run. React owns
            the validation on this form. */}
        <form onSubmit={handleLogin} noValidate className="space-y-3.5 lg:space-y-6">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-ds-13 font-sans font-medium">Email</Label>
            <div className="relative">
              <Mail
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none z-10"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                strokeWidth={1.75}
              />
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
                className={`pl-10 ${emailValid ? "pr-10" : ""} rounded-ds-md bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)] placeholder:text-[hsl(var(--olivewood)/0.8)] ${emailError ? "!border-destructive focus-visible:!border-destructive" : ""}`}
              />
              {emailValid && (
                <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
              )}
            </div>
            {emailError && (
              <p id="login-email-error" role="alert" className="inline-flex items-center gap-1 text-ds-11 text-destructive">
                <X className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden />
                {email.trim() ? "Enter a valid email address" : "Add your email address"}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password" className="text-ds-13 font-sans font-medium">Password</Label>
            <div className="relative">
              <Lock
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none z-10"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                strokeWidth={1.75}
              />
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
                className={`pl-10 pr-10 rounded-ds-md bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)] placeholder:text-[hsl(var(--olivewood)/0.8)] ${passwordError ? "!border-destructive focus-visible:!border-destructive" : ""}`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {passwordError && (
              <p id="login-password-error" role="alert" className="inline-flex items-center gap-1 text-ds-11 text-destructive">
                <X className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden />
                Add your password
              </p>
            )}
            {/* Recovery link, under the field it belongs to and above the CTA.

                The gaps are controlled on the LINK (`-my-2`), not on this
                wrapper's top margin. That distinction is the whole fix: the
                wrapper is a `space-y-2` sibling, and `.space-y-2 > * ~ *`
                outranks `.-mt-*` on specificity, so every negative top margin
                put here was silently discarded — which is why the link sat in
                ~27pt above / ~32pt below, the two largest gaps in the card.
                Shrinking the 44px box from the inside works because nothing
                competes for the link's own margins, and `-mb-4` on the wrapper
                collapses against the card's `space-y-6` to bring the button up.
                Touch target stays 44px; only the whitespace around it moves. */}
            <div className="flex justify-end -mb-4">
              <Link
                to="/forgot-password"
                // Muted olivewood, NOT --bark. Bark (#5E6544) is the same deep
                // olive the Log In button is built from, so a bold bark link
                // sitting directly above that button read as a second green
                // control competing with the primary one. The screen gets ONE
                // strong green. Dropped to medium weight for the same reason —
                // this is the escape hatch, not the action.
                className="min-h-[44px] -my-2 inline-flex items-center text-ds-12 font-sans font-semibold hover:underline active:opacity-60 transition-opacity"
                style={{ color: "hsl(var(--bark))" }}
              >
                Forgot Password?
              </Link>
            </div>
          </div>
          <Button
            variant="primary"
            type="submit"
            className="w-full rounded-ds-md"
            size="lg"
            // Loading-only disable (owner, V5) — the pattern Signup's Continue
            // and Create Account already use. A greyed-out Log In is a dead
            // end that says something is wrong without saying WHAT; the button
            // now stays tappable and tapping it names the missing field inline
            // (and focuses it) instead of firing signInWithPassword.
            disabled={loading}
          >
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Logging In…</> : "Log In"}
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
        <div className="hidden lg:flex flex-col items-center gap-3" aria-hidden>
          <span className="w-px flex-1" style={{ backgroundColor: "hsl(var(--olivewood) / 0.14)" }} />
          <span
            className="text-ds-11 tracking-[0.2em] uppercase font-serif italic"
            style={{ color: "hsl(var(--burnt-sienna) / 0.9)" }}
          >
            or
          </span>
          <span className="w-px flex-1" style={{ backgroundColor: "hsl(var(--olivewood) / 0.14)" }} />
        </div>

        {/* Vertically centred against the taller credentials column, so the
            social buttons sit level with the form rather than hugging the top
            with dead space beneath them. */}
        <div className="space-y-6 lg:flex lg:flex-col lg:justify-center lg:gap-8 lg:space-y-0">
        {/* The OR rule only makes sense when the two methods are stacked. At
            lg+ they sit side by side, so the columns themselves do the
            separating. */}
        {/* 0.9 alpha, not 0.7. Measured: burnt-sienna at 0.7 composited over
            --parchment is 3.28:1, and this is 11px text, so WCAG AA wants 4.5.
            0.9 measures 4.86:1. The desktop twin above carries the same value
            for consistency — axe skips it because its wrapper is aria-hidden,
            but aria-hidden does nothing for a sighted user reading low-contrast
            text, so "not flagged" was never the same as "fine". */}
        <div className="flex items-center gap-3 lg:hidden">
          <span className="h-px flex-1" style={{ backgroundColor: "hsl(var(--olivewood) / 0.14)" }} />
          <span
            className="text-ds-11 tracking-[0.2em] uppercase font-serif italic"
            style={{ color: "hsl(var(--burnt-sienna) / 0.9)" }}
          >
            or
          </span>
          <span className="h-px flex-1" style={{ backgroundColor: "hsl(var(--olivewood) / 0.14)" }} />
        </div>

        <SocialAuthButtons mode="signin" />
        {/* Under the providers (owner). It has been outside the card and under
            both columns; back here, closing the social column. */}
        <p className="text-center text-ds-12 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          New to Helpr?{" "}
          <Link
            to="/signup"
            className="font-semibold hover:underline whitespace-nowrap"
            style={{ color: "hsl(var(--bark))" }}
          >
            Create an Account
          </Link>
        </p>
        {/* Creating an account is the alternative to BOTH sign-in methods, so
            it closes the right column rather than floating under the card. */}
        </div>
        </div>

        </>
        )}
      </div>

    </AuthShell>
  );
};

export default Login;
