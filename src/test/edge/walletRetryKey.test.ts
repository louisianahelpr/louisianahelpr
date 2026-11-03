/**
 * Q2140 (lead 11-02): a wallet customer Stripe no longer has is replaced once and the Checkout retried with a
 * CHANGED idempotency key (":new-wallet"). Stripe caches the first request's resource_missing error under the old
 * key, and that failed request created nothing, so the retry cannot double-charge; reusing the old key with the new
 * customer would only replay the cached error (or be refused for changed params). The key differs ONLY on that
 * retry: a happy path keeps its key, and any other error is never retried, so it never gets a second key.
 * Run through the real create-gift-card-checkout (a fixed-key caller) and the real _shared/stripeCustomer.ts.
 *
 * @mutate supabase/functions/create-gift-card-checkout/index.ts | :${amountCents}${walletRetry ? ":new-wallet" : ""}`, | :${amountCents}`,
 * @mutate supabase/functions/_shared/stripeCustomer.ts |     return await fn(customerId, false); |     return await fn(customerId, true);
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const BUYER = "33333333-3333-4333-8333-333333333333";
const RECIPIENT = "44444444-4444-4444-8444-444444444444";
const RECIPIENT_EMAIL = "real.person@example.com";

function world() {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_real_money",
    STRIPE_TEST_SECRET_KEY: "sk_test_sandbox",
  });
  scenario.reads.test_accounts = { rows: [] };
  scenario.reads.profiles = {
    rows: [{ user_id: RECIPIENT }],
    eqOverrides: [{ column: "email", value: RECIPIENT_EMAIL, result: { rows: [{ user_id: RECIPIENT }] } }],
  };
  scenario.reads.gift_cards = { rows: [{ id: "gift_1" }] };
  scenario.reads.stripe_customers = { rows: [{ stripe_customer_id: "cus_dead" }] };
  scenario.rpc.replace_stripe_customer = "cus_fresh";
  scenario.authUser = { id: BUYER, email: "buyer@example.com" };
  stripeMock.customers.create.mockResolvedValue({ id: "cus_fresh" });
}

async function buy() {
  const fn = await loadEdgeFunction("create-gift-card-checkout");
  return fn.fetch(fn.request({ headers: { Authorization: "Bearer test-jwt" }, body: { amount: 25, recipient_email: RECIPIENT_EMAIL } }));
}
const creates = () => stripeMock.checkout.sessions.create.mock.calls as Array<[Record<string, unknown>, { idempotencyKey: string }]>;
const replaceCalls = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "replace_stripe_customer") as Array<{ name: string; args: Record<string, unknown> }>;

describe("Q2140: the retry after a replaced wallet customer gets its own idempotency key, and only it", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });
  afterEach(() => resetEnv());

  it("happy path: one Checkout on the stored customer, the plain key, no replace", async () => {
    world();
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_gift", url: "https://checkout.stripe.test/cs_gift" });
    const res = await buy();
    expect(res.status).toBe(200);
    expect(creates()).toHaveLength(1);
    expect(creates()[0][0].customer).toBe("cus_dead");
    expect(creates()[0][1].idempotencyKey).not.toMatch(/new-wallet/);
    expect(replaceCalls()).toHaveLength(0);
    expect(stripeMock.customers.create).not.toHaveBeenCalled();
  });

  it("resource_missing for the customer: replaced, retried ONCE on the new customer with the key plus ':new-wallet'", async () => {
    world();
    stripeMock.checkout.sessions.create
      .mockRejectedValueOnce(Object.assign(new Error("No such customer: 'cus_dead'"), { code: "resource_missing", param: "customer" }))
      .mockResolvedValue({ id: "cs_gift", url: "https://checkout.stripe.test/cs_gift" });
    const res = await buy();
    expect(res.status).toBe(200);
    expect(creates()).toHaveLength(2);
    const [[p1, o1], [p2, o2]] = creates();
    expect(p1.customer).toBe("cus_dead");
    expect(p2.customer).toBe("cus_fresh");
    expect(o2.idempotencyKey).toBe(`${o1.idempotencyKey}:new-wallet`);
    expect(replaceCalls()).toHaveLength(1);
    expect(replaceCalls()[0].args).toMatchObject({ p_user: BUYER, p_mode: "live", p_old: "cus_dead", p_new: "cus_fresh" });
  });

  it("any other Stripe error is never retried, so it never gets a second key", async () => {
    world();
    stripeMock.checkout.sessions.create.mockRejectedValue(Object.assign(new Error("rate limited"), { code: "rate_limit" }));
    const res = await buy();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(creates()).toHaveLength(1);
    expect(replaceCalls()).toHaveLength(0);
    expect(stripeMock.customers.create).not.toHaveBeenCalled();
  });
});
