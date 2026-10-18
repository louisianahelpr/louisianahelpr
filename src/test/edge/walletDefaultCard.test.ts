/**
 * Q2139 (one wallet slice 3; owner 2026-10-18 ONE WALLET CARD EVERYWHERE): a
 * job checkout with "Save card for next time" makes that card the wallet's
 * DEFAULT card, the off-session consent auto-tip charges (Q2138 reads only it).
 * Runs the REAL stripe-webhook source; Stripe and Supabase are doubled.
 *
 * Set only when every fact agrees (saved off-session, a member's job payment,
 * on that member's stored wallet customer in the event's mode, a card attached
 * to that customer); anything else is skipped and nothing is guessed.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |   await recordWalletDefaultCard(event, ctx); |
 * @mutate supabase/functions/stripe-webhook/handlers/_walletDefaultCard.ts |   if (pi?.setup_future_usage !== "off_session") return; |
 * @mutate supabase/functions/stripe-webhook/handlers/_walletDefaultCard.ts |   if (!stored \|\| customer !== stored) { |   if (!stored) {
 * @mutate supabase/functions/stripe-webhook/handlers/_walletDefaultCard.ts |   if (!card?.id \|\| cardOwner !== stored) { |   if (!card?.id) {
 * @mutate supabase/functions/stripe-webhook/handlers/_walletDefaultCard.ts |     mode: event.livemode ? "live" : "test", |     mode: "live",
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |   await recordDeclutterCardAsWalletDefault(event, session.id, userId, customer, si, ctx); |
 * @mutate supabase/functions/stripe-webhook/handlers/_walletDefaultCard.ts |     mode: event.livemode === true ? "live" : "test", |     mode: "live",
 * @mutate supabase/functions/stripe-webhook/handlers/_walletDefaultCard.ts |   if ((session.metadata as Record<string, string> \| null)?.wallet_save !== "1") return; |
 * @mutate supabase/functions/stripe-webhook/handlers/_walletDefaultCard.ts | && (defCard.created ?? 0) > (card.created ?? 0)) { | && false) {
 *
 * Owner 2026-10-18 (one wallet card everywhere): the card saved MOST RECENTLY in
 * ANY section becomes the default, so Declutter's card page sets it too.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { resetStripeMock, stripeMock } from "./mocks/stripe";

const rpcs = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name);

const MEMBER = "11111111-2222-4333-8444-555555555555";

function env(over: Record<string, string> = {}) {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_wallet",
    STRIPE_TEST_SECRET_KEY: "sk_test_wallet",
    STRIPE_WEBHOOK_SECRET: "whsec_live",
    ...over,
  });
}
/** A test-mode event is processed (not ignored as a key/event mismatch) on a deploy that runs the test key. */
const modeEnv = (livemode: boolean): Record<string, string> => (livemode ? {} : { STRIPE_SECRET_KEY: "sk_test_wallet" });

const card = (customer: string | null, type = "card", created = 1_760_000_100) =>
  ({ id: "pm_card_1", type, customer, created, card: { fingerprint: "fp_1", country: "US" } });
const pi = (over: Record<string, unknown> = {}) => ({
  id: "pi_job_1", setup_future_usage: "off_session", customer: "cus_wallet",
  metadata: { job_id: "job-1", customer_id: MEMBER }, payment_method: card("cus_wallet"), ...over,
});

/** A job checkout session with no email: the tier/job settle path returns early, so only the after-settle hooks run. */
async function deliver(paymentIntent: Record<string, unknown> | Error, livemode = true, sessionMeta: Record<string, string> = { wallet_save: "1" }) {
  env(modeEnv(livemode));
  const fn = await loadEdgeFunction("stripe-webhook");
  if (paymentIntent instanceof Error) stripeMock.paymentIntents.retrieve.mockRejectedValue(paymentIntent);
  else stripeMock.paymentIntents.retrieve.mockResolvedValue(paymentIntent);
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({
    id: "evt_wallet", type: "checkout.session.completed", livemode, created: 1_760_000_000,
    data: { object: { id: "cs_job_1", mode: "payment", payment_intent: "pi_job_1", metadata: sessionMeta } },
  });
  return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
}

beforeEach(() => {
  resetSupabaseMock();
  resetSharedMocks();
  resetStripeMock();
  resetEnv();
  scenario.reads.stripe_customers = { rows: [{ stripe_customer_id: "cus_wallet" }] };
  stripeMock.customers.update.mockResolvedValue({ id: "cus_wallet" });
  stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_wallet", invoice_settings: { default_payment_method: null } });
});

