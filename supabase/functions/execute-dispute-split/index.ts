// seed-policy: pages for seed/E2E jobs too, on purpose. Every alert here is money
// that moved (or failed to move) in Stripe while the DB says otherwise, or a Stripe
// event that could not be settled: a platform failure whoever owns the job. The
// nightly money journeys on seed jobs are how this path is proven, so their failures
// are real signal (2026-09-22: "transfer failed" on seed jobs = the empty test
// balance, Q3). Seed-only noise is routed in the detectors, not here (docs/OPEN.md Q2).
// execute-dispute-split: make a recorded partial dispute split actually move
// money.
//
// `rpc_decide_dispute` writes `disputes.payout_split` — poster X% / helper Y% —
// and, until now, that was the end of it. The admin UI said so in as many
// words: "Recorded only — a partial split does not move money. Release or
// refund the escrow manually in Stripe after deciding." This function is the
// execution half of that decision.
//
// Three legs — the first two off the job's ORIGINAL PaymentIntent, the third
// off the gift card when one funded the job:
//   1. TRANSFER  — the helper's share of the budget, minus the platform
//                  commission, to their Connect account.
//   2. REFUND    — the poster's share of what was actually captured, minus
//                  Stripe's non-refundable processing cost.
//   3. GIFT      — the poster's share of whatever a gift card paid,
//                  minted back as a replacement gift by
//                  `restore_gift_card_for_job`. There is no charge to
//                  reverse on that money, so a Stripe refund cannot return
//                  it; the gift IS the money.
//
// The two legs are INDEPENDENTLY resumable. A run that transfers and then dies
// before refunding records the transfer id on the dispute and leaves
// execution_status='failed'; the retry sees a settled `payout_transfers` row,
// skips the transfer leg entirely, and issues only the refund. That property is
// the whole reason this is not a single all-or-nothing block.
//
// Invocation: admin user JWT ONLY. There is no cron path — a dispute split is
// always a human decision, so there is nothing for a service token to do here.
// (`verify_jwt` is left at its default of true in config.toml, so the gateway
// rejects non-JWT bearers before this code runs; the admin check below is the
// second gate, not the only one.)
//
// Body: { dispute_id: string }
//
// Explicitly OUT OF SCOPE, guarded rather than silently skipped:
//   • GROUP JOBS — one escrow, N helpers. A partial split across a roster needs
//     per-helper shares and N transfers; that is a follow-up, and paying only
//     the lead helper would strand the rest of the roster's money.
//     (gift-card-funded jobs USED to be guarded here too, refused with "resolve
//     it with the full release or full refund action". That advice could not
//     work: a full refund also reverses a PaymentIntent, and a gift-funded job
//     has none — so the admin was told the money was recoverable when nothing
//     anywhere could recover it. Leg 3 below is that guard replaced with an
//     answer.)

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2";
// Separate `import type` line on purpose: src/test/edge/harness.ts rewrites
// this exact form when it bundles the function for vitest.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeadersFull as corsHeaders } from "../_shared/cors.ts";
import { getHelperFeePercent, helperCommissionDollars, DEFAULT_TIER_FEE_PERCENT } from "../_shared/helperFees.ts";
import { netUrgentFeeDollars, actualOrEstimatedFeeCents } from "../_shared/stripeFees.ts";
import { postSlackOpsAlert } from "../_shared/slack-alerts.ts";
import { writeAdminAudit } from "../_shared/adminAuditLog.ts";
import { formatPayoutDollars } from "../_shared/money.ts";

/**
 * The client type these helpers accept.
 *
 * NOT `ReturnType<typeof createClient>`: `createClient` is overloaded, and
 * `ReturnType` resolves the LAST overload — `SupabaseClient<unknown, ...>`,
 * whose row and payload types collapse to `never`. `createClient(url, key)`
 * actually returns `SupabaseClient<any, "public", "public", any, any>`, so the
 * annotation rejected the only client it is ever called with, and every
 * `.insert()`/`.update()` inside these helpers was checked against `never`.
 */
// deno-lint-ignore no-explicit-any
type AdminClient = SupabaseClient<any>;

/** Job payment states from which a decided split may be executed for the FIRST time. */
const EXECUTABLE_PAYMENT_STATES = ["escrow", "payout_pending"] as const;

/**
 * Additional states a RESUME may start from.
 *
 * The transfer leg flips the job terminal — directly at the end of a completed
 * run, and also via the `transfer.created` webhook, which matches the 'paid'
 * ledger row this function writes and moves the job escrow → released within
 * milliseconds of `transfers.create` returning. So the moment the transfer
 * succeeds, the job is 'released' whether or not the refund leg finished.
 *
 * A split whose refund leg then failed therefore comes back to a job the
 * first-attempt gate would reject, and the poster's money would be stuck in
 * escrow with no path out of this function. These two states are accepted ONLY
 * when the dispute carries a prior claim (`execution_status` non-null), which is
 * exactly the "a previous attempt of THIS split already moved something"
 * signal — never for a first attempt, where a terminal job means the escrow was
 * settled by some other path and this split must not touch it.
 */
const RESUME_PAYMENT_STATES = ["released", "refunded"] as const;

/** A dispute id must be a uuid — the column is `uuid`, and a malformed one
 *  otherwise reaches Postgres and comes back as an opaque 22P02 cast error. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Execution states that may be (re-)claimed.
 *
 * 'executing' is in this set ON PURPOSE. It is a progress marker, not a lock:
 * a run that died between the claim and the Stripe call would otherwise strand
 * the split behind a state nobody can clear, with the poster's money sitting in
 * escrow forever. The real anti-double-pay guards are the fail-closed ledger
 * reads (`payout_transfers` / `payment_refunds`) and the deterministic Stripe
 * idempotency keys derived from the dispute id — exactly the trade-off
 * create-payment's cancel_escrow makes with its re-claimable 'cancelling'.
 * 'executed' is terminal and is NOT here.
 */
