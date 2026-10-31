import { isTestObjectUnderLiveKey, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts";
import { serve } from "../_shared/buildStamp.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { boundedFetch } from "../_shared/boundedFetch.ts";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { readHelperFeePercentStrict, DEFAULT_TIER_FEE_PERCENT } from "../_shared/helperFees.ts";
import { flatFeePercentOf, helprFlatFeeCents, isFlatFeeJob } from "../_shared/helprFlatFee.ts";
import { computeCancellationFee } from "../_shared/cancellationFee.ts";
import { crewCancellationFee, returnsToPoster } from "../_shared/crewShares.ts";
import { refundsSeriesVisitInFull } from "../_shared/seriesRefund.ts";
import { actualOrEstimatedFeeCents, stripeProcessingCostCents } from "../_shared/stripeFees.ts";
import { setupFeeKeptCents } from "../_shared/posterFees.ts";
import { cardCostFeeCents, chargeTaxCentsFor, checkoutChargeTaxCents, posterCancelKeptFeeCents, refundToPayerCents, taxOnKeptCents, withheldFeeReturnCents } from "../_shared/refundAmount.ts";
import { refundReasonWithKeptParts } from "../_shared/refundReason.ts";
import { posterCancelSplit } from "../_shared/posterCancelSplit.ts";
import { isPosterFeeJob } from "../_shared/posterJobFee.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { loadAdminIds } from "../_shared/adminIds.ts";
import { feeTransferIdempotencyKey, formatExactDollars, isDefiniteStripeRefusal, formatPayoutDollars, roundPayoutDownCents, sourceChargeFor } from "../_shared/money.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";
import { checkUnsettledDispute } from "../_shared/unsettledDispute.ts";
import { insertNotifications } from "../_shared/insertNotifications.ts";
import { caughtMessage } from "../_shared/caughtMessage.ts";
import { paymentMethodFromCharge, refundDollars, refundNoticeProblem, retryFailedRefundEmails, sendRefundNotice, REFUND_EMAIL_MAX_ATTEMPTS } from "../_shared/refundNotice.ts";

/**
 * Q1714: the untold-refund sweep (Part G) looks at refunds made from here on.
 * Older ones went out before refunds were announced at all; telling those
 * people now is the owner's call, not this cron's.
 */
const UNTOLD_REFUND_SWEEP_FROM = "2026-10-12T12:00:00Z";
/**
 * Review of Q1806 (8354ebb0e) #1: dispute statuses on a gift's donation whose
 * reversal is not final. Open ones can still be won; a WON one brought the
 * money back, but the gift stays revoked until a person restores it
 * (alertGiftDisputeClosed is report-only). 'lost' and a plain refund are final.
 * A won dispute later refunded by hand also waits (accepted: the alert names
 * the row a person flips; delta re-review #3).
 */
const GIFT_DISPUTE_NOT_FINAL = new Set(["needs_response", "under_review", "warning_needs_response", "warning_under_review", "won"]);
import { checkIdentityHold, checkPayoutHold } from "../_shared/payoutHold.ts";
import { holdUnlessPayable } from "../_shared/livePayoutHold.ts";
import { payCrewBlockFees } from "../_shared/crewBlockFees.ts";
import { readCrewBlockFees, crewBlockFeeCents, type CrewBlockFeeRow } from "../_shared/crewBlockFeeRead.ts";
import { createStripeModeResolver, isPartyRefusal, jobMoneyMode, StripeModeRefused } from "../_shared/stripeMode.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Every path below that logs "money already moved but the DB write failed"
  // records here. Those are the worst defects this function can produce: Stripe
  // and Postgres disagree, and only a human can reconcile them.
  const defects = defectTracker();

  try {
    // Fail loud on missing config — previously masked by `?? ""` / `|| ""`
    // fallbacks below, which let the Stripe SDK constructor throw a generic
    // error outside the try block, producing a text/plain "Internal Server
    // Error" with no diagnostic context.
    const cronSecret = Deno.env.get("CRON_SECRET");
    const serviceRoleKey = Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const missing: string[] = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL");
    if (!stripeSecretKey) missing.push("STRIPE_SECRET_KEY");
    if (!serviceRoleKey) missing.push("SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
    // The `||` tail is logically redundant with `missing.length` — it is spelled
    // out so the compiler can narrow the three consts to `string` below. Without
    // it `createClient(supabaseUrl, serviceRoleKey)` and `new Stripe(key)` are
    // called with `string | undefined` as far as the types are concerned, which
    // is exactly the shape that hides a real missing-config crash.
    if (missing.length || !supabaseUrl || !stripeSecretKey || !serviceRoleKey) {
      throw new Error(`Missing required env vars: ${missing.join(", ")}`);
    }

    // Verify cron secret
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) && authHeader !== `Bearer ${serviceRoleKey}`)) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { global: { fetch: boundedFetch() } });

    // Stripe mode (owner 2026-10-12): every job is settled on the key of its own
    // mode (test accounts on the test key); a job mixing test and real
    // accounts, or one whose mode cannot be read, is skipped as a defect.
    const stripes = createStripeModeResolver(supabaseAdmin, (key) => new Stripe(key, { apiVersion: "2025-08-27.basil" }));

    /**
     * Give back the gift card that funded a job we are about to
     * write off.
     *
     * THE DEFECT THIS CLOSES: a gift-funded job that settles inline
     * (`redeem_gift_card`, gift >= cost) never opens a Stripe checkout, so
     * it reaches the loop below with no `stripe_payment_intent_id` and no
     * `stripe_session_id`. That took the "no payment was ever made — just
     * update status" branch, wrote payment_status='cancelled', and stopped.
     * Nothing anywhere un-did the redemption, so the credit stayed
     * 'redeemed' against a dead job and the recipient lost the gift
     * outright. There was no refund to chase: on a gift-card job the gift IS the
     * money, and no charge exists to reverse.
     *
     * Called for EVERY cancelled job, not just the no-PaymentIntent one. A
     * gift smaller than the job cost is redeemed alongside a Stripe charge
     * for the shortfall; that job DOES have a PaymentIntent, takes the
     * refund branch, and lost its gift just as completely. `no_credit` is
     * the RPC's cheap answer for the ordinary non-gift-card job.
     *
     * Returns whether the caller may proceed to settle the job.
     * FAIL CLOSED: if the restore could not be completed AND this job is
     * gift-funded, we refuse to flip it out of escrow. Settling it would
     * make the loss permanent — the selection query would never hand this
     * job back, so there would be no second chance. Leaving it in escrow
     * costs an hour and the next run retries. A non-gift job is never held
     * up by this.
     */
    const restorePifGift = async (
      job: { id: string; title: string },
      stage: string,
      /**
       * Q1490: cents of the gift that stay with the platform because they pay
       * a fee the poster owes out of this escrow (a crew member they blocked).
       * A fully gift-funded crew has no card to withhold it from, so without
       * this the whole gift came back and Part F paid the member from the
       * platform's balance.
       */
      withholdCents = 0,
      /** Q1806: what the kept cents paid, named in the poster's "gift is back" notice. */
      withholdReason = "the crew members whose spots you closed close to the start",
    ): Promise<{ ok: boolean; outcome: string | null }> => {
      let shareBps: number | undefined;
      let keptForBlockFees = 0;
      if (withholdCents > 0) {
        // What the gift paid toward this job, read without restoring anything.
        const { data: dry, error: dryErr } = await supabaseAdmin.rpc("restore_gift_card_for_job", {
          p_job_id: job.id,
          p_dry_run: true,
        });
        const d = (dry ?? null) as { outcome?: string; applied_cents?: number } | null;
        if (dryErr) {
          // Fail closed: the job stays in escrow and the next run retries.
          defects.record(`gift restore dry run ${job.id} (${stage}): ${dryErr.message}`);
          return { ok: false, outcome: null };
        }
        if (d?.outcome === "would_restore") {
          const applied = Math.max(0, Math.floor(Number(d.applied_cents ?? 0)));
          const target = Math.max(0, applied - withholdCents);
          // The RPC floors applied * bps / 10000: the largest bps that does not
          // overshoot the target, as process-scheduled-payouts sizes a crew's
          // gift share, so the gift never returns any of the withheld fee.
          shareBps = target <= 0 || applied <= 0 ? 0 : Math.min(10000, Math.floor(((target + 1) * 10000 - 1) / applied));
          keptForBlockFees = applied - Math.floor((applied * shareBps) / 10000);
          console.log(
            `[void-cancelled-payments] job ${job.id}: ${withholdCents}c of the gift is kept for fees the poster owes; restoring ${Math.floor((applied * shareBps) / 10000)}c of ${applied}c.`,
          );
        }
      }
      const { data, error: rpcErr } = await supabaseAdmin.rpc("restore_gift_card_for_job", {
        p_job_id: job.id,
        ...(shareBps !== undefined ? { p_share_bps: shareBps } : {}),
      });

      // A null `error` is not proof the restore happened — read the outcome
      // the function reports and accept only the ones it actually defines.
      const result = (data ?? null) as
        | { outcome?: string; credit_id?: string; recipient_id?: string; restore_cents?: number; payment_status?: string | null }
        | null;
      const outcome = rpcErr ? null : (result?.outcome ?? null);

      if (
        outcome === "no_credit" ||
        outcome === "job_not_found" ||
        outcome === "nothing_to_restore" ||
        outcome === "already_restored"
      ) {
        // Nothing to do, or a prior run already did it. Both are settled
        // states — proceed.
        return { ok: true, outcome };
      }

      if (outcome === "restored" || outcome === "unreserved") {
        const dollars = (Number(result?.restore_cents ?? 0) || 0) / 100;
        console.log(
          `[void-cancelled-payments] gift card ${outcome} for cancelled job ${job.id} (${stage}): $${dollars.toFixed(2)}, credit ${result?.credit_id}.`,
        );
        // Best-effort: the gift is already back in the recipient's hands, so
        // a failed notification must not undo the settlement. Never dropped
        // silently, though — a gift that reappears with no explanation is a
        // support ticket.
        // Review of 8354ebb0e #4: a gift whose donation was reversed comes back
        // minted 'refunded' (the RPC inherits the parent's payment_status), so
        // it cannot be spent: "available again" would be false. No notice.
        const reversedCopy = result?.payment_status != null && result.payment_status !== "paid";
        if (reversedCopy) {
          console.warn(
            `[void-cancelled-payments] gift for job ${job.id} came back as ${result?.payment_status} (its donation was reversed); the recipient is not told it is available again.`,
          );
        }
        if (result?.recipient_id && !reversedCopy) {
          const { error: noteErr } = await supabaseAdmin.from("notifications").insert({
            user_id: result.recipient_id,
            job_id: job.id,
            title: "Your gift is back",
            message: `"${job.title}" was cancelled, so the $${formatExactDollars(dollars)} gift you used on it is available again.` +
              // Q1490 review #6: say what the gift kept, as the card path does.
              (keptForBlockFees > 0
                ? ` $${formatExactDollars(Math.min(withholdCents, keptForBlockFees) / 100)} of it paid ${withholdReason}.`
                : ""),
            type: "payment",
            link: "/profile?tab=gift_card&show=received",
          });
          if (noteErr) {
            console.error(
              `[void-cancelled-payments] gift-restored notification failed for job ${job.id}:`,
              noteErr.message,
            );
          }
        }
        return { ok: true, outcome };
      }

      // ── Something went wrong. Was there a gift at stake at all? ──────────
      const reason = rpcErr
        ? `${rpcErr.message}${(rpcErr as { code?: string }).code ? ` (${(rpcErr as { code?: string }).code})` : ""}`
        : `unrecognised outcome ${JSON.stringify(result)}`;
      // Already given back? The ORIGINAL row stays 'redeemed' after a restore,
      // so without this an RPC outage after a restore read the gift as still
      // at stake and held the job in escrow, retried every hour (lh-money-
      // escrow review of Q454; the same check create-payment and the webhook
      // make).
      const { data: restoredRows, error: restoredErr } = await supabaseAdmin
        .from("gift_cards")
        .select("id, restored_from_job_id")
        .eq("restored_from_job_id", job.id)
        .limit(1);
      if (!restoredErr && (restoredRows ?? []).length > 0) {
        console.warn(
          `[void-cancelled-payments] restore_gift_card_for_job unavailable for job ${job.id} (${stage}): ${reason}, but its gift was already given back; settling.`,
        );
        return { ok: true, outcome: "already_restored" };
      }
      const { data: giftRows, error: giftErr } = await supabaseAdmin
        .from("gift_cards")
        .select("id")
        .eq("job_id", job.id)
        .in("status", ["redeemed", "reserved"])
        .limit(1);
      if (!restoredErr && !giftErr && (giftRows ?? []).length === 0) {
        // Not a gift-funded job, so nothing was at risk. The usual cause is
        // PGRST202 in the window between this code deploying and the
        // migration that defines the function landing — don't hold every
        // ordinary cancellation hostage to that.
        console.warn(
          `[void-cancelled-payments] restore_gift_card_for_job unavailable for job ${job.id} (${stage}): ${reason}. No gift on this job — settling anyway.`,
        );
        return { ok: true, outcome: null };
      }

      console.error(
        `CRITICAL: [void-cancelled-payments] job ${job.id} is gift-card-funded but its gift could not be restored (${stage}): ${reason}. Refusing to settle — the job stays in escrow so the next run can retry.`,
      );
      defects.record(`gift card restore ${job.id}: ${reason}`);
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Cancelled gift-funded job could not have its gift returned",
        message:
          `Job ${job.id} ("${job.title}") was funded by a gift card and is being cancelled, but restore_gift_card_for_job did not return the gift. The job is deliberately left in 'escrow' so the hourly run retries rather than settling and losing the gift for good.`,
        fields: {
          job_id: job.id,
          stage,
          reason: reason.slice(0, 200),
          gift_lookup: giftErr ? `failed: ${giftErr.message}` : "gift present",
        },
      });
      return { ok: false, outcome: null };
    };

    /**
     * Flip a cancelled job out of escrow, once, after its money has settled.
     *
     * Every one of the four call sites used to be a bare
     * `.update({...}).eq("id", job.id)` with no `.select("id")` and no state
     * precondition. That is the house's most-cited bug class, and here it had
     * teeth beyond the usual: a zero-row match returns
     * `{ data: [], error: null }`, so the job stayed `cancelled/escrow`, the
     * counters (`refunded++`, `voided++`) incremented anyway, and the run
     * reported success. The HOURLY cron then re-selected the very same job on
     * its next pass — and the next, forever. Past Stripe's ~24h idempotency
     * window the permanent unsalted keys stop deduping, so the loop issues a
     * SECOND real refund to the poster and a SECOND real fee transfer to the
     * helper. The zero-row silence was the engine of a repeating double payout,
     * not merely a stale row.
     *
     * The precondition is `payment_status='escrow'` — the same predicate the
     * selection query uses — so a job a webhook has since flipped to
     * 'chargeback', or an operator has refunded by hand, is never overwritten.
     * Returns true only when a row actually moved, so the callers' counters can
     * finally mean what they say.
     *
     * Modelled on execute-dispute-split:879-885, the reference implementation
     * for "the money already moved, so this write is not allowed to be quiet".
     */
    /**
     * Q1714: the poster is told, once, in the app and by email, whenever this
     * function sends money back: a released card hold (which raises no
     * charge.refunded) or a cancellation refund (told here with the amounts
     * computed here; the webhook's notice for the same refund is the safety
     * net and loses the claim). A released hold is told AFTER the job's state
     * writes, so a slow email never widens the window a cron timeout could
     * leave a job unsettled in (review of Q1714 #12); a refund is told right
     * after its ledger row, so this path wins the claim with its own amounts.
     */
    const tellPosterMoneyBack = async (
      job: { id: string; customer_id?: string | null },
      // deno-lint-ignore no-explicit-any
      pi: any,
      n: { key: string; kind: "refund" | "release"; amountCents: number; keptCents: number; keptReason: string | null; keptUnnamed?: boolean },
    ) => {
      const charge = pi?.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge : null;
      const result = await sendRefundNotice(supabaseAdmin, {
        key: n.key,
        kind: n.kind,
        paymentIntentId: pi.id,
        amountCents: n.amountCents,
        keptCents: n.keptCents,
        keptReason: n.keptReason,
        keptUnnamed: n.keptUnnamed,
        recipientId: job.customer_id ?? null,
        jobId: job.id,
        method: paymentMethodFromCharge(charge),
      });
      const problem = refundNoticeProblem(result);
      if (problem) {
        console.error(`[void-cancelled-payments] ${n.key} for job ${job.id}: ${problem}`);
        defects.record(`refund notice ${job.id}: ${problem}`);
        await postSlackOpsAlert({
          kind: "custom",
          severity: "warning",
          title: "Money went back to a poster who was not fully told",
          message: `${n.key} (${refundDollars(n.amountCents)}) for job ${job.id}: ${problem}. Tell them by hand.`,
          fields: { job_id: job.id, notice: n.key, status: result.status },
          oncePerDayKey: `refund-notice:${n.key}`,
        });
      }
    };

    /**
     * Q1806: what a gift paid toward this job that can fund a fee the poster
     * owes, read WITHOUT restoring anything.
     *   - 'would_restore': `cents` is what the gift paid.
     *   - 'already_restored' (a run restored it, then its status flip failed):
     *     `restored`, and `cents` is only what that restore KEPT (0 when the RPC
     *     does not say), so a gift an earlier run gave back whole funds nothing.
     *   - no gift on the job: 0.
     *   - `donationReversed` (review of Q1806 #1): the donor's purchase behind
     *     the gift was refunded or charged back (revoke_gift_card_for_refund
     *     stamps the spent row's payment_status), so the platform no longer
     *     holds that money and a fee "from the gift" would be its own.
     *   - `disputeOpen` (review of 8354ebb0e #1): that reversal is a chargeback
     *     the platform can still win, or won and a person has not yet given the
     *     gift back (revoke_gift_card_for_refund stamps 'refunded' when the
     *     dispute OPENS, and a won dispute is never flipped back by itself), so
     *     the loss is not final. Read from the donor's PaymentIntent (the root
     *     of the gift's tree) with Stripe's disputes list. A plain refund or a
     *     lost dispute is final. Asked in the DONATION's Stripe mode, not the
     *     job's (delta re-review #2: a real buyer can gift a test account, so a
     *     live gift can fund a test job): the mode whose Stripe knows the PI.
     *   - `spentGiftId`: the gift row this job spent, which a person flips back
     *     to 'paid' if a dispute is won (it is the row read here).
     * Null: unreadable, and the caller fails closed.
     */
    const giftFeeFunding = async (
      jobId: string,
    ): Promise<{ cents: number; restored: boolean; donationReversed: boolean; disputeOpen: boolean; spentGiftId?: string } | null> => {
      const { data, error: dryErr } = await supabaseAdmin.rpc("restore_gift_card_for_job", {
        p_job_id: jobId,
        p_dry_run: true,
      });
      if (dryErr) return null;
      const d = (data ?? null) as { outcome?: string; applied_cents?: number | null; restore_cents?: number | null } | null;
      let cents: number;
      let restored = false;
      if (d?.outcome === "would_restore") {
        cents = Math.max(0, Math.floor(Number(d.applied_cents ?? 0)));
      } else if (d?.outcome === "already_restored") {
        restored = true;
        cents = d.applied_cents === undefined || d.applied_cents === null
          ? 0
          : Math.max(0, Math.floor(Number(d.applied_cents)) - Math.floor(Number(d.restore_cents ?? 0)));
      } else if (d?.outcome === "no_credit" || d?.outcome === "would_unreserve" || d?.outcome === "job_not_found") {
        return { cents: 0, restored: false, donationReversed: false, disputeOpen: false };
      } else {
        return null;
      }
      if (cents <= 0) return { cents, restored, donationReversed: false, disputeOpen: false };
      const { data: spent, error: spentErr } = await supabaseAdmin
        .from("gift_cards")
        .select("id, payment_status, parent_credit_id, stripe_payment_intent_id")
        .eq("job_id", jobId)
        .eq("status", "redeemed")
        .limit(1);
      if (spentErr) return null;
      // A gift that paid something always has its 'redeemed' row: none back is
      // unreadable, never "not reversed" (re-review nit 1, fails closed).
      type GiftRow = { id?: string; payment_status?: string | null; parent_credit_id?: string | null; stripe_payment_intent_id?: string | null };
      const spentRow = (spent ?? [])[0] as GiftRow | undefined;
      if (!spentRow) return null;
      const spentGiftId = spentRow.id;
      if (spentRow.payment_status === "paid") return { cents, restored, donationReversed: false, disputeOpen: false, spentGiftId };
      // Reversed: is it final? The donor's PaymentIntent sits on the root of
      // the gift's tree (a leftover or a restore points at its parent).
      let node: GiftRow = spentRow;
      for (let hop = 0; !node.stripe_payment_intent_id && node.parent_credit_id && hop < 20; hop++) {
        const { data: parent, error: parentErr } = await supabaseAdmin
          .from("gift_cards")
          .select("parent_credit_id, stripe_payment_intent_id")
          .eq("id", node.parent_credit_id)
          .limit(1);
        if (parentErr) return null;
        const next = (parent ?? [])[0] as GiftRow | undefined;
        if (!next) return null;
        node = next;
      }
      // No donor payment to ask Stripe about: unreadable, never "final".
      if (!node.stripe_payment_intent_id) return null;
      const donorPi = node.stripe_payment_intent_id;
      let donorStripe: Stripe | null = null;
      for (const mode of ["live", "test"] as const) {
        let client: Stripe;
        try {
          client = stripes.clientFor(mode);
        } catch (keyErr) {
          // No key for this mode here: the donation cannot be in it.
          console.warn(`[void-cancelled-payments] job ${jobId}: no ${mode} Stripe client for its gift's donation: ${caughtMessage(keyErr)}`);
          continue;
        }
        try {
          await client.paymentIntents.retrieve(donorPi);
          donorStripe = client;
          break;
        } catch (e) {
          if ((e as { code?: string } | null)?.code === "resource_missing") continue;
          console.error(`[void-cancelled-payments] job ${jobId}: its gift's donation could not be read: ${caughtMessage(e)}`);
          return null;
        }
      }
      if (!donorStripe) return null;
      let disputes: Array<{ status?: string | null }>;
      try {
        const list = await donorStripe.disputes.list({ payment_intent: donorPi, limit: 10 });
        disputes = (list?.data ?? []) as Array<{ status?: string | null }>;
      } catch (e) {
        console.error(`[void-cancelled-payments] job ${jobId}: the disputes on its gift's donation could not be read: ${caughtMessage(e)}`);
        return null;
      }
      const disputeOpen = disputes.some((d) => GIFT_DISPUTE_NOT_FINAL.has(String(d.status ?? "")));
      return { cents, restored, donationReversed: true, disputeOpen, spentGiftId };
    };

    const settleCancelledJob = async (
      job: { id: string; title: string },
      patch: Record<string, unknown>,
      stage: string,
      /** Q1490: gift cents kept to pay what the poster owes (see restorePifGift). */
      withholdGiftCents = 0,
      /** Q1806: what those cents paid, for the poster's notice. */
      withholdReason?: string,
    ): Promise<boolean> => {
      // Return the gift BEFORE the job leaves escrow. Ordering matters: the
      // selection query at the top of this run is
      // (status='cancelled', payment_status='escrow'), so a job that has
      // been flipped is never handed back. Restoring first means a restore
      // that succeeds and a flip that fails still leaves the recipient
      // whole, and the restore is idempotent so the retry is a no-op.
      if (!(await restorePifGift(job, stage, withholdGiftCents, withholdReason)).ok) return false;

      const { data, error: flipErr } = await supabaseAdmin
        .from("jobs")
        .update(patch)
        .eq("id", job.id)
        .eq("payment_status", "escrow")
        .select("id");
      if (!flipErr && data && data.length > 0) return true;

      const zeroRow = !flipErr;
      console.error(
        `CRITICAL: [void-cancelled-payments] job ${job.id} settled in Stripe (${stage}) but the status flip ${zeroRow ? "matched ZERO rows — payment_status is no longer 'escrow'" : `failed: ${flipErr?.message}`}. The job will be re-selected next hour; past Stripe's 24h idempotency window that means a SECOND real refund.`,
      );
      defects.record(
        `DB/Stripe divergence after ${stage} ${job.id}: ${zeroRow ? "zero rows matched" : flipErr?.message ?? "update failed"}`,
      );
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Cancelled job settled in Stripe but not in the database",
        message:
          `Money moved for job ${job.id} ("${job.title}") during ${stage}, but jobs.payment_status did not leave 'escrow'. The hourly cron will keep re-selecting this job, and past Stripe's ~24h idempotency window that produces a second real refund and a second fee transfer. Settle this row by hand before then.`,
        fields: {
          job_id: job.id,
          stage,
          reason: zeroRow ? "zero rows matched (payment_status changed under the run)" : (flipErr?.message ?? "update failed").slice(0, 200),
        },
      });
      return false;
    };

    // Transfer the cancellation fee (minus platform commission) to the helper.
    // Shared by BOTH settlement branches (captured-then-refunded AND
    // uncaptured-hold-partial-capture) so a helper is paid identically however
    // the escrow was held. Best-effort: a failed transfer notifies admins but
    // never throws — the customer's refund/capture has already succeeded and
    // must not be rolled back over a payout hiccup.
    //
    // LEDGER (LOW-2): every fee this path owes is a cancellation_fee_transfers
    // row, never a payout_transfers row (a row there is a job payout: the
    // webhook would flip the job to released and the refund guard below would
    // refuse the job). Claim before transfer: a 'pending' row is inserted
    // FIRST (UNIQUE (job_id, helper_id) is the claim), the transfer's
    // idempotency key and metadata.fee_transfer_id come from that row, and the
    // row is then marked 'paid' with the transfer id, 'failed' with a reason,
    // or 'waived' when the commission leaves nothing to send. A 'pending' or
    // 'failed' row is retried by Part E after the job settles.
    type FeeRow = {
      id: string;
      status: string;
      stripe_transfer_id: string | null;
      created_at: string | null;
      fee_amount: number | string;
      commission_percent: number | string;
      platform_cut: number | string;
      helper_amount: number | string;
      /** Q2356: every transfer of this fee Stripe reported failed or canceled (the stripe-webhook records them). */
      failed_transfer_ids?: string[] | null;
    };
    const FEE_ROW_COLUMNS = "id, status, stripe_transfer_id, created_at, fee_amount, commission_percent, platform_cut, helper_amount, failed_transfer_ids";
    /**
     * Q2356: the transfers of a fee ledger row (single fee or crew share) that are NOT payments: every one the
     * webhook remembered as failed or canceled, and the row's own current transfer while the row says failed.
     * A failed or canceled transfer is not `reversed` in Stripe, so a dedupe that only skipped reversed ones
     * marked the row paid with the Helpr never paid.
     */
    const failedFeeTransferIds = (row: { status: string; stripe_transfer_id: string | null; failed_transfer_ids?: string[] | null }): Set<string> => {
      const ids = new Set<string>(row.failed_transfer_ids ?? []);
      if (row.status === "failed" && row.stripe_transfer_id) ids.add(row.stripe_transfer_id);
      return ids;
    };
    /** A claim younger than this belongs to a run still in flight. */
    const FEE_CLAIM_INFLIGHT_MS = 2 * 60 * 1000;

    const markFeeRow = async (
      jobId: string,
      row: { id: string; status: string },
      patch: Record<string, unknown>,
      stage: string,
    ): Promise<boolean> => {
      // Compare-and-swap on the status this run read: a row the webhook (or a
      // concurrent run) moved since then is not overwritten — in particular a
      // webhook-set 'failed' or 'reversed' is never walked back to 'paid'.
      const { data, error } = await supabaseAdmin
        .from("cancellation_fee_transfers")
        .update(patch)
        .eq("id", row.id)
        .eq("status", row.status)
        .select("id");
      let why: string | null = error ? error.message : null;
      if (!error && (!data || data.length === 0)) {
        // Zero rows: someone else moved it. transfer.created usually lands
        // before this write, and has already recorded exactly what we meant
        // to — that is success, not an alert. Anything else is out of step.
        const { data: now, error: rereadErr } = await supabaseAdmin
          .from("cancellation_fee_transfers")
          .select("status, stripe_transfer_id")
          .eq("id", row.id)
          .maybeSingle();
        if (rereadErr) {
          why = `zero rows matched; re-read failed: ${rereadErr.message}`;
        } else if (
          now &&
          now.status === patch.status &&
          (patch.stripe_transfer_id === undefined || now.stripe_transfer_id === patch.stripe_transfer_id)
        ) {
          return true;
        } else {
          why = `zero rows matched (row now ${now ? `${now.status}/${now.stripe_transfer_id ?? "no transfer"}` : "missing"})`;
        }
      }
      if (why === null) return true;
      console.error(
        `CRITICAL: [void-cancelled-payments] cancellation fee row ${row.id} (job ${jobId}) ${stage} but the ledger write did not land: ${why}`,
      );
      defects.record(`cancellation fee ledger ${row.id} ${stage}: ${why}`);
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "critical",
        title: "Cancellation-fee ledger out of step with Stripe",
        message: `A Helpr's cancellation fee for job ${jobId} ${stage}, but cancellation_fee_transfers was not updated. The Stripe transfer-group check still stops a second payment; reconcile the row by hand.`,
        fields: { job_id: jobId, fee_transfer_id: row.id, stage, db_error: why.slice(0, 200) },
      });
      return false;
    };

    const payHelperCancellationFee = async (
      job: { id: string; title: string; helper_id: string | null; helper_fee_percent?: number | string | null; helper_fee_flat_cents?: number | string | null; is_seed?: boolean | null },
      cancellationFee: number,
      /**
       * Q1806: null for a fully gift-funded job (no card was charged). The fee
       * then goes from the platform balance the gift paid into, with no
       * source_transaction; the caller has kept it from the gift first.
       */
      pi: Stripe.PaymentIntent | null,
      // Q1358: Part A resolves the rate BEFORE any money moves (a failed read
      // there leaves the job in escrow for the next run) and hands it in here.
      preResolvedPercent: number | undefined,
      /** The client of this job's Stripe mode (owner 2026-10-12). */
      stripe: Stripe,
    ): Promise<boolean> => {
      // Q1806: resolves to whether the fee is on the ledger (claimed, paid,
      // waived, or nothing owed). False only when this run stopped BEFORE a row
      // existed (a failed read or claim): the gift-funded branch then leaves the
      // job in escrow, because settling it would keep the fee from the gift with
      // no row for Part E to pay it from.
      if (!(cancellationFee > 0) || !job.helper_id) return true;
      const helperId = job.helper_id;

      // ── 1. What does the ledger already say? Fails CLOSED. ──
      const { data: existingRow, error: rowReadErr } = await supabaseAdmin
        .from("cancellation_fee_transfers")
        .select(FEE_ROW_COLUMNS)
        .eq("job_id", job.id)
        .eq("helper_id", helperId)
        .maybeSingle();
      if (rowReadErr) {
        console.error(`[void-cancelled-payments] cancellation fee ledger read failed for job ${job.id}; not transferring:`, rowReadErr.message);
        defects.record(`cancellation fee ledger read ${job.id}: ${rowReadErr.message} — fee not sent`);
        return false;
      }
      let row = existingRow as FeeRow | null;
      if (row && ["paid", "reversed", "waived"].includes(row.status)) return true;
      if (
        row && row.status === "pending" && !row.stripe_transfer_id && row.created_at &&
        Date.now() - new Date(row.created_at).getTime() < FEE_CLAIM_INFLIGHT_MS
      ) {
        console.log(`[void-cancelled-payments] cancellation fee for job ${job.id} is claimed by a run in flight (${row.id}); leaving it.`);
        return true;
      }

      // ── 2. Price it. A resumed row keeps the price it was claimed at. ──
      let commissionPercent: number;
      let platformCut: number;
      let helperPayout: number;
      if (row) {
        commissionPercent = Number(row.commission_percent);
        platformCut = Number(row.platform_cut);
        helperPayout = Number(row.helper_amount);
      } else {
        // Resolve commission from the helper's live subscription tier. The
        // FALLBACK is what matters here: every path that resolves a helper
        // commission (create-payment, release-payout,
        // process-scheduled-payouts, execute-dispute-split) falls back to
        // `job.helper_fee_percent` — the rate frozen onto the job when escrow
        // was funded — and then to the FREE-tier rate. Prefer the frozen
        // per-job rate so a cancellation settles at the same percentage the
        // job was funded at. Derived from DEFAULT_TIER_FEE_PERCENT, never a
        // literal, so the ladder stays the single source of truth.
        const frozenPercent =
          job.helper_fee_percent === null || job.helper_fee_percent === undefined
            ? null
            : Number(job.helper_fee_percent);
        // Q1358: a FAILED tier read is not priced at the fallback: the rate
        // is stored on the claim row below and a retry reuses it, so a
        // transient error would fix a wrong commission for good. Part A reads
        // it before any money moves (preResolvedPercent) and skips the whole
        // job on an error; this read is the backstop for any other caller,
        // and pages because nothing would retry it.
        if (preResolvedPercent !== undefined) {
          commissionPercent = preResolvedPercent;
        } else if (flatFeePercentOf(job) !== null) {
          // Roadmap F3: a flat-model job keeps its stamp; no tier read.
          commissionPercent = flatFeePercentOf(job)!;
        } else {
          const feeRead = await readHelperFeePercentStrict(
            supabaseAdmin,
            helperId,
            (frozenPercent !== null && Number.isFinite(frozenPercent) ? frozenPercent : undefined) ??
              DEFAULT_TIER_FEE_PERCENT,
          );
          if (!feeRead.ok) {
            console.error(`[void-cancelled-payments] helper fee read failed for ${helperId} (job ${job.id}); fee not priced: ${feeRead.error}`);
            defects.record(`cancellation fee tier read ${job.id}: ${feeRead.error} — fee not sent`);
            await postSlackOpsAlert({
              kind: "payout_failed",
              severity: "critical",
              title: "Cancellation fee not paid: the Helpr's fee tier could not be read",
              message: `The Helpr's cancellation fee for job ${job.id} was not priced or sent, and no ledger row exists for a retry to find. Pay it by hand.`,
              fields: { job_id: job.id, helper_id: helperId, fee: cancellationFee, error: feeRead.error.slice(0, 200) },
            });
            return false;
          }
          commissionPercent = feeRead.percent;
        }
        // A flat-model job (F3): the Helpr pays 5% + 70c on the fee they
        // receive, as on any other pay; a legacy job keeps the tier percent.
        platformCut = isFlatFeeJob(job)
          ? helprFlatFeeCents(Math.round(cancellationFee * 100), job) / 100
          : Math.round(cancellationFee * (commissionPercent / 100) * 100) / 100;
        // Whole dollars, rounded DOWN; the platform keeps the cents (Q236).
        helperPayout = roundPayoutDownCents(Math.round((cancellationFee - platformCut) * 100)) / 100;
      }

      // ── 3. Claim. A 23505 means another run holds it; it pays, we don't. ──
      if (!row) {
        const waived = !(helperPayout > 0);
        const { data: claimed, error: claimErr } = await supabaseAdmin
          .from("cancellation_fee_transfers")
          .insert({
            job_id: job.id,
            helper_id: helperId,
            fee_amount: cancellationFee,
            commission_percent: commissionPercent,
            platform_cut: platformCut,
            helper_amount: waived ? 0 : helperPayout,
            status: waived ? "waived" : "pending",
          })
          .select(FEE_ROW_COLUMNS)
          .single();
        if (claimErr || !claimed) {
          if (claimErr?.code === "23505") {
            console.log(`[void-cancelled-payments] cancellation fee for job ${job.id} was claimed by another run; leaving it.`);
            return true;
          }
          // No claim, no transfer: without a row the transfer would be money
          // nothing records. Reconciliation's charged-fee check pages on it.
          console.error(`[void-cancelled-payments] cancellation fee claim failed for job ${job.id}; not transferring:`, claimErr?.message ?? "no row returned");
          defects.record(`cancellation fee claim ${job.id}: ${claimErr?.message ?? "no row returned"} — fee not sent`);
          return false;
        }
        row = claimed as FeeRow;
        // Nothing left after commission: recorded as waived, nothing to send.
        if (waived) return true;
      }
      const feeRow: FeeRow = row;
      const wasFailed = feeRow.status === "failed";

      // ── 4. Has Stripe already sent it? ──
      // The idempotency key below only replays for ~24h, so ask Stripe what
      // actually exists rather than trusting the key: the job's transfer group
      // (`job_${id}`, the grouping release-payout and process-scheduled-payouts
      // use) is listed, and a live cancellation_fee transfer to this Helpr
      // repairs the ledger instead of paying again.
      const feeGroup = `job_${job.id}`;
      /** Q1806: what is already linked to this job's charge (sourceChargeFor). */
      let groupTransfers: Stripe.Transfer[] = [];
      try {
        const priorFeeTransfers = await stripe.transfers.list({ transfer_group: feeGroup, limit: 100 });
        groupTransfers = priorFeeTransfers.data ?? [];
        // Q2356: a transfer this row remembers as failed or canceled is not a payment.
        const knownFailed = failedFeeTransferIds(feeRow);
        const alreadyPaidFee = priorFeeTransfers.data.find(
          (t) =>
            t.metadata?.type === "cancellation_fee" && !t.reversed && !t.metadata?.share_id &&
            !knownFailed.has(t.id) &&
            (!t.metadata?.helper_id || t.metadata.helper_id === helperId),
        );
        if (alreadyPaidFee) {
          console.log(
            `[void-cancelled-payments] cancellation fee for job ${job.id} already transferred (${alreadyPaidFee.id}); repairing the ledger, not sending a second one.`,
          );
          await markFeeRow(job.id, feeRow, {
            status: "paid",
            stripe_transfer_id: alreadyPaidFee.id,
            paid_at: new Date().toISOString(),
            failure_reason: null,
          }, `was already paid in Stripe (${alreadyPaidFee.id})`);
          return true;
        }
      } catch (listErr) {
        // Fail CLOSED. Without knowing whether the fee already went out, sending
        // it is a coin flip on a second real transfer. The row stays open and
        // Part E retries once the job settles.
        console.error(`[void-cancelled-payments] could not list prior fee transfers for job ${job.id}:`, listErr);
        defects.record(`fee-transfer dedupe list ${job.id}: ${(listErr as Error).message}`);
        return true;
      }

      // ── 5. Payout hold (Q764). The row stays open (pending or failed) and
      // Part E retries it every run, so the fee is sent on the first run after
      // an admin releases the hold. A hold is an outcome, not a defect; an
      // unreadable hold fails closed and is one.
      const feeHold = await checkPayoutHold(supabaseAdmin, helperId);
      if (feeHold.kind === "error") {
        console.error(`[void-cancelled-payments] payout hold check failed for job ${job.id} (Helpr ${helperId}); not transferring: ${feeHold.message}`);
        defects.record(`cancellation fee hold check ${job.id}: ${feeHold.message} — fee not sent`);
        return true;
      }
      if (feeHold.kind === "held") {
        console.log(`[void-cancelled-payments] cancellation fee for job ${job.id} not sent: Helpr ${helperId} is on a payout hold.`);
        return true;
      }
      // No payout without a verified ID (owner 2026-10-30): the row stays open, retried each run.
      const feeIdHold = await checkIdentityHold(supabaseAdmin, helperId);
      if (feeIdHold.kind === "error") {
        defects.record(`cancellation fee ID check ${job.id}: ${feeIdHold.message} — fee not sent`);
        return true;
      }
      if (feeIdHold.kind === "waits") return true;

      // ── 6. Where does it go? ──
      const { data: helperProfile, error: helperProfileErr } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", helperId)
        .single();
      if (helperProfileErr || !helperProfile?.stripe_account_id) {
        // A dropped read or a Helpr with no payout account yet used to skip the
        // fee with no record at all. Now the row says why, and Part E retries.
        const why = helperProfileErr
          ? `profile read failed: ${helperProfileErr.message}`
          : "no payout account";
        console.error(`[void-cancelled-payments] cancellation fee for job ${job.id} (Helpr ${helperId}) not sent: ${why}`);
        await markFeeRow(job.id, feeRow, { status: "failed", failure_reason: why.slice(0, 500) }, `could not be sent (${why.slice(0, 80)})`);
        // Already failed and paged once: Part E keeps retrying quietly.
        if (wasFailed) return true;
        defects.record(`cancellation fee ${job.id}: ${why}`);
        await postSlackOpsAlert({
          kind: "payout_failed",
          severity: "warning",
          title: "Cancellation-fee payout not sent",
          message: "A Helpr's cancellation fee could not be sent. The poster's fee is already captured; the hourly run retries it from cancellation_fee_transfers.",
          fields: { job_id: job.id, helper_id: helperId, fee_transfer_id: feeRow.id, amount: helperPayout, reason: why.slice(0, 200) },
        });
        return true;
      }

      // Lead 2026-10-23 (Stripe rejected the platform and its connected accounts): no transfer
      // unless Stripe says the Helpr's account is payable
      // (_shared/livePayoutHold.ts). The same exit as a payout hold above.
      const feeLive = await holdUnlessPayable({
        stripe,
        supabaseAdmin,
        helperId,
        accountId: helperProfile.stripe_account_id,
        fn: "void-cancelled-payments",
        what: "a cancellation fee",
        then: "The hourly run retries it.",
        seed: job.is_seed === true,
        fields: { job_id: job.id, fee_row: `${feeRow.id}`, amount: helperPayout },
      });
      if (feeLive.held) {
        // The row stays 'pending' (Part E retries it) and says why, so the
        // reconciler's "read failure_reason" has an answer (review #7).
        await markFeeRow(job.id, feeRow, { failure_reason: `payee_not_payable: ${feeLive.kind}` }, `held (payee_not_payable: ${feeLive.kind})`);
        if (feeLive.defect) defects.record(`cancellation fee ${job.id}: ${feeLive.defect}`);
        return true;
      }

      // ── 7. Transfer, keyed to the row; then mark it. ──
      try {
        const transferParams: Record<string, unknown> = {
          amount: roundPayoutDownCents(Math.round(helperPayout * 100)),
          currency: "usd",
          destination: helperProfile.stripe_account_id,
          transfer_group: feeGroup,
          metadata: {
            job_id: job.id,
            helper_id: helperId,
            type: "cancellation_fee",
            platform_cut: platformCut,
            fee_transfer_id: String(feeRow.id),
          },
        };
        // Link to the source charge so the transfer draws from these funds,
        // only when it fits there (Q1806): a gift-plus-card job's card charge
        // can be smaller than the fee, and Stripe refuses a linked transfer
        // larger than its charge. One that does not fit goes from the platform
        // balance the gift paid into; Part A kept that much from the gift.
        const feeSource = sourceChargeFor(pi, transferParams.amount as number, groupTransfers);
        if (feeSource) {
          transferParams.source_transaction = feeSource;
        } else if (pi?.latest_charge) {
          console.log(`[void-cancelled-payments] cancellation fee for job ${job.id} does not fit in its card charge; sent from the platform balance, unlinked.`);
        }
        const transfer = await stripe.transfers.create(transferParams as unknown as Stripe.TransferCreateParams, {
          // Q1381: a retry of a failed row is a new attempt, not Stripe's replay of the failure.
          idempotencyKey: feeTransferIdempotencyKey(`cancel-fee-${feeRow.id}`, wasFailed),
        });
        console.log(`Cancellation fee $${cancellationFee}: platform kept $${platformCut}, transferred $${helperPayout} to helper ${helperId} for job ${job.id} (${transfer.id})`);
        await markFeeRow(job.id, feeRow, {
          status: "paid",
          stripe_transfer_id: transfer.id,
          paid_at: new Date().toISOString(),
          failure_reason: null,
        }, `was paid (${transfer.id})`);

        await insertNotifications(supabaseAdmin, {
          user_id: helperId,
          job_id: job.id,
          // Owner 2026-10-25: the amount they get, never a fee name or rate.
          title: "Payment for a cancelled job",
          message: `You received $${formatPayoutDollars(helperPayout)} for "${job.title}", which was cancelled.`,
          type: "payment",
          link: "/profile?tab=earnings",
        });
      } catch (transferErr: any) {
        console.error(`Failed to transfer cancellation fee to helper ${helperId}:`, transferErr);
        const reason = String(transferErr?.message ?? transferErr).slice(0, 500);
        if (!isDefiniteStripeRefusal(transferErr)) {
          // Q1381 review: the transfer may exist. The row keeps its status, so
          // the next attempt reuses this same key and Stripe dedupes it.
          defects.record(`cancellation fee transfer ${job.id}: outcome unknown (${reason.slice(0, 160)}); retried under the same key`);
          return true;
        }
        await markFeeRow(job.id, feeRow, { status: "failed", failure_reason: reason }, `transfer failed (${reason.slice(0, 80)})`);
        // Already failed and paged once: Part E keeps retrying quietly.
        if (wasFailed) return true;
        // A defect, not just a bell item: the Helpr is unpaid until Part E's
        // retry succeeds or a person acts. `admin_alert` is what the admin
        // push->Slack mirror pages on (docs/OPEN.md Q2 review, 2026-09-23).
        defects.record(`cancellation fee transfer ${job.id}: ${reason}`);
        const { ids: adminIds } = await loadAdminIds(supabaseAdmin, "void-cancelled-payments.feeTransferFailed");
        for (const adminId of adminIds) {
          await insertNotifications(supabaseAdmin, {
            user_id: adminId,
            title: "Cancellation fee transfer failed",
            message: `Failed to transfer $${cancellationFee.toFixed(2)} cancellation fee to Helpr for job ${job.id}. Error: ${reason}`,
            type: "admin_alert",
            link: `/admin?view=jobs&job=${job.id}`,
          });
        }
      }
      return true;
    };

    // ── A crew's cancellation fee: one transfer per member (Q407) ──────────
    // A crew has no lead (20260925154606): poster_cancel_job writes one
    // crew_cancellation_fee_shares row per hired member, and each member is
    // paid THEIR share with its own transfer, idempotency key and ledger flip.
    // Double pay is stopped twice: a row already 'paid' is skipped, and before
    // any transfer Stripe is asked (once per job, fail closed) which members'
    // fee transfers already exist in the job's transfer group; one that exists
    // repairs the ledger instead of paying again.
    /** jobs.series_ban_cancelled_at is not deployed yet (42703 / PGRST204). */
    const isMissingColumn = (e: { code?: string; message?: string } | null) =>
      !!e && (e.code === "42703" || e.code === "PGRST204" ||
        (!e.code && /series_ban_cancelled_at[^"]*does not exist|could not find the 'series_ban_cancelled_at' column/i.test(e.message ?? "")));
    /** The crew ledger table is not deployed yet (42P01 / PGRST205). */
    const isMissingTable = (e: { code?: string; message?: string } | null) =>
      // Table-missing only: a column error (42703, `column "x" does not exist`)
      // on an existing ledger must fail closed, never read as "no shares".
      !!e && (e.code === "42P01" || e.code === "PGRST205" ||
        (!e.code && /relation "[^"]*crew_cancellation_fee_shares[^"]*" does not exist|could not find the table '[^']*crew_cancellation_fee_shares'/i.test(e.message ?? "")));
    type CrewShare = {
      id: string;
      helper_id: string | null;
      committed: boolean;
      share_basis_cents: number | string | null;
      share_amount: number | string | null;
      status: string;
      stripe_transfer_id: string | null;
      /** Q2356: every transfer of this share Stripe reported failed or canceled (the stripe-webhook records them). */
      failed_transfer_ids?: string[] | null;
    };
    /** Q1915: a live cancellation_fee transfer Stripe shows for this exact share (its metadata.share_id).
     *  Q2356: never one the share remembers as failed or canceled. */
    const shareTransferInStripe = (transfers: Stripe.Transfer[], share: CrewShare): Stripe.Transfer | undefined => {
      const knownFailed = failedFeeTransferIds(share);
      return transfers.find((t) => t.metadata?.type === "cancellation_fee" && !t.reversed && t.metadata?.share_id === share.id && !knownFailed.has(t.id));
    };
    /**
     * Q1915 (owner 2026-10-21): BEFORE a cancelled crew is priced, every unpaid
     * share whose member deleted their account (helper_id NULL) is voided, so
     * it is left out of the fee (returnsToPoster) and goes back to the poster
     * with the card refund, or with the gift on a gift-funded crew. The row is
     * marked in place.
     *
     * Only while no money has gone back for this cancellation: once a cancel
     * refund is on the ledger, the share was withheld from it, so it is left
     * pending and Part D returns it after the job settles (lh-money-escrow
     * review #1). Never over a transfer Stripe already shows for the share
     * (review #2: the helper_id dedupe cannot see a deleted member). False when
     * a read or a flip did not land: the caller moves no money for the job
     * this run (the next run retries).
     */
    const voidDeletedMemberShares = async (job: { id: string; title: string }, rows: CrewShare[], stripe: Stripe): Promise<boolean> => {
      const gone = rows.filter((r) => !r.helper_id && (r.status === "pending" || r.status === "failed"));
      if (gone.length === 0) return true;
      const { data: refunded, error: refundedErr } = await supabaseAdmin
        .from("payment_refunds")
        .select("stripe_refund_id")
        .eq("job_id", job.id)
        .eq("source", "void_cancelled_payments")
        .limit(1);
      if (refundedErr) {
        defects.record(`crew fee share void ${job.id}: prior-refund read failed: ${refundedErr.message} — not settled`);
        return false;
      }
      if ((refunded ?? []).length > 0) return true;
      let transfers: Stripe.Transfer[];
      try {
        transfers = (await stripe.transfers.list({ transfer_group: `job_${job.id}`, limit: 100 })).data ?? [];
      } catch (listErr) {
        defects.record(`crew fee share void ${job.id}: transfer list failed: ${caughtMessage(listErr)} — not settled`);
        return false;
      }
      let ok = true;
      for (const row of gone) {
        // Paid in Stripe already: payCrewCancellationFees repairs the ledger.
        if (shareTransferInStripe(transfers, row)) continue;
        const { data, error } = await supabaseAdmin
          .from("crew_cancellation_fee_shares")
          .update({ status: "void" })
          .eq("id", row.id)
          .is("helper_id", null)
          .in("status", ["failed", "pending"])
          .select("id");
        if (error || !data || data.length === 0) {
          console.error(`[void-cancelled-payments] crew fee share ${row.id} (job ${job.id}): could not void a deleted member's share: ${error?.message ?? "zero rows"}; not settling this run.`);
          defects.record(`crew fee share void ${row.id} (job ${job.id}): ${error?.message ?? "zero rows"} — not settled`);
          ok = false;
          continue;
        }
        row.status = "void";
        console.log(`[void-cancelled-payments] crew fee share ${row.id} (job ${job.id}): member account deleted; $${Number(row.share_amount ?? 0).toFixed(2)} goes back to the poster.`);
        await postSlackOpsAlert({
          kind: "custom",
          severity: "info",
          title: "Crew cancellation-fee share of a deleted member goes back to the poster",
          message: "A cancelled crew's fee share belonged to a member whose account was deleted. It was voided, so the poster is not charged it (owner, 2026-10-21).",
          fields: { job_id: job.id, share_id: row.id, amount: Number(row.share_amount ?? 0) },
          oncePerDayKey: `crew-fee-share-deleted-member:${row.id}`,
        });
      }
      return ok;
    };
    const payCrewCancellationFees = async (
      job: {
        id: string; title: string; helper_fee_percent?: number | string | null; helper_fee_flat_cents?: number | string | null;
        /** Part D: the job already settled, with every unpaid share withheld from the poster. */
        crew_share_retry?: boolean;
        /** The poster, told when a share goes back (Part D). */
        customer_id?: string | null;
        /** A test job: the live-gate page routes as seed (holdUnlessPayable). */
        is_seed?: boolean | null;
      },
      shares: CrewShare[],
      /** Q1806: null for a fully gift-funded crew (paid from the platform balance the gift paid into). */
      pi: Stripe.PaymentIntent | null,
      /** The client of this job's Stripe mode (owner 2026-10-12). */
      stripe: Stripe,
    ) => {
      const owed = shares.filter((s) => Number(s.share_amount ?? 0) > 0 && s.status !== "paid" && s.status !== "void");
      if (owed.length === 0) return;
      const feeGroup = `job_${job.id}`;
      let priorByHelper: Map<string, string>;
      /** Q1806: what is already linked to this job's charge (sourceChargeFor). */
      let groupTransfers: Stripe.Transfer[] = [];
      /** Q1806: what this call linked to the charge so far. */
      let linkedThisRun = 0;
      try {
        const prior = await stripe.transfers.list({ transfer_group: feeGroup, limit: 100 });
        groupTransfers = prior.data ?? [];
        // Q2356: a transfer any of this job's shares remembers as failed or canceled is not a payment.
        const knownFailed = new Set<string>(shares.flatMap((sh) => [...failedFeeTransferIds(sh)]));
        priorByHelper = new Map(
          prior.data
            .filter((t) => t.metadata?.type === "cancellation_fee" && !t.reversed && t.metadata?.helper_id && !knownFailed.has(t.id))
            .map((t) => [String(t.metadata.helper_id), t.id]),
        );
      } catch (listErr) {
        // Fail CLOSED, as the single path does: without knowing which shares
        // already went out, any transfer is a coin flip on a second one.
        console.error(`[void-cancelled-payments] could not list prior crew fee transfers for job ${job.id}:`, listErr);
        defects.record(`crew fee-transfer dedupe list ${job.id}: ${(listErr as Error).message}`);
        return;
      }
      const frozenPercent =
        job.helper_fee_percent === null || job.helper_fee_percent === undefined
          ? null
          : Number(job.helper_fee_percent);

      const markShare = async (share: CrewShare, patch: Record<string, unknown>, stage: string) => {
        let flip = supabaseAdmin
          .from("crew_cancellation_fee_shares")
          .update(patch)
          .eq("id", share.id)
          .neq("status", "paid");
        // Q2356 (review should-fix 1): if the webhook recorded THIS transfer as failed between the transfer and
        // this mark, the share stays failed (zero rows: paged below) instead of being marked paid.
        if (patch.status === "paid" && typeof patch.stripe_transfer_id === "string") {
          flip = flip.not("failed_transfer_ids", "cs", `{${patch.stripe_transfer_id}}`);
        }
        const { data, error } = await flip.select("id");
        if (!error && data && data.length > 0) return true;
        {
          console.error(
            `CRITICAL: [void-cancelled-payments] crew fee share ${share.id} (job ${job.id}) ${stage} but the ledger flip ${error ? `failed: ${error.message}` : "matched zero rows"}.`,
          );
          defects.record(`crew fee ledger ${share.id} ${stage}: ${error?.message ?? "zero rows"}`);
          await postSlackOpsAlert({
            kind: "money_at_risk",
            severity: "critical",
            title: "Crew cancellation-fee ledger out of step with Stripe",
            message: `A crew member's cancellation-fee share for job ${job.id} ${stage}, but crew_cancellation_fee_shares was not updated. The Stripe transfer-group check still stops a second payment; reconcile the row by hand.`,
            fields: { job_id: job.id, share_id: share.id, stage, db_error: (error?.message ?? "zero rows").slice(0, 200) },
          });
        }
        return false;
      };

      /**
       * Q1915 (owner 2026-10-21): a share whose member deleted their account
       * goes back to the poster. Part A voids it before pricing when no money
       * has moved yet; a share reaching here on a SETTLED job (Part D) was
       * withheld from the poster's refund. A card job: the share and the sales
       * tax kept on it (Q2082 (a)) are refunded to the poster (once: a refund
       * Stripe shows for the share is never repeated, and a failed one is
       * retried under a new key), recorded on payment_refunds, the share is
       * voided, the job's stamped fee is restated from the ledger, and the
       * poster is told. A gift-funded crew has no card to refund and no
       * automatic gift credit, so admins are told once a day to give it back
       * by hand. Returns nothing: every failure is paged and retried hourly.
       */
      const returnShareToPoster = async (share: CrewShare, shareAmount: number) => {
        const cents = Math.round(shareAmount * 100);
        if (!pi) {
          console.warn(`[void-cancelled-payments] crew fee share ${share.id} (job ${job.id}): member account deleted, $${shareAmount.toFixed(2)} to give back to the poster by hand`);
          await postSlackOpsAlert({
            kind: "payout_failed",
            severity: "warning",
            title: "Crew cancellation-fee share has no recipient",
            message: `A cancelled crew's fee share belongs to a member whose account was deleted, so it goes back to the poster (owner, 2026-10-21). This crew was paid by gift card and has settled, so the $${shareAmount.toFixed(2)} was kept from the poster's gift: give it back to the poster by hand, then set the share's status to 'void' and restate jobs.cancellation_fee without it.`,
            fields: { job_id: job.id, share_id: share.id, amount: shareAmount },
            oncePerDayKey: `crew-fee-share-deleted-member:${share.id}`,
          });
          return;
        }
        const pageRefundProblem = async (why: string) => {
          console.error(`[void-cancelled-payments] crew fee share ${share.id} (job ${job.id}): its deleted member's $${shareAmount.toFixed(2)} was not refunded to the poster: ${why}`);
          defects.record(`crew fee share ${share.id} (job ${job.id}): deleted member's share not refunded: ${why}`);
          await postSlackOpsAlert({
            kind: "payout_failed",
            severity: "warning",
            title: "Crew cancellation-fee share of a deleted member not refunded",
            message: "A cancelled crew's fee share belongs to a member whose account was deleted. It goes back to the poster (owner, 2026-10-21), but the refund did not go through; the hourly run retries it.",
            fields: { job_id: job.id, share_id: share.id, amount: shareAmount, reason: why.slice(0, 200) },
            oncePerDayKey: `crew-fee-share-deleted-member:${share.id}`,
          });
        };
        let refund: Stripe.Refund;
        try {
          const listed = (await stripe.refunds.list({ payment_intent: pi.id, limit: 100 })).data ?? [];
          const mine = listed.filter((r) => r.metadata?.crew_share_id === share.id);
          const live = mine.find((r) => r.status === "succeeded" || r.status === "pending" || r.status === "requires_action");
          if (live) {
            refund = live;
          } else {
            // The share plus the sales tax kept on it, never more than the
            // charge still holds (what was CAPTURED: a hold captures part).
            const charge = pi.latest_charge && typeof pi.latest_charge === "object" ? pi.latest_charge as Stripe.Charge : null;
            const capturedCents = Math.round(Number(charge?.amount_captured ?? charge?.amount ?? pi.amount_received ?? 0));
            // Tax only when the settlement KEPT it (re-review #1): the captured
            // path's cancel refund keeps the tax on the fee (Q2082 (a)), so its
            // payment_refunds row says so; a hold capture took the fee with no
            // tax, and refunding tax it never kept would be the platform's own
            // money. (A captured job whose cancel refund was $0 writes no row and
            // gets the share back without its tax: a few cents, logged below.)
            const { data: cancelRefund, error: cancelRefundErr } = await supabaseAdmin
              .from("payment_refunds")
              .select("stripe_refund_id")
              .eq("job_id", job.id)
              .eq("source", "void_cancelled_payments")
              .limit(1);
            if (cancelRefundErr) {
              await pageRefundProblem(`its cancel refund could not be read (${cancelRefundErr.message})`);
              return;
            }
            let keptTaxCents = 0;
            if ((cancelRefund ?? []).length > 0) {
              // A failed tax read waits for the next run: it would under-refund.
              const chargeTax = await checkoutChargeTaxCents(stripe, pi);
              if (chargeTax === null) {
                await pageRefundProblem("its sales tax could not be read");
                return;
              }
              keptTaxCents = taxOnKeptCents({ keptCents: cents, taxCents: chargeTax, capturedCents });
            } else {
              console.log(`[void-cancelled-payments] crew fee share ${share.id} (job ${job.id}): no cancel refund on the ledger, so no sales tax was kept on the share; refunding the share alone.`);
            }
            const shareRefundCents = withheldFeeReturnCents({
              withheldCents: cents, keptTaxCents, capturedCents, refundedCents: Math.round(Number(charge?.amount_refunded ?? 0)),
            });
            if (!(shareRefundCents > 0)) {
              await pageRefundProblem("the charge has nothing left to refund");
              return;
            }
            // A failed attempt is retried under a NEW key: the old one would
            // replay the failure for 24 hours (review #6).
            const lastFailed = mine.find((r) => r.status === "failed" || r.status === "canceled");
            refund = await stripe.refunds.create(
              { payment_intent: pi.id, amount: shareRefundCents, metadata: { job_id: job.id, crew_share_id: share.id, type: "crew_fee_share_returned" } },
              { idempotencyKey: `crew-share-returned-${share.id}${lastFailed ? `-after-${lastFailed.id}` : ""}` },
            );
          }
        } catch (refundErr) {
          await pageRefundProblem(caughtMessage(refundErr));
          return;
        }
        if (refund.status !== "succeeded" && refund.status !== "pending") {
          await pageRefundProblem(`refund ${refund.id} is ${refund.status}`);
          return;
        }
        const refundedCents = Math.round(Number(refund.amount ?? 0));
        // Ledger row (F-MONEY-04), under its own source so stripe-webhook
        // leaves the notice to this path and Part A's cancel-refund dedupe never
        // reads it. Best-effort: the refund is out.
        const { error: ledgerErr } = await supabaseAdmin.from("payment_refunds").upsert({
          job_id: job.id,
          customer_id: job.customer_id ?? null,
          stripe_refund_id: refund.id,
          stripe_payment_intent_id: pi.id,
          amount_cents: refundedCents,
          currency: refund.currency ?? "usd",
          is_partial: true,
          reason: "a crew member's share of the cancellation fee: their account was deleted, so it goes back to the person who posted it",
          source: "void_cancelled_payments_crew_share",
          initiated_by_user_id: null,
        }, { onConflict: "stripe_refund_id", ignoreDuplicates: true });
        if (ledgerErr) defects.record(`crew fee share ${share.id} (job ${job.id}): refund ${refund.id} ledger write failed: ${ledgerErr.message}`);
        if (!(await markShare(share, { status: "void" }, `was refunded to the person who posted it (${refund.id}); the next run finds the refund and does not repeat it`))) return;
        // The job's fee, restated from the ledger (review #3: several shares
        // in one run, or overlapping runs, each see the latest rows).
        const { data: nowShares, error: nowErr } = await supabaseAdmin
          .from("crew_cancellation_fee_shares")
          .select("status, share_amount")
          .eq("job_id", job.id);
        if (nowErr) {
          defects.record(`crew fee share ${share.id} (job ${job.id}): refunded, but the fee could not be restated: ${nowErr.message}`);
        } else {
          const feeCents = ((nowShares ?? []) as Array<{ share_amount: number | string | null; status: string }>)
            .filter((r) => r.status !== "void")
            .reduce((sum, r) => sum + Math.round(Number(r.share_amount ?? 0) * 100), 0);
          const { data: stampRows, error: stampErr } = await supabaseAdmin
            .from("jobs")
            .update({ cancellation_fee: feeCents / 100, cancellation_fee_status: feeCents > 0 ? "charged" : null })
            .eq("id", job.id)
            .select("id");
          if (stampErr || !stampRows || stampRows.length === 0) {
            // The money is back and the share is void; only the stamp is
            // stale, which money-reconciliation's fee check flags.
            defects.record(`crew fee share ${share.id} (job ${job.id}): refunded, but the job's fee was not restated: ${stampErr?.message ?? "zero rows"}`);
          }
        }
        await tellPosterMoneyBack({ id: job.id, customer_id: job.customer_id ?? null }, pi, {
          key: `refund:${refund.id}`, kind: "refund", amountCents: refundedCents, keptCents: 0,
          keptReason: null,
        });
        console.log(`[void-cancelled-payments] crew fee share ${share.id} (job ${job.id}): its deleted member's share went back to the poster (${refund.id}, ${refundedCents}c).`);
        await postSlackOpsAlert({
          kind: "custom",
          severity: "info",
          title: "Crew cancellation-fee share of a deleted member refunded to the poster",
          message: "A cancelled crew's fee share belonged to a member whose account was deleted. It was refunded to the poster with the sales tax on it (owner, 2026-10-21).",
          fields: { job_id: job.id, share_id: share.id, amount_cents: refundedCents, refund_id: refund.id },
          oncePerDayKey: `crew-fee-share-deleted-member:${share.id}`,
        });
      };

      for (const share of owed) {
        const shareAmount = Number(share.share_amount);
        if (!share.helper_id) {
          // Anonymised by account deletion (Q1915). A transfer Stripe already
          // shows for this share went out before the deletion: repair the
          // ledger, never refund it as well (review #2).
          const sent = shareTransferInStripe(groupTransfers, share);
          if (sent) {
            await markShare(share, { status: "paid", stripe_transfer_id: sent.id, paid_at: new Date().toISOString() }, "was already paid in Stripe");
            continue;
          }
          // Before the job settles it stays withheld (Part A voids it while no
          // money has moved; otherwise Part D returns it after the settle).
          if (job.crew_share_retry === true) await returnShareToPoster(share, shareAmount);
          continue;
        }
        const existing = priorByHelper.get(share.helper_id);
        if (existing) {
          console.log(`[void-cancelled-payments] crew fee for ${share.helper_id} on job ${job.id} already transferred (${existing}); repairing the ledger, not paying again.`);
          await markShare(share, { status: "paid", stripe_transfer_id: existing, paid_at: new Date().toISOString() }, "was already paid in Stripe");
          continue;
        }
        // Payout hold (Q764): this member is sent nothing. The share stays
        // pending/failed and Part D retries it every run; an outcome, not a
        // defect. An unreadable hold fails closed and is one.
        const shareHold = await checkPayoutHold(supabaseAdmin, share.helper_id);
        if (shareHold.kind === "error") {
          console.error(`[void-cancelled-payments] payout hold check failed for crew fee share ${share.id} (job ${job.id}): ${shareHold.message}`);
          defects.record(`crew fee share hold check ${share.id}: ${shareHold.message} — not paid`);
          continue;
        }
        if (shareHold.kind === "held") {
          console.log(`[void-cancelled-payments] crew fee share ${share.id} (job ${job.id}) not paid: member ${share.helper_id} is on a payout hold.`);
          continue;
        }
        // No payout without a verified ID (owner 2026-10-30): the share stays open, retried each run.
        const shareIdHold = await checkIdentityHold(supabaseAdmin, share.helper_id);
        if (shareIdHold.kind === "error") {
          defects.record(`crew fee share ID check ${share.id}: ${shareIdHold.message} — not paid`);
          continue;
        }
        if (shareIdHold.kind === "waits") continue;
        // Q1358: skip this share this run on a failed tier read (Part D
        // retries it) rather than paying at the fallback rate.
        // Roadmap F3: a flat-model job keeps its stamp; no tier read.
        const shareFlatPercent = flatFeePercentOf(job);
        const shareFeeRead = shareFlatPercent !== null
          ? { ok: true as const, percent: shareFlatPercent }
          : await readHelperFeePercentStrict(
            supabaseAdmin,
            share.helper_id,
            (frozenPercent !== null && Number.isFinite(frozenPercent) ? frozenPercent : undefined) ??
              DEFAULT_TIER_FEE_PERCENT,
          );
        if (!shareFeeRead.ok) {
          console.error(`[void-cancelled-payments] helper fee read failed for crew fee share ${share.id} (job ${job.id}): ${shareFeeRead.error}`);
          defects.record(`crew fee share tier read ${share.id}: ${shareFeeRead.error} — not paid`);
          continue;
        }
        const commissionPercent = shareFeeRead.percent;
        const platformCut = isFlatFeeJob(job)
          ? helprFlatFeeCents(Math.round(shareAmount * 100), job) / 100
          : Math.round(shareAmount * (commissionPercent / 100) * 100) / 100;
        // Whole dollars, rounded DOWN; the platform keeps the cents (Q236).
        const memberPayout = roundPayoutDownCents(Math.round((shareAmount - platformCut) * 100)) / 100;

        const { data: memberProfile, error: memberProfileErr } = await supabaseAdmin
          .from("profiles")
          .select("stripe_account_id")
          .eq("user_id", share.helper_id)
          .single();
        if (memberProfileErr || !memberProfile?.stripe_account_id || !(memberPayout > 0)) {
          const why = memberProfileErr ? `profile read failed: ${memberProfileErr.message}` : !memberProfile?.stripe_account_id ? "no payout account" : "nothing left after commission";
          console.error(`[void-cancelled-payments] crew fee share ${share.id} (job ${job.id}, member ${share.helper_id}) not paid: ${why}`);
          // Already failed and paged once: Part D keeps retrying quietly.
          if (share.status === "failed") continue;
          defects.record(`crew fee share ${share.id}: ${why}`);
          await markShare(share, { status: "failed" }, `could not be paid (${why})`);
          await postSlackOpsAlert({
            kind: "payout_failed",
            severity: "warning",
            title: "Crew cancellation-fee share not paid",
            message: "A crew member's cancellation-fee share could not be sent. The poster's fee is already captured — pay it by hand.",
            fields: { job_id: job.id, share_id: share.id, helper_id: share.helper_id, amount: memberPayout, reason: why.slice(0, 200) },
          });
          continue;
        }
        // Lead 2026-10-23 (Stripe rejected the platform and its connected accounts): no transfer
        // unless Stripe says the member's account is payable. The same exit as
        // a payout hold above: not paid this run, retried.
        const shareLive = await holdUnlessPayable({
          stripe,
          supabaseAdmin,
          helperId: share.helper_id,
          accountId: memberProfile.stripe_account_id,
          fn: "void-cancelled-payments",
          what: "a crew cancellation-fee share",
          then: "The run retries it while the share stays unpaid.",
          seed: job.is_seed === true,
          fields: { job_id: job.id, share_id: share.id, amount: memberPayout },
        });
        if (shareLive.held) {
          if (shareLive.defect) defects.record(`crew fee share ${share.id}: ${shareLive.defect}`);
          continue;
        }

        try {
          const transferParams: Record<string, unknown> = {
            amount: roundPayoutDownCents(Math.round(memberPayout * 100)),
            currency: "usd",
            destination: memberProfile.stripe_account_id,
            transfer_group: feeGroup,
            metadata: { job_id: job.id, helper_id: share.helper_id, share_id: share.id, type: "cancellation_fee", platform_cut: platformCut },
          };
          // Linked only when it fits in the charge (Q1806), as the single path.
          const shareSource = sourceChargeFor(pi, transferParams.amount as number, groupTransfers, linkedThisRun);
          // Counted before the call: a transfer whose outcome is unknown may exist.
          if (shareSource) {
            transferParams.source_transaction = shareSource;
            linkedThisRun += transferParams.amount as number;
          }
          const transfer = await stripe.transfers.create(transferParams as unknown as Stripe.TransferCreateParams, {
            // Q1381: a retry of a failed share is a new attempt, not Stripe's replay of the failure.
            idempotencyKey: feeTransferIdempotencyKey(`cancel-fee-${job.id}-${share.helper_id}`, share.status === "failed"),
          });
          console.log(`Crew cancellation fee share $${shareAmount}: platform kept $${platformCut}, transferred $${memberPayout} to ${share.helper_id} for job ${job.id}`);
          await markShare(share, { status: "paid", stripe_transfer_id: transfer.id, paid_at: new Date().toISOString() }, `was paid (${transfer.id})`);
          await insertNotifications(supabaseAdmin, {
            user_id: share.helper_id,
            job_id: job.id,
            title: "Payment for a cancelled job",
            message: `You received $${formatPayoutDollars(memberPayout)} for "${job.title}", which was cancelled.`,
            type: "payment",
            link: "/profile?tab=earnings",
          });
        } catch (transferErr) {
          console.error(`Failed to transfer crew cancellation fee share ${share.id} to ${share.helper_id}:`, transferErr);
          if (!isDefiniteStripeRefusal(transferErr)) {
            // Q1381 review: the transfer may exist. The share keeps its status,
            // so the next attempt reuses this same key and Stripe dedupes it.
            defects.record(`crew cancellation fee transfer ${share.id}: outcome unknown (${((transferErr as Error)?.message ?? "").slice(0, 160)}); retried under the same key`);
            continue;
          }
          // Already failed and paged once: Part D keeps retrying quietly.
          if (share.status === "failed") continue;
          defects.record(`crew cancellation fee transfer ${share.id}: ${(transferErr as Error)?.message ?? transferErr}`);
          await markShare(share, { status: "failed" }, `transfer failed (${((transferErr as Error)?.message ?? "").slice(0, 80)})`);
          const { ids: adminIds } = await loadAdminIds(supabaseAdmin, "void-cancelled-payments.crewFeeTransferFailed");
          for (const adminId of adminIds) {
            await insertNotifications(supabaseAdmin, {
              user_id: adminId,
              title: "Cancellation fee transfer failed",
              message: `Failed to transfer a $${shareAmount.toFixed(2)} crew cancellation-fee share for job ${job.id}. Error: ${(transferErr as Error)?.message ?? transferErr}`,
              type: "admin_alert",
              link: `/admin?view=jobs&job=${job.id}`,
            });
          }
        }
      }
    };

    // ── Part A: Cancelled jobs still in escrow ──
    const { data: cancelledJobs, error } = await supabaseAdmin
      .from("jobs")
      .select("id, title, stripe_session_id, stripe_payment_intent_id, budget, customer_fee_amount, platform_fee_percent, onboarding_fee_amount, cancellation_fee, cancelled_by, date_needed, start_time, cancelled_at, is_seed, helper_id, helper_confirmed_at, customer_id, helper_fee_percent, helper_fee_flat_cents, poster_fee_flat_cents, is_group_job, helpers_needed, parent_job_id, recurrence_days")
      .eq("status", "cancelled")
      .eq("payment_status", "escrow");

    if (error) throw error;

    // ── Part B: Abandoned checkouts — open jobs with unpaid status older than 1 hour ──
    //
    // The `.not("stripe_session_id", "is", null)` filter that used to live on
    // this query is GONE, and that is the fix, not an oversight. A job only
    // gets a session id once create-payment reaches Stripe; a poster who
    // never got that far — closed the tab on the payment step, or funded via
    // a gift card path that historically wrote no session id — left a
    // row that is `open` + `unpaid` with a NULL session forever. Those rows
    // are invisible to helpers (get_ranked_open_jobs and friends require a
    // funded payment_status) but they still count against
    // enforce_open_job_limit, which excuses only 'abandoned'. So the poster
    // silently burned one of their five slots on a job nobody can ever see
    // or fund, with no path out.
    const abandonedCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: abandonedJobs, error: abErr } = await supabaseAdmin
      .from("jobs")
      .select("id, title, stripe_session_id")
      .eq("status", "open")
      .eq("payment_status", "unpaid")
      .lt("created_at", abandonedCutoff);

    if (abErr) throw abErr;

    // A sessionless row has no Stripe object to interrogate, so the only way
    // it can still be live is a gift card RESERVED against it while
    // its shortfall checkout is in flight (create-payment reserves the credit
    // before it creates the session, and a failed session-id write would
    // leave exactly this shape). Abandoning one of those would strand the
    // gift 'reserved' — unusable on any other job — while a real checkout is
    // still open. So: look the reservations up once, and leave those rows
    // alone. Everything else with no session never started paying.
    const sessionlessIds = (abandonedJobs || []).filter((j) => !j.stripe_session_id).map((j) => j.id);
    // null = "we could not tell", which blocks every sessionless row. A read
    // failure must never read as "no reservations".
    let reservedGiftJobIds: Set<string> | null = new Set();
    if (sessionlessIds.length > 0) {
      const { data: reservedRows, error: reservedErr } = await supabaseAdmin
        .from("gift_cards")
        .select("job_id")
        .in("job_id", sessionlessIds)
        .eq("status", "reserved");
      if (reservedErr) {
        console.error("[void-cancelled-payments] reserved-gift lookup failed; skipping sessionless abandon sweep:", reservedErr.message);
        defects.record(`reserved-gift lookup: ${reservedErr.message}`);
        reservedGiftJobIds = null;
      } else {
        reservedGiftJobIds = new Set(
          (reservedRows ?? []).map((r) => (r as { job_id: string | null }).job_id).filter((id): id is string => !!id),
        );
      }
    }

    // Precondition on 'unpaid' everywhere below: if the poster completed
    // checkout between the read above and the write, the job is now funded
    // and marking it abandoned would kill a live, PAID job. Zero rows is
    // therefore a legitimate outcome — it means the guard worked.
    const markAbandoned = async (job: { id: string }, why: string): Promise<boolean> => {
      const { data: rows, error: updErr } = await supabaseAdmin
        .from("jobs")
        .update({ payment_status: "abandoned" })
        .eq("id", job.id)
        .eq("payment_status", "unpaid")
        .select("id");
      if (updErr) {
        console.error(`[void-cancelled-payments] failed to mark job ${job.id} abandoned (${why}):`, updErr.message);
        defects.record(`mark abandoned (${why}) ${job.id}: ${updErr.message}`);
        return false;
      }
      if ((rows ?? []).length === 0) {
        console.log(`[void-cancelled-payments] job ${job.id} was no longer 'unpaid' — not abandoning it.`);
        return false;
      }
      return true;
    };

    // Clean up abandoned jobs — mark payment_status as "abandoned"
    let abandonedCount = 0;
    for (const job of (abandonedJobs || [])) {
      // Stripe mode for THIS job (owner 2026-10-12): test accounts on the test key.
      let stripe: Stripe;
      try {
        ({ stripe } = await stripes.clientForJob(job.id, "read"));
      } catch (modeErr) {
        if (!(modeErr instanceof StripeModeRefused)) throw modeErr;
        defects.record(`stripe mode ${job.id}: ${modeErr.reason}: ${modeErr.message}`);
        continue;
      }
      if (!job.stripe_session_id) {
        if (reservedGiftJobIds === null) {
          console.warn(`[void-cancelled-payments] job ${job.id}: sessionless, but the reserved-gift check failed — leaving it for the next run.`);
          continue;
        }
        if (reservedGiftJobIds.has(job.id)) {
          console.log(`[void-cancelled-payments] job ${job.id}: sessionless but holds a RESERVED gift — a shortfall checkout may still be live, leaving it.`);
          continue;
        }
        if (await markAbandoned(job, "no checkout session")) abandonedCount++;
        continue;
      }

      // Abandon only a session Stripe has EXPIRED (Q771). payment_status is
      // 'unpaid' on an OPEN session too — a poster still on the Checkout page,
      // or retrying after a decline — so keying on it abandoned live
      // checkouts an hour after the job was created. An open session is left
      // for Stripe's own expires_at (create-payment sets a short one, Q770);
      // 'complete' + unpaid is an async payment still settling.
      try {
        const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id!);
        if (session.status === "expired" && session.payment_status === "unpaid") {
          if (await markAbandoned(job, "unpaid")) abandonedCount++;
        }
      } catch (e) {
        // Only a genuinely-missing session (404 / resource_missing) proves the
        // checkout is gone and is safe to abandon. A transient Stripe error
        // (5xx, network, rate-limit) must NOT abandon a still-unpaid job —
        // otherwise a blip silently kills a live checkout. Log and leave it
        // for the next run, mirroring the void loop below.
        // BEFORE the 404 test: a test-mode session under the live key answers
        // 404 resource_missing too. Same outcome as a missing session (it can
        // never be paid now, and no money sits behind it), but named.
        if (isTestObjectUnderLiveKey(e)) {
          logTestObjectUnderLiveKey("void-cancelled-payments", { job_id: job.id, object: "checkout.session", id: job.stripe_session_id });
          if (await markAbandoned(job, "test-mode session")) abandonedCount++;
          continue;
        }
        const missing = (e as any)?.statusCode === 404 || (e as any)?.code === "resource_missing";
        if (missing) {
          if (await markAbandoned(job, "session 404")) abandonedCount++;
        } else {
          console.error(`[void-cancelled-payments] abandoned-check Stripe error for job ${job.id}:`, (e as Error).message);
        }
      }
    }

    // ── Part B2: CANCELLED jobs whose checkout was never paid ──────────────
    //
    // Part B only looks at status='open'. A poster (or an E2E spec's cleanup)
    // who cancels a job AFTER opening checkout leaves it cancelled + 'unpaid'
    // with a LIVE Checkout Session: nothing expired the session, so the
    // cancelled job could still be paid for for up to 24h, and nothing moved
    // it out of 'unpaid', so detect_stuck_payments reported it as a stuck
    // payment every day (36+14 open ops alerts on 2026-09-23, every one an
    // "[E2E DO NOT ACCEPT]" job — docs/OPEN.md Q2). Here the session is
    // expired if still open, and the job marked 'abandoned' once Stripe says
    // it is unpaid. A session Stripe reports PAID is left alone: that is a real
    // paid-but-unsettled checkout, and detect_stuck_payments pages for it
    // after its 2h grace for cancelled jobs.
    //
    // seed-policy: seed and real alike — this is cleanup, not an alert.
    const { data: cancelledUnpaid, error: cuErr } = await supabaseAdmin
      .from("jobs")
      .select("id, title, stripe_session_id, is_seed")
      .eq("status", "cancelled")
      .eq("payment_status", "unpaid")
      .not("stripe_session_id", "is", null)
      .limit(200);
    if (cuErr) {
      console.error("[void-cancelled-payments] cancelled-unpaid lookup failed:", cuErr.message);
      defects.record(`cancelled-unpaid lookup: ${cuErr.message}`);
    }
    let expiredSessions = 0;
    let testOrphansRefunded = 0;
    /**
     * A PAID TEST-mode checkout on a cancelled + unpaid job (2026-10-13, ledger
     * 60298a019ea3): a test account's journey paid a sandbox checkout, the
     * job was torn down before any webhook settled it, and no test-mode
     * webhook endpoint delivers to prod (all three are disabled in Stripe), so
     * it can never settle. It is sandbox money, so it is not "money at risk":
     * paging it as critical and counting it a defect made this cron 500 on
     * every run, for ever. Here the sandbox payment is refunded on the TEST
     * key and the job marked refunded, which takes it out of this query, so it
     * is reported exactly once (one warning). A LIVE paid orphan keeps the
     * critical page below. Returns whether the job was settled.
     */
    const refundTestOrphan = async (
      job: { id: string; title: string | null; stripe_session_id: string | null; is_seed: boolean | null },
      session: Stripe.Checkout.Session,
    ): Promise<boolean> => {
      const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
      if (!pi) {
        defects.record(`cancelled job ${job.id}: PAID test-mode checkout ${job.stripe_session_id} names no PaymentIntent; not refunded`);
        return false;
      }
      // Belt and braces (lh-money-escrow review, finding 2): only a session
      // Stripe itself says is sandbox is ever refunded here.
      if (session.livemode !== false) {
        defects.record(`cancelled job ${job.id}: test-mode job but session ${job.stripe_session_id} is not livemode=false; not refunded`);
        return false;
      }
      let refundStripe: Stripe;
      try {
        // Resolved for the refund itself. The stored cs_test_ session decides
        // the mode for every kind but "new", so this is the TEST client; a
        // live one could not see the sandbox PaymentIntent and would fail as
        // a defect below, never touching live money.
        ({ stripe: refundStripe } = await stripes.clientForJob(job.id, "refund"));
      } catch (modeErr) {
        if (!(modeErr instanceof StripeModeRefused)) throw modeErr;
        defects.record(`stripe mode (refund) ${job.id}: ${modeErr.reason}: ${modeErr.message}`);
        return false;
      }
      let refundId: string | null = null;
      try {
        const refund = await refundStripe.refunds.create(
          { payment_intent: pi, metadata: { job_id: job.id, reason: "test_mode_orphan_on_cancelled_job" } },
          { idempotencyKey: `test-orphan-refund:${job.id}` },
        );
        refundId = refund.id;
      } catch (e) {
        // Already refunded (a previous run refunded, then its job write
        // failed): the money is back, so settle the job now.
        if ((e as { code?: string })?.code !== "charge_already_refunded") {
          defects.record(`cancelled job ${job.id}: test-mode refund of ${pi} failed: ${(e as Error).message}`);
          return false;
        }
      }
      const { data: rows, error: updErr } = await supabaseAdmin
        .from("jobs")
        .update({ payment_status: "refunded" })
        .eq("id", job.id)
        .eq("status", "cancelled")
        .eq("payment_status", "unpaid")
        .select("id");
      if (updErr) {
        defects.record(`cancelled job ${job.id}: test-mode orphan refunded (${refundId ?? "already"}) but the job write failed: ${updErr.message}`);
        return false;
      }
      const settled = (rows ?? []).length > 0;
      if (!settled) {
        // The job left 'unpaid' between the read and this write (lh-money-escrow
        // review, finding 1). Already 'refunded' is this same outcome; anything
        // else (escrow over a refunded PaymentIntent) is a defect, and no
        // warning claims the job was settled.
        const { data: now, error: nowErr } = await supabaseAdmin
          .from("jobs").select("status, payment_status").eq("id", job.id).maybeSingle();
        const status = (now as { payment_status?: string } | null)?.payment_status ?? null;
        const jobStatus = (now as { status?: string } | null)?.status ?? null;
        if (nowErr || status !== "refunded") {
          defects.record(`cancelled job ${job.id}: test-mode orphan refunded (${refundId ?? "already"}) but the job is ${nowErr ? `unreadable (${nowErr.message})` : `now '${status}' (job status '${jobStatus}')`}, not refunded`);
        }
        return false;
      }
      console.log(JSON.stringify({
        event: "test_mode_paid_orphan_refunded", fn: "void-cancelled-payments", job_id: job.id,
        session_id: job.stripe_session_id, payment_intent: pi, refund_id: refundId,
      }));
      await postSlackOpsAlert({
        kind: "stripe_webhook_error",
        severity: "warning",
        title: "TEST-mode checkout paid on a cancelled job: refunded in test mode",
        message: `Job ${job.id} ("${job.title}") was cancelled while its TEST-mode checkout ${job.stripe_session_id} was paid and never settled (no test-mode webhook reached prod). Sandbox money only: refunded on the test key${refundId ? ` (${refundId})` : " (it was already refunded)"} and the job marked refunded.`,
        fields: { job_id: job.id, session_id: job.stripe_session_id },
        oncePerDayKey: `test-orphan-refunded:${job.id}`,
        seed: job.is_seed === true,
      });
      return true;
    };
    for (const job of (cancelledUnpaid || [])) {
      // Stripe mode for THIS job (owner 2026-10-12): test accounts on the test key.
      let stripe: Stripe;
      let jobMode: "live" | "test";
      try {
        ({ stripe, mode: jobMode } = await stripes.clientForJob(job.id, "read"));
      } catch (modeErr) {
        if (!(modeErr instanceof StripeModeRefused)) throw modeErr;
        defects.record(`stripe mode ${job.id}: ${modeErr.reason}: ${modeErr.message}`);
        continue;
      }
      try {
        let session = await stripe.checkout.sessions.retrieve(job.stripe_session_id!);
        if (session.status === "open") {
          session = await stripe.checkout.sessions.expire(job.stripe_session_id!);
          expiredSessions++;
        }
        if (session.payment_status === "unpaid" && session.status !== "complete") {
          if (await markAbandoned(job, "cancelled, checkout never paid")) abandonedCount++;
        } else if (jobMode === "test") {
          // The same rule as every money path here (Q231): an unexecuted
          // dispute decision owns a job's money, and a failed read refunds
          // nothing. A cancelled + unpaid job should never carry one; checked
          // anyway, so this refund can only run after the guard.
          const orphanSettlement = await checkUnsettledDispute(supabaseAdmin, job.id);
          if (orphanSettlement.blocked) {
            // Never silent: a decided, unexecuted dispute on a cancelled +
            // unpaid job should be impossible, and this job stays a paid
            // orphan until someone looks (lh-money-escrow review, finding 3).
            defects.record(
              orphanSettlement.readError
                ? `dispute check ${job.id}: ${orphanSettlement.readError} — test-mode orphan not refunded`
                : `cancelled job ${job.id}: test-mode orphan held by unexecuted dispute ${orphanSettlement.dispute?.id ?? "?"}; not refunded`,
            );
            continue;
          }
          if (await refundTestOrphan(job, session)) testOrphansRefunded++;
        } else {
          // Stripe says this checkout TOOK MONEY on a job the DB has as
          // cancelled + unpaid: the webhook never settled it. Page it here,
          // with the evidence in hand — detect_stuck_payments only reads jobs
          // under 24h old and gives cancelled ones 2h, so a late payment
          // could age out of its window unreported (money-escrow review).
          console.error(`[void-cancelled-payments] cancelled job ${job.id}: session ${session.status}/${session.payment_status} — paid checkout never settled`);
          defects.record(`cancelled job ${job.id} has a PAID checkout the webhook never settled (${job.stripe_session_id})`);
          await postSlackOpsAlert({
            kind: "money_at_risk",
            severity: "critical",
            title: "Paid checkout on a cancelled job — never settled",
            message: `Job ${job.id} ("${job.title}") is cancelled and unpaid in the DB, but Stripe session ${job.stripe_session_id} is ${session.status}/${session.payment_status}. The money is held by Stripe with nothing in escrow; refund it or settle the job by hand.`,
            fields: { job_id: job.id, session_id: job.stripe_session_id },
            link: `/admin?view=jobs&job=${job.id}`,
            oncePerDayKey: `cancelled-paid-checkout:${job.id}`,
            seed: job.is_seed === true,
          });
        }
      } catch (e) {
        if (isTestObjectUnderLiveKey(e)) {
          logTestObjectUnderLiveKey("void-cancelled-payments", { job_id: job.id, object: "checkout.session", id: job.stripe_session_id });
          if (await markAbandoned(job, "cancelled, test-mode session")) abandonedCount++;
          continue;
        }
        const missing = (e as any)?.statusCode === 404 || (e as any)?.code === "resource_missing";
        if (missing) {
          if (await markAbandoned(job, "cancelled, session 404")) abandonedCount++;
        } else {
          console.error(`[void-cancelled-payments] cancelled-unpaid Stripe error for job ${job.id}:`, (e as Error).message);
          defects.record(`cancelled-unpaid ${job.id}: ${(e as Error).message}`);
        }
      }
    }

    const jobs = cancelledJobs;

    // Owner 2026-10-30: poster_cancel_job records no fee, not late, when the hired Helpr had not verified their ID,
    // and writes a job_cancel_id_waivers row in the same transaction. That row, not a recorded 0, is what waives the
    // ladder below (money-reconciliation reads it the same way): a 0 a poster's cancel wrote for any other reason is
    // re-priced. Read once for every single Part A job with a hired Helpr. Only a missing table (a function deployed
    // before the migration, when no such cancel can exist) reads "no waiver"; any other read error moves no money for
    // those jobs this run.
    const idWaiverCandidates = (jobs ?? [])
      .filter((j) => j.is_group_job !== true && !!j.helper_id)
      .map((j) => j.id as string);
    const idWaivedJobs = new Set<string>();
    let idWaiverReadError: string | null = null;
    if (idWaiverCandidates.length > 0) {
      const { data: waiverRows, error: waiverErr } = await supabaseAdmin
        .from("job_cancel_id_waivers")
        .select("job_id")
        .in("job_id", idWaiverCandidates);
      const noWaiverTable = !!waiverErr && (waiverErr.code === "42P01" || waiverErr.code === "PGRST205");
      if (waiverErr && !noWaiverTable) {
        idWaiverReadError = waiverErr.message;
        console.error("[void-cancelled-payments] job_cancel_id_waivers read failed; not settling jobs with a hired Helpr:", waiverErr.message);
        defects.record(`job_cancel_id_waivers read: ${waiverErr.message} — jobs with a hired Helpr not settled`);
      }
      for (const r of (waiverRows ?? []) as Array<{ job_id: string }>) idWaivedJobs.add(r.job_id);
    }

    let voided = 0;
    let refunded = 0;
    const results: any[] = [];

    // ── Part D: crew fee shares still owed after their job settled ──────────
    // (money review MEDIUM-6.) Part A settles a cancelled crew once the poster's
    // refund and the fee capture are done, which takes the job out of its own
    // selection; a member whose transfer failed (no payout account yet, a
    // Stripe error) would then never be retried. So every run collects every
    // pending or failed share with money on it, on a crew job whose fee was
    // captured, and pays it INSIDE the loop below, AFTER the same unsettled-
    // dispute check every Part A job passes (Q231), with the same dedupe
    // (ledger + Stripe transfer group) and per-member idempotency key, so a
    // retry can never pay twice. A share already marked failed pages once.
    let crewSharesRetried = 0;
    const crewRetryShares = new Map<string, CrewShare[]>();
    const crewRetryJobs: Array<Record<string, unknown>> = [];
    const { data: owedShares, error: owedErr } = await supabaseAdmin
      .from("crew_cancellation_fee_shares")
      .select("id, job_id, helper_id, committed, share_basis_cents, share_amount, status, stripe_transfer_id, failed_transfer_ids")
      .in("status", ["pending", "failed"])
      .gt("share_amount", 0)
      .limit(200);
    if (owedErr && isMissingTable(owedErr)) {
      // Not deployed yet (money review MEDIUM-5): nothing can be owed.
    } else if (owedErr) {
      console.error("[void-cancelled-payments] crew share retry read failed:", owedErr.message);
      defects.record(`crew share retry read: ${owedErr.message}`);
    } else {
      for (const row of (owedShares ?? []) as Array<CrewShare & { job_id: string }>) {
        const list = crewRetryShares.get(row.job_id) ?? [];
        list.push(row);
        crewRetryShares.set(row.job_id, list);
      }
      if (crewRetryShares.size > 0) {
        const { data: settledJobs, error: settledErr } = await supabaseAdmin
          .from("jobs")
          .select("id, title, helper_fee_percent, helper_fee_flat_cents, payment_status, cancellation_fee_status, stripe_payment_intent_id, customer_id, is_seed")
          .in("id", [...crewRetryShares.keys()])
          // Only a job whose fee Part A captured: one still in escrow is Part A's own.
          // Q1806: 'cancelled' is a fully gift-funded crew whose fee Part A kept
          // from the gift (the only path that marks a 'cancelled' job charged).
          .in("payment_status", ["refunded", "cancelled"])
          .eq("cancellation_fee_status", "charged");
        if (settledErr) {
          defects.record(`crew share retry job read: ${settledErr.message}`);
        } else {
          for (const sj of settledJobs ?? []) crewRetryJobs.push({ ...sj, crew_share_retry: true });
        }
      }
    }

    // ── Part E: single-Helpr cancellation fees still owed (LOW-2) ─────────
    // The same shape as Part D for the cancellation_fee_transfers ledger: a
    // fee whose transfer failed (no payout account yet, a Stripe error, a
    // dropped read) or whose run died between claim and transfer is still an
    // open row after Part A settled the job. Each is retried INSIDE the loop,
    // after the unsettled-dispute check, through payHelperCancellationFee,
    // which re-reads the row, dedupes against the Stripe transfer group and
    // keys the transfer to the row, so a retry can never pay twice.
    let feeTransfersRetried = 0;
    const feeRetryRows = new Map<string, { helper_id: string; fee_amount: number | string }>();
    const feeRetryJobs: Array<Record<string, unknown>> = [];
    const { data: owedFees, error: owedFeesErr } = await supabaseAdmin
      .from("cancellation_fee_transfers")
      .select("id, job_id, helper_id, fee_amount")
      .in("status", ["failed", "pending"])
      .not("helper_id", "is", null)
      .limit(200);
    if (owedFeesErr) {
      console.error("[void-cancelled-payments] cancellation fee retry read failed:", owedFeesErr.message);
      defects.record(`cancellation fee retry read: ${owedFeesErr.message}`);
    } else {
      for (const row of (owedFees ?? []) as Array<{ job_id: string; helper_id: string; fee_amount: number | string }>) {
        // UNIQUE (job_id, helper_id) and one Helpr per single-Helpr job: one row a job.
        feeRetryRows.set(row.job_id, { helper_id: row.helper_id, fee_amount: row.fee_amount });
      }
      if (feeRetryRows.size > 0) {
        const { data: feeJobs, error: feeJobsErr } = await supabaseAdmin
          .from("jobs")
          .select("id, title, helper_fee_percent, helper_fee_flat_cents, payment_status, cancellation_fee_status, stripe_payment_intent_id, is_seed")
          .in("id", [...feeRetryRows.keys()])
          // Only a job Part A already settled: one still in escrow is Part A's own.
          // Q1806: 'cancelled' is a fully gift-funded job whose fee Part A kept
          // from the gift (the only path that marks a 'cancelled' job charged).
          .in("payment_status", ["refunded", "cancelled"])
          .eq("cancellation_fee_status", "charged");
        if (feeJobsErr) {
          defects.record(`cancellation fee retry job read: ${feeJobsErr.message}`);
        } else {
          for (const fj of feeJobs ?? []) feeRetryJobs.push({ ...fj, fee_transfer_retry: true });
        }
      }
    }

    for (const job of [...(jobs || []), ...crewRetryJobs, ...feeRetryJobs] as any[]) {
      // Stripe mode for THIS job (owner 2026-10-12): test accounts on the test key.
      let stripe: Stripe;
      try {
        ({ stripe } = await stripes.clientForJob(job.id, "refund"));
      } catch (modeErr) {
        if (!(modeErr instanceof StripeModeRefused)) throw modeErr;
        defects.record(`stripe mode ${job.id}: ${modeErr.reason}: ${modeErr.message}`);
        continue;
      }
      /**
       * A cancellation fee is a PAYOUT: the loop's client was chosen for the
       * refund (the payer alone), so before any fee transfer its payees must
       * be of the escrow's own mode too (lh-money-escrow re-review 2026-10-12,
       * finding 1). False on a mix. Null when the mode cannot be read (a
       * failed read): that job is recorded as a defect and skipped this run,
       * so one failed read never stops every later job's refund (lh-money-escrow
       * review of the rebuild, finding 3).
       */
      const feePayeesShareMode = async (payees: ReadonlyArray<string | null | undefined>): Promise<boolean | null> => {
        try {
          await jobMoneyMode(supabaseAdmin, job.id, { kind: "payout", extraParties: payees });
          return true;
        } catch (e) {
          if (!(e instanceof StripeModeRefused)) throw e;
          // A mix, or a payee that looks like a test account without being
          // enrolled: neither clears by itself, so the fee goes back to the
          // payer with the refund instead of holding the refund forever
          // (lh-money-escrow review 2026-10-25, finding 1).
          if (isPartyRefusal(e as unknown)) return false;
          defects.record(`stripe mode (fee payees) ${job.id}: ${e.reason}: ${e.message} — not settled this run`);
          results.push({ job_id: job.id, title: job.title, status: "stripe_mode_unreadable" });
          return null;
        }
      };
      // ── Not a job whose escrow an admin's dispute decision owns ──────────
      // rpc_decide_dispute moves a poster-wins decision to status 'cancelled'
      // with the escrow still held for execute-dispute-split — exactly the
      // cancelled + escrow shape this loop refunds by the CANCELLATION rules.
      // Both then refunded the same charge, and a party re-file + withdraw +
      // poster_cancel_job reached it for any decision (lh-authz-rls round 2,
      // HIGH). The decision settles it; this loop leaves it alone. Fails
      // closed: an unreadable answer is a skip and a defect, never a refund.
      const settlement = await checkUnsettledDispute(supabaseAdmin, job.id);
      if (settlement.blocked) {
        if (settlement.readError) {
          console.error(`[void-cancelled-payments] dispute check failed for job ${job.id}; not refunding:`, settlement.readError);
          defects.record(`dispute check ${job.id}: ${settlement.readError} — not refunded`);
        } else {
          console.log(`[void-cancelled-payments] job ${job.id} has an unexecuted dispute decision (${settlement.dispute?.id}); leaving the escrow to execute-dispute-split.`);
        }
        results.push({ job_id: job.id, title: job.title, status: settlement.readError ? "dispute_check_failed" : "dispute_decision_pending" });
        continue;
      }

      // Part D: a settled crew with fee shares still owed. Nothing else in
      // this loop applies to it (its escrow already left 'escrow').
      if (job.crew_share_retry) {
        const shares = crewRetryShares.get(job.id) ?? [];
        // Q1806: a gift-funded crew ('cancelled', no PaymentIntent) is paid from
        // the platform balance its gift paid into; any other job with no
        // PaymentIntent has nothing behind the fee.
        // A 'cancelled' job WITH a PaymentIntent is a voided hold: no money
        // behind a fee (review of Q1806 #5).
        if (job.payment_status === "cancelled" ? !!job.stripe_payment_intent_id : !job.stripe_payment_intent_id) {
          defects.record(`crew share retry ${job.id}: no payment intent to draw the fee from (${job.payment_status}${job.stripe_payment_intent_id ? ", a voided hold" : ""})`);
          continue;
        }
        const sharesShareMode = await feePayeesShareMode(shares.map((s) => s.helper_id));
        if (sharesShareMode === null) continue;
        if (!sharesShareMode) {
          defects.record(`crew share retry ${job.id}: owed to a payee in the other Stripe mode (a test account on a real job, or the reverse): no fee can be paid; refund the fee to the person who paid it, from Admin`);
          continue;
        }
        try {
          const retryPi = job.stripe_payment_intent_id ? await stripe.paymentIntents.retrieve(job.stripe_payment_intent_id, { expand: ["latest_charge"] }) : null;
          await payCrewCancellationFees(job, shares, retryPi, stripe);
          crewSharesRetried += shares.length;
          results.push({ job_id: job.id, title: job.title, status: "crew_shares_retried", shares: shares.length });
        } catch (retryErr) {
          if (isTestObjectUnderLiveKey(retryErr)) {
            logTestObjectUnderLiveKey("void-cancelled-payments", { job_id: job.id, object: "payment_intent", id: job.stripe_payment_intent_id });
            continue;
          }
          defects.record(`crew share retry ${job.id}: ${(retryErr as Error)?.message ?? retryErr}`);
        }
        continue;
      }

      // Part E: a settled job whose single-Helpr fee is still owed.
      if (job.fee_transfer_retry) {
        const owed = feeRetryRows.get(job.id);
        if (!owed) continue;
        // Q1806: as Part D, a gift-funded job ('cancelled', no PaymentIntent)
        // is paid from the platform balance its gift paid into.
        // A 'cancelled' job WITH a PaymentIntent is a voided hold (review of Q1806 #5).
        if (job.payment_status === "cancelled" ? !!job.stripe_payment_intent_id : !job.stripe_payment_intent_id) {
          defects.record(`cancellation fee retry ${job.id}: no payment intent to draw the fee from (${job.payment_status}${job.stripe_payment_intent_id ? ", a voided hold" : ""})`);
          continue;
        }
        const owedShareMode = await feePayeesShareMode([owed.helper_id]);
        if (owedShareMode === null) continue;
        if (!owedShareMode) {
          defects.record(`cancellation fee retry ${job.id}: owed to a payee in the other Stripe mode (a test account on a real job, or the reverse): no fee can be paid; refund the fee to the person who paid it, from Admin`);
          continue;
        }
        try {
          const retryPi = job.stripe_payment_intent_id ? await stripe.paymentIntents.retrieve(job.stripe_payment_intent_id, { expand: ["latest_charge"] }) : null;
          await payHelperCancellationFee(
            { id: job.id, title: job.title, helper_id: owed.helper_id, helper_fee_percent: job.helper_fee_percent, helper_fee_flat_cents: job.helper_fee_flat_cents },
            Number(owed.fee_amount),
            retryPi,
            undefined,
            stripe,
          );
          feeTransfersRetried++;
          results.push({ job_id: job.id, title: job.title, status: "fee_transfer_retried" });
        } catch (retryErr) {
          if (isTestObjectUnderLiveKey(retryErr)) {
            logTestObjectUnderLiveKey("void-cancelled-payments", { job_id: job.id, object: "payment_intent", id: job.stripe_payment_intent_id });
            continue;
          }
          defects.record(`cancellation fee retry ${job.id}: ${(retryErr as Error)?.message ?? retryErr}`);
        }
        continue;
      }

      // ── Not a job whose escrow already went to the Helpr ────────────────
      // A live payout_transfers row means the escrow LEFT toward the Helpr (a
      // Quick Release whose flip failed, a payout that raced a withdrawal).
      // Such a job can still reach cancelled + escrow: a withdrawal restores
      // it, poster_cancel_job cancels it, and this loop then refunded the
      // poster by the cancellation rules on top of the Helpr's transfer
      // (lh-money-escrow round 3, H1). This function never writes that ledger
      // itself — the cancellation fee has its own ledger,
      // cancellation_fee_transfers (or crew_cancellation_fee_shares), never
      // payout_transfers — so any live row is another path's money. Refuse and page:
      // unwinding it needs a person reconciling Stripe. Fails CLOSED.
      const { data: livePayouts, error: livePayoutErr } = await supabaseAdmin
        .from("payout_transfers")
        .select("id, status")
        .eq("job_id", job.id)
        .in("status", ["pending", "paid"])
        .limit(1);
      if (livePayoutErr) {
        console.error(`[void-cancelled-payments] payout ledger read failed for job ${job.id}; not refunding:`, livePayoutErr.message);
        defects.record(`payout ledger read ${job.id}: ${livePayoutErr.message} — not refunded`);
        results.push({ job_id: job.id, title: job.title, status: "payout_check_failed" });
        continue;
      }
      if ((livePayouts ?? []).length > 0) {
        console.error(`[void-cancelled-payments] job ${job.id} is cancelled + escrow but has a live payout_transfers row — NOT refunding over a paid Helpr.`);
        defects.record(`job ${job.id}: cancelled + escrow with a live payout transfer — escrow already paid to the Helpr, not refunded; reconcile by hand`);
        await postSlackOpsAlert({
          kind: "money_at_risk",
          severity: "critical",
          title: "Cancelled job NOT refunded — its escrow was already paid to the Helpr",
          message:
            `Job ${job.id} ("${job.title}") is cancelled with its payment still reading escrow, but payout_transfers holds a live transfer to the Helpr. ` +
            "The cancellation refund was NOT issued, because it would pay the same escrow out twice. Reconcile against Stripe and settle the job by hand.",
          fields: { job_id: job.id, payout_transfer: String((livePayouts ?? [])[0]?.id ?? "") },
        });
        results.push({ job_id: job.id, title: job.title, status: "escrow_already_released" });
        continue;
      }
      // And at Stripe (round-4 review): a transfer that left with no ledger
      // row — a Quick Release killed after Stripe answered, a split leg whose
      // ledger write failed — is invisible above. Every payout path tags
      // `transfer_group: job_<id>`; a live one that is not this loop's own
      // earlier cancellation-fee transfer (metadata.type) means the escrow
      // already went to the Helpr. Fails CLOSED.
      let ghostTransfer: { id: string; amount?: number } | undefined;
      try {
        const grouped = await stripe.transfers.list({ transfer_group: `job_${job.id}`, limit: 100 });
        ghostTransfer = ((grouped?.data ?? []) as Array<{ id: string; amount?: number; amount_reversed?: number; metadata?: { type?: string } }>)
          // Q1390 (lh-money-escrow review): a crew block fee is this loop's own too.
          .find((t) => Number(t.amount ?? 0) - Number(t.amount_reversed ?? 0) > 0 && t.metadata?.type !== "cancellation_fee" && t.metadata?.type !== "crew_block_fee");
      } catch (listErr) {
        console.error(`[void-cancelled-payments] transfers.list failed for job ${job.id}; not refunding:`, (listErr as Error).message);
        defects.record(`transfer check ${job.id}: ${(listErr as Error).message} — not refunded`);
        results.push({ job_id: job.id, title: job.title, status: "payout_check_failed" });
        continue;
      }
      if (ghostTransfer) {
        console.error(`[void-cancelled-payments] job ${job.id} is cancelled + escrow but Stripe shows transfer ${ghostTransfer.id} — NOT refunding over a paid Helpr.`);
        defects.record(`job ${job.id}: cancelled + escrow with Stripe transfer ${ghostTransfer.id} and no ledger row — not refunded; reconcile by hand`);
        await postSlackOpsAlert({
          kind: "money_at_risk",
          severity: "critical",
          title: "Cancelled job NOT refunded — its escrow was already paid to the Helpr",
          message:
            `Job ${job.id} ("${job.title}") is cancelled with its payment still reading escrow, but Stripe shows transfer ${ghostTransfer.id} in its transfer group with no payout ledger row. ` +
            "The cancellation refund was NOT issued, because it would pay the same escrow out twice. Reconcile against Stripe and settle the job by hand.",
          fields: { job_id: job.id, transfer_id: ghostTransfer.id, amount_cents: Number(ghostTransfer.amount ?? 0) },
        });
        results.push({ job_id: job.id, title: job.title, status: "escrow_already_released" });
        continue;
      }

      // ── Was this visit cancelled by a permanent ban? ─────────────────────
      // jobs.series_ban_cancelled_at is server-owned (20260927012808): only
      // end_series_for_banned_account sets it. Read apart from the sweep's
      // select so a function deployed before that migration still settles
      // every other job: before the column exists no visit can carry it
      // (42703 = "not ban-ended"). Any other read error moves no money for
      // this job; the next run retries.
      if (job.parent_job_id || (Array.isArray(job.recurrence_days) && job.recurrence_days.length > 0)) {
        const { data: markerRow, error: markerErr } = await supabaseAdmin
          .from("jobs")
          .select("series_ban_cancelled_at")
          .eq("id", job.id)
          .maybeSingle();
        if (markerErr && !isMissingColumn(markerErr)) {
          console.error(`[void-cancelled-payments] series ban marker read failed for job ${job.id}; not settling:`, markerErr.message);
          defects.record(`series ban marker read ${job.id}: ${markerErr.message} — not settled`);
          results.push({ job_id: job.id, title: job.title, status: "series_marker_read_failed" });
          continue;
        }
        job.series_ban_cancelled_at = markerErr ? null : (markerRow?.series_ban_cancelled_at ?? null);
      }

      // ── A10 (owner, 2026-10-17): cancelled because a Declutter seller backed out? ──
      // declutter_refund_cancels_setup_jobs (20261017073146) cancels a buyer's
      // Helpr setup job when the Declutter refund is the seller's fault, and
      // marks declutter_order_jobs.seller_fault_refund_id. Such a job owes NO
      // cancellation fee and is refunded IN FULL with its card fee (the one-time
      // setup fee excepted, lead decision); that card fee becomes the seller's
      // debt (declutter_setup_job_fee_debt, after the refund). Read on every job:
      // only a missing table or column (a function deployed before the
      // migration) reads "not marked"; any other read error moves no money for
      // this job this run, like the series ban marker above.
      let sellerFault = false;
      {
        const { data: faultRow, error: faultErr } = await supabaseAdmin
          .from("declutter_order_jobs")
          .select("seller_fault_refund_id")
          .eq("job_id", job.id)
          .maybeSingle();
        const notDeployed = !!faultErr && ["42P01", "42703", "PGRST204", "PGRST205"].includes(faultErr.code ?? "");
        if (faultErr && !notDeployed) {
          console.error(`[void-cancelled-payments] Declutter seller-fault marker read failed for job ${job.id}; not settling:`, faultErr.message);
          defects.record(`declutter seller-fault marker read ${job.id}: ${faultErr.message} — not settled`);
          results.push({ job_id: job.id, title: job.title, status: "seller_fault_marker_read_failed" });
          continue;
        }
        sellerFault = !faultErr && !!faultRow?.seller_fault_refund_id;
      }

      // ── What this cancellation owes, priced before any money moves ───────
      // A single job: recomputed from trusted job fields (F-MONEY-32). A crew
      // (Q407): the sum of its ledger shares, each re-priced from the same job
      // fields; a share that does not match its recomputation, or a ledger that
      // cannot be read, moves NO money for this job (it stays in escrow and the
      // next run retries).
      let crewShares: CrewShare[] | null = null;
      /** Q1915: a share went back to the poster, so the stamped fee is restated at settlement. */
      let crewShareReturned = false;
      let jobCancellationFee: number;
      /** Q1390: this crew's block fees (closed spots), paid before the refund. */
      let blockFeeRows: CrewBlockFeeRow[] = [];
      // A crew cancelled BEFORE 20260925154606 has its "lead" in helper_id and
      // no ledger rows: it settles on the single path, as the code deployed
      // then did (money review MEDIUM-5). Every crew cancelled after it has no
      // lead (trg_group_job_has_no_lead) and prices from its ledger.
      if (job.is_group_job && !job.helper_id) {
        const { data: shareRows, error: shareErr } = await supabaseAdmin
          .from("crew_cancellation_fee_shares")
          .select("id, helper_id, committed, share_basis_cents, share_amount, status, stripe_transfer_id, failed_transfer_ids")
          .eq("job_id", job.id);
        // DEPLOY ORDER (money review MEDIUM-5): before 20260925154606 the
        // ledger does not exist, and no crew without a lead can exist either
        // (the no-lead backfill is in the same migration), so "no table" is
        // "no shares". Any other read error fails closed.
        if (shareErr && !isMissingTable(shareErr)) {
          console.error(`[void-cancelled-payments] crew fee ledger read failed for job ${job.id}; not settling:`, shareErr.message);
          defects.record(`crew fee ledger read ${job.id}: ${shareErr.message} — not settled`);
          results.push({ job_id: job.id, title: job.title, status: "crew_shares_read_failed" });
          continue;
        }
        // Q1915: a deleted member's unpaid share goes back to the poster.
        if (!(await voidDeletedMemberShares(job, (shareRows ?? []) as CrewShare[], stripe))) {
          results.push({ job_id: job.id, title: job.title, status: "crew_share_void_failed" });
          continue;
        }
        const priced = crewCancellationFee(job, (shareRows ?? []) as CrewShare[]);
        if (priced.mismatch) {
          console.error(`CRITICAL: [void-cancelled-payments] crew fee share for ${priced.mismatch.helper_id} on job ${job.id} is $${priced.mismatch.stored}, recomputed $${priced.mismatch.expected}; not settling.`);
          defects.record(`crew fee share mismatch ${job.id}: stored ${priced.mismatch.stored} vs ${priced.mismatch.expected}`);
          await postSlackOpsAlert({
            kind: "money_at_risk",
            severity: "critical",
            title: "Crew cancellation-fee share does not match its price",
            message: `A crew_cancellation_fee_shares row for job ${job.id} disagrees with the fee ladder. No money moved; the job stays in escrow until a person reconciles it.`,
            fields: { job_id: job.id, helper_id: priced.mismatch.helper_id ?? "(anonymised)", stored: priced.mismatch.stored, expected: priced.mismatch.expected },
          });
          results.push({ job_id: job.id, title: job.title, status: "crew_share_mismatch" });
          continue;
        }
        crewShares = (shareRows ?? []) as CrewShare[];
        jobCancellationFee = priced.total;
        crewShareReturned = crewShares.some((r) => returnsToPoster(r));
        // Q1390: a spot a block closed earlier owes its member a fee from this
        // escrow; it is paid before the poster's refund and withheld from it.
        const blockRead = await readCrewBlockFees(supabaseAdmin, job.id);
        if (!blockRead.ok) {
          console.error(`[void-cancelled-payments] crew block fee read failed for job ${job.id}; not settling: ${blockRead.error}`);
          defects.record(`crew block fee read ${job.id}: ${blockRead.error} — not settled`);
          results.push({ job_id: job.id, title: job.title, status: "crew_block_fees_read_failed" });
          continue;
        }
        blockFeeRows = blockRead.rows;
      } else {
        // An unfilled or ban-ended series visit carries no fee
        // (_shared/seriesRefund.ts).
        // A10: a setup job a Declutter seller's backing out cancelled carries no fee.
        // Owner 2026-10-30: poster_cancel_job recorded no fee because the hired Helpr had not verified
        // their ID: the poster may rehire without paying for the Helpr's time. Keyed on the job_cancel_id_waivers row
        // poster_cancel_job wrote, read once above; a read error moves no money for this job.
        if (idWaiverReadError !== null && job.helper_id) {
          results.push({ job_id: job.id, title: job.title, status: "id_waiver_read_failed" });
          continue;
        }
        const noFeeRecorded = idWaivedJobs.has(job.id);
        jobCancellationFee = sellerFault || refundsSeriesVisitInFull(job) || noFeeRecorded ? 0 : computeCancellationFee(job);
        // ... so a booked Helpr's late-cancel fee is withheld through no fault of
        // theirs. Said out loud, once a day per job, like Q738 below
        // (lh-money-escrow review of c57d948d0 #3); whether the seller should
        // owe it too is an owner question (Q?addhelpr-helpr-fee).
        const withheldForSeller = sellerFault && job.helper_id ? computeCancellationFee(job) : 0;
        if (withheldForSeller > 0) {
          console.warn(`[void-cancelled-payments] job ${job.id}: $${withheldForSeller.toFixed(2)} late-cancel fee withheld from Helpr ${job.helper_id}: a Declutter seller's fault cancelled it`);
          await postSlackOpsAlert({
            kind: "custom",
            severity: "warning",
            title: "Cancellation fee withheld: a Declutter seller's fault cancelled this setup job",
            message: `A Helpr setup job cancelled because the Declutter seller failed (owner rule A10) carries no cancellation fee, so the booked Helpr is not paid the $${withheldForSeller.toFixed(2)} late-cancel fee they would otherwise be owed. Decide by hand whether to pay the Helpr.`,
            fields: { job_id: job.id, helper_id: job.helper_id, poster_id: job.customer_id ?? null, withheld_fee: withheldForSeller },
            oncePerDayKey: `declutter-seller-withheld-fee:${job.id}`,
          });
        }
        // Q738: a visit a BAN ended is refunded in full, so a late-cancel fee
        // the booked Helpr would otherwise be owed is withheld. That was
        // silent; it is a judgement call (whose ban, what for), so admins
        // are told, once a day per job, and decide by hand.
        const withheldForBan = job.series_ban_cancelled_at && job.helper_id ? computeCancellationFee(job) : 0;
        if (jobCancellationFee === 0 && withheldForBan > 0) {
          // Whose ban? Best effort, read only for the page: an unreadable
          // answer says so rather than blocking the settlement.
          const { data: banRows, error: banErr } = await supabaseAdmin
            .from("profiles")
            .select("user_id, ban_status")
            .in("user_id", [job.helper_id, job.customer_id].filter((x): x is string => !!x));
          const banOf = (id: string | null | undefined) =>
            banErr ? "unreadable" : ((banRows ?? []) as Array<{ user_id: string; ban_status: string | null }>).find((r) => r.user_id === id)?.ban_status ?? "none";
          console.warn(`[void-cancelled-payments] job ${job.id}: $${withheldForBan.toFixed(2)} late-cancel fee withheld from Helpr ${job.helper_id}: the visit was ended by a ban`);
          await postSlackOpsAlert({
            kind: "custom",
            severity: "warning",
            title: "Cancellation fee withheld: a ban ended this visit",
            message: `A series visit ended by a ban (series_ban_cancelled_at set) is refunded in full, so the booked Helpr is not paid the $${withheldForBan.toFixed(2)} late-cancel fee they would otherwise be owed. If the ban was the poster's, decide whether to pay the Helpr by hand.`,
            fields: {
              job_id: job.id,
              helper_id: job.helper_id,
              helper_ban_status: banOf(job.helper_id),
              poster_id: job.customer_id ?? null,
              poster_ban_status: banOf(job.customer_id),
              withheld_fee: withheldForBan,
            },
            oncePerDayKey: `ban-withheld-fee:${job.id}`,
          });
        }
      }
      // Q1358: the single Helpr's commission rate, read BEFORE any money moves.
      // A failed read skips the whole job this run (it stays in escrow and the
      // next run retries); priced after the refund, a failed read left the job
      // settled with no fee row for Part E to find.
      let singleFeePercent: number | undefined;
      if (!crewShares && jobCancellationFee > 0 && job.helper_id) {
        const frozen = job.helper_fee_percent === null || job.helper_fee_percent === undefined
          ? null
          : Number(job.helper_fee_percent);
        // Roadmap F3: a flat-model job keeps its stamp; no tier read.
        const flatPct = flatFeePercentOf(job);
        const feeRead = flatPct !== null
          ? { ok: true as const, percent: flatPct }
          : await readHelperFeePercentStrict(
            supabaseAdmin,
            job.helper_id,
            (frozen !== null && Number.isFinite(frozen) ? frozen : undefined) ?? DEFAULT_TIER_FEE_PERCENT,
          );
        if (!feeRead.ok) {
          console.error(`[void-cancelled-payments] helper fee read failed for ${job.helper_id} (job ${job.id}); not settling this run: ${feeRead.error}`);
          defects.record(`cancellation fee tier read ${job.id}: ${feeRead.error} — not settled`);
          results.push({ job_id: job.id, title: job.title, status: "helper_fee_read_failed" });
          continue;
        }
        singleFeePercent = feeRead.percent;
      }
      // A fee owed to a Helpr of the other Stripe mode, or to one that looks like
      // a test account without being enrolled (isPartyRefusal), cannot be paid
      // from this escrow, so it is NOT withheld: the poster gets it back with the refund,
      // and admins are told (once a day per job).
      if (jobCancellationFee > 0 || blockFeeRows.length > 0) {
        const feePayees = [job.helper_id, ...(crewShares ?? []).map((s) => s.helper_id), ...blockFeeRows.map((r) => r.helper_id)];
        const feeShareMode = await feePayeesShareMode(feePayees);
        if (feeShareMode === null) continue;
        if (!feeShareMode) {
          console.warn(`[void-cancelled-payments] job ${job.id}: the cancellation fee is owed to a payee who cannot be paid in this job's Stripe mode; refunding it to the person who paid it`);
          await postSlackOpsAlert({
            kind: "custom",
            severity: "warning",
            title: "Cancellation fee refunded: its payee cannot be paid in this job's Stripe mode",
            message: "Either a test account and a real account are on this cancelled job, or a payee looks like a test account but is not enrolled in test_accounts, so its cancellation fee cannot be paid from the escrow. The cancellation fee was refunded to the person who paid it; decide by hand whether anyone on the job is owed anything.",
            fields: { job_id: job.id, fee: jobCancellationFee },
            oncePerDayKey: `cross-mode-fee:${job.id}`,
          });
          jobCancellationFee = 0;
          if (crewShares) crewShares = [];
          blockFeeRows = [];
        }
      }
      /** Resolves false only when a single Helpr's fee could not be put on the ledger (Q1806). */
      const payCancellationFee = async (fee: number, pi: Stripe.PaymentIntent | null): Promise<boolean> => {
        const onLedger = await (crewShares ? payCrewCancellationFees(job, crewShares, pi, stripe) : payHelperCancellationFee(job, fee, pi, singleFeePercent, stripe));
        return onLedger !== false;
      };
      /**
       * Q1390: try every unpaid block fee. Its cents are withheld from the
       * refund either way; one that cannot go now (a payout hold, no payout
       * account) never holds up the poster's refund (lh-money-escrow review):
       * Part F below keeps trying it on the settled job.
       */
      const payBlockFees = async (pi: Stripe.PaymentIntent): Promise<void> => {
        if (!blockFeeRows.some((r) => r.status === "owed" || r.status === "failed")) return;
        const chargeId = pi.latest_charge ? (typeof pi.latest_charge === "string" ? pi.latest_charge : pi.latest_charge.id) : null;
        const paid = await payCrewBlockFees({ stripe, admin: supabaseAdmin, fn: "void-cancelled-payments", linkPi: pi }, job, blockFeeRows, chargeId);
        for (const p of paid.problems) defects.record(p);
      };
      /**
       * Q1806: a job paid partly by gift and partly by card whose card payment
       * is smaller than what this cancel keeps from it (the fees owed plus the
       * card fee kept): the card pays first and the gift pays `shortCents`.
       * Read BEFORE any money moves, and only when there is a shortfall.
       * Null: the job stays in escrow (the gift is unreadable, its donation was
       * reversed, or it paid less than the shortfall, which includes no gift at
       * all: the fee is then not paid from the platform's own money, never
       * absorb a fee). Otherwise what the gift can fund.
       *
       * Q2000 (owner, 2026-10-17, option A): on a single-Helpr job whose gift
       * can NEVER fund its share (the donation behind it was refunded or
       * charged back, or an earlier run already settled the gift), the Helpr
       * gets the part of the fee the card covered and the gift's part is not
       * paid: `uncollectable`, and the caller caps the fee at what the card
       * holds after its own kept fees. The same rule as a fully gift-funded
       * job whose gift cannot pay (settled without that fee); never absorb a
       * fee. A crew (fee shares, block fees) still fails closed.
       */
      const giftCoversShortfall = async (
        shortCents: number,
        stage: string,
        /** An uncaptured hold (it expires, so it cannot wait for a chargeback). */
        onHold: boolean,
      ): Promise<{ cents: number; uncollectable?: true } | null> => {
        const funding = await giftFeeFunding(job.id);
        if (funding === null) {
          console.error(`[void-cancelled-payments] job ${job.id}: its card payment is ${shortCents}c short of the fees it owes and its gift could not be read; not settling this run (${stage}).`);
          defects.record(`gift fee funding read ${job.id} (${stage}): unreadable — not settled`);
          results.push({ job_id: job.id, title: job.title, status: "gift_fee_funding_unreadable" });
          return null;
        }
        // Review of 8354ebb0e #1: a chargeback on the gift's donation that the
        // platform can still win (or won, with the gift not yet restored) is
        // not a permanent loss, so the fee is not capped for good. A captured
        // charge loses nothing by waiting: the job stays in escrow until the
        // dispute is decided. An uncaptured hold expires, so it is capped below
        // and the alert names what the Helpr is owed if the dispute is won.
        if (funding.disputeOpen && !onHold) {
          console.warn(`[void-cancelled-payments] job ${job.id}: its card payment is ${shortCents}c short of the fees it owes and a chargeback on its gift's donation is not decided; waiting (${stage}).`);
          await postSlackOpsAlert({
            kind: "custom",
            severity: "warning",
            title: "Cancellation fee waits for a chargeback on its gift",
            message: `Job ${job.id} ("${job.title}") was paid partly by gift and partly by card and cancelled late. The card paid less than the fee, and the donation behind the gift has a chargeback that is still open (or was won and the gift is not restored yet), so whether the gift can pay its part is not decided. No money moved and the job stays in escrow until it is. If the dispute was won, set payment_status back to 'paid' on the gift row this job spent (gift_cards ${funding.spentGiftId ?? "with this job_id"}), not only on the donation's root row.`,
            fields: { job_id: job.id, stage, short_cents: shortCents, gift_paid_cents: funding.cents, dispute_open: "yes", spent_gift_id: funding.spentGiftId ?? "unknown" },
            oncePerDayKey: `gift-card-fee-dispute-open:${job.id}`,
          });
          results.push({ job_id: job.id, title: job.title, status: "gift_fee_dispute_open" });
          return null;
        }
        if (funding.donationReversed || funding.cents < shortCents) {
          const why = funding.donationReversed
            ? funding.disputeOpen
              ? "a chargeback on the donation behind its gift is not decided yet"
              : "the donation behind its gift was refunded or charged back"
            : `its gift paid ${funding.cents}c`;
          // Q2000: permanent, on a single Helpr: settle with the fee capped at
          // the card (said once; the job leaves escrow this run).
          if ((funding.donationReversed || funding.restored) && !crewShares && blockFeeRows.length === 0) {
            // Review of 8354ebb0e #2: what an earlier restore KEPT of a live
            // gift is still the gift's money and pays its part; only the rest is
            // uncollectable. A reversed donation keeps nothing.
            const keptCents = funding.donationReversed ? 0 : funding.cents;
            const whyGone = funding.donationReversed
              ? why
              : keptCents > 0
                ? `an earlier run already returned its gift, keeping ${keptCents}c of it for the fee`
                : "an earlier run already returned its gift";
            console.warn(`[void-cancelled-payments] job ${job.id}: its card payment is ${shortCents}c short of the fees it owes and ${whyGone}; the Helpr gets the part of the fee the card${keptCents > 0 ? " and the kept gift" : ""} covered (${stage}).`);
            await postSlackOpsAlert({
              kind: "custom",
              severity: "warning",
              title: "Cancellation fee capped at what the card paid",
              message: `Job ${job.id} ("${job.title}") was paid partly by gift and partly by card and cancelled late. The card paid less than the fee, and ${whyGone}, so the gift's part of the fee cannot be collected. Owner rule (2026-10-17, option A): the Helpr gets the part of the fee the card covered; the rest is not paid and the platform does not pay it.` +
                (funding.disputeOpen
                  ? ` The card hold could not wait for the chargeback. If the platform wins it, the gift's part of the fee is collectable: restore the gift (gift_cards ${funding.spentGiftId ?? "with this job_id"}) by hand keeping that part, and pay it to the Helpr (Q2099).`
                  : ""),
              fields: { job_id: job.id, stage, short_cents: shortCents, gift_paid_cents: funding.cents, gift_kept_cents: keptCents, donation_reversed: funding.donationReversed ? "yes" : "no", dispute_open: funding.disputeOpen ? "yes" : "no" },
              oncePerDayKey: `gift-card-fee-capped:${job.id}`,
            });
            return { cents: keptCents, uncollectable: true };
          }
          console.error(`CRITICAL: [void-cancelled-payments] job ${job.id}: its card payment is ${shortCents}c short of the fees it owes and ${why}; not settling (${stage}).`);
          defects.record(`gift fee funding ${job.id} (${stage}): card ${shortCents}c short, ${why} — not settled`);
          await postSlackOpsAlert({
            kind: "money_at_risk",
            severity: "critical",
            title: "Cancelled job owes more in fees than its card and gift paid",
            message: `Job ${job.id} ("${job.title}") was cancelled late. Its card payment is smaller than the cancellation fee plus the card fee kept, and ${why}, so the rest of the fee cannot come from the poster's money. No money moved and the job stays in escrow; settle it by hand.`,
            fields: { job_id: job.id, stage, short_cents: shortCents, gift_paid_cents: funding.cents, donation_reversed: funding.donationReversed ? "yes" : "no", dispute_open: funding.disputeOpen ? "yes" : "no" },
            oncePerDayKey: `gift-card-fee-shortfall:${job.id}`,
          });
          results.push({ job_id: job.id, title: job.title, status: "gift_fee_shortfall" });
          return null;
        }
        return { cents: funding.cents };
      };
      /** Q1806: what the gift's kept cents paid, for the poster's "gift is back" notice. */
      const giftKeptReason = (feeOwed: boolean, blockOwed: boolean) =>
        [
          feeOwed ? `your ${crewShares ? "crew" : "Helpr"} for their time` : null,
          blockOwed ? "the crew members whose spots you closed close to the start" : null,
        ].filter((x): x is string => !!x).join(" and ") || undefined;

      /**
       * Q1806: what a cancel keeps of a card capture besides the fees owed: the
       * card fee (never less than Stripe's) and a first job's setup fee. ONE
       * formula for the hold and the captured paths, so a run that captured a
       * hold and died before settling prices the same shortfall on its retry
       * (which takes the captured path): lh-money-escrow design review #1.
       */
      // A10 (rebase onto the Declutter stack): the same seller-fault exemptions
      // as the refund's own voidSplit, so the shortfall is priced as it is paid.
      const cardNonRefundableCents = (capturedCents: number, actualFeeCents: number) =>
        refundToPayerCents({
          capturedCents,
          actualFeeCents: sellerFault ? 0 : actualFeeCents,
          customerFeeCents: refundsSeriesVisitInFull(job) || sellerFault ? 0 : Math.round(Number(job.customer_fee_amount ?? 0) * 100),
          setupFeeCents: setupFeeKeptCents(job),
        }).nonRefundableCents;

      /**
       * Q1806: what the gift keeps after a hold was captured whole: the fees
       * left after payBlockFees (a member whose account is gone is voided
       * there) plus what the card keeps (cardNonRefundableCents, at the
       * charge's real fee), less the capture; never more than the gift paid.
       */
      const giftKeptAfterCapture = (
        // deno-lint-ignore no-explicit-any
        captured: any,
        captureCents: number,
        feeOwedCents: number,
        giftCents: number,
      ): number => {
        const owedCents = feeOwedCents + crewBlockFeeCents(blockFeeRows);
        const shortCents = Math.max(0, cardNonRefundableCents(captureCents, actualOrEstimatedFeeCents(captured, captureCents)) + owedCents - captureCents);
        if (shortCents > giftCents) {
          defects.record(`gift fee funding ${job.id} (fee capture): ${shortCents}c short after capture, the gift paid ${giftCents}c`);
        }
        return Math.min(shortCents, giftCents);
      };

      let paymentIntentId = job.stripe_payment_intent_id;

      // Resolve payment intent from session if not stored
      if (!paymentIntentId && job.stripe_session_id) {
        try {
          const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id, {
            expand: ["payment_intent"],
          });
          const pi = session.payment_intent;
          paymentIntentId = typeof pi === "string" ? pi : pi?.id;
          if (paymentIntentId) {
            const { error: piBackfillErr } = await supabaseAdmin.from("jobs").update({ stripe_payment_intent_id: paymentIntentId }).eq("id", job.id);
            if (piBackfillErr) {
              console.error(`[void-cancelled-payments] failed to backfill stripe_payment_intent_id for job ${job.id}:`, piBackfillErr.message);
            defects.record(`PI backfill ${job.id}: ${piBackfillErr.message}`);
            }
          }
        } catch (e: any) {
          if (isTestObjectUnderLiveKey(e)) {
            logTestObjectUnderLiveKey("void-cancelled-payments", { job_id: job.id, object: "checkout.session", id: job.stripe_session_id });
            results.push({ job_id: job.id, title: job.title, status: "skipped_test_mode_object", skipped: true });
            continue;
          }
          results.push({ job_id: job.id, title: job.title, status: "session_not_found", error: (e as Error).message });
          continue;
        }
      }

      if (!paymentIntentId) {
        // No payment was ever made — just update status. Guarded like the rest:
        // a zero-row match here means the job left 'escrow' under us, and
        // silently reporting it settled is what keeps it in the hourly loop.
        // Q1490: a fully gift-funded crew has no card to withhold a block fee
        // from, so the gift keeps it. The fees are tried FIRST, as the card
        // paths do (payBlockFees), from the platform's balance the gift paid
        // into (no charge to link): a member whose account is gone is voided
        // there and so is never withheld (review #7); one that cannot go now
        // is withheld and Part F pays it later.
        //
        // Q1806: the same for the late-cancellation fee owed to the Helpr (or
        // each crew member). It used to be priced and then dropped here: the
        // whole gift came back and nobody paid the fee. Now, when a gift paid
        // for this job, the fee is put on its ledger and sent FIRST (from the
        // platform balance the gift paid into), then kept from the gift, and
        // the job is marked charged so Parts D/E retry a fee that could not go
        // yet. With no gift and no card there is no money behind the job, so no
        // fee is paid from the platform's own money (never absorb a fee).
        let giftFeeCents = Math.round(jobCancellationFee * 100);
        if (giftFeeCents > 0) {
          const funding = await giftFeeFunding(job.id);
          const blockCentsNow = crewBlockFeeCents(blockFeeRows);
          if (funding === null) {
            console.error(`[void-cancelled-payments] job ${job.id}: could not read what its gift paid; not settling this run.`);
            defects.record(`gift fee funding read ${job.id}: unreadable — not settled`);
            results.push({ job_id: job.id, title: job.title, status: "gift_fee_funding_unreadable" });
            continue;
          }
          if (funding.disputeOpen) {
            // Review of 8354ebb0e #1: a chargeback on the donation that can
            // still be won (or was won, gift not yet restored) is not a final
            // loss, and a gift-funded job has no hold that expires: it waits in
            // escrow rather than settling without the fee for good.
            console.warn(`[void-cancelled-payments] job ${job.id}: $${jobCancellationFee.toFixed(2)} cancellation fee owed; a chargeback on its gift's donation is not decided; waiting.`);
            await postSlackOpsAlert({
              kind: "custom",
              severity: "warning",
              title: "Cancellation fee waits for a chargeback on its gift",
              message: `Job ${job.id} ("${job.title}") was paid by a gift card and cancelled late, so a $${jobCancellationFee.toFixed(2)} cancellation fee is owed, but the donation behind the gift has a chargeback that is still open (or was won and the gift is not restored yet). No money moved and the job stays in escrow until it is decided. If the dispute was won, set payment_status back to 'paid' on the gift row this job spent (gift_cards ${funding.spentGiftId ?? "with this job_id"}), not only on the donation's root row.`,
              fields: { job_id: job.id, fee: jobCancellationFee, gift_paid_cents: funding.cents, dispute_open: "yes", spent_gift_id: funding.spentGiftId ?? "unknown" },
              oncePerDayKey: `gift-fee-dispute-open:${job.id}`,
            });
            results.push({ job_id: job.id, title: job.title, status: "gift_fee_dispute_open" });
            continue;
          }
          if (funding.cents === 0 && !funding.restored) {
            console.warn(`[void-cancelled-payments] job ${job.id}: $${jobCancellationFee.toFixed(2)} cancellation fee owed, but no card or gift paid for this job; nothing to pay it from.`);
            giftFeeCents = 0;
          } else if (funding.donationReversed || (funding.restored && funding.cents < giftFeeCents + blockCentsNow)) {
            // Nothing left to pay the fee from without it being the platform's
            // own money: the gift's donation went back to the donor (review of
            // Q1806 #1), or an earlier run already gave the gift back without
            // keeping the fee (#6). The gift is settled either way, so the job
            // settles without the fee and a person decides (once a day per job).
            const why = funding.donationReversed
              ? "the donation behind the gift was refunded or charged back"
              : "an earlier run already returned the gift without keeping the fee";
            console.warn(`[void-cancelled-payments] job ${job.id}: $${jobCancellationFee.toFixed(2)} cancellation fee not paid: ${why}.`);
            await postSlackOpsAlert({
              kind: "custom",
              severity: "warning",
              title: "Cancellation fee not paid on a gift-funded job",
              message: `Job ${job.id} ("${job.title}") was paid by a gift card and cancelled late, so a $${jobCancellationFee.toFixed(2)} cancellation fee is owed, but ${why}. The fee was not paid from the platform's own money; decide by hand whether anyone is owed it. (If cancellation_fee_transfers already shows it paid, an earlier run sent it before the donation was reversed; the job is left uncharged, so reconciliation will flag its fee status.)`,
              fields: { job_id: job.id, fee: jobCancellationFee, gift_kept_cents: funding.cents, donation_reversed: funding.donationReversed ? "yes" : "no" },
              oncePerDayKey: `gift-fee-unfunded:${job.id}`,
            });
            giftFeeCents = 0;
          } else if (funding.cents < giftFeeCents + blockCentsNow) {
            // A gift-funded job's gift covers its whole cost, and the fee is at
            // most half the budget, so this should not happen: the fee would be
            // paid partly from the platform's own money. Fails closed.
            console.error(`CRITICAL: [void-cancelled-payments] job ${job.id}: its gift paid ${funding.cents}c, less than the ${giftFeeCents}c cancellation fee and ${blockCentsNow}c block fees it owes; not settling.`);
            defects.record(`gift fee funding ${job.id}: gift paid ${funding.cents}c < fees ${giftFeeCents + blockCentsNow}c — not settled`);
            await postSlackOpsAlert({
              kind: "money_at_risk",
              severity: "critical",
              title: "Gift-funded cancelled job owes more in fees than its gift paid",
              message: `Job ${job.id} ("${job.title}") was paid by a gift card and cancelled late, but the gift paid less than the fees owed out of it. No money moved and the job stays in escrow; settle it by hand.`,
              fields: { job_id: job.id, gift_paid_cents: funding.cents, fee_cents: giftFeeCents, block_fee_cents: blockCentsNow },
              oncePerDayKey: `gift-fee-shortfall:${job.id}`,
            });
            results.push({ job_id: job.id, title: job.title, status: "gift_fee_shortfall" });
            continue;
          }
        }
        if (giftFeeCents > 0 && !(await payCancellationFee(jobCancellationFee, null))) {
          // The fee is not on its ledger (a failed read or claim, recorded as a
          // defect there): keeping it from the gift now would leave nothing for
          // Part E to pay it from. The job stays in escrow; the next run retries.
          results.push({ job_id: job.id, title: job.title, status: "gift_fee_not_claimed" });
          continue;
        }
        if (blockFeeRows.some((r) => r.status === "owed" || r.status === "failed")) {
          const paidFirst = await payCrewBlockFees({ stripe, admin: supabaseAdmin, fn: "void-cancelled-payments" }, job, blockFeeRows, null);
          for (const p of paidFirst.problems) defects.record(p);
        }
        const giftBlockCents = crewBlockFeeCents(blockFeeRows);
        const giftKeptFor = [
          giftFeeCents > 0 ? `your ${crewShares ? "crew" : "Helpr"} for their time` : null,
          giftBlockCents > 0 ? "the crew members whose spots you closed close to the start" : null,
        ].filter((x): x is string => !!x).join(" and ") || undefined;
        const updated = await settleCancelledJob(
          job,
          giftFeeCents > 0
            // Q1345's stamp, as on the card paths: the fee the gift paid.
            ? { payment_status: "cancelled", cancellation_fee_status: "charged", cancellation_fee: jobCancellationFee }
            // Q1915 review #4: every crew share went back, so no fee was charged.
            : crewShareReturned ? { payment_status: "cancelled", cancellation_fee_status: null, cancellation_fee: 0 } : { payment_status: "cancelled" },
          "no payment found",
          giftFeeCents + giftBlockCents,
          giftKeptFor,
        );
        results.push({ job_id: job.id, title: job.title, status: "no_payment_found", updated });
        continue;
      }

      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
          expand: ["latest_charge.balance_transaction"],
        });

        if (pi.status === "requires_capture") {
          // Uncaptured authorization. RECOMPUTE the fee server-side from trusted
          // job fields (F-MONEY-32) — never trust the persisted, client-writable
          // `job.cancellation_fee`, which an assigned helper could inflate to
          // capture more of the poster's hold than the schedule allows.
          // Q2000: lowered to what the card covered when the gift cannot pay.
          let cancellationFee = jobCancellationFee;
          const blockCents = crewBlockFeeCents(blockFeeRows);
          // Q1806: never more than the hold (amount_capturable).
          const holdCents = Math.max(0, Math.round(Number(pi.amount_capturable ?? pi.amount ?? 0)));
          // Boards 66/172 slice 2: THE split the poster's cancel dialog was
          // quoted from (create-payment cancel_quote, "Back to you"), so the
          // quote and what this hold releases cannot disagree.
          const holdSplit = posterCancelSplit({
            job, sellerFault, cancellationFeeCents: Math.round(cancellationFee * 100), blockFeeCents: blockCents,
            charge: { state: "hold", amountCents: Number(pi.amount ?? 0), capturableCents: holdCents },
          });
          if (holdSplit.state !== "hold") throw new Error("posterCancelSplit answered a hold with a captured split");
          if (cancellationFee > 0 || blockCents > 0) {
            // Capture ONLY the fee — Stripe auto-releases the uncaptured
            // remainder (budget + customer fee) back to the poster. Charging
            // the fee here is what a bare cancel() previously skipped, silently
            // waiving every fee owed on an uncaptured hold. Q1390: plus the
            // crew's block fees.
            const feeCents = Math.round(cancellationFee * 100) + blockCents;
            // Q1806: never more than the hold. A gift-plus-card job's hold can
            // be smaller than the fee: the whole hold is captured, so the card
            // keeps what a captured charge would (cardNonRefundableCents) and
            // the gift pays the rest. Checked before any money moves with a
            // conservative fee estimate (a Klarna/Affirm hold costs ~6%), then
            // priced from the charge's real fee after the capture.
            const captureCents = holdSplit.captureCents;
            let holdGift: { cents: number; uncollectable?: true } | null = null;
            /** Q2000: the gift can never pay its part; the fee is capped at the card below. */
            let holdGiftGone = false;
            /** Review of 8354ebb0e #2: what an earlier restore kept of the gift, still paying its part. */
            let holdGiftKeptOnlyCents = 0;
            if (holdSplit.feesExceedHold) {
              const estFeeCents = Math.max(stripeProcessingCostCents(holdCents), Math.round(holdCents * 0.0599) + 30);
              holdGift = await giftCoversShortfall(cardNonRefundableCents(holdCents, estFeeCents) + feeCents - holdCents, "fee capture", true);
              if (!holdGift) continue;
              if (holdGift.uncollectable) {
                holdGiftGone = true;
                holdGiftKeptOnlyCents = holdGift.cents;
                holdGift = null;
              }
            }
            await stripe.paymentIntents.capture(paymentIntentId, { amount_to_capture: captureCents });
            // Re-fetch so latest_charge is populated for the helper transfer's
            // source_transaction link. Q1806: with the charge's real fee.
            const captured = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge.balance_transaction"] });
            if (holdGiftGone) {
              // Q2000: the whole hold was captured; the fee is what is left of
              // it after the card's own kept fees (cardNonRefundableCents, the
              // SAME formula the captured path caps with on a retry).
              const cardLeftCents = Math.max(0, captureCents - cardNonRefundableCents(captureCents, actualOrEstimatedFeeCents(captured, captureCents)));
              cancellationFee = Math.min(Math.round(cancellationFee * 100), cardLeftCents + holdGiftKeptOnlyCents) / 100;
            }
            // Q1714: the rest of the hold goes back; the poster is told what and
            // why once the job is settled below.
            // Owner 2026-10-25: no fee names; what went to the Helpr for their time.
            const keptParts = [
              cancellationFee > 0 ? `${refundDollars(Math.round(cancellationFee * 100))} for your Helpr's time` : null,
              blockCents > 0 ? `${refundDollars(blockCents)} for the crew spots you closed close to the start` : null,
            ].filter((x): x is string => !!x);
            const holdFeeOnLedger = await payCancellationFee(cancellationFee, captured);
            await payBlockFees(captured);
            if ((holdGift || holdGiftGone) && !holdFeeOnLedger) {
              // Review #4: no gift kept for a fee with no ledger row; the hold is
              // captured, so the next run's captured path prices it and retries.
              results.push({ job_id: job.id, title: job.title, status: "gift_fee_not_claimed" });
              continue;
            }
            const holdGiftKeptCents = holdGift ? giftKeptAfterCapture(captured, captureCents, Math.round(cancellationFee * 100), holdGift.cents) : 0;
            // Q1345: this capture's fee is stamped in the same write (Spent, the
            // fee pill); the crew block fees are on crew_block_fees.
            const settledFee = await settleCancelledJob(job, {
              payment_status: "refunded",
              // Q2000: a fee capped to nothing charged nothing.
              cancellation_fee_status: holdGiftGone && cancellationFee <= 0 ? null : "charged",
              cancellation_fee: cancellationFee,
            }, "fee capture", holdGiftKeptCents, giftKeptReason(cancellationFee > 0, blockCents > 0));
            if (settledFee) refunded++;
            // Q1806: a hold captured whole sends nothing back to the card; the
            // gift notice says what the gift paid.
            if (!((holdGift || holdGiftGone) && holdSplit.backCents <= 0)) await tellPosterMoneyBack(job, pi, {
              key: `release:${pi.id}`, kind: "release",
              amountCents: holdSplit.backCents, keptCents: captureCents,
              keptReason: keptParts.join(" and ") || null,
              keptUnnamed: true,
            });
            results.push({ job_id: job.id, title: job.title, status: settledFee ? "fee_captured" : "fee_captured_not_settled", cancellation_fee: cancellationFee });
          } else {
            // No fee owed — cancel the uncaptured hold in full; funds release to
            // the poster.
            await stripe.paymentIntents.cancel(paymentIntentId);
            // Q1915 review #4: a crew whose every share went back charged no fee.
            const settledVoid = await settleCancelledJob(job, crewShareReturned
              ? { payment_status: "cancelled", cancellation_fee_status: null, cancellation_fee: 0 }
              : { payment_status: "cancelled" }, "PI cancel");
            // Q1714: the whole hold went back; tell the poster.
            await tellPosterMoneyBack(job, pi, { key: `release:${pi.id}`, kind: "release", amountCents: holdSplit.backCents, keptCents: 0, keptReason: null });
            if (settledVoid) voided++;
            results.push({ job_id: job.id, title: job.title, status: settledVoid ? "voided" : "voided_not_settled", amount: pi.amount / 100 });
          }
        } else if (pi.status === "succeeded") {
          // Already captured — refund the poster everything EXCEPT the fee owed.
          // RECOMPUTE the fee server-side from trusted job fields (F-MONEY-32);
          // never trust the persisted, client-writable `cancellation_fee`. The
          // tiered schedule is deterministic from budget + scheduled date +
          // cancel time, so this still equals the amount the poster was shown on
          // the "Cancel · pay $X" button (both derive from the same ladder),
          // while removing the ability for a helper to skim the refund.
          // An unfilled or ban-ended series visit carries no cancellation fee
          // and gets its service fee back, less Stripe's processing fee
          // (money audit MEDIUM-9, Q407 (5)/(9)/(12); _shared/seriesRefund.ts).
          // Its fee is priced as 0 above.
          const fullSeriesRefund = refundsSeriesVisitInFull(job);
          // Q2000: lowered to what the card covered when the gift cannot pay.
          let cancellationFee = jobCancellationFee;
          // Refund the entire captured amount minus the cancellation fee AND the
          // non-refundable poster service fee.
          // pi.amount_received is what Stripe actually collected, which is
          // larger than job.budget when a customer service fee, sales tax,
          // urgent fee, or one-time onboarding fee was also charged at checkout.
          // Using job.budget alone left those amounts stranded on the platform
          // and never returned to the customer.
          const capturedCents = pi.amount_received ?? pi.amount;
          // Service fee is non-refundable: Stripe already took its cut on the
          // full capture and does NOT return it on a refund, so refunding the
          // whole (budget + fee) would leave the platform out-of-pocket by that
          // processing cost on every cancellation. We withhold the poster's
          // service fee, floored at Stripe's ACTUAL processing cost for this
          // specific charge (read from the balance transaction) so the platform
          // never loses money regardless of payment method — cards, Klarna/
          // Affirm/Afterpay, and ACH all carry different real rates.
          // A poster-fee job keeps no service fee, only Stripe's real fee
          // (posterCancelKeptFeeCents, Q2082 slice 4).
          const serviceFeeCents = posterCancelKeptFeeCents(job);
          // An unfilled or ban-ended series visit gets the service fee back
          // too, but never Stripe's processing fee: the platform never absorbs
          // a fee and never refunds more than it netted (owner decision
          // Q407 (12), 2026-09-25).
          // Q1674 (owner, 2026-10-12): a first job's $2 setup fee is kept on a
          // cancel ("paid and done": never refunded, never charged again).
          // Q1806: the card pays what this cancel keeps first; a gift-plus-card
          // job whose card payment is smaller than that (fees owed + the kept
          // card and setup fees) has the gift pay the rest. Checked before any
          // money moves (the block fees below are the first).
          const feeOwedCents = Math.round(cancellationFee * 100);
          // Q1675: what earlier refunds on this charge already returned (the
          // duplicate $2 setup fee settleOnboardingFee refunds, an admin's
          // partial refund) comes off what this refund may return:
          // pi.amount_received does not go down after them. The charge's own
          // amount_refunded is the authority.
          const chargeRefundedCents = Number(
            (pi.latest_charge && typeof pi.latest_charge === "object"
              ? (pi.latest_charge as { amount_refunded?: number }).amount_refunded
              : 0) ?? 0,
          );
          const keptOfCard = cardNonRefundableCents(capturedCents, actualOrEstimatedFeeCents(pi, capturedCents));
          const cardShortCents = Math.max(0, keptOfCard + feeOwedCents + crewBlockFeeCents(blockFeeRows) - capturedCents);
          let cardGift: { cents: number; uncollectable?: true } | null = null;
          /** Q2000: the gift can never pay its part; the fee was capped at the card. */
          let cardGiftGone = false;
          // Build review of e03e43b8b #1: the gift is asked only when the card
          // cannot pay the FEES owed (late fee + crew block fees). A charge that
          // holds them but not also the kept card and setup fee (a hold captured
          // fee-only, whose run died before settling) settles as before, exactly
          // as the hold path priced it, instead of sitting in escrow and paging.
          const feesFitCard = feeOwedCents + crewBlockFeeCents(blockFeeRows) <= capturedCents - Math.max(0, chargeRefundedCents);
          if (cardShortCents > 0 && !feesFitCard) {
            // Review #2: an earlier refund on the charge left the card even
            // less to pay with; the gift covers that too.
            cardGift = await giftCoversShortfall(cardShortCents + Math.max(0, chargeRefundedCents), "refund", false);
            if (!cardGift) continue;
            if (cardGift.uncollectable) {
              // Q2000 (owner, option A): the fee is what the card still holds
              // after its own kept fees, plus what an earlier restore kept of a
              // live gift (review of 8354ebb0e #2); the rest is not paid.
              cardGiftGone = true;
              const cardLeftCents = Math.max(0, capturedCents - Math.max(0, chargeRefundedCents) - keptOfCard);
              cancellationFee = Math.min(feeOwedCents, cardLeftCents + cardGift.cents) / 100;
              cardGift = null;
            }
          }
          // Q1390: the crew's block fees are tried first and withheld from the refund.
          await payBlockFees(pi);
          const blockFeeCents = crewBlockFeeCents(blockFeeRows);
          // THE refund amount (owner, 2026-10-14: never absorb a fee), from
          // _shared/refundAmount.ts, the definition every refund path uses,
          // through posterCancelSplit: the SAME split create-payment's
          // cancel_quote showed the poster as "Back to you" (boards 66/172
          // slice 2), so the quote and this refund cannot disagree.
          // A10: a seller-fault Declutter setup job keeps no card fee (the seller
          // owes it: declutter_setup_job_fee_debt below); its setup fee is still kept.
          const capturedSplit = posterCancelSplit({
            job, sellerFault, cancellationFeeCents: Math.round(cancellationFee * 100), blockFeeCents,
            charge: {
              state: "captured",
              capturedCents,
              actualFeeCents: actualOrEstimatedFeeCents(pi, capturedCents),
              alreadyRefundedCents: chargeRefundedCents,
              taxCents: await chargeTaxCentsFor(stripe, pi),
            },
          });
          if (capturedSplit.state !== "captured") throw new Error("posterCancelSplit answered a captured charge with a hold split");
          const voidSplit = capturedSplit.split;
          const nonRefundableCents = voidSplit.nonRefundableCents;
          // Q1806: what the gift keeps, from the fees left after payBlockFees.
          const cardGiftKeptCents = cardGift
            ? Math.min(cardGift.cents, Math.max(0, nonRefundableCents + feeOwedCents + blockFeeCents - (capturedCents - Math.max(0, chargeRefundedCents))))
            : 0;
          // Earlier refunds returned MORE than this cancel may (they ate into
          // the cancellation fee or the fees it keeps; lh-money-escrow review
          // of Q1675 #1). Settling would pay the Helpr's fee out of money that
          // already went back to the poster, a fee the platform absorbs. Page
          // and leave the job for a person; nothing more is moved (a crew's
          // block fees, paid just above, already went out).
          // Q1806: on a gift-plus-card job the gift already covers an earlier
          // refund (cardGift above), so it does not stop the settlement. Nor
          // does a capped fee (cardGiftGone): it is capped at what the card
          // still holds after earlier refunds, plus a part of the gift an
          // earlier restore kept, which the gift pays (delta re-review #1).
          if (!cardGift && !cardGiftGone && chargeRefundedCents > voidSplit.ceilingCents + 1) {
            console.error(`[void-cancelled-payments] job ${job.id}: charge already refunded ${chargeRefundedCents}¢, more than the ${voidSplit.ceilingCents}¢ this cancel may return — not settled`);
            defects.record(`refunded past kept fees ${job.id}: ${chargeRefundedCents}¢ > ${voidSplit.ceilingCents}¢`);
            await postSlackOpsAlert({
              kind: "money_at_risk",
              severity: "warning",
              title: "Cancelled job's charge was already refunded past what the cancel keeps",
              message: "Earlier refunds on this charge returned more than the cancellation may (they ate into the cancellation fee or the card fee). The job was NOT settled and no cancellation fee was paid; reconcile by hand.",
              fields: { job_id: job.id, payment_intent: paymentIntentId, refunded_cents: chargeRefundedCents, refundable_cents: voidSplit.ceilingCents },
              oncePerDayKey: `void-refunded-past-kept:${job.id}`,
            });
            results.push({ job_id: job.id, title: job.title, status: "refunded_past_kept_fees" });
            continue;
          }
          // The charge already returned everything this cancel could (Q1675;
          // also a refund of ours whose ledger row was lost): settle the
          // status only, never refund the ceiling again.
          const refundedAtStripe = voidSplit.ceilingCents > 0 && voidSplit.remainingCents === 0 && chargeRefundedCents > 0;
          // Signed on purpose (not floored): the $0 branch below reports the
          // raw shortfall to ops, as it did before the shared helper.
          const refundAmount = voidSplit.refundCents > 0 || refundedAtStripe
            ? voidSplit.refundCents
            // Q2082 (a): never hand back the tax just kept (review of 461a6b724 #5).
            : capturedCents - Math.round(cancellationFee * 100) - blockFeeCents - nonRefundableCents - voidSplit.taxKeptCents;
          // ── Ledger guard against a SECOND real refund ────────────────────
          // The idempotency key below is permanent and unsalted. That protects
          // an overlapping run within Stripe's ~24h replay window and nothing
          // beyond it — and this loop selects on (status='cancelled',
          // payment_status='escrow'), so a job whose status flip matched zero
          // rows is re-selected every hour, forever. On the first run past 24h
          // the same key mints a brand-new refund and the poster is paid back
          // twice out of the platform's own money.
          //
          // `payment_refunds` is the ledger this path already writes, so ask it
          // first. Scoped to this source: an admin's separate partial refund on
          // the same job is a different fact and must not block the cancellation
          // settlement.
          const { data: priorRefunds, error: priorRefundErr } = await supabaseAdmin
            .from("payment_refunds")
            .select("stripe_refund_id")
            .eq("job_id", job.id)
            .eq("source", "void_cancelled_payments")
            .limit(1);
          if (priorRefundErr) {
            // Fail CLOSED: refunding without knowing whether we already did is
            // how the poster gets paid twice. Leave the job in escrow; the next
            // hourly run retries.
            console.error(`[void-cancelled-payments] prior-refund check failed for job ${job.id}:`, priorRefundErr);
            defects.record(`prior-refund check ${job.id}: ${priorRefundErr.message}`);
            results.push({ job_id: job.id, title: job.title, status: "refund_dedupe_read_failed", error: priorRefundErr.message });
            continue;
          }
          const alreadyRefunded = (priorRefunds ?? []).length > 0 || refundedAtStripe;
          let cancellationRefundNotice: Parameters<typeof tellPosterMoneyBack>[2] | null = null;

          if (refundAmount > 0 && !alreadyRefunded) {
            // Idempotency key still set: it is the cheap in-window guard against
            // two overlapping runs. The ledger check above is the one that holds
            // past 24 hours.
            // own-mistake full refund (owner, 2026-10-14) rule, applied by the
            // owner's A10 rule (2026-10-17) when sellerFault: a Declutter seller
            // backing out is no fault of the poster, so the card fee comes back
            // too and the SELLER owes it (declutter_setup_job_fee_debt below).
            const refund = await stripe.refunds.create(
              { payment_intent: paymentIntentId, amount: refundAmount },
              { idempotencyKey: `cancel-refund-${job.id}` },
            );
            // Q1714: announced at once (so this path, not the webhook's safety
            // net, wins the claim), with what was kept and why in the amounts
            // computed HERE (review of Q1714 #3), not rebuilt from job columns.
            if (refund?.id) {
              // Q1674: nonRefundableCents also holds a first job's kept $2 setup
              // fee; it is named on its own, never as "card processing fee".
              const setupKeptCents = Math.min(setupFeeKeptCents(job), nonRefundableCents);
              // A job priced after the no-service-fee change (platform_fee_percent
              // 0) paid its card cost as customer_fee_amount: that is the card
              // processing fee, not a service fee (cardCostFeeCents; lh-money-escrow
              // review 2026-10-25 #2).
              // Owner 2026-10-25: members never see a card or service fee
              // named; the notice names only what went to the Helpr for their
              // time, closed crew spots and the one-time setup fee.
              const feeCents = Math.round(cancellationFee * 100);
              const parts = [
                feeCents > 0 ? `${refundDollars(feeCents)} for your Helpr's time` : null,
                blockFeeCents > 0 ? `${refundDollars(blockFeeCents)} for the crew spots you closed close to the start` : null,
                setupKeptCents > 0 ? `the one-time ${refundDollars(setupKeptCents)} account setup fee, which is paid once and never refunded` : null,
              ].filter((x): x is string => !!x);
              const refundedCents = Math.round(Number(refund.amount ?? refundAmount));
              cancellationRefundNotice = {
                key: `refund:${refund.id}`, kind: "refund", amountCents: refundedCents,
                // An earlier refund on this charge (Q1675) went back too: not kept.
                keptCents: Math.max(0, capturedCents - chargeRefundedCents - refundedCents),
                keptReason: (parts.length <= 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`) ?? null,
                keptUnnamed: true,
              };
            }
            // Ledger row (F-MONEY-04). Best-effort: the refund is already out,
            // so a ledger write failure is logged, not thrown. Upsert on the
            // Stripe refund id so a cron re-run doesn't duplicate the row.
            const { error: refundLedgerErr } = await supabaseAdmin.from("payment_refunds").upsert({
              job_id: job.id,
              customer_id: job.customer_id,
              stripe_refund_id: refund.id,
              stripe_payment_intent_id: paymentIntentId,
              amount_cents: Math.round(Number(refund.amount ?? refundAmount)),
              currency: refund.currency ?? "usd",
              is_partial: cancellationFee > 0 || nonRefundableCents > 0,
              reason: sellerFault
                ? `Declutter seller backed out: full refund, card fee billed to the seller${setupFeeKeptCents(job) > 0 ? " (the $2 setup fee kept)" : ""}`
                // What was REALLY kept, in dollars (jobs 375000de / 1251173a,
                // 2026-10-24: an expired job with nobody hired was labelled
                // "minus cancellation + service fee" while only the card fee
                // and the tax on it were kept). The same split the poster's
                // notice above names. A poster-fee job keeps the card
                // processing cost, never a service fee (Q2082 slice 4 #7).
                : (() => {
                  const setupKept = Math.min(setupFeeKeptCents(job), nonRefundableCents);
                  const serviceKept = fullSeriesRefund || isPosterFeeJob(job) || cardCostFeeCents(job) > 0 ? 0 : Math.min(serviceFeeCents, nonRefundableCents - setupKept);
                  return refundReasonWithKeptParts("cancellation refund", {
                    cancellationFeeCents: Math.round(cancellationFee * 100),
                    blockFeeCents,
                    serviceFeeCents: serviceKept,
                    processingFeeCents: Math.max(0, nonRefundableCents - setupKept - serviceKept),
                    taxCents: voidSplit.taxKeptCents,
                    setupFeeCents: setupKept,
                  });
                })(),
              source: "void_cancelled_payments",
              initiated_by_user_id: null,
            }, { onConflict: "stripe_refund_id", ignoreDuplicates: true });
            if (refundLedgerErr) {
              console.error(`[void-cancelled-payments] refund ledger write failed for refund ${refund.id} (job ${job.id}); refund succeeded, reconcile manually:`, refundLedgerErr);
              defects.record(`refund ledger write ${job.id}: ${refundLedgerErr.message}`);
              // The refund already left Stripe, so we never throw — but a dropped
              // ledger row is a real Stripe↔ledger divergence a human must
              // reconcile, so surface it to ops rather than leaving it in a log.
              postSlackOpsAlert({
                kind: "money_at_risk",
                severity: "warning",
                title: "Refund ledger write failed",
                message: "A Stripe refund succeeded but its payment_refunds row was not written. Reconcile manually.",
                fields: {
                  refund_id: refund.id,
                  job_id: job.id,
                  source: "void_cancelled_payments",
                  amount_cents: Math.round(Number(refund.amount ?? refundAmount)),
                  db_error: refundLedgerErr.message,
                },
              });
            }
            if (cancellationRefundNotice) await tellPosterMoneyBack(job, pi, cancellationRefundNotice);
          } else if (alreadyRefunded) {
            // A refund for this cancellation is already on the ledger. Fall
            // through to the status flip so the job finally leaves escrow —
            // that flip failing is exactly how we ended up back here.
            console.log(
              `[void-cancelled-payments] job ${job.id} already has a cancellation refund on the ledger or the charge already shows it refunded (${chargeRefundedCents}¢); settling status only.`,
            );
          } else if (cardGift || cardGiftGone) {
            // Q1806: the card paid less than this cancel keeps and the gift
            // pays the rest (kept in settleCancelledJob below), so nothing goes
            // back to the card. Expected, not an ops alert. Q2000: or the fee
            // was capped at the card (paged once above).
            console.log(`[void-cancelled-payments] job ${job.id}: the card payment goes to the fees; ${cardGiftKeptCents}c of them come from the gift.`);
          } else {
            // The cancellation fee + non-refundable service fee consumed the
            // whole capture, so the poster gets $0 back while the job still
            // settles to refunded below. No ledger row is written in this branch,
            // so — like the cancel_escrow path — this must NEVER pass silently:
            // it can be legitimate (a big late-cancel fee) or bad data (a
            // stale/oversized customer_fee_amount, or a degenerate capturedCents).
            // Alert ops with the inputs so a human can reconcile.
            console.error(
              `[void-cancelled-payments] refundAmount<=0 for job ${job.id} ` +
                `(capturedCents=${capturedCents}, cancellationFeeCents=${Math.round(cancellationFee * 100)}, ` +
                `nonRefundableCents=${nonRefundableCents}) — poster refunded $0.`,
            );
            const suspicious =
              !Number.isFinite(capturedCents) || capturedCents <= 0;
            postSlackOpsAlert({
              kind: "custom",
              severity: suspicious ? "warning" : "info",
              title: "Escrow cancellation resolved with $0 refund",
              message:
                "A cron settlement returned nothing to the poster after withholding the cancellation + service fee. Verify this was intended.",
              fields: {
                job_id: job.id,
                payment_intent: paymentIntentId,
                captured_cents: capturedCents,
                cancellation_fee_cents: Math.round(cancellationFee * 100),
                non_refundable_cents: nonRefundableCents,
                refund_amount: refundAmount,
              },
            });
          }

          // A10: the card fee Stripe kept on this charge is the seller's Declutter
          // debt. After the refund (or with it already on the ledger from an
          // earlier run), and on a $0 refund too: Stripe kept the fee either way
          // (lh-money-escrow review of c57d948d0 #6). Billed once per job by the
          // function. A failure leaves the job in escrow so the next run retries
          // the bill (the ledger stops a second refund) and pages ops.
          if (sellerFault) {
            const cardFeeCents = actualOrEstimatedFeeCents(pi, capturedCents);
            const { error: debtErr } = await supabaseAdmin.rpc("declutter_setup_job_fee_debt", {
              p_job_id: job.id,
              p_card_fee_cents: cardFeeCents,
            });
            if (debtErr) {
              console.error(`[void-cancelled-payments] seller fee debt failed for job ${job.id}; refund is out, not settling this run:`, debtErr.message);
              defects.record(`declutter seller fee debt ${job.id}: ${debtErr.message} — refunded, not settled`);
              await postSlackOpsAlert({
                kind: "money_at_risk",
                severity: "warning",
                title: "Declutter seller not billed for a refunded setup job's card fee",
                message: "A setup job cancelled because the Declutter seller backed out was refunded in full, but the card fee was not added to the seller's debt. The job stays in escrow and the next run retries.",
                fields: { job_id: job.id, seller_fee_cents: cardFeeCents, db_error: debtErr.message },
                oncePerDayKey: `declutter-setup-debt:${job.id}`,
              });
              results.push({ job_id: job.id, title: job.title, status: "seller_fee_debt_failed" });
              continue;
            }
          }

          // Transfer the agreed fee to the helper (minus platform commission).
          const refundFeeOnLedger = await payCancellationFee(cancellationFee, pi);
          if ((cardGift || cardGiftGone) && !refundFeeOnLedger) {
            // Review #4: the gift is not kept for a fee with no ledger row for
            // Part E to pay it from. Nothing went back to the card; the next
            // run retries.
            results.push({ job_id: job.id, title: job.title, status: "gift_fee_not_claimed" });
            continue;
          }

          const settledRefund = await settleCancelledJob(job, {
            payment_status: "refunded",
            cancellation_fee_status: cancellationFee > 0 ? "charged" : null,
            // Q2000: the job says the fee that was actually paid (Q1345's stamp;
            // money-reconciliation accepts it only for this case). Q1915: so
            // does a crew whose deleted member's share went back to the poster
            // (money-reconciliation prices it without that share).
            ...(cardGiftGone || crewShareReturned ? { cancellation_fee: cancellationFee } : {}),
          }, "refund", cardGiftKeptCents, giftKeptReason(feeOwedCents > 0, blockFeeCents > 0));
          if (settledRefund) refunded++;
          results.push({
            job_id: job.id,
            title: job.title,
            status: settledRefund ? (refundAmount > 0 ? "refunded" : "zero_refund") : "refunded_not_settled",
            amount: Math.max(0, refundAmount) / 100,
            cancellation_fee_transferred: cancellationFee > 0,
          });
        } else {
          results.push({ job_id: job.id, title: job.title, status: `pi_status_${pi.status}`, skipped: true });
        }
      } catch (e: any) {
        if (isTestObjectUnderLiveKey(e)) {
          logTestObjectUnderLiveKey("void-cancelled-payments", { job_id: job.id, object: "payment_intent", id: paymentIntentId });
          results.push({ job_id: job.id, title: job.title, status: "skipped_test_mode_object", skipped: true });
          continue;
        }
        // Handle "already refunded" gracefully
        if (e.message?.includes("already been refunded")) {
          const settledAlready = await settleCancelledJob(job, { payment_status: "refunded" }, "already-refunded");
          if (settledAlready) refunded++;
          results.push({ job_id: job.id, title: job.title, status: settledAlready ? "already_refunded" : "already_refunded_not_settled" });
        } else {
          results.push({ job_id: job.id, title: job.title, status: "error", error: e.message });
        }
      }
    }

    // ── Part C: gifts frozen on a job that was cancelled before it was funded ──
    //
    // Part A only ever sees jobs still sitting in 'escrow'. A gift RESERVED
    // against a job whose shortfall was never paid leaves the job
    // 'cancelled'/'unpaid' — outside Part A (not escrow) and outside Part B
    // (not open) — while the credit stays 'reserved'. `redeem_gift_card`
    // refuses a 'reserved' credit for any OTHER job, so that gift is frozen
    // solid: not destroyed, but unusable forever. `checkoutSessionExpired`
    // only rescues it if the Stripe SESSION lapses before the job is
    // cancelled, which is a race, not a guarantee.
    //
    // Terminates cleanly: un-reserving clears job_id, so a rescued credit is
    // never re-selected here.
    let giftsUnfrozen = 0;
    const { data: frozenCredits, error: frozenErr } = await supabaseAdmin
      .from("gift_cards")
      .select("job_id")
      .eq("status", "reserved")
      .not("job_id", "is", null)
      .limit(200);
    if (frozenErr) {
      console.error("[void-cancelled-payments] frozen-gift sweep read failed:", frozenErr.message);
      defects.record(`frozen-gift sweep read: ${frozenErr.message}`);
    } else if ((frozenCredits ?? []).length > 0) {
      const frozenJobIds = [
        ...new Set(
          (frozenCredits ?? [])
            .map((c) => (c as { job_id: string | null }).job_id)
            .filter((id): id is string => !!id),
        ),
      ];
      const { data: deadJobs, error: deadJobsErr } = await supabaseAdmin
        .from("jobs")
        .select("id, title")
        .in("id", frozenJobIds)
        .eq("status", "cancelled");
      if (deadJobsErr) {
        console.error("[void-cancelled-payments] frozen-gift job lookup failed:", deadJobsErr.message);
        defects.record(`frozen-gift job lookup: ${deadJobsErr.message}`);
      } else {
        for (const deadJob of (deadJobs ?? [])) {
          const { outcome } = await restorePifGift(
            deadJob as { id: string; title: string },
            "gift frozen on a cancelled, never-funded job",
          );
          if (outcome === "unreserved" || outcome === "restored") giftsUnfrozen++;
        }
      }
    }

    // ── Part F: crew block fees still owed after their job settled (Q1390) ──
    // Both settlement paths try a block fee first and withhold it from the
    // poster's refund, but never wait on it (lh-money-escrow review): a member
    // on a payout hold or with no payout account yet is paid here, every run,
    // once the job has settled. Exactly once: the row id is the Stripe key, the
    // job's transfer group is listed first, and the ledger flip is guarded.
    // A job still in escrow is Part A's (or the payout cron's) own.
    let blockFeesRetried = 0;
    {
      const { data: owedFees, error: owedFeeErr } = await supabaseAdmin
        .from("crew_block_fees")
        .select("id, job_id, helper_id, slot_no, share_basis_cents, fee_percent, fee_cents, status, stripe_transfer_id")
        .in("status", ["owed", "failed"])
        // Oldest first, so rows that keep failing cannot crowd newer ones out
        // forever (lh-money-escrow review, nit 3).
        .order("created_at", { ascending: true })
        .limit(100);
      const feeTableMissing = !!owedFeeErr && (owedFeeErr.code === "42P01" || owedFeeErr.code === "PGRST205");
      if (owedFeeErr && !feeTableMissing) {
        defects.record(`crew block fee sweep read: ${owedFeeErr.message}`);
      } else if (owedFeeErr) {
        // Not deployed yet: nothing can be owed.
      } else if ((owedFees ?? []).length > 0) {
        const byJob = new Map<string, CrewBlockFeeRow[]>();
        for (const r of (owedFees ?? []) as CrewBlockFeeRow[]) byJob.set(r.job_id, [...(byJob.get(r.job_id) ?? []), r]);
        const { data: feeJobs, error: feeJobErr } = await supabaseAdmin
          .from("jobs")
          .select("id, title, helper_fee_percent, helper_fee_flat_cents, payment_status, stripe_payment_intent_id")
          .in("id", [...byJob.keys()])
          .in("payment_status", ["released", "refunded", "cancelled"]);
        if (feeJobErr) {
          defects.record(`crew block fee sweep job read: ${feeJobErr.message}`);
        } else {
          for (const fj of (feeJobs ?? []) as Array<{ id: string; title: string; helper_fee_percent: number | null; stripe_payment_intent_id: string | null }>) {
            // The same gate every Part A job passes (Q231): an undecided or
            // unexecuted dispute decides where this job's money goes first.
            const feeSettlement = await checkUnsettledDispute(supabaseAdmin, fj.id);
            if (feeSettlement.blocked) {
              if (feeSettlement.readError) defects.record(`crew block fee sweep dispute check ${fj.id}: ${feeSettlement.readError}`);
              continue;
            }
            // Stripe mode for THIS job (owner 2026-10-12): test accounts on the test key.
            let stripe: Stripe;
            try {
              ({ stripe } = await stripes.clientForJob(fj.id, "payout"));
            } catch (modeErr) {
              if (!(modeErr instanceof StripeModeRefused)) throw modeErr;
              defects.record(`stripe mode ${fj.id}: ${modeErr.reason}: ${modeErr.message}`);
              continue;
            }
            let chargeId: string | null = null;
            /** Q1806: the charge's PaymentIntent, so a fee is linked only while it fits. */
            let linkPi: Stripe.PaymentIntent | undefined;
            if (fj.stripe_payment_intent_id) {
              try {
                const fpi = await stripe.paymentIntents.retrieve(fj.stripe_payment_intent_id, { expand: ["latest_charge"] });
                linkPi = fpi;
                const ch = fpi.latest_charge;
                // The charge is linked only while the fee still fits in it:
                // payCrewBlockFees asks sourceChargeFor(linkPi), which counts a
                // refunded part as no room, so a fully refunded charge (an admin
                // full refund, lh-money-escrow review nit 1) is never named as
                // a source_transaction that would fail this row every hour. The
                // platform balance pays it instead.
                if (typeof ch === "string") chargeId = ch;
                else if (ch) chargeId = ch.id;
              } catch (e) {
                if (isTestObjectUnderLiveKey(e)) {
                  logTestObjectUnderLiveKey("void-cancelled-payments", { job_id: fj.id, object: "payment_intent", id: fj.stripe_payment_intent_id });
                  continue;
                }
                // Pay from the platform balance rather than not at all.
                console.warn(`[void-cancelled-payments] block fee sweep could not link job ${fj.id}'s charge:`, (e as Error).message);
              }
            }
            const paid = await payCrewBlockFees({ stripe, admin: supabaseAdmin, fn: "void-cancelled-payments", settled: true, linkPi }, fj, byJob.get(fj.id) ?? [], chargeId);
            for (const p of paid.problems) defects.record(p);
            blockFeesRetried++;
          }
        }
      }
    }

    // ── Part G: refunds nobody has told the person about (Q1714) ───────────
    // Every path that makes a refund tells the person itself, right after its
    // ledger row; the charge.refunded webhook tells them about a Dashboard
    // refund. A path that stopped between the refund and its notice (a cron
    // killed at the gateway limit, a worker lost) would leave them untold, so
    // every hour a refund on the ledger that is 15 minutes old with no
    // finished notice is sent here (the claim dedupes it against any other
    // sender). Only refunds made after this sweep shipped: older ones are an
    // owner decision, not a backfill this cron makes on its own.
    let untoldRefundsSent = 0;
    {
      const from = new Date(Math.max(Date.now() - 7 * 86_400_000, Date.parse(UNTOLD_REFUND_SWEEP_FROM))).toISOString();
      const until = new Date(Date.now() - 15 * 60_000).toISOString();
      const { data: ledger, error: ledgerErr } = await supabaseAdmin
        .from("payment_refunds")
        .select("stripe_refund_id, stripe_payment_intent_id, job_id, customer_id, amount_cents, source, created_at")
        .gte("created_at", from)
        .lte("created_at", until)
        .order("created_at", { ascending: true })
        .limit(200);
      if (ledgerErr) {
        defects.record(`untold refund sweep read: ${ledgerErr.message}`);
      } else if ((ledger ?? []).length > 0) {
        const rows = (ledger ?? []) as Array<{ stripe_refund_id: string | null; stripe_payment_intent_id: string | null; job_id: string | null; customer_id: string | null; amount_cents: number | null; source?: string | null; created_at?: string | null }>;
        const keys = rows.filter((r) => r.stripe_refund_id).map((r) => `refund:${r.stripe_refund_id}`);
        // Q1726: a released hold's notice (`release:<pi>`) already told them about
        // money Stripe may also list as a Refund of the same amount, which
        // charge.refunded books as a `stripe_dashboard` ledger row. The webhook
        // skips that refund only if the release claim existed when it ran; this
        // sweep runs 15+ minutes later, so it reads the release notices too, and
        // skips only such a row: same amount, stripe_dashboard, within an hour of
        // the release either way (a path's own refund is never hidden by it).
        const releaseKeys = [...new Set(rows.filter((r) => r.stripe_payment_intent_id).map((r) => `release:${r.stripe_payment_intent_id}`))];
        const { data: told, error: toldErr } = await supabaseAdmin
          .from("refund_notices").select("notice_key, amount_cents, created_at").in("notice_key", [...keys, ...releaseKeys]).not("notification_id", "is", null);
        const toldMissing = !!toldErr && (toldErr.code === "42P01" || toldErr.code === "PGRST205");
        if (toldErr && !toldMissing) {
          defects.record(`untold refund sweep claim read: ${toldErr.message}`);
        } else if (!toldMissing) {
          const toldRows = (told ?? []) as Array<{ notice_key: string; amount_cents: number | null; created_at?: string | null }>;
          const done = new Set(toldRows.map((t) => t.notice_key));
          const released = new Map(
            toldRows.filter((t) => t.notice_key.startsWith("release:"))
              .map((t) => [t.notice_key.slice("release:".length), { cents: Number(t.amount_cents), at: Date.parse(String(t.created_at ?? "")) }]),
          );
          const sameMoneyAsRelease = (r: (typeof rows)[number]): boolean => {
            const rel = r.stripe_payment_intent_id ? released.get(r.stripe_payment_intent_id) : undefined;
            if (!rel || r.source !== "stripe_dashboard" || rel.cents !== Number(r.amount_cents)) return false;
            const gap = Math.abs(Date.parse(String(r.created_at ?? "")) - rel.at);
            return Number.isFinite(gap) && gap <= 60 * 60_000;
          };
          for (const r of rows) {
            const key = `refund:${r.stripe_refund_id}`;
            if (!r.stripe_refund_id || done.has(key) || !(Number(r.amount_cents) > 0)) continue;
            if (sameMoneyAsRelease(r)) continue;
            const result = await sendRefundNotice(supabaseAdmin, {
              key,
              kind: "refund",
              paymentIntentId: r.stripe_payment_intent_id,
              amountCents: Number(r.amount_cents),
              // What was kept is the path's to say; the safety net says only
              // what came back, to which payment method, and when.
              keptCents: 0,
              recipientId: r.customer_id,
              jobId: r.job_id,
            });
            if (result.status === "sent") untoldRefundsSent++;
            const problem = refundNoticeProblem(result);
            if (problem) {
              defects.record(`untold refund ${r.stripe_refund_id}: ${problem}`);
              await postSlackOpsAlert({
                kind: "custom",
                severity: "warning",
                title: "Money went back to a poster who was not fully told",
                message: `Refund ${r.stripe_refund_id} (${refundDollars(Number(r.amount_cents))}) for job ${r.job_id ?? "—"}: ${problem}. Tell them by hand.`,
                fields: { refund_id: r.stripe_refund_id, job_id: r.job_id ?? "—", status: result.status },
                oncePerDayKey: `refund-notice:${key}`,
              });
            }
          }
        }
      }
    }

    // ── Part H: refund notices whose email failed ─────────────────────────
    // The in-app notice was written but its email was not (a send-notification-
    // email outage, a 401): Part G sees a finished notice and moves on, so
    // without this the email never goes. Bounded (3 sends in all, notices
    // under 7 days old); the last failure pages for a person.
    let refundEmailsRetried = 0;
    let refundEmailsSent = 0;
    {
      const r = await retryFailedRefundEmails(supabaseAdmin);
      refundEmailsRetried = r.retried;
      refundEmailsSent = r.emailed;
      // Recorded, not only logged: a skip that never ends (the column never
      // deployed) would let failed emails age out unretried and unpaged.
      if (r.skipped) defects.record(`refund email retry skipped: ${r.skipped}`);
      for (const p of r.problems) defects.record(`refund email retry: ${p}`);
      for (const key of r.gaveUp) {
        await postSlackOpsAlert({
          kind: "custom",
          severity: "warning",
          title: "A refund notice email failed every try",
          message: `The in-app refund notice ${key} was written, but its email failed ${REFUND_EMAIL_MAX_ATTEMPTS} times (refund_notices.email_error has the last reason). Email the person by hand.`,
          fields: { notice: key },
          oncePerDayKey: `refund-email-gave-up:${key}`,
        });
      }
    }

    return cronResult(
      "void-cancelled-payments",
      {
        success: true,
        voided,
        refunded,
        abandoned: abandonedCount,
        test_orphans_refunded: testOrphansRefunded,
        gifts_unfrozen: giftsUnfrozen,
        crew_shares_retried: crewSharesRetried,
        block_fees_retried: blockFeesRetried,
        untold_refunds_sent: untoldRefundsSent,
        refund_emails_retried: refundEmailsRetried,
        refund_emails_sent: refundEmailsSent,
        fee_transfers_retried: feeTransfersRetried,
        total: jobs?.length || 0,
        results,
      },
      defects.defects,
      corsHeaders,
    );
  } catch (error) {
    console.error("[void-cancelled-payments] fatal:", error);
    return cronError("void-cancelled-payments", "Internal server error", corsHeaders);
  }
});
