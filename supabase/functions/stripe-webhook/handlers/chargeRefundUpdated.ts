// seed-policy: pages for seed/E2E jobs too, on purpose: a refund that failed
// after the ledger booked it is money that did NOT move, whoever owns the job.
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { caughtMessage } from "../../_shared/caughtMessage.ts";
import { insertNotifications } from "../../_shared/insertNotifications.ts";

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
 *      'refunded' / 'cancelled' / 'cancelling' while the charge is no longer
 *      fully refunded, pages CRITICAL: the job claims money went back that is
 *      still held (Q1355 (1)), and tells the poster in-app (Q1355 (6)). The job
 *      state is NOT rewritten here: which state it should return to (and
 *      whether to refund again) is a person's call, and every reader treats
 *      'refunded' as closed, so nothing can pay out over it meanwhile;
 *   3. a refund the ledger HAD booked also pages critical "NOT repaid" and
 *      tells the poster; one never booked pages a plain warning.
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
  type JobRow = { id: string; status?: string | null; payment_status?: string | null; customer_id?: string | null; title?: string | null };
  let job: JobRow | null = null;
  if (piId) {
    // jobs.stripe_payment_intent_id is unique (20261007035201, Q1355 (4)), so
    // maybeSingle cannot error on a second match.
    const { data, error } = await supabase
      .from("jobs").select("id, status, payment_status, customer_id, title").eq("stripe_payment_intent_id", piId).maybeSingle();
    if (error) throw new Error(`Job lookup failed for ${refund.status} refund ${refund.id}: ${error.message}`);
    job = (data as JobRow | null) ?? null;
  }

  // Q809 (2): a recurring visit payment settled 'refunded' on this refund was
  // NOT repaid. Paged for a person, and the payer told; never put back to
  // 'paid' automatically (lh-money-escrow review: a 'paid' row inside the
  // due window is funding the main loop would book a visit on).
  let visitNotRepaid: { id: string; payer_id: string | null; visit_date: string | null } | null = null;
  if (piId) {
    const { data: vp, error: vpErr } = await supabase
      .from("recurring_visit_payments")
      .select("id, payer_id, visit_date")
      .eq("stripe_payment_intent_id", piId)
      .eq("status", "refunded")
      .limit(1);
    if (vpErr) throw new Error(`recurring_visit_payments read failed for ${refund.status} refund ${refund.id}: ${vpErr.message}`);
    visitNotRepaid = ((vp ?? []) as Array<{ id: string; payer_id: string | null; visit_date: string | null }>)[0] ?? null;
  }

  // Q1355 (1): cancel_escrow closes a job 'cancelled' and a refund in flight
  // holds it 'cancelling', not only 'refunded': in all three the poster was
  // told their money went back.
  const settledAsRefunded = ["refunded", "cancelled", "cancelling"].includes(String(job?.payment_status ?? ""));
  // Is the charge still fully refunded once this refund dropped out?
  let stillFull: boolean | null = null;
  if (settledAsRefunded && chargeId) {
    try {
      const charge = await stripe.charges.retrieve(chargeId);
      stillFull = Number(charge.amount_refunded ?? 0) >= Number(charge.amount ?? 0);
    } catch (e) {
      throw new Error(`Could not read charge ${chargeId} after refund ${refund.id} turned ${refund.status}: ${caughtMessage(e)}`);
    }
  }

  const removedNow = (removed ?? []).length > 0;
  const amount = `$${(Number(refund.amount ?? 0) / 100).toFixed(2)}`;
  const fields: Record<string, string> = {
    "Refund ID": refund.id,
    "Status": String(refund.status),
    "Failure reason": String(refund.failure_reason ?? "—"),
    "Amount": amount,
    "Payment Intent": piId ?? "—",
    "Job ID": job?.id ?? "—",
    "Job state": job ? `${job.status ?? "?"}/${job.payment_status ?? "?"}` : "—",
    // Q1355 (5): on a redelivery the first delivery already removed it.
    "Ledger row": removedNow ? "removed now" : "not present (never booked, or removed by an earlier delivery)",
    "Recurring visit payment": visitNotRepaid ? `${visitNotRepaid.id} (visit ${visitNotRepaid.visit_date ?? "?"}) reads 'refunded' but was NOT repaid: refund it by hand` : "—",
  };
  const why = refund.failure_reason ?? "no reason given";
  // Q1355 (1): NOT repaid whenever the books or the job said it was.
  const notRepaid = (settledAsRefunded && stillFull === false) || removedNow || !!visitNotRepaid;

  // Q1355 (6): the poster was told "refunded"; correct it in-app, once per
  // refund (this event is delivered once per status change).
  const payerToTell = job?.customer_id ?? visitNotRepaid?.payer_id ?? null;
  if (notRepaid && payerToTell) {
    await insertNotifications(supabase, {
      user_id: payerToTell,
      ...(job ? { job_id: job.id } : {}),
      title: "A refund didn't go through",
      message: `The ${amount} refund for "${job?.title ?? (visitNotRepaid?.visit_date ? `your visit on ${visitNotRepaid.visit_date}` : "your job")}" was not completed by the bank, so the money has not reached you yet. Our team has been alerted and will send it to you again; you don't need to do anything.`,
      type: "payment",
      link: "/profile?tab=earnings&view=spent",
    });
  }

  if (settledAsRefunded && stillFull === false) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "Refund FAILED after the job was marked refunded",
      message: `Refund ${refund.id} (${amount}) turned '${refund.status}' (${why}): the money is back on the platform balance, but job ${job!.id} still reads payment_status '${job!.payment_status}'. The card holder has NOT been repaid. Refund again (another method if the card is gone) or set the job's payment state by hand; nothing pays out over it meanwhile.`,
      fields,
      oncePerDayKey: `refund-failed:${refund.id}`,
    });
    return;
  }
  if (notRepaid) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "A booked refund FAILED: the card holder was NOT repaid",
      message: `Refund ${refund.id} (${amount}) turned '${refund.status}' (${why}). The books had recorded it as money returned${removedNow ? " (its payment_refunds row is now removed)" : ""}${visitNotRepaid ? ` (recurring visit payment ${visitNotRepaid.id} still reads 'refunded')` : ""}; the money is back on the platform balance. The card holder has NOT been repaid: refund them by hand from the Stripe Dashboard. Nothing re-sends it automatically.`,
      fields,
      oncePerDayKey: `refund-failed:${refund.id}`,
    });
    return;
  }
  // Never booked and no job closed on it: nobody was told it went back.
  await postSlackOpsAlert({
    kind: "custom",
    severity: "warning",
    title: "A refund failed (it had not been booked)",
    message: `Refund ${refund.id} (${amount}) turned '${refund.status}' (${why}). No ledger row recorded it and no job was closed on it; the money is back on the platform balance. Refund again if it is still owed.`,
    fields,
    oncePerDayKey: `refund-failed:${refund.id}`,
  });
}
