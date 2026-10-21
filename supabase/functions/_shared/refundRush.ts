/**
 * Board 141, owner 2026-10-21: an agreed PART refund also returns the rush
 * (urgent) fee in the SAME share as the price, so there is no cliff. Asking $20
 * back of a $40 job that paid a $10 rush fee returns $20 + $5 = $25, and the
 * Helpr keeps $20 of the price and $5 of the rush fee (less their fee).
 *
 * ONE rule, used by execute-dispute-split (the money), the app's previews and
 * copy (src/lib/refundRequests), and mirrored by the SQL "Refund agreed"
 * notice (20261021102943, refund_request_rush_back_cents) with the same
 * integer arithmetic: rush x asked / price, rounded half UP to the cent, in
 * integers only (no float can land a half cent on the wrong side).
 *
 * Integer cents in, integer cents out. Nothing to share (no rush fee, no
 * price, nothing asked) is 0; asking the whole price returns the whole rush fee.
 */
export function agreedRushRefundCents(rushCents: number, askedCents: number, priceCents: number): number {
  const rush = Math.max(0, Math.round(Number(rushCents) || 0));
  const asked = Math.max(0, Math.round(Number(askedCents) || 0));
  const price = Math.max(0, Math.round(Number(priceCents) || 0));
  if (rush === 0 || asked === 0 || price === 0) return 0;
  if (asked >= price) return rush;
  return Math.floor((2 * rush * asked + price) / (2 * price));
}
