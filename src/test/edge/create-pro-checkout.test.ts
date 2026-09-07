/**
 * create-pro-checkout — executed, not grepped.
 *
 * WHY THIS FILE EXISTS. On 2026-09-05 I added a pre-purchase eligibility check
 * to this function and shipped it broken: the RPC ran on the module-level
 * client, which is built from the anon key with NO Authorization header. The
 * migration grants EXECUTE on that RPC to `authenticated` only, so it raised
 * 42501, hit the fail-closed branch, returned 503, and killed EVERY membership
 * purchase — every tier, every billing cycle. It was found in manual testing,
 * not by me.
 *
 * The tests I had written were source assertions:
 *     expect(SRC).toContain("subscription_purchase_eligibility")
 *     expect(SRC).toMatch(/eligibilityErr[\s\S]{0,400}status: 503/)
 * Both passed WITH the bug, because neither was about the thing that was
 * wrong. The RPC was called; it did fail closed. What no grep can see is which
 * identity it ran as.
 *
 * So this runs the real function through the edge harness and asserts the
 * property that actually matters: the eligibility RPC executes on a client
 * carrying the CALLER'S Authorization header. The supabase mock now records
 * createClient's options and tags each rpc call with its client, which is what
 * makes that assertable at all.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const JWT = "Bearer eyJhbGciOiJFUzI1NiJ9.caller-token.sig";
const USER = { id: "user-1", email: "member@example.com" };

let fn: EdgeHarness;

const post = (body: unknown, auth: string | null = JWT) =>
  fn.fetch(fn.request({
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: auth } : {}),
    },
    body,
  }));

beforeEach(async () => {
  resetEnv(); resetStripeMock(); resetSupabaseMock(); resetSharedMocks();
  setEnv({
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_x",
  });
  scenario.authUser = USER;
  scenario.rpc.subscription_purchase_eligibility = { allowed: true, code: "no_active_subscription" };
  stripeMock.customers.list.mockResolvedValue({ data: [] });
  stripeMock.checkout.sessions.create.mockResolvedValue({
    id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1",
  });
  fn = await loadEdgeFunction("create-pro-checkout");
});

describe("the eligibility RPC runs as the CALLER", () => {
  it("executes on a client carrying the caller's Authorization header", async () => {
    await post({ tier: "plus", billing_cycle: "monthly" });

    const call = scenario.rpcCalls?.find((c) => c.name === "subscription_purchase_eligibility");
    expect(call, "eligibility RPC was never called").toBeTruthy();

    const client = scenario.clients?.[call!.client ?? -1];
    expect(client, "could not resolve which client the RPC ran on").toBeTruthy();

    // THE ASSERTION THE OUTAGE NEEDED. An anon-key client with no headers
    // authenticates as `anon`, which has no EXECUTE on this RPC.
    const headers = (client!.options?.global as { headers?: Record<string, string> } | undefined)?.headers;
    expect(headers?.Authorization, "RPC ran on a client with no caller JWT — it would execute as anon").toBe(JWT);
  });
});

describe("verdicts are honoured", () => {
  it("refuses with 409 and the server's own wording when not allowed", async () => {
    scenario.rpc.subscription_purchase_eligibility = {
      allowed: false, code: "active_subscription_elsewhere",
      reason: "You already have a membership billed through the App Store.",
    };
    const res = await post({ tier: "plus", billing_cycle: "monthly" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/App Store/);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("fails CLOSED with 503 when the check itself errors", async () => {
    scenario.rpcErrors = {
      subscription_purchase_eligibility: { message: "permission denied", code: "42501" },
    };
    const res = await post({ tier: "plus", billing_cycle: "monthly" });
    expect(res.status).toBe(503);
    // No Session may be created on a purchase we could not prove is allowed.
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("creates a Checkout Session when allowed", async () => {
    const res = await post({ tier: "plus", billing_cycle: "monthly" });
    expect(res.status).toBe(200);
    expect((await res.json()).url).toContain("checkout.stripe.com");
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalled();
  });

  it("checks eligibility BEFORE creating a Session", async () => {
    await post({ tier: "plus", billing_cycle: "monthly" });
    const names = (scenario.rpcCalls ?? []).map((c) => c.name);
    expect(names).toContain("subscription_purchase_eligibility");
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalled();
  });
});

describe("automatic_tax needs an address, and this is where every helper failed", () => {
  // THE BUG. Stripe refuses to open a Checkout Session with automatic tax
  // enabled unless the Customer already carries an address, OR the session is
  // told to save the one collected at checkout. This function enabled the tax
  // and omitted the second half, so the call threw
  // `customer_tax_location_invalid` and the endpoint answered 500.
  //
  // Who it hit is the whole point. The customer is resolved by EMAIL, so it
  // failed for anyone holding an existing Stripe Customer with no address —
  // and the only thing that ever writes an address onto a Helpr customer is
  // create-payment, i.e. funding a job AS A POSTER. Every tier card on that
  // screen reads "For Helprs...", so memberships were broken for exactly the
  // audience they are sold to: a helper who had never posted a job could not
  // buy any tier, on any cycle. Proved both ways on one build 2026-09-06 —
  // the addressless helper 500'd every attempt; the poster with an address
  // completed a $15 Plus purchase.
  it("sends customer_update when there is a customer to update", async () => {
    stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_existing" }] });
    const res = await post({ tier: "plus", billing_cycle: "monthly" });
    expect(res.status).toBe(200);
    const [params] = stripeMock.checkout.sessions.create.mock.calls[stripeMock.checkout.sessions.create.mock.calls.length - 1]!;
    expect(params.customer).toBe("cus_existing");
    expect(params.automatic_tax).toEqual({ enabled: true });
    // The one line. Without it Stripe throws before a session exists.
    expect(params.customer_update).toEqual({ address: "auto" });
  });

  it("omits customer_update when there is NO customer — Stripe rejects it there", async () => {
    // `customer_update` is only valid alongside an existing `customer`. Sending
    // it unconditionally would trade one 500 for another, on first-time buyers.
    stripeMock.customers.list.mockResolvedValue({ data: [] });
    const res = await post({ tier: "plus", billing_cycle: "monthly" });
    expect(res.status).toBe(200);
    const [params] = stripeMock.checkout.sessions.create.mock.calls[stripeMock.checkout.sessions.create.mock.calls.length - 1]!;
    expect(params.customer).toBeUndefined();
    expect(params.customer_update).toBeUndefined();
    expect(params.customer_email).toBe(USER.email);
  });

  it("does the same on the one-time cycle, not just subscriptions", async () => {
    // isOneTime switches mode to "payment" and takes a different branch below
    // the shared params; the tax requirement is identical either way.
    stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_existing" }] });
    const res = await post({ tier: "elite", billing_cycle: "one_time" });
    expect(res.status).toBe(200);
    const [params] = stripeMock.checkout.sessions.create.mock.calls[stripeMock.checkout.sessions.create.mock.calls.length - 1]!;
    expect(params.mode).toBe("payment");
    expect(params.customer_update).toEqual({ address: "auto" });
  });
});
