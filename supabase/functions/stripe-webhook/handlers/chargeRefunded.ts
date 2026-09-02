import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";

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
      .select("id, customer_id, title")
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
      const { error: updateErr } = await supabase
        .from("jobs")
        .update({ payment_status: "refunded" })
        .eq("id", refundedJob.id);
      if (updateErr) {
        // Same fail-closed contract as the lookup: a dropped update here would
        // leave the job in its pre-refund state (e.g. "escrow") while Stripe
        // has already returned the funds — a money↔state divergence that can
        // only be detected by manual reconciliation. Throw so Stripe retries.
        throw new Error(`Failed to mark job ${refundedJob.id} as refunded: ${updateErr.message}`);
      }

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
            kind: "custom",
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
          kind: "custom",
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