describe("stripe-webhook: a saved job card becomes the wallet's default card (Q2139)", () => {
  it("sets the default card on the member's own wallet customer, read by member AND the event's mode", async () => {
    const res = await deliver(pi());
    expect(res.status).toBe(200);
    expect(stripeMock.customers.update).toHaveBeenCalledWith("cus_wallet", { invoice_settings: { default_payment_method: "pm_card_1" } });
    const q = (scenario.readQueries ?? []).find((r) => r.table === "stripe_customers");
    expect(q?.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "eq", column: "user_id", value: MEMBER }),
      expect.objectContaining({ op: "eq", column: "wallet_mode", value: "live" }),
    ]));
  });

  it("a test-mode event reads the TEST wallet", async () => {
    await deliver(pi(), false);
    const q = (scenario.readQueries ?? []).find((r) => r.table === "stripe_customers");
    expect(q?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ op: "eq", column: "wallet_mode", value: "test" })]));
  });

  it("a paid session create-payment did not mark wallet_save (an order, a tip, a gift card) is never read", async () => {
    const res = await deliver(pi(), true, {});
    expect(res.status).toBe(200);
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(stripeMock.customers.update).not.toHaveBeenCalled();
  });

  it("not saved for later (no setup_future_usage): the default is never touched", async () => {
    await deliver(pi({ setup_future_usage: null }));
    expect(stripeMock.customers.update).not.toHaveBeenCalled();
  });

  it("a payment on a customer that is NOT the member's wallet (an old email-found one) never sets a default", async () => {
    await deliver(pi({ customer: "cus_someone_else", payment_method: card("cus_someone_else") }));
    expect(stripeMock.customers.update).not.toHaveBeenCalled();
  });

  it("the payment ran on a customer that is not the wallet: skipped, even if the card also sits on the wallet", async () => {
    await deliver(pi({ customer: "cus_someoneelse", payment_method: card("cus_wallet") }));
    expect(stripeMock.customers.update).not.toHaveBeenCalled();
  });

  it("no stored wallet: nothing is set", async () => {
    scenario.reads.stripe_customers = { rows: [] };
    await deliver(pi());
    expect(stripeMock.customers.update).not.toHaveBeenCalled();
  });

  it("a card not attached to the wallet customer, or not a card (bank debit), is never made the default", async () => {
    await deliver(pi({ payment_method: card("cus_other") }));
    await deliver(pi({ payment_method: card("cus_wallet", "us_bank_account") }));
    expect(stripeMock.customers.update).not.toHaveBeenCalled();
  });

  it("not a member's job payment (no job id / no member uuid): skipped", async () => {
    await deliver(pi({ metadata: { customer_id: MEMBER } }));
    await deliver(pi({ metadata: { job_id: "job-1", customer_id: "not-a-uuid" } }));
    expect(stripeMock.customers.update).not.toHaveBeenCalled();
  });

  it("a failure never fails the webhook (the money is recorded): it pages, and nothing is set", async () => {
    stripeMock.customers.update.mockRejectedValue(new Error("stripe down"));
    const res = await deliver(pi());
    expect(res.status).toBe(200);
    expect((slackAlerts as Array<{ title: string }>).some((a) => /wallet's default card/.test(a.title))).toBe(true);

    resetSharedMocks();
    scenario.reads.stripe_customers = { error: { message: "boom" } };
    const res2 = await deliver(pi());
    expect(res2.status).toBe(200);
    expect((slackAlerts as Array<{ title: string }>).some((a) => /wallet's default card/.test(a.title))).toBe(true);
  });
});

/** Declutter's card page completed (checkout.session.completed, mode=setup). */
async function deliverDeclutterCard(si: Record<string, unknown>, livemode = true) {
  env(modeEnv(livemode));
  const fn = await loadEdgeFunction("stripe-webhook");
  stripeMock.setupIntents.retrieve.mockResolvedValue(si);
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({
    id: "evt_dcard", type: "checkout.session.completed", livemode, created: 1_760_000_000,
    data: { object: { id: "cs_dcard_1", mode: "setup", status: "complete", setup_intent: "seti_1", customer: "cus_wallet",
      client_reference_id: MEMBER, metadata: { kind: "declutter_card", user_id: MEMBER } } },
  });
  return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
}
const setup = (over: Record<string, unknown> = {}) => ({
  id: "seti_1", status: "succeeded", customer: "cus_wallet",
  payment_method: { ...card("cus_wallet"), id: "pm_dcard", card: { brand: "visa", last4: "4242" } }, ...over,
});

describe("stripe-webhook: a card saved on Declutter's card page becomes the wallet's default card too (owner 2026-10-18)", () => {
  it("stores the card first, then makes it the default on the member's wallet customer (event's mode)", async () => {
    const res = await deliverDeclutterCard(setup());
    expect(res.status).toBe(200);
    expect(rpcs("declutter_save_card")).toHaveLength(1);
    expect(stripeMock.customers.update).toHaveBeenCalledWith("cus_wallet", { invoice_settings: { default_payment_method: "pm_dcard" } });
    const q = (scenario.readQueries ?? []).find((r) => r.table === "stripe_customers");
    expect(q?.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "eq", column: "user_id", value: MEMBER }),
      expect.objectContaining({ op: "eq", column: "wallet_mode", value: "live" }),
    ]));
  });

  it("a test-mode card page reads the TEST wallet", async () => {
    await deliverDeclutterCard(setup(), false);
    const q = (scenario.readQueries ?? []).find((r) => r.table === "stripe_customers");
    expect(q?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ op: "eq", column: "wallet_mode", value: "test" })]));
  });

  it("the most recent save wins: a Jobs save then a newer Declutter save each set the default, in that order", async () => {
    await deliver(pi());
    stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_wallet", invoice_settings: { default_payment_method: card("cus_wallet") } });
    await deliverDeclutterCard(setup({ payment_method: { ...card("cus_wallet", "card", 1_760_000_500), id: "pm_dcard" } }));
    expect(stripeMock.customers.update.mock.calls.map((c) => c[1].invoice_settings.default_payment_method))
      .toEqual(["pm_card_1", "pm_dcard"]);
  });

  it("most recent by the CARD's own time, not delivery order: an older Jobs save delivered late never replaces a newer Declutter default", async () => {
    // The Declutter card (saved at ...500) is already the default; the Jobs event for a card saved at ...100 arrives late.
    stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_wallet", invoice_settings: {
      default_payment_method: { ...card("cus_wallet", "card", 1_760_000_500), id: "pm_dcard" } } });
    const res = await deliver(pi());
    expect(res.status).toBe(200);
    expect(stripeMock.customers.update).not.toHaveBeenCalled();
  });

  it("the current default cannot be read: pages, sets nothing, never fails the webhook", async () => {
    stripeMock.customers.retrieve.mockRejectedValue(new Error("stripe down"));
    const res = await deliverDeclutterCard(setup());
    expect(res.status).toBe(200);
    expect(stripeMock.customers.update).not.toHaveBeenCalled();
    expect((slackAlerts as Array<{ title: string }>).some((a) => /wallet's default card/.test(a.title))).toBe(true);
  });

  it("a card saved on a customer that is not the member's stored wallet (an older wallet kept) is saved but never made the default", async () => {
    scenario.reads.stripe_customers = { rows: [{ stripe_customer_id: "cus_olderwallet" }] };
    const res = await deliverDeclutterCard(setup());
    expect(res.status).toBe(200);
    expect(rpcs("declutter_save_card")).toHaveLength(1);
    expect(stripeMock.customers.update).not.toHaveBeenCalled();
  });

  it("a card not attached to the wallet customer is never made the default", async () => {
    await deliverDeclutterCard(setup({ payment_method: { ...card("cus_other"), id: "pm_dcard" } }));
    expect(stripeMock.customers.update).not.toHaveBeenCalled();
  });

  it("the card could not be stored: the webhook fails (Stripe retries) and no default is set", async () => {
    scenario.rpcErrors = { ...(scenario.rpcErrors ?? {}), declutter_save_card: { message: "boom" } };
    const res = await deliverDeclutterCard(setup());
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(stripeMock.customers.update).not.toHaveBeenCalled();
  });

  it("setting the default fails: the card stays saved, the webhook answers 200, ops are paged", async () => {
    stripeMock.customers.update.mockRejectedValue(new Error("stripe down"));
    const res = await deliverDeclutterCard(setup());
    expect(res.status).toBe(200);
    expect(rpcs("declutter_save_card")).toHaveLength(1);
    expect((slackAlerts as Array<{ title: string }>).some((a) => /wallet's default card/.test(a.title))).toBe(true);
  });
});
