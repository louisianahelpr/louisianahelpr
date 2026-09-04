import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
// No @capacitor/share or sonner import here any more: the share ladder and
// every one of its user-visible outcomes belong to `shareNative`.
// Derive the auto-release window rather than restating "48 hours" in prose.
// This is checkout copy — a legally load-bearing promise about when money
// moves — so it must follow the config the cron actually enforces. Imported
// straight from the Deno _shared module, the same pattern the parity tests use.
import { COPY_AUTO_RELEASE_HOURS } from "../../supabase/functions/_shared/escrowTiming";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  Megaphone,
  Handshake,
  Hammer,
  Wallet,
  Share2,
  RotateCcw,
  Users as UsersIcon,
  AlertTriangle,
  Loader2,
  LifeBuoy,
} from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { hapticSuccess, hapticLight } from "@/lib/haptics";
import { InlineSuccessCheck } from "@/components/feedback/SuccessMoment";
import AuthShell from "@/components/auth/AuthShell";
import { supabase } from "@/integrations/supabase/client";
import { track, AhaEvent } from "@/lib/analytics";
import { ppoTrackingProps } from "@/lib/ppoAttribution";
import { report } from "@/lib/errorLogger";
import { safeStorage } from "@/lib/safeStorage";
import { formatPrice } from "@/lib/format";
import { MaterialsPanel } from "@/components/postjob/MaterialsPanel";
import { getPublicSiteUrl } from "@/lib/authRedirects";
import { shareNative } from "@/lib/nativeShare";

// Visual lifecycle preview — replaces the dense paragraph that used to
// sit in this same slot. Keeps the same content (4 stages from job-state
// machine: open → accepted → in_progress → completed) but presents it
// as scannable steps so customers know what to expect next.
const LIFECYCLE_STEPS = [
  { icon: Megaphone, label: "Posted", caption: "Your job is live for nearby Helprs." },
  { icon: Handshake, label: "Accepted", caption: "You review applicants and pick one." },
  { icon: Hammer, label: "In progress", caption: "Helpr arrives and gets to work." },
  { icon: Wallet, label: "Released", caption: "Both confirm — payment goes out." },
];

/**
 * TRUTHFULNESS CONTRACT FOR THIS SCREEN
 * =====================================
 * This page used to be a static "Payment authorized. Held securely…" card: it
 * asserted the outcome purely because the router had landed here, and every
 * one of its reads could fail without changing a single word on screen. That
 * is the worst shape of bug this app can ship — telling someone their money is
 * secured when we have no idea whether it is.
 *
 * So the claim is now EARNED, from `jobs.payment_status` — the same column the
 * `checkout.session.completed` webhook writes (`→ 'escrow'`) and the PIF
 * `redeem_pif_credit` RPC writes for a fully-gifted job. Nothing here changes
 * payment or escrow LOGIC; it is a read-only confirmation lookup that decides
 * which of four honest things the page is allowed to say.
 *
 *   held      — payment_status is escrow / payout_pending. The money really is
 *               in escrow. Only here may the page say so.
 *   not_held  — payment_status proves no money was ever taken. We say that.
 *   unknown   — we could not read the row, the row is missing, the money has
 *               already moved on from escrow, the row still says 'unpaid'
 *               after the webhook grace window, or there is no job reference
 *               at all. We do NOT know that escrow holds this job's money —
 *               and the page must not imply the money was taken OR that it
 *               wasn't. It says plainly that it can't confirm, tells the user
 *               not to pay twice, and points at My Posts + support.
 *   checking  — the lookup is still in flight.
 */
type ConfirmState = "checking" | "held" | "not_held" | "unknown";

/** Why we ended up in `unknown` — changes only the explanatory sentence. */
// ME-041 (lh-money-escrow, 2026-09-04): "moved" was declared here but nothing
// in this file ever assigned it — dead since whenever it was added.
type UnknownReason = "no-reference" | "unreachable" | "not-found" | "pending";

