// release-payout: actually move money from the platform Stripe balance to
// a helper's Connect account. Today auto-release-payment marks jobs as
// "payout_pending" and tells the helper "you'll be paid in 24h" — but
// nothing ever calls stripe.transfers.create(), so the money just sits
// on the platform balance. This function closes that loop.
//
// Invocation:
//   - service_role: from a cron / auto-release-payment follow-up call
//   - admin user:   from an admin "Release payout" button
//   - never: from a regular user (they should never trigger their own payout)
//
// Body: { job_id: string, initiated_by?: 'system' | 'admin' | 'auto' }
//
// Money flow (separate-charges-and-transfers pattern):
//   1. customer paid via stripe.checkout.sessions → funds on platform balance
//   2. job runs to completion
//   3. THIS function calls stripe.transfers.create({ destination: helper_connect_acct_id })
//   4. payout_transfers row written (status=pending)
//   5. stripe-webhook later receives transfer.paid → flips status to 'paid'
//
// Idempotency:
//   - Uses stripe transfer idempotency_key based on job_id, so retries
//     never produce duplicate transfers
//   - DB has UNIQUE(stripe_transfer_id) on payout_transfers, so DB also
//     rejects dup writes

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const HELPER_FEE_PERCENT = 10; // platform cut

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: accept either CRON_SECRET (service automation) or a JWT
  // belonging to an admin role. Reject everything else.
  const authHeader = req.headers.get("Authorization") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET");
  const serviceRoleKey = (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    serviceRoleKey ?? "",
  );

  let initiatedBy: "system" | "admin" | "auto" = "system";
  let initiatedByUserId: string | null = null;
  const isCron =
    authHeader === `Bearer ${cronSecret}` ||
    authHeader === `Bearer ${serviceRoleKey}`;

  if (!isCron) {
    // User JWT path — must be admin.
    try {
      const supabaseUser = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? "",
      );
      const token = authHeader.replace("Bearer ", "");
      const { data: u } = await supabaseUser.auth.getUser(token);
      if (!u?.user) throw new Error("not authenticated");

      const { data: hasAdmin } = await supabaseAdmin.rpc("has_role", {
        _user_id: u.user.id,
        _role: "admin",
      });
      if (!hasAdmin) throw new Error("admin role required");

      initiatedBy = "admin";
      initiatedByUserId = u.user.id;
    } catch (e) {
      return jsonResponse({ error: (e as Error).message }, 401);
    }
  }

  let body: { job_id?: string; initiated_by?: typeof initiatedBy };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }
  if (!body.job_id) return jsonResponse({ error: "job_id required" }, 400);
  if (body.initiated_by && isCron) initiatedBy = body.initiated_by;

  // Validate job is eligible to release.
  const { data: job, error: jobErr } = await supabaseAdmin
    .from("jobs")
    .select(
      "id, title, status, payment_status, helper_id, customer_id, budget, urgent_fee",
    )
    .eq("id", body.job_id)
    .single();

  if (jobErr || !job) return jsonResponse({ error: "job not found" }, 404);
  if (job.status !== "completed") {
    return jsonResponse(
      { error: `job status is ${job.status}, expected completed` },
      409,
    );
  }
  if (job.payment_status !== "payout_pending") {
    return jsonResponse(
      {
        error: `payment_status is ${job.payment_status}, expected payout_pending`,
      },
      409,
    );
  }
  if (!job.helper_id) {
    return jsonResponse({ error: "job has no helper_id" }, 409);
  }

  // Helper must have an active Connect account with payouts enabled.
  // Also pull onboarding_fee_paid — if false and they haven't paid via a
  // prior post, deduct the one-time $2 fee from this payout below.
  const { data: helper } = await supabaseAdmin
    .from("profiles")
    .select("stripe_account_id, full_name, onboarding_fee_paid")
    .eq("user_id", job.helper_id)
    .single();

  if (!helper?.stripe_account_id) {
    return jsonResponse(
      { error: "helper has not completed Stripe Connect onboarding" },
      409,
    );
  }

  // Block duplicate transfers — DB UNIQUE(stripe_transfer_id) is the
  // hard guarantee, but we check first so we can surface a clean error.
  const { data: existing } = await supabaseAdmin
    .from("payout_transfers")
    .select("id, stripe_transfer_id, status")
    .eq("job_id", job.id)
    .in("status", ["pending", "paid"])
    .maybeSingle();
  if (existing) {
    return jsonResponse(
      {
        error: "transfer already exists for this job",
        existing_transfer_id: existing.stripe_transfer_id,
      },
      409,
    );
  }

  const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
    apiVersion: "2025-08-27.basil",
  });

  // Confirm Connect account is actually payable. Cheaper than letting Stripe
  // reject the transfer with a vague error message later.
  const account = await stripe.accounts.retrieve(helper.stripe_account_id);
  if (!account.payouts_enabled || !account.charges_enabled) {
    return jsonResponse(
      {
        error: "helper Connect account is not fully active",
        payouts_enabled: account.payouts_enabled,
        charges_enabled: account.charges_enabled,
      },
      409,
    );
  }

  // Compute payout: budget - 10% platform cut + any urgent fee, in cents.
  const grossDollars = Number(job.budget) + Number(job.urgent_fee ?? 0);
  const platformFeeDollars =
    Math.round(Number(job.budget) * HELPER_FEE_PERCENT) / 100;
  const payoutDollars = grossDollars - platformFeeDollars;
  let payoutCents = Math.round(payoutDollars * 100);
  const platformFeeCents = Math.round(platformFeeDollars * 100);

  // One-time $2 platform onboarding fee: charged at first action (post
  // or payout). If they haven't paid it yet, deduct from this payout.
  // Same flag (profiles.onboarding_fee_paid) is checked by
  // create-payment when posting and process-scheduled-payouts when
  // auto-paying out — single source of truth across all three paths.
  const { data: settingsRow } = await supabaseAdmin
    .from("platform_settings")
    .select("onboarding_fee_cents")
    .limit(1)
    .single();
  const onboardingFeeCents = settingsRow?.onboarding_fee_cents ?? 200;
  let onboardingFeeDeductedCents = 0;

  // Race-safe atomic claim BEFORE deducting (and BEFORE the transfer
  // call). If the flag was already true, another path collected the
  // fee and we leave the helper's payout alone. If the claim succeeds,
  // we own the deduction.
  if (!helper.onboarding_fee_paid && onboardingFeeCents > 0) {
    const { data: claimed } = await supabaseAdmin
      .from("profiles")
      .update({
        onboarding_fee_paid: true,
        onboarding_fee_charged_at: new Date().toISOString(),
      })
      .eq("user_id", job.helper_id)
      .eq("onboarding_fee_paid", false)
      .select("user_id");

    if (claimed && claimed.length > 0) {
      if (payoutCents <= onboardingFeeCents) {
        // Edge case: claim succeeded but payout is too small to cover.
        // Roll back the claim and refuse so admin can reconcile manually.
        await supabaseAdmin
          .from("profiles")
          .update({ onboarding_fee_paid: false, onboarding_fee_charged_at: null })
          .eq("user_id", job.helper_id);
        return jsonResponse(
          {
            error:
              "first payout does not cover the platform onboarding fee — manual reconciliation needed",
            payout_cents: payoutCents,
            fee_cents: onboardingFeeCents,
          },
          422,
        );
      }
      payoutCents -= onboardingFeeCents;
      onboardingFeeDeductedCents = onboardingFeeCents;
    }
    // Lost the race — flag flipped between read and claim. Don't deduct.
  }

  if (payoutCents <= 0) {
    return jsonResponse({ error: "computed payout is non-positive" }, 422);
  }

  let transfer: Stripe.Transfer;
  try {
    transfer = await stripe.transfers.create(
      {
        amount: payoutCents,
        currency: "usd",
        destination: helper.stripe_account_id,
        transfer_group: `job_${job.id}`,
        description: `Helpr payout for job ${job.id} — ${job.title}`,
        metadata: {
          job_id: job.id,
          helper_id: job.helper_id,
          customer_id: job.customer_id ?? "",
          initiated_by: initiatedBy,
        },
      },
      // Idempotency: same job + same trigger pattern = same transfer. Stripe
      // will return the existing transfer instead of creating a new one.
      { idempotencyKey: `release-payout-${job.id}` },
    );
  } catch (e) {
    // Defensive logging: full Stripe error context lands in Supabase logs
    // so we can diagnose without reproducing.
    const err = e as Error & { type?: string; code?: string; statusCode?: number };
    console.error("[release-payout] stripe.transfers.create failed:", {
      job_id: body.job_id,
      message: err.message,
      stripe_type: err.type,
      stripe_code: err.code,
      stripe_status: err.statusCode,
      stack: err.stack?.split("\n").slice(0, 5).join("\n"),
    });
    return jsonResponse({ error: `stripe.transfers.create failed: ${err.message}` }, 502);
  }

  // Persist the ledger row + flip the job's payment_status. If the
  // ledger insert fails, the transfer already happened — log loudly so
  // someone can reconcile by hand.
  const { error: ledgerErr } = await supabaseAdmin
    .from("payout_transfers")
    .insert({
      job_id: job.id,
      helper_id: job.helper_id,
      stripe_transfer_id: transfer.id,
      stripe_account_id: helper.stripe_account_id,
      amount_cents: payoutCents,
      platform_fee_cents: platformFeeCents,
      status: "pending",
      initiated_by: initiatedBy,
      initiated_by_user_id: initiatedByUserId,
      metadata: { transfer_group: transfer.transfer_group ?? null },
    });

  if (ledgerErr) {
    console.error(
      `CRITICAL: transfer ${transfer.id} sent for job ${job.id} but ledger write failed:`,
      ledgerErr,
    );
    return jsonResponse(
      {
        error: "transfer sent but ledger write failed — manual reconciliation needed",
        stripe_transfer_id: transfer.id,
      },
      500,
    );
  }

  await supabaseAdmin
    .from("jobs")
    .update({ payment_status: "released" })
    .eq("id", job.id);

  // Note: onboarding-fee flag was already flipped atomically above,
  // before the transfer ran, so no follow-up write is needed here.

  // Notify helper that money is on the way. The transfer is "pending" until
  // Stripe settles; transfer.paid webhook will flip the ledger row to 'paid'
  // and we could send a second notification then.
  const netDollars = payoutCents / 100;
  const feeNote =
    onboardingFeeDeductedCents > 0
      ? ` (one-time $2 onboarding fee deducted)`
      : "";
  await supabaseAdmin.from("notifications").insert({
    user_id: job.helper_id,
    title: "💸 Payment released",
    message: `Your earnings for "${job.title}" ($${netDollars.toFixed(2)}) have been sent to your bank${feeNote}.`,
    type: "payment",
    link: "/dashboard?tab=earnings",
  });

  return jsonResponse({
    success: true,
    job_id: job.id,
    stripe_transfer_id: transfer.id,
    amount_cents: payoutCents,
    platform_fee_cents: platformFeeCents,
    initiated_by: initiatedBy,
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
