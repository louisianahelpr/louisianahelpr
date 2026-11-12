/**
 * Is this profile's payout account ready (Stripe answered payouts on)? The same test the payout paths use.
 * Its own dependency-free module (Q178, 11-11): payoutAfterHire.ts sits in the signed-in-pages chunk, so the Declutter
 * Selling screens importing it from there carried that whole chunk on their critical path. payoutAfterHire re-exports it.
 */
export function payoutAccountReady(profile: { stripe_account_id?: string | null; stripe_payouts_enabled?: boolean | null } | null | undefined): boolean {
  return !!profile?.stripe_account_id && profile.stripe_payouts_enabled === true;
}
