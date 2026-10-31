import {
  jobLocalStartMs,
  cancellationFeePercent as sharedCancellationFeePercent,
} from "../../supabase/functions/_shared/cancellationFee";
import { crewCancellationFeeQuote } from "../../supabase/functions/_shared/crewShares";
import { CANCELLATION_LADDER_RUNGS, CANCEL_OVER_24H_NOT_A_STRIKE } from "@/lib/reliabilityLadder";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
// unwrapMutation is gone with the client-side UPDATE it guarded; isWriteRejected
// stays so this dialog keeps rendering a rejected write's own message if any
// future write lands here.
import { isWriteRejected } from "@/lib/mutationResult";
import { rpcErrorCode, rpcErrorMessage } from "@/lib/lifecycleErrors";
import { fetchPosterCancelQuote, type PosterCancelQuote } from "@/lib/posterCancelQuote";
import { report } from "@/lib/errorLogger";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogFooter,
  DialogSecondaryAction,
  DialogDestructiveAction,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, ShieldAlert, DollarSign, CheckCircle, ArrowRight } from "lucide-react";
import { CancelBackToYou, CancelFeeCallout, CancelHelprToldAndPaid, CancelSeriesNotice } from "@/components/cancellationDialog/CancelDialogNotices";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { type FlatFeeStamp } from "@/lib/helprFlatFee";
import { cancelRefundIsLessCardFee, cancelRefundToast, cardShareCentsFromRead, giftCostCents, giftOnJobFromRead } from "@/lib/cancelRefundCopy";
// The ladder this dialog quotes IS the ladder Community Rules publishes —
// read the same two constants CommunitySection does rather than restating
// "25"/"50" as prose.
// formatPriceExact, not formatPrice: this block shows the fee arithmetic,
// and whole-dollar rounding made the lines stop adding up.
import { formatPriceExact as formatPrice } from "@/lib/format";
import { userFacingError } from "@/lib/userFacingError";

type CancellationDialogProps = {
  jobId: string;
  jobTitle: string;
  jobDate: string;
  /** Job's scheduled start; null means midnight. Required so the quoted
   *  tier matches what the server charges — see jobLocalStartMs. */
  jobStartTime: string | null;
  jobBudget: number;
  /** jobs.urgent_fee (dollars; null = none). With the budget it is the cost
   *  redeem_gift_card compares a gift with, so the cancel toast can tell a
   *  gift that paid the whole job from one a card topped up. Not passed: the
   *  toast does not claim either. */
  jobUrgentFee?: number | null;
  /* No `userId`: the cancelling identity is auth.uid() inside
     poster_cancel_job now, so the client no longer asserts who it is. */
  hasHelper: boolean;
  /** Whether money was ever actually taken for this job. An abandoned or
   *  never-started checkout leaves payment_status 'unpaid'/'abandoned' with
   *  nothing held, and promising a refund there is a false statement about
   *  the poster's money — see the confirmation toast below. */
  wasFunded: boolean;
  /** Q2399: the card is only HELD (never charged): the cancel releases the hold, nothing is refunded. */
  cardHeld?: boolean;
  helperId?: string | null;
  helperName?: string;
  /** The one-time setup fee this (first) job's checkout kept, in dollars
   *  (jobs.onboarding_fee_amount). Owner, 2026-10-12 (Q1674): kept on a
   *  cancel, never refunded; the dialog and the toast say so. */
  setupFeeKept?: number | null;
  /**
   * A GROUP job (Q407: a crew has no lead). `members` are the hired members,
   * each with their frozen share of the budget (cents) and whether they
   * confirmed; `needed` is helpers_needed. The quote is
   * crewCancellationFeeQuote(), the same pricing poster_cancel_job charges,
   * under the same owner rule for unconfirmed members. `hasHelper` must be
   * true when any member counts.
   */
  crew?: { needed: number; members: Array<{ share_cents: number | null; confirmed: boolean }> };
  /** The job's fee-model stamp (jobs.helper_fee_flat_cents / helper_fee_percent).
   *  A flat-model job's Helpr pays 5% + 70c on the fee, not a tier percent (Q1839). */
  feeStamp?: FlatFeeStamp | null;
  /** The poster-fee stamp and the fee it charged (jobs.poster_fee_flat_cents,
   *  customer_fee_amount). On a poster-fee job a gift pays the 5% + 70c first
   *  too, so it is part of the cost the toast compares the gift with (Q2082 (d)). */
  posterFee?: { poster_fee_flat_cents?: number | string | null; customer_fee_amount?: number | string | null } | null;
  open: boolean;
  onClose: () => void;
  onCancelled: () => void;
};

