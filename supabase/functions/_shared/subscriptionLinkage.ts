/**
 * The Stripe→profile linkage columns, derived in ONE place.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * Until 2026-09-01 nothing in the database referenced the Stripe objects that
 * paid for a membership. `profiles.subscription_tier` and
 * `subscription_expires_at` were the whole record and the only join back to
 * Stripe was the customer's email — not unique in `profiles`, and a person can
 * hold several Stripe customers on one address (check-pro-subscription lists up
 * to 100 for exactly that reason). So a wrong tier could not be reconciled
 * against Stripe, and the `current_period_end` outage — every recurring
 * purchase and renewal silently failing for the life of the pinned API version
 * — was undetectable from our own data.
 *
 * Three writers stamp these columns (stripe-webhook's checkout and subscription
 * handlers, and check-pro-subscription). Deriving the values in three places is
 * how they drift, so it happens here.
 *
 * ── Idempotency ─────────────────────────────────────────────────────────────
 * Every function here is a pure projection of the Stripe object. Stripe retries
 * webhook deliveries, so a redelivered event recomputes byte-identical values
 * and the resulting UPDATE is a no-op write of the same row — there is no
 * counter to double-increment and no row to duplicate.
 */

/** Structural shapes only — keeps this importable from vitest without the SDK. */
interface LinkageBearingSubscription {
  id?: unknown;
  customer?: unknown;
  cancel_at_period_end?: unknown;
  items?: {
    data?: Array<{
      price?: { recurring?: { interval?: unknown } | null } | null;
    }>;
  } | null;
}

/** The three cycles the product actually sells. */
export type BillingCycle = "monthly" | "annual" | "one_time";

const CYCLES: readonly string[] = ["monthly", "annual", "one_time"];

/**
 * Normalise a caller-supplied cycle (session metadata, a request body) to one
 * of the three known values, or null.
 *
 * A whitelist rather than a pass-through because this value reaches the UI and
 * decides whether a member is told their membership "renews" or "expires".
 * Echoing an unrecognised string would put an unknown word in front of a
 * paying customer; null makes the UI fall back to a claim it can defend.
 *
 * It is also what makes a CHECK constraint on the column unnecessary — and a
 * CHECK is deliberately absent, because the only thing it could ever reject is
 * a webhook write, and a rejected webhook write means a captured payment with
 * no entitlement. That is the failure this whole change exists to prevent.
 */
export function normalizeBillingCycle(value: unknown): BillingCycle | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return CYCLES.includes(v) ? (v as BillingCycle) : null;
}

/**
 * The billing cycle implied by the subscription's own price, which is the
 * authoritative answer — session metadata is what the checkout was ASKED for,
 * this is what Stripe actually created and will actually charge.
 *
 * Returns null for anything that is not a plain month or year interval (weekly
 * or daily prices, or a subscription with no readable price): a cycle we cannot
 * name is better left unstated than guessed at, since the UI turns it into a
 * sentence about the member's money.
 */
export function billingCycleFromSubscription(
  subscription: LinkageBearingSubscription | null | undefined,
): BillingCycle | null {
  for (const item of subscription?.items?.data ?? []) {
    const interval = item?.price?.recurring?.interval;
    if (interval === "year") return "annual";
    if (interval === "month") return "monthly";
  }
  return null;
}

/** Shape written onto `profiles` alongside a tier grant. */
export interface SubscriptionLinkage {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_billing_cycle: BillingCycle | null;
  subscription_cancel_at_period_end: boolean;
}

/**
 * Linkage for a recurring subscription grant.
 *
 * @param fallbackCycle Cycle from the checkout session's metadata, used only
 *   when the price carries no readable interval.
 */
export function subscriptionLinkage(
  subscription: LinkageBearingSubscription | null | undefined,
  fallbackCycle?: unknown,
): SubscriptionLinkage {
  return {
    stripe_customer_id:
      typeof subscription?.customer === "string" ? subscription.customer : null,
    stripe_subscription_id: typeof subscription?.id === "string" ? subscription.id : null,
    subscription_billing_cycle:
      billingCycleFromSubscription(subscription) ?? normalizeBillingCycle(fallbackCycle),
    // Stripe keeps `status: "active"` and only flips this flag when someone
    // cancels in the portal — the perks last until the period they paid for
    // ends. Storing it is what lets the Membership card say "Ends" instead of
    // claiming a renewal that is not coming.
    subscription_cancel_at_period_end: subscription?.cancel_at_period_end === true,
  };
}

/**
 * Linkage for a one-time pass: a real entitlement with NO Stripe subscription
 * object behind it at all. Recording the cycle is what stops the reconciler
 * reading a pass as "tier with no live subscription" — the single largest
 * false-positive source in a subscription drift check — and what stops the UI
 * telling a 30-day pass holder their membership renews.
 */
export function oneTimePassLinkage(customerId: unknown): SubscriptionLinkage {
  return {
    stripe_customer_id: typeof customerId === "string" ? customerId : null,
    stripe_subscription_id: null,
    subscription_billing_cycle: "one_time",
    subscription_cancel_at_period_end: false,
  };
}

/**
 * Linkage for a membership that has ended (cancelled, deleted, unpaid, lapsed).
 *
 * `stripe_customer_id` is absent from this payload on purpose: the Customer
 * object survives cancellation and is the durable handle for reconciling a
 * later resubscribe, so it is left in place. Everything that describes the
 * *subscription* is cleared, because keeping it would assert a subscription the
 * profile no longer has — which is drift the reconciler would then report.
 */
export const CLEARED_SUBSCRIPTION_LINKAGE = {
  stripe_subscription_id: null,
  subscription_billing_cycle: null,
  subscription_cancel_at_period_end: false,
} as const;