/**
 * `jobs.payment_status` values where "held securely until you confirm the work
 * is done" is literally true: the customer's money is captured and still
 * sitting in escrow. Mirrors the `jobs_payment_status_check` constraint — see
 * supabase/migrations/20260628000001_payment_status_add_failed_chargeback.sql.
 *
 * Deliberately narrow. `released`, `refunded` and `chargeback` are all states
 * where money HAS moved, so this screen's escrow copy would be false for them
 * even though nothing failed — they fall through to `unknown`, which sends the
 * user to My Posts where the job's real state is shown. Better to say "we
 * can't confirm that here" than to print a sentence that isn't true.
 */
// "released" added (ME-041, lh-money-escrow 2026-09-04): re-opening this
// return URL for a job whose payout already completed fell through every
// poll attempt (matched neither set) and landed on the "hasn't been
// confirmed on our side yet… please don't pay again" pending copy — actively
// wrong for a payment that not only succeeded but has already been paid out.
// `released` means the charge succeeded at least as much as `escrow` did.
const HELD_STATUSES = new Set(["escrow", "payout_pending", "released"]);

/** States that mean this job never got funded. */
const NOT_HELD_STATUSES = new Set(["failed", "cancelled", "abandoned"]);

/**
 * Stripe bounces the browser to `success_url` the instant checkout completes;
 * the webhook that flips `payment_status` off 'unpaid' lands a beat later. So
 * a row that still reads 'unpaid' is a RACE, not a failure — poll briefly
 * before admitting we can't confirm.
 *
 * A read ERROR is deliberately NOT retried on this timer: it tells us nothing
 * about the payment either way, so the honest move is to say so immediately
 * and hand the user a Try again button, rather than sit on a spinner.
 */
