/**
 * The gift card journey's ledger checks (SC-005), as PURE functions.
 *
 * e2e/prod-gift-card.spec.ts reads real `gift_cards` / `jobs` rows off prod and
 * hands them here; each function returns the list of ways the rows disagree
 * with what the product code says they must be (empty = consistent). They live
 * outside the spec for one reason: the spec can only run where the shared test
 * accounts exist (GitHub secrets), so "its assertions can fail" is proven here
 * instead, offline, by src/test/giftCardJourneyLedger.test.ts feeding each
 * check a row that is wrong in exactly one way.
 *
 * Every expectation cites the writer that produces it, so a check can be read
 * against its source rather than trusted:
 *   pre-registration  create-gift-card-checkout (insert, payment_status pending)
 *   mint              stripe-webhook checkoutSessionCompleted (kind gift_card_purchase)
 *   claim             claim-gift-card (atomic recipient_id bind)
 *   settle / reserve  redeem_gift_card (via create-payment { giftCardId })
 *   consume           stripe-webhook checkoutSessionCompleted (metadata.gift_card_id)
 *   restore           restore_gift_card_for_job (on cancellation)
 */

export type GiftRow = {
  id: string;
  donor_id: string | null;
  recipient_id: string | null;
  recipient_email: string | null;
  amount: number | string;
  status: string;
  payment_status: string;
  job_id: string | null;
  claim_token: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  parent_credit_id: string | null;
  restored_from_job_id: string | null;
  redeemed_at: string | null;
  expires_at: string | null;
};

/** The columns every read in the journey selects, so each check sees them all. */
export const GIFT_COLUMNS =
  "id,donor_id,recipient_id,recipient_email,amount,status,payment_status,job_id,claim_token," +
  "stripe_session_id,stripe_payment_intent_id,parent_credit_id,restored_from_job_id,redeemed_at,expires_at";

/** Money is compared in integer cents; PostgREST returns numeric as number or string. */
export const cents = (amount: number | string | null | undefined): number => Math.round(Number(amount ?? NaN) * 100);

const DAY_MS = 86_400_000;

function expiresRoughly90DaysOut(row: GiftRow, now: number, out: string[]) {
  // Column default `now() + interval '90 days'` (20260612310000), stamped when
  // create-gift-card-checkout pre-registers the row.
  if (!row.expires_at) {
    out.push("expires_at is null — the 90-day column default did not apply");
    return;
  }
  const days = (Date.parse(row.expires_at) - now) / DAY_MS;
  if (!(days > 89 && days < 91)) out.push(`expires_at is ${days.toFixed(2)} days out, expected ~90`);
}

/** create-gift-card-checkout's pre-registration, before the donor has paid. */
export function checkPreRegistered(
  row: GiftRow,
  e: { donorId: string; recipientEmail: string; faceCents: number; sessionId: string; now: number },
): string[] {
  const out: string[] = [];
  if (row.donor_id !== e.donorId) out.push(`donor_id ${row.donor_id} ≠ donor ${e.donorId}`);
  if (row.recipient_email !== e.recipientEmail.toLowerCase())
    out.push(`recipient_email ${row.recipient_email} ≠ ${e.recipientEmail.toLowerCase()}`);
  if (cents(row.amount) !== e.faceCents) out.push(`amount ${cents(row.amount)}¢ ≠ face ${e.faceCents}¢`);
  if (row.payment_status !== "pending") out.push(`payment_status ${row.payment_status}, expected pending (unpaid gifts are inert)`);
  if (row.status !== "available") out.push(`status ${row.status}, expected available (nothing has been sent)`);
  if (row.stripe_session_id !== e.sessionId) out.push(`stripe_session_id ${row.stripe_session_id} ≠ ${e.sessionId}`);
  if (row.claim_token !== null) out.push("claim_token set before payment — a claim link could exist for an unpaid gift");
  if (row.recipient_id !== null) out.push("recipient_id bound before payment");
  if (row.stripe_payment_intent_id !== null) out.push("stripe_payment_intent_id set before payment");
  expiresRoughly90DaysOut(row, e.now, out);
  return out;
}

/** stripe-webhook's mint of a paid gift (the pending row completed in place). */
export function checkMinted(
  row: GiftRow,
  e: { preRegisteredId: string; donorId: string; recipientId: string; faceCents: number; now: number },
): string[] {
  const out: string[] = [];
  if (row.id !== e.preRegisteredId) out.push(`minted row ${row.id} is not the pre-registered row ${e.preRegisteredId} — a second row was inserted`);
  if (row.donor_id !== e.donorId) out.push(`donor_id ${row.donor_id} ≠ donor ${e.donorId}`);
  if (cents(row.amount) !== e.faceCents) out.push(`amount ${cents(row.amount)}¢ ≠ face ${e.faceCents}¢`);
  if (row.payment_status !== "paid") out.push(`payment_status ${row.payment_status}, expected paid`);
  if (row.status !== "sent") out.push(`status ${row.status}, expected sent`);
  if (!/^[0-9a-f]{64}$/.test(row.claim_token ?? "")) out.push(`claim_token ${JSON.stringify(row.claim_token)} is not 32 bytes of hex`);
  if (!/^pi_/.test(row.stripe_payment_intent_id ?? "")) out.push(`stripe_payment_intent_id ${row.stripe_payment_intent_id} is not a PaymentIntent`);
  // Auto-bind happens only for a CONFIRMED account owning the email; otherwise
  // the claim link binds it. Either is correct; anyone else is not.
  if (row.recipient_id !== null && row.recipient_id !== e.recipientId)
    out.push(`recipient_id ${row.recipient_id} is neither unbound nor the named recipient ${e.recipientId}`);
  if (row.job_id !== null || row.redeemed_at !== null) out.push("a freshly minted gift already carries a job or a redemption");
  expiresRoughly90DaysOut(row, e.now, out);
  return out;
}

