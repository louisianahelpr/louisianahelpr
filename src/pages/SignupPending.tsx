import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { MailCheck, LogIn, Sparkles, Loader2, RefreshCw, Check, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import AuthShell from "@/components/auth/AuthShell";
import { friendlyAuthError } from "@/lib/authErrors";

// How long to disable the resend button after each send. Supabase's own
// rate limit is at least this strict on the server; this just sets user
// expectations so they don't spam-tap and burn through the server cap.
const RESEND_COOLDOWN_S = 60;
// How often we poll the auth state for an email-arrived check. 5s
// matches the brief and is gentle enough that an inbox tab open in the
// background doesn't burn battery.
const VERIFY_POLL_INTERVAL_MS = 5000;

const SignupPending = () => {
  const location = useLocation();
  const navigate = useNavigate();
  // Prefill the email from router state if Signup passed it via navigate()
  const prefillEmail: string = (location.state as { email?: string } | null)?.email ?? "";
  const [resending, setResending] = useState(false);
  const [email, setEmail] = useState(prefillEmail);
  const [showResend, setShowResend] = useState(false);
  // Counts down 60s after each successful resend so the button doesn't
  // re-enable until Supabase's server-side rate limit has also rolled
  // over. Displayed inline as "Resend in 47s…".
  const [resendCooldown, setResendCooldown] = useState(0);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  // Live email-arrived check — once the user taps the verification link
  // in their inbox, supabase.auth.getSession() starts returning a
  // confirmed session. Polling every 5s lets us auto-advance the moment
  // that flips, so the user doesn't have to come back and tap a button.
  useEffect(() => {
    let cancelled = false;
    const advanceIfVerified = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (cancelled || error) return;
      const sessionUser = data.session?.user;
      if (sessionUser?.email_confirmed_at) {
        toast.success("Email verified — taking you in.");
        navigate("/complete-profile", { replace: true });
      }
    };
    void advanceIfVerified();
    const interval = window.setInterval(advanceIfVerified, VERIFY_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [navigate]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = window.setTimeout(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearTimeout(t);
  }, [resendCooldown]);

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    if (!email.trim()) {
      toast.error("Please enter your email address");
      return;
    }
    setResending(true);
    const { error } = await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
    });
    setResending(false);
    if (error) {
      toast.error(friendlyAuthError(error.message));
    } else {
      toast.success("Verification email resent! Check your inbox.");
      setResendCooldown(RESEND_COOLDOWN_S);
    }
  };

  const stepIcon = (Icon: typeof MailCheck) => (
    <div
      className="w-9 h-9 rounded-ds-md flex items-center justify-center flex-shrink-0 mt-0.5"
      style={{ background: "hsl(var(--bark) / 0.1)" }}
    >
      <Icon className="w-4 h-4" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
    </div>
  );

  return (
    <AuthShell eyebrow="Almost there" maxWidth="md">
      <div className="liquid-glass p-7 sm:p-8 space-y-6 text-center">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
          style={{ background: "hsl(var(--bark) / 0.1)" }}
        >
          <MailCheck className="w-8 h-8" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.5} />
        </div>

        <div className="space-y-2">
          <span className="text-display-eyebrow">Verify your email</span>
          <h1 className="text-page-title leading-tight mt-1">
            Check your inbox.
          </h1>
          <p className="font-serif italic text-ds-13" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            We've sent a verification link to your email. Click it to confirm your account.
          </p>
        </div>

        <div className="border-t pt-6 space-y-4 text-left" style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}>
          <div className="flex items-start gap-3">
            {stepIcon(MailCheck)}
            <div>
              <p className="text-ds-13 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Verify your email</p>
              <p className="text-ds-11 font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Click the link in your inbox to confirm your email address.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            {stepIcon(LogIn)}
            <div>
              <p className="text-ds-13 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>We'll sign you in</p>
              <p className="text-ds-11 font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Keep this page open — the moment you confirm, we take you straight in. No need to log back in.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            {stepIcon(Sparkles)}
            <div>
              <p className="text-ds-13 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Start right away</p>
              <p className="text-ds-11 font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                You're all set — post and accept jobs the moment you're in.
              </p>
            </div>
          </div>
        </div>

        <div className="border-t pt-4" style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}>
          {!showResend ? (
            <button
              onClick={() => setShowResend(true)}
              className="text-ds-13 font-medium hover:underline flex items-center gap-1.5 mx-auto"
              style={{ color: "hsl(var(--bark))" }}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Didn't receive the email?
            </button>
          ) : (
            <div className="space-y-3">
              <p className="text-ds-11 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                {prefillEmail ? "Confirm your email to resend the verification link:" : "Enter your email to resend the verification link:"}
              </p>
              <div className="relative">
                <Input
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="email"
                  aria-label="Your email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={`${emailValid ? "pr-10" : ""} rounded-ds-md bg-white/60 dark:bg-white/5 border-[hsl(var(--bark)/0.28)] dark:border-white/15 shadow-[inset_0_1px_2px_hsl(var(--ink-deep)/0.05)] placeholder:text-[hsl(var(--olivewood)/0.8)]`}
                />
                {emailValid && (
                  <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary pointer-events-none" strokeWidth={2.5} aria-hidden />
                )}
              </div>
              <Button
                variant="bark"
                onClick={handleResend}
                disabled={resending || resendCooldown > 0}
                size="sm"
                className="w-full rounded-ds-md"
                style={{ opacity: resendCooldown > 0 ? 0.7 : 1 }}
              >
                {resending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Resending…</>
                  : resendCooldown > 0
                    ? `Resend in ${resendCooldown}s…`
                    : "Resend verification email"}
              </Button>
              {/* Wrong-address escape hatch — sends the user back to the
                  signup form to re-enter the email, which is the only
                  practical fix when the auth row was created against a
                  typo address. Sits below resend so it isn't the first
                  option a user reaches for, but is reachable when needed. */}
              <Link
                to="/signup"
                className="block text-center text-ds-11 font-sans hover:underline pt-1 inline-flex items-center justify-center gap-1"
                style={{ color: "hsl(var(--olivewood) / 0.8)" }}
              >
                <ArrowLeft className="w-4 h-4" aria-hidden /> Wrong address? Start over
              </Link>
            </div>
          )}
        </div>
      </div>

      <p className="text-center text-ds-11 font-sans pt-5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        Already verified?{" "}
        <Link to="/login" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
};

export default SignupPending;
