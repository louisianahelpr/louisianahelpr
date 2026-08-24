import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { getPublicResetPasswordUrl } from "@/lib/authRedirects";
import { toast } from "sonner";
import { Mail, Loader2, Check, X } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import { usePageMeta } from "@/hooks/usePageMeta";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";

const RESEND_COOLDOWN_S = 60;

const ForgotPassword = () => {
  // Tab title tracks the h1 verbatim. The screen used to carry three nouns for
  // one thing — h1 "Password Reset", tab "Reset Your Password", and the link
  // that gets you here "Forgot Password?" — so the browser tab named a page the
  // page did not call itself. "Reset Password" is the settled noun for both
  // (owner, V4); the sign-in link keeps "Forgot Password?" because it describes
  // the user's SITUATION, not this page's title.
  usePageMeta({
    title: "Reset Password — Helpr",
    description: "Forgot your Helpr password? Enter your email and we'll send you a reset link.",
    canonical: "https://www.louisianahelpr.com/forgot-password",
    ogTitle: "Reset Password — Helpr",
    ogDescription: "Recover access to your Helpr account with a one-time password reset email.",
  });
  const [email, setEmail] = useState("");
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
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getPublicResetPasswordUrl(),
    });
    setLoading(false);
    if (error) {
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("rate") || msg.includes("limit") || msg.includes("too many")) {
        hapticError();
        toast.error("Too many requests — try again in a minute.");
        return false;
      }
      // Fall through: success-shaped UX even on error.
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

  // ONE auth shell (owner, V4). This screen used to carry the marketing
  // Navbar + Footer and a desktopBrandPanel while /login and /signup were
  // chrome-less focused flows — two different shells across four screens of
  // one funnel. It now takes Login's exact prop set: `noWebChrome` (no nav,
  // no footer), `centerColumn` (centred column + the ambient brand wash that
  // used to be coupled to the brand pane), and the shell's canonical
  // `[back] [title]` row.
  //
  // Dropping `desktopBrandPanel` is also what kills the DOUBLE BACK ARROW:
  // that prop rendered a second, pinned top-left chevron at lg+ ALONGSIDE the
  // title row's chevron — the stacked-arrow defect AuthShell's own comments
  // warn against. AuthShell now guards that branch with `!title` too, so the
  // row is the single owner of the control no matter what a caller passes.
  //
  // maxWidth="sm" stays: page-measure exists for Login's TWO-column layout;
  // on this single-column form it stretched the email field ~1900px
  // edge-to-edge at 1440.
  return (
    <AuthShell hideHeader backTo="/login" centerColumn maxWidth="sm" title="Reset Password" noWebChrome>
      <div className="liquid-glass p-5 sm:p-6 lg:p-10 space-y-6">
        {sent ? (
          <div className="text-center space-y-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
              style={{ background: "hsl(var(--burnt-sienna) / 0.12)" }}
            >
              <Mail className="w-7 h-7" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={1.5} />
            </div>
            {/* h2, not h1. The shell's `title` row renders "Reset Password"
                as the page h1 in BOTH states, so this confirmation heading is
                a section heading under it. It was an h1 back when the title
                row lived inside the `!sent` branch and disappeared here —
                lifting the row into AuthShell made the page briefly carry two. */}
            <h2 className="text-page-title leading-tight truncate">
              Check your inbox.
            </h2>
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
            <div className="space-y-2">
              <Button
                variant="primary"
                type="button"
                className="w-full rounded-ds-md"
                onClick={handleResend}
                disabled={loading || resendCooldown > 0}
                style={{ opacity: resendCooldown > 0 ? 0.6 : 1 }}
              >
                {loading
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</>
                  : resendCooldown > 0
                    ? `Resend in ${resendCooldown}s`
                    : "Resend Email"}
              </Button>
              <Button
                variant="outline"
                className="w-full rounded-ds-md"
                onClick={() => setSent(false)}
              >
                Use a Different Email
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
                {/* text-destructive + the X glyph, matching SignupStep1 and
                    ResetPassword's "Passwords don't match" line. This was the
                    one auth error message painted in burnt-sienna with no
                    icon — the same colour the screen uses for decorative
                    eyebrows and the Mail badge, so it did not read as an
                    error at all. */}
                {showEmailError && (
                  <p id="fp-email-error" role="alert" className="inline-flex items-center gap-1 text-ds-11 text-destructive">
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
                className="w-full rounded-ds-md"
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
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : "Send Reset Link"}
              </Button>
            </form>
        )}
      </div>
    </AuthShell>
  );
};

export default ForgotPassword;
