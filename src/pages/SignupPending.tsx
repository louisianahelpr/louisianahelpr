import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { MailCheck, LogIn, Sparkles, Loader2, Check, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import AuthShell from "@/components/auth/AuthShell";
import BackButton from "@/components/BackButton";
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
    /* Same shell as Login and Signup: heading INSIDE the card on a
       [back] [title] row, wide centred column, no wordmark/eyebrow block
       above it. This screen used to be the odd one out — a 448px card
       under a big Helpr·LA lockup, in a flow whose other two screens are
       1024px cards with their own headings. */
    <AuthShell hideHeader hideBack centerColumn maxWidth="2xl">
      <div className="liquid-glass p-5 sm:p-6 lg:p-10 space-y-6">
        <div className="flex items-center gap-3">
          {/* Home, not /signup. The account already EXISTS by the time this
              screen renders — sending the arrow back to the signup form
              invites a duplicate attempt on an address that is already
              registered. The wrong-address case has its own explicit
              "Start over" link inside the resend panel. */}
          <div className="shrink-0"><BackButton to="/" /></div>
          <h1
            className="font-display italic font-bold leading-tight min-w-0 flex-1"
            style={{
              fontSize: "clamp(1.6rem, 2.4vw + 0.5rem, 2.1rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.03em",
            }}
          >
            Check your inbox
          </h1>
        </div>
        <p className="text-ds-13 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          We've sent a verification link to your email. Click it to confirm your account.
        </p>

        <div className="border-t pt-6 grid gap-4 sm:grid-cols-3 text-left" style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}>
          <div className="flex items-start gap-3 sm:flex-col sm:gap-2">
            {stepIcon(MailCheck)}
            <div>
              <p className="text-ds-13 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Verify your email</p>
              <p className="text-ds-11 font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Click the link in your inbox to confirm your email address.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 sm:flex-col sm:gap-2">
            {stepIcon(LogIn)}
            <div>
              <p className="text-ds-13 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>We'll sign you in</p>
              <p className="text-ds-11 font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Keep this page open — the moment you confirm, we take you straight in. No need to log back in.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 sm:flex-col sm:gap-2">
            {stepIcon(Sparkles)}
            <div>
              <p className="text-ds-13 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Start right away</p>
              <p className="text-ds-11 font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                You're all set — post and accept jobs the moment you're in.
              </p>
            </div>
          </div>
        </div>

        {/* Resend on the left, "already verified" on the right — one row of
            escape hatches instead of two stacked lines, which also stops the
            sign-in link reading as a footer detached from the card. */}
        {/* Collapsed, the two links pair on one row. EXPANDED, the resend
            form needs the full width — pairing then left the form in half
            the card with the sign-in link stranded in the empty half. */}
        <div
          className={`border-t pt-4 ${showResend ? "space-y-4" : "flex items-center justify-between gap-4 flex-wrap"}`}
          style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}
        >
          <div className={showResend ? "" : "min-w-0"}>
          {!showResend ? (
            /* Same shape as "Already verified? Sign in" — a plain sentence
               whose last word is the control. The icon + all-bark-text
               version read as a different class of thing sitting opposite
               its own twin. */
            <p className="text-ds-13 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Didn't receive the email?{" "}
              <button
                type="button"
                onClick={() => setShowResend(true)}
                className="font-semibold hover:underline"
                style={{ color: "hsl(var(--bark))" }}
              >
                Resend
              </button>
            </p>
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
          <p className={`text-ds-13 font-sans shrink-0${showResend ? " text-right" : ""}`} style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            Already verified?{" "}
            <Link to="/login" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </AuthShell>
  );
};

export default SignupPending;
