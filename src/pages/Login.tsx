import { useState } from "react";
import { BUSINESS_ENABLED } from "@/config/businessEnabled";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { signOutWithPushCleanup } from "@/lib/authSignOut";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff, Mail, Lock, Check, ShieldCheck } from "lucide-react";
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
        timeoutId = window.setTimeout(() => reject(new Error("Login timed out. Please check your connection and try again.")), LOGIN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
};

const Login = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // A safe ?redirect= target set by ProtectedRoute when it bounced a
  // logged-out user off a gated route. We use it ONLY to explain the bounce
  // in the header copy. Sign-in always lands on the home dashboard — the
  // app's main tabs (My Posts, etc.) should never be the post-login landing;
  // the user explicitly wants "log in → home". Deep content links surface
  // their own in-app routing once the user is home.
  const postLoginDest = "/dashboard";
  const queryClient = useQueryClient();
  usePageMeta({
    title: "Log In — Helpr",
    description: "Sign in to your Helpr account.",
    canonical: "https://www.louisianahelpr.com/login",
    ogTitle: "Log In — Helpr",
    ogDescription: "Sign in to your Helpr account to post jobs or pick up local work across Louisiana.",
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


  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    if (attemptState.lockedUntil && Date.now() < attemptState.lockedUntil) {
      const msLeft = attemptState.lockedUntil - Date.now();
      const minutesLeft = Math.ceil(msLeft / 60000);
      hapticError();
      toast.error(
        `Too many attempts — try again in ${minutesLeft} min`,
      );
      return;
    }

    hapticMedium();
    setLoading(true);
    const { data, error } = await signInWithTimeout(email, password).catch((error: Error) => ({ data: { session: null }, error }));
    if (error) {
      setLoading(false);
      const now = Date.now();
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
        toast.error(`Too many attempts — try again in ${minutesLeft} min`);
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
  // post-MFA path. Remembers the method, warms the user cache, greets by
  // first name, then routes into the app.
  const finishLogin = async () => {
    setLastAuthMethod("email");
    void queryClient.invalidateQueries({ queryKey: queryKeys.currentUser.all });
    setLoading(false);
    hapticSuccess();
    let firstName = "";
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user?.id;
      if (userId) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("user_id", userId)
          .maybeSingle();
        firstName = (prof?.full_name ?? "").trim().split(/\s+/)[0] ?? "";
      }
    } catch { /* fall through to generic copy */ }
    toast.success(firstName ? `Welcome back, ${firstName}.` : "Welcome back.");
    navigate(postLoginDest, { replace: true });
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
    <AuthShell hideHeader centerColumn backTo="/" maxWidth="2xl" title="Sign In">
      {/* The [back] [Sign in] row now comes from AuthShell's `title` prop —
          it was hand-rolled here, then hand-copied (and drifted) into
          ForgotPassword, Signup and SignupPending. One implementation, in the
          shell, so all ten auth screens carry the identical row.

          `backTo="/"` — NOT bare history-back. Without an explicit target
          BackButton falls through to history.back(), so arriving at /login
          FROM /forgot-password made Back bounce you straight back into
          password reset. Sign-in is a top-level destination reached from all
          over; it needs one predictable parent. */}
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
                Use a different account
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
        <form onSubmit={handleLogin} className="space-y-3.5 lg:space-y-6">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-ds-13 font-sans font-medium">Email</Label>
            <div className="relative">
              <Mail
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none z-10"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                strokeWidth={1.75}
              />
              <Input
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
                className={`pl-10 ${emailValid ? "pr-10" : ""} rounded-ds-md bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)] placeholder:text-[hsl(var(--olivewood)/0.8)]`}
              />
              {emailValid && (
                <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
              )}
            </div>
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
                className="pl-10 pr-10 rounded-ds-md bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)] placeholder:text-[hsl(var(--olivewood)/0.8)]"
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
                // olive the Sign in button is built from, so a bold bark link
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
            disabled={loading}
          >
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing in…</> : "Sign In"}
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
        {/* Only the BUSINESS offer stays in the card. The personal one is now
            the "Create account" tab above, and repeating it here would be the
            same choice twice on one screen. A business account is a genuinely
            different destination the two tabs don't cover.

            ONE line (owner: "try to fit new to Helpr and the business account
            each in their own line"). It used to be two — question, then the
            link `block` beneath it — because "Create a business account"
            wrapped mid-phrase into "Create a" / "business account", two broken
            fragments. Shortening the link fits it inline in the auth column at
            375px; `whitespace-nowrap` guarantees that if the copy ever grows
            the link drops to its own line intact rather than splitting in the
            middle again. */}
        {BUSINESS_ENABLED && (
        <p className="text-center text-ds-11 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          Setting up a company?{" "}
          <Link
            to="/signup?type=business"
            className="font-semibold hover:underline whitespace-nowrap"
            style={{ color: "hsl(var(--bark))" }}
          >
            Business account
          </Link>
        </p>
        )}
        </div>
        </div>

        </>
        )}
      </div>

    </AuthShell>
  );
};

export default Login;
