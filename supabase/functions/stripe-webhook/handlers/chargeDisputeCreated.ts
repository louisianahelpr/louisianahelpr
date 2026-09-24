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
  CHARGEBACK_MAY_MARK_FILTER,
  SETTLED_INTERNAL_DISPUTE_STATUSES,
  chargebackMayMarkJob,
  disputeStatusAsReadFilter,
  findInternalPayoutHold,
  holdReasons,
} from "./_chargebackHold.ts";
import { revokeGiftCardForRefund } from "./_giftCardRefund.ts";
import { clawBackReleasedPayout, type ClawbackResult } from "./_chargebackClawback.ts";

export async function handleChargeDisputeCreated(
  event: Stripe.Event,
  ctx: WebhookContext,
): Promise<void> {
  await applyCardDispute(event.data.object as Stripe.Dispute, ctx, "created");
}

/**
 * charge.dispute.funds_withdrawn (Q202). Stripe sends it when the disputed
 * money actually leaves the platform: right after charge.dispute.created for an
 * ordinary chargeback, and LATER for an inquiry (warning_*) the bank escalates
 * into a chargeback, a case charge.dispute.created never sees as money-moving
 * (it arrived while the dispute was still an inquiry). Every write here is a
 * compare-and-set or claimed per (dispute, transfer), so the ordinary pair is a
 * no-op the second time; admins and ops hear about it only when this event
 * changed something (an escalated inquiry).
 */
export async function handleChargeDisputeFundsWithdrawn(
  event: Stripe.Event,
  ctx: WebhookContext,
): Promise<void> {
  await applyCardDispute(event.data.object as Stripe.Dispute, ctx, "funds_withdrawn");
}

