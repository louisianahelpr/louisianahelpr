import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { loadAdminIds } from "../../_shared/adminIds.ts";

export async function handleChargeDisputeCreated(
  event: Stripe.Event,
  { stripe, supabase, logStep }: WebhookContext,
): Promise<void> {
  // A customer filed a Stripe chargeback. Stripe immediately withdraws the
  // disputed amount from the platform's bank balance. We must:
  //   1. Block any automated payout for the affected job (payout_pending
  //      or escrow) — paying the helper from money we no longer have
  //      compounds the loss.
  //   2. Alert ops so someone responds in Stripe Dashboard before the
  //      evidence due date (typically 7 days or Stripe auto-loses the case).
  const dispute = event.data.object as Stripe.Dispute;
  logStep("Chargeback filed", {
    id: dispute.id,
    amount: dispute.amount,
    reason: dispute.reason,
    status: dispute.status,
  });

  let disputePiId: string | null =
    typeof dispute.payment_intent === "string"
      ? dispute.payment_intent
      : (dispute.payment_intent as any)?.id ?? null;

  if (!disputePiId) {
    // Fallback: retrieve the charge to find the PaymentIntent
    try {
      const disputeCharge = await stripe.charges.retrieve(dispute.charge as string);
      disputePiId =
        typeof disputeCharge.payment_intent === "string"
          ? disputeCharge.payment_intent
          : (disputeCharge.payment_intent as any)?.id ?? null;
    } catch (e) {
      logStep("Could not retrieve charge for dispute", { error: String(e) });
    }
  }

  if (disputePiId) {
    const { data: chargebackJob, error: chargebackJobErr } = await supabase
      .from("jobs")
      .select("id, customer_id, helper_id, title, payment_status, status")
      .eq("stripe_payment_intent_id", disputePiId)
      .maybeSingle();

    if (chargebackJobErr) {
      // A DB failure here means we cannot determine whether to block this
      // job's payout. Without the block, the payout cron can pay the helper
      // from funds Stripe already withdrew — a double-loss. Throw so the
      // idempotency row is rolled back and Stripe retries once the DB recovers.
      await postSlackOpsAlert({
        kind: "dispute_filed",
        severity: "critical",
        title: "💳 Stripe chargeback — PAYOUT BLOCK SKIPPED (job lookup DB error)",
        message: `A chargeback fired but the job lookup failed with a DB error — payout block NOT applied. Stripe will retry this webhook. If retries exhaust, manually set payment_status='chargeback', dispute_status='stripe_chargeback', disputed_at=NOW() on the job to prevent double-loss.`,
        fields: {
          "Dispute ID": dispute.id,
          "Payment Intent": disputePiId ?? "—",
          "DB error": chargebackJobErr.message.slice(0, 200),
        },
        link: `https://dashboard.stripe.com/disputes/${dispute.id}`,
      });
      throw new Error(`Job lookup failed for chargeback PI ${disputePiId}: ${chargebackJobErr.message}`);
    }

    if (chargebackJob) {
      // Only flip payment_status if the payout hasn't been finalized yet —
      // 'released' jobs already paid the helper so we leave the status alone
      // and let ops handle the net loss manually.
      const shouldBlockPayout = ["payout_pending", "escrow"].includes(
        chargebackJob.payment_status,
      );

      const { error: blockUpdateErr } = await supabase
        .from("jobs")
        .update({
          ...(shouldBlockPayout ? { payment_status: "chargeback" } : {}),
          dispute_status: "stripe_chargeback",
          disputed_at: new Date().toISOString(),
        })
        .eq("id", chargebackJob.id);

      if (blockUpdateErr) {
        // The DB write failed — dispute markers (disputed_at, dispute_status,
        // payment_status) were NOT applied. Without disputed_at set, the job
        // remains invisible to every payout guard:
        //   - process-scheduled-payouts filters on `.is("disputed_at", null)`
        //   - release-payout checks `job.disputed_at !== null`
        // So the payout cron WILL pay the helper from platform funds that
        // Stripe already withdrew for the chargeback — a double-loss.
        // Alert ops with full chargeback details now (before the outer catch
        // fires its generic "webhook error" alert), then throw so the
        // idempotency row is rolled back and Stripe retries this delivery
        // once the DB recovers.
        await postSlackOpsAlert({
          kind: "dispute_filed",
          severity: "critical",
          title: "💳 Stripe chargeback — PAYOUT BLOCK FAILED (DB error), double-loss risk",
          message: `A chargeback fired but the DB write to block payouts failed. The job stays payout_pending with disputed_at=null — invisible to all payout guards. Stripe will retry this webhook. If retries exhaust, manually set payment_status='chargeback', dispute_status='stripe_chargeback', disputed_at=NOW() on the job to prevent double-loss.`,
          fields: {
            "Dispute ID": dispute.id,
            "Payment Intent": disputePiId ?? "—",
            "Job ID": String(chargebackJob.id),
            "Prev payment_status": chargebackJob.payment_status,
            "Should block payout": String(shouldBlockPayout),
            "Amount": `$${(dispute.amount / 100).toFixed(2)}`,
            "DB error": blockUpdateErr.message.slice(0, 200),
          },
          link: `https://dashboard.stripe.com/disputes/${dispute.id}`,
        });
        throw new Error(
          `Failed to apply chargeback payout block on job ${chargebackJob.id}: ${blockUpdateErr.message}`,
        );
      }

      logStep(
        shouldBlockPayout
          ? "Blocked payout on chargebacked job"
          : "Chargeback on already-released job — manual reconciliation needed",
        {
          jobId: chargebackJob.id,
          prevPaymentStatus: chargebackJob.payment_status,
          shouldBlockPayout,
          disputeId: dispute.id,
        },
      );

      // Notify all admins — chargebacks require a Stripe Dashboard response
      // or the platform auto-loses and pays both the customer AND a $15 fee.
      const { ids: chargebackAdminIds } = await loadAdminIds(
        supabase,
        "stripe-webhook.chargeDisputeCreated",
      );
      for (const adminId of chargebackAdminIds) {
        await supabase.from("notifications").insert({
          user_id: adminId,
          title: "⚠️ Stripe chargeback filed",
          message: `A $${(dispute.amount / 100).toFixed(2)} chargeback was filed for "${chargebackJob.title}". Respond in Stripe Dashboard before the evidence deadline or the dispute is auto-lost.`,
          type: "warning",
          link: "/admin",
        });
      }
    }
  }

  // Always alert ops even when no job is matched — funds already left
  // the platform and someone must respond in Stripe Dashboard.
  await postSlackOpsAlert({
    kind: "dispute_filed",
    severity: "critical",
    title: "💳 Stripe chargeback filed",
    message: `A $${(dispute.amount / 100).toFixed(2)} chargeback was opened (reason: ${dispute.reason ?? "unknown"}). Respond in Stripe Dashboard before the evidence due date.`,
    fields: {
      "Dispute ID": dispute.id,
      "Payment Intent": disputePiId ?? "—",
      "Reason": dispute.reason ?? "—",
      "Amount": `$${(dispute.amount / 100).toFixed(2)}`,
      "Evidence Due": dispute.evidence_details?.due_by
        ? new Date(dispute.evidence_details.due_by * 1000)
            .toISOString()
            .split("T")[0]
        : "—",
    },
    link: `https://dashboard.stripe.com/disputes/${dispute.id}`,
  });
}