const CLAIMABLE_EXECUTION_STATES = ["pending", "executing", "failed"] as const;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey =
    (Deno.env.get("SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) ?? "";
  const anonKey =
    (Deno.env.get("PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")) ?? "";
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

  // ── Auth: admin JWT, and nothing else ────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ error: "Missing authorization header" }, 401);

  let adminUserId: string;
  try {
    const supabaseUser = createClient(supabaseUrl, anonKey);
    const token = authHeader.replace("Bearer ", "");
    const { data: u, error: authErr } = await supabaseUser.auth.getUser(token);
    if (authErr) console.error("[execute-dispute-split] auth.getUser error:", authErr.message);
    if (!u?.user) throw new Error("not authenticated");

    const { data: hasAdmin, error: roleErr } = await supabaseAdmin.rpc("has_role", {
      _user_id: u.user.id,
      _role: "admin",
    });
    // Fail CLOSED on a failed role check: a dropped error here would treat
    // "we could not tell" as "not an admin" only by accident of hasAdmin being
    // undefined — say it out loud instead so a DB blip never reads as a
    // permissions verdict.
    if (roleErr) {
      console.error("[execute-dispute-split] has_role check failed:", roleErr.message);
      return json({ error: "could not verify admin role — retry" }, 503);
    }
    if (!hasAdmin) throw new Error("admin role required");
    adminUserId = u.user.id;
  } catch (e) {
    return json({ error: (e as Error).message }, 401);
  }

  let body: { dispute_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  const disputeId = body.dispute_id;
  if (!disputeId) return json({ error: "dispute_id required" }, 400);
  if (!UUID_RE.test(disputeId)) {
    // Caught here rather than at the DB: an `= 'not-a-uuid'` on a uuid column
    // raises 22P02, which the read below would report as "dispute lookup
    // failed — retry" and send an admin round in circles retrying a request
    // that can never succeed.
    return json({ error: "dispute_id must be a uuid" }, 400);
  }

  /**
   * Refuse this settlement AND leave a trace the database can be searched on.
   *
   * Every check between here and the execution claim used to `return json(...)`
   * straight to the browser: the admin saw a red toast, the tab was closed, and
   * `execution_status` stayed NULL — so a decided-but-unsettled dispute was
   * invisible to every query. The only record of a refusal was the toast the
   * admin had already dismissed. `markFailed` parks the dispute in the
   * re-claimable 'failed' state with the reason, which is exactly what the
   * admin queue's UNSETTLED badge and the Exception Queue now read.
   *
   * 'failed' is re-claimable by design (see CLAIMABLE_EXECUTION_STATES), so
   * recording a transient refusal here never blocks the retry it is telling
   * the admin to make.
   */
  const refuse = async (body: Record<string, unknown>, status: number): Promise<Response> => {
    await markFailed(
      supabaseAdmin,
      disputeId,
      typeof body.error === "string" ? body.error : `refused with status ${status}`,
    );
    return json(body, status);
  };


  // ── 1. The dispute must be decided, with a real recorded split ───────────
  const { data: dispute, error: disputeErr } = await supabaseAdmin
    .from("disputes")
    .select(
      "id, job_id, status, decided_at, payout_split, decision_text, execution_status, execution_error, execution_transfer_id, execution_refund_id",
    )
    .eq("id", disputeId)
    .maybeSingle();
  if (disputeErr) {
    console.error(`[execute-dispute-split] dispute read failed for ${disputeId}:`, disputeErr);
    return json({ error: "dispute lookup failed — retry" }, 500);
  }
  if (!dispute) return json({ error: "dispute not found" }, 404);
  if (dispute.status !== "decided") {
    return await refuse(
      { error: `dispute status is ${dispute.status}, expected decided`, dispute_status: dispute.status },
      409,
    );
  }
  if (dispute.execution_status === "executed") {
    return json(
      {
        error: "this split has already been executed",
        stripe_transfer_id: dispute.execution_transfer_id,
        stripe_refund_id: dispute.execution_refund_id,
      },
      409,
    );
  }

  const shares = parseSplit(dispute.payout_split);
  if (!shares) {
    return await refuse({ error: "dispute has no usable payout_split recorded" }, 409);
  }
  const { helperShare, posterShare } = shares;

  // ── 2. The job must be a single-helper, escrow-funded job in a payable state
  const { data: job, error: jobErr } = await supabaseAdmin
    .from("jobs")
    .select(
      "id, title, status, payment_status, helper_id, customer_id, budget, urgent_fee, helper_fee_percent, is_group_job, helpers_needed, stripe_payment_intent_id, stripe_session_id",
    )
    .eq("id", dispute.job_id)
    .maybeSingle();
  if (jobErr) {
    console.error(`[execute-dispute-split] job read failed for ${dispute.job_id}:`, jobErr);
    return await refuse({ error: "job lookup failed — retry" }, 500);
  }
  if (!job) return await refuse({ error: "job not found for this dispute" }, 404);

  // Group jobs: refuse, loudly. One escrow funds N helpers, so a partial split
  // needs N transfers and a per-helper share. Executing the single-helper path
  // here would pay the lead their slice, flip the job terminal, and permanently
  // strand every other roster member's money on the platform balance.
  if (job.is_group_job) {
    return await refuse(
      {
        error:
          // NOT "the full release": as of 2026-09-01 `admin_release_dispute`
          // refuses a multi-member roster too (create-payment, the group guard
          // in that action), because it can only transfer to jobs.helper_id
          // and would strand the rest of the roster. Full refund is the only
          // automated close for a group dispute until the roster fan-out
          // exists; naming the release here would send an admin at a 409.
          "group jobs cannot be settled with a partial split yet — a split across a multi-helper roster needs per-helper shares. Resolve this one with the full refund action, or pay the roster manually.",
        is_group_job: true,
        helpers_needed: job.helpers_needed ?? null,
      },
      409,
    );
  }

  // A prior attempt of THIS split claimed the dispute (the 'executed' case
  // already returned above, so any non-null value here is an unfinished run).
  // That, and only that, widens the payment-state gate — see RESUME_PAYMENT_STATES.
  // 'pending' is what `rpc_decide_dispute` stamps the moment the decision is
  // recorded — it means "decided, never attempted", NOT "a prior run moved
  // something". Counting it as a resume would widen the payment-state gate to
  // RESUME_PAYMENT_STATES on a FIRST attempt, letting this function settle a
  // split against a job some other path had already released or refunded.
  const isResume =
    dispute.execution_status != null && dispute.execution_status !== "pending";
  const allowedPaymentStates: readonly string[] = isResume
    ? [...EXECUTABLE_PAYMENT_STATES, ...RESUME_PAYMENT_STATES]
    : EXECUTABLE_PAYMENT_STATES;

  if (!allowedPaymentStates.includes(job.payment_status)) {
    return await refuse(
      {
        error: `job payment_status is ${job.payment_status}, expected ${allowedPaymentStates.join(" or ")}`,
        payment_status: job.payment_status,
        is_resume: isResume,
      },
      409,
    );
  }
  if (helperShare > 0 && !job.helper_id) {
    return await refuse({ error: "split awards the Helpr a share but the job has no helper_id" }, 409);
  }
  if (posterShare > 0 && !job.customer_id) {
    return await refuse({ error: "split awards the poster a share but the job has no customer_id" }, 409);
  }

  // ── How was this escrow funded? ──────────────────────────────────────────
  // A job can be funded by a Stripe charge, by a gift card, or by
  // BOTH (a gift smaller than the cost is redeemed and the shortfall is
  // collected by Stripe). The gift half carries no PaymentIntent, so a Stripe
  // refund cannot return it — leg 3 mints it back instead.
  //
  // Fail closed on a read error: "we could not tell how this was funded" must
  // never become "assume the whole escrow is a chargeable PaymentIntent",
  // which would refund the poster Stripe money that the gift, not their card,
  // put there.
  const { data: giftCardRow, error: giftCardErr } = await supabaseAdmin
    .from("gift_cards")
    .select("id, status")
    .eq("job_id", job.id)
    .in("status", ["redeemed", "reserved"])
    .limit(1)
    .maybeSingle();
  if (giftCardErr) {
    console.error(`[execute-dispute-split] gift_cards read failed for job ${job.id}:`, giftCardErr);
    return await refuse({ error: "funding-source check failed — retry" }, 500);
  }

  // How many cents of this escrow the gift actually paid for. Computed by
  // `restore_gift_card_for_job` in dry-run mode rather than here, on purpose:
  // the applied figure is NOT the gift's face value (a gift bigger than the
  // job has its remainder minted as a separate child credit the recipient
  // already holds), and a second copy of that arithmetic on this side is
  // exactly the drift this file's commission comment warns about.
  let giftAppliedCents = 0;
  if (giftCardRow) {
    if ((giftCardRow as { status?: string }).status === "reserved") {
      // Reserved, not redeemed: the gift was earmarked for this job but the
      // shortfall was never paid, so this job cannot be in escrow off the
      // back of it. Something is inconsistent — refuse rather than guess.
      return await refuse(
        {
          error:
            "this job's gift card is still only reserved, so the escrow's funding cannot be reconciled — nothing was moved. Cancel the job instead; that returns the gift.",
        },
        409,
      );
    }
    const { data: giftPreview, error: giftPreviewErr } = await supabaseAdmin.rpc(
      "restore_gift_card_for_job",
      { p_job_id: job.id, p_share_bps: 10000, p_dry_run: true },
    );
    const preview = (giftPreview ?? null) as { outcome?: string; applied_cents?: number } | null;
    const previewOutcome = giftPreviewErr ? null : preview?.outcome;
    if (previewOutcome !== "would_restore" && previewOutcome !== "already_restored") {
      // A null `error` is not proof of an answer — only the outcomes the
      // function actually defines are. PGRST202 here means the migration
      // that defines it has not deployed yet; either way the gift half of
      // this escrow is unknowable, so nothing may move.
      const why = giftPreviewErr
        ? `${giftPreviewErr.message}${(giftPreviewErr as { code?: string }).code ? ` (${(giftPreviewErr as { code?: string }).code})` : ""}`
        : `unrecognised outcome ${JSON.stringify(preview)}`;
      console.error(
        `[execute-dispute-split] gift valuation failed for job ${job.id}: ${why}`,
      );
      return await refuse(
        { error: "could not value this job's gift card — nothing was moved, retry" },
        503,
      );
    }
    giftAppliedCents = Number(preview?.applied_cents ?? 0);
    if (!Number.isFinite(giftAppliedCents) || giftAppliedCents < 0) {
      return await refuse({ error: "this job's gift card has no usable applied amount — refused" }, 409);
    }
  }

  const stripe = new Stripe(stripeSecretKey, { apiVersion: "2025-08-27.basil" });

  // ── 3. Re-verify the PaymentIntent against Stripe — never the DB row alone ─
  let paymentIntentId = job.stripe_payment_intent_id;
  if (!paymentIntentId && job.stripe_session_id) {
    try {
      const session = await stripe.checkout.sessions.retrieve(job.stripe_session_id, {
        expand: ["payment_intent"],
      });
      paymentIntentId = typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
      if (paymentIntentId) {
        // Backfill is a convenience, not a precondition — this run already has
        // the id in hand. Non-blocking, but never silently dropped: a failure
        // means the next path to need it pays for another session round-trip.
        const { error: backfillErr } = await supabaseAdmin
          .from("jobs")
          .update({ stripe_payment_intent_id: paymentIntentId })
          .eq("id", job.id);
        if (backfillErr) {
          console.error(
            `[execute-dispute-split] stripe_payment_intent_id backfill failed for job ${job.id}:`,
            backfillErr,
          );
        }
      }
    } catch (e) {
      console.warn(`[execute-dispute-split] could not retrieve session for job ${job.id}:`, e);
    }
  }
  if (!paymentIntentId && giftAppliedCents === 0) {
    return await refuse({ error: "no payment intent on file — cannot verify or split the escrow" }, 409);
  }

  // A wholly gift-funded job legitimately has no PaymentIntent: `redeem_gift_card`
  // flips it straight to 'escrow' out of the prepaid platform balance without
  // ever opening a checkout. Everything Stripe-shaped below is therefore
  // conditional, and settles to zero when there is no charge — the same shape
  // release-payout uses for its gift card branch.
  let pi: Stripe.PaymentIntent | null = null;
  let capturedCents = 0;
  let escrowChargeId: string | null = null;
  if (paymentIntentId) {
    try {
      pi = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ["latest_charge.balance_transaction"],
      });
    } catch (e) {
      console.error(`[execute-dispute-split] paymentIntents.retrieve failed for ${paymentIntentId}:`, e);
      return await refuse({ error: "could not verify the escrow charge — retry" }, 502);
    }
    if (pi.status !== "succeeded") {
      return await refuse(
        { error: `escrow charge not captured (PaymentIntent status: ${pi.status}) — split refused`, pi_status: pi.status },
        409,
      );
    }
    const received = pi.amount_received ?? pi.amount;
    if (!Number.isFinite(received) || (received as number) <= 0) {
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "warning",
        title: "Dispute split aborted — invalid captured amount",
        message:
          "execute-dispute-split could not compute a split: the PaymentIntent's captured amount was missing or non-positive. Nothing moved; the dispute is left unexecuted for manual review.",
        fields: { job_id: job.id, dispute_id: disputeId, payment_intent: paymentIntentId, captured_cents: String(received) },
      });
      return await refuse({ error: "escrow captured amount is missing or non-positive — split refused" }, 409);
    }
    capturedCents = received as number;
    escrowChargeId = typeof pi.latest_charge === "string"
      ? pi.latest_charge
      : pi.latest_charge?.id ?? null;
  }

  // The whole escrow, whatever paid for it. THE cap every leg is judged
  // against. On a gift-funded job the helper transfer has no
  // `source_transaction` (there is no charge to draw from), so Stripe cannot
  // enforce "never over-draw the escrow" server-side and this figure is the
  // only guard left standing.
  const escrowValueCents = capturedCents + giftAppliedCents;

  // Which charge — if any — the helper transfer may be drawn from.
  //
  // `source_transaction` makes Stripe enforce the escrow cap server-side, but
  // ONLY when that charge IS the escrow. On a MIXED job (a gift smaller than
  // the cost, with the shortfall collected by card) the PaymentIntent covers
  // just the shortfall, while the helper's leg is scaled off the whole budget
  // — so pinning the transfer to it asks Stripe to move more than the source
  // charge holds and `transfers.create` throws every time. That failure is
  // permanent: leg 1 returns before the poster's refund and the gift restore
  // ever run, so a retry reproduces it exactly and the escrow is stranded
  // with the dispute unexecutable.
  //
  // `release-payout` avoids this by skipping the whole PaymentIntent block for
  // any gift-card-funded job (index.ts:341) — it never refunds, so it never needs
  // `capturedCents`. This function does need it (the poster's cash leg draws
  // on the capture), so the charge is still retrieved; only its use as a
  // transfer SOURCE is withheld. `checkoutSessionCompleted.ts:617-619` states
  // the contract: a gift-funded job pays the helper from the platform balance,
  // never from the difference PI.
  //
  // When no gift contributed, the charge is the entire escrow and remains the
  // correct source — that path is unchanged.
  const transferSourceChargeId = giftAppliedCents > 0 ? null : escrowChargeId;

  // ── 4. Money math ────────────────────────────────────────────────────────
  //
  // Helper leg — the SAME shape release-payout uses, scaled by the split, so
  // that a 100/0 split settles to exactly what a full release would have paid:
  //
  //   helper budget share = budget × helperShare
  //   helper urgent share = netUrgentFee(urgent_fee) × helperShare
  //   platform commission = helperCommissionDollars(helper budget share, pct)
  //   helper payout       = budget share + urgent share − commission
  //
  // The commission comes from the ONE shared implementation
  // (`_shared/helperFees.ts`) — a local re-derivation is what put the two
  // payout paths a cent apart on 2,243 (budget, tier) pairs, and the parity
  // tests now fail on that drift. It applies to the helper's PORTION, not the
  // whole budget: the platform's cut of an award it only partly granted is
  // proportional to the award.
  //
  // Poster leg — a share of what was actually CAPTURED (budget + service fee +
  // tax + urgent fee), minus Stripe's 2.9%+$0.30, which Stripe keeps on a
  // refund. At a 0/100 split that is byte-for-byte what admin_refund_dispute
  // returns today, so the endpoints of this function and the endpoints of the
  // existing quick actions agree.
  //
  // The bases differ on purpose: a helper never earns the poster's service fee
  // or sales tax, but the poster paid them and gets their share back.
  const { data: feeSettings, error: feeSettingsErr } = await supabaseAdmin
    .from("platform_settings")
    .select("helper_fee_percent")
    .limit(1)
    .single();
  if (feeSettingsErr || feeSettings?.helper_fee_percent == null) {
    // Same rule as release-payout: refuse rather than settle money against a
    // platform_settings row we could not read at all. Kept as a config-sanity
    // assertion — the percent itself is no longer the fee fallback.
    console.error(`[execute-dispute-split] platform_settings read failed for job ${job.id}:`, feeSettingsErr);
    return await refuse({ error: "fee configuration unavailable — retry" }, 500);
  }
  // Fee fallback (profile-read failure only): frozen per-job rate, then the
  // FREE-tier rate. Identical chain to release-payout and
  // process-scheduled-payouts — every path that resolves a helper commission
  // must fall back to the same number, or the rate a helper is charged depends
  // on which path happened to settle their job. Derived from
  // DEFAULT_TIER_FEE_PERCENT, never a literal, so the ladder stays the single
  // source of truth. This used to fall back to
  // platform_settings.helper_fee_percent (10 in prod), which under-charged the
  // platform against a free helper's real 12%.
  const helperFeePercent = await getHelperFeePercent(
    supabaseAdmin,
    job.helper_id,
    job.helper_fee_percent ?? DEFAULT_TIER_FEE_PERCENT,
  );

  const perHelperBudget = Number(job.budget);
  const helperBudgetShareDollars = perHelperBudget * helperShare;
  const helperUrgentShareDollars = netUrgentFeeDollars(job.urgent_fee) * helperShare;
  const platformFeeDollars = helperCommissionDollars(helperBudgetShareDollars, helperFeePercent);
  const helperPayoutDollars =
    helperBudgetShareDollars + helperUrgentShareDollars - platformFeeDollars;
  const helperCents = Math.max(0, Math.round(helperPayoutDollars * 100));
  const platformFeeCents = Math.round(platformFeeDollars * 100);

  // Stripe's processing floor applies only to money Stripe actually processed.
  // The gift leg has none: create-gift-card-checkout already charged the DONOR that
  // cost when the gift was bought, so withholding it again here would take the
  // same cut twice out of one dollar.
  const nonRefundableCents = pi ? actualOrEstimatedFeeCents(pi, capturedCents) : 0;
  const refundableCents = Math.max(0, capturedCents - nonRefundableCents);
  const refundCents = Math.max(0, Math.round(refundableCents * posterShare));

  // Gift leg. Basis points, not dollars: the amount is computed inside
  // `restore_gift_card_for_job` from the applied value it alone knows, so the
  // formula lives in exactly one place. `Math.floor` mirrors that function's
  // integer division so this figure and the row it eventually writes agree to
  // the cent — and rounds toward the platform, never toward minting money.
  const giftShareBps = Math.min(10000, Math.max(0, Math.round(posterShare * 10000)));
  const giftRestoreCents = Math.floor((giftAppliedCents * giftShareBps) / 10000);

  if (helperCents === 0 && refundCents === 0 && giftRestoreCents === 0) {
    // Nothing to move — a degenerate split, or a capture entirely consumed by
    // the Stripe fee. Never a silent success: no ledger row would be written,
    // so this alert is the only durable trace.
    console.error(
      `[execute-dispute-split] nothing to move for dispute ${disputeId} ` +
        `(helperShare=${helperShare}, capturedCents=${capturedCents}, nonRefundableCents=${nonRefundableCents}).`,
    );
    await postSlackOpsAlert({
      kind: "custom",
      severity: "info",
      title: "Dispute split resolved with $0 moved",
      message:
        "A decided split computed to $0 for both sides. Nothing was transferred or refunded. Verify this was intended.",
      fields: {
        dispute_id: disputeId,
        job_id: job.id,
        helper_share: helperShare,
        captured_cents: capturedCents,
        gift_applied_cents: giftAppliedCents,
        non_refundable_cents: nonRefundableCents,
      },
    });
    return await refuse({ error: "this split computes to $0 for both sides — nothing to execute" }, 422);
  }

  // HARD CAP, the same one release-payout carries: never move more than the
  // escrow was actually funded with. `budget` is poster-writable while the job
  // is unpaid, so a raised budget must not become a transfer out of the
  // platform's own balance. `source_transaction` on the transfer below is the
  // second, independent guard — Stripe itself then refuses to over-draw the
  // charge — but a gift-funded job has no charge to draw from, so on that path
  // this assertion stands alone. The gift leg counts against the cap: it is
  // real value leaving the platform, just denominated in credit rather than
  // dollars.
  if (helperCents + refundCents + giftRestoreCents > escrowValueCents) {
    console.error(
      `[execute-dispute-split] REFUSING: helper ${helperCents}c + refund ${refundCents}c + gift ${giftRestoreCents}c exceeds escrow ${escrowValueCents}c (captured ${capturedCents}c + gift ${giftAppliedCents}c) (dispute ${disputeId}).`,
    );
    await postSlackOpsAlert({
      kind: "custom",
      severity: "critical",
      title: "Dispute split blocked — exceeds captured escrow",
      message:
        "A dispute split computed to more than the escrow was funded with. Nothing moved. The job's budget may have been altered after checkout.",
      fields: {
        dispute_id: disputeId,
        job_id: job.id,
        helper_cents: helperCents,
        refund_cents: refundCents,
        gift_restore_cents: giftRestoreCents,
        captured_cents: capturedCents,
        gift_applied_cents: giftAppliedCents,
        escrow_value_cents: escrowValueCents,
      },
    });
    return await refuse(
      {
        error: "split exceeds the captured escrow — refused",
        helper_cents: helperCents,
        refund_cents: refundCents,
        gift_restore_cents: giftRestoreCents,
        captured_cents: capturedCents,
        escrow_value_cents: escrowValueCents,
      },
      409,
    );
  }

  // ── 5. Ledger reads decide which legs are still outstanding ──────────────
  // Both reads fail CLOSED: a failed read is indistinguishable from "no prior
  // movement", and proceeding on that would double-pay once Stripe's
  // idempotency window (~24h) has expired.
  const { data: transferRows, error: transferReadErr } = await supabaseAdmin
    .from("payout_transfers")
    // amount_cents / platform_fee_cents are read, not just the status: when the
    // transfer leg is SKIPPED because a prior attempt settled it, the ledger is
    // the only truthful record of what moved. Recomputing here can disagree —
    // `getHelperFeePercent` resolves the helper's LIVE subscription tier, so a
    // tier change between attempts would make this run report (and stamp on the
    // dispute) a figure no transfer was ever made at.
    // `metadata` too: only a row THIS split wrote (metadata.dispute_id) is one
    // of its legs. Any other live row is money another path moved, and the
    // in-claim check at 6c refuses over it (lh-money-escrow round 3, H3).
    .select("id, stripe_transfer_id, status, amount_cents, platform_fee_cents, metadata")
    .eq("job_id", job.id);
  if (transferReadErr) {
    console.error(`[execute-dispute-split] payout_transfers read failed for job ${job.id}:`, transferReadErr);
    return await refuse({ error: "duplicate-transfer check failed — retry" }, 500);
  }
  // 'reversed' counts as settled: money DID move once and was clawed back, so
  // re-paying is an operator decision, not an automatic retry. Only 'failed'
  // (money never left) is safely re-payable, and it salts the idempotency key
  // below so Stripe issues a genuinely new attempt rather than replaying the
  // cached failure.
  // Typed explicitly (not inferred from `.find`) so the Stripe-recovery branch
  // below can synthesise a settled row without a cast through `undefined`.
  type SettledTransfer = {
    stripe_transfer_id: string | null;
    status: string | null;
    amount_cents: number | null;
    platform_fee_cents: number | null;
  };
  const isOwnRow = (r: { metadata?: unknown }) =>
    (r.metadata as { dispute_id?: unknown } | null | undefined)?.dispute_id === disputeId;
  let settledTransfer: SettledTransfer | undefined = (transferRows ?? []).find((r) =>
    ["pending", "paid", "reversed"].includes(r.status as string) && isOwnRow(r)
  );
  const failedTransferCount = (transferRows ?? []).filter((r) => r.status === "failed").length;

  // Last-resort cross-check for the TRANSFER leg, the exact mirror of the
  // refund heal below — and for the exact same reason.
  //
  // The idempotency key stops protecting anything after Stripe's ~24h replay
  // window, so "transfer succeeded → `payout_transfers` insert failed →
  // nobody retried for a day" would let this function issue a SECOND real
  // transfer to the Helpr. The refund leg already guards that case by asking
  // Stripe; the transfer leg was relying on the ledger alone, which is the one
  // record we have just proved can be missing.
  //
  // Two independent recovery sources, both already in hand and neither
  // dependent on the window:
  //   1. `dispute.execution_transfer_id` — `markFailed` records it precisely
  //      when the transfer settled but its ledger write did not (:895).
  //   2. Stripe's own transfer list for this job's `transfer_group`, matched
  //      on `metadata.dispute_id`, which every transfer here carries.
  // Kept off the first-attempt path, where there is nothing to find.
  if (!settledTransfer && isResume && helperCents > 0) {
    let recovered: string | null = null;
    try {
      const priorTransfers = await stripe.transfers.list({
        transfer_group: `job_${job.id}`,
        limit: 100,
      });
      const match = (priorTransfers?.data ?? []).find(
        (t: Stripe.Transfer) => t?.metadata?.dispute_id === disputeId,
      );
      if (match) recovered = match.id;
    } catch (e) {
      // Fail CLOSED: an unverifiable transfer history is exactly the case
      // this check exists for, so never fall through to "nothing was paid".
      console.error(`[execute-dispute-split] transfers.list failed for job ${job.id}:`, e);
      return await refuse({ error: "could not verify prior transfers — retry" }, 502);
    }
    // The dispute row's own record is the second source. Only trusted when
    // Stripe confirms the object exists, so a stale or hand-edited value can
    // never make this function skip a payout that never happened.
    if (!recovered && dispute.execution_transfer_id) {
      try {
        const stamped = await stripe.transfers.retrieve(dispute.execution_transfer_id);
        if (stamped?.id) recovered = stamped.id;
      } catch (e) {
        console.error(
          `[execute-dispute-split] could not verify stamped transfer ${dispute.execution_transfer_id}:`,
          e,
        );
        return await refuse({ error: "could not verify prior transfers — retry" }, 502);
      }
    }
    if (recovered) {
      // Stamp the recovered leg on the dispute FIRST (round-5 review, LOW-4):
      // the ledger heal below is best-effort, and every later exit of this run
      // — a claim refusal, a refund failure — would otherwise leave the leg
      // recorded nowhere, so rpc_supersede_dispute_decision could read
      // "nothing moved". Scoped to a still-decided row; failure is logged.
      const { error: stampLegErr } = await supabaseAdmin
        .from("disputes")
        .update({ execution_transfer_id: recovered })
        .eq("id", disputeId)
        .eq("status", "decided");
      if (stampLegErr) {
        console.error(`[execute-dispute-split] could not stamp recovered transfer ${recovered} on dispute ${disputeId}:`, stampLegErr);
      }
      console.warn(
        `[execute-dispute-split] transfer ${recovered} for dispute ${disputeId} exists at Stripe but not in payout_transfers — treating the leg as settled and healing the ledger.`,
      );
      settledTransfer = {
        stripe_transfer_id: recovered,
        status: "paid",
        amount_cents: helperCents,
        platform_fee_cents: platformFeeCents,
      };
      // Heal the divergence we just proved. Best-effort: the leg is settled
      // either way, so a failed write must not block the rest of the split.
      const { error: healErr } = await supabaseAdmin.from("payout_transfers").upsert(
        {
          job_id: job.id,
          helper_id: job.helper_id,
          stripe_transfer_id: recovered,
          amount_cents: helperCents,
          platform_fee_cents: platformFeeCents,
          status: "paid",
          initiated_by: "admin",
          initiated_by_user_id: adminUserId,
          metadata: {
            source: "execute_dispute_split",
            dispute_id: disputeId,
            helper_share: helperShare,
            recovered_from_stripe: true,
          },
        },
        { onConflict: "stripe_transfer_id", ignoreDuplicates: true },
      );
      if (healErr) {
        console.error(
          `[execute-dispute-split] could not heal the payout_transfers row for ${recovered}:`,
          healErr,
        );
      }
    }
  }

  // Every refund on the job, whatever wrote it. The first draft filtered
  // source='dispute_split', which both hid a Quick Refund / cancellation refund
  // from this split and counted ANOTHER dispute's split refund as this one's
  // leg (round 3, H3). Only this dispute's own row settles the refund leg; the
  // rest are refused over at 6c.
  const { data: refundRows, error: refundReadErr } = await supabaseAdmin
    .from("payment_refunds")
    .select("id, stripe_refund_id, source, amount_cents, metadata")
    .eq("job_id", job.id);
  if (refundReadErr) {
    console.error(`[execute-dispute-split] payment_refunds read failed for job ${job.id}:`, refundReadErr);
    return await refuse({ error: "duplicate-refund check failed — retry" }, 500);
  }
  let settledRefund: { id: string | null; stripe_refund_id: string | null; source: string | null } | undefined =
    (refundRows ?? []).find((r) => r.source === "dispute_split" && isOwnRow(r));

  // Last-resort cross-check, ONLY on a resume with an empty refund ledger.
  //
  // Stripe replays a reused idempotency key for about 24 hours. Past that
  // window the key is meaningless, so the sequence "refund succeeded → ledger
  // write failed → nobody retried for a day" would let this function issue a
  // SECOND real refund. Ask Stripe directly instead: every refund this function
  // creates carries `metadata.dispute_id`, so one already out for this dispute
  // is recognisable no matter how long ago it was made. Kept off the first-
  // attempt path, where there is by definition nothing to find.
  if (!settledRefund && isResume && refundCents > 0 && paymentIntentId) {
    try {
      const priorRefunds = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
      const match = (priorRefunds?.data ?? []).find(
        (r: Stripe.Refund) => r?.metadata?.dispute_id === disputeId,
      );
      if (match) {
        console.warn(
          `[execute-dispute-split] refund ${match.id} for dispute ${disputeId} exists at Stripe but not in payment_refunds — treating the leg as settled and healing the ledger.`,
        );
        settledRefund = { id: null, stripe_refund_id: match.id, source: "dispute_split" };
        // Heal the divergence we just proved, so the next run answers from the
        // ledger instead of paying for another Stripe round-trip. Best-effort:
        // the leg is already settled either way, so a failed write must not
        // block the rest of the settlement.
        const { error: healErr } = await supabaseAdmin.from("payment_refunds").upsert(
          {
            job_id: job.id,
            customer_id: job.customer_id,
            stripe_refund_id: match.id,
            stripe_payment_intent_id: paymentIntentId,
            amount_cents: Math.round(Number(match.amount ?? 0)),
            currency: match.currency ?? "usd",
            is_partial: true,
            reason: "dispute split — poster's share (ledger row recovered from Stripe)",
            source: "dispute_split",
            initiated_by_user_id: adminUserId,
            metadata: { dispute_id: disputeId, recovered_from_stripe: true },
          },
          { onConflict: "stripe_refund_id", ignoreDuplicates: true },
        );
        if (healErr) {
          console.error(
            `[execute-dispute-split] could not heal the payment_refunds row for ${match.id}:`,
            healErr,
          );
        }
      }
    } catch (e) {
      // Fail CLOSED: an unverifiable refund history is exactly the case this
      // check exists for, so never fall through to "no prior refund".
      console.error(`[execute-dispute-split] refunds.list failed for ${paymentIntentId}:`, e);
      return await refuse({ error: "could not verify prior refunds — retry" }, 502);
    }
  }

  // A settled payout on a job whose split awards the Helpr NOTHING is a
  // contradiction: the money already left toward the Helpr, and refunding the
  // poster their "whole" share on top would pay the same escrow out twice. The
  // payment_status gate above normally makes this unreachable (a real payout
  // leaves the job 'released'), so reaching it means the DB and Stripe already
  // disagree — refuse and let a human look.
  if (settledTransfer && helperCents === 0) {
    console.error(
      `[execute-dispute-split] REFUSING dispute ${disputeId}: split awards the Helpr $0 but transfer ${settledTransfer.stripe_transfer_id} already settled on job ${job.id}.`,
    );
    await postSlackOpsAlert({
      kind: "payout_failed",
      severity: "critical",
      title: "Dispute split contradicts an already-settled payout",
      message:
        "A split awarding the Helpr nothing was run against a job that already has a settled payout transfer. Refunding the poster in full would pay the same escrow out twice. Nothing moved — reconcile by hand.",
      fields: {
        dispute_id: disputeId,
        job_id: job.id,
        existing_transfer_id: String(settledTransfer.stripe_transfer_id),
        transfer_status: String(settledTransfer.status),
      },
    });
    return await refuse(
      {
        error:
          "a payout for this job has already settled, so a split awarding the Helpr nothing cannot be executed — reconcile this one by hand",
        existing_transfer_id: settledTransfer.stripe_transfer_id,
      },
      409,
    );
  }

  // What the helper leg is actually worth, once the ledger has had its say. On
  // a first attempt these are this run's computed figures; on a resume that
  // skips a settled transfer they are the LEDGER's, which is the only record of
  // what really left. Everything downstream — the cap re-check, the job's
  // frozen fee, the dispute stamp, the notification, the response — reports
  // these, never the recomputed pair.
  const ledgerHelperCents = Number(settledTransfer?.amount_cents);
  const ledgerFeeCents = Number(settledTransfer?.platform_fee_cents);
  const movedHelperCents = settledTransfer && Number.isFinite(ledgerHelperCents)
    ? ledgerHelperCents
    : helperCents;
  const movedPlatformFeeCents = settledTransfer && Number.isFinite(ledgerFeeCents)
    ? ledgerFeeCents
    : platformFeeCents;

  // Re-assert the hard cap against what ACTUALLY moved. The check in section 4
  // ran on this run's arithmetic; if the ledger says a bigger transfer already
  // went out, the cap has to be judged on that number instead — otherwise a
  // resume could refund the poster on top of an over-sized prior payout.
  if (
    movedHelperCents !== helperCents &&
    movedHelperCents + refundCents + giftRestoreCents > escrowValueCents
  ) {
    console.error(
      `[execute-dispute-split] REFUSING resume of dispute ${disputeId}: settled transfer ${movedHelperCents}c + refund ${refundCents}c + gift ${giftRestoreCents}c exceeds escrow ${escrowValueCents}c.`,
    );
    await postSlackOpsAlert({
      kind: "payout_failed",
      severity: "critical",
      title: "Dispute split resume blocked — settled payout plus refund exceeds the capture",
      message:
        "A resumed split would have refunded the poster on top of an already-settled transfer that, combined, exceeds what the PaymentIntent captured. Nothing moved — reconcile by hand.",
      fields: {
        dispute_id: disputeId,
        job_id: job.id,
        settled_transfer_cents: movedHelperCents,
        refund_cents: refundCents,
        gift_restore_cents: giftRestoreCents,
        captured_cents: capturedCents,
        gift_applied_cents: giftAppliedCents,
        escrow_value_cents: escrowValueCents,
      },
    });
    return await refuse(
      {
        error: "the already-settled payout plus this refund exceeds the captured escrow — refused",
        settled_transfer_cents: movedHelperCents,
        refund_cents: refundCents,
      },
      409,
    );
  }

  // ── 6. Claim the execution BEFORE any Stripe call ────────────────────────
  // Pinned to the decided_at this run read (round-4 review): a decision that was
  // superseded and re-decided between the read and this claim is a different
  // decision, and this run's arithmetic belongs to the old one.
  let executionClaim = supabaseAdmin
    .from("disputes")
    .update({ execution_status: "executing", execution_started_at: new Date().toISOString() })
    .eq("id", disputeId)
    .eq("status", "decided");
  executionClaim = dispute.decided_at == null
    ? executionClaim.is("decided_at", null)
    : executionClaim.eq("decided_at", dispute.decided_at);
  const { data: claimed, error: claimErr } = await executionClaim
    .or(
      `execution_status.is.null,execution_status.in.(${CLAIMABLE_EXECUTION_STATES.join(",")})`,
    )
    .select("id");
  if (claimErr) {
    console.error(`[execute-dispute-split] execution claim failed for dispute ${disputeId}:`, claimErr);
    return await refuse({ error: "could not claim this split for execution — retry" }, 500);
  }
  if (!claimed || claimed.length === 0) {
    return await refuse(
      { error: "this split is no longer executable — it may have already settled" },
      409,
    );
  }

  // ── 6b. Claim the JOB's settlement, not just this dispute's execution ────
  //
  // Step 6 above is a real claim and it is enough for split-vs-split: exactly
  // one caller flips `execution_status` to 'executing'. What it cannot see is
  // `create-payment`'s admin path. Quick Release checks `jobs.status ===
  // 'disputed'` and nothing else, and `rpc_decide_dispute` leaves the job
  // disputed until this function flips it — so an admin clicking Quick Release
  // while this tick runs passes its gate, and its `dispute-release-<job>` key
  // is disjoint from this function's `dispute-split-*` keys. The Helpr receives
  // BOTH transfers, and the poster receives this split's refund leg on top.
  // `payout_transfers` does not stop it: that guard is a read-then-write with
  // no lock, and it says nothing about the refund leg at all.
  //
  // `claim_dispute_settlement` is the one lock both functions share
  // (20260915034822). Action 'split' is neither 'release' nor 'refund', so
  // either admin action arriving now is refused with `held_by_split`, and this
  // function is refused if one of them got here first.
  const { data: settlementClaimRow, error: settlementClaimErr } = await supabaseAdmin.rpc(
    "claim_dispute_settlement",
    { _job_id: job.id, _action: "split", _admin_id: null },
  );
  // Fails CLOSED, with ONE exception: PGRST202 means the migration has not
  // deployed yet, and this function has always run without the lock. Refusing
  // there would strand every decided dispute until the migration lands, which
  // is a worse failure than the race it guards — and step 6's own claim still
  // covers split-vs-split in the meantime.
  const settlementClaimCode = (settlementClaimErr as { code?: string } | null)?.code;
  if (settlementClaimErr && settlementClaimCode !== "PGRST202") {
    console.error(`[execute-dispute-split] claim_dispute_settlement failed for job ${job.id}:`, settlementClaimErr);
    await markFailed(supabaseAdmin, disputeId, "could not take the job settlement lock");
    return json({ error: "could not take the settlement lock on this job — retry" }, 503);
  }
  const settlementVerdict = (settlementClaimRow as { verdict?: string } | null)?.verdict;
  const settlementClaim: { token: string | null } = {
    token: (settlementClaimRow as { token?: string } | null)?.token ?? null,
  };
  // `joined`: another run of THIS split holds the claim (two admins on "Retry
  // settlement", a double click). It used to be let through with no token and
  // moved money with no claim row of its own (lh-money-escrow round 3, M3). The
  // holder settles; the joiner moves nothing, writes nothing on the dispute the
  // holder owns, and pages nobody.
  if (settlementClaimErr == null && settlementVerdict === "joined") {
    // Step 6 above re-stamped 'executing' over whatever this dispute said. If
    // it said 'failed', put that back (round-5 review, LOW-3): the queue must
    // not show a run in progress that this caller never started, and the
    // failure reason is what the admin needs. Pinned to 'executing' so the
    // holder's own later write (executed / failed) always wins.
    if (dispute.execution_status === "failed") {
      const { error: restoreErr } = await supabaseAdmin
        .from("disputes")
        .update({ execution_status: "failed", execution_error: dispute.execution_error ?? null })
        .eq("id", disputeId)
        .eq("status", "decided")
        .eq("execution_status", "executing");
      if (restoreErr) console.error(`[execute-dispute-split] could not restore 'failed' on dispute ${disputeId}:`, restoreErr);
    }
    const retryAfter = (settlementClaimRow as { expires_at?: string } | null)?.expires_at ?? null;
    return json(
      {
        error: retryAfter
          ? `this split is already being executed — nothing more was done. Refresh to see the result; if it has not settled, retry after ${retryAfter}.`
          : "this split is already being executed — nothing more was done. Refresh to see the result; if it has not settled, retry in about ten minutes.",
        inProgress: true,
        retryAfter,
      },
      409,
    );
  }
  if (settlementClaimErr == null && settlementVerdict !== "claimed") {
    const verdictText = String(settlementVerdict ?? "");
    // Three different refusals, told apart, because each sends a person to do
    // something different (lh-money-escrow round 2: every one of them used to
    // say "an admin is settling the same job… retry once it finishes").
    //   held_by_*       a live settlement is moving this escrow — retry later.
    //   stuck_*         a DEAD holder may have moved money — reconcile first
    //                   (the claim function has paged ops with the clear step).
    //   not_disputed /  the job is not awaiting settlement, or its escrow is
    //   not_settleable  not held — nothing to retry until that is explained.
    const holder = verdictText.replace(/^held_by_|^stuck_/, "");
    const kind = verdictText.startsWith("held_by_") ? "held" : verdictText.startsWith("stuck_") ? "stuck" : "unsettleable";
    const holderLabel = holder === "sweep" ? "the 72h auto-resolve sweep" : holder === "split" ? "another split execution" : `an admin ${holder}`;
    const paymentStatus = (settlementClaimRow as { payment_status?: string } | null)?.payment_status ?? null;
    console.error(`[execute-dispute-split] refusing dispute ${disputeId}: job ${job.id} settlement claim answered ${verdictText}`);
    await markFailed(supabaseAdmin, disputeId, `job settlement claim refused: ${verdictText}`, {}, job.id, settlementClaim);
    await postSlackOpsAlert({
      kind: "money_at_risk",
      severity: kind === "held" ? "warning" : "critical",
      title: kind === "held"
        ? "Dispute split refused — the same job is being settled"
        : kind === "stuck"
          ? "Dispute split refused — an earlier settlement died part-way"
          : "Dispute split refused — the job is not awaiting settlement",
      message: kind === "held"
        ? `execute-dispute-split was asked to settle dispute ${disputeId} on job ${job.id}, but ${holderLabel} is already moving that escrow. Nothing was moved here; retry once that finishes.`
        : kind === "stuck"
          ? `execute-dispute-split was asked to settle dispute ${disputeId} on job ${job.id}, but ${holderLabel} took the settlement lock and never released it — it may have moved money. Nothing was moved here; reconcile against Stripe and clear the lock (see the stale-claim page) before retrying.`
          : `execute-dispute-split was asked to settle dispute ${disputeId} on job ${job.id}, but the claim answered ${verdictText}${paymentStatus ? ` (payment ${paymentStatus})` : ""}. Nothing was moved; find out what settled or froze this escrow before retrying.`,
      fields: { dispute_id: disputeId, job_id: job.id, verdict: verdictText },
    });
    return json(
      {
        error: kind === "held"
          ? `this job's escrow is being settled by ${holderLabel} — nothing was moved`
          : kind === "stuck"
            ? `an earlier settlement of this job died part-way and may have moved money — nothing was moved; reconcile first`
            : `this job is not awaiting settlement (${verdictText}) — nothing was moved`,
        heldBy: kind === "held" ? holder : null,
        verdict: verdictText,
      },
      409,
    );
  }

  // ── 6c. Money another path already moved — asked INSIDE the claim ────────
  //
  // lh-money-escrow round 3, H3. Everything above judged the legs by what THIS
  // split recorded. A job's escrow can also have been moved by a Quick
  // Release / Quick Refund whose flip failed, a cancellation refund, or a
  // refund with no ledger row at all — and the split then paid its own legs on
  // top. Read every leg any path moved, now that no other claimant can add
  // one, and refuse + page critical on any that is not this dispute's:
  //   • a live payout_transfers row without this dispute's metadata;
  //   • a payment_refunds row that is not this dispute's split refund;
  //   • Stripe `amount_refunded` above this split's own refunds (a refund that
  //     reached Stripe with no ledger row), attributed with refunds.list.
  // Fails CLOSED: an unreadable answer is a refusal, never "nothing moved".
  {
    // The DISPUTE first, under the claim (round-4 review): everything above was
    // decided from the row read at step 1. A supersede or re-decision that
    // committed since then means this run is executing a decision that no
    // longer stands. Nothing has moved yet, so refuse and hand the claim back;
    // markFailed is scoped to status 'decided' and leaves a changed row alone.
    const { data: nowDispute, error: nowDisputeErr } = await supabaseAdmin
      .from("disputes")
      .select("id, status, decided_at, payout_split, execution_status")
      .eq("id", disputeId)
      .maybeSingle();
    if (nowDisputeErr || !nowDispute) {
      await markFailed(supabaseAdmin, disputeId, `could not re-read the dispute under the claim: ${nowDisputeErr?.message ?? "not found"}`, {}, job.id, settlementClaim);
      return json({ error: "could not re-read this dispute before moving money — nothing was moved, retry" }, 503);
    }
    const decisionChanged = nowDispute.status !== "decided" ||
      String(nowDispute.decided_at ?? "") !== String(dispute.decided_at ?? "") ||
      JSON.stringify(nowDispute.payout_split ?? null) !== JSON.stringify(dispute.payout_split ?? null) ||
      nowDispute.execution_status === "executed";
    if (decisionChanged) {
      console.error(`[execute-dispute-split] dispute ${disputeId} changed under the claim (status ${nowDispute.status}, execution ${nowDispute.execution_status}) — refusing`);
      await markFailed(supabaseAdmin, disputeId, "the decision changed while this split was starting", {}, job.id, settlementClaim);
      return json(
        { error: "this decision changed while the split was starting (superseded, re-decided or already executed) — nothing was moved; refresh", decisionChanged: true },
        409,
      );
    }

    const foreign: string[] = [];
    let ownRefundCents = 0;
    let checkFailed: string | null = null;

    const [{ data: liveTransfers, error: liveTransferErr }, { data: liveRefunds, error: liveRefundErr }] = await Promise.all([
      supabaseAdmin.from("payout_transfers").select("id, stripe_transfer_id, status, metadata").eq("job_id", job.id),
      supabaseAdmin.from("payment_refunds").select("id, stripe_refund_id, source, amount_cents, metadata").eq("job_id", job.id),
    ]);
    if (liveTransferErr || liveRefundErr) {
      checkFailed = `ledger read failed: ${(liveTransferErr ?? liveRefundErr)?.message}`;
    } else {
      for (const t of liveTransfers ?? []) {
        if (["pending", "paid", "reversed"].includes(t.status as string) && !isOwnRow(t)) {
          foreign.push(`payout transfer ${t.stripe_transfer_id ?? t.id} (${t.status}, ${(t.metadata as { source?: string } | null)?.source ?? "no source"})`);
        }
      }
      for (const r of liveRefunds ?? []) {
        if (r.source === "dispute_split" && isOwnRow(r)) ownRefundCents += Math.max(0, Number(r.amount_cents ?? 0));
        else foreign.push(`refund ${r.stripe_refund_id ?? r.id} (${r.source ?? "no source"})`);
      }
    }

    if (!checkFailed && paymentIntentId) {
      try {
        const fresh = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ["latest_charge"] });
        let charge = (fresh as { latest_charge?: unknown }).latest_charge as
          | { id?: string; amount_refunded?: number }
          | string
          | null
          | undefined;
        if (typeof charge === "string") charge = await stripe.charges.retrieve(charge);
        const refundedAtStripe = Number((charge as { amount_refunded?: number } | null | undefined)?.amount_refunded ?? 0);
        if (refundedAtStripe > ownRefundCents) {
          // Stripe holds more refunded money than this split's ledger rows.
          // Attribute it: this split's own refunds carry metadata.dispute_id
          // (one may be missing from the ledger, which the resume heals).
          const refunds = await stripe.refunds.list({ payment_intent: paymentIntentId, limit: 100 });
          let ownAtStripe = 0;
          for (const r of (refunds?.data ?? []) as Array<{ id: string; amount?: number; status?: string; metadata?: { dispute_id?: string } }>) {
            if (r.status === "failed" || r.status === "canceled") continue;
            if (r.metadata?.dispute_id === disputeId) ownAtStripe += Number(r.amount ?? 0);
            else foreign.push(`Stripe refund ${r.id} (no ledger row for this dispute)`);
          }
          if (refundedAtStripe > ownAtStripe && !foreign.some((f) => f.startsWith("Stripe refund") || f.startsWith("refund "))) {
            foreign.push(`Stripe shows ${refundedAtStripe}¢ refunded on the charge, ${ownAtStripe}¢ of it this split's`);
          }
        }
      } catch (e) {
        checkFailed = `Stripe refund check failed: ${(e as Error).message}`;
      }
    }

    // Transfers at Stripe in the job's group (every payout path tags
    // `job_<id>`) that are not this dispute's and that no ledger row records:
    // a Quick Release or payout whose ledger write failed. A ledger-recorded
    // one was already judged above. This split's own unrecorded transfer
    // (metadata.dispute_id) is the resume recovery's to adopt, not foreign.
    if (!checkFailed) {
      try {
        const ledgerIds = new Set((liveTransfers ?? []).map((t) => t.stripe_transfer_id));
        const grouped = await stripe.transfers.list({ transfer_group: `job_${job.id}`, limit: 100 });
        for (const t of (grouped?.data ?? []) as Array<{ id: string; amount?: number; amount_reversed?: number; metadata?: { dispute_id?: string } }>) {
          if (Number(t.amount ?? 0) - Number(t.amount_reversed ?? 0) <= 0) continue;
          if (t.metadata?.dispute_id === disputeId || ledgerIds.has(t.id)) continue;
          foreign.push(`Stripe transfer ${t.id} (no ledger row, not this dispute's)`);
        }
      } catch (e) {
        checkFailed = `Stripe transfer check failed: ${(e as Error).message}`;
      }
    }

    if (checkFailed) {
      console.error(`[execute-dispute-split] foreign-money check failed for dispute ${disputeId} (job ${job.id}): ${checkFailed}`);
      await markFailed(supabaseAdmin, disputeId, `could not verify what other paths moved: ${checkFailed}`, {}, job.id, settlementClaim);
      return json({ error: "could not verify whether another path already moved this escrow — nothing was moved, retry" }, 503);
    }
    if (foreign.length > 0) {
      console.error(`[execute-dispute-split] REFUSING dispute ${disputeId}: money already moved by another path on job ${job.id}: ${foreign.join("; ")}`);
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "critical",
        title: "Dispute split refused — money already moved by another path",
        message:
          `execute-dispute-split was asked to settle dispute ${disputeId} on job ${job.id}, but part of this escrow was already moved outside this split: ${foreign.join("; ")}. ` +
          "Nothing was moved by the split. Do not Retry settlement until the ledger matches Stripe; reconcile by hand (supersede the decision only if nothing moved).",
        fields: { dispute_id: disputeId, job_id: job.id, foreign: foreign.join("; ").slice(0, 500) },
      });
      await markFailed(supabaseAdmin, disputeId, `money already moved by another path: ${foreign.join("; ")}`, {}, job.id, settlementClaim);
      return json(
        {
          error: "part of this escrow was already moved outside this split — nothing was moved; reconcile before retrying",
          foreignMoney: foreign,
        },
        409,
      );
    }
  }

  // Stamp the settlement claim at each money step (round 3, M2), immediately
  // before the Stripe call. A claim only STICKS on its holder's death once
  // stamped; every refusal above left it unstamped, so a failed release there
  // expires instead of paging critical. No stamp, no money: false means the
  // claim is gone. The one tokenless case is the migration-lag window
  // (PGRST202) this function has always run through without the lock.
  const stampMoneyStep = async (): Promise<boolean> => {
    if (!settlementClaim.token) return settlementClaimCode === "PGRST202";
    const { data: stamped, error: stampErr } = await supabaseAdmin.rpc("stamp_dispute_settlement_claim", {
      _job_id: job.id,
      _token: settlementClaim.token,
    });
    if (stampErr) console.error(`[execute-dispute-split] stamp_dispute_settlement_claim failed for job ${job.id}:`, stampErr);
    return !stampErr && stamped === true;
  };
  const lostClaim = async (leg: string, settled: Parameters<typeof markFailed>[3] = {}) => {
    await markFailed(supabaseAdmin, disputeId, `settlement lock lost before the ${leg} — nothing moved on this leg`, settled, job.id, settlementClaim);
    return json({ error: `the settlement lock on this job was lost before the ${leg} — nothing was moved on it; retry` }, 409);
  };

  // ── 7. Leg one: transfer the helper's share ──────────────────────────────
  let transferId: string | null = settledTransfer?.stripe_transfer_id ?? null;
  if (helperCents > 0 && !settledTransfer) {
    const { data: helper, error: helperErr } = await supabaseAdmin
      .from("profiles")
      .select("stripe_account_id, full_name")
      .eq("user_id", job.helper_id)
      .maybeSingle();
    if (helperErr) {
      // A transient read must not masquerade as "helper never onboarded".
      console.error(`[execute-dispute-split] helper profile read failed for ${job.helper_id}:`, helperErr);
      await markFailed(supabaseAdmin, disputeId, "helper profile read failed", {}, job.id, settlementClaim);
      return json({ error: "Helpr profile read failed — retry" }, 500);
    }
    if (!helper?.stripe_account_id) {
      await markFailed(supabaseAdmin, disputeId, "helper has not completed Stripe Connect onboarding", {}, job.id, settlementClaim);
      return json(
        { error: "the Helpr has not finished setting up their payout account — nothing was moved" },
        409,
      );
    }

    let account;
    try {
      account = await stripe.accounts.retrieve(helper.stripe_account_id);
    } catch (e) {
      console.error(`[execute-dispute-split] accounts.retrieve failed for ${helper.stripe_account_id}:`, e);
      await markFailed(supabaseAdmin, disputeId, "could not verify the Helpr's Connect account", {}, job.id, settlementClaim);
      return json({ error: "could not verify the Helpr's payout account — retry" }, 502);
    }
    if (!account.payouts_enabled || !account.charges_enabled) {
      await markFailed(supabaseAdmin, disputeId, "helper Connect account is not fully active", {}, job.id, settlementClaim);
      return json(
        {
          error: "the Helpr's payout account is not fully active — nothing was moved",
          payouts_enabled: account.payouts_enabled,
          charges_enabled: account.charges_enabled,
        },
        409,
      );
    }

    if (!(await stampMoneyStep())) return await lostClaim("transfer");

    let transfer: Stripe.Transfer;
    try {
      transfer = await stripe.transfers.create(
        {
          amount: helperCents,
          currency: "usd",
          destination: helper.stripe_account_id,
          // Ties the transfer to the exact charge that funded it, so Stripe
          // enforces the "never over-draw the escrow" cap server-side even if
          // the assertion above is ever bypassed. Null on any gift-funded job
          // (pure OR mixed) — see `transferSourceChargeId` above; there the
          // `escrowValueCents` cap is the guard.
          ...(transferSourceChargeId ? { source_transaction: transferSourceChargeId } : {}),
          transfer_group: `job_${job.id}`,
          description: `Helpr dispute split for job ${job.id} — ${job.title}`,
          metadata: {
            job_id: job.id,
            dispute_id: disputeId,
            helper_id: job.helper_id ?? "",
            customer_id: job.customer_id ?? "",
            helper_share: String(helperShare),
            initiated_by: "admin",
          },
        },
        {
          // Deterministic in the dispute id, salted by prior FAILED attempts:
          // Stripe replays the original response (failure included) for a
          // reused key inside its ~24h window, so a genuine retry after a
          // failed transfer needs a fresh key to be a new attempt.
          //
          // WINDOW CAVEAT: past ~24h the key stops protecting anything, so this
          // is the WEAKER of the two transfer guards. The load-bearing one is
          // the fail-closed `payout_transfers` read above, which is permanent
          // and is why a lost ledger write is escalated as CRITICAL rather than
          // left for a retry to sort out.
          idempotencyKey: failedTransferCount > 0
            ? `dispute-split-tr-${disputeId}-r${failedTransferCount}`
            : `dispute-split-tr-${disputeId}`,
        },
      );
    } catch (e) {
      const err = e as Error & { type?: string; code?: string; statusCode?: number };
      console.error("[execute-dispute-split] stripe.transfers.create failed:", {
        dispute_id: disputeId,
        job_id: job.id,
        message: err.message,
        stripe_type: err.type,
        stripe_code: err.code,
        stripe_status: err.statusCode,
      });
      // Hand the settlement claim back ONLY on a definite refusal (round-5
      // review, MEDIUM-1). A timeout, dropped connection, Stripe 5xx or
      // idempotency conflict may have created the transfer with no ledger row
      // and no stamped leg id; releasing then let rpc_supersede_dispute_decision
      // read "nothing moved". Kept, the stamped claim sticks for Quick Release /
      // Quick Refund / the sweep and pages; a split retry takes it over and
      // recovers its own transfer by metadata.
      await markFailed(
        supabaseAdmin, disputeId, `transfer failed: ${err.message}`, {}, job.id,
        isDefiniteStripeRefusal(err) ? settlementClaim : null,
      );
      return json({ error: `Stripe transfer failed: ${err.message}` }, 502);
    }

    transferId = transfer.id;

    // Insert as "paid": marketplace transfers settle synchronously, and the
    // transfer.created webhook fires within milliseconds — if it lands before
    // this insert it finds no row, its UPDATE no-ops, and nothing ever re-fires
    // to fix a row left at "pending". Writing the terminal value up front makes
    // that webhook a harmless re-confirmation (its own guard allows paid→paid).
    const { error: ledgerErr } = await supabaseAdmin.from("payout_transfers").insert({
      job_id: job.id,
      helper_id: job.helper_id,
      stripe_transfer_id: transfer.id,
      stripe_account_id: helper.stripe_account_id,
      amount_cents: helperCents,
      platform_fee_cents: platformFeeCents,
      status: "paid",
      paid_at: new Date().toISOString(),
      initiated_by: "admin",
      initiated_by_user_id: adminUserId,
      metadata: {
        source: "execute_dispute_split",
        dispute_id: disputeId,
        helper_share: helperShare,
        transfer_group: transfer.transfer_group ?? null,
      },
    });
    if (ledgerErr) {
      console.error(
        `CRITICAL: [execute-dispute-split] transfer ${transfer.id} sent for job ${job.id} but the payout_transfers write failed:`,
        ledgerErr,
      );
      await postSlackOpsAlert({
        kind: "payout_failed",
        severity: "critical",
        title: "Dispute split transferred but the payout ledger write failed",
        message:
          "A dispute-split transfer left Stripe and its payout_transfers row was NOT written. The retry cannot see it, so re-running could double-pay. Reconcile by hand before retrying.",
        fields: { dispute_id: disputeId, job_id: job.id, transfer_id: transfer.id, amount_cents: helperCents, db_error: ledgerErr.message },
      });
      await markFailed(supabaseAdmin, disputeId, `transfer ${transfer.id} sent but ledger write failed`, { transferId: transfer.id }, job.id, settlementClaim);
      return json(
        {
          error: "transfer sent but the ledger write failed — manual reconciliation needed before retrying",
          stripe_transfer_id: transfer.id,
        },
        500,
      );
    }
  }

  // ── 8. Leg two: refund the poster's share ────────────────────────────────
  let refundId: string | null = (settledRefund?.stripe_refund_id as string) ?? null;
  if (refundCents > 0 && !settledRefund) {
    if (!(await stampMoneyStep())) return await lostClaim("refund", { transferId, helperCents: movedHelperCents });

    let refund: Stripe.Refund;
    try {
      refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          amount: refundCents,
          // Stamped so this refund stays identifiable as THIS dispute's for as
          // long as it exists — that is what the `refunds.list` cross-check
          // above matches on when the ledger row is missing.
          metadata: { dispute_id: disputeId, job_id: job.id, poster_share: String(posterShare) },
        },
        {
          // Same ~24h window caveat as the transfer key: it makes a fast
          // double-click a no-op, and nothing more. The durable guards are the
          // fail-closed `payment_refunds` read and, past the window, the
          // metadata cross-check against Stripe's own refund list.
          idempotencyKey: `dispute-split-rf-${disputeId}`,
        },
      );
    } catch (e) {
      const err = e as Error;
      console.error(
        `[execute-dispute-split] stripe.refunds.create failed for dispute ${disputeId} (job ${job.id}):`,
        err.message,
      );
      // The transfer leg (if any) already succeeded and is recorded, so a retry
      // resumes here rather than re-paying the helper.
      // Same rule as the transfer leg: only a definite refusal frees the claim.
      await markFailed(
        supabaseAdmin, disputeId, `refund failed: ${err.message}`, { transferId, helperCents }, job.id,
        isDefiniteStripeRefusal(err) ? settlementClaim : null,
      );
      return json(
        {
          error: `the Helpr's share was settled but the poster refund failed: ${err.message}. Retry to finish the refund.`,
          stripe_transfer_id: transferId,
        },
        502,
      );
    }

    refundId = refund.id;

    // Ledger, upserted on the Stripe refund id so a replayed refund (same
    // idempotency key → same id) updates one row rather than duplicating it.
    // Best-effort, exactly like every other refund path: the money is already
    // back with the poster, so this must not turn a successful refund into a
    // 500 — but a dropped row IS a real Stripe↔ledger divergence, so it goes to
    // ops rather than a Deno log nobody reads.
    const { error: refundLedgerErr } = await supabaseAdmin.from("payment_refunds").upsert(
      {
        job_id: job.id,
        customer_id: job.customer_id,
        stripe_refund_id: refund.id,
        stripe_payment_intent_id: paymentIntentId,
        amount_cents: Math.round(Number(refund.amount ?? refundCents)),
        currency: refund.currency ?? "usd",
        is_partial: true,
        reason: "dispute split — poster's share (minus non-refundable Stripe processing fee)",
        source: "dispute_split",
        initiated_by_user_id: adminUserId,
        metadata: { dispute_id: disputeId, poster_share: posterShare },
      },
      { onConflict: "stripe_refund_id", ignoreDuplicates: true },
    );
    if (refundLedgerErr) {
      console.error(
        `[execute-dispute-split] refund ledger write failed for refund ${refund.id} (job ${job.id}); refund succeeded, reconcile manually:`,
        refundLedgerErr,
      );
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "warning",
        title: "Dispute split refund ledger write failed",
        message: "A dispute-split refund succeeded but its payment_refunds row was not written. Reconcile manually.",
        fields: { dispute_id: disputeId, job_id: job.id, refund_id: refund.id, amount_cents: refundCents, db_error: refundLedgerErr.message },
      });
    }
  }

  // ── 8b. Leg three: give the poster back their share of the GIFT ──────────
  //
  // A gift card is money the poster never charged to a card, so
  // there is nothing for `stripe.refunds.create` to reverse. Their share comes
  // back as a replacement gift instead: same recipient, same donor, same card
  // art, `parent_credit_id` pointing at the gift that was spent and
  // `restored_from_job_id` at this job.
  //
  // IDEMPOTENCY lives in the database, not in a Stripe key. A partial unique
  // index on `restored_from_job_id` allows exactly one restoration per job
  // forever, so a re-run — an admin double-click, or a resume after the
  // refund leg failed — returns 'already_restored' and mints nothing. That is
  // strictly stronger than the ~24h window the two Stripe legs rely on.
  //
  // No `payment_refunds` row: that ledger's `stripe_refund_id` is UNIQUE NOT
  // NULL, and inventing a fake id to satisfy it would poison the one column
  // every reconciliation job joins on. The replacement credit, with its two
  // back-references, IS the ledger entry for this leg.
  let restoredCreditId: string | null = null;
  let restoredGiftCents = 0;
  if (giftRestoreCents > 0) {
    if (!(await stampMoneyStep())) {
      return await lostClaim("gift restore", { transferId, refundId, helperCents: movedHelperCents, refundCents });
    }
    const { data: restoreData, error: restoreErr } = await supabaseAdmin.rpc(
      "restore_gift_card_for_job",
      { p_job_id: job.id, p_share_bps: giftShareBps, p_dry_run: false },
    );
    const restored = (restoreData ?? null) as
      | { outcome?: string; credit_id?: string; recipient_id?: string; restore_cents?: number }
      | null;
    const restoreOutcome = restoreErr ? null : restored?.outcome;
    if (restoreOutcome !== "restored" && restoreOutcome !== "already_restored") {
      // A null `error` is not proof the gift came back. Both Stripe legs may
      // already have settled, so this is a half-finished split, not a clean
      // refusal — park it as resumable and page ops.
      const why = restoreErr
        ? `${restoreErr.message}${(restoreErr as { code?: string }).code ? ` (${(restoreErr as { code?: string }).code})` : ""}`
        : `unrecognised outcome ${JSON.stringify(restored)}`;
      console.error(
        `CRITICAL: [execute-dispute-split] dispute ${disputeId} settled its Stripe legs but the gift restore failed for job ${job.id}: ${why}`,
      );
      await postSlackOpsAlert({
        kind: "custom",
        severity: "critical",
        title: "Dispute split could not return the poster's gift card",
        message:
          "A dispute split moved its Stripe legs but could not mint the poster's replacement gift, so they are short by that amount. The split is left resumable — retry once the cause is cleared.",
        fields: {
          dispute_id: disputeId,
          job_id: job.id,
          gift_restore_cents: giftRestoreCents,
          transfer_id: transferId ?? "—",
          refund_id: refundId ?? "—",
          reason: why.slice(0, 200),
        },
      });
      await markFailed(supabaseAdmin, disputeId, `gift restore failed: ${why}`, {
        transferId,
        refundId,
        helperCents: movedHelperCents,
        refundCents,
      }, job.id, settlementClaim);
      return json(
        {
          error:
            "the Stripe legs settled but the poster's gift card could not be returned — retry to finish the split",
          stripe_transfer_id: transferId,
          stripe_refund_id: refundId,
        },
        500,
      );
    }
    restoredCreditId = restored?.credit_id ?? null;
    restoredGiftCents = Number(restored?.restore_cents ?? 0) || 0;
  }

  // What the poster actually gets back, in both currencies of this settlement.
  const posterReturnedCents = refundCents + restoredGiftCents;

  // ── 9. Settle: the job's payment state, then the dispute's ───────────────
  // 'released' whenever the helper was paid anything (money left escrow toward
  // the helper); 'refunded' only when the poster took the whole award. Both are
  // terminal, which is what keeps release-payout / process-scheduled-payouts
  // from ever picking this job up again. The `.in()` precondition mirrors the
  // webhook guards (R8/R9): a job an operator has since refunded or charged
  // back must never be walked forward by this write. 'released'/'refunded' stay
  // in the allowed set so a resumed run is a clean no-op rather than a failure.
  const finalPaymentStatus = movedHelperCents > 0 ? "released" : "refunded";
  const jobPatch: Record<string, unknown> = {
    payment_status: finalPaymentStatus,
    // The commission that was actually kept — the ledger's on a resume.
    platform_fee_amount: movedPlatformFeeCents / 100,
  };
  // Only freeze the rate when THIS run resolved it against a transfer it made.
  // On a resume the earlier attempt already froze the rate its transfer was
  // computed at; re-resolving the helper's LIVE tier here would overwrite that
  // with a percentage no money ever moved at.
  if (!settledTransfer) jobPatch.helper_fee_percent = helperFeePercent;

  const { data: settledJob, error: jobUpdateErr } = await supabaseAdmin
    .from("jobs")
    .update(jobPatch)
    .eq("id", job.id)
    .in("payment_status", [...EXECUTABLE_PAYMENT_STATES, ...RESUME_PAYMENT_STATES])
    .select("id");
  if (jobUpdateErr || !settledJob || settledJob.length === 0) {
    // The money is already out. A job stuck in escrow/payout_pending after a
    // real transfer is a live double-pay risk, so this is never swallowed.
    console.error(
      `CRITICAL: [execute-dispute-split] money moved for dispute ${disputeId} (transfer=${transferId}, refund=${refundId}) but jobs.update failed:`,
      jobUpdateErr,
    );
    await postSlackOpsAlert({
      kind: "payout_failed",
      severity: "critical",
      title: "Dispute split settled but the job state did not flip",
      message:
        "A dispute split moved money but jobs.payment_status was not advanced. The job may still look payable to the payout paths — reconcile immediately.",
      fields: {
        dispute_id: disputeId,
        job_id: job.id,
        transfer_id: transferId ?? "—",
        refund_id: refundId ?? "—",
        db_error: jobUpdateErr?.message ?? "zero rows matched the state precondition",
      },
    });
    await markFailed(supabaseAdmin, disputeId, "money moved but the job state did not flip", { transferId, refundId, helperCents: movedHelperCents, refundCents }, job.id, settlementClaim);
    return json(
      {
        error: "the split moved money but the job status update failed — manual reconciliation needed",
        stripe_transfer_id: transferId,
        stripe_refund_id: refundId,
      },
      500,
    );
  }

  const { error: disputeUpdateErr } = await supabaseAdmin
    .from("disputes")
    .update({
      execution_status: "executed",
      executed_at: new Date().toISOString(),
      execution_transfer_id: transferId,
      execution_refund_id: refundId,
      execution_helper_cents: movedHelperCents,
      // What the poster got back, counting a restored gift card.
      // On an ordinary Stripe job `restoredGiftCents` is 0 and this is the
      // refund figure exactly, as before — but on a gift-funded job recording
      // only the Stripe leg would tell the admin queue the poster received
      // nothing when they received their whole share.
      execution_refund_cents: posterReturnedCents,
      execution_error: null,
    })
    .eq("id", disputeId);

  // Settled. The job is terminal now so nothing could take the claim anyway,
  // but a lock table that keeps rows for finished work is how a lock table
  // turns into a mystery.
  await releaseClaim(supabaseAdmin, job.id, settlementClaim);

  if (disputeUpdateErr) {
    // The job is already terminal, so no double-pay is possible — but the
    // dispute is left claimable, and a retry would find both ledger legs
    // settled and skip straight back here. Log loudly; do not fail the request.
    console.error(
      `[execute-dispute-split] dispute ${disputeId} settled but its execution record was not written:`,
      disputeUpdateErr,
    );
  }

  // Q76: the decision itself is audited by rpc_decide_dispute; THIS row is
  // the money moving on it, by this admin. Non-fatal (the split is settled and
  // the job terminal), never silent — writeAdminAudit alerts on a lost row.
  await writeAdminAudit(supabaseAdmin, {
    adminId: adminUserId,
    action: "execute_dispute_split",
    targetType: "dispute",
    targetId: disputeId,
    details: {
      job_id: job.id,
      helper_share: helperShare,
      poster_share: posterShare,
      helper_cents: movedHelperCents,
      refund_cents: refundCents,
      gift_restored_cents: restoredGiftCents,
      stripe_transfer_id: transferId,
      stripe_refund_id: refundId,
      resumed: isResume,
      reason: dispute.decision_text ?? null,
    },
    source: "execute-dispute-split",
  }, postSlackOpsAlert);

  // ── 10. Tell both sides what actually moved ──────────────────────────────
  // Amounts come from `moved*`, so a resume quotes the settled transfer rather
  // than this run's recomputation. Both inserts are non-blocking — the money is
  // out and the state is terminal — but the error is logged, never dropped: a
  // party who is never told is a support ticket, and the log is the only trace.
  const helperDollars = movedHelperCents / 100;
  const refundDollars = refundCents / 100;
  if (job.helper_id && movedHelperCents > 0) {
    const { error: helperNoteErr } = await supabaseAdmin.from("notifications").insert({
      user_id: job.helper_id,
      job_id: job.id,
      title: "Dispute settled — your share was sent",
      message: `The dispute on "${job.title}" was settled with a ${Math.round(helperShare * 100)}% share to you. $${formatPayoutDollars(helperDollars)} is on its way to your bank.`,
      type: "payment",
      // `/profile?tab=earnings` is the earnings screen — `/earnings` and
      // `/analytics` both redirect here, and Dashboard reads no `tab` param.
      link: "/profile?tab=earnings",
    });
    if (helperNoteErr) {
      console.error(
        `[execute-dispute-split] helper notification insert failed for dispute ${disputeId}:`,
        helperNoteErr,
      );
    }
  }
  if (job.customer_id && posterReturnedCents > 0) {
    // Say where the money went back TO. A poster who paid with a gift and is
    // told it went "to your original payment method" will go looking for a
    // card refund that will never arrive.
    const posterHow = restoredGiftCents > 0 && refundCents > 0
      ? `$${formatPayoutDollars(refundDollars)} has been refunded to your original payment method and $${formatPayoutDollars(restoredGiftCents / 100)} is back as a gift you can use on another job.`
      : restoredGiftCents > 0
      ? `$${formatPayoutDollars(restoredGiftCents / 100)} is back as a gift you can use on another job.`
      : `$${formatPayoutDollars(refundDollars)} has been refunded to your original payment method.`;
    const { error: posterNoteErr } = await supabaseAdmin.from("notifications").insert({
      user_id: job.customer_id,
      title: restoredGiftCents > 0 && refundCents === 0
        ? "Dispute settled — your gift is back"
        : "Dispute settled — refund issued",
      message: `The dispute on "${job.title}" was settled with a ${Math.round(posterShare * 100)}% share to you. ${posterHow}`,
      type: "payment",
      // The settled job. A resolved dispute leaves the job completed or
      // cancelled — either way not in the "Needs you" bucket /my-posts opens on.
      link: `/my-posts?job=${job.id}`,
    });
    if (posterNoteErr) {
      console.error(
        `[execute-dispute-split] poster notification insert failed for dispute ${disputeId}:`,
        posterNoteErr,
      );
    }
  }

  return json({
    success: true,
    dispute_id: disputeId,
    job_id: job.id,
    helper_share: helperShare,
    poster_share: posterShare,
    // What MOVED, not what this run recomputed — see `movedHelperCents`.
    helper_cents: movedHelperCents,
    platform_fee_cents: movedPlatformFeeCents,
    refund_cents: refundCents,
    // The gift leg, reported separately so a caller can never mistake credit
    // for cash back on a card.
    gift_restored_cents: restoredGiftCents,
    gift_credit_id: restoredCreditId,
    poster_returned_cents: posterReturnedCents,
    stripe_transfer_id: transferId,
    stripe_refund_id: refundId,
    payment_status: finalPaymentStatus,
    resumed: isResume,
  });
});