async function applyCardDispute(
  dispute: Stripe.Dispute,
  { stripe, supabase, logStep }: WebhookContext,
  mode: "created" | "funds_withdrawn",
): Promise<void> {
  // A customer filed a Stripe chargeback. Stripe immediately withdraws the
  // disputed amount from the platform's bank balance. We must:
  //   1. Block any automated payout for the affected job (payout_pending
  //      or escrow) — paying the helper from money we no longer have
  //      compounds the loss.
  //   2. Alert ops so someone responds in Stripe Dashboard before the
  //      evidence due date (typically 7 days or Stripe auto-loses the case).
  logStep(mode === "created" ? "Chargeback filed" : "Chargeback funds withdrawn", {
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

  // A GIFT CARD donation's PaymentIntent never reaches `jobs`, so the lookup
  // below cannot see it and this handler used to no-op on a charged-back gift.
  // Stripe has ALREADY withdrawn the disputed amount from the platform balance,
  // so leaving the credit spendable means paying a helper from money we no
  // longer have — the same reasoning as the payout block below, applied to the
  // gift ledger. Returns `no_gift` for an ordinary job escrow PI.
  //
  // …but ONLY for a real chargeback. Stripe delivers inquiries and early-fraud
  // warnings through this same event with a `warning_*` status, and those
  // withdraw NOTHING — the comment above is simply untrue for them. Revocation
  // is deliberately one-way (un-revoking is a mint, so even a won dispute is
  // not auto-restored), which means revoking on an inquiry destroys a live gift
  // permanently over a question the bank may never turn into a chargeback.
  const isInquiry = typeof dispute.status === "string" && dispute.status.startsWith("warning_");
  if (isInquiry) {
    logStep("Dispute is an inquiry — gift credit left alone", {
      id: dispute.id,
      status: dispute.status,
    });
  } else if (mode === "created") {
    await revokeGiftCardForRefund(supabase, disputePiId, "chargeback", logStep);
  }

  // Set when the job already carried a dispute hold the chargeback left alone,
  // so the page tells ops the job has two things going on at once.
  let keptHold: string | null = null;
  // Set when this dispute clawed back an already-paid Helpr payout (Q202).
  let clawback: ClawbackResult | null = null;
  // The job the clawback runs against (after every page and notice below, so
  // a throw inside it can never suppress them), and whether finding nothing
  // to reverse is itself an alarm (only for a job read as paid out).
  let clawbackJob: { id: string; title: string | null } | null = null;
  let alertIfNoTransfer = false;
  // funds_withdrawn only pages when it moved something the created event had not.
  let changed = false;

  if (disputePiId) {
    const { data: chargebackJob, error: chargebackJobErr } = await supabase
      .from("jobs")
      .select("id, customer_id, helper_id, title, payment_status, status, dispute_status, disputed_at")
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
        title: "Stripe chargeback — PAYOUT BLOCK SKIPPED (job lookup DB error)",
        message: `A chargeback fired but the job lookup failed with a DB error — payout block NOT applied. Stripe will retry this webhook. If retries exhaust, manually set payment_status='chargeback' on the job to prevent double-loss — and dispute_status='stripe_chargeback', disputed_at=NOW() ONLY if the job has no dispute_status of its own (never overwrite an internal dispute or reversal hold).`,
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
      // ── CLAW BACK a payout that already went out (Q202, owner 2026-09-23) ──
      // A 'released' job already paid the Helpr. That used to be left alone
      // ("ops handles the net loss manually"), so the Helpr kept the money and
      // the platform paid the cardholder plus Stripe's fee. Now the Helpr's
      // transfer(s) for the job are reversed, up to the disputed amount, and a
      // WON dispute pays them back (chargeDisputeClosed). Never on an inquiry:
      // those withdraw nothing.
      //
      // Order matters. The job is flipped released -> 'chargeback' FIRST, as a
      // compare-and-set: the reversal fires transfer.reversed, whose handler
      // re-queues a still-'released' job to payout_pending/'reversal_hold'. On
      // a redelivery the job reads 'chargeback' already, and the clawback
      // resumes from its ledger rows (it never reverses twice).
      if (!isInquiry && chargebackJob.payment_status === "released") {
        {
          const { data: flipped, error: flipErr } = await supabase
            .from("jobs")
            .update({ payment_status: "chargeback" })
            .eq("id", chargebackJob.id)
            .eq("payment_status", "released")
            .select("id");
          if (flipErr) {
            await postSlackOpsAlert({
              kind: "dispute_filed",
              severity: "critical",
              title: "Stripe chargeback on a PAID job — clawback NOT started (DB error)",
              message: `A chargeback fired on a released job, but marking it payment_status='chargeback' failed, so the Helpr's payout was not reversed. Stripe will retry this webhook.`,
              fields: { "Dispute ID": dispute.id, "Job ID": String(chargebackJob.id), "DB error": flipErr.message.slice(0, 200) },
              link: `https://dashboard.stripe.com/disputes/${dispute.id}`,
            });
            throw new Error(`Clawback flip failed for job ${chargebackJob.id}: ${flipErr.message}`);
          }
          if (flipped && flipped.length > 0) {
            changed = true;
            alertIfNoTransfer = true;
          }
          // Zero rows: the job left 'released' since the read. The clawback
          // below still runs: it decides from Stripe's transfer group, not from
          // the status we read.
        }
      }
      // THE CLAWBACK RUNS FOR EVERY REAL CHARGEBACK ON A MATCHED JOB, whatever
      // its payment_status. It decides from Stripe's own transfer list for
      // transfer_group job_<id> (plus the payout_transfers ledger), never from
      // the status read above: a payout that settled between that read and the
      // block below, a redelivery after the flip, or a job whose ledger row is
      // still 'pending' all have a transfer to reverse, and a job that was
      // never paid simply has none. Reviews 2026-09-23 (money-escrow #3,
      // silent-failure #2).
      if (!isInquiry) clawbackJob = { id: chargebackJob.id, title: chargebackJob.title ?? null };

      // Only flip payment_status to block a payout that hasn't gone out yet.
      // A 'released' job is handled by the clawback above.
      let shouldBlockPayout = ["payout_pending", "escrow"].includes(
        chargebackJob.payment_status,
      );
      const disputedAt = new Date().toISOString();
      // The markers are NOT ours when the job already carries an internal hold
      // (OPEN.md HIGH, d7a04acb9). This used to overwrite dispute_status and
      // disputed_at unconditionally, and a dismissed inquiry then cleared
      // disputed_at: a decided-but-unexecuted dispute ('resolved') paid the
      // Helpr in full over the decided refund, and a 'reversal_hold' job became
      // re-payable. The payout block (payment_status) still applies — it is the
      // chargeback's own — but an internal dispute_status / disputed_at is left
      // exactly as it was. See _chargebackHold.ts.
      let mayMark = chargebackMayMarkJob(chargebackJob);
      // One exception, for a RELEASED job whose internal dispute is SETTLED
      // ('resolved' / 'auto_resolved'): the money already moved, so there is
      // no internal hold to protect — and without a card-dispute marker a
      // failed or canceled transfer re-queues the job and release-payout's
      // allow-list pays it over the live chargeback. Settled is proven from
      // the off-row reads too, because 'resolved' is also what an unexecuted
      // decision looks like on the job row. The marker write is then a CAS on
      // exactly the status read. Read before any write (a released job gets
      // no block), so a read failure throws with nothing changed.
      const settledReleased = !mayMark &&
        chargebackJob.payment_status === "released" &&
        (SETTLED_INTERNAL_DISPUTE_STATUSES as readonly string[]).includes(chargebackJob.dispute_status ?? "");
      if (settledReleased) {
        const hold = await findInternalPayoutHold(supabase, chargebackJob.id);
        if (hold.readError) {
          await postSlackOpsAlert({
            kind: "dispute_filed",
            severity: "critical",
            title: "Stripe chargeback on a released job — HOLD CHECK FAILED, marker not placed",
            message: `A chargeback fired on a released job whose own dispute reads as settled, but its open-dispute / unexecuted-split / reversed-payout records could not be read, so no chargeback marker was placed. Stripe will retry this webhook. Do not re-queue this job's payout until it is marked.`,
            fields: {
              "Dispute ID": dispute.id,
              "Job ID": String(chargebackJob.id),
              "Read error": hold.readError.slice(0, 200),
            },
            link: `https://dashboard.stripe.com/disputes/${dispute.id}`,
            oncePerDayKey: `dispute-created-hold-read-failed:${chargebackJob.id}`,
          });
          throw new Error(`Hold check failed for chargeback ${dispute.id} on job ${chargebackJob.id}: ${hold.readError}`);
        }
        mayMark = holdReasons(chargebackJob, hold).length === 0;
      }
      const markFilter = settledReleased
        ? disputeStatusAsReadFilter(chargebackJob.dispute_status)
        : CHARGEBACK_MAY_MARK_FILTER;
      let markersPlaced = false;

      // The block is a COMPARE-AND-SET on the payment state it was decided
      // from (race-class audit 2026-09-14). Matched on id alone, a payout that
      // settled between the read above and this write (process-scheduled-payouts
      // flipping payout_pending → released) was overwritten to 'chargeback' —
      // hiding a paid Helpr from ops, and a later warning_closed then walked
      // that job back to payout_pending, re-queuing money that had already left.
      // Likewise a cancel_escrow holding 'cancelling' was stomped mid-refund.
      // Zero rows means the job left the payable set: no block, markers only.
      // payment_status alone here; the markers are their own conditional write.
      let blockUpdateErr: { message: string } | null = null;
      if (shouldBlockPayout) {
        const { data: blocked, error: blockErr } = await supabase
          .from("jobs")
          .update({ payment_status: "chargeback" })
          .eq("id", chargebackJob.id)
          .in("payment_status", ["payout_pending", "escrow"])
          .select("id");
        blockUpdateErr = blockErr;
        if (!blockErr && blocked && blocked.length > 0) changed = true;
        if (!blockErr && (!blocked || blocked.length === 0)) {
          logStep("Chargeback block skipped — payment_status left the payable set since read", {
            jobId: chargebackJob.id,
            readPaymentStatus: chargebackJob.payment_status,
          });
          shouldBlockPayout = false;
        }
      }
      if (!blockUpdateErr && mayMark) {
        // Markers — no lifecycle column. disputed_at is what the payout guards
        // key on. A compare-and-set on "no markers, or card-dispute markers
        // only": an internal dispute opened or decided since the read makes
        // this match zero rows instead of being overwritten.
        const { data: marked, error: markerErr } = await supabase
          .from("jobs")
          .update({ dispute_status: "stripe_chargeback", disputed_at: disputedAt })
          .eq("id", chargebackJob.id)
          .or(markFilter)
          .select("id");
        blockUpdateErr = markerErr;
        markersPlaced = !markerErr && (marked?.length ?? 0) > 0;
        if (!markerErr && !markersPlaced) {
          // Zero rows is legitimate: an internal hold took the markers since
          // the read, and it is exactly what must not be overwritten.
          logStep("Chargeback markers skipped — an internal dispute hold appeared since read", {
            jobId: chargebackJob.id,
          });
        }
      } else if (!blockUpdateErr) {
        logStep("Chargeback markers skipped — job already carries an internal dispute hold", {
          jobId: chargebackJob.id,
          disputeStatus: chargebackJob.dispute_status,
          disputedAt: chargebackJob.disputed_at,
        });
      }

      if (blockUpdateErr) {
        // A DB write failed — the payout block (payment_status) and/or the
        // dispute markers (disputed_at, dispute_status) were NOT applied. Without disputed_at set, the job
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
          title: "Stripe chargeback — PAYOUT BLOCK FAILED (DB error), double-loss risk",
          message: `A chargeback fired but the DB write to block payouts failed. The job may still be payable with no dispute marker — invisible to the payout guards. Stripe will retry this webhook. If retries exhaust, manually set payment_status='chargeback' on the job to prevent double-loss — and dispute_status='stripe_chargeback', disputed_at=NOW() ONLY if the job has no dispute_status of its own (never overwrite an internal dispute or reversal hold).`,
          fields: {
            "Dispute ID": dispute.id,
            "Payment Intent": disputePiId ?? "—",
            "Job ID": String(chargebackJob.id),
            "Prev payment_status": chargebackJob.payment_status,
            "Should block payout": String(shouldBlockPayout),
            "Existing dispute_status": chargebackJob.dispute_status ?? "—",
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
          : "Chargeback on a job outside the payable set (released, or moved since read) — no block, manual reconciliation needed",
        {
          jobId: chargebackJob.id,
          prevPaymentStatus: chargebackJob.payment_status,
          shouldBlockPayout,
          markersPlaced,
          disputeId: dispute.id,
        },
      );
      if (!markersPlaced) {
        keptHold = `dispute_status=${chargebackJob.dispute_status ?? "null"}, disputed_at=${chargebackJob.disputed_at ?? "null"}`;
      }

      // Notify all admins — chargebacks require a Stripe Dashboard response
      // or the platform auto-loses and pays both the customer AND a $15 fee.
      // funds_withdrawn: only when it changed something (an escalated inquiry);
      // the ordinary created + funds_withdrawn pair notifies once.
      const { ids: chargebackAdminIds } = mode === "created" || changed
        ? await loadAdminIds(supabase, "stripe-webhook.chargeDisputeCreated")
        : { ids: [] as string[] };
      // The evidence deadline is written into the notice itself (AM-002): it
      // used to exist only in a Slack field, so nothing in the app could say
      // when the dispute would be auto-lost.
      const dueBy = dispute.evidence_details?.due_by
        ? new Date(dispute.evidence_details.due_by * 1000).toISOString().split("T")[0]
        : null;
      for (const adminId of chargebackAdminIds) {
        const { error: noticeErr } = await supabase.from("notifications").insert({
          user_id: adminId,
          job_id: chargebackJob.id,
          title: "Stripe chargeback filed",
          message: `A $${(dispute.amount / 100).toFixed(2)} chargeback was filed for "${chargebackJob.title}". Respond in Stripe Dashboard ${dueBy ? `by ${dueBy} (the evidence deadline)` : "before the evidence deadline"} or the dispute is auto-lost.`,
          type: "warning",
          link: "/admin",
        });
        if (noticeErr) logStep("Chargeback admin notice failed", { adminId, error: noticeErr.message });
      }
    }
  }

  // Always alert ops even when no job is matched — funds already left
  // the platform and someone must respond in Stripe Dashboard. Posted BEFORE
  // the clawback so a throw there (Stripe redelivers) can never suppress it;
  // once per dispute per day so a redelivery does not page twice.
  if (mode === "created" || changed) await postSlackOpsAlert({
    kind: "dispute_filed",
    severity: "critical",
    title: mode === "created" ? "Stripe chargeback filed" : "Stripe inquiry escalated to a chargeback (funds withdrawn)",
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
      ...(keptHold ? { "Existing hold kept": keptHold } : {}),
    },
    link: `https://dashboard.stripe.com/disputes/${dispute.id}`,
    oncePerDayKey: `dispute-filed:${mode}:${dispute.id}`,
  });

  // ── CLAW BACK a payout that already went out (Q202) ──
  // Last on purpose (see clawbackJob above). Throws only for a DB failure or
  // a transient Stripe failure; the claimed chargeback_clawbacks rows make the
  // redelivery resume, never repeat.
  if (clawbackJob) {
    clawback = await clawBackReleasedPayout(
      { stripe, supabase, logStep },
      dispute,
      clawbackJob,
      { alertIfNoTransfer },
    );
    if (clawback.reversedNowCents > 0) {
      await postSlackOpsAlert({
        kind: "dispute_filed",
        severity: "warning",
        title: "Card dispute on a paid job — Helpr payout clawed back",
        message: `Dispute ${dispute.id}: ${`$${(clawback.reversedNowCents / 100).toFixed(2)}`} of the Helpr's payout for this job was reversed back to the platform. A won dispute pays it back automatically; a lost one leaves it reversed.`,
        fields: {
          "Dispute ID": dispute.id,
          "Job ID": clawbackJob.id,
          "Reversed in total": `$${(clawback.reversedTotalCents / 100).toFixed(2)}`,
        },
        link: `https://dashboard.stripe.com/disputes/${dispute.id}`,
      });
    }
  }
}
