/**
 * Claiming writes for `payout_transfers`.
 *
 * ─── The race this closes ───────────────────────────────────────────────────
 *
 * `release-payout` and `process-scheduled-payouts` both target the same
 * `payment_status='payout_pending'` jobs, and they use DIFFERENT Stripe
 * idempotency keys (`release-payout-${job}` vs `scheduled-payout-${job}`) — so
 * Stripe will happily create BOTH transfers and pay the helper twice. The only
 * thing that stood between the two was a plain `SELECT` of `payout_transfers`
 * in each function, with no `FOR UPDATE`, no claiming write, and no unique
 * index on `(job_id, helper_id)`. `process-scheduled-payouts:250-258` claims
 * that read "closes the race window". An unlocked read cannot close a race; two
 * concurrent runs both see no row and both send.
 *
 * The fix is a claim: INSERT the ledger row BEFORE calling Stripe, with
 * `status='pending'` and no transfer id yet. The partial unique index
 * `payout_transfers_one_live_per_job_helper` (migration 20260831190418) means
 * exactly one concurrent inserter wins; every other one gets 23505 and skips
 * without ever reaching `stripe.transfers.create`. The index alone would only
 * catch the duplicate AFTER the second transfer had gone out, which is too
 * late — so the claim is the real guard and the index is what makes the claim
 * atomic.
 *
 * ─── Why the claim row is also the failure record ───────────────────────────
 *
 * Nothing in the payout set ever wrote `status='failed'`. The only writer is
 * `stripe-webhook/handlers/transferFailed.ts`, which fires only when Stripe
 * CREATED a transfer and then failed to settle it. When `transfers.create`
 * THROWS — insufficient balance, a capability error, a network fault — no
 * transfer object exists, no webhook fires, and the catch block wrote nothing.
 *
 * That silence had teeth: the idempotency key is salted with the count of prior
 * failed rows precisely so a retry is a genuinely new attempt, and with no row
 * ever written the count stayed 0, the key stayed unsalted, and Stripe replayed
 * its cached failure for the whole ~24h idempotency window. The retry was a
 * silent no-op for a day. Because the claim row already exists by the time the
 * call throws, marking it `failed` is a single UPDATE — the failure record and
 * the race guard are the same row, so they cannot drift apart.
 *
 * ─── Resuming an open claim ─────────────────────────────────────────────────
 *
 * A crash between the INSERT and the Stripe response leaves a `pending` row
 * with a NULL transfer id, and nothing on Earth can tell from the DB whether
 * the transfer went out. Treating that as "blocked" strands the payout; treating
 * it as "failed" bumps the salt, changes the key, and double-pays.
 *
 * So an open claim is RESUMED instead: re-drive Stripe with the IDENTICAL
 * idempotency key. That is exactly what idempotency keys are for — Stripe
 * returns the original transfer if one was created, and creates it if not.
 * Either way the claim row is then settled with a real id and no second
 * transfer can exist.
 */

/** Minimal shape needed from a `payout_transfers` row. */
export interface LedgerRow {
  id: string;
  stripe_transfer_id: string | null;
  status: string;
  created_at?: string | null;
}

/**
 * How long a `pending` claim with no transfer id is assumed to be in flight.
 *
 * A payout takes seconds. Below this, another invocation is probably mid-call
 * and this one should stand down rather than race it to the same ledger row.
 * Above it, the claim is orphaned and gets resumed against the same key.
 */
const OPEN_CLAIM_INFLIGHT_MS = 2 * 60 * 1000;

/** Statuses that mean money is out, or believed out. Mirrors the DB index. */
const LIVE_TRANSFER_STATES = ["pending", "paid", "reversed"] as const;

export type ClaimDecision =
  /** Safe to proceed. `claimId` is the row to settle; `failedCount` salts the key. */
  | { kind: "proceed"; claimId: string; failedCount: number; resumed: boolean }
  /** A real transfer already exists, or another run holds the claim. Skip. */
  | { kind: "blocked"; reason: string; transferId: string | null }
  /** Could not establish the claim. Fail CLOSED — never send on an unknown state. */
  | { kind: "error"; message: string };

/**
 * Classify the ledger rows for one (job, helper).
 *
 * Split out from `claimPayout` so a caller that has already read the ledger for
 * its own dedupe messaging (both payout functions do) does not read it twice.
 */
export function classifyLedger(
  rows: LedgerRow[],
  nowMs = Date.now(),
): {
  settled: LedgerRow | null;
  openClaim: LedgerRow | null;
  inFlightClaim: LedgerRow | null;
  failedCount: number;
} {
  // A live row that carries a REAL transfer id is a hard block: money moved.
  const settled = rows.find(
    (r) => r.stripe_transfer_id !== null &&
      (LIVE_TRANSFER_STATES as readonly string[]).includes(r.status),
  ) ?? null;

  const claims = rows.filter((r) => r.status === "pending" && r.stripe_transfer_id === null);
  let openClaim: LedgerRow | null = null;
  let inFlightClaim: LedgerRow | null = null;
  for (const c of claims) {
    const age = c.created_at ? nowMs - new Date(c.created_at).getTime() : Number.POSITIVE_INFINITY;
    if (Number.isFinite(age) && age < OPEN_CLAIM_INFLIGHT_MS) inFlightClaim ??= c;
    else openClaim ??= c;
  }

  return {
    settled,
    openClaim,
    inFlightClaim,
    failedCount: rows.filter((r) => r.status === "failed").length,
  };
}

