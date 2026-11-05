/**
 * Q1918 + Q2148 (2): Stripe's Tax report keeps a LOST dispute's tax, and the
 * whole authorisation's tax on a PARTIAL capture, for a Checkout automatic_tax
 * charge (docs.stripe.com/tax/reports). stripe-webhook records the correction
 * in public.sales_tax_adjustments; it never changes the charge, never throws
 * out of the handler, and a job-site-taxed charge (our own Tax API
 * transaction, reversed elsewhere) is never written.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts |     await recordLostDisputeTax({ stripe, supabase, piId: closedPiId, dispute: closedDispute, logStep, alert: postSlackOpsAlert }); |     void recordLostDisputeTax;
 * @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts |   await recordPartialCaptureTax({ stripe, supabase, pi: pi as any, | void recordPartialCaptureTax; ({ stripe, supabase, pi: pi as any,
 * @mutate supabase/functions/_shared/salesTaxAdjustment.ts |   return Math.min(i.taxCents, Math.max(0, i.capturedCents - pretax)); |   return i.taxCents;
 * @mutate supabase/functions/_shared/salesTaxAdjustment.ts | const isJobSiteTaxed = (md: Record<string, string> \| null \| undefined) =>\n  String(md?.tax_calculation_id ?? "").startsWith("taxcalc_"); | const isJobSiteTaxed = (_md: Record<string, string> \| null \| undefined) => false;
 * @mutate supabase/functions/_shared/salesTaxAdjustment.ts |     const stillCounted = Math.max(0, afterRefunds - before); |     const stillCounted = Math.max(0, afterRefunds);
 * @mutate supabase/functions/_shared/salesTaxAdjustment.ts |     await alertNotBuilt(args.alert, `capture:${pi.id}` |     void (args.alert, `capture:${pi.id}`
 * @mutate supabase/functions/_shared/salesTaxAdjustment.ts |       dedupe_ref: `dispute:${dispute.id}`, |       dedupe_ref: `dispute:${Date.now()}`,
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, resetSharedMocks } from "./mocks/shared";
import { taxInsideCaptureCents } from "../../../supabase/functions/_shared/salesTaxAdjustment";

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
  return loadEdgeFunction("stripe-webhook");
}
const post = (fn: EdgeHarness) => fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" } }));
const adjustments = () =>
  scenario.writes.filter((w) => w.table === "sales_tax_adjustments" && w.op === "insert").map((w) => w.payload as Record<string, unknown>);

// $100 taxable labour in Lafayette: 9.00 tax, 109.00 total (the 11-04 TEST probe's numbers).
const session = (md: Record<string, string> = {}) => ({
  data: [{ total_details: { amount_tax: 900 }, metadata: md, customer_details: { address: { state: "LA", postal_code: "70501" } } }],
});
const lost = (id: string, amount = 10900, status = "lost") => ({
  id: `evt_${id}`, type: "charge.dispute.closed", livemode: true,
  data: { object: { id: `du_${id}`, status, amount, payment_intent: "pi_tax", charge: "ch_tax", livemode: true } },
});

describe("stripe-webhook records what to subtract from Stripe's Tax report", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_tax", amount_received: 10900, metadata: {} });
    stripeMock.charges.retrieve.mockResolvedValue({ id: "ch_tax", amount: 10900, amount_captured: 10900, amount_refunded: 0, metadata: {} });
    stripeMock.checkout.sessions.list.mockResolvedValue(session({ job_id: "job-1" }));
    scenario.reads.jobs = { rows: [] };
    scenario.reads.sales_tax_adjustments = { rows: [] };
  });

  it("a LOST dispute on a Checkout-taxed charge records the whole 9.00 as not collected (Q1918)", async () => {
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue(lost("full"));
    const res = await post(fn);
    expect(res.status).toBe(200);
    const rows = adjustments();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "dispute_lost", stripe_payment_intent_id: "pi_tax", stripe_charge_id: "ch_tax", dedupe_ref: "dispute:du_full",
      tax_reported_cents: 900, tax_collected_cents: 0, state_code: "LA", postal_code: "70501", livemode: true,
    });
  });

  it("a WON dispute records nothing", async () => {
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue(lost("won", 10900, "won"));
    await post(fn);
    expect(adjustments()).toHaveLength(0);
  });

  it("a dispute of part of the charge, after a partial refund, subtracts only the disputed share of the tax still counted", async () => {
    // Refunded 10.90 of 109.00: Stripe's own reversal took 0.90, 8.10 still counted; 49.05 of the 98.10 left is disputed.
    stripeMock.charges.retrieve.mockResolvedValue({ id: "ch_tax", amount: 10900, amount_captured: 10900, amount_refunded: 1090, metadata: {} });
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue(lost("part", 4905));
    await post(fn);
    expect(adjustments()[0]).toMatchObject({ tax_reported_cents: 810, tax_collected_cents: 405 });
  });

  it("an earlier partial-capture correction is not subtracted twice", async () => {
    // Captured 30.00 of 109.00: 0 tax inside it, so 9.00 was already subtracted.
    stripeMock.charges.retrieve.mockResolvedValue({ id: "ch_tax", amount: 10900, amount_captured: 3000, amount_refunded: 0, metadata: {} });
    scenario.reads.sales_tax_adjustments = { rows: [{ adjustment_cents: -900 }] };
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue(lost("after_capture", 3000));
    await post(fn);
    expect(adjustments()).toHaveLength(0);
  });

  it("a charge taxed at the JOB SITE (our own Tax API transaction) is never written here", async () => {
    stripeMock.checkout.sessions.list.mockResolvedValue(session({ job_id: "job-1", tax_calculation_id: "taxcalc_1" }));
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue(lost("site"));
    await post(fn);
    expect(adjustments()).toHaveLength(0);
  });

  it("a failed ledger write is logged and alerted, and the dispute is still handled (200)", async () => {
    scenario.writeErrors.sales_tax_adjustments = { message: "db down" };
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue(lost("dbdown"));
    const res = await post(fn);
    expect(res.status).toBe(200);
    expect((slackAlerts as Array<{ title?: string }>).some((a) => /Sales-tax correction NOT recorded/.test(a.title ?? ""))).toBe(true);
  });

  it("a failed Stripe read on either path is alerted once, and the event is still handled (200)", async () => {
    stripeMock.checkout.sessions.list.mockRejectedValue(new Error("stripe down"));
    let fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue(lost("readfail"));
    expect((await post(fn)).status).toBe(200);
    fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_cap_readfail", type: "payment_intent.succeeded", livemode: true,
      data: { object: { id: "pi_tax", amount: 10900, amount_received: 3000, livemode: true, metadata: {} } },
    });
    expect((await post(fn)).status).toBe(200);
    const alerts = (slackAlerts as Array<{ title?: string; fields?: Record<string, string> }>).filter((a) => /Sales-tax correction NOT recorded/.test(a.title ?? ""));
    expect(alerts.map((a) => a.fields?.["Dedupe ref"])).toEqual(["dispute:du_readfail", "capture:pi_tax"]);
    expect(adjustments()).toHaveLength(0);
  });

  it("the dedupe ref is the dispute id, so a retry writes the same ref", async () => {
    for (let i = 0; i < 2; i++) {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({ ...lost("retry"), id: `evt_retry_${i}` });
      await post(fn);
    }
    const refs = adjustments().map((r) => r.dedupe_ref);
    expect(refs.length).toBeGreaterThan(0);
    expect(new Set(refs)).toEqual(new Set(["dispute:du_retry"]));
  });

  it("a PARTIAL capture of a Checkout-taxed hold records the tax outside the capture (Q2148 (2))", async () => {
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_cap", type: "payment_intent.succeeded", livemode: true,
      data: { object: { id: "pi_tax", amount: 10900, amount_received: 3000, livemode: true, metadata: {}, latest_charge: "ch_tax" } },
    });
    const res = await post(fn);
    expect(res.status).toBe(200);
    const rows = adjustments();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "partial_capture", dedupe_ref: "capture:pi_tax", tax_reported_cents: 900, tax_collected_cents: 0, stripe_charge_id: "ch_tax" });
  });

  it("a FULL capture records nothing", async () => {
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_full", type: "payment_intent.succeeded", livemode: true,
      data: { object: { id: "pi_tax", amount: 10900, amount_received: 10900, livemode: true, metadata: {} } },
    });
    await post(fn);
    expect(adjustments()).toHaveLength(0);
  });

  it("the tax inside a capture: the non-tax part is kept first", () => {
    const cases: Array<[number, number, number, number]> = [
      [10900, 3000, 900, 0], [10900, 10500, 900, 500], [10900, 10900, 900, 900], [10900, 10000, 900, 0], [1000, 0, 100, 0],
    ];
    for (const [authorisedCents, capturedCents, taxCents, want] of cases) {
      expect(taxInsideCaptureCents({ authorisedCents, capturedCents, taxCents }), `${capturedCents} of ${authorisedCents}`).toBe(want);
    }
    expect(cases.length).toBeGreaterThan(4);
  });
});
