import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { findLivePayout } from "../../_shared/livePayoutGuard.ts";

/**
 * payment_status values it is SAFE to overwrite with 'refunded'. A full refund
 * on one of these has not paid the Helpr, so flipping to 'refunded' is the
 * truth. 'released'/'chargeback' are deliberately EXCLUDED (see the guard
 * below): 'released' means the Helpr was paid, and 'chargeback' is a hold
 * `charge.dispute.created` placed to STOP payouts — walking either back to
 * 'refunded' is a money↔state divergence (MS-3 / HM-2).
 */
const REFUND_SAFE_PAYMENT_STATUSES = ["escrow", "payout_pending", "cancelling", "refunded"] as const;

export async function handleChargeRefunded(
  event: Stripe.Event,
  { supabase, logStep }: WebhookContext,
): Promise<void> {
  const charge = event.data.object as Stripe.Charge;
  const refundPiId = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : (charge.payment_intent as any)?.id;
  logStep("Charge refunded", {
    chargeId: charge.id,
    pi: refundPiId,
    amount: charge.amount,
    amountRefunded: charge.amount_refunded,
  });

  // Only a FULL refund flips the job to "refunded". A partial refund (e.g. a
  // one-off duplicate-onboarding-fee correction, or a partial-dispute payout)
  // leaves the bulk of escrow in place, so marking the whole job refunded would
  // strand held funds in a wrong terminal state. Reconcile on the actual amounts.
  const isFullRefund = charge.amount_refunded >= charge.amount;
  // The onboarding-fee correction refund is created with
  // metadata.reason = "duplicate_onboarding_fee" on the Refund object itself,
  // NOT on the parent Charge. Read from the latest refund (data[0] = newest
  // first in Stripe's reverse-chronological list) to correctly detect it.
  const latestRefund = charge.refunds?.data?.[0];
  const isOnboardingFeeCorrection =
    (latestRefund?.metadata as Record<string, string> | null)?.reason === "duplicate_onboarding_fee";

  if (refundPiId && isFullRefund && !isOnboardingFeeCorrection) {
    const { data: refundedJob, error: jobLookupErr } = await supabase
      .from("jobs")
      .select("id, customer_id, title, payment_status")
      .eq("stripe_payment_intent_id", refundPiId)
      .maybeSingle();

    if (jobLookupErr) {
      // Throw so the outer handler rolls back the idempotency row and returns
      // 500 — letting Stripe retry once the DB recovers. A silent early return
      // here would mark the event as processed (200 OK) even though the job's
      // payment_status was never updated, permanently stranding it.
      throw new Error(`Job lookup failed for refund PI ${refundPiId}: ${jobLookupErr.message}`);
    }

    if (refundedJob) {
      // MS-3 / HM-2: a full refund on the escrow charge of a job that has
      // ALREADY paid its Helpr leaves the Helpr paid and refunds the poster —
      // the platform eats the budget. The old handler flipped ANY state to
      // 'refunded' with no precondition, which also (a) erased the 'released'
      // marker that is the only record the Helpr was paid, hiding the
      // double-outflow from money-reconciliation, and (b) walked a 'chargeback'
      // hold back to 'refunded'. This is the one sibling handler the R8/R9
      // precondition pass (transferCreated / paymentIntentPaymentFailed) missed.
      //
      // We cannot "refuse" a refund Stripe has already made — the money is gone
      // — so when the Helpr was paid we DO NOT overwrite the state (leaving the
      // truth, 'released', in place for the reconciler and ops) and page
      // critical that a manual transfer reversal is needed.
      const livePayout = await findLivePayout(supabase, refundedJob.id);
      if (livePayout.readError) {
        // Fail closed, same contract as the lookup: an unreadable payout ledger
        // cannot prove the Helpr was not paid, so retry rather than flip blind.
        throw new Error(`Payout-ledger read failed for refunded job ${refundedJob.id}: ${livePayout.readError}`);
      }
      const priorStatus = (refundedJob as { payment_status?: string | null }).payment_status ?? null;
      const helperAlreadyPaid = livePayout.hasLivePayout || priorStatus === "released";

      if (helperAlreadyPaid) {
        await postSlackOpsAlert({
          kind: "money_at_risk",
          severity: "critical",
          title: "Refund landed on a job whose Helpr was already paid — manual transfer reversal needed",
          message:
            `charge.refunded (full) for job ${refundedJob.id} (PI ${refundPiId}): the poster has been refunded, but the Helpr was already paid ` +
            `(payment_status='${priorStatus}'${livePayout.hasLivePayout ? `; ${livePayout.reason}` : ""}). ` +
            `The job state was LEFT AS-IS (not flipped to 'refunded') so the payout stays visible. ` +
            `Reverse the Helpr's transfer in Stripe to make the platform whole.`,
          fields: {
            "Job ID": refundedJob.id,
            "Payment Intent": refundPiId,
            "Payment Status (left as-is)": String(priorStatus),
            "Live Transfer IDs": livePayout.transferIds.join(", ") || "(none — released state)",
            "Refund Amount (cents)": String(charge.amount_refunded),
          },
        });
        logStep("Refund NOT applied — Helpr already paid; ops paged for manual reversal", {
          jobId: refundedJob.id,
          priorStatus,
          liveTransferIds: livePayout.transferIds,
        });
      } else {
      // House standard: a compare-and-set flip with `.select("id")`, refusing
      // to write over any state that is not refund-safe. A zero-row match here
      // means the job moved out of the refund-safe set between the read and the
      // write (e.g. into 'released' via a racing transfer.created) — page,
      // never silently succeed.
      const { data: flipped, error: updateErr } = await supabase
        .from("jobs")
        .update({ payment_status: "refunded" })
        .eq("id", refundedJob.id)
        .in("payment_status", REFUND_SAFE_PAYMENT_STATUSES as unknown as string[])
        .select("id");
      if (updateErr) {
        // Same fail-closed contract as the lookup: a dropped update here would
        // leave the job in its pre-refund state (e.g. "escrow") while Stripe
        // has already returned the funds — a money↔state divergence that can
        // only be detected by manual reconciliation. Throw so Stripe retries.
        throw new Error(`Failed to mark job ${refundedJob.id} as refunded: ${updateErr.message}`);
      }
      if (!flipped || (Array.isArray(flipped) && flipped.length === 0)) {
        await postSlackOpsAlert({
          kind: "money_at_risk",
          severity: "critical",
          title: "Refund flip matched zero rows — job left a refund-safe state under the webhook",
          message:
            `charge.refunded (full) for job ${refundedJob.id} (PI ${refundPiId}) matched zero rows on the payment_status precondition. ` +
            `The job moved to a non-refund-safe state (e.g. 'released' or 'chargeback') between the read and the write. ` +
            `Left unchanged — check the payout state by hand before assuming this refund is settled.`,
          fields: {
            "Job ID": refundedJob.id,
            "Payment Intent": refundPiId,
            "Payment Status (read)": String(priorStatus),
            "Refund Amount (cents)": String(charge.amount_refunded),
          },
        });
        logStep("Refund flip matched zero rows — precondition failed, ops paged", {
          jobId: refundedJob.id,
          priorStatus,
        });
      }
      } // end helper-not-paid flip

      // Write payment_refunds ledger row. Refunds issued from the Stripe Dashboard
      // (not via void-cancelled-payments / admin functions that write their own row)
      // would otherwise leave no queryable record in our DB. Upsert on stripe_refund_id
      // is idempotent — if another code path already wrote the row, ignoreDuplicates
      // skips the insert without error.
      if (latestRefund?.id) {
        const { error: ledgerErr } = await supabase
          .from("payment_refunds")
          .upsert(
            {
              job_id: refundedJob.id,
              customer_id: refundedJob.customer_id,
              stripe_refund_id: latestRefund.id,
              stripe_payment_intent_id: refundPiId,
              amount_cents: charge.amount_refunded,
              currency: charge.currency,
              is_partial: false,
              reason: latestRefund.reason ?? null,
              source: "stripe_dashboard",
            },
            { onConflict: "stripe_refund_id", ignoreDuplicates: true },
          );
        if (ledgerErr) {
          await postSlackOpsAlert({
            kind: "money_at_risk",
            severity: "warning",
            title: "payment_refunds ledger write failed (charge.refunded)",
            message: `Could not write refund ledger row for job ${refundedJob.id}.`,
            fields: {
              "Job ID": refundedJob.id,
              "Stripe Refund ID": latestRefund.id,
              "Error": ledgerErr.message,
            },
          });
          throw new Error(`charge.refunded payment_refunds upsert failed: ${ledgerErr.message}`);
        }
      } else {
        logStep("WARN: no refund object on charge — payment_refunds row skipped", {
          chargeId: charge.id,
          pi: refundPiId,
        });
      }

      const { error: notifyErr } = await supabase.from("notifications").insert({
        user_id: refundedJob.customer_id,
        title: "Refund processed",
        message: `Your payment for "${refundedJob.title}" has been refunded.`,
        type: "payment",
        // The refunded job, not the My Posts default bucket — a refunded job
        // is `cancelled`/`done`, never "Needs you".
        link: `/my-posts?job=${refundedJob.id}`,
      });
      if (notifyErr) logStep("WARN: refund notification insert failed", { error: notifyErr.message });

      logStep("Job marked as refunded", { jobId: refundedJob.id });
    }
  } else if (refundPiId) {
    // Partial refund or an onboarding-fee correction — intentionally NOT flipping
    // the job to refunded. Logged (not silent) so partial-refund reconciliation
    // is auditable rather than a mystery no-op.
    logStep("Refund not full — job status left unchanged", {
      pi: refundPiId,
      isFullRefund,
      isOnboardingFeeCorrection,
    });

    // Write a payment_refunds ledger row for partial Dashboard refunds.
    // Onboarding-fee corrections are excluded: checkoutSessionCompleted already
    // writes their ledger row at refund time, so writing one here would be a
    // duplicate (even though upsert ignores it, the intent is different enough
    // to keep the two paths separate and explicit).
    // Without this block, any admin-issued partial refund is invisible in
    // payment_refunds, creating a Stripe↔DB gap that breaks finance reconciliation
    // and leaves the audit trail unprovable.
    if (!isOnboardingFeeCorrection && latestRefund?.id) {
      // Non-fatal job lookup — partial refunds can exist without a matching job
      // (e.g. direct PI refunds from the Dashboard). job_id and customer_id are
      // nullable on payment_refunds for exactly this case.
      let partialJobId: string | null = null;
      let partialCustomerId: string | null = null;
      const { data: partialJob } = await supabase
        .from("jobs")
        .select("id, customer_id")
        .eq("stripe_payment_intent_id", refundPiId)
        .maybeSingle();
      if (partialJob) {
        partialJobId = partialJob.id;
        partialCustomerId = partialJob.customer_id;
      }

      const { error: partialLedgerErr } = await supabase
        .from("payment_refunds")
        .upsert(
          {
            job_id: partialJobId,
            customer_id: partialCustomerId,
            stripe_refund_id: latestRefund.id,
            stripe_payment_intent_id: refundPiId,
            amount_cents: latestRefund.amount,
            currency: charge.currency,
            is_partial: true,
            reason: latestRefund.reason ?? null,
            source: "stripe_dashboard",
          },
          { onConflict: "stripe_refund_id", ignoreDuplicates: true },
        );
      if (partialLedgerErr) {
        await postSlackOpsAlert({
          kind: "money_at_risk",
          severity: "warning",
          title: "Partial refund ledger write failed (charge.refunded)",
          message: `Could not write payment_refunds row for partial refund ${latestRefund.id}.`,
          fields: {
            "Stripe Refund ID": latestRefund.id,
            "Payment Intent": refundPiId,
            ...(partialJobId ? { "Job ID": partialJobId } : {}),
            "Error": partialLedgerErr.message,
          },
        });
        throw new Error(`charge.refunded partial payment_refunds upsert failed: ${partialLedgerErr.message}`);
      }
      logStep("Partial refund ledger row written", { refundId: latestRefund.id, pi: refundPiId });
    }
  }
}
