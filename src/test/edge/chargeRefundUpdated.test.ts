/**
 * Q1325 (a): charge.refund.updated, a booked refund that later turns failed
 * or canceled. Runs the REAL stripe-webhook source through the edge harness.
 *
 * @mutate supabase/functions/stripe-webhook/index.ts |   "charge.refund.updated": handleChargeRefundUpdated, |   // (unregistered)
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |   if (refund.status !== "failed" && refund.status !== "canceled") return; |   if (refund.status !== "failed") return;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |     .delete()\n    .eq("stripe_refund_id", refund.id) |     .delete()\n    .eq("stripe_refund_id", "nothing")
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |   if (settledAsRefunded && stillFull === false) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |   const settledAsRefunded = ["refunded", "cancelled", "cancelling"].includes( |   const settledAsRefunded = ["refunded"].includes(
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |   const notRepaid = (settledAsRefunded && stillFull === false) \|\| removedNow; |   const notRepaid = settledAsRefunded && stillFull === false;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |   if (notRepaid && job?.customer_id) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |   if (delErr) { |   if (false) {
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, resetSharedMocks } from "./mocks/shared";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
  return loadEdgeFunction("stripe-webhook");
}
const post = (fn: EdgeHarness) =>
  fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" } }));
const refundEvent = (status: string, over: Record<string, unknown> = {}) =>
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({
    id: `evt_ru_${status}`,
    type: "charge.refund.updated",
    data: { object: { id: "re_1", status, amount: 5000, payment_intent: "pi_1", charge: "ch_1", failure_reason: "lost_or_stolen_card", ...over } },
  });
const alerts = () => slackAlerts as Array<{ severity?: string; title: string; message: string }>;
const deletes = () => scenario.writes.filter((w) => w.table === "payment_refunds" && w.op === "delete");

describe("charge.refund.updated (Q1325 (a))", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("a FAILED refund on a job marked refunded: its ledger row goes and ops is paged critical", async () => {
    const fn = await load();
    refundEvent("failed");
    scenario.reads.jobs = { rows: [{ id: "job-1", status: "cancelled", payment_status: "refunded" }] };
    scenario.writeSelectRows["payment_refunds:delete"] = [{ id: "pr-1", job_id: "job-1" }];
    stripeMock.charges.retrieve.mockResolvedValue({ id: "ch_1", amount: 5000, amount_refunded: 0 });
    const res = await post(fn);
    expect(res.status).toBe(200);
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0].filters).toContainEqual({ op: "eq", column: "stripe_refund_id", value: "re_1" });
    const page = alerts().find((a) => /Refund FAILED after the job was marked refunded/.test(a.title));
    expect(page?.severity).toBe("critical");
    // The job state is a person's call: not rewritten here.
    expect(scenario.writes.some((w) => w.table === "jobs")).toBe(false);
  });

  // Q1355 (1): a refund the ledger HAD booked was money the books said went
  // back. Losing it is critical, and the poster is told (Q1355 (6)).
  it("a CANCELED booked refund on a job that is not refunded: row removed, critical NOT-repaid page, poster told", async () => {
    const fn = await load();
    refundEvent("canceled");
    scenario.reads.jobs = { rows: [{ id: "job-1", status: "in_progress", payment_status: "escrow", customer_id: "poster-1", title: "Fence" }] };
    scenario.writeSelectRows["payment_refunds:delete"] = [{ id: "pr-1", job_id: "job-1" }];
    await post(fn);
    expect(deletes()).toHaveLength(1);
    const page = alerts().find((a) => /NOT repaid/.test(a.title));
    expect(page?.severity).toBe("critical");
    const told = scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert");
    expect(told.map((w) => (w.payload as { user_id: string }).user_id)).toEqual(["poster-1"]);
  });

  it("a failed refund that was never booked, on a job nobody closed: a plain warning, nobody told", async () => {
    const fn = await load();
    refundEvent("failed");
    scenario.reads.jobs = { rows: [{ id: "job-1", status: "in_progress", payment_status: "escrow", customer_id: "poster-1" }] };
    scenario.writeSelectRows["payment_refunds:delete"] = [];
    scenario.reads.recurring_visit_payments = { rows: [] };
    await post(fn);
    expect(alerts().some((a) => a.severity === "warning" && /had not been booked/.test(a.title))).toBe(true);
    expect(alerts().some((a) => a.severity === "critical")).toBe(false);
    expect(scenario.writes.some((w) => w.table === "notifications")).toBe(false);
  });

  // Q1355 (1): cancel_escrow closes 'cancelled', not 'refunded'.
  it("a failed refund on a job cancel_escrow closed 'cancelled' pages critical too", async () => {
    const fn = await load();
    refundEvent("failed");
    scenario.reads.jobs = { rows: [{ id: "job-1", status: "cancelled", payment_status: "cancelled", customer_id: "poster-1" }] };
    scenario.writeSelectRows["payment_refunds:delete"] = [];
    stripeMock.charges.retrieve.mockResolvedValue({ id: "ch_1", amount: 5000, amount_refunded: 0 });
    await post(fn);
    expect(alerts().find((a) => /Refund FAILED after the job was marked refunded/.test(a.title))?.severity).toBe("critical");
  });

  // Q809 (2): a recurring visit payment settled 'refunded' on this refund was
  // NOT repaid: a critical page and the payer told. Never put back to 'paid'
  // (lh-money-escrow review: a 'paid' row in the due window funds a booking).
  // @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |   const notRepaid = (settledAsRefunded && stillFull === false) \|\| removedNow \|\| !!visitNotRepaid; |   const notRepaid = (settledAsRefunded && stillFull === false) \|\| removedNow;
  it("a failed refund of a recurring visit payment pages critical and tells the payer, and writes nothing to the row (Q809 (2))", async () => {
    const fn = await load();
    refundEvent("failed");
    scenario.reads.jobs = { rows: [] };
    scenario.writeSelectRows["payment_refunds:delete"] = [];
    scenario.reads.recurring_visit_payments = { rows: [{ id: "vp-1", payer_id: "payer-1", visit_date: "2026-10-09" }] };
    await post(fn);
    expect(scenario.writes.some((x) => x.table === "recurring_visit_payments")).toBe(false);
    const page = alerts().find((a) => /NOT repaid/.test(a.title));
    expect(page?.severity).toBe("critical");
    expect(page?.message).toMatch(/refund them by hand/);
    const told = scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert");
    expect(told.map((w) => (w.payload as { user_id: string }).user_id)).toEqual(["payer-1"]);
  });

  // Q1355 (5): a redelivery after the first delivery removed the row.
  it("the page never says the ledger row was not removed when an earlier delivery removed it", async () => {
    const fn = await load();
    refundEvent("failed");
    scenario.reads.jobs = { rows: [{ id: "job-1", status: "in_progress", payment_status: "escrow" }] };
    scenario.writeSelectRows["payment_refunds:delete"] = [];
    await post(fn);
    const f = (slackAlerts as Array<{ fields?: Record<string, string> }>)[0]?.fields ?? {};
    expect(f["Ledger row"]).toMatch(/removed by an earlier delivery/);
    expect(JSON.stringify(f)).not.toMatch(/"Ledger row removed":"false"/);
  });

  it("a refund that SUCCEEDED (or is pending) changes nothing", async () => {
    const fn = await load();
    refundEvent("succeeded");
    await post(fn);
    expect(deletes()).toHaveLength(0);
    expect(alerts()).toHaveLength(0);
  });

  it("a failed delete answers 500 so Stripe redelivers (nothing silently dropped)", async () => {
    const fn = await load();
    refundEvent("failed");
    scenario.writeErrors.payment_refunds = { message: "boom" };
    const res = await post(fn);
    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
