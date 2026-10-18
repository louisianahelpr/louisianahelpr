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
 *
 * Q2142 (lh-money-escrow review of 2340db8b7 #1): the email lookup itself was
 * the deeper defect: an address reused by a new account inherits a deleted
 * member's customers. The portal now opens on the customer the member's own
 * subscription names (profiles.stripe_customer_id, written by stripe-webhook at
 * grant), read by user id, never by email; and only when that customer carries
 * a subscription (Q2141).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

const SUBSCRIBED_CUSTOMER = "cus_holdsthesubscription";

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

const MEMBER = "11111111-2222-4333-8444-555555555555";

describe("pro-customer-portal — the customer the member's subscription names, never one found by email (Q2142)", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
    scenario.authUser = { id: MEMBER, email: "member@test.dev" };
    scenario.reads.profiles = { rows: [{ stripe_customer_id: SUBSCRIBED_CUSTOMER }] };
    // A reused address: Stripe would happily return a deleted member's customer for it.
    stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_deletedmember" }] });
    stripeMock.subscriptions.list.mockImplementation(async ({ customer }: { customer: string }) =>
      customer === SUBSCRIBED_CUSTOMER || customer === "cus_deletedmember"
        ? { data: [{ id: "sub_1", status: "active" }] }
        : { data: [] },
    );
  });

  it("opens the portal on the profile's stored customer, read by the member's own user id; Stripe is never asked by email", async () => {
    const fn = await load();
    const res = await fn.fetch(call(fn));

    expect(res.status).toBe(200);
    expect(stripeMock.billingPortal.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({ customer: SUBSCRIBED_CUSTOMER }),
    );
    expect(stripeMock.customers.list).not.toHaveBeenCalled();
    const q = (scenario.readQueries ?? []).find((r) => r.table === "profiles");
    expect(q?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ op: "eq", column: "user_id", value: MEMBER })]));
  });

  it("looks up subscriptions with status 'all', so a past_due or ending member still reaches the portal", async () => {
    stripeMock.subscriptions.list.mockResolvedValue({ data: [{ id: "sub_pastdue", status: "past_due" }] });
    const fn = await load();
    const res = await fn.fetch(call(fn));

    expect(res.status).toBe(200);
    for (const [args] of stripeMock.subscriptions.list.mock.calls) {
      expect(args.status).toBe("all");
    }
  });

  it("no stored customer (never subscribed): 404, and the deleted member's customer on the same email is never opened", async () => {
    scenario.reads.profiles = { rows: [{ stripe_customer_id: null }] };
    const fn = await load();
    const res = await fn.fetch(call(fn));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No membership billing found for this account." });
    expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  // Q2141 (one wallet): a stored customer with no subscription can be the
  // member's wallet customer. Opening the portal on it lets a card added there
  // become its default card, which auto-tip charges off-session.
  it("Q2141: the stored customer carries NO subscription: 404, no portal", async () => {
    scenario.reads.profiles = { rows: [{ stripe_customer_id: "cus_wallet" }] };
    const fn = await load();
    const res = await fn.fetch(call(fn));

    expect(res.status).toBe(404);
    expect(stripeMock.subscriptions.list).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_wallet" }));
    expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  it("a malformed stored id is never sent to Stripe: 404", async () => {
    scenario.reads.profiles = { rows: [{ stripe_customer_id: "not-a-customer" }] };
    const fn = await load();
    const res = await fn.fetch(call(fn));

    expect(res.status).toBe(404);
    expect(stripeMock.subscriptions.list).not.toHaveBeenCalled();
    expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
  });

  it("the profile read fails: 500 (fail closed), never a portal and never \"no billing found\"", async () => {
    scenario.reads.profiles = { error: { message: "boom" } };
    const fn = await load();
    const res = await fn.fetch(call(fn));

    expect(res.status).toBe(500);
    expect(stripeMock.billingPortal.sessions.create).not.toHaveBeenCalled();
  });
});

// Proof this guard can fail: open the portal on the stored customer without
// checking it carries a subscription (Q2141), or skip the profile read's error.
// @mutate supabase/functions/pro-customer-portal/index.ts |       if (subs.data.length > 0) customerId = stored; |       customerId = stored;
// @mutate supabase/functions/pro-customer-portal/index.ts |     if (profileError) throw new Error(`profile read failed: ${profileError.message}`); |
// @mutate supabase/functions/pro-customer-portal/index.ts |       .eq("user_id", user.id) |       .eq("email", user.email)
