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
import { getHelperFeePercent, helperCommissionDollars, DEFAULT_TIER_FEE_PERCENT } from "../_shared/helperFees.ts";
import { netUrgentFeeDollars } from "../_shared/stripeFees.ts";
import { loadAdminIds } from "../_shared/adminIds.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { claimPayout, classifyLedger, failClaim, settleClaim, type LedgerRow } from "../_shared/payoutClaim.ts";
import { resolveCapturedEscrow } from "../_shared/capturedEscrow.ts";

/**
 * Job payment states this function may legitimately walk forward to 'released'.
 *
 * 'payout_pending' is the normal one. 'released' stays in the set so a resumed
 * run (the transfer already settled, the flip already happened, and the whole
 * function is being retried) is a clean no-op rather than a false alarm. Every
 * other state — 'chargeback', 'refunded', 'escrow' — means something else owns
 * this job's money now, and the flip must NOT happen.
 */
const RELEASABLE_PAYMENT_STATES = ["payout_pending", "released"] as const;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
  // The `!!` guards matter: without them an UNSET secret makes the literal
  // string "Bearer undefined" authenticate as cron, and this function's cron
  // path goes straight to stripe.transfers.create. Every sibling function
  // already guards this way; this one did not.
  const isCron =
    (!!cronSecret && authHeader === `Bearer ${cronSecret}`) ||
    (!!serviceRoleKey && authHeader === `Bearer ${serviceRoleKey}`);

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
  // dispute_status + disputed_at are read for defense-in-depth: the
  // primary gate is status='completed', but a job in dispute that
  // somehow got marked completed (legacy data, future code paths)
  // should never auto-pay out. Belt + suspenders.
  const { data: job, error: jobErr } = await supabaseAdmin
    .from("jobs")
    .select(
      "id, title, status, payment_status, helper_id, customer_id, budget, urgent_fee, dispute_status, disputed_at, is_group_job, helpers_needed, stripe_payment_intent_id, stripe_session_id, helper_fee_percent",
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

  // Group jobs: refuse rather than silently pay 1 of N.
  //
  // This function is a single linear payout for ONE helper (job.helper_id). Its
  // amount math is already group-aware (budget / helpers_needed at :323), so on
  // a multi-helper roster it would transfer the LEAD helper their correct 1/N
  // share, flip the job to "released", and drop it out of the payout queue —
  // permanently stranding the other roster members' shares on the platform
  // balance with no retry and no error.
  //
  // process-scheduled-payouts is the fan-out path: it iterates every roster
  // member, writes a ledger row per helper, and holds the job in payout_pending
  // until the whole roster is settled. Route group jobs there.
  //
  // Fail loud, not quiet: an operator hitting this needs to know why, and a
  // group job stuck in payout_pending is recoverable, whereas an under-paid
  // roster is not.
  if (job.is_group_job && (job.helpers_needed ?? 1) > 1) {
    const { data: roster, error: rosterError } = await supabaseAdmin
      .from("group_job_helpers")
      .select("helper_id")
      .eq("job_id", job.id);

    // Dropping this error made the guard fail OPEN, which is the exact outcome
    // the guard exists to prevent: a failed lookup yields roster === null, so
    // rosterSize is 0, the `> 1` test is false, and we fall through and pay the
    // lead helper on a job we could not confirm was single-helper. Refuse
    // instead — we already know is_group_job and helpers_needed > 1, so the
    // roster read is a detail check, not the thing that decides group-ness.
    if (rosterError) {
      console.error(
        `[release-payout] roster lookup failed for group job ${job.id}: ${rosterError.message}`,
      );
      return jsonResponse(
        { error: "Could not verify the helper roster for this group job. No payout was made." },
        503,
      );
    }

    const rosterSize = (roster ?? []).length;
    if (rosterSize > 1) {
      console.error(
        `[release-payout] refusing group job ${job.id}: ${rosterSize} roster members require the fan-out path.`,
      );
      await postSlackOpsAlert({
        kind: "payout_failed",
        severity: "critical",
        title: "Group job sent to the single-helper payout path",
        message:
          "release-payout was invoked for a multi-helper group job. It can only pay one helper, which would have released the job while the rest of the roster went unpaid. The payout was REFUSED — no money moved. Run it through process-scheduled-payouts, which fans out across the roster.",
        fields: {
          "Job ID": job.id,
          "Roster size": String(rosterSize),
          "Helpers needed": String(job.helpers_needed ?? 1),
        },
        link: "https://www.louisianahelpr.com/admin?tab=payouts",
      });
      return jsonResponse(
        {
          error:
            "group jobs must be paid through the scheduled-payout fan-out path, which pays every roster member",
          roster_size: rosterSize,
        },
        409,
      );
    }
  }

  // Defense-in-depth: refuse payout on any dispute marker, even if
  // status somehow got back to 'completed'. dispute_status='resolved'
  // (admin closed in helper's favor) and 'auto_resolved' (72h expiry via
  // auto-resolve-disputes, which queues this exact payout) are both closed
  // states. Anything else (open, pending, escalated) → block.
  if (
    job.disputed_at !== null &&
    (job.dispute_status === null ||
      !["resolved", "auto_resolved"].includes(job.dispute_status))
  ) {
    return jsonResponse(
      {
        error: "job has an active dispute marker; payout blocked",
        dispute_status: job.dispute_status,
        disputed_at: job.disputed_at,
      },
      409,
    );
  }

  // Helper must have an active Connect account with payouts enabled.
  // Also pull onboarding_fee_paid — if false and they haven't paid via a
  // prior post, deduct the one-time $2 fee from this payout below.
  const { data: helper, error: helperErr } = await supabaseAdmin
    .from("profiles")
    .select("stripe_account_id, full_name, onboarding_fee_paid")
    .eq("user_id", job.helper_id)
    .maybeSingle();
  if (helperErr) {
    // Fail closed, but with the REAL cause — a transient read error must not
    // masquerade as "helper never onboarded".
    console.error(`[release-payout] helper profile read failed for ${job.helper_id}:`, helperErr);
    return jsonResponse({ error: "helper profile read failed — retry" }, 500);
  }

  if (!helper?.stripe_account_id) {
    return jsonResponse(
      { error: "helper has not completed Stripe Connect onboarding" },
      409,
    );
  }

  // Block duplicate transfers. This read is the real dedupe (a fresh
  // transfers.create gets a NEW id, so UNIQUE(stripe_transfer_id) can't
  // stop a second send) — a failed read must fail closed, never proceed.
  // 'reversed' rows block too: a reversal means money DID move once and
  // was clawed back — re-paying is an operator decision, made by setting
  // the ledger row to 'reversal_cleared' after manual reconciliation.
  // Only 'failed' (money never left) is safely re-payable automatically.
  const { data: ledgerRowsRaw, error: existingErr } = await supabaseAdmin
    .from("payout_transfers")
    .select("id, stripe_transfer_id, status, created_at")
    .eq("job_id", job.id);
  if (existingErr) {
    console.error(`[release-payout] duplicate-transfer check failed for job ${job.id}:`, existingErr);
    return jsonResponse({ error: "duplicate-transfer check failed — retry" }, 500);
  }
  // A row with a REAL transfer id in a live state is a hard block, exactly as
  // before. A 'pending' row with a NULL transfer id is something new: a CLAIM
  // (see _shared/payoutClaim.ts), which is either in flight or orphaned — it is
  // handled by claimPayout below, not treated as an existing transfer.
  const ledgerRows = (ledgerRowsRaw ?? []) as LedgerRow[];
  const { settled: existing } = classifyLedger(ledgerRows);
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
  // reject the transfer with a vague error message later. There is no outer
  // try/catch in this handler, so catch here — a Stripe API hiccup would
  // otherwise become an unhandled rejection with zero diagnostics.
  let account;
  try {
    account = await stripe.accounts.retrieve(helper.stripe_account_id);
  } catch (e) {
    const err = e as { message?: string; type?: string; code?: string };
    console.error(
      `[release-payout] accounts.retrieve failed for ${helper.stripe_account_id} (job ${job.id}):`,
      { message: err?.message, type: err?.type, code: err?.code },
    );
    return jsonResponse({ error: "could not verify helper Connect account — retry" }, 502);
  }
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

  // ── Verify the escrow charge actually captured before moving platform funds ──
  // Gating only on payment_status='payout_pending' (a Postgres column) trusts the
  // DB as ground truth for real money movement. A bug, a manual DB edit, or a
  // webhook race that set payout_pending WITHOUT a captured charge would pay the
  // helper out of the platform's own balance. Mirror process-scheduled-payouts:
  // re-verify the PaymentIntent succeeded — EXCEPT for Pay-It-Forward jobs, which
  // are funded from the prepaid platform balance and legitimately have no poster
  // charge on this job (auto-release-payment Phase 2 hands us PIF jobs too).
  const { data: pifRow, error: pifErr } = await supabaseAdmin
    .from("pif_credits")
    .select("id")
    .eq("job_id", job.id)
    .eq("status", "redeemed")
    .limit(1)
    .maybeSingle();
  if (pifErr) {
    // Fail closed: if we can't tell whether this is PIF-funded, don't risk paying
    // out against an unverified charge — defer so a retry can re-check.
    console.error(`[release-payout] pif_credits read failed for job ${job.id}:`, pifErr);
    return jsonResponse({ error: "funding-source check failed — retry" }, 500);
  }
  // Carried OUT of the escrow-verification block below so the transfer itself
  // can be capped by what was actually captured. Both stay null for a
  // PIF-credit-funded job, which legitimately has no Stripe charge behind it.
  let escrowChargeId: string | null = null;
  let escrowAmountReceivedCents: number | null = null;

  // How much of this escrow the gift credit funded, in cents.
  //
  // Without this the HARD CAP below is a NO-OP on precisely the path that needs
  // it most: `escrowAmountReceivedCents` stays null for a gift-funded job, the
  // cap is written `!== null && ...`, and `source_transaction` is deliberately
  // omitted because there is no charge to draw from. Both guards therefore
  // vanish together, and a budget raised after checkout would transfer
  // uncapped from the platform balance.
  //
  // Valued through the same dry-run RPC `execute-dispute-split` and
  // `process-scheduled-payouts` use, so no two payout paths can disagree about
  // the size of the same escrow.
  let giftAppliedCents = 0;
  if (pifRow) {
    const { data: giftPreview, error: giftPreviewErr } = await supabaseAdmin.rpc(
      "restore_pif_credit_for_job",
      { p_job_id: job.id, p_share_bps: 10000, p_dry_run: true },
    );
    const preview = (giftPreview ?? null) as { outcome?: string; applied_cents?: number } | null;
    const outcome = giftPreviewErr ? null : preview?.outcome;
    if (outcome !== "would_restore" && outcome !== "already_restored") {
      const why = giftPreviewErr
        ? `${giftPreviewErr.message}${(giftPreviewErr as { code?: string }).code ? ` (${(giftPreviewErr as { code?: string }).code})` : ""}`
        : `unrecognised outcome ${JSON.stringify(preview)}`;
      console.error(`[release-payout] gift valuation failed for job ${job.id}: ${why}`);
      return jsonResponse(
        { error: "could not value this job's Pay-It-Forward gift — nothing was moved, retry" },
        503,
      );
    }
    giftAppliedCents = Number(preview?.applied_cents ?? 0);
    if (!Number.isFinite(giftAppliedCents) || giftAppliedCents < 0) {
      return jsonResponse(
        { error: "this job's Pay-It-Forward gift has no usable applied amount — refused" },
        409,
      );
    }
  }

  if (!pifRow) {
    let paymentIntentId = job.stripe_payment_intent_id;
    if (!paymentIntentId && job.stripe_session_id) {
      try {
        const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id, { expand: ["payment_intent"] });
        paymentIntentId = typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id;
        if (paymentIntentId) {
          await supabaseAdmin.from("jobs").update({ stripe_payment_intent_id: paymentIntentId }).eq("id", job.id);
        }
      } catch (e) {
        console.warn(`[release-payout] could not retrieve session for job ${job.id}:`, e);
      }
    }
    if (!paymentIntentId) {
      console.error(`[release-payout] no payment intent for job ${job.id} — cannot verify escrow capture, refusing transfer.`);
      return jsonResponse({ error: "no payment intent on file — cannot verify escrow capture" }, 409);
    }
    let pi: Stripe.PaymentIntent;
    try {
      pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (e) {
      console.error(`[release-payout] paymentIntents.retrieve failed for ${paymentIntentId} (job ${job.id}):`, e);
      return jsonResponse({ error: "could not verify escrow charge — retry" }, 502);
    }
    if (pi.status !== "succeeded") {
      // The charge was never captured — transferring now would drain the platform
      // balance for money that was never collected. Refuse and alert admins.
      console.error(`[release-payout] PI ${paymentIntentId} for job ${job.id} status "${pi.status}" — refusing transfer.`);
      const { ids: adminIds } = await loadAdminIds(supabaseAdmin, "release-payout");
      for (const adminId of adminIds) {
        await supabaseAdmin.from("notifications").insert({
          user_id: adminId,
          title: "Payout blocked — charge not captured",
          message: `Job ${job.id} ("${job.title}") payout blocked. PaymentIntent status: ${pi.status}.`,
          type: "admin_alert", link: "/admin",
        });
      }
      return jsonResponse({ error: `escrow charge not captured (PI status: ${pi.status}) — payout refused`, pi_status: pi.status }, 409);
    }
    // Read the AMOUNT, not just the status — and never let a missing field
    // read as zero captured, which would refuse the payout under the wrong
    // banner. See `_shared/capturedEscrow.ts`.
    const captured = resolveCapturedEscrow(pi);
    if (captured.kind === "unverifiable") {
      console.error(
        `[release-payout] cannot establish captured escrow for job ${job.id} (PI ${paymentIntentId}): ${captured.reason}`,
      );
      const { ids: adminIds } = await loadAdminIds(supabaseAdmin, "release-payout");
      for (const adminId of adminIds) {
        await supabaseAdmin.from("notifications").insert({
          user_id: adminId,
          title: "Payout blocked — escrow amount unverifiable",
          message: `Job ${job.id} ("${job.title}") payout blocked: ${captured.reason}. This is an integration fault, not a poster problem — the charge may well be fine.`,
          type: "admin_alert", link: "/admin",
        });
      }
      return jsonResponse(
        { error: "could not verify how much escrow was captured — payout refused", reason: captured.reason },
        409,
      );
    }
    if (captured.source === "amount") {
      console.warn(
        `[release-payout] PI ${paymentIntentId} had no usable amount_received; falling back to amount (${captured.cents}c).`,
      );
    }
    escrowAmountReceivedCents = captured.cents;
    escrowChargeId = typeof pi.latest_charge === "string"
      ? pi.latest_charge
      : pi.latest_charge?.id ?? null;
  }

  // Compute payout: budget - platform cut + any urgent fee, in cents.
  // The platform cut is the helper's tiered commission (free 12 / pro 10 /
  // elite 8 / business 6), resolved from their live subscription tier at
  // payout time; see the fallback note below for what happens when that read
  // fails.
  // This row is still read here for `onboarding_fee_cents` (deducted further
  // down), and the null-check is kept as a config-sanity assertion: fail LOUD
  // rather than settle money against a platform_settings row we could not
  // read at all. It is no longer the source of the fee fallback.
  const { data: feeSettings, error: feeSettingsErr } = await supabaseAdmin
    .from("platform_settings")
    .select("helper_fee_percent, onboarding_fee_cents")
    .limit(1)
    .single();
  if (feeSettingsErr || feeSettings?.helper_fee_percent == null) {
    console.error(`[release-payout] platform_settings read failed for job ${job.id} — refusing default-fee payout:`, feeSettingsErr);
    return jsonResponse({ error: "fee configuration unavailable — retry" }, 500);
  }
  // FEE FALLBACK — used only when the helper's profile read fails inside
  // getHelperFeePercent. Order of authority: the rate FROZEN onto the job when
  // escrow was funded, then the FREE-tier rate (DEFAULT_TIER_FEE_PERCENT).
  //
  // The last step used to be `platform_settings.helper_fee_percent` (10 in
  // prod), justified as "preserving prior behavior on a transient error". That
  // justification is retired: preserving prior behavior here meant settling a
  // free-tier helper at 10% instead of their real 12%, i.e. the platform
  // UNDER-CHARGING itself on its primary payout path. helperFees.ts states the
  // governing principle — DEFAULT_TIER_FEE_PERCENT is deliberately the free
  // rate "so an unexpected value never under-charges the platform" — and an
  // unreadable tier is exactly an unexpected value. Erring toward the highest
  // ladder rate is the safe direction: the helper's real rate can only be
  // equal or lower, so we can refund a difference but can never claw back a
  // discount we already gave away.
  //
  // This bites hardest on Pay-It-Forward jobs: create-payment's PIF branch
  // short-circuits BEFORE the escrow stamp, so a PIF-funded job carries NO
  // frozen percent and lands on this last step every time the profile read
  // errors.
  //
  // THE TWO PAYOUT PATHS MUST AGREE. process-scheduled-payouts resolves the
  // identical chain (`job.helper_fee_percent ?? DEFAULT_TIER_FEE_PERCENT`) and
  // either path can settle the same job depending on whether release was
  // manual or auto — if these two disagree, the commission a helper is charged
  // depends on which cron happened to reach them first. Derive from
  // DEFAULT_TIER_FEE_PERCENT on BOTH sides, never a bare literal, so the two
  // cannot silently desync when the ladder changes.
  const frozenPercent =
    job.helper_fee_percent === null || job.helper_fee_percent === undefined
      ? null
      : Number(job.helper_fee_percent);
  const fallbackFeePercent =
    frozenPercent !== null && Number.isFinite(frozenPercent)
      ? frozenPercent
      : DEFAULT_TIER_FEE_PERCENT;
  const helperFeePercent = await getHelperFeePercent(
    supabaseAdmin,
    job.helper_id,
    fallbackFeePercent,
  );
  // Group jobs charge the poster the budget ONCE but the roster is N helpers, so
  // each helper is paid budget/N (and their share of the urgent fee), exactly as
  // process-scheduled-payouts:67-80 and JobPrice.computeNet do. Paying a single
  // helper off the FULL budget over-pays N× and shorts the platform balance for
  // the rest of the roster.
  const helpersCount = job.is_group_job && job.helpers_needed ? job.helpers_needed : 1;
  const perHelperBudget = Number(job.budget) / helpersCount;
  const grossDollars = perHelperBudget + netUrgentFeeDollars(job.urgent_fee) / helpersCount;
  // ONE implementation, shared with process-scheduled-payouts — see
  // helperCommissionDollars for why the product is rounded before the divide.
  const platformFeeDollars = helperCommissionDollars(perHelperBudget, helperFeePercent);
  const payoutDollars = grossDollars - platformFeeDollars;
  let payoutCents = Math.round(payoutDollars * 100);
  const platformFeeCents = Math.round(platformFeeDollars * 100);

  // One-time $2 platform onboarding fee: charged at first action (post
  // or payout). If they haven't paid it yet, deduct from this payout.
  // Same flag (profiles.onboarding_fee_paid) is checked by
  // create-payment when posting and process-scheduled-payouts when
  // auto-paying out — single source of truth across all three paths.
  const onboardingFeeCents = feeSettings.onboarding_fee_cents; // NOT NULL DEFAULT 200 in schema; read verified above
  let onboardingFeeDeductedCents = 0;

  // Race-safe atomic claim BEFORE deducting (and BEFORE the transfer
  // call). If the flag was already true, another path collected the
  // fee and we leave the helper's payout alone. If the claim succeeds,
  // we own the deduction.
  if (!helper.onboarding_fee_paid && onboardingFeeCents > 0) {
    const { data: claimed, error: claimErr } = await supabaseAdmin
      .from("profiles")
      .update({
        onboarding_fee_paid: true,
        onboarding_fee_charged_at: new Date().toISOString(),
      })
      .eq("user_id", job.helper_id)
      .eq("onboarding_fee_paid", false)
      .select("user_id");
    if (claimErr) {
      // Fail closed BEFORE the transfer — treating a failed claim as "lost
      // the race" would silently skip collecting the fee, forever.
      console.error(`[release-payout] onboarding-fee claim failed for ${job.helper_id}:`, claimErr);
      return jsonResponse({ error: "onboarding-fee claim failed — retry" }, 500);
    }

    if (claimed && claimed.length > 0) {
      if (payoutCents <= onboardingFeeCents) {
        // Edge case: claim succeeded but payout is too small to cover.
        // Roll back the claim and refuse so admin can reconcile manually.
        const { error: rollbackErr } = await supabaseAdmin
          .from("profiles")
          .update({ onboarding_fee_paid: false, onboarding_fee_charged_at: null })
          .eq("user_id", job.helper_id);
        if (rollbackErr) {
          // The flag now claims the fee was paid when it wasn't — say so in
          // the response so the manual reconciler knows the flag is lying.
          console.error(`CRITICAL: onboarding-fee rollback failed for ${job.helper_id} — onboarding_fee_paid=true but fee NOT collected:`, rollbackErr);
          return jsonResponse(
            {
              error:
                "first payout does not cover the platform onboarding fee AND the fee-flag rollback failed — onboarding_fee_paid is incorrectly true; manual reconciliation needed",
              payout_cents: payoutCents,
              fee_cents: onboardingFeeCents,
            },
            422,
          );
        }
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

  /**
   * Un-claim the one-time onboarding fee if THIS invocation claimed it.
   *
   * The atomic claim above flips the flag to true BEFORE the transfer, on the
   * assumption the transfer will carry the deducted payout. Every path that
   * exits after the claim without money moving must undo it — otherwise the
   * retry re-reads the flag as already-paid, skips the deduction, and the $2 is
   * silently lost forever. The atomic claim guarantees we are the sole owner,
   * so this rollback is safe.
   */
  const rollBackOnboardingFeeClaim = async () => {
    if (onboardingFeeDeductedCents <= 0) return;
    const { error: unclaimErr } = await supabaseAdmin
      .from("profiles")
      .update({ onboarding_fee_paid: false, onboarding_fee_charged_at: null })
      .eq("user_id", job.helper_id);
    if (unclaimErr) {
      console.error(
        `CRITICAL: [release-payout] payout did not proceed AND onboarding-fee un-claim failed for ${job.helper_id} — onboarding_fee_paid is incorrectly true but the fee was NOT collected; manual reconciliation needed:`,
        unclaimErr,
      );
    }
  };

  if (payoutCents <= 0) {
    // Reachable only with NO active fee claim: a successful claim above already
    // returned early for payout <= fee (line ~289), then subtracted, leaving
    // payoutCents > 0. So onboardingFeeDeductedCents is 0 here and there is
    // nothing to roll back.
    return jsonResponse({ error: "computed payout is non-positive" }, 422);
  }

  // HARD CAP: never transfer more than the escrow actually captured.
  //
  // `budget` is writable by the poster under RLS while payment_status is still
  // 'unpaid', and the Checkout Session freezes its amount at creation — so a
  // poster could pay a $10 session, then raise budget, and this function would
  // transfer the raised figure out of the PLATFORM balance. The PI status was
  // checked above but its AMOUNT never was.
  //
  // Two independent guards, because either alone is a single point of failure:
  //   1. this explicit assertion, which fails loudly with an admin alert, and
  //   2. `source_transaction` on the transfer below, which makes Stripe itself
  //      refuse to move more than that specific charge holds.
  // Judged against the WHOLE escrow — captured dollars plus applied gift credit
  // — so it no longer skips gift-funded jobs. It used to read
  // `escrowAmountReceivedCents !== null`, which is null exactly when the gift
  // path removes `source_transaction` too, so both guards went missing together
  // on the one path where the assertion stands alone.
  const escrowValueCents = (escrowAmountReceivedCents ?? 0) + giftAppliedCents;
  if (payoutCents > escrowValueCents) {
    console.error(
      `[release-payout] REFUSING: payout ${payoutCents}c exceeds escrow ${escrowValueCents}c ` +
        `(captured ${escrowAmountReceivedCents ?? 0}c + gift ${giftAppliedCents}c) for job ${job.id}`,
    );
    const { ids: adminIds } = await loadAdminIds(supabaseAdmin, "release-payout");
    for (const adminId of adminIds) {
      await supabaseAdmin.from("notifications").insert({
        user_id: adminId,
        title: "Payout blocked — exceeds captured amount",
        message: `Job ${job.id} ("${job.title}") tried to pay out $${(payoutCents / 100).toFixed(2)} against $${(escrowValueCents / 100).toFixed(2)} of escrow ($${((escrowAmountReceivedCents ?? 0) / 100).toFixed(2)} captured + $${(giftAppliedCents / 100).toFixed(2)} gift). Budget may have been altered after checkout.`,
        type: "admin_alert", link: "/admin",
      });
    }
    // This refusal sits AFTER the onboarding-fee claim, so it is one of the
    // exits that would otherwise leave `onboarding_fee_paid = true` with no
    // money moved — the retry would then read the flag as already-paid and
    // never collect the $2. Undo it, exactly as the transfer catch does.
    await rollBackOnboardingFeeClaim();
    return jsonResponse(
      { error: "payout exceeds captured escrow — refused", payout_cents: payoutCents, captured_cents: escrowAmountReceivedCents },
      409,
    );
  }

  // ── Claim the payout BEFORE calling Stripe ────────────────────────────────
  // The read above cannot close the race with process-scheduled-payouts: the
  // two use different idempotency keys on the same job, so Stripe would create
  // two transfers, and an unlocked SELECT can only lose that race, never win
  // it. The INSERT below is arbitrated by a partial unique index on
  // (job_id, helper_id) over the live statuses — exactly one concurrent run
  // gets the row, everyone else gets 23505 and stops here rather than at the
  // Stripe call. It is also the row that records a FAILED attempt, which
  // nothing in this function ever wrote before (see _shared/payoutClaim.ts).
  const claim = await claimPayout(supabaseAdmin, {
    jobId: job.id,
    helperId: job.helper_id,
    amountCents: payoutCents,
    platformFeeCents: platformFeeCents,
    stripeAccountId: helper.stripe_account_id,
    initiatedBy,
    initiatedByUserId,
    metadata: { source: "release-payout" },
  });
  if (claim.kind === "error") {
    // Fail closed BEFORE the transfer. Roll back the onboarding-fee claim we
    // may already hold, for the same reason the transfer catch below does.
    console.error(`[release-payout] could not claim payout for job ${job.id}: ${claim.message}`);
    await rollBackOnboardingFeeClaim();
    return jsonResponse({ error: `payout claim failed — retry: ${claim.message}` }, 500);
  }
  if (claim.kind === "blocked") {
    await rollBackOnboardingFeeClaim();
    return jsonResponse(
      { error: claim.reason, existing_transfer_id: claim.transferId },
      409,
    );
  }
  const failedTransferCount = claim.failedCount;

  let transfer: Stripe.Transfer;
  try {
    transfer = await stripe.transfers.create(
      {
        amount: payoutCents,
        currency: "usd",
        destination: helper.stripe_account_id,
        // Ties the transfer to the exact charge that funded it, exactly as
        // process-scheduled-payouts / void-cancelled-payments / create-payment
        // already do — this function was the only payout path without it.
        // Stripe then enforces the cap server-side even if the check above is
        // ever bypassed. Omitted for PIF-credit-funded jobs (no charge).
        ...(escrowChargeId ? { source_transaction: escrowChargeId } : {}),
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
      // Salted by prior failed-attempt count so a retry after a failed
      // transfer isn't served Stripe's cached failure (see dedupe above).
      {
        idempotencyKey: failedTransferCount > 0
          ? `release-payout-${job.id}-r${failedTransferCount}`
          : `release-payout-${job.id}`,
      },
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
    // Record the FAILED attempt. Nothing in this function ever did, and the
    // gap was load-bearing: the idempotency key above is salted with the count
    // of prior failed rows precisely so a retry is a genuinely new attempt, and
    // with no row ever written that count stayed 0, the key stayed unsalted,
    // and Stripe replayed this same cached failure for its whole ~24h window.
    // The retry was a silent no-op for a day. The claim row already exists, so
    // this is one UPDATE — the guard and the failure record are the same row
    // and cannot drift apart.
    const failed = await failClaim(supabaseAdmin, claim.claimId, err.message, {
      source: "release-payout",
      stripe_code: err.code ?? null,
      stripe_type: err.type ?? null,
    });
    if (!failed.ok) {
      // The claim is stuck 'pending' with no transfer id. It is recoverable —
      // the next run resumes it against the SAME idempotency key — but a claim
      // nobody can settle is exactly the state that strands a payout, so say so.
      console.error(
        `CRITICAL: [release-payout] transfer failed for job ${job.id} AND the claim row could not be marked failed (${failed.message}); the payout will resume against the same idempotency key on the next run.`,
      );
    }
    // Un-claim the onboarding fee if THIS invocation claimed it — the transfer
    // failed, so no money moved and the fee was never actually collected.
    await rollBackOnboardingFeeClaim();
    return jsonResponse({ error: `stripe.transfers.create failed: ${err.message}` }, 502);
  }

  // Settle the claim taken before the transfer. It is stamped "paid" rather
  // than "pending": Stripe marketplace transfers settle synchronously on
  // creation, and the `transfer.created` webhook handler — which flips
  // pending → paid — can fire before this UPDATE runs. If that webhook found
  // no row it was a no-op and nothing ever re-fired to fix it, leaving the row
  // stuck at "pending" forever. Settling to "paid" here makes the webhook a
  // harmless no-op on a row already in its terminal state.
  const settled = await settleClaim(supabaseAdmin, claim.claimId, {
    stripeTransferId: transfer.id,
    amountCents: payoutCents,
    platformFeeCents,
    stripeAccountId: helper.stripe_account_id,
    metadata: { source: "release-payout", transfer_group: transfer.transfer_group ?? null },
  });
  if (!settled.ok) {
    console.error(
      `CRITICAL: transfer ${transfer.id} sent for job ${job.id} but the ledger claim could not be settled: ${settled.message}`,
    );
    await postSlackOpsAlert({
      kind: "payout_failed",
      severity: "critical",
      title: "Payout sent but the ledger row was not settled",
      message:
        "A Stripe transfer succeeded but its payout_transfers claim row could not be stamped paid with the transfer id. The money is out; the ledger does not say so. Reconcile before anything re-reads this job.",
      fields: {
        "Job ID": job.id,
        "Transfer ID": transfer.id,
        "Claim row": claim.claimId,
        "DB error": settled.message.slice(0, 200),
      },
      link: "https://www.louisianahelpr.com/admin?tab=payouts",
    });
    return jsonResponse(
      {
        fn: "release-payout",
        error: "transfer sent but ledger write failed — manual reconciliation needed",
        stripe_transfer_id: transfer.id,
      },
      500,
    );
  }

  // The money is already out, so this write is the LAST thing standing between
  // a paid helper and a job that still looks payable.
  //
  // It used to be a bare `.eq("id", job.id)` with no `.select("id")` and no
  // state precondition. A zero-row match returns `{ data: [], error: null }` —
  // so the function answered `success: true` with a transfer id while the job
  // sat in payout_pending forever and Stripe had already paid. That is the
  // house's single most-cited bug class, on the primary escrow release.
  //
  // Now it mirrors execute-dispute-split:879-885 exactly: an explicit
  // precondition on the states this write may legitimately walk forward from,
  // `.select("id")`, and a zero-row branch that is treated as the critical
  // event it is. The precondition also means a job an operator has since
  // refunded, or that a chargeback webhook has flipped, is never overwritten
  // with 'released'.
  const { data: releasedJob, error: releasedErr } = await supabaseAdmin
    .from("jobs")
    .update({
      payment_status: "released",
      // Persist the tier-resolved commission so job-level revenue analytics
      // match what actually moved (the escrow-time value was a placeholder
      // computed before any helper — and thus any tier — was known).
      platform_fee_amount: platformFeeDollars,
      helper_fee_percent: helperFeePercent,
    })
    .eq("id", job.id)
    .in("payment_status", [...RELEASABLE_PAYMENT_STATES])
    .select("id");
  if (releasedErr || !releasedJob || releasedJob.length === 0) {
    const zeroRow = !releasedErr;
    console.error(
      `CRITICAL: transfer ${transfer.id} sent for job ${job.id} but jobs.update to released ${zeroRow ? "matched ZERO rows (payment_status changed under us)" : "failed"}:`,
      releasedErr,
    );
    await postSlackOpsAlert({
      kind: "payout_failed",
      severity: "critical",
      title: "Payout sent but the job did not flip to released",
      message: zeroRow
        ? "A Stripe transfer succeeded but jobs.payment_status was no longer in a releasable state, so the flip matched zero rows. The helper has been paid while the job still reads payout_pending (or was concurrently refunded / charged back). Reconcile immediately."
        : "A Stripe transfer succeeded but jobs.payment_status could not be flipped to released. The helper has been paid while the job still reads payout_pending. Reconcile immediately.",
      fields: {
        "Job ID": job.id,
        "Transfer ID": transfer.id,
        "Amount": `$${(payoutCents / 100).toFixed(2)}`,
        "DB error": releasedErr?.message?.slice(0, 200) ?? "zero rows matched",
      },
      link: "https://www.louisianahelpr.com/admin?tab=payouts",
    });
    return jsonResponse(
      {
        fn: "release-payout",
        error: "transfer sent but job status update failed — manual reconciliation needed",
        stripe_transfer_id: transfer.id,
        zero_row_match: zeroRow,
      },
      500,
    );
  }

  // Note: onboarding-fee flag was already flipped atomically above,
  // before the transfer ran, so no follow-up write is needed here.

  // NO notification insert here (removed 2026-08-29): the jobs.payment_status
  // → 'released' UPDATE above already fired the handle_payment_status
  // DB trigger, which inserts "Payout released" for the helper. Inserting a
  // second one here produced the "Payment released" + "Payout released"
  // double proven live on job db21c20d. The trigger is kept as the single
  // writer because it covers EVERY release path (dispute splits, admin
  // releases), not just this function.

  return jsonResponse({
    success: true,
    job_id: job.id,
    stripe_transfer_id: transfer.id,
    amount_cents: payoutCents,
    platform_fee_cents: platformFeeCents,
    initiated_by: initiatedBy,
  });
});

/**
 * Every response names this function.
 *
 * `sweep_silent_cron_failures` (20260829020000) only ingests a response whose
 * body matches `content ~ '"fn"\s*:\s*"'`, and `sweep_cron_http_failures` falls
 * back to timestamp proximity — which guessed wrong three times in four —
 * without it. release-payout is invoked over HTTP by auto-release-payment's
 * Phase 2, so its answers land in `net._http_response` like any cron's and were
 * being discarded by the watcher for want of one key.
 */
function jsonResponse(body: unknown, status = 200) {
  const named = body !== null && typeof body === "object" && !Array.isArray(body)
    ? { fn: "release-payout", ...(body as Record<string, unknown>) }
    : body;
  return new Response(JSON.stringify(named), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
