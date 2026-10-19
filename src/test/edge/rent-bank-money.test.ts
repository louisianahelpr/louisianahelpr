/**
 * Homes bank rent, the money cron's steps 7 and 8 (supabase/functions/declutter-money; DRAFT, Stripe TEST mode
 * only; lead review of the bank-rent draft #1 #2 #4). The queues and every rule live in SQL and are proven by
 * src/test/pglite/homesBankRent.pglite.mjs; this file proves the edge side moves exactly what the queue says,
 * under the right idempotency key, and records it.
 *
 * @mutate supabase/functions/declutter-money/index.ts |             { idempotencyKey: `rent-bank-transfer-${r.bank_payment_id}` }, |             { idempotencyKey: `rent-bank-${r.bank_payment_id}` },
 * @mutate supabase/functions/declutter-money/index.ts |             trId = listed.data.find((t) => ((t.metadata ?? {}) as Record<string, string>).bank_payment_id === r.bank_payment_id)?.id ?? null; |             trId = null;
 * @mutate supabase/functions/declutter-money/index.ts |         if (type === "StripeCardError" \|\| type === "StripeInvalidRequestError") { |         if (true) {
 * @mutate supabase/functions/declutter-money/index.ts |           { idempotencyKey: `rent-bank-autopay-${a.bank_payment_id}` }, |           { idempotencyKey: `rent-bank-autopay-${a.tenancy_id}` },
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

const transferRow = (over: Record<string, unknown> = {}) => ({
  bank_payment_id: BANKPAY, action: "transfer", transfer_cents: 120000, landlord_id: LANDLORD, stripe_account_id: "acct_landlord1",
  payment_intent_id: "pi_order1", stripe_transfer_id: null, livemode: false, attempts: 0, ...over,
});
const autopayRow = (over: Record<string, unknown> = {}) => ({
  bank_payment_id: BANKPAY, tenancy_id: TENANCY, tenant_id: TENANT, landlord_id: LANDLORD, charge_cents: 120500,
  stripe_customer_id: "cus_1", stripe_payment_method_id: "pm_1", livemode: false, ...over,
});
const rpcs = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name);

async function run(opts: { transfers?: unknown[]; autopay?: unknown[] } = {}) {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_declutter",
    STRIPE_TEST_SECRET_KEY: "sk_test_declutter",
  });
  for (const q of ["declutter_payouts_due", "declutter_refunds_due", "helpr_task_payouts_due", "declutter_delivery_refunds_due"]) scenario.rpc[q] = [];
  scenario.rpc.rentals_bank_transfers_due = opts.transfers ?? [];
  scenario.rpc.rentals_autopay_due = opts.autopay ?? [];
  scenario.rpc.rentals_bank_transfer_executed = (a: { p_action?: string; p_succeeded?: boolean }) =>
    !a?.p_succeeded ? "failed" : a.p_action === "reverse" ? "reversed" : "succeeded";
  const fn = await loadEdgeFunction("declutter-money");
  const res = await fn.fetch(fn.request({ url: "https://edge.test/declutter-money", headers: { Authorization: "Bearer service-key" }, body: {} }));
  const text = await res.text();
  return { status: res.status, body: (text.startsWith("{") ? JSON.parse(text) : { text }) as Record<string, any> };
}

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
  resetEmailMocks();
  scenario.reads.test_accounts = { rows: [{ user_id: TENANT }, { user_id: LANDLORD }] };
  scenario.reads.ban_settlement_queue = { rows: [] };
  scenario.reads.payout_holds = { rows: [] };
  scenario.reads.profiles = { rows: [{ user_id: TENANT, is_seed: true }, { user_id: LANDLORD, is_seed: true }] };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_order1", status: "succeeded", latest_charge: { id: "ch_order1", amount_refunded: 0, disputed: false },
  });
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_new1", destination: "acct_landlord1" });
  stripeMock.transfers.retrieve.mockResolvedValue({ id: "tr_found1", reversed: false });
  stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_auto1", status: "processing" });
});

describe("declutter-money step 7: the landlord's rent transfer", () => {
  it("sends the queued amount once, in the payment's transfer group, under its own key (lead #1), and records it", async () => {
    const { status, body } = await run({ transfers: [transferRow()] });
    expect(status).toBe(200);
    expect(body.rent_transfers_sent).toBe(1);
    const [params, opts] = stripeMock.transfers.create.mock.calls[0];
    expect(params).toMatchObject({ amount: 120000, destination: "acct_landlord1", transfer_group: `rent_bank_${BANKPAY}`, source_transaction: "ch_order1" });
    expect(opts).toEqual({ idempotencyKey: `rent-bank-transfer-${BANKPAY}` });
    expect(rpcs("rentals_bank_transfer_executed")[0]?.args).toMatchObject({ p_id: BANKPAY, p_action: "transfer", p_transfer_id: "tr_new1", p_succeeded: true });
  });

  it("a reversal with no recorded transfer finds it by its transfer group and pulls it back (lead #4)", async () => {
    stripeMock.transfers.list.mockResolvedValue({ data: [{ id: "tr_found1", reversed: false, metadata: { bank_payment_id: BANKPAY } }] });
    const { body } = await run({ transfers: [transferRow({ action: "reverse" })] });
    expect(stripeMock.transfers.list).toHaveBeenCalledWith({ transfer_group: `rent_bank_${BANKPAY}`, limit: 100 });
    expect(stripeMock.transfers.createReversal).toHaveBeenCalledWith("tr_found1", {}, { idempotencyKey: `rent-bank-reverse-${BANKPAY}` });
    expect(rpcs("rentals_bank_transfer_executed")[0]?.args).toMatchObject({ p_action: "reverse", p_transfer_id: "tr_found1", p_succeeded: true });
    expect(body.rent_transfers_reversed).toBe(1);
  });

  it("a reversal with no transfer at Stripe pulls nothing back and records it done", async () => {
    stripeMock.transfers.list.mockResolvedValue({ data: [] });
    await run({ transfers: [transferRow({ action: "reverse" })] });
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled();
    expect(rpcs("rentals_bank_transfer_executed")[0]?.args).toMatchObject({ p_action: "reverse", p_transfer_id: null, p_succeeded: true });
  });
});

describe("declutter-money step 8: rent autopay", () => {
  it("charges the queued amount off-session from the saved bank under the payment's own key, and records the intent", async () => {
    const { body } = await run({ autopay: [autopayRow()] });
    const [params, opts] = stripeMock.paymentIntents.create.mock.calls[0];
    expect(params).toMatchObject({ amount: 120500, customer: "cus_1", payment_method: "pm_1", off_session: true, confirm: true, payment_method_types: ["us_bank_account"] });
    expect(opts).toEqual({ idempotencyKey: `rent-bank-autopay-${BANKPAY}` });
    expect(rpcs("rentals_bank_rent_processing")[0]?.args).toEqual({ p_id: BANKPAY, p_payment_intent_id: "pi_auto1" });
    expect(body.rent_autopay_started).toBe(1);
  });

  it("a definite refusal is recorded failed (the tenant is told)", async () => {
    stripeMock.paymentIntents.create.mockRejectedValue(Object.assign(new Error("Your bank declined"), { type: "StripeCardError" }));
    const { body } = await run({ autopay: [autopayRow()] });
    expect(rpcs("rentals_bank_rent_failed")[0]?.args).toEqual({ p_id: BANKPAY, p_expired: false });
    expect(body.rent_autopay_failed).toBe(1);
  });

  it("an ambiguous error (a timeout) is NOT recorded failed: the row stays open to be retried under the same key (lead #2)", async () => {
    stripeMock.paymentIntents.create.mockRejectedValue(Object.assign(new Error("Request timed out"), { type: "StripeConnectionError" }));
    const { body } = await run({ autopay: [autopayRow()] });
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
    expect(rpcs("rentals_bank_rent_failed")).toHaveLength(0);
    expect(body.rent_autopay_retry).toBe(1);
  });
});
