import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { MailCheck, LogIn, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import AuthShell from "@/components/auth/AuthShell";
import { usePageTitle } from "@/hooks/usePageTitle";

// How long to disable the resend button after each send. Supabase's own
// rate limit is at least this strict on the server; this just sets user
// expectations so they don't spam-tap and burn through the server cap.
const RESEND_COOLDOWN_S = 60;
// How often we poll the auth state for an email-arrived check. 5s
// matches the brief and is gentle enough that an inbox tab open in the
// background doesn't burn battery.
const VERIFY_POLL_INTERVAL_MS = 5000;
// Survives a reload of this screen; cleared once verification lands.
const PENDING_EMAIL_KEY = "helpr.pendingSignupEmail";

const SignupPending = () => {
  // The only routed page that set no title. It therefore kept whatever the
  // tab already said — index.html's landing marketing title on a cold load,
  // or the previous route's title — so the tab, the history entry and any
  // bookmark all failed to name the page. That matters more here than on
  // most screens: this page explicitly tells you to leave it open and go
  // check your email, so the user comes back to a tab strip and has to pick
  // it out. It is also the moment a screen reader should announce where the
  // user landed after submitting the signup form.
  usePageTitle("Check your email — Helpr");

  const location = useLocation();
  const navigate = useNavigate();
  // The address arrives in router state (Signup does navigate(..., { state }))
  // which lives in the history entry and is LOST on reload — and "keep this
  // page open" makes reloading a very natural thing to do while waiting. Mirror
  // it into sessionStorage so a refresh, or coming back to the tab, still knows
  // who we're waiting on. sessionStorage (not local) so it dies with the tab
  // rather than lingering on a shared machine.
  const routerEmail: string = (location.state as { email?: string } | null)?.email ?? "";
  const [prefillEmail] = useState<string>(() => {
    if (routerEmail) {
      try { sessionStorage.setItem(PENDING_EMAIL_KEY, routerEmail); } catch { /* private mode */ }
      return routerEmail;
    }
    try { return sessionStorage.getItem(PENDING_EMAIL_KEY) ?? ""; } catch { return ""; }
  });
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  // Counts down 60s after each successful resend so the button doesn't
  // re-enable until Supabase's server-side rate limit has also rolled
  // over. Displayed inline as "Resend in 47s…".
  const [resendCooldown, setResendCooldown] = useState(0);

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
        try { sessionStorage.removeItem(PENDING_EMAIL_KEY); } catch { /* private mode */ }
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

  // One tap. The address is the one we're already telling the user about,
  // so asking them to re-type it into a form was ceremony around a value we
  // already had. Nothing to open, nothing to close.
  const handleResend = async () => {
    if (resendCooldown > 0 || resending || !prefillEmail) return;
    setResending(true);
    const { error } = await supabase.auth.resend({ type: "signup", email: prefillEmail });
    setResending(false);
    if (error) {
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("rate") || msg.includes("limit") || msg.includes("too many")) {
        toast.error("Too many requests — try again in a minute.");
        return;
      }
      // Fall through: this screen must not reveal whether an address has an
      // account, so every other failure reads as success (see ForgotPassword).
    }
    setResent(true);
    setResendCooldown(RESEND_COOLDOWN_S);
    toast.success("Verification link sent.");
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
    <AuthShell
      hideHeader
      centerColumn
      maxWidth="2xl"
      // Home, not /signup. The account already EXISTS by the time this screen
      // renders — sending the arrow back to the signup form invites a
      // duplicate attempt on an address that is already registered. The
      // wrong-address case has its own explicit "Start over" link inside the
      // resend panel.
      backTo="/"
      title="Check Your Inbox"
    >
      <div className="liquid-glass p-5 sm:p-6 lg:p-10 space-y-6">
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
        {/* One row at sm+, stacked on a phone — three sentences don't share
            327px, and side by side they ran off the edge. */}
        <div className="border-t pt-4 space-y-2 text-center sm:space-y-0 sm:text-left sm:flex sm:items-center sm:justify-between sm:gap-3" style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}>
          {prefillEmail && (
            <p className="text-ds-13 font-sans shrink-0" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
              Didn't get it?{" "}
              <button
                type="button"
                onClick={handleResend}
                disabled={resending || resendCooldown > 0}
                /* !min-h-0: the global tap-target rule
                   `button:not([role=checkbox]):not([role=radio]):not([role=switch])`
                   has three :not() args, so it outranks a plain utility class
                   and would leave this paragraph 44px tall — floating its text
                   above the 19px links beside it. WCAG 2.5.8 exempts controls
                   inline in a sentence, which is what this is. */
                className="font-semibold hover:underline align-baseline !min-h-0 !h-auto disabled:no-underline"
                style={{ color: resendCooldown > 0 ? "hsl(var(--olivewood) / 0.8)" : "hsl(var(--bark))" }}
              >
                {resending ? "Sending…" : resent ? `Resent${resendCooldown > 0 ? ` (${resendCooldown}s)` : ""}` : "Resend"}
              </button>
            </p>
          )}
          {/* Wrong-address escape hatch — re-entering the address is the only
              practical fix once the auth row exists against a typo. */}
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
    </AuthShell>
  );
};

export default SignupPending;
