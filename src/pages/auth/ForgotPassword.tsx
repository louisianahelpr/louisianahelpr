import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { getPublicResetPasswordUrl } from "@/lib/authRedirects";
import { toast } from "sonner";
import { Mail, Loader2, Check, X } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import { AuthCardHead } from "@/components/auth/AuthCardHead";
import { TurnstileField, type TurnstileHandle } from "@/components/auth/TurnstileField";
import { isCaptchaError } from "@/lib/turnstile";
import { runWithCaptcha } from "@/hooks/useCaptcha";
import { recognizedAuthError } from "@/lib/authErrors";
import { usePageMeta } from "@/hooks/usePageMeta";
import { NOINDEX_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";
import { report as reportError } from "@/lib/errorLogger";

const RESEND_COOLDOWN_S = 60;

const ForgotPassword = () => {
  // Tab title tracks the h1 verbatim. The screen used to carry three nouns for
  // one thing — h1 "Password Reset", tab "Reset Your Password", and the link
  // that gets you here "Forgot Password?" — so the browser tab named a page the
  // page did not call itself. "Reset Password" is the settled noun for both
  // (owner, V4); the sign-in link keeps "Forgot Password?" because it describes
  // the user's SITUATION, not this page's title.
  // Q401a: the same table api/share.ts serves pre-JS (src/lib/publicPageMeta.mjs), noindex included.
  usePageMeta(NOINDEX_PAGE_META["/forgot-password"]);
  // The address typed on /login comes along in router state (A3-C12).
  const carried = (useLocation().state as { email?: unknown } | null)?.email;
  const [email, setEmail] = useState(typeof carried === "string" ? carried : "");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  // Resend cooldown — counts down from 60s after each send so users can
  // re-trigger the email without spam-clicking but also know how long to
  // wait. Supabase rate-limits server-side anyway; this is just the UX.
  const [resendCooldown, setResendCooldown] = useState(0);
  const [showEmailError, setShowEmailError] = useState(false);
  // Focused when a submit is rejected — the error line alone is easy to miss
  // on a one-field form, and putting the caret back in the field is the
  // shortest path to fixing it. Same move SignupStep1's handleContinue makes.
  const emailRef = useRef<HTMLInputElement>(null);
  const turnstileRef = useRef<TurnstileHandle>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = window.setTimeout(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [resendCooldown]);

  // Anti-enumeration: this screen MUST behave identically whether the
  // address is registered or not. Leaking "no user with that email" hands
  // an attacker a free user-existence oracle. We surface only rate-limit
  // responses (a useful "slow down" signal) inline; every other error —
  // including a "user not found" path — is silently treated as success
  // so the screen doesn't reveal registration state.
  const performSend = async () => {
    hapticMedium();
    setLoading(true);
    // Never held on the security box unless the server refuses (A3-B1);
    // runWithCaptcha re-arms the single-use token for the resend.
    const { error } = await runWithCaptcha(turnstileRef.current, (captchaToken) =>
      supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: getPublicResetPasswordUrl(),
        captchaToken,
      }));
    setLoading(false);
    if (error) {
      // A refused security check (Q1314) must NOT take the neutral "check your
      // inbox" path below: nothing was sent, and saying so reveals nothing
      // about whether the address has an account.
      if (isCaptchaError(error.message)) {
        hapticError();
        toast.error(recognizedAuthError(error.message) ?? "The security check didn't finish. Try again.");
        return false;
      }
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("rate") || msg.includes("limit") || msg.includes("too many")) {
        hapticError();
        toast.error("Too many requests — try again in a minute.");
        return false;
      }
      // Fall through: success-shaped UX even on error.
      //
      // But NOT silence. The neutral UX above is right — telling the user "no
      // account with that email" is a free user-existence oracle — and it is
      // also the only place in this flow where a real failure could surface.
      // Before this report() the screen was indistinguishable in BOTH
      // directions: a user whose reset genuinely never sent saw "Check your
      // inbox", and so did we. A password reset that silently doesn't send is
      // the single worst failure this screen has, because the user's only
      // recourse — press the button again — reproduces it exactly.
      //
      // Anti-enumeration is about what we tell the USER, not about what we
      // tell ourselves. This keeps the user-facing behaviour byte-identical
      // and gives operators the one signal they had no way to get. The email
      // is deliberately NOT included in the payload — that would recreate the
      // oracle inside the monitoring tool.
      // errorLogger, NOT `@/lib/sentry` directly. A static `@/lib/sentry`
      // import here pulled all of @sentry/react into the shared chunk, which
      // defeated main.tsx's deliberate `import("./lib/sentry")` deferral —
      // the one its own comment says was costing ~4s of FCP on slow
      // connections. errorLogger fans out to Sentry and PostHog behind a
      // dynamic import for exactly this reason (see its comment above
      // `fanOutToObservability`), and also writes the `error_logs` row, so
      // this reports strictly MORE than the direct call did.
      reportError(error, {
        severity: "error",
        tags: { area: "auth", flow: "password-reset-request" },
        context: {
          note: "resetPasswordForEmail failed; user was shown the neutral success state",
        },
      });
    }
    hapticSuccess();
    setResendCooldown(RESEND_COOLDOWN_S);
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return;
    if (!emailValid) {
      setShowEmailError(true);
      hapticError();
      emailRef.current?.focus();
      return;
    }
    const ok = await performSend();
    if (ok) {
      setSent(true);
      // Neutral copy — doesn't confirm the email exists ("If that email
      // is registered, we've sent…") so the screen reads identically for
      // non-existent addresses too.
    }
  };

  const handleResend = async () => {
    if (loading || resendCooldown > 0) return;
    await performSend();
  };

  // ONE auth shell (owner, V4): Login's exact prop set — `noWebChrome` (no
  // nav, no footer) and `centerColumn` (centred column + ambient wash), no
  // desktopBrandPanel (it drew a second, pinned chevron at lg+).
  //
  // The way back to /login (owner: "yes the back button belongs here") is now
  // the "Back to log in" link at the card's foot, and the email-sent step
  // keeps its X inside the card's top-right corner (owner: "delete title
  // here and put the x in the box").
  return (
    // Spec v2 rebuild (audit 2026-10-21): the same centered card as /login —
    // H mark, one sentence-case heading, the field, then "Back to log in" as a
    // text link at the foot (/login's own card has no back arrow either).
    <AuthShell hideHeader hideBack centerColumn maxWidth="sm" noWebChrome>
      <div className="relative liquid-glass p-5 sm:p-6 lg:p-8 space-y-6">
        {sent && (
          <Link
            to="/"
            aria-label="Close"
            className="absolute top-3 right-3 z-10 w-11 h-11 rounded-full flex items-center justify-center transition-colors active:scale-[0.94] hover:bg-[hsl(var(--olivewood)/0.08)]"
            style={{ color: "hsl(var(--olivewood))" }}
          >
            <X className="w-4 h-4" strokeWidth={2.25} />
          </Link>
        )}
        <AuthCardHead
          testId="forgot-card-head"
          title={sent ? "Check your inbox" : "Reset your password"}
          sub={sent ? undefined : "We'll email you a link to set a new one."}
        />
        {sent ? (
          <div className="text-center space-y-4">
            {/* Neutral confirmation copy — leaks no signal about whether
                the address is registered (see performSend comment). */}
            <p className="font-sans text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              If{" "}
              <span className="font-semibold" style={{ color: "hsl(var(--olivewood))" }}>
                {email}
              </span>
              {" "}is registered, we've sent a reset link. It expires in 1 hour.
            </p>
            <p className="text-ds-11 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Don't see it? Check your spam folder or wait a minute — emails can take a moment to arrive.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="flex-1 rounded-full"
                onClick={() => setSent(false)}
              >
                Use another email
              </Button>
              <Button
                variant="primary"
                type="button"
                className="flex-1 rounded-full"
                onClick={handleResend}
                disabled={loading || resendCooldown > 0}
                style={{ opacity: resendCooldown > 0 ? 0.6 : 1 }}
              >
                {loading
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
                  : resendCooldown > 0
                    ? `Resend in ${resendCooldown}s`
                    : "Resend email"}
              </Button>
            </div>
          </div>
        ) : (
            <form
              onSubmit={handleSubmit}
              // `required` + type="email" stay on the input for semantics, but
              // the browser's own validation bubble would intercept the submit
              // and replace our inline message with a native tooltip — so the
              // "name what's missing" path below could never run. React owns
              // the validation on this form.
              noValidate
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="email" className="text-ds-13 font-sans font-medium">Email</Label>
                <div className="relative">
                  <Mail
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
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
                        value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (showEmailError) setShowEmailError(false);
                    }}
                    required
                    autoComplete="email"
                    aria-invalid={showEmailError}
                    aria-describedby={showEmailError ? "fp-email-error" : undefined}
                    className={`pl-10 pr-10 rounded-ds-md bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)] placeholder:text-[hsl(var(--olivewood)/0.8)] ${showEmailError ? "!border-destructive focus-visible:!border-destructive" : ""}`}
                  />
                  {emailValid && (
                    <Check
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                  )}
                </div>
                {/* text-destructive-ink + the X glyph, matching SignupStep1 and
                    ResetPassword's "Passwords don't match" line. This was the
                    one auth error message painted in burnt-sienna with no
                    icon — the same colour the screen uses for decorative
                    eyebrows and the Mail badge, so it did not read as an
                    error at all. */}
                {showEmailError && (
                  <p id="fp-email-error" role="alert" className="inline-flex items-center gap-1 text-ds-11 text-[hsl(var(--destructive-ink))]">
                    <X className="w-3.5 h-3.5" strokeWidth={2.5} aria-hidden />
                    {/* Two messages, not one. An untouched field and a
                        malformed address are different problems, and "Enter a
                        valid email address" on an EMPTY field reads as an
                        accusation about something the user never typed. Same
                        split SignupStep1 uses. */}
                    {email.trim() ? "Enter a valid email address." : "Add your email address."}
                  </p>
                )}
              </div>
              <Button
                variant="primary"
                type="submit"
                className="w-full rounded-full"
                size="lg"
                // Loading-only disable (owner, V5). It used to also disable on
                // `!emailValid`, which made the inline error above unreachable
                // — the button the user would have tapped to find out what was
                // wrong was the thing being withheld until they'd already
                // fixed it. Now tapping empty runs handleSubmit, which names
                // the missing field and returns WITHOUT calling
                // resetPasswordForEmail (so the 60s resend cooldown still arms
                // only on a real attempt).
                disabled={loading}
              >
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : "Send reset link"}
              </Button>
            </form>
        )}
        {/* Turnstile for resetPasswordForEmail (Q1314), mounted in BOTH states
            so the "sent" screen's resend carries a token too. */}
        <TurnstileField ref={turnstileRef} action="password_reset" />
        <p className="text-center text-ds-13 text-muted-foreground">
          Remembered it?{" "}
          <Link to="/login" className="font-bold" style={{ color: "hsl(var(--bark))" }}>
            Back to log in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
};

export default ForgotPassword;
