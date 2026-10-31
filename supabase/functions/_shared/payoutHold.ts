/**
 * The server-side payout hold (docs/OPEN.md Q764).
 *
 * `public.payout_holds` holds one row per Helpr an admin has put on hold
 * (20261004162921). A row means: send this person no money. A recorded denial
 * is still a hold. Every edge function that moves money to a Helpr asks this
 * module first, and src/test/payoutPathsHonourHold.test.ts fails CI on a money
 * call with no hold check before it in the same function.
 *
 * Before this the hold lived in one admin's browser, so a second admin's Send
 * Payout, a Bulk Approve and the scheduled crons all paid a "held" Helpr.
 *
 * FAIL CLOSED. A read error is `{ kind: "error" }` and every caller refuses to
 * pay on it: a delayed payout is recoverable, a payout to a Helpr under review
 * is not. The ONE tolerated failure is 42P01/PGRST205 (the table is not
 * deployed yet, the migration-lag window): a database with no payout_holds
 * table can hold no one, exactly as _shared/unsettledDispute.ts treats a
 * missing disputes table.
 *
 * ZERO imports (the caller passes its service-role client), so the edge test
 * harness runs the REAL module.
 */

/** Response `code` a payout function answers with when it refused a held Helpr. */
export const PAYOUT_HELD_CODE = "payout_held";

/**
 * The execution_error execute-dispute-split records when a hold stopped the
 * split. auto-resolve-disputes' stuck-split sweep reads it to tell a split a
 * hold is keeping on purpose from one that half-moved money.
 */
export const PAYOUT_HOLD_SPLIT_ERROR = "the Helpr's payouts are on hold";

/**
 * The execution_error execute-dispute-split records when a JOB payout hold
 * (public.job_payout_holds, Q1491) stopped the split. Its own text, so the
 * admin is not sent to the Payout Queue for a Helpr hold that does not exist,
 * and auto-resolve-disputes sets the split aside while the job is still held
 * (lh-money-escrow review of the Q1491 rebuild, #1).
 */
export const PAYOUT_JOB_HOLD_SPLIT_ERROR = "this job's payout is on hold (job_payout_holds)";

/**
 * The refusal a payout path shows for a job hold. Generic on purpose: the
 * table holds any job-level hold, and its recorded reason is internal (a
 * Checkout Session and gift card id), so it goes in logs and the 409 body's
 * hold_reason, never in the person-facing text (review of Q1491 #6).
 */
export const JOB_PAYOUT_HELD_MESSAGE = "This job's payout is on hold until an admin reconciles it. No money was moved.";

/**
 * Did this insert fail because the payout_transfers trigger refused a claim
 * for a held Helpr (20261004162921: 23514, message payout_held)? That is a
 * hold landing between a function's own check and its claim, and is answered
 * like the check itself, not as a failure.
 */
export function isPayoutHeldRefusal(message: string | null | undefined): boolean {
  return !!message && /\bpayout_held\b/.test(message);
}

interface PayoutHoldRow {
  helper_id: string;
  reason: string;
  held_at: string | null;
  denied_at: string | null;
}

export type PayoutHoldsLookup =
  | { ok: true; holds: Map<string, PayoutHoldRow> }
  | { ok: false; message: string };

export type PayoutHoldCheck =
  | { kind: "clear" }
  | { kind: "held"; reason: string; denied: boolean }
  | { kind: "error"; message: string };

const tableMissing = (error: unknown) => {
  const code = String((error as { code?: string } | null)?.code ?? "");
  return code === "42P01" || code === "PGRST205";
};

/** Every hold among `helperIds` (nulls ignored), keyed by helper id. */
export async function loadPayoutHolds(
  supabaseAdmin: { from: (t: string) => any },
  helperIds: ReadonlyArray<string | null | undefined>,
): Promise<PayoutHoldsLookup> {
  const ids = [...new Set(helperIds.filter((x): x is string => typeof x === "string" && x.length > 0))];
  const holds = new Map<string, PayoutHoldRow>();
  if (ids.length === 0) return { ok: true, holds };
  const { data, error } = await supabaseAdmin
    .from("payout_holds")
    .select("helper_id, reason, held_at, denied_at")
    .in("helper_id", ids);
  if (error) {
    if (tableMissing(error)) return { ok: true, holds };
    return { ok: false, message: (error as { message?: string }).message ?? "payout hold read failed" };
  }
  for (const row of (data ?? []) as PayoutHoldRow[]) {
    if (row && ids.includes(row.helper_id)) holds.set(row.helper_id, row);
  }
  return { ok: true, holds };
}