const PENDING_POLL_ATTEMPTS = 4;
const PENDING_POLL_INTERVAL_MS = 1_500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PaymentSuccess = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // The job id flows through either the success URL (Stripe-driven) or
  // the stashed `helpr_last_posted_job_id` (set right after job insert).
  // We resolve it once and use it for share / repost / view-applicants.
  const resolvedJobId =
    searchParams.get("job_id") ||
    (typeof window !== "undefined" ? safeStorage.getItem("helpr_last_posted_job_id") : null) ||
    null;
  const [sharing, setSharing] = useState(false);
  // The held-in-escrow amount, read in the confirmation lookup for display.
  // Only ever rendered in the `held` branch — quoting an amount next to an
  // unconfirmed payment would re-introduce exactly the claim this screen is
  // no longer allowed to make.
  const [escrowAmount, setEscrowAmount] = useState<number | null>(null);
  // Job category, read in the same lookup, purely to pick the materials list.
  // Null (or a category with no entry in categoryMaterials) renders nothing.
  const [category, setCategory] = useState<string | null>(null);
  // ME-041: distinguishes "still escrowed, releases on your confirmation"
  // from "already released" — both are `isHeld`, but they are not the same
  // claim, and the escrow copy below is false for the second one.
  const [alreadyReleased, setAlreadyReleased] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState>(
    resolvedJobId ? "checking" : "unknown",
  );
  const [unknownReason, setUnknownReason] = useState<UnknownReason>(
    resolvedJobId ? "unreachable" : "no-reference",
  );
  // Bumped by the Try again button to re-run the confirmation lookup.
  const [confirmAttempt, setConfirmAttempt] = useState(0);

  const isHeld = confirmState === "held";

  usePageTitle(
    isHeld
      ? "Payment Authorized — Helpr"
      : confirmState === "not_held"
        ? "Payment Not Completed — Helpr"
        : confirmState === "checking"
          ? "Confirming Payment — Helpr"
          : "Payment Status Unconfirmed — Helpr",
  );

  /**
   * Share the just-posted job so a neighbour can see it and apply.
   *
   * THREE THINGS WERE WRONG HERE, none of which threw or logged.
   *
   * 1. The link was `/dashboard?job=<id>`. `/dashboard` is a `ProtectedRoute`,
   *    so a recipient without an account was bounced to
   *    `/login?redirect=%2Fdashboard%3Fjob%3D…` (verified against production,
   *    signed out) — a login wall in place of the job. And `Dashboard` never
   *    reads a `?job=` param at all, so even a signed-in recipient landed on
   *    their own dashboard with the job nowhere in sight. It is now the same
   *    public `/jobs/:id` preview route `ShareJobButton` uses, which renders
   *    for guests and routes Apply to signup.
   * 2. There was no `text` — the OS got a bare URL, so the recipient saw a
   *    naked link with no idea what it was or who sent it.
   * 3. The ladder was a third private copy of the share chain, and its last
   *    rung was `else if (navigator.clipboard?.writeText)`. When neither
   *    `navigator.share` NOR `navigator.clipboard` exists — desktop Safari on
   *    an insecure origin, older browsers — every branch was skipped and the
   *    function returned having done nothing and said nothing. Reproduced: the
   *    tap produced zero side effects and zero toasts. Even the branch that
   *    DID copy gave no feedback. `shareNative` owns all of it now and every
   *    rung ends in something the user can perceive.
   */
  const handleShareJob = async () => {
    if (sharing || !resolvedJobId) return;
    setSharing(true);
    void hapticLight();
    const url = `${getPublicSiteUrl()}/jobs/${resolvedJobId}?ref=share`;
    const text = "I just posted a job on Louisiana Helpr. Can you help, or know someone who can?";
    try {
      await shareNative({
        title: "Job posted on Helpr",
        text,
        url,
        dialogTitle: "Share this job",
        clipboardText: `${text}\n${url}`,
      });
    } finally {
      setSharing(false);
    }
  };

  const handlePostAnother = () => {
    void hapticLight();
    // Clear the cached id so the next visit to this page doesn't
    // re-surface the wrong job.
    try { safeStorage.removeItem("helpr_last_posted_job_id"); } catch { /* ignore */ }
    if (resolvedJobId) {
      navigate(`/post-job?rebook=${resolvedJobId}`);
    } else {
      navigate("/post-job");
    }
  };

  const handleViewApplicants = () => {
    void hapticLight();
    try { safeStorage.removeItem("helpr_last_posted_job_id"); } catch { /* ignore */ }
    if (resolvedJobId) {
      navigate(`/my-posts?job=${resolvedJobId}`);
    } else {
      navigate("/my-posts");
    }
  };

  const handleRetryConfirm = useCallback(() => {
    void hapticLight();
    setConfirmAttempt((n) => n + 1);
  }, []);

  // ── The confirmation lookup ───────────────────────────────────────────
  // Read-only. Decides which claim the page is allowed to make; touches no
  // payment or escrow logic.
  useEffect(() => {
    if (!resolvedJobId) {
      setConfirmState("unknown");
      setUnknownReason("no-reference");
      return;
    }
    let cancelled = false;
    setConfirmState("checking");
    void (async () => {
      let sawReadError = false;
      for (let attempt = 0; attempt < PENDING_POLL_ATTEMPTS; attempt += 1) {
        if (attempt > 0) {
          await sleep(PENDING_POLL_INTERVAL_MS);
          if (cancelled) return;
        }
        const { data, error } = await supabase
          .from("jobs")
          .select("budget, category, payment_status")
          .eq("id", resolvedJobId)
          .maybeSingle();
        if (cancelled) return;

        if (error) {
          // We asked and could not get an answer. That is evidence of
          // nothing about the payment, so stop and say exactly that.
          report(error, { tags: { source: "PaymentSuccess.confirmPayment" } });
          sawReadError = true;
          break;
        }
        if (!data) {
          // No readable row for this id — same epistemic position as an
          // error: we cannot confirm, and must not guess.
          sawReadError = true;
          break;
        }

        if (typeof data.budget === "number") setEscrowAmount(data.budget);
        if (typeof data.category === "string") setCategory(data.category);

        const status = data.payment_status;
        if (status && HELD_STATUSES.has(status)) {
          if (status === "released") setAlreadyReleased(true);
          setConfirmState("held");
          return;
        }
        if (status && NOT_HELD_STATUSES.has(status)) {
          setConfirmState("not_held");
          return;
        }
        // 'unpaid' / null → the webhook hasn't landed yet. Keep polling.
      }
      if (cancelled) return;
      setUnknownReason(sawReadError ? "unreachable" : "pending");
      setConfirmState("unknown");
    })();
    return () => { cancelled = true; };
  }, [resolvedJobId, confirmAttempt]);

  // Celebrate only what we actually confirmed. The success haptic used to
  // fire on mount, i.e. also when every request behind this screen had died.
  const celebrated = useRef(false);
  useEffect(() => {
    if (isHeld && !celebrated.current) {
      celebrated.current = true;
      hapticSuccess();
    }
  }, [isHeld]);

  useEffect(() => {
    const jobId = searchParams.get("job_id") || null;
    const ppoProps = ppoTrackingProps();
    // Funnel: customer returned from checkout — closes the customer funnel
    // that previously stopped at job_posted with no record of payment. This
    // fires on arrival (not on confirmation) deliberately: it is the
    // checkout-completed funnel step, and gating it on the confirmation read
    // would silently drop events whenever that read failed.
    track(AhaEvent.PaymentMade, { job_id: jobId, ...ppoProps });

    // First-payment aha — fire only when this is the user's first
    // successful payment. Mirrors the count-query pattern from
    // first_job_posted / first_job_application_sent.
    void (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { count } = await supabase
          .from("jobs")
          .select("id", { count: "exact", head: true })
          .eq("customer_id", user.id)
          .not("stripe_payment_intent_id", "is", null);
        if ((count ?? 0) <= 1) {
          track(AhaEvent.FirstPaymentCollected, { job_id: jobId, ...ppoProps });
        }
      } catch (e) {
        report(e, { tags: { source: "PaymentSuccess.firstPaymentCount" } });
      }
    })();
  }, [searchParams]);

  const eyebrow = isHeld
    ? "Payment authorized"
    : confirmState === "checking"
      ? "One moment"
      : confirmState === "not_held"
        ? "Payment not completed"
        : "Payment not confirmed";

  const heading = isHeld
    ? "Payment authorized."
    : confirmState === "checking"
      ? "Confirming your payment…"
      : confirmState === "not_held"
        ? "Your payment didn't go through."
        : "We couldn't confirm your payment.";

  const unknownBody =
    unknownReason === "no-reference"
      ? "We don't have a reference for this payment, so we can't tell you whether it went through. Please don't pay again — open My Posts to check the job's payment status, or contact support and we'll look it up for you."
      : unknownReason === "pending"
        ? "Your payment hasn't been confirmed on our side yet. It usually lands within a minute. Please don't pay again — open My Posts to see this job's payment status, and contact support if it still isn't confirmed in a few minutes."
        : "We couldn't reach our records to check this payment. That does not mean it failed — we simply can't tell you either way right now. Please don't pay again — open My Posts to see this job's payment status, and contact support if it still isn't clear.";

  const supportAction = (
    <Button
      variant="ghost"
      onClick={() => {
        void hapticLight();
        navigate("/support");
      }}
      className="w-full rounded-ds-md"
      style={{ color: "hsl(var(--bark))" }}
    >
      <LifeBuoy className="w-4 h-4 mr-2" />
      Contact Support
    </Button>
  );

  return (
    <AuthShell hideBack eyebrow={eyebrow} maxWidth="md">
      <div className="liquid-glass p-7 sm:p-8 space-y-6 text-center">
        {/* The badge is a claim too — it only draws its checkmark when the
            payment is confirmed held. Every other state gets an honest mark
            (spinner while checking, alert once we know we don't know). */}
        <div className="flex justify-center">
          {isHeld ? (
            <InlineSuccessCheck size={88} />
          ) : confirmState === "checking" ? (
            <Loader2
              className="w-11 h-11 animate-spin"
              style={{ color: "hsl(var(--olivewood) / 0.7)" }}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          ) : (
            <AlertTriangle
              className="w-11 h-11"
              style={{ color: "hsl(var(--burnt-sienna))" }}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          )}
        </div>

        <div className="space-y-2">
          <span className="text-display-eyebrow">
            {isHeld ? "All set" : confirmState === "checking" ? "Checking" : "Heads up"}
          </span>
          {/* No `truncate` here. PLATFORM_CONVENTIONS exempts centred
              full-screen outcome states from the one-line-title rule for
              exactly this reason: with it, the unconfirmed-payment heading
              cut to "We couldn't confirm your …" at 375 — the one screen
              where the user most needs the whole sentence. Wrapping is the
              lesser evil, same call as DashboardBlockedScreen. */}
          <h1 className="text-page-title leading-tight mt-1 text-balance">{heading}</h1>
          <p
            className="font-sans text-ds-13 leading-relaxed"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            aria-live="polite"
          >
            {isHeld ? (
              alreadyReleased ? (
                escrowAmount != null ? (
                  <>
                    <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                      ${formatPrice(escrowAmount)}
                    </span>{" "}
                    was paid and has already been released to your helper.
                  </>
                ) : (
                  <>This payment was already released to your helper.</>
                )
              ) : escrowAmount != null ? (
                <>
                  <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                    ${formatPrice(escrowAmount)}
                  </span>{" "}
                  is held securely — released when you confirm the work is done.
                </>
              ) : (
                <>Held securely until you confirm the work is done.</>
              )
            ) : confirmState === "checking" ? (
              <>Hang tight — we're checking this payment against our records.</>
            ) : confirmState === "not_held" ? (
              <>
                This job isn't funded, so no money is being held for it. You can start payment
                again from My Posts, or contact support if you think this is wrong.
              </>
            ) : (
              unknownBody
            )}
          </p>
        </div>

        {/* The escrow promise, the lifecycle preview and the auto-release
            window all describe what happens to money we are holding. They
            render ONLY when we have confirmed we're holding it. */}
        {isHeld && (
          <>
            <div
              className="flex items-start justify-center gap-3 rounded-2xl p-4 text-left"
              style={{
                background: "hsl(var(--bark) / 0.06)",
                border: "1px solid hsl(var(--bark) / 0.18)",
              }}
            >
              <ShieldCheck className="w-5 h-5 shrink-0 mt-0.5" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.75} />
              <p className="text-ds-11 font-sans leading-relaxed" style={{ color: "hsl(var(--olivewood))" }}>
                We hold it until you confirm the job's done. The Helpr is paid once both you and the Helpr mark it complete — your money stays protected the whole time.
              </p>
            </div>

            <div className="space-y-3 text-left">
              <p className="text-display-eyebrow">What happens next</p>
              <ol className="space-y-2.5">
                {LIFECYCLE_STEPS.map((step, i) => {
                  const Icon = step.icon;
                  const isFirst = i === 0;
                  return (
                    <li key={step.label} className="flex items-start gap-3">
                      <div
                        className="w-8 h-8 rounded-ds-md flex items-center justify-center shrink-0 mt-0.5"
                        style={{
                          background: isFirst ? "hsl(var(--bark) / 0.12)" : "hsl(var(--olivewood) / 0.08)",
                          border: `1px solid ${isFirst ? "hsl(var(--bark) / 0.25)" : "hsl(var(--olivewood) / 0.15)"}`,
                        }}
                      >
                        <Icon
                          className="w-4 h-4"
                          strokeWidth={1.75}
                          style={{ color: isFirst ? "hsl(var(--bark))" : "hsl(var(--olivewood))" }}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-ds-13 font-medium" style={{ color: "hsl(var(--ink-deep))" }}>
                          {step.label}
                          {isFirst && (
                            <span
                              className="ml-2 text-ds-10 uppercase tracking-wider font-sans"
                              style={{ color: "hsl(var(--bark))" }}
                            >
                              you are here
                            </span>
                          )}
                        </p>
                        <p className="font-serif italic text-ds-11 mt-0.5" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                          {step.caption}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <p className="text-ds-11 font-sans leading-relaxed" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
                If one side confirms and the other doesn't respond within {COPY_AUTO_RELEASE_HOURS} hours, the job auto-completes and payment is released automatically.
              </p>
            </div>
          </>
        )}

        <div className="space-y-2.5">
          {isHeld ? (
            <>
              {/* Primary CTA — View applicants. Most actionable next step for
                  the poster who just finished paying. */}
              <Button
                variant="primary"
                size="lg"
                onClick={handleViewApplicants}
                className="w-full rounded-ds-md"
              >
                <UsersIcon className="w-4 h-4 mr-2" />
                View Applicants
              </Button>
              {/* Secondary CTA row — share + post-another-like-this. */}
              <div className="grid grid-cols-2 gap-2.5">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleShareJob}
                  disabled={sharing || !resolvedJobId}
                  className="w-full rounded-ds-md"
                >
                  <Share2 className="w-4 h-4 mr-1" /> Share
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handlePostAnother}
                  className="w-full rounded-ds-md"
                >
                  <RotateCcw className="w-4 h-4 mr-1" /> Post Another
                </Button>
              </div>
            </>
          ) : (
            <>
              {/* Unconfirmed / failed / still-checking: the only honest primary
                  action is "go look at the job's real payment state". Sharing
                  or reposting a job we can't confirm is funded would be
                  actively misleading, so those CTAs are not offered here. */}
              <Button
                variant="primary"
                size="lg"
                onClick={handleViewApplicants}
                className="w-full rounded-ds-md"
              >
                <UsersIcon className="w-4 h-4 mr-2" />
                Open My Posts
              </Button>
              {resolvedJobId && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleRetryConfirm}
                  disabled={confirmState === "checking"}
                  className="w-full rounded-ds-md"
                >
                  <RotateCcw className="w-4 h-4 mr-2" />
                  {confirmState === "checking" ? "Checking…" : "Try Again"}
                </Button>
              )}
              {confirmState !== "checking" && supportAction}
            </>
          )}
          <Button
            variant="ghost"
            onClick={() => {
              try { safeStorage.removeItem("helpr_last_posted_job_id"); } catch { /* ignore */ }
              navigate("/dashboard");
            }}
            className="w-full rounded-ds-md"
            style={{ color: "hsl(var(--bark))" }}
          >
            Back to Dashboard
          </Button>
        </div>

        {/* "You might need: …" — moved here from the checkout screen, where it
            sat between the running total and the pay button.

            It carries an affiliate disclosure, so its placement is an ethics
            question, not just a layout one: before payment it was the app
            selling the poster something else mid-decision. Here the job is
            already posted and paid, so the same list reads as prep.

            Deliberately BELOW the CTAs. The reason it was wrong on checkout
            was that it outranked the real action; putting it above "View
            applicants" would repeat that mistake on a new screen. It renders
            collapsed (one row) and returns null for categories with no
            materials, so it costs almost nothing when it isn't wanted.

            Gated on `isHeld` for the same reason as the lifecycle block —
            "here's what to buy for the job" presumes a funded job. */}
        {isHeld && category && <MaterialsPanel category={category} className="mt-6 text-left" />}
      </div>
    </AuthShell>
  );
};

export default PaymentSuccess;
