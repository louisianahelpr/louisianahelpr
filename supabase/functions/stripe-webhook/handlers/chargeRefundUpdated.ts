// seed-policy: pages for seed/E2E jobs too, on purpose: a refund that failed
// after the ledger booked it is money that did NOT move, whoever owns the job.
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { caughtMessage } from "../../_shared/caughtMessage.ts";

/**
 * charge.refund.updated (Q1325 (a); owner approved the subscription
 * 2026-10-05). A refund that is 'pending' when charge.refunded arrives is
 * booked in payment_refunds by chargeRefunded.ts (and by the paths that
 * create refunds); if Stripe later moves it to 'failed' or 'canceled', the
 * money never left: it is back on the platform balance, and the ledger (and,
 * for a full refund, the job's 'refunded' state) says otherwise.
 *
 * On a failed / canceled refund this handler:
 *   1. deletes that refund's payment_refunds row (the refund did not happen;
 *      the Spent page, the reconciler and the payout guards read that table).
 *      Zero rows is fine: never booked, or an earlier delivery removed it;
 *   2. reads the job by the refund's PaymentIntent and, when it still reads
 *      'refunded' while the charge is no longer fully refunded, pages
 *      CRITICAL: the job claims money went back that is still held. The job
 *      state is NOT rewritten here: which state it should return to (and
 *      whether to refund again) is a person's call, and every reader treats
 *      'refunded' as closed, so nothing can pay out over it meanwhile;
 *   3. otherwise pages a warning naming the refund and its failure reason.
 * Every other status change (pending -> succeeded, requires_action) is a no-op.
 * Idempotent: the delete and the read are; the page is once a day per refund.
 */
export async function handleChargeRefundUpdated(
  event: Stripe.Event,
  { stripe, supabase, logStep }: WebhookContext,
): Promise<void> {
  const refund = event.data.object as Stripe.Refund;
  logStep("Charge refund updated", { refundId: refund.id, status: refund.status });
  if (refund.status !== "failed" && refund.status !== "canceled") return;

  const { data: removed, error: delErr } = await supabase
    .from("payment_refunds")
    .delete()
    .eq("stripe_refund_id", refund.id)
    .select("id, job_id");
  if (delErr) {
    // Nothing changed yet: fail so Stripe redelivers.
    throw new Error(`payment_refunds delete failed for ${refund.status} refund ${refund.id}: ${delErr.message}`);
  }

  const piId = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id ?? null;
  const chargeId = typeof refund.charge === "string" ? refund.charge : refund.charge?.id ?? null;
  let job: { id: string; status?: string | null; payment_status?: string | null } | null = null;
  if (piId) {
    const { data, error } = await supabase
      .from("jobs").select("id, status, payment_status").eq("stripe_payment_intent_id", piId).maybeSingle();
    if (error) throw new Error(`Job lookup failed for ${refund.status} refund ${refund.id}: ${error.message}`);
    job = (data as { id: string; status?: string | null; payment_status?: string | null } | null) ?? null;
  }

  // Is the charge still fully refunded once this refund dropped out?
  let stillFull: boolean | null = null;
  if (job?.payment_status === "refunded" && chargeId) {
    try {
      const charge = await stripe.charges.retrieve(chargeId);
      stillFull = Number(charge.amount_refunded ?? 0) >= Number(charge.amount ?? 0);
    } catch (e) {
      throw new Error(`Could not read charge ${chargeId} after refund ${refund.id} turned ${refund.status}: ${caughtMessage(e)}`);
    }
  }

  const amount = `$${(Number(refund.amount ?? 0) / 100).toFixed(2)}`;
  const fields: Record<string, string> = {
    "Refund ID": refund.id,
    "Status": String(refund.status),
    "Failure reason": String(refund.failure_reason ?? "—"),
    "Amount": amount,
    "Payment Intent": piId ?? "—",
    "Job ID": job?.id ?? "—",
    "Job state": job ? `${job.status ?? "?"}/${job.payment_status ?? "?"}` : "—",
    "Ledger row removed": String((removed ?? []).length > 0),
  };
  if (job?.payment_status === "refunded" && stillFull === false) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "Refund FAILED after the job was marked refunded",
      message: `Refund ${refund.id} (${amount}) turned '${refund.status}' (${refund.failure_reason ?? "no reason given"}): the money is back on the platform balance, but job ${job.id} still reads payment_status 'refunded'. The card holder has NOT been repaid. Refund again (another method if the card is gone) or set the job's payment state by hand; nothing pays out over 'refunded' meanwhile.`,
      fields,
      oncePerDayKey: `refund-failed:${refund.id}`,
    });
    return;
  }
  await postSlackOpsAlert({
    kind: "money_at_risk",
    severity: "warning",
    title: "A refund failed after it was booked",
    message: `Refund ${refund.id} (${amount}) turned '${refund.status}' (${refund.failure_reason ?? "no reason given"}). Its payment_refunds row was ${(removed ?? []).length > 0 ? "removed" : "not found"}; the money is back on the platform balance. Refund again if it is still owed.`,
    fields,
    oncePerDayKey: `refund-failed:${refund.id}`,
  });
}