export type JobPayoutHoldCheck =
  | { kind: "clear" }
  | { kind: "held"; reason: string }
  | { kind: "error"; message: string };

/**
 * Is this JOB's payout on hold (public.job_payout_holds, Q1491: a gift-card
 * difference payment whose gift was not there any more)? The payout_transfers
 * claim trigger refuses a held job; a path that transfers BEFORE writing its
 * ledger row (Quick Release, the dispute split) asks this first. Fails closed;
 * a missing table (the migration-lag window) holds no job.
 */
export async function checkJobPayoutHold(
  supabaseAdmin: { from: (t: string) => any },
  jobId: string | null | undefined,
): Promise<JobPayoutHoldCheck> {
  if (!jobId) return { kind: "clear" };
  const { data, error } = await supabaseAdmin
    .from("job_payout_holds")
    .select("job_id, reason")
    .eq("job_id", jobId)
    .maybeSingle();
  if (error) {
    if (tableMissing(error)) return { kind: "clear" };
    return { kind: "error", message: (error as { message?: string }).message ?? "job payout hold read failed" };
  }
  const row = data as { job_id?: string; reason?: string } | null;
  return row?.job_id ? { kind: "held", reason: row.reason ?? "" } : { kind: "clear" };
}

/**
 * Which of `jobIds` have a JOB payout hold. Fails closed (ok: false on a read
 * error); a missing table (the migration-lag window) holds no job.
 */
export async function loadJobPayoutHolds(
  supabaseAdmin: { from: (t: string) => any },
  jobIds: ReadonlyArray<string | null | undefined>,
): Promise<{ ok: true; jobs: Set<string> } | { ok: false; message: string }> {
  const ids = [...new Set(jobIds.filter((x): x is string => typeof x === "string" && x.length > 0))];
  const jobs = new Set<string>();
  if (ids.length === 0) return { ok: true, jobs };
  const { data, error } = await supabaseAdmin
    .from("job_payout_holds")
    .select("job_id")
    .in("job_id", ids);
  if (error) {
    if (tableMissing(error)) return { ok: true, jobs };
    return { ok: false, message: (error as { message?: string }).message ?? "job payout hold read failed" };
  }
  for (const row of (data ?? []) as Array<{ job_id?: string | null }>) {
    if (row?.job_id && ids.includes(row.job_id)) jobs.add(row.job_id);
  }
  return { ok: true, jobs };
}

/** Is this one Helpr on hold? Call it before any money moves to them. */
export async function checkPayoutHold(
  supabaseAdmin: { from: (t: string) => any },
  helperId: string | null | undefined,
): Promise<PayoutHoldCheck> {
  if (!helperId) return { kind: "clear" };
  const lookup = await loadPayoutHolds(supabaseAdmin, [helperId]);
  if (!lookup.ok) return { kind: "error", message: lookup.message };
  const row = lookup.holds.get(helperId);
  if (!row) return { kind: "clear" };
  return { kind: "held", reason: row.reason, denied: row.denied_at !== null && row.denied_at !== undefined };
}

export type IdentityHoldCheck =
  | { kind: "clear" }
  | { kind: "waits" }
  | { kind: "error"; message: string };

/** The Helpr-facing words when a payout waits on their ID (owner 2026-10-30). */
export const IDENTITY_HOLD_MESSAGE = "Verify your ID once with Stripe and we send your pay. Nothing was moved.";

/** The tipper's words when the Helpr has not verified their ID (owner 2026-10-30: tips are blocked until they do; no money is taken). */
export const TIP_WAITS_ON_ID_MESSAGE = "This Helpr can receive tips once verified. Nothing was charged.";
export const TIP_WAITS_ON_ID_CODE = "tip_waits_on_identity";

/**
 * No payout without a verified ID (owner 2026-10-30): public.payout_waits_on_identity,
 * FALSE while the `identity_check` switch is off and for an enrolled test account.
 * Nothing is claimed or sent, so the money stays where it is and the next run asks
 * again. FAILS CLOSED like the hold above. PGRST202 (the function is older than this
 * deploy) reads clear: the payout_transfers claim trigger still asks the same question.
 */
export async function checkIdentityHold(
  supabaseAdmin: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> },
  payeeId: string | null | undefined,
): Promise<IdentityHoldCheck> {
  if (!payeeId) return { kind: "clear" };
  const { data, error } = await supabaseAdmin.rpc("payout_waits_on_identity", { p_user_id: payeeId });
  if (error) {
    if (error.code === "PGRST202") return { kind: "clear" };
    return { kind: "error", message: error.message ?? "payout_waits_on_identity failed" };
  }
  return data === true ? { kind: "waits" } : { kind: "clear" };
}