/** After claim-gift-card: bound to the recipient and nothing else changed. */
export function checkClaimed(row: GiftRow, e: { recipientId: string; faceCents: number }): string[] {
  const out: string[] = [];
  if (row.recipient_id !== e.recipientId) out.push(`recipient_id ${row.recipient_id} ≠ recipient ${e.recipientId} after the claim`);
  if (row.status !== "sent" || row.payment_status !== "paid") out.push(`claim changed state to ${row.status}/${row.payment_status}`);
  if (cents(row.amount) !== e.faceCents) out.push(`claim changed amount to ${cents(row.amount)}¢`);
  return out;
}

/**
 * redeem_gift_card's 'settled' branch: gift ≥ job cost. The gift is consumed
 * against the job and any remainder becomes ONE fresh child gift.
 */
export function checkSettled(
  gift: GiftRow,
  children: GiftRow[],
  job: { id: string; payment_status: string },
  e: { costCents: number; recipientId: string },
): string[] {
  const out: string[] = [];
  if (job.payment_status !== "escrow") out.push(`job payment_status ${job.payment_status}, expected escrow (funded by the gift, no Stripe)`);
  if (gift.status !== "redeemed") out.push(`gift status ${gift.status}, expected redeemed`);
  if (gift.job_id !== job.id) out.push(`gift job_id ${gift.job_id} ≠ job ${job.id}`);
  if (!gift.redeemed_at) out.push("redeemed_at not stamped");
  const leftover = cents(gift.amount) - e.costCents;
  const live = children.filter((c) => c.restored_from_job_id === null);
  if (leftover > 0) {
    if (live.length !== 1) {
      out.push(`expected exactly one leftover child of ${leftover}¢, found ${live.length}`);
    } else {
      const c = live[0];
      if (cents(c.amount) !== leftover) out.push(`leftover child ${cents(c.amount)}¢ ≠ gift − cost = ${leftover}¢`);
      if (c.status !== "sent" || c.payment_status !== "paid") out.push(`leftover child is ${c.status}/${c.payment_status}, expected sent/paid`);
      if (c.recipient_id !== e.recipientId) out.push(`leftover child belongs to ${c.recipient_id}, not the recipient`);
      if (c.donor_id !== gift.donor_id) out.push("leftover child lost the donor");
      if (c.job_id !== null) out.push("leftover child is already tied to a job");
      if (c.claim_token !== null) out.push("leftover child carries a claim token (recipient is already resolved)");
    }
  } else if (live.length !== 0) {
    out.push(`gift covered the job exactly but ${live.length} leftover child(ren) exist`);
  }
  return out;
}

/** redeem_gift_card's 'needs_payment' branch: gift < cost, reserved against the job. */
export function checkReserved(gift: GiftRow, job: { id: string; payment_status: string }): string[] {
  const out: string[] = [];
  if (gift.status !== "reserved") out.push(`gift status ${gift.status}, expected reserved while the shortfall is unpaid`);
  if (gift.job_id !== job.id) out.push(`reserved gift job_id ${gift.job_id} ≠ job ${job.id}`);
  if (gift.redeemed_at !== null) out.push("a reserved gift already carries redeemed_at");
  if (job.payment_status !== "unpaid") out.push(`job payment_status ${job.payment_status} before the shortfall was paid`);
  return out;
}

/** The shortfall is exactly cost − gift: no service fee on a gift-card job. */
export function checkShortfall(differenceCents: number, e: { costCents: number; giftCents: number }): string[] {
  const expected = e.costCents - e.giftCents;
  return differenceCents === expected ? [] : [`shortfall charge ${differenceCents}¢ ≠ cost − gift = ${expected}¢`];
}

/** The difference Checkout's webhook consumed the reservation and funded the job. */
export function checkConsumed(gift: GiftRow, job: { id: string; payment_status: string }): string[] {
  const out: string[] = [];
  if (job.payment_status !== "escrow") out.push(`job payment_status ${job.payment_status}, expected escrow after the shortfall was paid`);
  if (gift.status !== "redeemed") out.push(`gift status ${gift.status}, expected redeemed once the shortfall cleared`);
  if (gift.job_id !== job.id) out.push(`gift job_id ${gift.job_id} ≠ job ${job.id}`);
  if (!gift.redeemed_at) out.push("redeemed_at not stamped");
  return out;
}

/**
 * restore_gift_card_for_job after the funded job was cancelled: exactly one
 * replacement, worth what the gift actually put into THAT job, spendable, and
 * owned by the same recipient. Without it the recipient's gift is simply gone.
 */
export function checkRestored(
  restored: GiftRow[],
  e: { jobId: string; parentId: string; appliedCents: number; recipientId: string },
): string[] {
  if (restored.length !== 1) return [`expected one gift restored from job ${e.jobId}, found ${restored.length} — the cancelled job kept the gift`];
  const r = restored[0];
  const out: string[] = [];
  if (r.parent_credit_id !== e.parentId) out.push(`restored gift's parent ${r.parent_credit_id} ≠ the gift spent on the job ${e.parentId}`);
  if (cents(r.amount) !== e.appliedCents) out.push(`restored ${cents(r.amount)}¢ ≠ the ${e.appliedCents}¢ the gift put into the job`);
  if (r.status !== "sent" || r.payment_status !== "paid") out.push(`restored gift is ${r.status}/${r.payment_status}, expected sent/paid (spendable)`);
  if (r.recipient_id !== e.recipientId) out.push(`restored gift belongs to ${r.recipient_id}, not the recipient`);
  if (r.job_id !== null) out.push("restored gift is already tied to a job");
  return out;
}
