/**
 * Resolve a Stripe Subscription's current period end — the ONE reader.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * `subscription.current_period_end` DOES NOT EXIST on the API version this
 * project pins. Stripe removed `current_period_start`/`current_period_end`
 * from the Subscription object in API version **2025-03-31.basil** and moved
 * them onto each SubscriptionItem; every edge function here constructs
 * `new Stripe(key, { apiVersion: "2025-08-27.basil" })`, which is later than
 * that, and imports `https://esm.sh/stripe@18.5.0`, whose own
 * `types/Subscriptions.d.ts` has no such property (it carries
 * `billing_cycle_anchor` and `cancel_at_period_end`, and the period fields
 * live only in `types/SubscriptionItems.d.ts`).
 *
 * Verified against the LIVE test-mode API on 2026-09-01 — a freshly created
 * subscription came back with `billing_cycle_anchor`, `cancel_at_period_end`,
 * and `items.data[0].current_period_end`, and NO top-level period fields.
 *
 * The consequence of reading the missing field was not a wrong date, it was a
 * THROW: `undefined * 1000` is `NaN`, and `new Date(NaN).toISOString()` raises
 * `RangeError: Invalid time value`. In `stripe-webhook` that throw propagated
 * to the dispatcher, which rolls back the idempotency row and returns 500, so
 * Stripe redelivered and the handler threw again — every recurring membership
 * checkout and every renewal failed to grant its tier, permanently. Nothing
 * caught it at build time because `tsconfig.app.json`'s `include` covers `src`
 * plus three named `_shared` files only; no edge handler is ever typechecked.
 *
 * ── Contract ────────────────────────────────────────────────────────────────
 * Returns an ISO string, or `null` when no item carries a usable timestamp.
 * NEVER throws and never returns "Invalid Date" — callers get an explicit
 * null to handle, because a silently-wrong expiry on a paid entitlement is
 * worse than an absent one.
 *
 * When a subscription has several items (mixed intervals), the LATEST period
 * end wins: the buyer has paid through that instant, so that is when the
 * entitlement may lapse.
 */

/** Minimal structural shape — avoids importing Stripe's types into callers. */
interface PeriodBearingSubscription {
  items?: { data?: Array<{ current_period_end?: unknown }> } | null;
  /** Pre-Basil top-level field. Absent on 2025-03-31.basil and later. */
  current_period_end?: unknown;
}

const asEpochSeconds = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

/**
 * The subscription's current period end as an ISO timestamp, or null.
 *
 * @param subscription A Stripe.Subscription (structurally typed so this file
 *                     stays importable from vitest without the Stripe SDK).
 */
export function subscriptionCurrentPeriodEndISO(
  subscription: PeriodBearingSubscription | null | undefined,
): string | null {
  let latest: number | null = null;

  for (const item of subscription?.items?.data ?? []) {
    const seconds = asEpochSeconds(item?.current_period_end);
    if (seconds !== null) latest = latest === null ? seconds : Math.max(latest, seconds);
  }

  // Fallback for anything still served on a pre-Basil API version. Deliberately
  // second: on the pinned version this is always undefined, so the item scan
  // above is the real path and this only ever helps an older caller.
  if (latest === null) latest = asEpochSeconds(subscription?.current_period_end);

  if (latest === null) return null;

  const iso = new Date(latest * 1000);
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
}
