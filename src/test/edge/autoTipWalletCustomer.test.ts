/**
 * Q2138 (HIGH, one wallet slice 0): auto-tip-charge charged, off-session, the
 * first saved card on ANY Stripe customer carrying the poster's email. Email is
 * not a key in Stripe, so that pool held a deleted member's customer whenever
 * an address was reused (measured 2026-10-18: 3 of 7 live customers carry an
 * email that now belongs to a newer account; in test mode the audit-web
 * poster's email maps to a deleted member's customer WITH a card) and any
 * other section's customer (a Declutter card saved "never charged until you
 * check out").
 *
 * Fixed: the card charged is the DEFAULT card of the poster's OWN stored
 * customer (public.stripe_customers, read by member AND the job's mode through
 * _shared/stripeCustomer.ts), only when it is a card attached to that
 * customer; any other card on it (a Declutter card) is never charged. No stored
 * customer or no default card -> nothing charged, the poster asked to tip by
 * hand, one summary defect per run. Runs the REAL function source.
 *
 * @mutate supabase/functions/auto-tip-charge/index.ts | customerId = await storedStripeCustomer(supabase, c.customer_id as string, mode); | customerId = (await stripe.customers.list({ email, limit: 1 })).data[0]?.id ?? null;
 * @mutate supabase/functions/auto-tip-charge/index.ts |           await releaseClaimForRetry("wallet read"); |
 * @mutate supabase/functions/auto-tip-charge/index.ts |             await releaseClaimForRetry("wallet card lookup"); |
 * @mutate supabase/functions/auto-tip-charge/index.ts | defaultCard?.type === "card" && defaultCardOwner === customerId | defaultCard?.type === "card"
 * @mutate supabase/functions/auto-tip-charge/index.ts |         if (walletCustomer?.deleted) { |         if (false) {
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock, type TableResult } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const POSTER = "poster-1";

async function run(wallet: TableResult) {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    CRON_SECRET: "cron-secret",
  });
  const fn = await loadEdgeFunction("auto-tip-charge");
  scenario.rpc.auto_tip_candidates = [
    { job_id: "job-1", customer_id: POSTER, helper_id: "helper-1", budget: 100, tip_amount: 10, tip_state: "chargeable" },
  ];
  scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
  scenario.adminUsers = { [POSTER]: { email: "poster@test.com" } };
  scenario.reads.stripe_customers = wallet;
  // The email pool the old code charged from: a deleted member's customer
  // (reused address) holding a card. Nothing may ever read it.
  stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_deleted_member" }] });
  stripeMock.paymentMethods.list.mockImplementation(async (p: { customer: string }) =>
    p.customer === "cus_wallet"
      ? { data: [{ id: "pm_newest" }, { id: "pm_default" }] }
      : { data: [{ id: "pm_someone_else" }] });
  stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_auto_1", status: "succeeded" });
  const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer cron-secret" } }));
  return { res, body: JSON.parse(await res.text()) as Record<string, unknown> };
}

const card = (id: string, customer = "cus_wallet", type = "card") => ({ id, type, customer });
const walletWithDefault = (pm: unknown) =>
  stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_wallet", invoice_settings: { default_payment_method: pm } });

const tipUpdate = () => scenario.writes.find((w) => w.table === "tips" && w.op === "update")?.payload as Record<string, unknown> | undefined;
const chargedParams = () => stripeMock.paymentIntents.create.mock.calls[0]?.[0] as Record<string, unknown> | undefined;

describe("auto-tip charges only the poster's own stored wallet customer's default card (Q2138)", () => {
  beforeEach(() => { resetEnv(); resetStripeMock(); resetSupabaseMock(); resetSharedMocks(); });

  it("stored customer: charges its default card, read by member and mode, never by email", async () => {
    walletWithDefault(card("pm_default"));
    const { res, body } = await run({ rows: [{ stripe_customer_id: "cus_wallet" }] });
    expect(res.status).toBe(200);
    expect(body.charged).toBe(1);
    expect(stripeMock.customers.list).not.toHaveBeenCalled();
    expect(stripeMock.customers.retrieve).toHaveBeenCalledWith("cus_wallet", { expand: ["invoice_settings.default_payment_method"] });
    expect(chargedParams()).toMatchObject({ customer: "cus_wallet", payment_method: "pm_default", off_session: true });
    const q = (scenario.readQueries ?? []).find((r) => r.table === "stripe_customers");
    expect(q?.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "eq", column: "user_id", value: POSTER }),
      expect.objectContaining({ op: "eq", column: "wallet_mode", value: "live" }),
    ]));
  });

  it("a wallet whose only card is a Declutter card (no default) is never charged", async () => {
    walletWithDefault(null);
    stripeMock.paymentMethods.list.mockResolvedValue({ data: [{ id: "pm_declutter", type: "card", customer: "cus_wallet" }] });
    const { res, body } = await run({ rows: [{ stripe_customer_id: "cus_wallet" }] });
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(tipUpdate()).toMatchObject({ payment_status: "failed", failure_reason: "no_saved_card" });
    expect(res.status).toBe(500);
    expect(String(body.defectReasons)).toMatch(/1 tip\(s\) not charged/);
  });

  it("a default that is not a card, or sits on another customer, is never charged", async () => {
    walletWithDefault(card("pm_bank", "cus_wallet", "us_bank_account"));
    await run({ rows: [{ stripe_customer_id: "cus_wallet" }] });
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();

    resetStripeMock(); resetSupabaseMock();
    walletWithDefault(card("pm_other", "cus_deleted_member"));
    await run({ rows: [{ stripe_customer_id: "cus_wallet" }] });
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("no stored customer: nothing charged even though an email match holds a card; poster asked, run reports it", async () => {
    const { res, body } = await run({ rows: [] });
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(stripeMock.customers.list).not.toHaveBeenCalled();
    expect(tipUpdate()).toMatchObject({ payment_status: "failed", failure_reason: "no_wallet_customer" });
    const notice = scenario.writes.find((w) => w.table === "notifications")?.payload as Record<string, unknown> | undefined;
    expect(notice).toMatchObject({ user_id: POSTER, title: "Your tip didn't go through" });
    expect(res.status).toBe(500);
    expect(String(body.defectReasons)).toMatch(/job-1 \(no stored live customer\)/);
  });

  it("an unreadable wallet charges nothing and releases the claim for the next tick (fail closed)", async () => {
    const { res, body } = await run({ error: { message: "connection reset" } });
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(stripeMock.customers.list).not.toHaveBeenCalled();
    expect(scenario.writes.some((w) => w.table === "tips" && w.op === "delete")).toBe(true);
    expect(tipUpdate()).toBeUndefined();
    expect(res.status).toBe(500);
    expect(String(body.defectReasons)).toMatch(/wallet read job-1/);
  });

  it("a transient Stripe error reading the wallet releases the claim for retry, never 'your tip failed'", async () => {
    stripeMock.customers.retrieve.mockRejectedValue(Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" }));
    const { res, body } = await run({ rows: [{ stripe_customer_id: "cus_wallet" }] });
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(scenario.writes.some((w) => w.table === "tips" && w.op === "delete")).toBe(true);
    expect(tipUpdate()).toBeUndefined();
    expect(scenario.writes.some((w) => w.table === "notifications")).toBe(false);
    expect(res.status).toBe(500);
    expect(String(body.defectReasons)).toMatch(/wallet card lookup job-1/);
  });

  it("a stored customer deleted in Stripe charges nothing (Q2140), whether marked deleted or 'No such customer'", async () => {
    stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_wallet", deleted: true });
    const first = await run({ rows: [{ stripe_customer_id: "cus_wallet" }] });
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(tipUpdate()).toMatchObject({ failure_reason: "wallet_customer_deleted" });
    expect(String(first.body.defectReasons)).toMatch(/deleted in Stripe/);

    resetStripeMock(); resetSupabaseMock();
    stripeMock.customers.retrieve.mockRejectedValue(Object.assign(new Error("No such customer: 'cus_wallet'"), { type: "StripeInvalidRequestError", code: "resource_missing" }));
    await run({ rows: [{ stripe_customer_id: "cus_wallet" }] });
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(tipUpdate()).toMatchObject({ failure_reason: "wallet_customer_deleted" });
  });
});
