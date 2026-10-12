// Q1732 (OWNER DECISION 2026-10-12, pop-up): the admin button that un-sticks a
// decided dispute whose Stripe TEST-mode refund or transfer is already
// RECORDED in our books. Admin-only (index.ts checked has_role before this
// runs), audited (clear_test_mode_dispute_ledger writes the audit row with
// every removed ledger row in full) and idempotent (a second press answers
// already_superseded / nothing_to_clear and moves nothing). No hand SQL.
//
// Body: { dispute_id, action: "clear_test_mode_records", reason }
//
// 1. Read every Stripe id that rpc_supersede_dispute_decision reads as money
//    moved: payment_refunds on the job, pending/paid/reversed payout_transfers
//    on the job, and the dispute's two execution stamps.
// 2. Ask Stripe about EACH under the live key. Only "a similar object exists in
//    test mode" (isTestObjectUnderLiveKey) counts as test mode. An object
//    Stripe returns is LIVE money: refuse, reconcile by hand. Any other error
//    is "could not tell": refuse, retry. Fail closed both ways.
// 3. clear_test_mode_dispute_ledger (service_role only) removes exactly the
//    checked set, compare-and-set under the jobs/disputes locks.
// 4. rpc_supersede_dispute_decision AS THE ADMIN (their own JWT, so auth.uid()
//    and every one of its gates are theirs) re-opens the dispute to be decided
//    again. If this step fails the records are already cleared, and pressing
//    the button again skips straight to it (nothing_to_clear).
//
// Never calls markFailed: this branch settles nothing, so it must not rewrite
// the dispute's execution record.
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { isTestObjectUnderLiveKey, logTestObjectUnderLiveKey } from "../_shared/stripeAccountUsable.ts";

export const CLEAR_TEST_MODE_ACTION = "clear_test_mode_records";

/**
 * The start of disputes.execution_error once clear_test_mode_dispute_ledger
 * has cleared a dispute's records (20261012215235). The split refuses such a
 * decision (index.ts): its fail-closed "money already moved" records are gone,
 * so the only way on is the re-open (money review of 6b2434f20, #1).
 */
export const TEST_MODE_CLEARED_MARKER = "test-mode records cleared by an admin";

/** Supersede's money-moving transfer states (rpc_supersede_dispute_decision). */
const MONEY_TRANSFER_STATES = ["pending", "paid", "reversed"];

