/**
 * Unit tests for the `pro-customer-portal` Supabase edge function.
 *
 * This function IS the self-serve exit. It is the only path a member has to
 * cancel a membership, switch tiers, or update the card being charged — the
 * Membership screen's "Manage" button opens whatever URL it returns.
 *
 * Stripe scopes a Billing Portal session to ONE customer. So the customer this
 * function picks decides whether the member sees their plan or an empty page,
 * and it was picking with `stripe.customers.list({ email, limit: 1 })` — an
 * arbitrary record. One person routinely holds more than one Stripe customer on
 * one address (one minted by Checkout, another by a Connect or test flow), and
 * both sibling functions had already found this and fixed it, each with a
 * comment saying so:
 *
 *   - check-pro-subscription:61-67 — "`limit: 1` returned an arbitrary one …
 *     this function concluded 'no subscription' and downgraded a paying
 *     subscriber on a dashboard load"
 *   - create-pro-checkout:74-84 — "An audit reproduced it five times out of
 *     five on a subscribed account"
 *
 * This one was left behind, and it is the worst place to leave it: a member
 * who cannot reach their subscription in the portal keeps being billed with no
 * way to stop it.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

const EMPTY_CUSTOMER = "cus_empty_duplicate";
const SUBSCRIBED_CUSTOMER = "cus_holds_the_subscription";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    STRIPE_SECRET_KEY: "sk_test_portal",
  });
  return loadEdgeFunction("pro-customer-portal");
}

function call(fn: EdgeHarness) {
  return fn.request({ headers: { Authorization: "Bearer user-jwt" }, body: {} });
}

describe("pro-customer-portal — picking the customer that holds the subscription", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
    scenario.authUser = { id: "user-portal-1", email: "member@test.dev" };
  });

  it("considers EVERY customer record for the email, not just the first", async () => {
    stripeMock.customers.list.mockResolvedValue({ data: [{ id: EMPTY_CUSTOMER }] });
    const fn = await load();
    await fn.fetch(call(fn));

    // `limit: 1` is the defect. Anything above 1 lets the loop below see the
    // duplicate records that exist in practice.
    const listArgs = stripeMock.customers.list.mock.calls[0][0];
    expect(listArgs.email).toBe("member@test.dev");
    expect(listArgs.limit).toBeGreaterThan(1);
  });

  it("opens the portal on the record that HOLDS the subscription, not the first one", async () => {
    // The duplicate comes back first — exactly the arbitrary ordering the
    // sibling functions documented.
    stripeMock.customers.list.mockResolvedValue({
      data: [{ id: EMPTY_CUSTOMER }, { id: SUBSCRIBED_CUSTOMER }],
    });
    stripeMock.subscriptions.list.mockImplementation(async ({ customer }: { customer: string }) =>
      customer === SUBSCRIBED_CUSTOMER
        ? { data: [{ id: "sub_1", status: "active" }] }
        : { data: [] },
    );

    const fn = await load();
    const res = await fn.fetch(call(fn));

    expect(res.status).toBe(200);
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: SUBSCRIBED_CUSTOMER }),
    );
  });

  it("looks up subscriptions with status 'all', so a past_due or ending member still reaches the portal", async () => {
    // Filtering to `active` would send exactly the people who most need the
    // portal — past_due, unpaid, paused, cancel_at_period_end — back to the
    // empty duplicate record.
    stripeMock.customers.list.mockResolvedValue({
      data: [{ id: EMPTY_CUSTOMER }, { id: SUBSCRIBED_CUSTOMER }],
    });
    stripeMock.subscriptions.list.mockImplementation(async ({ customer }: { customer: string }) =>
      customer === SUBSCRIBED_CUSTOMER
        ? { data: [{ id: "sub_pastdue", status: "past_due" }] }
        : { data: [] },
    );

    const fn = await load();
    await fn.fetch(call(fn));

    for (const [args] of stripeMock.subscriptions.list.mock.calls) {
      expect(args.status).toBe("all");
    }
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: SUBSCRIBED_CUSTOMER }),
    );
  });

  it("does not spend a subscriptions lookup when there is only one customer", async () => {
    stripeMock.customers.list.mockResolvedValue({ data: [{ id: SUBSCRIBED_CUSTOMER }] });
    const fn = await load();
    await fn.fetch(call(fn));

    expect(stripeMock.subscriptions.list).not.toHaveBeenCalled();
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: SUBSCRIBED_CUSTOMER }),
    );
  });

  it("still fails when the email has no Stripe customer at all", async () => {
    stripeMock.customers.list.mockResolvedValue({ data: [] });
    const fn = await load();
    const res = await fn.fetch(call(fn));

    expect(res.status).toBe(500);
    expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
});