/**
 * Normalise a recorded `payout_split` into a { helperShare, posterShare } pair
 * of 0..1 fractions.
 *
 * `rpc_decide_dispute` stores fractions, but it also ACCEPTS 0–100 percents and
 * normalises them, so historical rows can hold either form — this mirrors that
 * tolerance rather than trusting one shape. Returns null for anything that
 * isn't a usable split: a missing object, non-numeric shares, negatives, or a
 * pair that doesn't add up to the whole award (which would silently leave money
 * stranded in escrow or over-draw it).
 */
function parseSplit(
  raw: unknown,
): { helperShare: number; posterShare: number } | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  let helper = Number(obj.helper);
  let poster = Number(obj.poster);
  if (!Number.isFinite(helper) || !Number.isFinite(poster)) return null;
  if (helper > 1 || poster > 1) {
    helper = helper / 100;
    poster = poster / 100;
  }
  if (helper < 0 || poster < 0) return null;
  // Tolerance covers the float noise of a /100 normalisation, nothing wider.
  if (Math.abs(helper + poster - 1) > 0.005) return null;
  return { helperShare: helper, posterShare: poster };
}

/**
 * Park the dispute in a re-claimable 'failed' state with the reason, recording
 * whichever leg already settled so a retry resumes instead of restarting.
 * Never throws — it runs on paths that are already returning an error, and
 * losing the error text must not lose the error.
 *
 * The `neq('executed')` is load-bearing, not defensive noise. 'executing' is
 * deliberately re-claimable, so two admins clicking at once can both get past
 * the claim; if the loser's failure write lands after the winner's success
 * write, an unguarded UPDATE would relabel a fully settled dispute
 * "Settlement failed" in the admin queue — which reads as an invitation to
 * refund the poster a second time by hand. A settled dispute is terminal and
 * nothing may walk it back.
 */
