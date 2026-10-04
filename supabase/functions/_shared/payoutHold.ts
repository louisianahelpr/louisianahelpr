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