export async function clearTestModeRecords(args: {
  supabaseAdmin: SupabaseClient;
  /** A client carrying the ADMIN's own Authorization header. */
  adminClient: SupabaseClient;
  stripe: Stripe;
  adminUserId: string;
  disputeId: string;
  reason: unknown;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { supabaseAdmin, adminClient, stripe, adminUserId, disputeId } = args;
  const reason = typeof args.reason === "string" ? args.reason.trim() : "";
  if (reason.length < 10) {
    return { status: 400, body: { error: "Say how you know these are Stripe test-mode records (10 characters or more); it goes in the audit log." } };
  }

  const { data: dispute, error: dErr } = await supabaseAdmin
    .from("disputes")
    .select("id, job_id, status, execution_error, execution_refund_id, execution_transfer_id")
    .eq("id", disputeId)
    .maybeSingle<{
      id: string;
      job_id: string;
      status: string;
      execution_error: string | null;
      execution_refund_id: string | null;
      execution_transfer_id: string | null;
    }>();
  if (dErr) return { status: 500, body: { error: "dispute lookup failed — retry" } };
  if (!dispute) return { status: 404, body: { error: "dispute not found" } };
  if (dispute.status === "superseded") {
    return { status: 200, body: { action: "already_superseded" } };
  }
  const alreadyCleared = (dispute.execution_error ?? "").startsWith(TEST_MODE_CLEARED_MARKER);

  // The ESCROW itself must be a Stripe test object too (money review of
  // 6b2434f20, #2): a job paid with live money, or with nothing Stripe can
  // vouch for (a gift card only), is never un-stuck from here.
  const { data: job, error: jobErr } = await supabaseAdmin
    .from("jobs")
    .select("stripe_payment_intent_id, stripe_session_id")
    .eq("id", dispute.job_id)
    .maybeSingle<{ stripe_payment_intent_id: string | null; stripe_session_id: string | null }>();
  if (jobErr) return { status: 500, body: { error: "job lookup failed — retry" } };
  if (!job) return { status: 404, body: { error: "job not found for this dispute" } };
  const escrowKind = job.stripe_payment_intent_id ? "payment_intent" : job.stripe_session_id ? "checkout.session" : null;
  const escrowId = job.stripe_payment_intent_id ?? job.stripe_session_id;
  if (!escrowKind || !escrowId) {
    return { status: 409, body: { error: "this job has no Stripe payment to check, so it cannot be shown to be test mode — nothing was changed; reconcile it by hand" } };
  }
  try {
    if (escrowKind === "payment_intent") await stripe.paymentIntents.retrieve(escrowId);
    else await stripe.checkout.sessions.retrieve(escrowId);
    return { status: 409, body: { error: `this job's payment ${escrowId} is LIVE money at Stripe, not test mode — nothing was changed; reconcile it by hand` } };
  } catch (e) {
    if (!isTestObjectUnderLiveKey(e)) {
      console.error(`[execute-dispute-split] clear_test_mode_records: could not check ${escrowKind} ${escrowId} at Stripe:`, e);
      return { status: 502, body: { error: `could not check this job's payment at Stripe — nothing was changed; retry` } };
    }
    logTestObjectUnderLiveKey("execute-dispute-split", { dispute_id: disputeId, job_id: dispute.job_id, object: escrowKind, id: escrowId, step: "clear_test_mode_records" });
  }

  const [refundsRes, transfersRes] = await Promise.all([
    supabaseAdmin
      .from("payment_refunds")
      .select("stripe_refund_id")
      .eq("job_id", dispute.job_id),
    supabaseAdmin
      .from("payout_transfers")
      .select("stripe_transfer_id, status")
      .eq("job_id", dispute.job_id)
      .in("status", MONEY_TRANSFER_STATES),
  ]);
  if (refundsRes.error || transfersRes.error) {
    return { status: 500, body: { error: "could not read this job's refund and transfer records — retry" } };
  }
  const refundRows = (refundsRes.data ?? []) as { stripe_refund_id: string }[];
  const transferRows = (transfersRes.data ?? []) as { stripe_transfer_id: string | null; status: string }[];
  if (transferRows.some((t) => !t.stripe_transfer_id)) {
    return { status: 409, body: { error: "a transfer record on this job has no Stripe id, so it cannot be checked — reconcile it by hand" } };
  }
  const refundIds = [...new Set([
    ...refundRows.map((r) => r.stripe_refund_id),
    ...(dispute.execution_refund_id ? [dispute.execution_refund_id] : []),
  ])].sort();
  const transferIds = [...new Set([
    ...transferRows.map((t) => t.stripe_transfer_id as string),
    ...(dispute.execution_transfer_id ? [dispute.execution_transfer_id] : []),
  ])].sort();

  // Nothing recorded and never cleared: re-opening would only loop, because a
  // decision on a Stripe test-mode payment can never execute (money review of
  // 6b2434f20, #3; docs/OPEN.md Q1762).
  if (refundIds.length === 0 && transferIds.length === 0 && !alreadyCleared) {
    return {
      status: 409,
      body: { error: "no test-mode refund or transfer is recorded for this dispute, so there is nothing to clear — nothing was changed. A decision on a Stripe test-mode payment cannot be settled from here." },
    };
  }

  // Every id must be a TEST object. Sequential on purpose: a handful of ids.
  const checks: Array<["refund" | "transfer", string]> = [
    ...refundIds.map((id) => ["refund", id] as ["refund", string]),
    ...transferIds.map((id) => ["transfer", id] as ["transfer", string]),
  ];
  for (const [kind, id] of checks) {
    let found: { id?: string } | null;
    try {
      found = kind === "refund" ? await stripe.refunds.retrieve(id) : await stripe.transfers.retrieve(id);
    } catch (e) {
      if (isTestObjectUnderLiveKey(e)) {
        logTestObjectUnderLiveKey("execute-dispute-split", { dispute_id: disputeId, job_id: dispute.job_id, object: kind, id, step: "clear_test_mode_records" });
        continue;
      }
      console.error(`[execute-dispute-split] clear_test_mode_records: could not check ${kind} ${id} at Stripe:`, e);
      return { status: 502, body: { error: `could not check ${kind} ${id} at Stripe — nothing was changed; retry` } };
    }
    // Stripe returned it under the LIVE key: real money moved. Never cleared here.
    return {
      status: 409,
      body: { error: `${kind} ${found?.id ?? id} is LIVE money at Stripe, not a test-mode record — nothing was changed; reconcile it by hand` },
    };
  }

  const { data: cleared, error: clearErr } = await supabaseAdmin.rpc("clear_test_mode_dispute_ledger", {
    _admin: adminUserId,
    _dispute_id: disputeId,
    _refund_ids: refundIds,
    _transfer_ids: transferIds,
    _reason: reason,
  });
  if (clearErr) {
    return { status: 409, body: { error: `nothing was changed: ${clearErr.message}` } };
  }
  const clearedAction = (cleared as { action?: string } | null)?.action;
  if (clearedAction === "already_superseded") {
    return { status: 200, body: { action: "already_superseded" } };
  }
  if (clearedAction !== "cleared" && clearedAction !== "nothing_to_clear") {
    // A null or unknown answer is not a clear (CLAUDE.md: a null error is not a write).
    return { status: 500, body: { error: "the records clear returned no result — retry" } };
  }

  const { data: newDisputeId, error: supErr } = await adminClient.rpc("rpc_supersede_dispute_decision", {
    _dispute_id: disputeId,
    _reason: `Stripe test-mode records cleared: ${reason}`,
  });
  if (supErr || typeof newDisputeId !== "string") {
    return {
      status: 409,
      body: {
        error: `the test-mode records were cleared, but re-opening the dispute failed: ${supErr?.message ?? "no new dispute id returned"} — press the button again`,
        cleared,
      },
    };
  }
  return { status: 200, body: { action: "superseded", cleared, new_dispute_id: newDisputeId } };
}