/**
 * Take the claim for one (job, helper) payout, or explain why not.
 *
 * Call this immediately before `stripe.transfers.create`, once the final
 * amount is known — the row carries that amount so a crashed run leaves a
 * legible record of what it was about to send.
 */
export async function claimPayout(
  supabaseAdmin: {
    from: (t: string) => any;
  },
  args: {
    jobId: string;
    helperId: string;
    amountCents: number;
    platformFeeCents: number;
    stripeAccountId: string | null;
    initiatedBy: "system" | "admin" | "auto";
    initiatedByUserId?: string | null;
    metadata?: Record<string, unknown>;
    /** Pre-read ledger rows, if the caller already has them. */
    ledgerRows?: LedgerRow[];
  },
): Promise<ClaimDecision> {
  let rows = args.ledgerRows;
  if (!rows) {
    const { data, error } = await supabaseAdmin
      .from("payout_transfers")
      .select("id, stripe_transfer_id, status, created_at")
      .eq("job_id", args.jobId)
      .eq("helper_id", args.helperId);
    // Fail closed: without the ledger we cannot rule out a prior transfer.
    if (error) return { kind: "error", message: `ledger read failed: ${error.message}` };
    rows = (data ?? []) as LedgerRow[];
  }

  const { settled, openClaim, inFlightClaim, failedCount } = classifyLedger(rows);

  if (settled) {
    return {
      kind: "blocked",
      reason: `transfer already exists for this job (${settled.status})`,
      transferId: settled.stripe_transfer_id,
    };
  }
  if (inFlightClaim) {
    return {
      kind: "blocked",
      reason: "another payout run is mid-transfer for this job",
      transferId: null,
    };
  }
  if (openClaim) {
    // Orphaned claim. Resume against the SAME idempotency key — see header.
    return { kind: "proceed", claimId: openClaim.id, failedCount, resumed: true };
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("payout_transfers")
    .insert({
      job_id: args.jobId,
      helper_id: args.helperId,
      stripe_transfer_id: null,
      stripe_account_id: args.stripeAccountId,
      amount_cents: args.amountCents,
      platform_fee_cents: args.platformFeeCents,
      status: "pending",
      initiated_by: args.initiatedBy,
      initiated_by_user_id: args.initiatedByUserId ?? null,
      metadata: { ...(args.metadata ?? {}), claim: true },
    })
    .select("id");

  if (insertErr) {
    // 23505 on payout_transfers_one_live_per_job_helper: a concurrent run took
    // the claim between our read and our insert. That is the race being closed,
    // working — not an error.
    if ((insertErr as { code?: string }).code === "23505") {
      return { kind: "blocked", reason: "payout claimed concurrently by another run", transferId: null };
    }
    return { kind: "error", message: `payout claim insert failed: ${insertErr.message}` };
  }
  // A null `error` does NOT mean the write happened — an empty return means we
  // do not hold the claim, and sending on that assumption is a double-pay.
  if (!inserted || inserted.length === 0) {
    return { kind: "error", message: "payout claim insert returned no row" };
  }

  return { kind: "proceed", claimId: inserted[0].id as string, failedCount, resumed: false };
}

/** Settle a held claim after Stripe confirmed the transfer. */
export async function settleClaim(
  supabaseAdmin: { from: (t: string) => any },
  claimId: string,
  patch: {
    stripeTransferId: string;
    amountCents: number;
    platformFeeCents: number;
    stripeAccountId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<{ ok: true } | { ok: false; message: string }> {
  // Insert-as-paid rather than waiting for the webhook: Stripe marketplace
  // transfers settle synchronously on creation, and `transfer.created` can
  // arrive before this row exists, in which case its UPDATE is a no-op and
  // nothing ever re-fires to fix the row. Guarded on `status='pending'` so a
  // reversal that landed first is never walked backwards to 'paid'.
  const { data, error } = await supabaseAdmin
    .from("payout_transfers")
    .update({
      stripe_transfer_id: patch.stripeTransferId,
      status: "paid",
      paid_at: new Date().toISOString(),
      amount_cents: patch.amountCents,
      platform_fee_cents: patch.platformFeeCents,
      ...(patch.stripeAccountId !== undefined ? { stripe_account_id: patch.stripeAccountId } : {}),
      ...(patch.metadata ? { metadata: patch.metadata } : {}),
    })
    .eq("id", claimId)
    .eq("status", "pending")
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return { ok: false, message: "claim row was not in 'pending' state at settle time" };
  }
  return { ok: true };
}

/**
 * Mark a held claim failed. This is the row every retry path depends on: it
 * salts the next idempotency key, and it is what a give-up counter counts.
 */
export async function failClaim(
  supabaseAdmin: { from: (t: string) => any },
  claimId: string,
  failureReason: string,
  extraMetadata?: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data, error } = await supabaseAdmin
    .from("payout_transfers")
    .update({
      status: "failed",
      failed_at: new Date().toISOString(),
      // The column is plain text; Stripe messages can be long and the useful
      // part is always at the front.
      failure_reason: failureReason.slice(0, 500),
      ...(extraMetadata ? { metadata: extraMetadata } : {}),
    })
    .eq("id", claimId)
    .eq("status", "pending")
    .select("id");

  if (error) return { ok: false, message: error.message };
  if (!data || data.length === 0) {
    return { ok: false, message: "claim row was not in 'pending' state at fail time" };
  }
  return { ok: true };
}
