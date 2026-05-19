import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { getPublicResetPasswordUrl } from "@/lib/authRedirects";
import { toast } from "sonner";
import { ArrowLeft, Mail, Loader2 } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import { usePageTitle } from "@/hooks/usePageTitle";
import { hapticMedium, hapticSuccess, hapticError } from "@/lib/haptics";

const RESEND_COOLDOWN_S = 60;

const ForgotPassword = () => {
  usePageTitle("Reset Password — Helpr");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  // Resend cooldown — counts down from 60s after each send so users can
  // re-trigger the email without spam-clicking but also know how long to
  // wait. Supabase rate-limits server-side anyway; this is just the UX.
  const [resendCooldown, setResendCooldown] = useState(0);

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
    <AuthShell eyebrow="Reset your password" maxWidth="sm">
      <div className="liquid-glass p-6 sm:p-8 space-y-6">
        {sent ? (
          <div className="text-center space-y-4">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
              style={{ background: "hsl(var(--burnt-sienna) / 0.12)" }}
            >
              <Mail className="w-7 h-7" style={{ color: "hsl(var(--burnt-sienna))" }} strokeWidth={1.5} />
            </div>
            <h1 className="text-page-title leading-tight">
              Check your inbox.
            </h1>
            <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
              We sent a reset link to{" "}
              <span className="font-semibold not-italic" style={{ color: "hsl(var(--olivewood))" }}>
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
                className="w-full rounded-ds-md"
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
              <span className="text-display-eyebrow">Forgot password</span>
              <h1 className="text-page-title leading-tight mt-2">
                We'll send you a link.
              </h1>
              <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
                Enter the email tied to your account and check your inbox.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-ds-13 font-sans font-medium">Email address</Label>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  className="rounded-ds-md bg-white/60 dark:bg-white/5 border-white/70 dark:border-white/15"
                />
              </div>
              <Button
                variant="bark"
                type="submit"
                className="w-full rounded-ds-md"
                size="lg"
                disabled={loading}
              >
                {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending…</> : "Send reset link"}
              </Button>
            </form>
          </>
        )}

        <p className="text-center text-ds-11 pt-1" style={{ color: "hsl(var(--olivewood) / 0.7)" }}>
          <Link
            to="/login"
            className="font-semibold hover:underline inline-flex items-center gap-1"
            style={{ color: "hsl(var(--bark))" }}
          >
            <ArrowLeft className="w-3 h-3" /> Back to sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
};

export default ForgotPassword;
