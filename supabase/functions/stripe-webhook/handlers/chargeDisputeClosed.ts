// seed-policy: pages for seed/E2E jobs too, on purpose. Every alert here is money
// that moved (or failed to move) in Stripe while the DB says otherwise, or a Stripe
// event that could not be settled: a platform failure whoever owns the job. The
// nightly money journeys on seed jobs are how this path is proven, so their failures
// are real signal (2026-09-22: "transfer failed" on seed jobs = the empty test
// balance, Q3). Seed-only noise is routed in the detectors, not here (docs/OPEN.md Q2).
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { loadAdminIds } from "../../_shared/adminIds.ts";
import {
  disputeStatusAsReadFilter,
  findInternalPayoutHold,
  holdReasons,
  isChargebackDisputeStatus,
  type InternalPayoutHold,
} from "./_chargebackHold.ts";
import { alertGiftDisputeClosed } from "./_giftCardRefund.ts";
import { finalizeLostClawback, notifyPayee, repayClawback, type RepayResult } from "./_chargebackClawback.ts";

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

  // A GIFT CARD donation's PaymentIntent never reaches `jobs`, so everything
  // below is blind to it. Report-only — see alertGiftDisputeClosed for why a
  // "won" dispute does not auto-restore the credit.
  await alertGiftDisputeClosed(supabase, closedPiId, outcome, logStep);

  const finalDisputeStatus =
    outcome === "won" ? "dispute_won"
    : outcome === "lost" ? "dispute_lost"
    : "warning_closed";

  // True when a dismissed inquiry restored the payment state but left a hold
  // the job carried on its own, so the closing alert does not claim an unblock.
  let heldAfterDismissal = false;
  // Set when this dispute had clawed back a paid Helpr payout (Q202) and a WON
  // outcome paid it back.
  let repaid: RepayResult | null = null;

  if (closedPiId) {
    const { data: closedJob, error: closedJobErr } = await supabase
      .from("jobs")
      .select("id, customer_id, helper_id, title, payment_status, status, payout_scheduled_at, dispute_status, disputed_at")
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
      // The job's dispute markers are the card dispute's to rewrite only when
      // it placed them (see _chargebackHold.ts). An internal dispute_status —
      // 'resolved' on a decided dispute, 'reversal_hold', 'open', 'escalated' —
      // is never overwritten with a card-dispute outcome.
      const ownsMarkers = isChargebackDisputeStatus(closedJob.dispute_status);

      // A dismissed inquiry is the one outcome that lifts a hold automatically,
      // so it must first know about the holds that live OFF the job row. Read
      // before any write: on a read failure nothing has changed, and the throw
      // lets Stripe retry. A won dispute reads them too, so the admin notice
      // does not tell anyone to release a payout over a live hold — but a read
      // failure there only changes the wording (nothing is unblocked on 'won').
      let hold: InternalPayoutHold = {};
      if (outcome === "warning_closed" || outcome === "won") {
        hold = await findInternalPayoutHold(supabase, closedJob.id);
        if (hold.readError && outcome === "warning_closed") {
          await postSlackOpsAlert({
            kind: "custom",
            severity: "critical",
            title: "Stripe retrieval request dismissed — HOLD CHECK FAILED, job left blocked",
            message: `Dispute ${closedDispute.id} closed as "warning_closed", but the check for an unexecuted dispute split or a reversed payout on the job could not be read. Nothing was changed (the job stays payment_status='chargeback'). Stripe will retry this webhook.`,
            fields: {
              "Dispute ID": closedDispute.id,
              "Job ID": String(closedJob.id),
              "Read error": hold.readError.slice(0, 200),
            },
            link: `https://dashboard.stripe.com/disputes/${closedDispute.id}`,
            // Stripe retries this delivery for days; one page per job per day
            // is the signal, the rest are counted in the digest.
            oncePerDayKey: `dispute-closed-hold-read-failed:${closedJob.id}`,
          });
          throw new Error(
            `Hold check failed for warning_closed dispute ${closedDispute.id} (job ${closedJob.id}): ${hold.readError}`,
          );
        }
      }
      // Every live hold on the job, from the row and the off-row reads. A
      // SETTLED internal status ('resolved' with no unexecuted split,
      // 'auto_resolved') is not a hold: release-payout pays those normally.
      const reasons = hold.readError ? [] : holdReasons(closedJob, hold);
      const held = reasons.length > 0;

      if (ownsMarkers) {
        // Compare-and-set on a card-dispute status: an internal dispute opened
        // since the read is not overwritten with this outcome.
        const { data: recorded, error: resolveUpdateErr } = await supabase
          .from("jobs")
          .update({
            dispute_status: finalDisputeStatus,
            dispute_resolved_at: new Date().toISOString(),
          })
          .eq("id", closedJob.id)
          .or(disputeStatusAsReadFilter(closedJob.dispute_status))
          .select("id");

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
            message: `Dispute ${closedDispute.id} closed as "${outcome}" but the jobs.dispute_status update failed. The job's dispute state is still "${closedJob.dispute_status}". Stripe will retry this webhook.`,
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
        if (!recorded || recorded.length === 0) {
          // Read as card-dispute-owned, matched nothing: an internal dispute took
          // the markers in between. Not overwriting it is correct; say so.
          await postSlackOpsAlert({
            kind: "custom",
            severity: "warning",
            title: "Stripe dispute closed — outcome not recorded (job dispute state changed)",
            message: `Dispute ${closedDispute.id} closed as "${outcome}", but the job's dispute_status changed from "${closedJob.dispute_status}" before the outcome was written, so it was left alone. Check the job's dispute state by hand.`,
            fields: { "Dispute ID": closedDispute.id, "Job ID": String(closedJob.id), "Outcome": outcome },
            link: `https://dashboard.stripe.com/disputes/${closedDispute.id}`,
          });
        }
      } else {
        logStep("Dispute closed on a job with an internal dispute_status — outcome not written over it", {
          jobId: closedJob.id,
          disputeStatus: closedJob.dispute_status,
          outcome,
        });
      }

      // ── Clawback settlement (Q202) ──
      // chargeDisputeCreated reversed the Helpr's transfer(s) when the job had
      // already been paid. WON: pay each reversed amount back (idempotent per
      // dispute + transfer), then return the job to 'released'. LOST: the
      // reversal stands; the rows are marked final. Both tell the payee.
      if (outcome === "won") {
        repaid = await repayClawback({ stripe, supabase, logStep }, closedDispute, { id: closedJob.id, title: closedJob.title });
        if (repaid.rows > 0 && repaid.failed.length === 0) {
          const { data: back, error: backErr } = await supabase
            .from("jobs")
            .update({ payment_status: "released" })
            .eq("id", closedJob.id)
            .eq("payment_status", "chargeback")
            .select("id");
          if (backErr) {
            await postSlackOpsAlert({
              kind: "dispute_won",
              severity: "critical",
              title: "Chargeback WON — Helpr re-paid, job NOT returned to released (DB error)",
              message: `Dispute ${closedDispute.id}: the Helpr was paid back, but the job could not be set back to payment_status='released'. Set it by hand; do NOT release another payout.`,
              fields: { "Dispute ID": closedDispute.id, "Job ID": String(closedJob.id), "DB error": backErr.message.slice(0, 200) },
              link: `https://dashboard.stripe.com/disputes/${closedDispute.id}`,
            });
          } else if (!back || back.length === 0) {
            logStep("Clawback repaid; job was not in 'chargeback' (left as is)", { jobId: closedJob.id });
          }
        }
      } else if (outcome === "lost") {
        const lost = await finalizeLostClawback({ stripe, supabase, logStep }, closedDispute, { id: closedJob.id, title: closedJob.title });
        // ME-009: a payout that was held (never paid, so nothing to claw back)
        // used to end in silence. finalizeLostClawback tells a clawed-back payee.
        if (lost.rows === 0 && closedJob.helper_id && closedJob.payment_status === "chargeback") {
          await notifyPayee(
            supabase, closedJob.helper_id, String(closedJob.id),
            "Card dispute closed",
            `The bank decided the card dispute on "${closedJob.title ?? "a job"}" for the card holder, so the payment for this job went back to them and your payout for it stays on hold. Contact support about next steps.`,
            closedDispute.id,
          );
        }
      }

      if (outcome === "won" && repaid && repaid.rows > 0) {
        // The Helpr's clawed-back payout was paid back automatically above.
        const { ids: wonAdminIds } = await loadAdminIds(
          supabase,
          "stripe-webhook.chargeDisputeClosed.won",
        );
        // Worded from what actually happened per row, never assumed.
        const nothingTaken = repaid.neverTaken === repaid.rows;
        for (const adminId of wonAdminIds) {
          const { error: noticeErr } = await supabase.from("notifications").insert({
            user_id: adminId,
            job_id: closedJob.id,
            title: repaid.failed.length > 0
              ? "Chargeback WON — paying the Helpr back FAILED"
              : nothingTaken
              ? "Chargeback WON — nothing had been taken back"
              : "Chargeback WON — Helpr paid back automatically",
            message: `Stripe ruled in our favor on the $${(closedDispute.amount / 100).toFixed(2)} chargeback for "${closedJob.title}". ${repaid.failed.length > 0
              ? "The payout taken back when it was filed could not be paid back to the Helpr. Pay it by hand from the Admin panel."
              : nothingTaken
              ? "The Helpr's payout was never reversed (Stripe refused the clawback), so there is nothing to pay back. Nothing to release."
              : "The payout taken back when it was filed has been paid back to the Helpr. Nothing to release."}`,
            type: "payment",
            link: "/admin",
          });
          if (noticeErr) logStep("Won-dispute admin notice failed", { adminId, error: noticeErr.message });
        }
      } else if (outcome === "won") {
        // ME-009: tell the held Helpr it was won — only when nothing else
        // holds the job, since that is when admins are asked to release it.
        if (!held && !hold.readError && closedJob.helper_id && closedJob.payment_status === "chargeback") {
          await notifyPayee(
            supabase, closedJob.helper_id, String(closedJob.id),
            "Card dispute decided in our favor",
            `The card dispute on "${closedJob.title ?? "a job"}" was decided in our favor. Our team has been asked to release your payout for it.`,
            closedDispute.id,
          );
        }
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
          const { error: noticeErr } = await supabase.from("notifications").insert({
            user_id: adminId,
            job_id: closedJob.id,
            title: held
              ? "Chargeback WON — job still on hold"
              : hold.readError
              ? "Chargeback WON — check the job before releasing"
              : "Chargeback WON — release Helpr payout",
            message: `Stripe ruled in our favor on the $${(closedDispute.amount / 100).toFixed(2)} chargeback for "${closedJob.title}". Funds are restored. ${held
              ? `The job still has its own hold (${reasons.join("; ")}). Settle that first; a full payout is not owed until it is.`
              : hold.readError
              ? "Its open-dispute and payout-reversal records could not be read, so check them in the Admin panel before releasing the Helpr's payout."
              : "Please release the Helpr's payout from the Admin panel."}`,
            type: "payment",
            link: "/admin",
          });
          if (noticeErr) logStep("Chargeback-closed admin notice failed", { adminId, error: noticeErr.message });
        }
      } else if (outcome === "warning_closed") {
        // A retrieval request (card-network inquiry, no funds ever withdrawn) was
        // dismissed. chargeDisputeCreated blocks only a PAYABLE job — one in
        // escrow or payout_pending — by flipping it to payment_status =
        // "chargeback". Now that the inquiry is closed, put the job back in the
        // payment state it held BEFORE the block.
        //
        // It used to write payout_pending unconditionally. On a job whose work
        // was not done (escrow) that moved no money — process-scheduled-payouts
        // requires status = 'completed' and a payout_scheduled_at — but it left
        // the job where no sweep reads it: auto-release-payment only picks up
        // escrow, the payout cron only completed jobs. Stranded.
        //
        // disputed_at is cleared ONLY when the card dispute placed it and no
        // hold exists (OPEN.md HIGH, d7a04acb9; holdReasons in
        // _chargebackHold.ts: an unexecuted or open dispute, a reversed
        // transfer, status 'disputed', or a live internal dispute_status). It used to be cleared
        // unconditionally, and it is process-scheduled-payouts' only dispute
        // guard on the job row, so the dismissal lifted holds it never placed:
        //   - a decided dispute whose split has not executed was paid in FULL
        //     over the decided refund (rpc_decide_dispute leaves disputed_at);
        //   - a reversed payout ('reversal_hold') became re-payable.
        // Both holds are read from their own tables (the old created handler
        // overwrote the job's dispute_status on such jobs, so the row alone
        // cannot be trusted). When one exists disputed_at is KEPT — stamped if
        // somehow empty — and ops is paged. The payment_status block itself is
        // the chargeback's own and is restored, so the internal process
        // (execute-dispute-split needs escrow/payout_pending) can still run.
        //
        // Compare-and-set on payment_status = "chargeback" AND the dispute_status
        // the decision was made from. .select("id") makes the row count
        // observable: zero rows on a job we just read as "chargeback" means
        // something moved it underneath us, and that pages ops.
        const clearDisputedAt = ownsMarkers && !held;
        const restoredPaymentStatus = preChargebackPaymentStatus(closedJob);
        const { data: unblocked, error: unblockErr } = await supabase
          .from("jobs")
          .update({
            payment_status: restoredPaymentStatus,
            disputed_at: clearDisputedAt
              ? null
              : held
              ? (closedJob.disputed_at ?? new Date().toISOString())
              : (closedJob.disputed_at ?? null),
          })
          .eq("id", closedJob.id)
          .eq("payment_status", "chargeback")
          .or(disputeStatusAsReadFilter(closedJob.dispute_status))
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
            message: `Dispute ${closedDispute.id} closed as "warning_closed" (retrieval request dismissed, no funds moved), but restoring the job to ${restoredPaymentStatus} failed. The job is still payment_status='chargeback'. Stripe will retry; if retries exhaust, manually set payment_status='${restoredPaymentStatus}'${clearDisputedAt ? " and disputed_at=NULL" : " and LEAVE disputed_at as it is"} on the job.`,
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
          heldAfterDismissal = held;
          logStep("Retrieval request dismissed — payment state restored", {
            jobId: closedJob.id,
            restoredPaymentStatus,
            disputedAtCleared: clearDisputedAt,
            holdReasons: reasons,
            disputeId: closedDispute.id,
          });
          if (held) {
            // The chargeback's own block is lifted; the internal hold is not.
            await postSlackOpsAlert({
              kind: "money_at_risk",
              severity: "critical",
              title: "Stripe retrieval request dismissed on a job with an internal payout hold — hold KEPT",
              message: `Dispute ${closedDispute.id} closed as "warning_closed". The job was restored to ${restoredPaymentStatus}, but disputed_at was KEPT because ${reasons.join("; ")}. Settle that by hand; do not release a full payout over it. (auto-resolve-disputes does not read disputed_at: if the job is still 'disputed', check it will not auto-pay.)`,
              fields: {
                "Dispute ID": closedDispute.id,
                "Job ID": String(closedJob.id),
                "Job status": closedJob.status ?? "—",
                "Job dispute_status": closedJob.dispute_status ?? "—",
                "Unexecuted dispute": hold.unsettledDisputeId ?? "—",
                "Open dispute": hold.openDisputeId ?? "—",
                "Reversed transfer": hold.reversedTransferId ?? "—",
              },
              link: `https://dashboard.stripe.com/disputes/${closedDispute.id}`,
            });
          }
          // ME-009: the Helpr was told their payout was on hold; say it lifted.
          if (!held && closedJob.helper_id) {
            await notifyPayee(
              supabase, closedJob.helper_id, String(closedJob.id),
              "Payout hold lifted",
              `The bank's question about the payment for "${closedJob.title ?? "a job"}" was closed with no dispute, so the hold on your payout is lifted and the job continues as normal.`,
              closedDispute.id,
            );
          }
          // Let admins know what the automatic restore did.
          const { ids: warnAdminIds } = await loadAdminIds(
            supabase,
            "stripe-webhook.chargeDisputeClosed.warningClosed",
          );
          for (const adminId of warnAdminIds) {
            const { error: noticeErr } = await supabase.from("notifications").insert({
              user_id: adminId,
              job_id: closedJob.id,
              title: held
                ? "Retrieval request closed — job still on hold"
                : restoredPaymentStatus === "payout_pending"
                ? "ℹ Retrieval request closed — payout auto-unblocked"
                : "ℹ Retrieval request closed — job back in escrow",
              message: `A card-network retrieval request for "${closedJob.title}" was dismissed with no chargeback. ${held
                ? `The job still has its own hold (${reasons.join("; ")}), which was left in place. Settle it from the Admin panel.`
                : restoredPaymentStatus === "payout_pending"
                ? "The Helpr's temporarily-blocked payout has been automatically unblocked and will proceed on the normal schedule."
                : "The job's funds are back in escrow and it continues as normal."}`,
              type: "info",
              link: "/admin",
            });
            if (noticeErr) logStep("Chargeback-closed admin notice failed", { adminId, error: noticeErr.message });
          }
        } else if (closedJob.payment_status === "chargeback") {
          // We read the job as blocked, the conditional write matched nothing:
          // another writer moved payment_status or dispute_status in between.
          // The job is in an unknown state that this webhook will not revisit
          // (it ACKs 200), so a human has to look.
          await postSlackOpsAlert({
            kind: "custom",
            severity: "critical",
            title: "Stripe retrieval request dismissed — unblock matched no row",
            message: `Dispute ${closedDispute.id} closed as "warning_closed". The job was read as payment_status='chargeback' but restoring it to ${restoredPaymentStatus} matched zero rows — payment_status or dispute_status changed underneath the webhook. Check the job's payment_status, dispute_status and disputed_at by hand; no sweep will pick it up if it is still blocked.`,
            fields: {
              "Dispute ID": closedDispute.id,
              "Job ID": String(closedJob.id),
              "Intended payment_status": restoredPaymentStatus,
              "Read dispute_status": closedJob.dispute_status ?? "—",
            },
            link: `https://dashboard.stripe.com/disputes/${closedDispute.id}`,
          });
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
        ? repaid && repaid.rows > 0
          ? `Stripe ruled in our favor on a $${(closedDispute.amount / 100).toFixed(2)} chargeback. The Helpr's clawed-back payout was ${repaid.failed.length > 0 ? "NOT fully paid back (see the separate alert)" : repaid.neverTaken === repaid.rows ? "never reversed, so nothing was owed back" : "paid back automatically"}.`
          : `Stripe ruled in our favor on a $${(closedDispute.amount / 100).toFixed(2)} chargeback. Funds restored — release the helper's blocked payout manually via the Admin panel.`
        : outcome === "lost"
        ? `Stripe ruled against us on a $${(closedDispute.amount / 100).toFixed(2)} chargeback. Funds permanently withdrawn. Reconcile the loss.`
        : heldAfterDismissal
        ? `An early-fraud warning for $${(closedDispute.amount / 100).toFixed(2)} was dismissed without a chargeback. The job's own dispute or payout-reversal hold was kept in place.`
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

/**
 * The payment_status a chargeback-blocked job held before
 * charge.dispute.created flipped it to "chargeback".
 *
 * The block only ever applies to escrow or payout_pending, so the answer is one
 * of those two. It is derived, not recorded (no schema change, and it also
 * answers for jobs blocked before this fix shipped):
 *
 *   - a scheduled payout means payout_pending. Every edge writer that moves a
 *     job from escrow to payout_pending (auto-release-payment, create-payment's
 *     two-sided release, the re-pay checkout, auto-resolve-disputes) stamps
 *     payout_scheduled_at in the same write, and nothing moves a job from
 *     payout_pending back to escrow;
 *   - a completed job with no schedule means payout_pending. This covers a
 *     payout the transfer-failure handlers re-queued on a job released by
 *     hand. It is NOT exact for a completed + escrow job (rpc_decide_dispute
 *     leaves one), but no money moves wrongly: process-scheduled-payouts skips
 *     a null payout_scheduled_at, and execute-dispute-split and the admin
 *     payout batches treat escrow and payout_pending alike on a completed job;
 *   - otherwise the work was not done and the money was still in escrow.
 *
 * Deliberately NOT keyed on poster_completed_at + helper_completed_at: the
 * auto-release path completes a job 24h after the helper marks done with the
 * poster stamp still null, so a stamps rule would restore that completed job
 * to escrow — which auto-release-payment does not read either.
 */
export function preChargebackPaymentStatus(job: {
  status?: string | null;
  payout_scheduled_at?: string | null;
}): "escrow" | "payout_pending" {
  return job.payout_scheduled_at || job.status === "completed" ? "payout_pending" : "escrow";
}
