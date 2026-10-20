/** One of the Helpr's own `payout_transfers` rows for a job. */
export interface TransferRow {
  amount_cents: number;
  status: string;
  metadata: unknown;
}

/**
 * What the Helpr kept from this job's transfers, in cents.
 * - failed / canceled moved nothing: skipped.
 * - reversed AND reversal_cleared were clawed back (money-reconciliation treats
 *   both as not kept): only what metadata.amount_reversed_cents says was NOT
 *   taken back counts; with no figure the whole row was taken back (0).
 *   An operator's re-pay after a clear is its own `paid` row.
 * - sent = something kept and no row still `pending`.
 * lh-money-escrow review of the 35/36 diff, findings 1-2.
 */
export function transferredCents(rows: readonly TransferRow[]): { cents: number; sent: boolean } {
  let cents = 0;
  let pending = false;
  for (const t of rows) {
    if (t.status === "failed" || t.status === "canceled") continue;
    const amount = Math.max(0, Number(t.amount_cents ?? 0));
    if (t.status === "reversed" || t.status === "reversal_cleared") {
      const taken = (t.metadata as { amount_reversed_cents?: number } | null)?.amount_reversed_cents;
      cents += taken == null ? 0 : Math.max(0, amount - Number(taken));
      continue;
    }
    if (t.status === "pending") pending = true;
    cents += amount;
  }
  return { cents, sent: cents > 0 && !pending };
}

