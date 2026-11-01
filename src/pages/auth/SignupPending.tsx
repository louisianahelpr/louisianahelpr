import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import AuthShell from "@/components/auth/AuthShell";
import { AuthCardHead } from "@/components/auth/AuthCardHead";
import { TurnstileField, type TurnstileHandle } from "@/components/auth/TurnstileField";
import { isCaptchaError } from "@/lib/turnstile";
import { runWithCaptcha } from "@/hooks/useCaptcha";
import { recognizedAuthError } from "@/lib/authErrors";
import { usePageMeta } from "@/hooks/usePageMeta";
import { NOINDEX_PAGE_META } from "@/lib/publicPageMeta.mjs";
import { getSignupConfirmRedirect } from "@/lib/authRedirects";
import { postAuthDestination } from "@/lib/jobIntent";
import { report } from "@/lib/errorLogger";
import { useIdentityCheckOnStore } from "@/lib/identityCheckSwitch";
import { Button } from "@/components/ui/button";
import { ConfirmLinkPanel } from "./signupPending/ConfirmLinkPanel";
import { readConfirmLink } from "../../../supabase/functions/_shared/confirmLink";

// How long to disable the resend button after each send. Supabase's own
// rate limit is at least this strict on the server; this just sets user
// expectations so they don't spam-tap and burn through the server cap.
const RESEND_COOLDOWN_S = 60;
// How often we poll the auth state for an email-arrived check. 5s
// matches the brief and is gentle enough that an inbox tab open in the
// background doesn't burn battery.
const VERIFY_POLL_INTERVAL_MS = 5000;
// How often, at most, a signed-in but unconfirmed session is re-issued so a
// confirmation made on another device reaches this tab (Q193).
const REFRESH_INTERVAL_MS = 15000;
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
  // Q401a: the same table api/share.ts serves pre-JS (src/lib/publicPageMeta.mjs), noindex included.
  usePageMeta(NOINDEX_PAGE_META["/signup-pending"]);

  const location = useLocation();
  const navigate = useNavigate();
  // The address arrives in router state (Signup does navigate(..., { state }))
  // which lives in the history entry and is LOST on reload — and "keep this
  // page open" makes reloading a very natural thing to do while waiting. Mirror
  // it into sessionStorage so a refresh, or coming back to the tab, still knows
  // who we're waiting on. sessionStorage (not local) so it dies with the tab
  // rather than lingering on a shared machine.
  const routerEmail: string = (location.state as { email?: string } | null)?.email ?? "";
  // Third source (Q193): ProtectedRoute sends EVERY signed-in, unconfirmed
  // account here from any protected route, with no router state and often a
  // fresh tab (no sessionStorage). The signed-in session knows the address, so
  // the poll below fills it in — this page must never say "your email" to
  // someone whose address we are holding.
  const [prefillEmail, setPrefillEmail] = useState<string>(() => {
    if (routerEmail) {
      try {
        sessionStorage.setItem(PENDING_EMAIL_KEY, routerEmail);
      } catch {
        // Silent by design: this is a refresh convenience (see above). Failing
        // to remember the address only means the field is empty after a
        // reload; the router state still carried it on this render.
      }
      return routerEmail;
    }
    try {
      return sessionStorage.getItem(PENDING_EMAIL_KEY) ?? "";
    } catch {
      // Silent by design: an unreadable record just means we cannot prefill
      // the address, which is a blank field, not a broken screen.
      return "";
    }
  });
  const [resending, setResending] = useState(false);
  // AUD31-57 sibling: the ID-check promise below shows only while the identity_check switch is on.
  const idCheckOn = useIdentityCheckOnStore();
  const turnstileRef = useRef<TurnstileHandle>(null);
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
    let lastRefreshAt = 0;
    let refreshFailureReported = false;
    const advanceIfVerified = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (cancelled || error) return;
      const sessionUser = data.session?.user;
      if (sessionUser?.email && !sessionUser.email_confirmed_at) {
        // The signed-in session is authoritative: a stale sessionStorage
        // address from an earlier signup in this tab must not win, or Resend
        // would mail the wrong address (lh-authz-rls review, Q193).
        const sessionEmail = sessionUser.email;
        setPrefillEmail((cur) => (cur === sessionEmail ? cur : sessionEmail));
      }
      if (sessionUser?.email_confirmed_at) {
        try {
          sessionStorage.removeItem(PENDING_EMAIL_KEY);
        } catch {
          // Silent by design: a failed clear leaves the pending address in
          // sessionStorage, which dies with the tab anyway. The navigation
          // below is what actually matters and happens regardless.
        }
        // Into the app. `postAuthDestination` spends a stored job intent /
        // `?redirect=` target (the job a logged-out visitor tapped before
        // signing up) and otherwise returns /home; ProtectedRoute there
        // sends an incomplete profile on to /complete-profile. This hop used
        // to live on /account-pending, which the email link opened (Q193).
        navigate(postAuthDestination(), { replace: true });
        return;
      }
      // Signed in but unconfirmed: `email_confirmed_at` is baked into the
      // session JWT, so a link clicked on ANOTHER device (or in another
      // browser) would leave this tab waiting forever. Re-issue the token from
      // the auth row at most every REFRESH_INTERVAL_MS; the next poll then
      // reads the confirmed session. A failed refresh is not shown (the next
      // one retries) but is reported once per visit.
      if (sessionUser && Date.now() - lastRefreshAt >= REFRESH_INTERVAL_MS) {
        lastRefreshAt = Date.now();
        const noteFailure = (err: unknown) => {
          if (refreshFailureReported) return;
          refreshFailureReported = true;
          report(err, { severity: "warning", tags: { source: "SignupPending.refreshSession" } });
        };
        try {
          const { error: refreshErr } = await supabase.auth.refreshSession();
          if (refreshErr) noteFailure(refreshErr);
        } catch (err) {
          // Not silent: noteFailure calls report() (once per visit); the next
          // poll retries the refresh.
          noteFailure(err);
        }
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
    // Same landing as Signup's first email (`emailRedirectTo` there): the link
    // opens THIS page, whose poll admits the confirmed account into the app.
    // Without it the resent link fell back to the project's Site URL.
    // Never held on the security box unless the server refuses (A3-B1).
    const { error } = await runWithCaptcha(turnstileRef.current, (captchaToken) => supabase.auth.resend({
      type: "signup",
      email: prefillEmail.trim(),
      options: { emailRedirectTo: getSignupConfirmRedirect(), captchaToken },
    }));
    setResending(false);
    if (error) {
      // Nothing was sent, and a refused security check says nothing about the
      // address, so it is named rather than shown as "sent".
      if (isCaptchaError(error.message)) {
        toast.error(recognizedAuthError(error.message) ?? "The security check didn't finish. Try again.");
        return;
      }
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("rate") || msg.includes("limit") || msg.includes("too many")) {
        toast.error("Too many requests — try again in a minute.");
        return;
      }
      // Fall through: this screen must not reveal whether an address has an
      // account, so every other failure reads as success (see ForgotPassword).
    }
    // Member report 2026-10-23 (iPhone Safari, signed out): "I press resend
    // but nothing happens". Her address was ALREADY confirmed, and Supabase
    // answers a signup resend for a confirmed address with success and sends
    // nothing; the only sign of it was this button's label turning "Resent".
    // Now every success shows the result panel below, which also offers the
    // way out for an already-confirmed address (Log in). It cannot say which
    // case this is: signed out, that would tell anyone whether an address has
    // a confirmed account. (Signed in AND confirmed never stays here: the poll
    // above takes that session into the app.)
    setResent(true);
    setResendCooldown(RESEND_COOLDOWN_S);
  };

  // Numbered rather than icon-only: the three cards are a SEQUENCE (verify →
  // sign-in → start), and three unrelated glyphs (envelope, arrow, sparkles)
  // didn't read as an order at a glance. The numeral replaces the icon in the
  // same token square used elsewhere for a step marker (see AwardGateDialog's
  // RequirementRow), rather than introducing a new badge style.
  const stepIcon = (step: number) => (
    <div
      className="w-9 h-9 rounded-ds-md flex items-center justify-center flex-shrink-0 mt-0.5"
      style={{ background: "hsl(var(--bark) / 0.1)" }}
    >
      {/* --sage-ink, not --bark. Byte-identical in light mode (both 70 20%
          33%, both measure 5.31:1 here), so the light badge does not move; the
          dark value is the lifted one. The tint behind the numeral is
          --bark/0.1, and that 10% wash is enough to take the DARK numeral from
          4.95:1 on the bare card to 4.21:1 inside the badge — under the 4.5:1
          this 15px text needs. --sage-ink gives 6.49:1 there. The badge's own
          tint darkening its own label is the kind of thing only a measurement
          of the composited pixels catches. */}
      <span className="text-ds-15 font-bold" style={{ color: "hsl(var(--sage-ink))" }} aria-hidden="true">
        {step}
      </span>
    </div>
  );

  // Scanner-safe confirm link (lead, 2026-10-25; _shared/confirmLink.ts): an
  // email link that carries a token_hash opens this page and spends the token
  // only on the person's tap, so a mail scanner's pre-fetch cannot use it up.
  // An expired or already-used link lands here too, with a way to get a new one.
  const confirmLink = readConfirmLink(location.search, location.hash);
  if (confirmLink.kind !== "none") {
    return (
      <AuthShell hideHeader hideBack centerColumn maxWidth="sm" noWebChrome>
        <div className="liquid-glass p-card space-y-section">
          <AuthCardHead testId="signup-pending-confirm-head" title="Confirm your email" />
          <ConfirmLinkPanel
            token={confirmLink.kind === "token" ? { tokenHash: confirmLink.tokenHash, type: confirmLink.type } : null}
            email={prefillEmail}
            setEmail={setPrefillEmail}
            onConfirmed={() => navigate(postAuthDestination(), { replace: true })}
            onResend={handleResend}
            resending={resending}
            resendCooldown={resendCooldown}
          />
        </div>
      </AuthShell>
    );
  }

  return (
    /* Spec v2 rebuild (audit 2026-10-21): /login's centered card (maxWidth
       sm, H mark + one sentence-case heading inside the card), not a Title
       Case [back] [title] row over a full-width box. No back arrow: the
       account already EXISTS here, so "back" to the signup form invites a
       duplicate attempt; the card's own "Start over" and "Log in" links are
       the ways out. noWebChrome like every auth sibling (a "Get Started"
       button above "your account exists" contradicted the card). */
    <AuthShell hideHeader hideBack centerColumn maxWidth="sm" noWebChrome>
      <div className="liquid-glass p-5 sm:p-6 lg:p-8 space-y-6">
        <AuthCardHead testId="signup-pending-card-head" title="Check your email" />
        {/* Name the ADDRESS. It's the one fact this screen exists to
            convey — how someone catches "jane@gmial.com" without opening
            the resend panel to look. Falls back to the generic sentence on
            a cold load, where router state carries no email. */}
        <p className="text-ds-14 font-sans text-center text-balance" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
          We've sent a verification link to{" "}
          {prefillEmail
            ? <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>{prefillEmail}</span>
            : "your email"}
          . Click it to confirm your account.
        </p>

        <div className="border-t pt-6 grid gap-4 text-left" style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}>
          <div className="flex items-start gap-3">
            {stepIcon(1)}
            <div>
              <p className="text-ds-13 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Verify your email</p>
              <p className="text-ds-13 font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Click the link in your inbox to confirm your email address.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            {stepIcon(2)}
            <div>
              <p className="text-ds-13 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>We'll sign you in</p>
              <p className="text-ds-13 font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Keep this page open — the moment you confirm in this browser, we take you straight in. Confirmed on your phone? Sign in below.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            {stepIcon(3)}
            <div>
              {/* This step has now been wrong in BOTH directions, so the
                  history is worth keeping.

                  It first said "Start right away / You're all set — post and
                  accept jobs the moment you're in", which was written when
                  signup collected only email + password: the confirmation poll
                  above navigates to `/complete-profile`, and back then a
                  five-field form was waiting there. So it was changed to
                  "Finish your profile — a short form: name, photo, date of
                  birth, phone and city".

                  Signup then MOVED those five fields into its own step 2
                  (`SignupStep2`, owner decision 2026-08-29), which is completed
                  BEFORE this screen is ever reached. `PROFILE_GATE_FIELDS`
                  (ProtectedRoute.tsx) is those fields minus the photo, which
                  left the gate on 2026-10-09; so an email
                  signup satisfies `isProfileComplete` on arrival and
                  CompleteProfile's own guard (`CompleteProfile.tsx:535`)
                  bounces straight to /home. The user never sees a form —
                  step 3 was describing work they had already finished, on the
                  one screen whose entire job is to set expectations about what
                  happens next.

                  What is still true is the deferred identity check: signup
                  collects no ID; the check comes once per account when the member
                  posts a job, gets hired, or lists, buys or claims on Declutter, or takes
                  a first payout (owner decisions 10-30). Naming it here is the difference
                  between "you're all set" and a promise we break later. */}
              <p className="text-ds-13 font-sans font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Start right away</p>
              <p className="text-ds-13 font-sans mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                Your profile is already done — you'll land straight in the app.
                {idCheckOn ? " Once per account there's a quick ID check: when you post a job, get hired, or list, buy or claim on Declutter, or at your first payout." : ""}
              </p>
            </div>
          </div>
        </div>

        {/* The escape hatches (resend, start over, log in), stacked and
            centred: the card is /login's 384px column now, too narrow to
            pair three sentences on one row. */}
        <div className="border-t pt-4 space-y-2 text-center" style={{ borderColor: "hsl(var(--olivewood) / 0.12)" }}>
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
          {resent && (
            <div
              role="status"
              data-resend-result=""
              className="rounded-ds-md px-3 py-3 text-left space-y-2"
              style={{ background: "hsl(var(--bark) / 0.06)" }}
            >
              <p className="text-ds-13 font-sans" style={{ color: "hsl(var(--ink-deep))" }}>
                If <span className="font-semibold [overflow-wrap:anywhere]">{prefillEmail}</span> still needs confirming, a new link is on its way. Check your spam folder too.
              </p>
              <p className="text-ds-13 font-sans" style={{ color: "hsl(var(--ink-deep))" }}>
                Already confirmed your email? Log in to continue.
              </p>
              <Button asChild variant="primary" size="sm" className="w-full">
                <Link to="/login">Log in</Link>
              </Button>
            </div>
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
              Log in
            </Link>
          </p>
        </div>
        <TurnstileField ref={turnstileRef} action="signup_resend" className="mt-3" />
      </div>
    </AuthShell>
  );
};

export default SignupPending;
