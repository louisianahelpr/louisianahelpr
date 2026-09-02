/**
 * What a membership actually DOES on its expiry date.
 *
 * The Membership card printed "Renews {date}" for every paid tier, because the
 * schema held only a tier and an expiry and nothing recorded which kind of
 * purchase produced them. So a 30-day one-time pass — which lapses, with no
 * auto-renewal, exactly as the Once info box on that screen promises — and a
 * cancelled subscription — which ends — both told the member they were about to
 * be charged again. Two different false statements about somebody's money, out
 * of one missing column.
 *
 * `subscription_billing_cycle` and `subscription_cancel_at_period_end`
 * (migration 20260901011254, written by the Stripe webhook from the
 * subscription's own price and cancel flag) are what let this say the true
 * thing. Extracted from SubscriptionTab so the claim is unit-testable against
 * real Stripe payloads rather than being an inline ternary nobody can pin.
 */
export type RenewalLabel = "Renews" | "Ends" | "Expires" | "Access through";

export interface RenewalState {
  /** profiles.subscription_billing_cycle — 'monthly' | 'annual' | 'one_time' | null */
  billingCycle: string | null | undefined;
  /** profiles.subscription_cancel_at_period_end */
  cancelAtPeriodEnd: boolean | null | undefined;
}

/**
 * Order matters. A cancelled subscription is ending whatever cycle it was on,
 * so that test comes first — Stripe keeps `status: "active"` and only flips
 * `cancel_at_period_end`, so the cycle still reads "monthly" for a membership
 * that will never renew again.
 *
 * A NULL cycle is the legacy case (a row granted before those columns existed,
 * which the reconciler backfills on its next pass) and it deliberately does NOT
 * fall back to "Renews". Guessing the more flattering of two claims about a
 * charge is how this defect started; "Access through" is what is actually
 * known and it is true in every one of the three cases.
 */
export function renewalLabel({ billingCycle, cancelAtPeriodEnd }: RenewalState): RenewalLabel {
  if (cancelAtPeriodEnd === true) return "Ends";
  if (billingCycle === "one_time") return "Expires";
  if (billingCycle === "monthly" || billingCycle === "annual") return "Renews";
  return "Access through";
}
