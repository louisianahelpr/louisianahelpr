import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { getPublicResetPasswordUrl } from "@/lib/authRedirects";
import { toast } from "sonner";
import { Mail, Loader2, CheckCircle2 } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
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

  const performSend = async () => {
    hapticMedium();
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getPublicResetPasswordUrl(),
    });
    setLoading(false);
    if (error) {
      hapticError();
      toast.error(error.message);
      return false;
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
      toast.success("Check your email for a reset link!");
    }
  };

  const handleResend = async () => {
    if (loading || resendCooldown > 0) return;
    const ok = await performSend();
    if (ok) toast.success("Sent again — check your inbox.");
  };

  return (
    <AuthShell hideHeader align="center" backTo="/login" backLabel="Back to sign in">
      <div className={`liquid-glass glass-paper-mesh relative p-6 sm:p-8 space-y-5 ${sent ? "" : "pt-12 sm:pt-14"}`}>
        {!sent && (
          <div className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
            <HelprMark to={null} size="lg" emblemOnly />
          </div>
        )}
        {sent ? (
          <div className="text-center space-y-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center mx-auto"
              style={{ background: "hsl(var(--burnt-sienna) / 0.12)" }}
            >
              <Mail className="w-7 h-7" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={1.5} />
            </div>
            <h1 className="text-page-title leading-tight">
              Check your inbox.
            </h1>
            <p className="font-sans text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              We sent a reset link to{" "}
              <span className="font-semibold" style={{ color: "hsl(var(--olivewood))" }}>
                {email}
              </span>
              . It expires in 1 hour.
            </p>
            <p className="text-ds-11 font-sans" style={{ color: "hsl(var(--olivewood) / 0.55)" }}>
              Don't see it? Check your spam folder or wait a minute — emails can take a moment to arrive.
            </p>
            <div className="space-y-2">
              <Button
                variant="bark"
                type="button"
                className="w-full rounded-ds-md border-[hsl(66_18%_34%)] shadow-[0_1px_2px_hsl(var(--ink-deep)/0.07),0_4px_10px_hsl(var(--ink-deep)/0.08)]"
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
              <Button
                variant="outline"
                className="w-full rounded-ds-md"
                onClick={() => setSent(false)}
              >
                Use a different email
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="text-center space-y-2">
              <h1 className="text-page-title leading-tight">
                We'll send you a link.
              </h1>
              <p className="font-sans text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.7)", letterSpacing: "0.01em" }}>
                Enter the email tied to your account and check your inbox.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-ds-13 font-sans font-medium">Email address</Label>
                <div className="relative">
                  <Mail
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
                    style={{ color: "hsl(var(--olivewood) / 0.5)" }}
                    strokeWidth={1.75}
                  />
                  <Input
                    id="email"
                    type="email"
                    inputMode="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (showEmailError) setShowEmailError(false);
                    }}
                    required
                    autoComplete="email"
                    aria-invalid={showEmailError}
                    className="pl-10 pr-10 rounded-ds-md bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)] placeholder:text-[hsl(var(--olivewood)/0.7)]"
                  />
                  {emailValid && (
                    <CheckCircle2
                      className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none"
                      style={{ color: "hsl(var(--bark))" }}
                      strokeWidth={2}
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
                variant="bark"
                type="submit"
                className="w-full rounded-ds-md border-[hsl(66_18%_34%)] shadow-[0_1px_2px_hsl(var(--ink-deep)/0.07),0_4px_10px_hsl(var(--ink-deep)/0.08)]"
                size="lg"
                disabled={loading}
              >
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : "Send reset link"}
              </Button>
            </form>
          </>
        )}
      </div>
    </AuthShell>
  );
};

export default ForgotPassword;
