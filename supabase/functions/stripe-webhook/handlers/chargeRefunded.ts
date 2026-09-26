// seed-policy: pages for seed/E2E jobs too, on purpose. Every alert here is money
// that moved (or failed to move) in Stripe while the DB says otherwise, or a Stripe
// event that could not be settled: a platform failure whoever owns the job. The
// nightly money journeys on seed jobs are how this path is proven, so their failures
// are real signal (2026-09-22: "transfer failed" on seed jobs = the empty test
// balance, Q3). Seed-only noise is routed in the detectors, not here (docs/OPEN.md Q2).
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { alertPartialGiftRefund, revokeGiftCardForRefund } from "./_giftCardRefund.ts";

/**
 * The payment states a FULL refund may move to 'refunded' (Q343): every state
 * in which the charge's money is still the platform's to return. NOT
 * 'released' (the Helpr was paid), 'chargeback' (the card network holds it) or
 * 'refunded' (already closed).
 */
const REFUND_CLOSABLE_PAYMENT_STATES = [
  "escrow", "payout_pending", "cancelling", "unpaid", "abandoned", "failed", "cancelled",
] as const;

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

  // A GIFT CARD donation's PaymentIntent never reaches `jobs`, so the lookup
  // below cannot see it and this handler used to no-op on a refunded gift,
  // leaving the credit `payment_status = 'paid'` and fully spendable. Revoke
  // the unspent value first; `revokeGiftCardForRefund` returns `no_gift` for an
  // ordinary job escrow PI, which is every other event that reaches here.
  if (!isOnboardingFeeCorrection) {
    if (isFullRefund) {
      await revokeGiftCardForRefund(supabase, refundPiId, "refund", logStep);
    } else {
      // Partial refunds are not auto-revoked (all-or-nothing walk), but they
      // must not be silent either — see alertPartialGiftRefund.
      await alertPartialGiftRefund(supabase, refundPiId, charge.amount_refunded, logStep);
    }
  }

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
      // Q343: a COMPARE-AND-SET on the states a full refund may close. It was
      // matched on id alone, so it overwrote whatever the job said:
      //   - 'released': the Helpr was already paid. Writing 'refunded' hides
      //     that the platform paid twice (Helpr + card holder) from every
      //     reader, and the clawback/won paths key on 'released';
      //   - 'chargeback': the card network holds this money, not a refund;
      //     overwriting it lifts the chargeback's own payout block.
      // Neither is ever overwritten now: ops is paged instead. 'refunded'
      // already is a redelivery or another path's own write (no-op). Zero
      // rows on a closable state means another writer moved it since the
      // read: paged, never silent. The ledger row and the card holder's notice
      // below still run, because the refund did happen in Stripe.
      const priorStatus = (refundedJob as { payment_status?: string | null }).payment_status ?? null;
      const closable = (REFUND_CLOSABLE_PAYMENT_STATES as readonly string[]).includes(priorStatus ?? "");
      let updateErr: { message: string } | null = null;
      if (closable) {
        const { data: flipped, error: flipErr } = await supabase
          .from("jobs")
          .update({ payment_status: "refunded" })
          .eq("id", refundedJob.id)
          .in("payment_status", [...REFUND_CLOSABLE_PAYMENT_STATES])
          .select("id");
        updateErr = flipErr;
        // Zero rows: re-read. The refund path's OWN flip to 'refunded'
        // (cancel_escrow, a 100/0 split) can land between the read and this
        // write; that is the same answer, not an alarm (money review L2).
        let nowStatus: string | null = null;
        if (!flipErr && (!flipped || flipped.length === 0)) {
          const { data: again, error: againErr } = await supabase
            .from("jobs").select("payment_status").eq("id", refundedJob.id).maybeSingle();
          if (againErr) throw new Error(`Re-read of job ${refundedJob.id} after a zero-row refund flip failed: ${againErr.message}`);
          nowStatus = (again as { payment_status?: string | null } | null)?.payment_status ?? null;
        }
        if (!flipErr && (!flipped || flipped.length === 0) && nowStatus !== "refunded") {
          await postSlackOpsAlert({
            kind: "money_at_risk",
            severity: "critical",
            title: "Full refund — job not marked refunded (payment state changed underneath)",
            message: `Charge ${charge.id} was fully refunded, but job ${refundedJob.id} left '${priorStatus}' before it could be marked refunded. Check its payment_status against Stripe by hand.`,
            fields: { "Job ID": String(refundedJob.id), "Read payment_status": priorStatus ?? "—", "Payment Intent": refundPiId },
          });
        }
      } else if (priorStatus !== "refunded") {
        await postSlackOpsAlert({
          kind: "money_at_risk",
          severity: "critical",
          title: `Full refund on a job in '${priorStatus ?? "null"}' — payment_status left as is`,
          message: `Charge ${charge.id} was fully refunded in Stripe, but job ${refundedJob.id} is payment_status='${priorStatus ?? "null"}', which a refund must not overwrite${priorStatus === "released" ? " (the Helpr was already paid: the platform has now paid twice)" : ""}. Reconcile it by hand.`,
          fields: { "Job ID": String(refundedJob.id), "payment_status": priorStatus ?? "—", "Payment Intent": refundPiId },
        });
      }
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
        link: `/posts?job=${refundedJob.id}`,
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
