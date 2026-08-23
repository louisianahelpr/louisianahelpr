import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { getPublicResetPasswordUrl } from "@/lib/authRedirects";
import { toast } from "sonner";
import { Mail, Loader2, Check } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import { AuthBrandPane } from "@/components/auth/AuthBrandPane";
import HelprMark from "@/components/HelprMark";
import { usePageMeta } from "@/hooks/usePageMeta";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";

const RESEND_COOLDOWN_S = 60;

const ForgotPassword = () => {
  usePageMeta({
    title: "Reset Your Password — Helpr",
    description: "Forgot your Helpr password? Enter your email and we'll send you a reset link.",
    canonical: "https://www.louisianahelpr.com/forgot-password",
    ogTitle: "Reset Your Password — Helpr",
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
      return;
    }
    const ok = await performSend();
    if (ok) {
      setSent(true);
      // Neutral copy — doesn't confirm the email exists ("If that email
      // is registered, we've sent…") so the screen reads identically for
      // non-existent addresses too.
      toast.success("If that email is registered, we've sent a reset link.");
    }
  };

  const handleResend = async () => {
    if (loading || resendCooldown > 0) return;
    const ok = await performSend();
    if (ok) toast.success("If that email is registered, we've sent another link.");
  };

  return (
    <AuthShell hideHeader backTo="/login" centerColumn maxWidth="2xl" title="Password Reset">
      <div className="liquid-glass p-5 sm:p-6 lg:p-10 space-y-6">
        {sent ? (
          <div className="text-center space-y-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
              style={{ background: "hsl(var(--burnt-sienna) / 0.12)" }}
            >
              <Mail className="w-7 h-7" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={1.5} />
            </div>
            {/* h2, not h1. The shell's `title` row renders "Password reset"
                as the page h1 in BOTH states, so this confirmation heading is
                a section heading under it. It was an h1 back when the title
                row lived inside the `!sent` branch and disappeared here —
                lifting the row into AuthShell made the page briefly carry two. */}
            <h2 className="text-page-title leading-tight">
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
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-ds-13 font-sans font-medium">Email</Label>
                <div className="relative">
                  <Mail
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
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
                        value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (showEmailError) setShowEmailError(false);
                    }}
                    required
                    autoComplete="email"
                    aria-invalid={showEmailError}
                    className="pl-10 pr-10 rounded-ds-md bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)] placeholder:text-[hsl(var(--olivewood)/0.8)]"
                  />
                  {emailValid && (
                    <Check
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none"
                      strokeWidth={2.5}
                      aria-hidden
                    />
                  )}
                </div>
                {showEmailError && (
                  <p className="text-ds-11 font-sans" style={{ color: "hsl(var(--burnt-sienna))" }}>
                    Enter a valid email address.
                  </p>
                )}
              </div>
              <Button
                variant="primary"
                type="submit"
                className="w-full rounded-ds-md"
                size="lg"
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
