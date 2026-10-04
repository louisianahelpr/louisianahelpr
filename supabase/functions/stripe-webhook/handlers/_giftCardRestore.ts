// Q454: give back the gift card that funded a job a FULL refund just closed.
//
// A gift card is money the poster never charged to a card: redeem_gift_card
// consumed it against the job, so on a PARTLY gift-funded job the job's
// PaymentIntent is only the shortfall. A full refund of that PaymentIntent
// (charge.refunded, e.g. from the Stripe Dashboard) closes the job as
// 'refunded' and returns the card part; without this the gift part stayed
// 'redeemed' on a dead job and the recipient simply lost it.
//
// Same RPC and the same outcome rules as create-payment's
// restoreGiftForCancelledJob and void-cancelled-payments' restorePifGift: a
// null `error` is not proof, only the outcomes restore_gift_card_for_job
// defines count, and an error is survivable only when no gift is at stake.
// The default share (10000 bps) returns the whole gift: the whole job was
// refunded. Idempotent: a second call answers `already_restored` (the
// replacement row's restored_from_job_id is unique), so a redelivery, or a
// cancel or split that already restored it, mints nothing.

type Db = { rpc: (fn: string, args: Record<string, unknown>) => any; from: (t: string) => any };

export type GiftRestore =
  | { ok: true; outcome: string | null; restoreCents: number; spendable: boolean }
  | { ok: false; reason: string };

export async function restoreGiftForRefundedJob(supabase: Db, jobId: string): Promise<GiftRestore> {
  const { data, error: rpcErr } = await supabase.rpc("restore_gift_card_for_job", { p_job_id: jobId });
  const outcome = rpcErr ? null : ((data as { outcome?: string } | null)?.outcome ?? null);
  if (
    outcome === "restored" ||
    outcome === "unreserved" ||
    outcome === "already_restored" ||
    outcome === "no_credit" ||
    outcome === "nothing_to_restore" ||
    outcome === "job_not_found"
  ) {
    const d = (data ?? {}) as { restore_cents?: number; payment_status?: string };
    return {
      ok: true,
      outcome,
      restoreCents: Math.max(0, Math.round(Number(d.restore_cents ?? 0)) || 0),
      // A replacement minted from a REVOKED donation inherits 'refunded' and
      // cannot be spent; only a 'paid' one is announced as back.
      spendable: (d.payment_status ?? "paid") === "paid",
    };
  }
  const reason = rpcErr
    ? `${(rpcErr as { message?: string }).message ?? "rpc failed"}${(rpcErr as { code?: string }).code ? ` (${(rpcErr as { code?: string }).code})` : ""}`
    : `unrecognised outcome ${JSON.stringify(data)}`;
  // Already given back? The ORIGINAL row stays 'redeemed' after a restore, so
  // without this a redelivery while the RPC is down read a gift that is
  // already back as one still at stake, and threw for days (lh-money-escrow
  // review of Q454, LOW).
  const { data: restoredRows, error: restoredErr } = await supabase
    .from("gift_cards")
    .select("id, restored_from_job_id")
    .eq("restored_from_job_id", jobId)
    .limit(1);
  if (!restoredErr && ((restoredRows ?? []) as unknown[]).length > 0) {
    return { ok: true, outcome: "already_restored", restoreCents: 0, spendable: false };
  }
  // Was a gift at stake at all? On the ordinary card-funded job an unavailable
  // RPC must not hold the refund webhook hostage.
  const { data: giftRows, error: giftErr } = await supabase
    .from("gift_cards")
    .select("id")
    .eq("job_id", jobId)
    .in("status", ["redeemed", "reserved"])
    .limit(1);
  if (!restoredErr && !giftErr && ((giftRows ?? []) as unknown[]).length === 0) {
    return { ok: true, outcome: null, restoreCents: 0, spendable: false };
  }
  const lookupErr = (restoredErr ?? giftErr) as { message?: string } | null;
  return { ok: false, reason: lookupErr ? `${reason}; gift lookup failed: ${lookupErr.message ?? "read failed"}` : reason };
}

/**
 * A payout transfer for this job that moved money (pending with an id, paid,
 * or reversed). The whole gift comes back only when the Helpr was never paid
 * out of this escrow: restore_gift_card_for_job reads neither the job state nor
 * payout_transfers, and a fully refunded payout_pending job can still carry a
 * paid transfer (a payout whose job flip failed) or a crew part-way paid
 * (lh-money-escrow review of Q454, MEDIUM). Then a person decides.
 */
export async function payoutOnJob(
  supabase: Db,
  jobId: string,
): Promise<{ transferId?: string; readError?: string }> {
  const { data, error } = await supabase
    .from("payout_transfers")
    .select("id, stripe_transfer_id, status")
    .eq("job_id", jobId)
    .in("status", ["pending", "paid", "reversed"])
    .limit(1);
  if (error) return { readError: (error as { message?: string }).message ?? "payout_transfers read failed" };
  const row = ((data ?? []) as Array<{ id: string; stripe_transfer_id: string | null }>)[0];
  return row ? { transferId: row.stripe_transfer_id ?? row.id } : {};
}
