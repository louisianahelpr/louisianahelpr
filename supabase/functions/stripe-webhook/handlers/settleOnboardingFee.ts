import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";

/**
 * Collect the one-time account setup fee EXACTLY once — the shared enforcement
 * of the "you'll never be charged twice" promise in the Terms.
 *
 * Extracted 2026-08-27 when `pay-onboarding-fee` became a third way to settle
 * the fee (alongside the first job post and the first payout). The guarantee is
 * a race, not a check: several checkouts can each legitimately carry the $2 if
 * they were all created before the first one's webhook fired. So the flag flip
 * is a CONDITIONAL update that exactly one writer can win, and the losers get
 * their $2 back automatically. Duplicating that in a second call site would have
 * been duplicating the guarantee, which is how guarantees drift apart.
 *
 * Call this for any captured session whose metadata carries
 * `onboarding_fee_charged: "true"` — the standalone fee checkout stamps the same
 * keys as the first-job-post line item precisely so one implementation serves
 * both.
 *
 * `paymentIntentId` is what the refund is issued against. On the job-post path
 * that PI also holds the escrow, which is why the refund is partial and its
 * ledger row carries `job_id: null` — a per-job reconciliation must not
 * attribute a profile fee to that job.
 */
export async function settleOnboardingFee(
  session: Stripe.Checkout.Session,
  paymentIntentId: string,
  { stripe, supabase, logStep }: WebhookContext,
): Promise<void> {
  const piId = paymentIntentId;
  const posterId = (session.metadata as { customer_id?: string } | null)?.customer_id;
  if (!posterId) {
    logStep("WARNING: onboarding fee session with no customer_id", { sessionId: session.id });
  }
  if (posterId) {
    const { data: flipped, error: feeErr } = await supabase
      .from("profiles")
      .update({ onboarding_fee_paid: true, onboarding_fee_charged_at: new Date().toISOString() })
      .eq("user_id", posterId)
      .eq("onboarding_fee_paid", false)
      .select("user_id");

    if (feeErr) {
      logStep("ERROR atomic flip onboarding fee", { error: feeErr.message });
    } else if (flipped && flipped.length > 0) {
      logStep("Onboarding fee marked paid for poster", { posterId });
    } else {
      // Flag was already true — duplicate fee charged. Auto-refund $2.
      // Stripe idempotency key keyed on session.id so webhook
      // re-deliveries don't create multiple refunds for the same
      // duplicate charge.
      try {
        const ONBOARDING_FEE_CENTS = parseInt((session.metadata as any)?.onboarding_fee_cents || "200", 10);
        const refund = await stripe.refunds.create(
          {
            payment_intent: piId,
            amount: ONBOARDING_FEE_CENTS,
            reason: "requested_by_customer",
            metadata: {
              reason: "duplicate_onboarding_fee",
              session_id: session.id,
              user_id: posterId,
            },
          },
          { idempotencyKey: `dup-onboarding-fee-${session.id}` },
        );
        // Ledger the refund (best-effort). is_partial: this only refunds
        // the $2 fee off a PI that also holds the job escrow, so it is not
        // a full-PI refund. job_id is null — this is a profile/onboarding
        // fee, not a job's escrow, so a per-job reconciliation query must
        // NOT attribute it to the job on this session.
        const { error: refundLedgerErr } = await supabase.from("payment_refunds").upsert({
          job_id: null,
          customer_id: posterId,
          stripe_refund_id: refund.id,
          stripe_payment_intent_id: piId,
          amount_cents: Math.round(Number(refund.amount ?? ONBOARDING_FEE_CENTS)),
          currency: refund.currency ?? "usd",
          is_partial: true,
          reason: "duplicate onboarding fee",
          source: "duplicate_onboarding_fee",
          initiated_by_user_id: null,
        }, { onConflict: "stripe_refund_id", ignoreDuplicates: true });
        if (refundLedgerErr) {
          logStep("ERROR ledgering duplicate onboarding fee refund", {
            error: refundLedgerErr.message,
            refundId: refund.id,
            sessionId: session.id,
          });
          // The refund already left Stripe, so we never throw — but a dropped
          // ledger row is a real Stripe↔ledger divergence a human must
          // reconcile, so surface it to ops rather than leaving it in a log.
          await postSlackOpsAlert({
            kind: "custom",
            severity: "warning",
            title: "Refund ledger write failed",
            message: "A Stripe refund succeeded but its payment_refunds row was not written. Reconcile manually.",
            fields: {
              refund_id: refund.id,
              session_id: session.id,
              source: "duplicate_onboarding_fee",
              db_error: refundLedgerErr.message,
            },
          });
        }
        await supabase.from("notifications").insert({
          user_id: posterId,
          type: "payment",
          title: "Duplicate fee refunded",
          message:
            "We caught a duplicate $2 onboarding fee on your account and refunded it. The fee is one-time only — you won't see it again.",
          link: "/profile",
          read: false,
        });
        logStep("Refunded duplicate onboarding fee", {
          posterId,
          sessionId: session.id,
          refundId: refund.id,
        });
      } catch (refundErr) {
        logStep("ERROR refunding duplicate onboarding fee", {
          error: (refundErr as Error).message,
          posterId,
          sessionId: session.id,
        });
      }
    }
  }
}
