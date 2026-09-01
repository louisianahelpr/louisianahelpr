import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { loadAdminIds } from "../_shared/adminIds.ts";
import { cronError, cronResult, defectTracker } from "../_shared/cron-result.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Verify cron secret
  const cronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || ((!cronSecret || authHeader !== `Bearer ${cronSecret}`) && (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`))) {
    return new Response("Unauthorized", { status: 401, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"))!
    );

    // Fail loud on a missing key rather than passing "" to the SDK, which the
    // constructor accepts and only throws on later — an undiagnosable generic
    // error. Matches auto-release-payment's upfront config check.
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) throw new Error("Missing required env var: STRIPE_SECRET_KEY");
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2025-08-27.basil",
    });

    // Find disputed jobs past their 72-hour deadline
    const { data: expiredDisputes, error: fetchErr } = await supabase
      .from("jobs")
      .select("id, title, helper_id, customer_id, budget, dispute_reason, disputed_at, dispute_deadline, dispute_status, payment_status, stripe_payment_intent_id, stripe_session_id")
      .eq("status", "disputed")
      .not("dispute_deadline", "is", null)
      .lte("dispute_deadline", new Date().toISOString());

    if (fetchErr) throw fetchErr;

    const resolved: string[] = [];
    const defects = defectTracker();

    for (const job of expiredDisputes || []) {
      const disputeStatus = job.dispute_status || "open";

      // If escalated to admin, don't auto-resolve — admin must handle it
      if (disputeStatus === "escalated") {
        // Just send a reminder to admins
        const { ids: escalatedAdminIds } = await loadAdminIds(supabase, "auto-resolve-disputes.escalated");
        {
          for (const adminId of escalatedAdminIds) {
            const { error: notifErr } = await supabase.from("notifications").insert({
              user_id: adminId,
              title: "Escalated dispute overdue",
              message: `"${job.title}" dispute was escalated and is past its 72h deadline. Please resolve ASAP.`,
              type: "warning",
              link: "/admin",
            });
            if (notifErr) {
              console.error(`[auto-resolve-disputes] escalation reminder insert failed for admin ${adminId}, job ${job.id}:`, notifErr);
              // An overdue dispute whose reminder never lands is a dispute
              // nobody is watching.
              defects.record(`escalation reminder admin ${adminId} job ${job.id}: ${notifErr.message}`);
            }
          }
        }
        continue;
      }

      // ── Fail closed: verify the escrow charge actually succeeded before
      // promising the helper a payout. Auto-resolving a dispute flips the job
      // to payout_pending, which process-scheduled-payouts / auto-release-payment
      // Phase 2 then pays out for real. Without this check a dispute on a job
      // whose PI never captured (or was charged back) would auto-release real
      // money against unfunded escrow. Mirrors auto-release-payment's Step 2. ──
      let paymentIntentId = job.stripe_payment_intent_id as string | null;
      if (!paymentIntentId && job.stripe_session_id) {
        try {
          const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id, { expand: ["payment_intent"] });
          paymentIntentId = typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id ?? null;
        } catch (e) {
          console.error(`[auto-resolve-disputes] failed to retrieve session for job ${job.id}:`, e);
          defects.record(`session retrieve ${job.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (!paymentIntentId) {
        console.error(`[auto-resolve-disputes] no payment intent for job ${job.id} — cannot auto-release, leaving for admin`);
        continue;
      }
      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (pi.status !== "succeeded") {
          console.error(`[auto-resolve-disputes] PI ${paymentIntentId} for job ${job.id} status "${pi.status}" — not auto-releasing`);
          continue;
        }
      } catch (e) {
        console.error(`[auto-resolve-disputes] failed to verify PI for job ${job.id}:`, e);
        defects.record(`PI verify ${job.id}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      // Non-escalated: auto-release payment to helper.
      // Also flip payment_status to 'payout_pending' so the auto-release-payment
      // cron's Phase 2 (release-payout invocation, gated on RELEASE_PAYOUT_AUTO=1)
      // actually moves the money. Without this, the job sat in escrow forever
      // and the helper got a "payment released" notification that wasn't true.
      //
      // Optimistic concurrency: guard on payment_status="escrow" so a chargeback
      // webhook that fires between our read and this write (flipping the job to
      // "chargeback"/"refunded") isn't blindly overwritten with "payout_pending".
      const { data: claimed, error: updateErr } = await supabase
        .from("jobs")
        .update({
          status: "completed",
          payment_status: "payout_pending",
          // +24h hold before the payout actually fires — a chargeback buffer,
          // matching auto-release-payment. now() would make the job eligible on
          // the very next payout cron tick with no safety window.
          payout_scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          dispute_status: "auto_resolved",
          dispute_resolved_at: new Date().toISOString(),
          dispute_reason: `[AUTO-RESOLVED] Original: ${job.dispute_reason || "N/A"}. Dispute expired after 72 hours without resolution. Payment released to helper.`,
        })
        .eq("id", job.id)
        .eq("payment_status", "escrow")
        .select("id");

      if (updateErr) {
        console.error(`Failed to resolve dispute for job ${job.id}:`, updateErr);
        continue;
      }
      if (!claimed || claimed.length === 0) {
        console.log(`[auto-resolve-disputes] job ${job.id} payment_status changed since read (chargeback/refund race); skipping.`);
        continue;
      }

      // Notify both parties
      const notifications = [];

      if (job.helper_id) {
        notifications.push({
          user_id: job.helper_id,
          title: "Dispute auto-resolved",
          message: `The dispute on "${job.title}" expired after 72 hours without the poster resolving or escalating. Payment will be released to you.`,
          type: "payment",
          // `?job=`, not `?filter=completed` — `completed` is a legacy key with
          // no chip (the bucket is `done`), and the job may still be settling.
          link: `/my-jobs?job=${job.id}`,
        });
      }

      notifications.push({
        user_id: job.customer_id,
        title: "Dispute auto-resolved",
        message: `The dispute on "${job.title}" was not resolved or escalated within 72 hours. Per platform policy, payment has been released to the helpr.`,
        type: "warning",
        link: `/my-posts?job=${job.id}`,
      });

      // Notify admins
      const { ids: autoResolvedAdminIds } = await loadAdminIds(supabase, "auto-resolve-disputes.autoResolved");

      {
        for (const adminId of autoResolvedAdminIds) {
          notifications.push({
            user_id: adminId,
            title: "Dispute auto-resolved",
            message: `Dispute on "${job.title}" expired without poster action. Payment auto-released to helpr.`,
            type: "warning",
            link: "/admin",
          });
        }
      }

      if (notifications.length > 0) {
        const { error: notifErr } = await supabase.from("notifications").insert(notifications);
        if (notifErr) {
          console.error(`[auto-resolve-disputes] resolution notifications insert failed for job ${job.id}:`, notifErr);
          defects.record(`resolution notifications ${job.id}: ${notifErr.message}`);
        }
      }
      resolved.push(job.id);
    }

    // "No payment intent" and "PI not succeeded" are deliberately NOT defects —
    // both leave the dispute for an admin, which is the designed behaviour.
    return cronResult(
      "auto-resolve-disputes",
      { resolved: resolved.length, ids: resolved },
      defects.defects,
      corsHeaders,
    );
  } catch (err) {
    console.error("Auto-resolve disputes error:", err);
    return cronError("auto-resolve-disputes", (err as Error).message, corsHeaders);
  }
});
