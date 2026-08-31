import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { getHelperFeePercent, DEFAULT_TIER_FEE_PERCENT } from "../_shared/helperFees.ts";
import { computeCancellationFee } from "../_shared/cancellationFee.ts";
import { actualOrEstimatedFeeCents } from "../_shared/stripeFees.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { loadAdminIds } from "../_shared/adminIds.ts";
import { formatPayoutDollars } from "../_shared/money.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Every path below that logs "money already moved but the DB write failed"
  // records here. Those are the worst defects this function can produce: Stripe
  // and Postgres disagree, and only a human can reconcile them.
  const defects = defectTracker();

  try {
    // Fail loud on missing config — previously masked by `?? ""` / `|| ""`
    // fallbacks below, which let the Stripe SDK constructor throw a generic
    // error outside the try block, producing a text/plain "Internal Server
    // Error" with no diagnostic context.
    const cronSecret = Deno.env.get("CRON_SECRET");
    const serviceRoleKey = Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    const missing: string[] = [];
    if (!supabaseUrl) missing.push("SUPABASE_URL");
    if (!stripeSecretKey) missing.push("STRIPE_SECRET_KEY");
    if (!serviceRoleKey) missing.push("SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY");
    if (missing.length) throw new Error(`Missing required env vars: ${missing.join(", ")}`);

    // Verify cron secret
    const authHeader = req.headers.get("Authorization");
    if (!authHeader || ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) && authHeader !== `Bearer ${serviceRoleKey}`)) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2025-08-27.basil",
    });

    /**
     * Flip a cancelled job out of escrow, once, after its money has settled.
     *
     * Every one of the four call sites used to be a bare
     * `.update({...}).eq("id", job.id)` with no `.select("id")` and no state
     * precondition. That is the house's most-cited bug class, and here it had
     * teeth beyond the usual: a zero-row match returns
     * `{ data: [], error: null }`, so the job stayed `cancelled/escrow`, the
     * counters (`refunded++`, `voided++`) incremented anyway, and the run
     * reported success. The HOURLY cron then re-selected the very same job on
     * its next pass — and the next, forever. Past Stripe's ~24h idempotency
     * window the permanent unsalted keys stop deduping, so the loop issues a
     * SECOND real refund to the poster and a SECOND real fee transfer to the
     * helper. The zero-row silence was the engine of a repeating double payout,
     * not merely a stale row.
     *
     * The precondition is `payment_status='escrow'` — the same predicate the
     * selection query uses — so a job a webhook has since flipped to
     * 'chargeback', or an operator has refunded by hand, is never overwritten.
     * Returns true only when a row actually moved, so the callers' counters can
     * finally mean what they say.
     *
     * Modelled on execute-dispute-split:879-885, the reference implementation
     * for "the money already moved, so this write is not allowed to be quiet".
     */
    const settleCancelledJob = async (
      job: { id: string; title: string },
      patch: Record<string, unknown>,
      stage: string,
    ): Promise<boolean> => {
      const { data, error: flipErr } = await supabaseAdmin
        .from("jobs")
        .update(patch)
        .eq("id", job.id)
        .eq("payment_status", "escrow")
        .select("id");
      if (!flipErr && data && data.length > 0) return true;

      const zeroRow = !flipErr;
      console.error(
        `CRITICAL: [void-cancelled-payments] job ${job.id} settled in Stripe (${stage}) but the status flip ${zeroRow ? "matched ZERO rows — payment_status is no longer 'escrow'" : `failed: ${flipErr?.message}`}. The job will be re-selected next hour; past Stripe's 24h idempotency window that means a SECOND real refund.`,
      );
      defects.record(
        `DB/Stripe divergence after ${stage} ${job.id}: ${zeroRow ? "zero rows matched" : flipErr?.message ?? "update failed"}`,
      );
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Cancelled job settled in Stripe but not in the database",
        message:
          `Money moved for job ${job.id} ("${job.title}") during ${stage}, but jobs.payment_status did not leave 'escrow'. The hourly cron will keep re-selecting this job, and past Stripe's ~24h idempotency window that produces a second real refund and a second fee transfer. Settle this row by hand before then.`,
        fields: {
          job_id: job.id,
          stage,
          reason: zeroRow ? "zero rows matched (payment_status changed under the run)" : (flipErr?.message ?? "update failed").slice(0, 200),
        },
      });
      return false;
    };

    // Transfer the cancellation fee (minus platform commission) to the helper.
    // Shared by BOTH settlement branches (captured-then-refunded AND
    // uncaptured-hold-partial-capture) so a helper is paid identically however
    // the escrow was held. Best-effort: a failed transfer notifies admins but
    // never throws — the customer's refund/capture has already succeeded and
    // must not be rolled back over a payout hiccup.
    const payHelperCancellationFee = async (
      job: { id: string; title: string; helper_id: string | null; helper_fee_percent?: number | string | null },
      cancellationFee: number,
      pi: Stripe.PaymentIntent,
    ) => {
      if (!(cancellationFee > 0) || !job.helper_id) return;
      // Resolve commission from the helper's live subscription tier. The
      // FALLBACK is what matters here: every other payout path
      // (create-payment, release-payout, process-scheduled-payouts,
      // execute-dispute-split) falls back to `job.helper_fee_percent` — the
      // rate frozen onto the job when escrow was funded — and only then to a
      // global rate. This one went straight to platform_settings, so a
      // transient profile-read failure priced a free helper's commission at
      // the settings rate (10% in prod) instead of their real 12%, quietly
      // under-charging the platform on the one path nobody watches. Prefer the
      // frozen per-job rate so a cancellation settles at the same percentage
      // the job was funded at.
      const { data: settings } = await supabaseAdmin
        .from("platform_settings")
        .select("helper_fee_percent")
        .limit(1)
        .single();
      const frozenPercent =
        job.helper_fee_percent === null || job.helper_fee_percent === undefined
          ? null
          : Number(job.helper_fee_percent);
      const commissionPercent = await getHelperFeePercent(
        supabaseAdmin,
        job.helper_id,
        (frozenPercent !== null && Number.isFinite(frozenPercent) ? frozenPercent : undefined) ??
          settings?.helper_fee_percent ??
          DEFAULT_TIER_FEE_PERCENT,
      );
      const platformCut = Math.round(cancellationFee * (commissionPercent / 100) * 100) / 100;
      const helperPayout = cancellationFee - platformCut;

      const { data: helperProfile, error: helperProfileErr } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", job.helper_id)
        .single();

      // A dropped read here would silently skip paying the helper their
      // cancellation fee (poster's fee is already captured), stranding the
      // money on the platform balance with no signal. Alert instead of skipping.
      if (helperProfileErr) {
        console.error(`[void-cancelled-payments] helper profile read failed for ${job.helper_id} (job ${job.id}):`, helperProfileErr);
            defects.record(`helper profile read ${job.id}: ${helperProfileErr.message}`);
        await postSlackOpsAlert({
          kind: "payout_failed",
          severity: "warning",
          title: "Cancellation-fee payout could not read helper account",
          message: "A helper's cancellation fee could not be paid because their payout account read failed. The poster's fee is already captured — reconcile manually.",
          fields: { job_id: job.id, helper_id: job.helper_id, amount: helperPayout, db_error: helperProfileErr.message },
        });
        return;
      }

      if (!helperProfile?.stripe_account_id || !(helperPayout > 0)) return;

      // ── Ledger guard: has this job's cancellation fee ALREADY been paid? ──
      // The idempotency key below is permanent and unsalted, which reads like a
      // guarantee and is not one: Stripe only replays a key for ~24h. Past that
      // window — and this loop re-selects a job forever whenever the status flip
      // at the end of the branch matches zero rows — the same key mints a SECOND
      // real transfer of the helper's fee.
      //
      // So ask Stripe what actually exists rather than trusting the key. The
      // transfer_group added below makes this lookup possible; it is the same
      // `job_${id}` grouping release-payout and process-scheduled-payouts
      // already use, so Dashboard reconciliation gains from it too.
      //
      // CAVEAT, deliberately accepted: fee transfers sent BEFORE this change
      // carry no transfer_group and cannot be found this way. The exposure is
      // narrow (only a job whose status flip failed AND whose fee went out more
      // than 24h ago), it shrinks to nothing as those jobs are reconciled, and
      // the alternative — scanning every transfer to the destination account —
      // costs a paginated Stripe scan on every cancellation forever.
      const feeGroup = `job_${job.id}`;
      try {
        const priorFeeTransfers = await stripe.transfers.list({ transfer_group: feeGroup, limit: 100 });
        const alreadyPaidFee = priorFeeTransfers.data.find(
          (t) => t.metadata?.type === "cancellation_fee" && !t.reversed,
        );
        if (alreadyPaidFee) {
          console.log(
            `[void-cancelled-payments] cancellation fee for job ${job.id} already transferred (${alreadyPaidFee.id}); not sending a second one.`,
          );
          return;
        }
      } catch (listErr) {
        // Fail CLOSED. Without knowing whether the fee already went out, sending
        // it is a coin flip on a second real transfer. Skipping costs a delay;
        // the job stays in escrow and the next hourly run retries.
        console.error(`[void-cancelled-payments] could not list prior fee transfers for job ${job.id}:`, listErr);
        defects.record(`fee-transfer dedupe list ${job.id}: ${(listErr as Error).message}`);
        return;
      }

      try {
        const transferParams: any = {
          amount: Math.round(helperPayout * 100),
          currency: "usd",
          destination: helperProfile.stripe_account_id,
          transfer_group: feeGroup,
          metadata: { job_id: job.id, helper_id: job.helper_id, type: "cancellation_fee", platform_cut: platformCut },
        };
        // Link to the source charge so the transfer draws from these funds.
        if (pi.latest_charge) {
          transferParams.source_transaction = typeof pi.latest_charge === "string"
            ? pi.latest_charge
            : pi.latest_charge.id;
        }
        // Idempotency key prevents double-payment if the cron overlaps or
        // retries before payment_status is flipped to "refunded".
        await stripe.transfers.create(transferParams, {
          idempotencyKey: `cancel-fee-${job.id}`,
        });
        console.log(`Cancellation fee $${cancellationFee}: platform kept $${platformCut}, transferred $${helperPayout} to helper ${job.helper_id} for job ${job.id}`);

        await supabaseAdmin.from("notifications").insert({
          user_id: job.helper_id,
          title: "Cancellation fee received",
          message: `You received a $${formatPayoutDollars(helperPayout)} cancellation fee for "${job.title}" (${commissionPercent}% commission deducted).`,
          type: "payment",
          link: "/earnings",
        });
      } catch (transferErr: any) {
        console.error(`Failed to transfer cancellation fee to helper ${job.helper_id}:`, transferErr);
        // Notify admins about the failed transfer
        const { ids: adminIds } = await loadAdminIds(supabaseAdmin, "void-cancelled-payments.feeTransferFailed");
        {
          for (const adminId of adminIds) {
            await supabaseAdmin.from("notifications").insert({
              user_id: adminId,
              title: "Cancellation fee transfer failed",
              message: `Failed to transfer $${cancellationFee.toFixed(2)} cancellation fee to helper for job ${job.id}. Error: ${transferErr.message}`,
              type: "warning",
              link: "/admin",
            });
          }
        }
      }
    };

    // ── Part A: Cancelled jobs still in escrow ──
    const { data: cancelledJobs, error } = await supabaseAdmin
      .from("jobs")
      .select("id, title, stripe_session_id, stripe_payment_intent_id, budget, customer_fee_amount, cancellation_fee, date_needed, cancelled_at, helper_id, customer_id, helper_fee_percent")
      .eq("status", "cancelled")
      .eq("payment_status", "escrow");

    if (error) throw error;

    // ── Part B: Abandoned checkouts — open jobs with unpaid status older than 1 hour ──
    const abandonedCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data: abandonedJobs, error: abErr } = await supabaseAdmin
      .from("jobs")
      .select("id, title, stripe_session_id")
      .eq("status", "open")
      .eq("payment_status", "unpaid")
      .not("stripe_session_id", "is", null)
      .lt("created_at", abandonedCutoff);

    if (abErr) throw abErr;

    // Clean up abandoned jobs — mark payment_status as "abandoned"
    let abandonedCount = 0;
    for (const job of (abandonedJobs || [])) {
      // Verify the Stripe session is actually expired/unpaid
      try {
        const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id!);
        if (session.payment_status === "unpaid") {
          // Precondition on 'unpaid': if the poster completed checkout between
          // the read above and this write, the job is now funded and marking it
          // abandoned would kill a live, PAID job. Zero rows is therefore a
          // legitimate outcome here, not a defect — it means the guard worked.
          const { data: abRows, error: abUpdateErr } = await supabaseAdmin
            .from("jobs")
            .update({ payment_status: "abandoned" })
            .eq("id", job.id)
            .eq("payment_status", "unpaid")
            .select("id");
          if (abUpdateErr) {
            console.error(`[void-cancelled-payments] failed to mark job ${job.id} abandoned (unpaid):`, abUpdateErr.message);
            defects.record(`mark abandoned (unpaid) ${job.id}: ${abUpdateErr.message}`);
          } else if ((abRows ?? []).length > 0) {
            abandonedCount++;
          } else {
            console.log(`[void-cancelled-payments] job ${job.id} was no longer 'unpaid' — not abandoning it.`);
          }
        }
      } catch (e) {
        // Only a genuinely-missing session (404 / resource_missing) proves the
        // checkout is gone and is safe to abandon. A transient Stripe error
        // (5xx, network, rate-limit) must NOT abandon a still-unpaid job —
        // otherwise a blip silently kills a live checkout. Log and leave it
        // for the next run, mirroring the void loop below.
        const missing = (e as any)?.statusCode === 404 || (e as any)?.code === "resource_missing";
        if (missing) {
          const { data: abMissingRows, error: abMissingErr } = await supabaseAdmin
            .from("jobs")
            .update({ payment_status: "abandoned" })
            .eq("id", job.id)
            .eq("payment_status", "unpaid")
            .select("id");
          if (abMissingErr) {
            console.error(`[void-cancelled-payments] failed to mark job ${job.id} abandoned (session 404):`, abMissingErr.message);
            defects.record(`mark abandoned (session 404) ${job.id}: ${abMissingErr.message}`);
          } else if ((abMissingRows ?? []).length > 0) {
            abandonedCount++;
          } else {
            console.log(`[void-cancelled-payments] job ${job.id} was no longer 'unpaid' — not abandoning it.`);
          }
        } else {
          console.error(`[void-cancelled-payments] abandoned-check Stripe error for job ${job.id}:`, (e as Error).message);
        }
      }
    }

    const jobs = cancelledJobs;

    let voided = 0;
    let refunded = 0;
    const results: any[] = [];

    for (const job of (jobs || [])) {
      let paymentIntentId = job.stripe_payment_intent_id;

      // Resolve payment intent from session if not stored
      if (!paymentIntentId && job.stripe_session_id) {
        try {
          const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id, {
            expand: ["payment_intent"],
          });
          const pi = session.payment_intent;
          paymentIntentId = typeof pi === "string" ? pi : pi?.id;
          if (paymentIntentId) {
            const { error: piBackfillErr } = await supabaseAdmin.from("jobs").update({ stripe_payment_intent_id: paymentIntentId }).eq("id", job.id);
            if (piBackfillErr) {
              console.error(`[void-cancelled-payments] failed to backfill stripe_payment_intent_id for job ${job.id}:`, piBackfillErr.message);
            defects.record(`PI backfill ${job.id}: ${piBackfillErr.message}`);
            }
          }
        } catch (e: any) {
          results.push({ job_id: job.id, title: job.title, status: "session_not_found", error: (e as Error).message });
          continue;
        }
      }

      if (!paymentIntentId) {
        // No payment was ever made — just update status. Guarded like the rest:
        // a zero-row match here means the job left 'escrow' under us, and
        // silently reporting it settled is what keeps it in the hourly loop.
        const updated = await settleCancelledJob(job, { payment_status: "cancelled" }, "no payment found");
        results.push({ job_id: job.id, title: job.title, status: "no_payment_found", updated });
        continue;
      }

      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
          expand: ["latest_charge.balance_transaction"],
        });

        if (pi.status === "requires_capture") {
          // Uncaptured authorization. RECOMPUTE the fee server-side from trusted
          // job fields (F-MONEY-32) — never trust the persisted, client-writable
          // `job.cancellation_fee`, which an assigned helper could inflate to
          // capture more of the poster's hold than the schedule allows.
          const cancellationFee = computeCancellationFee(job);
          if (cancellationFee > 0) {
            // Capture ONLY the fee — Stripe auto-releases the uncaptured
            // remainder (budget + customer fee) back to the poster. Charging
            // the fee here is what a bare cancel() previously skipped, silently
            // waiving every fee owed on an uncaptured hold.
            const feeCents = Math.round(cancellationFee * 100);
            await stripe.paymentIntents.capture(paymentIntentId, { amount_to_capture: feeCents });
            // Re-fetch so latest_charge is populated for the helper transfer's
            // source_transaction link.
            const captured = await stripe.paymentIntents.retrieve(paymentIntentId);
            await payHelperCancellationFee(job, cancellationFee, captured);
            const settledFee = await settleCancelledJob(job, {
              payment_status: "refunded",
              cancellation_fee_status: "charged",
            }, "fee capture");
            if (settledFee) refunded++;
            results.push({ job_id: job.id, title: job.title, status: settledFee ? "fee_captured" : "fee_captured_not_settled", cancellation_fee: cancellationFee });
          } else {
            // No fee owed — cancel the uncaptured hold in full; funds release to
            // the poster.
            await stripe.paymentIntents.cancel(paymentIntentId);
            const settledVoid = await settleCancelledJob(job, { payment_status: "cancelled" }, "PI cancel");
            if (settledVoid) voided++;
            results.push({ job_id: job.id, title: job.title, status: settledVoid ? "voided" : "voided_not_settled", amount: pi.amount / 100 });
          }
        } else if (pi.status === "succeeded") {
          // Already captured — refund the poster everything EXCEPT the fee owed.
          // RECOMPUTE the fee server-side from trusted job fields (F-MONEY-32);
          // never trust the persisted, client-writable `cancellation_fee`. The
          // tiered schedule is deterministic from budget + scheduled date +
          // cancel time, so this still equals the amount the poster was shown on
          // the "Cancel · pay $X" button (both derive from the same ladder),
          // while removing the ability for a helper to skim the refund.
          const cancellationFee = computeCancellationFee(job);
          // Refund the entire captured amount minus the cancellation fee AND the
          // non-refundable poster service fee.
          // pi.amount_received is what Stripe actually collected, which is
          // larger than job.budget when a customer service fee, sales tax,
          // urgent fee, or one-time onboarding fee was also charged at checkout.
          // Using job.budget alone left those amounts stranded on the platform
          // and never returned to the customer.
          const capturedCents = pi.amount_received ?? pi.amount;
          // Service fee is non-refundable: Stripe already took its cut on the
          // full capture and does NOT return it on a refund, so refunding the
          // whole (budget + fee) would leave the platform out-of-pocket by that
          // processing cost on every cancellation. We withhold the poster's
          // service fee, floored at Stripe's ACTUAL processing cost for this
          // specific charge (read from the balance transaction) so the platform
          // never loses money regardless of payment method — cards, Klarna/
          // Affirm/Afterpay, and ACH all carry different real rates.
          const serviceFeeCents = Math.round(Number(job.customer_fee_amount ?? 0) * 100);
          const nonRefundableCents = Math.max(serviceFeeCents, actualOrEstimatedFeeCents(pi, capturedCents));
          const refundAmount = capturedCents - Math.round(cancellationFee * 100) - nonRefundableCents;
          // ── Ledger guard against a SECOND real refund ────────────────────
          // The idempotency key below is permanent and unsalted. That protects
          // an overlapping run within Stripe's ~24h replay window and nothing
          // beyond it — and this loop selects on (status='cancelled',
          // payment_status='escrow'), so a job whose status flip matched zero
          // rows is re-selected every hour, forever. On the first run past 24h
          // the same key mints a brand-new refund and the poster is paid back
          // twice out of the platform's own money.
          //
          // `payment_refunds` is the ledger this path already writes, so ask it
          // first. Scoped to this source: an admin's separate partial refund on
          // the same job is a different fact and must not block the cancellation
          // settlement.
          const { data: priorRefunds, error: priorRefundErr } = await supabaseAdmin
            .from("payment_refunds")
            .select("stripe_refund_id")
            .eq("job_id", job.id)
            .eq("source", "void_cancelled_payments")
            .limit(1);
          if (priorRefundErr) {
            // Fail CLOSED: refunding without knowing whether we already did is
            // how the poster gets paid twice. Leave the job in escrow; the next
            // hourly run retries.
            console.error(`[void-cancelled-payments] prior-refund check failed for job ${job.id}:`, priorRefundErr);
            defects.record(`prior-refund check ${job.id}: ${priorRefundErr.message}`);
            results.push({ job_id: job.id, title: job.title, status: "refund_dedupe_read_failed", error: priorRefundErr.message });
            continue;
          }
          const alreadyRefunded = (priorRefunds ?? []).length > 0;

          if (refundAmount > 0 && !alreadyRefunded) {
            // Idempotency key still set: it is the cheap in-window guard against
            // two overlapping runs. The ledger check above is the one that holds
            // past 24 hours.
            const refund = await stripe.refunds.create(
              { payment_intent: paymentIntentId, amount: refundAmount },
              { idempotencyKey: `cancel-refund-${job.id}` },
            );
            // Ledger row (F-MONEY-04). Best-effort: the refund is already out,
            // so a ledger write failure is logged, not thrown. Upsert on the
            // Stripe refund id so a cron re-run doesn't duplicate the row.
            const { error: refundLedgerErr } = await supabaseAdmin.from("payment_refunds").upsert({
              job_id: job.id,
              customer_id: job.customer_id,
              stripe_refund_id: refund.id,
              stripe_payment_intent_id: paymentIntentId,
              amount_cents: Math.round(Number(refund.amount ?? refundAmount)),
              currency: refund.currency ?? "usd",
              is_partial: cancellationFee > 0 || nonRefundableCents > 0,
              reason: "cancellation refund (minus cancellation + service fee)",
              source: "void_cancelled_payments",
              initiated_by_user_id: null,
            }, { onConflict: "stripe_refund_id", ignoreDuplicates: true });
            if (refundLedgerErr) {
              console.error(`[void-cancelled-payments] refund ledger write failed for refund ${refund.id} (job ${job.id}); refund succeeded, reconcile manually:`, refundLedgerErr);
              defects.record(`refund ledger write ${job.id}: ${refundLedgerErr.message}`);
              // The refund already left Stripe, so we never throw — but a dropped
              // ledger row is a real Stripe↔ledger divergence a human must
              // reconcile, so surface it to ops rather than leaving it in a log.
              postSlackOpsAlert({
                kind: "custom",
                severity: "warning",
                title: "Refund ledger write failed",
                message: "A Stripe refund succeeded but its payment_refunds row was not written. Reconcile manually.",
                fields: {
                  refund_id: refund.id,
                  job_id: job.id,
                  source: "void_cancelled_payments",
                  amount_cents: Math.round(Number(refund.amount ?? refundAmount)),
                  db_error: refundLedgerErr.message,
                },
              });
            }
          } else if (alreadyRefunded) {
            // A refund for this cancellation is already on the ledger. Fall
            // through to the status flip so the job finally leaves escrow —
            // that flip failing is exactly how we ended up back here.
            console.log(
              `[void-cancelled-payments] job ${job.id} already has a cancellation refund on the ledger; settling status only.`,
            );
          } else {
            // The cancellation fee + non-refundable service fee consumed the
            // whole capture, so the poster gets $0 back while the job still
            // settles to refunded below. No ledger row is written in this branch,
            // so — like the cancel_escrow path — this must NEVER pass silently:
            // it can be legitimate (a big late-cancel fee) or bad data (a
            // stale/oversized customer_fee_amount, or a degenerate capturedCents).
            // Alert ops with the inputs so a human can reconcile.
            console.error(
              `[void-cancelled-payments] refundAmount<=0 for job ${job.id} ` +
                `(capturedCents=${capturedCents}, cancellationFeeCents=${Math.round(cancellationFee * 100)}, ` +
                `nonRefundableCents=${nonRefundableCents}) — poster refunded $0.`,
            );
            const suspicious =
              !Number.isFinite(capturedCents) || capturedCents <= 0;
            postSlackOpsAlert({
              kind: "custom",
              severity: suspicious ? "warning" : "info",
              title: "Escrow cancellation resolved with $0 refund",
              message:
                "A cron settlement returned nothing to the poster after withholding the cancellation + service fee. Verify this was intended.",
              fields: {
                job_id: job.id,
                payment_intent: paymentIntentId,
                captured_cents: capturedCents,
                cancellation_fee_cents: Math.round(cancellationFee * 100),
                non_refundable_cents: nonRefundableCents,
                refund_amount: refundAmount,
              },
            });
          }

          // Transfer the agreed fee to the helper (minus platform commission).
          await payHelperCancellationFee(job, cancellationFee, pi);

          const settledRefund = await settleCancelledJob(job, {
            payment_status: "refunded",
            cancellation_fee_status: cancellationFee > 0 ? "charged" : null,
          }, "refund");
          if (settledRefund) refunded++;
          results.push({
            job_id: job.id,
            title: job.title,
            status: settledRefund ? (refundAmount > 0 ? "refunded" : "zero_refund") : "refunded_not_settled",
            amount: Math.max(0, refundAmount) / 100,
            cancellation_fee_transferred: cancellationFee > 0,
          });
        } else {
          results.push({ job_id: job.id, title: job.title, status: `pi_status_${pi.status}`, skipped: true });
        }
      } catch (e: any) {
        // Handle "already refunded" gracefully
        if (e.message?.includes("already been refunded")) {
          const settledAlready = await settleCancelledJob(job, { payment_status: "refunded" }, "already-refunded");
          if (settledAlready) refunded++;
          results.push({ job_id: job.id, title: job.title, status: settledAlready ? "already_refunded" : "already_refunded_not_settled" });
        } else {
          results.push({ job_id: job.id, title: job.title, status: "error", error: e.message });
        }
      }
    }

    return cronResult(
      "void-cancelled-payments",
      { success: true, voided, refunded, abandoned: abandonedCount, total: jobs?.length || 0, results },
      defects.defects,
      corsHeaders,
    );
  } catch (error) {
    console.error("[void-cancelled-payments] fatal:", error);
    return cronError("void-cancelled-payments", "Internal server error", corsHeaders);
  }
});
