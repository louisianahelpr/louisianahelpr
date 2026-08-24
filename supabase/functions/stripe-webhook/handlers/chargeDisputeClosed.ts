import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { loadAdminIds } from "../../_shared/adminIds.ts";

export async function handleChargeDisputeClosed(
  event: Stripe.Event,
  { stripe, supabase, logStep }: WebhookContext,
): Promise<void> {
  // A Stripe chargeback reached its final state:
  //   "won"            → Stripe ruled for the platform; funds restored.
  //   "lost"           → Stripe ruled for the cardholder; funds gone.
  //   "warning_closed" → Early-fraud warning dismissed; no funds moved.
  //
  // On "won": notify admins to manually release the helper's blocked
  //   payout. We do NOT auto-release — a human should confirm the job
  //   was legitimate before paying the helper after a chargeback.
  // On "lost": record the final outcome for finance reconciliation.
  const closedDispute = event.data.object as Stripe.Dispute;
  const outcome = closedDispute.status; // "won" | "lost" | "warning_closed"
  logStep("Dispute closed", { id: closedDispute.id, status: outcome, amount: closedDispute.amount });

  let closedPiId: string | null =
    typeof closedDispute.payment_intent === "string"
      ? closedDispute.payment_intent
      : (closedDispute.payment_intent as any)?.id ?? null;

  if (!closedPiId) {
    try {
      const closedCharge = await stripe.charges.retrieve(closedDispute.charge as string);
      closedPiId =
        typeof closedCharge.payment_intent === "string"
          ? closedCharge.payment_intent
          : (closedCharge.payment_intent as any)?.id ?? null;
    } catch (e) {
      logStep("Could not retrieve charge for closed dispute", { error: String(e) });
    }
  }

  const finalDisputeStatus =
    outcome === "won" ? "dispute_won"
    : outcome === "lost" ? "dispute_lost"
    : "warning_closed";

  if (closedPiId) {
    const { data: closedJob, error: closedJobErr } = await supabase
      .from("jobs")
      .select("id, customer_id, helper_id, title, payment_status")
      .eq("stripe_payment_intent_id", closedPiId)
      .maybeSingle();

    if (closedJobErr) {
      // A DB failure here means the dispute outcome cannot be recorded.
      // On a "won" dispute this is especially harmful: the Slack alert below
      // tells ops to release the blocked payout, but dispute_status stays
      // "stripe_chargeback" — which blocks release-payout indefinitely with
      // no further signal. Throw so the idempotency row is rolled back and
      // Stripe retries once the DB recovers.
      await postSlackOpsAlert({
        kind: outcome === "won" ? "dispute_won" : outcome === "lost" ? "dispute_lost" : "custom",
        severity: "critical",
        title: `Stripe dispute closed (${outcome}) — outcome NOT RECORDED (job lookup DB error)`,
        message: `Dispute ${closedDispute.id} closed as "${outcome}" but the job lookup failed with a DB error — dispute_status and dispute_resolved_at NOT updated. Stripe will retry this webhook. If retries exhaust, manually update the job row.`,
        fields: {
          "Dispute ID": closedDispute.id,
          "Payment Intent": closedPiId ?? "—",
          "Outcome": outcome,
          "DB error": closedJobErr.message.slice(0, 200),
        },
        link: `https://dashboard.stripe.com/disputes/${closedDispute.id}`,
      });
      throw new Error(`Job lookup failed for closed dispute PI ${closedPiId}: ${closedJobErr.message}`);
    }

    if (closedJob) {
      const { error: resolveUpdateErr } = await supabase
        .from("jobs")
        .update({
          dispute_status: finalDisputeStatus,
          dispute_resolved_at: new Date().toISOString(),
        })
        .eq("id", closedJob.id);

      if (resolveUpdateErr) {
        // A dropped write leaves dispute_status stuck at "stripe_chargeback"
        // rather than "dispute_won"/"dispute_lost"/"warning_closed". On a won
        // dispute this is especially harmful: the Slack alert below tells ops
        // to release the helper's payout, but release-payout's dispute guard
        // only allows dispute_status ∈ {resolved, auto_resolved}. With
        // "stripe_chargeback" still set the payout remains permanently blocked
        // until a human repairs the row manually — with no signal that the
        // repair is even needed. Alert ops NOW (before throwing) so the
        // critical-severity page has full context, then throw so the
        // idempotency row is rolled back and Stripe retries.
        await postSlackOpsAlert({
          kind: outcome === "won" ? "dispute_won" : outcome === "lost" ? "dispute_lost" : "custom",
          severity: "critical",
          title: "Stripe dispute closed — OUTCOME NOT RECORDED (DB error)",
          message: `Dispute ${closedDispute.id} closed as "${outcome}" but the jobs.dispute_status update failed. The job's dispute state is still "stripe_chargeback". Stripe will retry this webhook.`,
          fields: {
            "Dispute ID": closedDispute.id,
            "Outcome": outcome,
            "Job ID": String(closedJob.id),
            "DB error": resolveUpdateErr.message.slice(0, 200),
          },
          link: `https://dashboard.stripe.com/disputes/${closedDispute.id}`,
        });
        throw new Error(`Failed to record dispute outcome "${outcome}" for job ${closedJob.id}: ${resolveUpdateErr.message}`);
      }

      if (outcome === "won") {
        // Funds are back on the platform balance. Notify admins to
        // release the helper's payout that was blocked at dispute.created.
        // Admin uses admin_release_dispute (which sets payment_status =
        // "released") or manually sets dispute_status = "resolved" to
        // let release-payout through its dispute gate.
        const { ids: wonAdminIds } = await loadAdminIds(
          supabase,
          "stripe-webhook.chargeDisputeClosed.won",
        );
        for (const adminId of wonAdminIds) {
          await supabase.from("notifications").insert({
            user_id: adminId,
            title: "Chargeback WON — release helper payout",
            message: `Stripe ruled in our favor on the $${(closedDispute.amount / 100).toFixed(2)} chargeback for "${closedJob.title}". Funds are restored. Please release the helper's payout from the Admin panel.`,
            type: "payment",
            link: "/admin",
          });
        }
      } else if (outcome === "warning_closed") {
        // A retrieval request (card-network inquiry, no funds ever withdrawn) was
        // dismissed. chargeDisputeCreated treated it as a dispute and may have set
        // payment_status = "chargeback" + disputed_at = NOW() on the job to block
        // payout. Now that the inquiry is closed, unblock automatically:
        //
        // process-scheduled-payouts gates on `.is("disputed_at", null)`, and
        // release-payout gates on `dispute_status NOT IN ['resolved', 'auto_resolved']`.
        // Without this reset both payout paths permanently block the job with no
        // guided recovery path — the helper never gets paid.
        //
        // Scoped to payment_status = "chargeback" so jobs that were already
        // "released" when the inquiry came in (shouldBlockPayout was false in
        // chargeDisputeCreated) are untouched. The .select() return tells us
        // whether a row actually matched so we only notify admins when a real
        // unblock happened.
        const { data: unblocked, error: unblockErr } = await supabase
          .from("jobs")
          .update({ payment_status: "payout_pending", disputed_at: null })
          .eq("id", closedJob.id)
          .eq("payment_status", "chargeback")
          .select("id");

        if (unblockErr) {
          // The payout block set by chargeDisputeCreated is still in place. Both
          // payout paths filter this job out permanently with no further signal.
          // Alert ops NOW before throwing (the throw rolls back the idempotency
          // row and lets Stripe retry once the DB recovers).
          await postSlackOpsAlert({
            kind: "custom",
            severity: "critical",
            title: "Stripe retrieval request dismissed — payout UNBLOCK FAILED",
            message: `Dispute ${closedDispute.id} closed as "warning_closed" (retrieval request dismissed, no funds moved), but the job reset to payout_pending failed. The helper's payout is still blocked. Stripe will retry; if retries exhaust, manually set payment_status='payout_pending' and disputed_at=NULL on the job.`,
            fields: {
              "Dispute ID": closedDispute.id,
              "Job ID": String(closedJob.id),
              "DB error": unblockErr.message.slice(0, 200),
            },
            link: `https://dashboard.stripe.com/disputes/${closedDispute.id}`,
          });
          throw new Error(
            `Payout unblock failed for warning_closed dispute ${closedDispute.id} (job ${closedJob.id}): ${unblockErr.message}`,
          );
        }

        if (unblocked && unblocked.length > 0) {
          logStep("Retrieval request dismissed — payout unblocked (payment_status → payout_pending, disputed_at cleared)", {
            jobId: closedJob.id,
            disputeId: closedDispute.id,
          });
          // Let admins know the automatic unblock happened.
          const { ids: warnAdminIds } = await loadAdminIds(
            supabase,
            "stripe-webhook.chargeDisputeClosed.warningClosed",
          );
          for (const adminId of warnAdminIds) {
            await supabase.from("notifications").insert({
              user_id: adminId,
              title: "ℹ Retrieval request closed — payout auto-unblocked",
              message: `A card-network retrieval request for "${closedJob.title}" was dismissed with no chargeback. The helper's temporarily-blocked payout has been automatically unblocked and will proceed on the normal schedule.`,
              type: "info",
              link: "/admin",
            });
          }
        } else {
          // Job was not in "chargeback" state — it was already released when the
          // inquiry came in (shouldBlockPayout was false), so no payout was blocked.
          logStep("Retrieval request dismissed — job was not in chargeback state; no payout unblock needed", {
            jobId: closedJob.id,
            disputeId: closedDispute.id,
          });
        }
      }
    }
  }

  await postSlackOpsAlert({
    kind: outcome === "won" ? "dispute_won" : outcome === "lost" ? "dispute_lost" : "custom",
    severity: outcome === "won" ? "info" : outcome === "lost" ? "critical" : "info",
    title:
      outcome === "won"
        ? "✅ Stripe chargeback WON"
        : outcome === "lost"
        ? "❌ Stripe chargeback LOST"
        : "ℹ️ Stripe early-fraud warning closed",
    message:
      outcome === "won"
        ? `Stripe ruled in our favor on a $${(closedDispute.amount / 100).toFixed(2)} chargeback. Funds restored — release the helper's blocked payout manually via the Admin panel.`
        : outcome === "lost"
        ? `Stripe ruled against us on a $${(closedDispute.amount / 100).toFixed(2)} chargeback. Funds permanently withdrawn. Reconcile the loss.`
        : `An early-fraud warning for $${(closedDispute.amount / 100).toFixed(2)} was dismissed without a chargeback. Any previously-blocked helper payout has been automatically unblocked.`,
    fields: {
      "Dispute ID": closedDispute.id,
      "Payment Intent": closedPiId ?? "—",
      "Amount": `$${(closedDispute.amount / 100).toFixed(2)}`,
      "Outcome": outcome,
    },
    link: `https://dashboard.stripe.com/disputes/${closedDispute.id}`,
  });
}
