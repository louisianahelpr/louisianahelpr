// seed-policy: pages for seed/E2E jobs too, on purpose: a refund that failed
// after the ledger booked it is money that did NOT move, whoever owns the job.
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { caughtMessage } from "../../_shared/caughtMessage.ts";
import { insertNotifications } from "../../_shared/insertNotifications.ts";
import { undoVisitTaxForFailedRefund } from "./_visitTaxReversal.ts";
import { handleDeclutterHandRefundFailed } from "./declutterCheckout.ts";

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

  // Declutter (slice 4): its refunds live in declutter_refunds, not the job
  // ledger. The row Stripe took is reopened (failed, due now) so declutter-money
  // sends a NEW refund under a new key; only the refund the row recorded does
  // that (declutter_refund_reversed). A Declutter charge is not a job: nothing
  // below applies.
  const meta = (refund.metadata ?? {}) as Record<string, string>;
  if (meta.kind === "declutter_refund") {
    if (!meta.refund_id) throw new Error(`Declutter refund ${refund.id} turned ${refund.status} without its refund_id`);
    const { data: reopened, error: dErr } = await supabase.rpc("declutter_refund_reversed", {
      p_refund_id: meta.refund_id,
      p_stripe_refund_id: refund.id,
      p_why: `${refund.status}: ${refund.failure_reason ?? "no reason given"}`,
    });
    if (dErr) throw new Error(`declutter_refund_reversed failed for ${refund.status} refund ${refund.id}: ${dErr.message}`);
    // 'gave_up': the reversal was the row's 12th try, so declutter-money will NOT send another
    // (lh-money-escrow re-review should-fix 1): a person refunds it by hand.
    const gaveUp = reopened === "gave_up";
    const notRepaid = reopened === "reopened" || gaveUp;
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: notRepaid ? "critical" : "warning",
      title: gaveUp ? "Declutter refund failed after Stripe took it: GAVE UP, refund it by hand"
        : reopened === "reopened" ? "Declutter refund failed after Stripe took it: retrying" : "Declutter refund failed (row not reopened)",
      message: `Stripe moved Declutter refund ${refund.id} ($${(Number(refund.amount ?? 0) / 100).toFixed(2)}) to ${refund.status} (${refund.failure_reason ?? "no reason given"}). ${gaveUp ? "The buyer has NOT been repaid and that was the refund row's last try: no new refund will be sent. Refund it by hand." : reopened === "reopened" ? "The buyer has NOT been repaid; declutter-money sends a new refund within 10 minutes." : "The refund row did not record this refund (an older attempt, or already reopened): nothing changed."}`,
      fields: { "Refund row": meta.refund_id, "Order": meta.order_id || "none" },
    });
    return;
  }

  // A Declutter refund made by hand in the Dashboard carries no kind: if we recorded it, its row reopens.
  if (await handleDeclutterHandRefundFailed(refund, { supabase })) return;

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
  // Q1730 / Q1782 (2): a recurring visit's sales tax reversed for this refund
  // must not stand once the refund failed: its own reversal is undone (or ops
  // is paged when none is recorded). Never throws.
  await undoVisitTaxForFailedRefund({
    stripe, piId, chargeId, refundId: refund.id, refundStatus: String(refund.status), amountCents: Number(refund.amount ?? 0), logStep,
  });
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
