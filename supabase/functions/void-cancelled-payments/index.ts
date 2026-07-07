import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { getHelperFeePercent } from "../_shared/helperFees.ts";
import { computeCancellationFee } from "../_shared/cancellationFee.ts";
import { stripeProcessingCostCents } from "../_shared/stripeFees.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

    // Transfer the cancellation fee (minus platform commission) to the helper.
    // Shared by BOTH settlement branches (captured-then-refunded AND
    // uncaptured-hold-partial-capture) so a helper is paid identically however
    // the escrow was held. Best-effort: a failed transfer notifies admins but
    // never throws — the customer's refund/capture has already succeeded and
    // must not be rolled back over a payout hiccup.
    const payHelperCancellationFee = async (
      job: { id: string; title: string; helper_id: string | null },
      cancellationFee: number,
      pi: Stripe.PaymentIntent,
    ) => {
      if (!(cancellationFee > 0) || !job.helper_id) return;
      // Resolve commission from the helper's live subscription tier; fall back
      // to the platform-settings rate if the profile read fails.
      const { data: settings } = await supabaseAdmin
        .from("platform_settings")
        .select("helper_fee_percent")
        .limit(1)
        .single();
      const commissionPercent = await getHelperFeePercent(
        supabaseAdmin,
        job.helper_id,
        settings?.helper_fee_percent ?? 10,
      );
      const platformCut = Math.round(cancellationFee * (commissionPercent / 100) * 100) / 100;
      const helperPayout = cancellationFee - platformCut;

      const { data: helperProfile } = await supabaseAdmin
        .from("profiles")
        .select("stripe_account_id")
        .eq("user_id", job.helper_id)
        .single();

      if (!helperProfile?.stripe_account_id || !(helperPayout > 0)) return;
      try {
        const transferParams: any = {
          amount: Math.round(helperPayout * 100),
          currency: "usd",
          destination: helperProfile.stripe_account_id,
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
          message: `You received a $${helperPayout.toFixed(2)} cancellation fee for "${job.title}" (${commissionPercent}% commission deducted).`,
          type: "payment",
          link: "/earnings",
        });
      } catch (transferErr: any) {
        console.error(`Failed to transfer cancellation fee to helper ${job.helper_id}:`, transferErr);
        // Notify admins about the failed transfer
        const { data: adminRoles } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
        if (adminRoles) {
          for (const admin of adminRoles) {
            await supabaseAdmin.from("notifications").insert({
              user_id: admin.user_id,
              title: "⚠️ Cancellation fee transfer failed",
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
      .select("id, title, stripe_session_id, stripe_payment_intent_id, budget, customer_fee_amount, cancellation_fee, date_needed, cancelled_at, helper_id, customer_id")
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
          await supabaseAdmin.from("jobs").update({ payment_status: "abandoned" }).eq("id", job.id);
          abandonedCount++;
        }
      } catch (e: any) {
        // Only treat a confirmed 404 / resource_missing as "session is gone —
        // mark abandoned". A transient network error, a rate-limit 429, or any
        // other Stripe API error must NOT silently flip a live checkout to
        // "abandoned" — that would make an active session un-payable with no
        // recovery path.
        if (e?.statusCode === 404 || e?.code === "resource_missing") {
          await supabaseAdmin.from("jobs").update({ payment_status: "abandoned" }).eq("id", job.id);
          abandonedCount++;
        } else {
          console.error(`[void-cancelled-payments] unexpected error retrieving session ${job.stripe_session_id} for job ${job.id}:`, e);
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
            await supabaseAdmin.from("jobs").update({ stripe_payment_intent_id: paymentIntentId }).eq("id", job.id);
          }
        } catch (e) {
          results.push({ job_id: job.id, title: job.title, status: "session_not_found", error: e.message });
          continue;
        }
      }

      if (!paymentIntentId) {
        // No payment was ever made — just update status
        await supabaseAdmin.from("jobs").update({ payment_status: "cancelled" }).eq("id", job.id);
        results.push({ job_id: job.id, title: job.title, status: "no_payment_found", updated: true });
        continue;
      }

      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

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
            await supabaseAdmin.from("jobs").update({
              payment_status: "refunded",
              cancellation_fee_status: "charged",
            }).eq("id", job.id);
            refunded++;
            results.push({ job_id: job.id, title: job.title, status: "fee_captured", cancellation_fee: cancellationFee });
          } else {
            // No fee owed — cancel the uncaptured hold in full; funds release to
            // the poster.
            await stripe.paymentIntents.cancel(paymentIntentId);
            await supabaseAdmin.from("jobs").update({ payment_status: "cancelled" }).eq("id", job.id);
            voided++;
            results.push({ job_id: job.id, title: job.title, status: "voided", amount: pi.amount / 100 });
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
          // Service fee is non-refundable: Stripe already took 2.9%+$0.30 on the
          // full capture and does NOT return it on a refund, so refunding the
          // whole (budget + fee) would leave the platform out-of-pocket by that
          // processing cost on every cancellation. We withhold the poster's
          // service fee, floored at Stripe's actual processing cost so the
          // platform never loses money to fees even on a job whose service fee
          // is tiny (or missing on legacy/accept_bids rows).
          const serviceFeeCents = Math.round(Number(job.customer_fee_amount ?? 0) * 100);
          const nonRefundableCents = Math.max(serviceFeeCents, stripeProcessingCostCents(capturedCents));
          const refundAmount = capturedCents - Math.round(cancellationFee * 100) - nonRefundableCents;
          if (refundAmount > 0) {
            // Idempotency key prevents a double-refund if the cron overlaps or
            // retries before the payment_status flip at the end of this block.
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

          await supabaseAdmin.from("jobs").update({
            payment_status: "refunded",
            cancellation_fee_status: cancellationFee > 0 ? "charged" : null,
          }).eq("id", job.id);
          refunded++;
          results.push({ job_id: job.id, title: job.title, status: refundAmount > 0 ? "refunded" : "zero_refund", amount: Math.max(0, refundAmount) / 100, cancellation_fee_transferred: cancellationFee > 0 });
        } else {
          results.push({ job_id: job.id, title: job.title, status: `pi_status_${pi.status}`, skipped: true });
        }
      } catch (e: any) {
        // Handle "already refunded" gracefully
        if (e.message?.includes("already been refunded")) {
          await supabaseAdmin.from("jobs").update({ payment_status: "refunded" }).eq("id", job.id);
          refunded++;
          results.push({ job_id: job.id, title: job.title, status: "already_refunded" });
        } else {
          results.push({ job_id: job.id, title: job.title, status: "error", error: e.message });
        }
      }
    }

    return new Response(JSON.stringify({ success: true, voided, refunded, abandoned: abandonedCount, total: jobs?.length || 0, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error("[void-cancelled-payments] fatal:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        detail: (error as Error).message,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
