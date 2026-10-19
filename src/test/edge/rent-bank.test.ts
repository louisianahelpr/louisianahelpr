/**
 * Homes bank rent (20261019103751; owner D2/D7/D9; DRAFT pending lh-money-escrow; TEST mode only): the edge
 * side. Runs the REAL function source through the edge harness; Stripe, Supabase and the Deno runtime are
 * doubled. The money RULES live in SQL (src/test/pglite/homesBankRent.pglite.mjs); this proves the edge
 * side refuses live mode, calls the start RPC as the tenant, charges exactly the frozen amount by bank only,
 * and that the webhook records a payment only on the bank's confirmation.
 *
 * Registered mutations - each turns this file RED on its own:
 * @mutate supabase/functions/rent-bank-checkout/index.ts |   if (mode !== "test") return json({ error: "bank_rent_not_open" }, 409); |   if (false) return json({ error: "bank_rent_not_open" }, 409);
 * @mutate supabase/functions/rent-bank-checkout/index.ts |       payment_method_types: ["us_bank_account"], |       payment_method_types: ["card", "us_bank_account"],
 * @mutate supabase/functions/rent-bank-checkout/index.ts |   if (session.amount_total !== row.charge_cents) { |   if (false) {
 * @mutate supabase/functions/rent-bank-checkout/index.ts |   if (!tenancy \|\| tenancy.tenant_id !== user.id) return json({ error: "tenancy_not_found" }, 404); |   if (!tenancy) return json({ error: "tenancy_not_found" }, 404);
 * @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts |   if (isRentBank(pi)) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |   if (isRentBank(session)) { |   if (false) {
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetStripeMock, stripeMock } from "./mocks/stripe";
import { resetEmailMocks } from "./mocks/email";

const TENANT = "0000000c-0000-4000-8000-000000000001";
const LANDLORD = "0000000c-0000-4000-8000-000000000002";
const TENANCY = "0000000c-0000-4000-8000-0000000000aa";
const BANKPAY = "0000000c-0000-4000-8000-0000000000bb";

function env() {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_rent",
    STRIPE_TEST_SECRET_KEY: "sk_test_rent",
    STRIPE_WEBHOOK_SECRET: "whsec_live",
    STRIPE_TEST_WEBHOOK_SECRET: "whsec_test",
  });
}
async function json(res: Response): Promise<Record<string, any>> {
  return JSON.parse(await res.text());
}
const rpcs = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name);
const clientOf = (call: { client?: number }) => scenario.clients?.[call.client ?? -1];
const testParties = () => {
  scenario.reads.test_accounts = { rows: [{ user_id: TENANT }, { user_id: LANDLORD }] };
  scenario.reads.profiles = { rows: [{ user_id: TENANT, is_seed: true }, { user_id: LANDLORD, is_seed: true }] };
};

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
  resetEmailMocks();
  scenario.reads.test_accounts = { rows: [] };
  scenario.rpc.feature_enabled_for_user = true;
});

describe("rent-bank-checkout", () => {
  async function load() {
    env();
    scenario.authUser = { id: TENANT, email: "tenant@test.dev", email_confirmed_at: "2026-10-01T00:00:00Z" };
    scenario.reads.rental_tenancies = { rows: [{ landlord_id: LANDLORD, tenant_id: TENANT, status: "active" }] };
    scenario.rpc.rentals_start_bank_rent = { id: BANKPAY, rent_cents: 120000, fee_cents: 500, fee_payer: "tenant", charge_cents: 120500,
      transfer_cents: 120000, tenant_id: TENANT, landlord_id: LANDLORD };
    scenario.rpc.rentals_bank_rent_attach = null;
    return loadEdgeFunction("rent-bank-checkout");
  }
  const ask = (fn: Awaited<ReturnType<typeof load>>, amount = 120000) =>
    fn.request({ headers: { Authorization: "Bearer tenant-jwt" }, body: { action: "pay", tenancy_id: TENANCY, amount_cents: amount } });

  it("test parties: starts AS THE TENANT and opens a bank-only page for exactly the frozen charge, on the TEST key", async () => {
    const fn = await load();
    testParties();
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_test_rent", url: "https://checkout.stripe.test/rent", amount_total: 120500, livemode: false });
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(200);
    expect((await json(res)).url).toBe("https://checkout.stripe.test/rent");
    const start = rpcs("rentals_start_bank_rent")[0];
    expect(start?.args).toEqual({ p_tenancy_id: TENANCY, p_rent_cents: 120000 });
    expect(clientOf(start)?.key).toBe("anon-key");
    const [params, opts] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(params.payment_method_types).toEqual(["us_bank_account"]);
    expect(params.line_items.reduce((s: number, l: any) => s + l.price_data.unit_amount * l.quantity, 0)).toBe(120500);
    expect(params.payment_intent_data.transfer_data).toBeUndefined();
    expect(params.metadata).toMatchObject({ kind: "rent_bank_payment", bank_payment_id: BANKPAY, payer_id: TENANT, landlord_id: LANDLORD });
    expect(opts.idempotencyKey).toBe(`rent-bank-${BANKPAY}`);
    expect(stripeMock.__key).toBe("sk_test_rent");
    const attach = rpcs("rentals_bank_rent_attach")[0];
    expect(attach?.args).toEqual({ p_id: BANKPAY, p_session_id: "cs_test_rent", p_livemode: false });
    expect(clientOf(attach)?.key).toBe("service-key");
  });

  it("real people: refused before any Stripe call or start (live bank rent is not open)", async () => {
    const fn = await load();
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("bank_rent_not_open");
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(rpcs("rentals_start_bank_rent")).toHaveLength(0);
  });

  it("someone who is not the tenancy's tenant gets nothing", async () => {
    const fn = await load();
    testParties();
    scenario.reads.rental_tenancies = { rows: [{ landlord_id: LANDLORD, tenant_id: "0000000c-0000-4000-8000-0000000000ff", status: "active" }] };
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(404);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("a page whose total is not the frozen charge is expired and nothing is attached", async () => {
    const fn = await load();
    testParties();
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_test_rent", url: "https://x", amount_total: 999, livemode: false });
    const res = await fn.fetch(ask(fn));
    expect(res.status).toBe(500);
    expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith("cs_test_rent");
    expect(rpcs("rentals_bank_rent_attach")).toHaveLength(0);
  });
});

describe("stripe-webhook: bank rent", () => {
  async function deliver(type: string, object: Record<string, unknown>) {
    env();
    testParties();
    const fn = await loadEdgeFunction("stripe-webhook");
    const ev = { id: `evt_${type}`, type, livemode: false, created: 1_760_000_000, data: { object } };
    // Verified by the TEST endpoint's secret only (a test-mode event).
    stripeMock.webhooks.constructEventAsync.mockImplementation(async (_b: string, _s: string, secret: string) => {
      if (secret === "whsec_test") return ev;
      throw new Error("No signatures found matching the expected signature for payload");
    });
    scenario.rpc.rentals_bank_rent_processing = null;
    scenario.rpc.rentals_bank_rent_succeeded = "succeeded";
    const r = await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
    return r;
  }
  const meta = { kind: "rent_bank_payment", bank_payment_id: BANKPAY, tenancy_id: TENANCY, payer_id: TENANT, landlord_id: LANDLORD };

  it("the page completed: processing only, nothing recorded as paid", async () => {
    const res = await deliver("checkout.session.completed", { id: "cs_test_rent", mode: "payment", payment_status: "unpaid", payment_intent: "pi_test_rent",
      client_reference_id: BANKPAY, metadata: meta });
    expect(res.status).toBe(200);
    expect(rpcs("rentals_bank_rent_processing")[0]?.args).toEqual({ p_id: BANKPAY, p_payment_intent_id: "pi_test_rent" });
    expect(rpcs("rentals_bank_rent_succeeded")).toHaveLength(0);
  });

  it("the bank confirmed: recorded as paid (D9)", async () => {
    const res = await deliver("payment_intent.succeeded", { id: "pi_test_rent", amount: 120500, metadata: meta });
    expect(res.status).toBe(200);
    expect(rpcs("rentals_bank_rent_succeeded")[0]?.args).toEqual({ p_payment_intent_id: "pi_test_rent" });
  });
});
