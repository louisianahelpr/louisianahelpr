/**
 * Q2440: a crew member's money row the live payout gate holds (_shared/livePayoutHold.ts) says why, the way a single
 * Helpr's cancellation_fee_transfers row does (`payee_not_payable: <kind>`), so the reconciler reading failure_reason
 * has an answer.
 *
 * Written only when it differs (Q2439: a held row's text is not rewritten every run), by a filter on the UPDATE
 * itself rather than a read, so the callers' row reads did not have to change. Never on a paid row. Zero rows is
 * legitimate here (the row already says it, or was paid meanwhile), so the only failure is the error.
 */
// deno-lint-ignore no-explicit-any
type Db = any;

export type HeldReasonTable = "crew_cancellation_fee_shares" | "crew_block_fees";

export function heldReasonOf(kind: string): string {
  return `payee_not_payable: ${kind}`;
}

/** Null when written (or already said); otherwise the database error, for the run's defects. */
export async function noteHeldReason(admin: Db, table: HeldReasonTable, id: string, kind: string): Promise<string | null> {
  const reason = heldReasonOf(kind);
  const { error } = await admin
    .from(table)
    .update({ failure_reason: reason })
    .eq("id", id)
    .neq("status", "paid")
    .or(`failure_reason.is.null,failure_reason.neq."${reason}"`);
  return error ? String(error.message ?? error) : null;
}
