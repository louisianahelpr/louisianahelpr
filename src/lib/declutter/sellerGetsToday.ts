/**
 * F328 (owner 11-11 ~2:10 PM: the Sell form shows "You get $Y" only): what the seller receives if the item sells
 * today at `priceCents`, by the payout SQL's own rule, never the bare price.
 *
 * declutter_complete_handover writes the payout as items + delivery - fee debt; declutter_payout_take_setup_fee then
 * takes the one-time setup fee (declutter_setup_fee_from_payout_cents: 0 for an admin, 0 when the seller is
 * identity_check_exempt, which is every member while the ID check is off, else the unpaid onboarding fee) right before
 * the transfer, and only when at least $1 is left (20261031214749). Before this the form showed the list price, so a
 * first-time seller with the ID check on read a figure the setup fee too high.
 *
 * Not mirrored here, by design: a card-fee debt (only after a seller-fault refund) and a manager's share (only for a
 * managed seller) are not knowable on the form; the order card states the payout row's own figure once it exists.
 */
export function sellerGetsTodayCents(priceCents: number, setupFeeCents: number): number {
  // setupFeeCents: useSellerSetupFee's answer (0 for an admin, an exempt seller, or one who already paid it).
  const fee = Math.max(0, setupFeeCents);
  return fee > 0 && priceCents - fee >= 100 ? priceCents - fee : priceCents;
}
