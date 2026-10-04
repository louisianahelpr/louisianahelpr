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
import { formatExactDollars } from "../../_shared/money.ts";
import { alertPartialGiftRefund, revokeGiftCardForRefund } from "./_giftCardRefund.ts";
import { giftAtStake, payoutOnJob, restoreGiftForRefundedJob } from "./_giftCardRestore.ts";

/**
 * Q1208 (3): when a full refund closes a decided dispute that gave the Helpr a
 * share, the job's gift card still comes back to the poster WHOLE (the restore
 * below runs on 'closed'), so the person deciding whether to pay the Helpr
 * must know the gift's share is not held either.
 */
const GIFT_GOES_BACK_WHOLE =
  "Any gift card that paid part of this job is given back to the poster in full, so the Helpr's share of the gift is not held either.";

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
  { stripe, supabase, logStep }: WebhookContext,
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
  // Q1193: a webhook's Charge is the minimal form and never carries `refunds`
  // (a Charge dropped it in API version 2022-11-15, and webhook objects are not
  // expanded), so reading charge.refunds left latestRefund undefined on every
  // current-version delivery: no payment_refunds ledger row, and an
  // onboarding-fee correction never recognised. The refunds are listed from
  // Stripe instead, ONCE per delivery (the decided-dispute close below reuses
  // the same list). A failed list throws before anything is written, so Stripe
  // redelivers: a silent skip would misread a correction as an ordinary refund.
  let listed: Promise<Stripe.Refund[]> | null = null;
  const listChargeRefunds = (): Promise<Stripe.Refund[]> => {
    listed ??= (async () => {
      try {
        const list = await stripe.refunds.list({ charge: charge.id, limit: 100 });
        return (list?.data ?? []) as Stripe.Refund[];
      } catch (e) {
        throw new Error(`Could not list the refunds on charge ${charge.id}: ${String(e)}`);
      }
    })();
    return listed;
  };
  // The onboarding-fee correction refund is created with
  // metadata.reason = "duplicate_onboarding_fee" on the Refund object itself,
  // NOT on the parent Charge. Read from the latest refund (newest first in
  // Stripe's reverse-chronological list) to correctly detect it. An event that
  // does carry refunds (an older API version) is used as it is.
  const latestRefund: Stripe.Refund | undefined = charge.refunds?.data?.[0] ?? (await listChargeRefunds())[0];
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
      .select("id, customer_id, helper_id, title, payment_status")
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
      // Whether the job ends this webhook 'refunded' (this flip, another
      // path's own flip, or a redelivery): the Q450 close below needs it.
      let nowRefunded = priorStatus === "refunded";
      // Q454: one sentence for the card holder's notice when this event gave
      // their gift card back.
      let giftSentence = "";
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
        if (!flipErr && ((flipped?.length ?? 0) > 0 || nowStatus === "refunded")) nowRefunded = true;
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

      // Q450: a full refund made OUTSIDE the split (the Stripe Dashboard) on a
      // job whose dispute is decided but whose split never ran. The split runs
      // only from escrow/payout_pending, so the decision could never execute
      // and stayed 'pending' forever. Closed here, before the ledger row and
      // the notice, so a throw (Stripe redelivers) repeats nothing visible.
      if (nowRefunded) {
        const decided = await closeDecidedDisputeOnExternalRefund(
          { supabase, logStep },
          charge,
          listChargeRefunds,
          {
            id: String(refundedJob.id),
            title: (refundedJob as { title?: string | null }).title ?? null,
            helper_id: (refundedJob as { helper_id?: string | null }).helper_id ?? null,
          },
        );
        // Q454: the job is refunded in full, so the gift card that paid part of
        // it comes back whole (on a partly gift-funded job this PaymentIntent
        // was only the shortfall). NOT while a decided dispute owns the escrow
        // (its decision splits the gift: the close above paged a person, or the
        // split restores its own share), and NOT when a payout already moved
        // out of this escrow (a person decides; review MEDIUM). Before the
        // ledger row and the notice, so a throw (Stripe redelivers) repeats
        // nothing visible; the restore is idempotent.
        // Q1208 (1): only when a gift is still at stake on this job; a
        // card-only job's refund after a reversed payout paged about a gift
        // that never was.
        const stake = (decided === "no_unsettled_dispute" || decided === "closed")
          ? await giftAtStake(supabase, String(refundedJob.id))
          : { atStake: false };
        if (stake.readError) {
          throw new Error(`Gift read failed before the gift restore on refunded job ${refundedJob.id}: ${stake.readError}`);
        }
        if (stake.atStake) {
          const payout = await payoutOnJob(supabase, String(refundedJob.id));
          if (payout.readError) {
            throw new Error(`Payout read failed before the gift restore on refunded job ${refundedJob.id}: ${payout.readError}`);
          }
          if (payout.transferId) {
            await postSlackOpsAlert({
              kind: "money_at_risk",
              severity: "critical",
              title: "Full refund on a job with a payout transfer — gift card NOT returned",
              message: `Charge ${charge.id} refunded job ${refundedJob.id} in full, but payout transfer ${payout.transferId} already moved money out of this escrow toward a Helpr, so any gift card that paid part of the job was NOT given back automatically. Reconcile the payout against the refund, then restore the gift by hand if it is owed.`,
              fields: { "Job ID": String(refundedJob.id), "Payment Intent": refundPiId, "Transfer": payout.transferId },
              oncePerDayKey: `refund-gift-payout-exists:${refundedJob.id}`,
            });
          } else {
            const giftBack = await restoreGiftForRefundedJob(supabase, String(refundedJob.id));
            if (!giftBack.ok) {
              await postSlackOpsAlert({
                kind: "money_at_risk",
                severity: "critical",
                title: "Full refund — the poster's gift card was NOT returned",
                message: `Charge ${charge.id} refunded job ${refundedJob.id} in full, but the gift card that paid part of it could not be given back. Stripe will retry this webhook; if retries exhaust, restore the gift by hand (restore_gift_card_for_job for this job).`,
                fields: { "Job ID": String(refundedJob.id), "Payment Intent": refundPiId, "Reason": giftBack.reason.slice(0, 200) },
                oncePerDayKey: `refund-gift-restore-failed:${refundedJob.id}`,
              });
              throw new Error(`Gift restore failed for refunded job ${refundedJob.id}: ${giftBack.reason}`);
            }
            if (giftBack.outcome === "restored" || giftBack.outcome === "unreserved") {
              logStep("Full refund returned the job's gift card", { jobId: refundedJob.id, outcome: giftBack.outcome });
            }
            // Announced only when THIS call minted a gift that can be spent
            // (a revoked donation's replacement cannot).
            if (giftBack.outcome === "restored" && giftBack.spendable && giftBack.restoreCents > 0) {
              giftSentence = ` The $${formatExactDollars(giftBack.restoreCents / 100)} your gift card paid is back as a gift you can use on another job.`;
            }
          }
        }
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
              // This refund's own amount, not the charge's running total: on a
              // charge refunded in steps the total would count the earlier
              // refunds twice (lh-money-escrow review of Q1193, must-fix 2).
              amount_cents: latestRefund.amount,
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
        message: `Your payment for "${refundedJob.title}" has been refunded.${giftSentence}`,
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

/**
 * Execution states of a decided dispute whose money has not moved: a single
 * Helpr split not yet run (null / pending / executing / failed), or a crew
 * decision (20260927012240) that process-scheduled-payouts' per-member fan-out
 * settles. The crew one is never CLOSED here (settle_dispute_by_external_refund
 * does not read it), but it is read: the fan-out selects only payout_pending
 * jobs, so a fully refunded crew job would leave its decided members owed with
 * no signal (lh-money-escrow review, MEDIUM), and it is handed to a person.
 */
const UNEXECUTED_DECISION_FILTER = "execution_status.is.null,execution_status.in.(pending,executing,failed,crew_fanout)";

/**
 * Q450: a FULL refund made outside execute-dispute-split settles a
 * decided-but-unexecuted dispute.
 *
 * rpc_decide_dispute leaves execution_status 'pending' until the split moves
 * the money, and the split's first attempt runs only from escrow /
 * payout_pending; a resume refuses over a refund it did not make. So a full
 * refund from the Stripe Dashboard (this handler flips the job 'refunded')
 * left the decision with nothing to split and no terminal state, paging the
 * unsettled-dispute detectors forever.
 *
 * Keyed on WHO refunded: every refund execute-dispute-split creates carries
 * metadata.dispute_id, and its own 100/0 split also fires charge.refunded, so
 * a refund with that metadata is the split's to close (closing it here would
 * race its claim). Only when every live refund on the charge came from
 * outside the split does settle_dispute_by_external_refund close the record,
 * and only when nothing else is owed or moved (it answers needs_human for a
 * partial refund, a gift card, money a split already moved, a dead claim;
 * 'busy' for a run in flight, which throws so Stripe redelivers once it ends).
 * A DB or Stripe read failure throws too, before anything is written.
 */
async function closeDecidedDisputeOnExternalRefund(
  { supabase, logStep }: Pick<WebhookContext, "supabase" | "logStep">,
  charge: Stripe.Charge,
  listChargeRefunds: () => Promise<Stripe.Refund[]>,
  job: { id: string; title: string | null; helper_id: string | null },
): Promise<string> {
  // Cheap, and first: most refunded jobs have no decided dispute, and they
  // must not pay for a Stripe round trip.
  const { data: waiting, error: waitErr } = await supabase
    .from("disputes")
    .select("id, execution_status")
    .eq("job_id", job.id)
    .eq("status", "decided")
    .or(UNEXECUTED_DECISION_FILTER)
    .limit(5);
  if (waitErr) {
    throw new Error(`Decided-dispute read failed for refunded job ${job.id}: ${waitErr.message}`);
  }
  const decisions = (waiting ?? []) as Array<{ id: string; execution_status: string | null }>;
  if (decisions.length === 0) return "no_unsettled_dispute";
  const crew = decisions.find((d) => d.execution_status === "crew_fanout");
  const decidedId = (crew ?? decisions[0]).id;

  const noticeAdmins = async (title: string, message: string) => {
    const { ids } = await loadAdminIds(supabase, "stripe-webhook.chargeRefunded.decidedDispute");
    for (const adminId of ids) {
      const { error: noticeErr } = await supabase.from("notifications").insert({
        user_id: adminId, job_id: job.id, title, message, type: "warning",
        link: `/admin?view=jobs&job=${job.id}`,
      });
      if (noticeErr) logStep("Decided-dispute admin notice failed", { adminId, error: noticeErr.message });
    }
  };
  const handBack = async (reason: string, split: string) => {
    await noticeAdmins(
      "Full refund on a decided dispute — settle it by hand",
      `The payment for "${job.title ?? "a job"}" was refunded in full while its decided split (${split}) had not run, and the dispute could not be closed automatically: ${reason}.`,
    );
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "Full refund on a decided dispute — settle it by hand",
      message: `Charge ${charge.id} was refunded in full on a job whose decided split (${split}) has not run, and the dispute could not be closed automatically: ${reason}. The split cannot run on a refunded job; reconcile against Stripe and close the dispute by hand.`,
      fields: { "Charge": charge.id, "Job ID": job.id, "Internal dispute": decidedId, "Decided split": split },
      oncePerDayKey: `refund-decided-needs-human:${job.id}`,
    });
  };

  if (crew) {
    // A crew decision is settled member by member by process-scheduled-payouts'
    // fan-out, which reads only payout_pending jobs: on a refunded job it never
    // runs, and the members the decision paid were told their share was coming.
    // Never closed automatically (the members' owed shares are a person's
    // call); handed to one, before any Stripe read.
    await handBack(
      "it is a crew decision, settled member by member by the payout fan-out, which never runs on a refunded job; the members it pays are still owed",
      "a crew decision",
    );
    return "needs_human";
  }

  // Whose refunds made the charge whole. Read from Stripe: a webhook carries
  // the Charge in its minimal form, and `refunds` is not included on current
  // API versions (2022-11-15 stopped expanding it).
  // (The same list the handler read for its own ledger row: one Stripe call.)
  const refunds = await listChargeRefunds();
  const live = refunds.filter((r) => r.status !== "failed" && r.status !== "canceled");
  const splitOf = (r: Stripe.Refund) => String((r.metadata as Record<string, string> | null)?.dispute_id ?? "");
  const bySplit = live.filter((r) => splitOf(r) !== "");
  const outside = live.filter((r) => splitOf(r) === "");

  if (bySplit.length > 0) {
    if (outside.length === 0 && bySplit.every((r) => splitOf(r) === decidedId)) {
      // The split's own refund (a 100/0 split): it records its own settlement.
      logStep("Full refund is the decided split's own; the split closes its dispute", { jobId: job.id, disputeId: decidedId });
      return "split_refund";
    }
    await handBack(
      outside.length > 0
        ? "the charge carries both the split's refund and a refund made outside it"
        : "the charge carries another dispute's split refund",
      "—",
    );
    return "needs_human";
  }

  const { data, error } = await supabase.rpc("settle_dispute_by_external_refund", {
    _job_id: job.id,
    _stripe_charge_id: charge.id,
    _refunded_cents: charge.amount_refunded,
    _charge_cents: charge.amount,
  });
  if (error?.code === "PGRST202") {
    // Not deployed yet: the old behaviour (left pending), said out loud.
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "Full refund on a decided dispute — close not deployed yet",
      message: `Charge ${charge.id} was refunded in full on a job whose decided split has not run. settle_dispute_by_external_refund is not deployed, so close dispute ${decidedId} by hand.`,
      fields: { "Charge": charge.id, "Job ID": job.id, "Internal dispute": decidedId },
    });
    return "not_deployed";
  }
  if (error) {
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: "critical",
      title: "Full refund on a decided dispute — dispute NOT closed (DB error)",
      message: `Charge ${charge.id} was refunded in full, but closing the job's decided-but-unexecuted dispute failed. Stripe will retry this webhook.`,
      fields: { "Charge": charge.id, "Job ID": job.id, "DB error": error.message.slice(0, 200) },
      oncePerDayKey: `refund-decided-close-failed:${job.id}`,
    });
    throw new Error(`settle_dispute_by_external_refund failed for job ${job.id}: ${error.message}`);
  }
  const res = (data ?? null) as
    | { outcome?: string; dispute_id?: string; reason?: string; payout_split?: { poster?: number; helper?: number } | null }
    | null;
  const outcome = res?.outcome;
  if (outcome === "no_unsettled_dispute") return outcome;
  if (outcome === "busy") {
    // A split run or a settlement claim is live this minute. Nothing was
    // written; the redelivery finds it finished (or dead, which then pages).
    throw new Error(`Decided dispute on job ${job.id} is being settled right now; retry the full-refund close later`);
  }
  const split = res?.payout_split
    ? `poster ${Math.round((res.payout_split.poster ?? 0) * 100)}% / Helpr ${Math.round((res.payout_split.helper ?? 0) * 100)}%`
    : "—";
  if (outcome === "closed") {
    const helperShare = res?.payout_split?.helper ?? 0;
    logStep("Full refund closed a decided, unexecuted dispute", { jobId: job.id, disputeId: res?.dispute_id });
    if (helperShare > 0) {
      await noticeAdmins(
        "Full refund on a decided dispute — decided Helpr share unpaid",
        `The payment for "${job.title ?? "a job"}" was refunded in full, so its decided split (${split}) was closed with nothing paid to the Helpr. The decision gave the Helpr a share the platform no longer holds: decide whether to pay it. ${GIFT_GOES_BACK_WHOLE}`,
      );
      if (job.helper_id) {
        // Its own insert, not the clawback's notifyPayee: that one pages a
        // failed notice as a card-dispute clawback, which this is not.
        const { error: helperNoteErr } = await supabase.from("notifications").insert({
          user_id: job.helper_id,
          job_id: job.id,
          title: "Dispute closed: the payment was refunded",
          message: `The payment for "${job.title ?? "a job"}" was refunded in full to the card holder, so the decided split could not be paid and no payout was made for this job. Contact support about next steps.`,
          type: "payment",
          link: `/jobs?job=${job.id}`,
        });
        if (helperNoteErr) {
          await postSlackOpsAlert({
            kind: "money_at_risk",
            severity: "warning",
            title: "Full refund on a decided dispute — Helpr notice NOT sent",
            message: `Charge ${charge.id} closed the decided dispute on job ${job.id}, but the in-app notice telling the Helpr their decided share was not paid failed to insert. Tell them by hand.`,
            fields: { "Charge": charge.id, "Job ID": job.id, "User": job.helper_id, "DB error": helperNoteErr.message.slice(0, 200) },
            oncePerDayKey: `refund-decided-helper-notice:${job.id}`,
          });
        }
      }
    }
    await postSlackOpsAlert({
      kind: "money_at_risk",
      // A decided Helpr share the platform no longer holds is money a person
      // must decide on: critical then (review LOW-7), a warning otherwise.
      severity: helperShare > 0 ? "critical" : "warning",
      title: "Full refund on a decided dispute — dispute closed, nothing left to split",
      message: `Charge ${charge.id} was refunded in full outside the split, so the job's decided split (${split}) had not run and now never will: it is recorded as settled with the refund as the poster's share.${helperShare > 0 ? ` The decision gave the Helpr a share that the platform no longer holds; decide by hand whether to pay it. ${GIFT_GOES_BACK_WHOLE}` : ""}`,
      fields: { "Charge": charge.id, "Job ID": job.id, "Internal dispute": res?.dispute_id ?? "—", "Decided split": split },
    });
    return "closed";
  }
  // 'needs_human', or an answer this code does not know: page, never guess.
  await handBack(res?.reason ?? `unexpected answer ${JSON.stringify(res)}`, split);
  return "needs_human";
}
