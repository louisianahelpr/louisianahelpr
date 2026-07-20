import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { signOutWithPushCleanup } from "@/lib/authSignOut";
import { toast } from "sonner";
import { Loader2, Eye, EyeOff, Mail, Lock, Check, Clock, ShieldCheck } from "lucide-react";
import { usePageMeta } from "@/hooks/usePageMeta";
import { useQueryClient } from "@tanstack/react-query";
import { SocialAuthButtons } from "@/components/auth/SocialAuthButtons";
import AuthShell from "@/components/auth/AuthShell";
import { AuthBrandPane } from "@/components/auth/AuthBrandPane";
import HelprMark from "@/components/HelprMark";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import BuildStamp from "@/components/BuildStamp";
import { queryKeys } from "@/lib/queryKeys";
import { friendlyAuthError } from "@/lib/authErrors";
import { safeInternalRedirect } from "@/lib/authRedirects";
import {
  getLastAuthMethod,
  setLastAuthMethod,
  authMethodLabel,
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
  const redirectTarget = safeInternalRedirect(searchParams.get("redirect"));
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

  // Quiet last-method hint — only shown when we have a non-error reading
  // (initial first-ever login still surfaces no hint). useMemo keeps this
  // stable across re-renders so the dismissal animation never re-triggers.
  const lastMethod = useMemo(() => getLastAuthMethod(), []);

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
      toast.error("Please verify your email before logging in. Check your inbox for a verification link.");
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
      toast.error("Couldn't verify your account's security settings. Please try again.");
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
    <AuthShell hideHeader desktopBrandPanel={<AuthBrandPane />}>
      <div className="text-center mb-8 space-y-2">
        <div className="flex justify-center mb-3">
          <HelprMark to={null} size="md" emblemOnly />
        </div>
        <h1
          className="font-display italic font-bold leading-tight"
          style={{
            fontSize: "clamp(1.85rem, 3vw + 0.5rem, 2.5rem)",
            color: "hsl(var(--ink-deep))",
            letterSpacing: "-0.03em",
          }}
        >
          Glad you're back.
        </h1>
        <p
          className="font-sans"
          style={{
            fontSize: "0.95rem",
            color: "hsl(var(--olivewood) / 0.8)",
            letterSpacing: "0.01em",
          }}
        >
          {redirectTarget ? "Sign in to continue." : "Pick up right where you left off."}
        </p>
      </div>

      <div className="liquid-glass px-6 sm:px-8 py-8 space-y-6">
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
                className="font-serif italic"
                style={{ fontSize: "0.85rem", color: "hsl(var(--olivewood) / 0.8)" }}
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
                  placeholder="123456"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  autoFocus
                  className="tracking-[0.3em] text-center font-mono rounded-ds-md bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)]"
                />
              </div>
              <Button
                variant="bark"
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
        {lastMethod && (
          // Quiet hint that helps returning users pick the right button
          // without revealing anything sensitive — just nudges them toward
          // the method they used last time.
          <div
            className="flex items-center gap-2 rounded-ds-md px-3 py-2 text-ds-11 font-sans"
            style={{
              background: "hsl(var(--bark) / 0.06)",
              color: "hsl(var(--olivewood) / 0.85)",
              border: "1px solid hsl(var(--bark) / 0.12)",
            }}
            aria-live="polite"
          >
            <Clock
              className="w-3.5 h-3.5 shrink-0"
              strokeWidth={1.75}
              style={{ color: "hsl(var(--bark))" }}
              aria-hidden
            />
            <span>
              Last time you used{" "}
              <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                {authMethodLabel(lastMethod)}
              </span>
              .
            </span>
          </div>
        )}
        <form onSubmit={handleLogin} className="space-y-3.5">
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
                placeholder="you@example.com"
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
                placeholder="••••••••"
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
          </div>
          <div className="flex items-center justify-between">
            <Link
              to="/forgot-password"
              className="text-ds-11 font-sans tracking-wide hover:opacity-70 active:opacity-50 transition-opacity"
              style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Forgot password?
            </Link>
          </div>
          <Button
            variant="bark"
            type="submit"
            className="w-full rounded-ds-md"
            size="lg"
            disabled={loading}
          >
            {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Signing in…</> : "Sign in"}
          </Button>
        </form>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1" style={{ backgroundColor: "hsl(var(--olivewood) / 0.14)" }} />
          <span
            className="text-ds-11 tracking-[0.2em] uppercase font-serif italic"
            style={{ color: "hsl(var(--burnt-sienna) / 0.7)" }}
          >
            or
          </span>
          <span className="h-px flex-1" style={{ backgroundColor: "hsl(var(--olivewood) / 0.14)" }} />
        </div>

        <SocialAuthButtons mode="signin" />

        <div className="space-y-1.5 pt-1">
          <p className="text-center text-ds-11 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            New to Helpr?{" "}
            <Link
              to="/signup"
              className="font-semibold hover:underline"
              style={{ color: "hsl(var(--bark))" }}
            >
              Create an account
            </Link>
          </p>
          <p className="text-center text-ds-11 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Signing up a business?{" "}
            <Link
              to="/signup?type=business"
              className="font-semibold hover:underline"
              style={{ color: "hsl(var(--bark))" }}
            >
              Business sign-up
            </Link>
            <br />
            <span style={{ color: "hsl(var(--olivewood) / 0.65)" }}>
              Invite your team &amp; bill jobs to one card.
            </span>
          </p>
        </div>
        </>
        )}
      </div>

      <p className="text-center text-ds-11 font-sans leading-relaxed px-2 mt-2.5" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
        By signing in you agree to our{" "}
        <Link to="/terms" className="underline hover:opacity-80 active:opacity-60 transition-opacity">Terms</Link>
        {" · "}
        <Link to="/rules" className="underline hover:opacity-80 active:opacity-60 transition-opacity">Rules</Link>
        {" · "}
        <Link to="/privacy" className="underline hover:opacity-80 active:opacity-60 transition-opacity">Privacy Policy</Link>
      </p>

      <div className="mt-2">
        <BuildStamp />
      </div>
    </AuthShell>
  );
};

export default Login;
