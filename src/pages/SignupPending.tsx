import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { MailCheck, LogIn, Sparkles, Loader2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import AuthShell from "@/components/auth/AuthShell";
import BackButton from "@/components/BackButton";

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
    // Anti-enumeration, and honest about it. This screen MUST behave the
    // same whether or not the address has an unverified account, otherwise
    // it becomes a free "does this person use Helpr?" oracle. Only the
    // rate-limit case (a useful "slow down") is surfaced as a failure;
    // "user not found" is deliberately reported as success-shaped.
    //
    // The neutral copy also fixes a dead end: an address the user never
    // signed up with previously produced a confident "resent! check your
    // inbox" for an email that was never going to arrive.
    if (error) {
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("rate") || msg.includes("limit") || msg.includes("too many")) {
        toast.error("Too many requests — try again in a minute.");
        return;
      }
      // Fall through: success-shaped UX on every other error.
    }
    toast.success(`If ${email.trim()} has an unverified account, a new link is on its way.`);
    setResendCooldown(RESEND_COOLDOWN_S);
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
        {/* Name the ADDRESS. It's the one fact this screen exists to
            convey — how someone catches "jane@gmial.com" without opening
            the resend panel to look. Falls back to the generic sentence on
            a cold load, where router state carries no email. */}
        <p className="text-ds-13 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          We've sent a verification link to{" "}
          {prefillEmail
            ? <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>{prefillEmail}</span>
            : "your email"}
          . Click it to confirm your account.
        </p>

        <div className="border-t pt-6 grid gap-4 sm:grid-cols-3 text-left" style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}>
          <div className="flex items-start gap-3 sm:flex-col sm:gap-2">
            {stepIcon(MailCheck)}
            <div>
              <p className="text-ds-13 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Verify your email</p>
              <p className="text-ds-13 font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Click the link in your inbox to confirm your email address.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 sm:flex-col sm:gap-2">
            {stepIcon(LogIn)}
            <div>
              <p className="text-ds-13 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>We'll sign you in</p>
              <p className="text-ds-13 font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Keep this page open — the moment you confirm in this browser, we take you straight in. Confirmed on your phone? Sign in below.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3 sm:flex-col sm:gap-2">
            {stepIcon(Sparkles)}
            <div>
              <p className="text-ds-13 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Start right away</p>
              <p className="text-ds-13 font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
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
          className="border-t pt-4 space-y-4"
          style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}
        >
          {showResend && (
            <div className="space-y-3">
              {/* Label + a way OUT of the panel — opening it is one tap and
                  was previously a one-way door: nothing here closed it again. */}
              <div className="flex items-center justify-between gap-3">
                <p className="text-ds-13 font-sans" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                  {prefillEmail ? "Confirm your email to resend the verification link:" : "Enter your email to resend the verification link:"}
                </p>
                <button
                  type="button"
                  onClick={() => setShowResend(false)}
                  aria-label="Close resend form"
                  className="shrink-0 w-8 h-8 -mr-1 rounded-full flex items-center justify-center transition-colors hover:bg-[hsl(var(--olivewood)/0.08)]"
                  style={{ color: "hsl(var(--olivewood) / 0.8)" }}
                >
                  <X className="w-4 h-4" strokeWidth={2} />
                </button>
              </div>
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
            </div>
          )}
          {/* All three escape hatches on ONE line. The resend trigger joins
              them when collapsed and is replaced by its own panel above when
              open, so the row never changes position. */}
          <div className="flex items-center justify-between gap-3">
            {!showResend && (
              <p className="text-ds-13 font-sans shrink-0" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Didn't get it?{" "}
                <button
                  type="button"
                  onClick={() => setShowResend(true)}
                  /* min-h-0/h-auto: the global 44px tap-target rule makes
                     this inline button's PARAGRAPH 44px tall, so items-center
                     centred a 44px box against two 19px ones and the text sat
                     13px high. It reads as body copy here, not a tap target —
                     the whole sentence row is comfortably reachable. The !
                     is required: the global rule is
                     `button:not([role=checkbox]):not([role=radio]):not([role=switch])`,
                     whose three :not() args outrank a plain utility class.
                     WCAG 2.5.8 exempts controls inline in a sentence, which
                     is exactly what this is (same as the <a>s beside it). */
                  className="font-semibold hover:underline align-baseline !min-h-0 !h-auto"
                  style={{ color: "hsl(var(--bark))" }}
                >
                  Resend
                </button>
              </p>
            )}
            {/* Wrong-address escape hatch — re-entering the address is the
                only practical fix once the auth row exists against a typo. */}
            <p className="text-ds-13 font-sans shrink-0" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Wrong address?{" "}
              <Link to="/signup" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>
                Start over
              </Link>
            </p>
            <p className="text-ds-13 font-sans shrink-0" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Verified?{" "}
              <Link to="/login" className="font-semibold hover:underline" style={{ color: "hsl(var(--bark))" }}>
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </AuthShell>
  );
};

export default SignupPending;