export const CancellationDialog = ({ jobId, jobTitle, jobDate, jobStartTime, jobBudget, jobUrgentFee, hasHelper, wasFunded, cardHeld, helperId: _helperId, helperName, crew, setupFeeKept, feeStamp, posterFee, open, onClose, onCancelled }: CancellationDialogProps) => {
  // Q1674: the sentence both the policy text and the toast add for a first job.
  const keptFee = wasFunded && typeof setupFeeKept === "number" && setupFeeKept > 0 ? setupFeeKept : 0;
  const keptFeeSentence = keptFee > 0
    ? ` The one-time $${keptFee.toFixed(2)} account setup fee is kept: it is paid once and never refunded.`
    : "";
  // Is this a recurring PARENT? Fetched on open so the dialog can say the
  // one thing the card no longer says (owner: card = less hectic; the
  // cancel-scope warning belongs at the moment of cancelling).
  const [isSeriesParent, setIsSeriesParent] = useState(false);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void supabase
      .from("jobs")
      .select("recurrence_days, parent_job_id")
      .eq("id", jobId)
      .maybeSingle()
      .then(({ data, error }) => {
        // A dropped error here is user-visible, not cosmetic: on failure this
        // falls back to isSeriesParent=false and silently hides the
        // whole-series cancellation warning, so someone cancelling a
        // recurring parent is shown single-occurrence copy. Keep the safe
        // fallback, but make the failure observable instead of invisible.
        if (error) {
          report(error, {
            severity: "warning",
            tags: { source: "CancellationDialog.seriesParentLookup" },
            context: { job_id: jobId },
          });
        }
        if (alive) setIsSeriesParent(!!data && !data.parent_job_id && (data.recurrence_days?.length ?? 0) > 0);
      });
    return () => { alive = false; };
  }, [open, jobId]);

  const [reason, setReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  // Boards 66/172 slice 2: the SERVER's quote (create-payment cancel_quote).
  // "Back to you" is only ever its number: the exact refund needs the
  // charge's Stripe fee, tax, any gift and a first job's setup fee, none of
  // which this screen knows. Its fee is what poster_cancel_job is asked to
  // charge (p_expected_fee_cents). Null = not read (or not quotable): no
  // amount is shown, the cancel still works.
  const [quote, setQuote] = useState<PosterCancelQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteNonce, setQuoteNonce] = useState(0);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setQuoteLoading(true);
    void fetchPosterCancelQuote(jobId).then((q) => {
      if (!alive) return;
      setQuote(q);
      setQuoteLoading(false);
    });
    return () => { alive = false; };
  }, [open, jobId, quoteNonce]);
  // The server's fee, for a single booking (a crew prices per member below).
  const quotedFeeCents = !crew && typeof quote?.fee_cents === "number" ? quote.fee_cents : null;
  const backToYouCents = typeof quote?.back_to_you_cents === "number" ? quote.back_to_you_cents : null;

  // Tiered cancellation fee (only applies once a helpr has been selected):
  //   • 24+ hours before job  → 0%   (free cancellation)
  //   • Less than 24 hours    → 25%  (helpr has committed time)
  //   • Less than 2 hours     → 50%  (very late cancellation)
  // Both values come from the SAME module the edge function charges from.
  //
  // This used to be `new Date(jobDate + "T00:00:00")` plus a hand-copied
  // ladder. That string parses in the RUNTIME's zone, so the browser
  // (America/Chicago) and the edge function (Deno Deploy, UTC) disagreed by
  // 5-6 hours: a poster cancelling ~24.5h out was shown "free cancellation"
  // here and charged 25% of the budget by void-cancelled-payments.
  // CHANGED 2026-09-05: anchored on the job's START, not midnight of its day.
  // Midnight is never later than the real start, so the old maths could only
  // ever quote a HARSHER tier than the schedule earns — 41 hours of notice
  // read as 23 and showed 25% where the copy below promises free.
  const hoursUntilJob = (jobLocalStartMs(jobDate, jobStartTime) - Date.now()) / (1000 * 60 * 60);
  // Slice 2: the server quote's tier wins when it has one (same ladder, read
  // at the server's clock), so the percent and the fee below always agree.
  const cancellationFeePercent = quotedFeeCents !== null && typeof quote?.fee_percent === "number"
    ? quote.fee_percent
    : sharedCancellationFeePercent(hasHelper, hoursUntilJob);
  const feeTier = cancellationFeePercent === 50
    ? "Less than 2 hours before job"
    : cancellationFeePercent === 25
    ? "Less than 24 hours before job"
    : "24+ hours before job";
  // A crew's fee is one equal share per member who confirmed (Q407); the
  // helper-share lines below then describe ONE member's share.
  const crewQuote = crew ? crewCancellationFeeQuote(crew.members, jobBudget, crew.needed, hoursUntilJob) : null;
  const cancellationFee = crewQuote
    ? crewQuote.total
    : quotedFeeCents !== null
      ? quotedFeeCents / 100
      : Math.round(jobBudget * cancellationFeePercent) / 100;
  // The helper's share of the cancellation fee, from the POSTER's side.
  //
  // This used to read `jobs.helper_fee_percent`, on the belief that the column
  // freezes the assigned helper's commission rate. It does not: `create-payment`
  // stamps it from the GLOBAL `platform_settings.helper_fee_percent` at escrow
  // time, before any helper exists on the job, while `void-cancelled-payments`
  // re-resolves the helper's LIVE tier when it actually transfers. On a real
  // test job this dialog quoted the helper $54.00 and Stripe sent $55.20.
  //
  // The poster cannot resolve the helper's tier: `profiles` RLS lets a user
  // read only their OWN row (verified against pg_policies), and no public view
  // exposes `subscription_tier`. So quote the FLOOR instead of a false exact:
  // the free tier's 12% is the highest commission on the ladder, so the figure
  // shown is the least the helper can receive and is labelled "at least". A
  // number shown to a helper may never exceed what they are paid; the same
  // discipline applies to a number shown ABOUT a helper.
  // A flat-model job (Q1839) is priced from its own stamp, 5% + 70c, the cut
  // void-cancelled-payments takes. Floored to the whole dollar the transfer
  // really pays (Q236), in cancellationHelperShare.
  // Q1842: a flat-model job (F3, stamped at funding) was charged the job
  // price only, so there is no service fee to keep: its refund is what was
  // paid less the card-processing fee Stripe keeps (refundToPayerCents in
  // void-cancelled-payments). A job paid for before F3 keeps the old copy:
  // its budget comes back and the card-cost service fee it was charged stays.
  // A legacy job moved to the flat Helpr fee keeps its poster's service fee
  // on a cancel (owner 2026-10-21): cancelRefundIsLessCardFee says which copy.
  const flatModel = cancelRefundIsLessCardFee(feeStamp, posterFee);
  // JOBS-14 (owner 10-30): the strike is poster_cancel_job's v_late, the fee ladder's own window.
  const strikeApplies = hasHelper && cancellationFeePercent > 0;

  const handleCancel = async () => {
    setCancelling(true);
    try {
      // ONE call, ONE transaction, ONE outcome.
      //
      // This used to be three independent client round-trips: an UPDATE that
      // wrote status/cancelled_by/cancellation_fee/cancellation_fee_status
      // straight onto `jobs`, then a createNotification(), then a SEPARATE
      // apply_cancellation_violation_consequence() RPC. Nothing bound them.
      // A client that simply never made the third call cancelled a job with a
      // Helpr committed and recorded no strike — the ladder was opt-in, and
      // the opt-out was free. The fee was client-computed too, so the number
      // persisted on the row was whatever the caller sent.
      //
      // poster_cancel_job (migration 20260828020000) does all three server-
      // side in one transaction and DERIVES the fee from the same
      // cancellation_fee_percent/job_hours_until_start ladder
      // void-cancelled-payments recomputes from. The cancellation columns are
      // no longer writable by a client at all (trg_cancellation_requires_rpc),
      // so there is no path to the state change that skips the strike.
      // `p_reason` is OMITTED rather than passed as null when blank: the SQL
      // declares `p_reason text DEFAULT NULL`, so the two calls are identical,
      // and omitting is what the generated `Args` (`p_reason?: string`) can say.
      // Slice 2: the fee the server quoted (and this dialog shows) is the fee
      // poster_cancel_job may charge; a tier that moved since is refused there
      // (quote_changed) before anything is written.
      const expectedFeeCents = quotedFeeCents ?? undefined;
      let { data: verdict, error } = await supabase.rpc("poster_cancel_job", {
        p_job_id: jobId,
        p_reason: reason.trim() || undefined,
        p_expected_fee_cents: expectedFeeCents,
      });
      // Deploy lag (20261021130723 not live yet): the old two-argument
      // function does not know p_expected_fee_cents, so ask it the old way
      // (unchecked, exactly as before this slice).
      if (error && String(error.code ?? "") === "PGRST202" && expectedFeeCents !== undefined) {
        ({ data: verdict, error } = await supabase.rpc("poster_cancel_job", {
          p_job_id: jobId,
          p_reason: reason.trim() || undefined,
        }));
      }
      if (error && rpcErrorCode("poster_cancel_job", error) === "quote_changed") {
        // Nothing was cancelled. Show the new fee and let the poster decide again.
        // Reported (lh-money-escrow review): a tier crossing clears on the
        // re-quote, so the same job reported twice in a row means the quote and
        // poster_cancel_job price the fee differently, a defect to fix at once.
        report(error, {
          severity: "warning",
          tags: { source: "CancellationDialog.quoteChanged" },
          context: { job_id: jobId, expected_fee_cents: expectedFeeCents ?? null },
        });
        hapticError();
        toast.error(rpcErrorMessage("poster_cancel_job", error) ?? "The amount for your Helpr's time changed. Check the new amount and confirm again.");
        setQuoteNonce((n) => n + 1);
        return;
      }
      if (error) {
        // PGRST202 = merged but not yet deployed (db-deploy.yml runs on the
        // merge commit), so for a few minutes this RPC does not exist yet.
        // There is deliberately NO fallback to the old client-side UPDATE:
        // during that same window the guarding trigger is also absent, so the
        // fallback would succeed AND skip the ladder — it would re-open the
        // exact hole this change closes, on a timer. Say so and stop.
        if (String(error.code ?? "") === "PGRST202") {
          throw new Error(
            "Cancelling is briefly unavailable while an update finishes rolling out. Please try again in a few minutes.",
          );
        }
        // The RPC raises terse identifiers, and a PostgrestError is a plain
        // object — not an Error — so rethrowing it raw would fall past both
        // arms of the catch below and surface the generic "please try again"
        // for cases we can explain precisely. Translate the ones it defines.
        // `not_cancellable` is the state this dialog is most likely to hit: it
        // is the already-cancelled / already-finished race the previous
        // zero-row unwrapMutation guard existed to catch, now answered by the
        // server instead of inferred from a row count.
        // A job the Helpr already marked done is refused with its own HINT
        // (20260914215112). The mapper's generic not_cancellable line would
        // hide the one fact the poster needs: approve, ask for a change, or
        // dispute — so pass the server's hint through verbatim in that case.
        const doneHint = String(error.hint ?? "");
        if (String(error.message ?? "").trim() === "not_cancellable" && /already marked this job done/i.test(doneHint)) {
          throw new Error(doneHint);
        }
        throw new Error(
          rpcErrorMessage("poster_cancel_job", error) ??
            error.message ??
            "Couldn't cancel — please try again",
        );
      }

      const result = (verdict ?? {}) as {
        action?: string;
        cancellation_fee?: number;
        had_helper?: boolean;
      };
      const appliedFee = Number(result.cancellation_fee ?? 0);

      // The held Stripe payment is NOT voided here: void-cancelled-payments
      // only accepts cron/service-role auth (a client JWT gets a 401 — a
      // previous invoke from here failed on every call and was removed). The
      // hourly cron sweeps jobs with cancellation_fee_status='pending' and
      // processes the refund, so it lands within ~an hour of cancelling.
      //
      // The Helpr's "you'll be compensated" notification is now written by the
      // RPC in the same transaction, so a client that closes the tab mid-flow
      // can no longer cancel someone's job without telling them.

      if (result.action === "warning") {
        toast.warning("Cancellation warning (1 of 2) — cancelling again inside 24 hours of a start is a final warning.");
      } else if (result.action === "final_warning") {
        toast.warning("Final warning — one more cancellation inside 24 hours of a start and your account is restricted for 7 days pending review.");
      } else if (result.action === "pending_ban_review") {
        // A restriction is the most consequential message this product can
        // send, and a toast auto-dismisses. Route to the page that reads the
        // real ban_status off the profile, so it persists and says why.
        // window.location, not useNavigate: a full document load tears down
        // every cached authed query rather than leaving a restricted session
        // live in memory behind the screen, and it keeps this component
        // renderable without a Router (its unit tests rely on that).
        window.location.assign("/account-banned");
        return;
      }

      // Q?gift-cancel-copy: a gift that paid toward this job goes back to the
      // gift balance, not to a card, so the toast has to know whether one did.
      // The spent ('redeemed') row stays as it is (a restore mints a new row);
      // a 'reserved' one may be un-reserved under us, which reads as no gift.
      // A failed read says "unknown" and the toast stays neutral.
      let gift: ReturnType<typeof giftOnJobFromRead> = "unknown";
      let cardShareCents: number | null = null;
      const costCents = giftCostCents(jobBudget, jobUrgentFee, posterFee);
      try {
        const { data: giftRows, error: giftErr } = await supabase
          .from("gift_cards")
          .select("status, amount, payment_status")
          .eq("job_id", jobId)
          .in("status", ["redeemed", "reserved"])
          .limit(5);
        if (giftErr) report(giftErr, { severity: "warning", tags: { source: "CancellationDialog.giftRead" }, context: { job_id: jobId } });
        gift = giftOnJobFromRead(giftRows, giftErr, costCents);
        cardShareCents = cardShareCentsFromRead(giftRows, costCents);
      } catch (giftReadErr) {
        // The cancel itself succeeded; only the wording falls back to neutral.
        report(giftReadErr, { severity: "warning", tags: { source: "CancellationDialog.giftRead" }, context: { job_id: jobId } });
      }

      hapticSuccess();
      // Cancelling used to end in silence — the dialog closed, the card
      // vanished, and nothing said what happened to the money. That refund is
      // the one outcome a poster needs stated, so this confirmation names it.
      // It carries an action, which is also what lets it past the
      // suppress-plain-success toast policy (see lib/toastPolicy.ts).
      // The amount the SERVER applied, not the estimate this dialog rendered.
      // They agree (same ladder, same Chicago-midnight clock), but the row is
      // the authority now that the client no longer writes it.
      toast.success(
        // Nothing charged -> nothing to refund (an unfunded cancel used to be
        // told "the full amount returns to your card"); otherwise the refund
        // sentence for this job's fee model (src/lib/cancelRefundCopy.ts).
        cancelRefundToast({ wasFunded, cardHeld, appliedFee, flatModel, keptFeeSentence, gift, cardShareCents, keptSetupCents: Math.round(keptFee * 100), crew: !!crew }),
        { action: { label: "Dismiss", onClick: () => { /* toast closes itself */ } } },
      );
      onCancelled();
      onClose();
    } catch (err) {
      const message = isWriteRejected(err)
        ? err.userMessage
        : userFacingError(err, "Couldn't cancel — please try again.");
      hapticError();
      toast.error(message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent
       
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHero
          title={`Cancel "${jobTitle}"?`}
        />
        <div className="space-y-4">

          {/* Full Cancellation Policy */}
          <div className="rounded-ds-md border border-border bg-muted/30 p-4 space-y-3">
            <p className="text-ds-11 font-semibold text-foreground uppercase tracking-wide">Full Cancellation Policy</p>

            {/* Step 1: Before helpr selected */}
            <div className={`flex items-start gap-2.5 p-3 rounded-ds-sm border transition-all ${!hasHelper ? "bg-primary/10 border-primary/30 ring-1 ring-primary/20" : "bg-muted/20 border-border opacity-50"}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-ds-10 font-bold ${!hasHelper ? "bg-primary text-primary-foreground" : "bg-muted-foreground/20 text-muted-foreground"}`}>1</div>
              <div className="flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="text-ds-11 font-semibold text-foreground">Before a Helpr is selected</p>
                  {!hasHelper && <span className="text-ds-10 font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">YOU ARE HERE</span>}
                </div>
                {/* Says "budget refunded", not "full refund". The platform
                    service fee is deliberately withheld — Stripe keeps its cut
                    on a refund, so returning it would put the platform
                    out-of-pocket on every cancellation
                    (void-cancelled-payments/index.ts:320-331). A live run
                    charged $67.20 and refunded $60.00, exactly as designed —
                    while this text promised a "full refund", which is the part
                    that was wrong. */}
                <p className="text-ds-11 text-muted-foreground mt-0.5">
                  {/* Owner 2026-10-25: no fee names or numbers to members, only what comes back. */}
                  {/* A2-C29: a held card was never charged, and card-hold-sweep lets the hold go within about 10 minutes. */}
                  {cardHeld
                    ? "Cancel anytime before you hire. Your card was only held, never charged, and the hold is let go within about 10 minutes."
                    : "Cancel anytime before you hire. Most of your payment comes back to your card within the hour."}
                  {keptFeeSentence}
                </p>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <CheckCircle className="w-3 h-3 text-primary shrink-0" />
                  <span className="text-ds-11 text-primary font-medium">Nothing goes to a Helpr · No consequences</span>
                </div>
              </div>
            </div>

            <div className="flex justify-center"><ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 rotate-90" /></div>

            {/* Step 2: After helpr selected */}
            <div className={`p-3 rounded-ds-sm border space-y-2 transition-all ${hasHelper ? "bg-card border-border ring-1 ring-border" : "bg-muted/20 border-border opacity-50"}`}>
              <div className="flex items-start gap-2.5">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-ds-10 font-bold ${hasHelper ? "bg-foreground text-background" : "bg-muted-foreground/20 text-muted-foreground"}`}>2</div>
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-ds-11 font-semibold text-foreground">After a Helpr is selected</p>
                    {hasHelper && <span className="text-ds-10 font-bold bg-foreground text-background px-1.5 py-0.5 rounded-full">YOU ARE HERE</span>}
                  </div>
                  <p className="text-ds-11 text-muted-foreground mt-0.5">
                    Cancelling <strong className="text-foreground">24 or more hours before</strong> the start sends nothing to your Helpr. Closer to the start, part of the job pays your Helpr for the time they set aside, and it counts as a strike; you see the exact amount here before you confirm.
                  </p>
                  {hasHelper && keptFeeSentence && <p className="text-ds-11 text-muted-foreground mt-1">{keptFeeSentence.trim()}</p>}
                  {hasHelper && (
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <DollarSign className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="text-ds-11 text-foreground font-medium">
                        {cancellationFee > 0 ? `$${formatPrice(cancellationFee)} for your Helpr's time` : "Nothing for your Helpr's time"} · {strikeApplies ? "Strike recorded" : "No strike"}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {hasHelper && cancellationFee > 0 && (
                <div className="rounded-ds-sm bg-muted/50 border border-border p-3 space-y-1.5 ml-7">
                  <div className="flex justify-between text-ds-11">
                    <span className="text-muted-foreground">
                      {crewQuote ? "For your hired Helprs' time" : `For ${helperName || "your Helpr"}'s time`}
                    </span>
                    <span className="font-semibold text-foreground">${formatPrice(cancellationFee)}</span>
                  </div>
                  <p className="text-ds-11 text-muted-foreground">Most of the rest of your payment comes back to your card within the hour.</p>
                </div>
              )}

              {hasHelper && cancellationFee === 0 && (
                <div className="rounded-ds-sm bg-primary/10 border border-primary/20 p-3 ml-7 flex items-center gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="text-ds-11 text-primary font-medium">
                    No charge for your Helpr's time. {CANCEL_OVER_24H_NOT_A_STRIKE}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Strike system — always visible */}
          <div className={`rounded-ds-md border p-4 space-y-3 ${strikeApplies ? "border-destructive/30 bg-destructive/5" : "border-border bg-muted/20 opacity-60"}`}>
            <p className={`text-ds-11 font-semibold uppercase tracking-wide flex items-center gap-1.5 ${strikeApplies ? "text-destructive-ink" : "text-muted-foreground"}`}>
              <ShieldAlert className="w-3.5 h-3.5" /> Strike System (applies inside 24 hours of the start, once a Helpr is selected)
            </p>
            <div className="space-y-2 text-ds-11 text-muted-foreground">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-accent mt-0.5 shrink-0" />
                {CANCELLATION_LADDER_RUNGS.map((rung) => (
                  <p key={rung}>{rung}</p>
                ))}
              </div>
            </div>
            {!hasHelper && (
              <p className="text-ds-11 text-muted-foreground">✓ These consequences don&apos;t apply to you — no Helpr has been selected.</p>
            )}
            {hasHelper && !strikeApplies && (
              <p className="text-ds-11 text-muted-foreground">✓ These consequences don&apos;t apply to this cancel — the job is 24 or more hours away.</p>
            )}
          </div>

          {/* Series scope — stated at the decision (owner, 2026-08-24). */}
          {isSeriesParent && <CancelSeriesNotice />}

          {/* Fee summary callout: only when a non-zero fee applies (hasHelper + late). */}
          {hasHelper && cancellationFee > 0 && (
            <CancelFeeCallout fee={cancellationFee} crew={!!crewQuote} feeTier={feeTier} />
          )}

          {/* Boards 66/172 slice 2: "Back to you" is only ever the SERVER's number (see CancelBackToYou). */}
          {wasFunded && <CancelBackToYou quote={quote} quoteLoading={quoteLoading} backToYouCents={backToYouCents} />}

          {/* What the Helpr actually gets: gated on the FEE (see CancelHelprToldAndPaid). */}
          {hasHelper && cancellationFee > 0 && <CancelHelprToldAndPaid helperName={helperName} fee={cancellationFee} />}

          <div className="space-y-1.5">
            <label
              htmlFor="cancel-reason"
              className="text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground block"
            >
              Reason — optional
            </label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="rounded-ds-md bg-background/60 border-border/60 focus-visible:bg-background focus-visible:border-primary/40 font-sans text-ds-14"
            />
          </div>
        </div>
        {/* THE SHARED FOOTER ACTIONS.
            This was the app's last hand-built popup button, and it broke three
            standing rules at once. The commit painted a FLAT burnt-sienna with
            `backgroundImage: "none"` — the same explicit gloss-deletion that
            was removed from BrandConfirmDialog and PhotoProof — in the brand
            ACCENT colour, giving cancellation a third destructive treatment
            alongside `--destructive` red and the sienna BrandConfirmDialog had
            already given up. It also re-declared Montserrat (the global sans),
            its own weight, its own letter-spacing and its own shadow, so the
            one dialog a poster sees when money is about to move looked like it
            came from a different app. The dismiss carried `font-sans
            font-semibold` and an inline bark colour on top of the ghost
            variant that already styles it.
            Cancelling an accepted job charges a fee and cannot be undone here,
            so it is destructive; "Keep the Job" is the dismiss. Copy, fee
            arithmetic and handlers are untouched. */}
        <DialogFooter>
          <DialogSecondaryAction disabled={cancelling} onClick={onClose}>
            Keep the Job
          </DialogSecondaryAction>
          {/* Held while the quote loads, so the fee confirmed is the one quoted. */}
          <DialogDestructiveAction onClick={handleCancel} disabled={cancelling || quoteLoading}>
            {cancelling ? "Cancelling…" : cancellationFee > 0 ? `Cancel · pay $${formatPrice(cancellationFee)}` : "Cancel job"}
          </DialogDestructiveAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};