async function markFailed(
  admin: AdminClient,
  disputeId: string,
  reason: string,
  settled: { transferId?: string | null; refundId?: string | null; helperCents?: number; refundCents?: number } = {},
  // The job's cross-function settlement claim (20260915034822), when this
  // failure happened after step 6b took it. Released HERE because every
  // post-claim failure path funnels through this function — so a split that
  // dies mid-flight hands the escrow straight back to the admin buttons
  // instead of locking them out until the claim's TTL.
  //
  // By TOKEN: a caller that merely `joined` an existing claim holds no token
  // and frees nothing, or its cleanup would delete a claim somebody else's
  // live Stripe call is standing on.
  claimJobId?: string | null,
  claim?: { token: string | null } | null,
): Promise<void> {
  if (claimJobId) await releaseClaim(admin, claimJobId, claim);
  try {
    const patch: Record<string, unknown> = {
      execution_status: "failed",
      execution_error: reason.slice(0, 500),
    };
    if (settled.transferId) patch.execution_transfer_id = settled.transferId;
    if (settled.refundId) patch.execution_refund_id = settled.refundId;
    if (settled.helperCents != null) patch.execution_helper_cents = settled.helperCents;
    if (settled.refundCents != null) patch.execution_refund_cents = settled.refundCents;
    const { error } = await admin
      .from("disputes")
      .update(patch)
      .eq("id", disputeId)
      // Only a DECIDED row (round-4 review): a refusal on a dispute that is
      // open, withdrawn or superseded must not stamp 'failed' onto it — that
      // row's settlement state is not this run's to write.
      .eq("status", "decided")
      // NOT `.neq("execution_status", "executed")`. PostgREST renders that as
      // SQL `<>`, and `NULL <> 'executed'` is NULL, not true — so a dispute
      // whose execution_status is still NULL (every dispute decided before the
      // RPC learned to stamp 'pending') matched ZERO ROWS and the failure was
      // never recorded. That is precisely the pre-claim path this function now
      // routes every refusal through, so the guard has to admit NULL.
      .or("execution_status.is.null,execution_status.neq.executed");
    if (error) {
      // Not fatal — the caller is already returning the real error — but a
      // dispute left in 'executing' with no reason recorded is a run nobody can
      // diagnose, so it must never vanish silently.
      console.error(`[execute-dispute-split] could not record failure on dispute ${disputeId}:`, error);
    }
  } catch (e) {
    console.error(`[execute-dispute-split] markFailed threw for dispute ${disputeId}:`, e);
  }
}

/**
 * Did Stripe DEFINITELY refuse (so no object exists)? The same list
 * create-payment's transferToHelper uses, minus StripeIdempotencyError: that
 * one means a request with the same key already reached Stripe (round-5
 * review). Anything else — a connection error, a timeout, a 5xx, a rate limit —
 * may have created the object.
 */
function isDefiniteStripeRefusal(e: unknown): boolean {
  const type = String((e as { type?: string } | null)?.type ?? "");
  return ["StripeInvalidRequestError", "StripeCardError", "StripePermissionError", "StripeAuthenticationError"].includes(type);
}

/**
 * Hand the job's settlement claim back by TOKEN, retried once (round 3, M2): a
 * claim left behind by one failed RPC blocks the admin buttons until it
 * expires. A tokenless caller owns nothing and frees nothing.
 */
async function releaseClaim(admin: AdminClient, jobId: string, claim?: { token: string | null } | null): Promise<void> {
  if (!claim?.token) return;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { error } = await admin.rpc("release_dispute_settlement_claim", { _job_id: jobId, _token: claim.token });
    if (!error) return;
    console.error(`[execute-dispute-split] could not release the settlement claim on job ${jobId} (attempt ${attempt}):`, error);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
