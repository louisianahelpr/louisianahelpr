import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
// Derive the auto-release window rather than restating "48 hours" in prose.
// This is checkout copy — a legally load-bearing promise about when money
// moves — so it must follow the config the cron actually enforces. Imported
// straight from the Deno _shared module, the same pattern the parity tests use.
import { COPY_AUTO_RELEASE_HOURS } from "../../../supabase/functions/_shared/escrowTiming";
import { Button } from "@/components/ui/button";
import {
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
import { isJobPoster } from "@/lib/checkoutReturnOwner";
import { safeStorage } from "@/lib/safeStorage";
import { dropSpentDraft } from "@/hooks/useDraftJob";
// formatPriceExact, not formatPrice: the sentences below state a sum of money
// that is ACTUALLY SITTING IN ESCROW. See the note at the render site.
import { formatPriceExact } from "@/lib/format";
import { MaterialsPanel } from "@/components/postjob/MaterialsPanel";
import { getPublicSiteUrl } from "@/lib/authRedirects";
import { shareNative } from "@/lib/nativeShare";
import { PaymentLifecycleSteps } from "@/components/postjob/PaymentLifecycleSteps";
import {
  paymentHeading,
  paymentPageTitle,
  unknownPaymentBody,
  type ConfirmState,
  type UnknownReason,
} from "./paymentReturnCopy";

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
 * `checkout.session.completed` webhook writes (`→ 'escrow'`) and the gift card
 * `redeem_gift_card` RPC writes for a fully-gifted job. Nothing here changes
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
 *   not_yours — the signed-in account did not post this job (owner bug,
 *               2026-10-05: an admin account was shown another account's
 *               held payment). No claim, no amount, no poster actions.
 */
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PaymentSuccess = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // The job id flows through either the success URL (Stripe-driven) or
  // the stashed `helpr_last_posted_job_id` (set right after job insert).
  // We resolve it once and use it for share / repost / view-applicants.
  // Q305: only a well-formed uuid is ever sent to Postgres; anything else
  // (a hand-edited or truncated link) is treated as having no reference.
  const rawJobId =
    searchParams.get("job_id") ||
    (typeof window !== "undefined" ? safeStorage.getItem("helpr_last_posted_job_id") : null) ||
    null;
  const resolvedJobId = rawJobId && UUID_RE.test(rawJobId) ? rawJobId : null;
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

  usePageTitle(paymentPageTitle(confirmState));

  /**
   * Share the just-posted job so a neighbour can see it and apply.
   *
   * THREE THINGS WERE WRONG HERE, none of which threw or logged.
   *
   * 1. The link was `/home?job=<id>`. `/home` is a `ProtectedRoute`,
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
    try {
      safeStorage.removeItem("helpr_last_posted_job_id");
    } catch {
      // Silent by design: this only clears a convenience pointer to the job
      // just posted. A stale value is read defensively everywhere it is used,
      // and safeStorage already swallows the private-mode throw.
    }
    if (resolvedJobId) {
      navigate(`/post-job?rebook=${resolvedJobId}`);
    } else {
      navigate("/post-job");
    }
  };

  const handleViewApplicants = () => {
    void hapticLight();
    try {
      safeStorage.removeItem("helpr_last_posted_job_id");
    } catch {
      // Silent by design: this only clears a convenience pointer to the job
      // just posted. A stale value is read defensively everywhere it is used,
      // and safeStorage already swallows the private-mode throw.
    }
    if (resolvedJobId) {
      navigate(`/posts?job=${resolvedJobId}`);
    } else {
      navigate("/posts");
    }
  };

  const handleRetryConfirm = useCallback(() => {
    void hapticLight();
    setConfirmAttempt((n) => n + 1);
  }, []);

  // Funnel events for the checkout return. Fired ONCE, from the confirmation
  // lookup, for everyone except a signed-in account the lookup proved did not
  // post the job (Q1386b: a non-poster opening the link used to be counted as
  // a payment). Still NOT gated on the payment being confirmed held: a failed
  // or unreadable lookup must not drop the checkout-completed funnel step.
  const returnEventsFired = useRef(false);
  const fireReturnEvents = useCallback(() => {
    if (returnEventsFired.current) return;
    returnEventsFired.current = true;
    const jobId = searchParams.get("job_id") || null;
    const ppoProps = ppoTrackingProps();
    // Funnel: customer returned from checkout — closes the customer funnel
    // that previously stopped at job_posted with no record of payment.
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

  // ── The confirmation lookup ───────────────────────────────────────────
  // Read-only. Decides which claim the page is allowed to make; touches no
  // payment or escrow logic.
  useEffect(() => {
    if (!resolvedJobId) {
      setConfirmState("unknown");
      setUnknownReason("no-reference");
      fireReturnEvents();
      return;
    }
    let cancelled = false;
    setConfirmState("checking");
    void (async () => {
      let sawReadError = false;
      // Who is asking: only the job's poster may be told this payment is held.
      const { data: auth, error: authError } = await supabase.auth.getSession();
      if (cancelled) return;
      const viewerId = authError ? null : auth.session?.user?.id ?? null;
      for (let attempt = 0; attempt < PENDING_POLL_ATTEMPTS; attempt += 1) {
        if (attempt > 0) {
          await sleep(PENDING_POLL_INTERVAL_MS);
          if (cancelled) return;
        }
        const { data, error } = await supabase
          .from("jobs")
          .select("budget, category, payment_status, customer_id")
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
        if (!data || !viewerId) {
          // No readable row for this id (or no session to compare it with) —
          // same epistemic position as an error: we cannot confirm, and must
          // not guess.
          sawReadError = true;
          break;
        }
        if (!isJobPoster(data.customer_id, viewerId)) {
          setConfirmState("not_yours");
          return;
        }
        fireReturnEvents();

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
      fireReturnEvents(); // unreadable or still pending: we cannot say it is not the poster
      setUnknownReason(sawReadError ? "unreachable" : "pending");
      setConfirmState("unknown");
    })();
    return () => { cancelled = true; };
  }, [resolvedJobId, confirmAttempt, fireReturnEvents]);

  // Celebrate only what we actually confirmed. The success haptic used to
  // fire on mount, i.e. also when every request behind this screen had died.
  const celebrated = useRef(false);
  useEffect(() => {
    if (isHeld && !celebrated.current) {
      celebrated.current = true;
      hapticSuccess();
      dropSpentDraft(); // paid: drop the draft kept through checkout; a cancel keeps "Load Draft"
    }
  }, [isHeld]);

  const heading = paymentHeading(confirmState);
  const unknownBody = unknownPaymentBody(unknownReason);

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
    // `centerColumn`: without it AuthShell snaps to `items-start` and the
    // card pins to the left edge (measured at 1440: card x 48–496, dead
    // canvas across the other ~940px). Same prop, same reason as Signup.
    // hideHeader (owner, 2026-10-05): the Helpr·LA wordmark and its
    // "PAYMENT AUTHORIZED" eyebrow repeated the card's own headline.
    <AuthShell hideBack hideHeader centerColumn maxWidth="md">
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
          {/* mt-2: the space-y-2 gap the hidden eyebrow span gave it, which
              outranked its mt-1 (Q1129), kept so nothing moves.
              No `truncate` here. PLATFORM_CONVENTIONS exempts centred
              full-screen outcome states from the one-line-title rule for
              exactly this reason: with it, the unconfirmed-payment heading
              cut to "We couldn't confirm your …" at 375 — the one screen
              where the user most needs the whole sentence. Wrapping is the
              lesser evil, same call as DashboardBlockedScreen. */}
          <h1 className="text-page-title leading-tight mt-2 text-balance">{heading}</h1>
          <p
            className="font-sans text-ds-13 leading-relaxed"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
            aria-live="polite"
          >
            {/* `formatPriceExact`, NOT `formatPrice`. These two sentences assert
                a specific sum of money that is really in escrow — "$X is held
                securely", "$X was paid and has already been released". A
                rounded assertion about a real balance is just a false one:
                `formatPrice` rounds to the nearest dollar, so a $136.40 escrow
                read "$136 is held securely" (understating what the poster paid)
                and a $136.60 escrow read "$137" (claiming 40c that is not
                there). This is a receipt, which is exactly what
                `formatPriceExact` is for. */}
            {isHeld ? (
              alreadyReleased ? (
                escrowAmount != null ? (
                  <>
                    <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                      ${formatPriceExact(escrowAmount)}
                    </span>{" "}
                    was paid and has already been released to your Helpr.
                  </>
                ) : (
                  <>This payment was already released to your Helpr.</>
                )
              ) : escrowAmount != null ? (
                <>
                  <span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
                    ${formatPriceExact(escrowAmount)}
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
            ) : confirmState === "not_yours" ? (
              <>
                You're signed in to an account that didn't post this job, so its payment isn't shown
                here. If you posted it, sign in to that account to see it.
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
            <div className="space-y-3 text-left">
              {/* mt-3: the space-y-3 gap the hidden eyebrow gave it (Q1129). */}
              <PaymentLifecycleSteps />
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
          ) : confirmState === "not_yours" ? null : (
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
          {/* "You might need" (affiliate list): after the job is posted and paid,
              below View Applicants / Share / Post Another, and ABOVE Back to
              Dashboard (owner, 2026-10-08). Collapsed by default; null for a
              category with no materials. Gated on `isHeld`: it presumes a funded job. */}
          {isHeld && category && <MaterialsPanel category={category} className="text-left" />}
          <Button
            variant="ghost"
            onClick={() => {
              try {
                safeStorage.removeItem("helpr_last_posted_job_id");
              } catch {
                // Silent by design — same convenience pointer as above; a
                // stale value is handled by every reader.
              }
              navigate("/home");
            }}
            className="w-full rounded-ds-md"
            style={{ color: "hsl(var(--bark))" }}
          >
            Back to Dashboard
          </Button>
        </div>

      </div>
    </AuthShell>
  );
};

export default PaymentSuccess;
