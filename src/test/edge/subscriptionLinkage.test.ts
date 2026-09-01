/**
 * What the Membership card is allowed to claim, pinned against REAL Stripe
 * payloads.
 *
 * ── Why the payloads are captured verbatim ──────────────────────────────────
 * The outage behind this whole change was a SHAPE change, not a logic error:
 * Stripe removed `current_period_end` from the Subscription object in API
 * version 2025-03-31.basil and moved it onto each SubscriptionItem. Three call
 * sites kept reading the old field, got `undefined`, and
 * `new Date(NaN).toISOString()` threw `RangeError` — so every recurring
 * purchase and renewal 500-ed the webhook and granted nothing.
 *
 * A hand-written fixture cannot catch that class of bug, because whoever writes
 * the fixture writes it in the shape they already believe. The two objects
 * below were captured on 2026-09-01 from a real subscription created and then
 * cancelled in TEST MODE on the project's own account (acct_1RQbAfKp2H4b7tEC,
 * livemode:false; cancelled, refunded and marked for deletion afterwards),
 * trimmed only of fields nothing here reads.
 *
 * Note what is NOT in them: any top-level `current_period_end`.
 *
 * The DERIVATION of the linkage columns from these objects is exercised
 * end-to-end through the real handler in `stripe-webhook.test.ts` — the
 * `_shared` modules cannot be imported directly here because
 * `tsconfig.app.json` lists `_shared` files individually and these are not on
 * it. This file covers the half that is reachable: the shape itself, the
 * product→tier map, and the user-visible sentence.
 */
import { describe, it, expect } from "vitest";
import { PRODUCT_TO_TIER } from "../../../supabase/functions/_shared/productTiers";
import { renewalLabel } from "@/lib/subscriptionRenewalLabel";

/** Real: active monthly Pro, test mode, 2026-09-01. */
export const REAL_ACTIVE_SUBSCRIPTION = {
  id: "sub_1UAgVbKp2H4b7tECgY5A6IO8",
  object: "subscription",
  billing_cycle_anchor: 1788226146,
  cancel_at: null,
  cancel_at_period_end: false,
  canceled_at: null,
  collection_method: "charge_automatically",
  created: 1788226146,
  currency: "usd",
  customer: "cus_VB2aUOOVNYDZ0E",
  status: "active",
  items: {
    object: "list",
    data: [
      {
        id: "si_VB2aEA4xiYo1pl",
        object: "subscription_item",
        current_period_end: 1790818146,
        current_period_start: 1788226146,
        price: {
          id: "price_1TqlWgKp2H4b7tEChj3Rrp6B",
          object: "price",
          lookup_key: "helpr_pro_monthly_test",
          product: "prod_UqSRPJAe0f92Xf",
          recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
          type: "recurring",
          unit_amount: 1000,
        },
        quantity: 1,
      },
    ],
  },
};

/** Real: the SAME subscription immediately after cancel_at_period_end. */
export const REAL_CANCELLED_SUBSCRIPTION = {
  ...REAL_ACTIVE_SUBSCRIPTION,
  cancel_at: 1790818146,
  cancel_at_period_end: true,
  canceled_at: 1788226164,
  cancellation_details: { reason: "cancellation_requested" },
  // Unchanged, and that is the whole point — see the test below.
  status: "active",
};

describe("real Stripe subscription payloads", () => {
  it("carry NO top-level current_period_end — it lives on the item", () => {
    expect("current_period_end" in REAL_ACTIVE_SUBSCRIPTION).toBe(false);
    expect("current_period_end" in REAL_CANCELLED_SUBSCRIPTION).toBe(false);
    expect(REAL_ACTIVE_SUBSCRIPTION.items.data[0].current_period_end).toBe(1790818146);
  });

  it("carry the billing interval on the item's price", () => {
    expect(REAL_ACTIVE_SUBSCRIPTION.items.data[0].price.recurring.interval).toBe("month");
  });

  it("map to a membership tier", () => {
    expect(PRODUCT_TO_TIER[REAL_ACTIVE_SUBSCRIPTION.items.data[0].price.product]).toBe("pro");
  });

  it("report a cancellation WITHOUT changing status or the period end", () => {
    // This is exactly why `status` alone cannot drive the copy: on the real
    // payload nothing about the status or the date changed when the member
    // cancelled. The ONLY signal that this membership will never renew is
    // cancel_at_period_end — which nothing in the schema stored until
    // migration 20260901011254.
    expect(REAL_CANCELLED_SUBSCRIPTION.status).toBe("active");
    expect(REAL_CANCELLED_SUBSCRIPTION.items.data[0].current_period_end).toBe(
      REAL_ACTIVE_SUBSCRIPTION.items.data[0].current_period_end,
    );
    expect(REAL_CANCELLED_SUBSCRIPTION.cancel_at_period_end).toBe(true);
  });
});

describe("what the Membership card is allowed to say", () => {
  it("says Renews for a live recurring subscription", () => {
    expect(renewalLabel({ billingCycle: "monthly", cancelAtPeriodEnd: false })).toBe("Renews");
    expect(renewalLabel({ billingCycle: "annual", cancelAtPeriodEnd: false })).toBe("Renews");
  });

  it("says Ends — not Renews — once cancel_at_period_end is set", () => {
    // Before that column existed the card printed "Renews {date}" for the
    // REAL_CANCELLED payload above: a statement that the member was about to be
    // charged again, made about a subscription they had just cancelled.
    expect(
      renewalLabel({
        billingCycle: "monthly",
        cancelAtPeriodEnd: REAL_CANCELLED_SUBSCRIPTION.cancel_at_period_end,
      }),
    ).toBe("Ends");
  });

  it("says Expires for a one-time pass — it lapses, it does not renew", () => {
    // The Once info box on the same screen promises "then lapses — no
    // auto-renewal". The card contradicted it.
    expect(renewalLabel({ billingCycle: "one_time", cancelAtPeriodEnd: false })).toBe("Expires");
  });

  it("cancellation beats cycle: a cancelled annual plan still Ends", () => {
    expect(renewalLabel({ billingCycle: "annual", cancelAtPeriodEnd: true })).toBe("Ends");
  });

  it("makes NO renewal claim when the cycle is unknown", () => {
    // Legacy rows granted before the column existed, which the reconciler
    // backfills on its next pass. Guessing the more flattering of two claims
    // about a charge is how this defect started.
    expect(renewalLabel({ billingCycle: null, cancelAtPeriodEnd: false })).toBe("Access through");
    expect(renewalLabel({ billingCycle: undefined, cancelAtPeriodEnd: null })).toBe("Access through");
    expect(renewalLabel({ billingCycle: "quarterly", cancelAtPeriodEnd: false })).toBe("Access through");
  });
});
