/**
 * Q1325 (a): charge.refund.updated, a booked refund that later turns failed
 * or canceled. Runs the REAL stripe-webhook source through the edge harness.
 *
 * @mutate supabase/functions/stripe-webhook/index.ts |   "charge.refund.updated": handleChargeRefundUpdated, |   // (unregistered)
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |   if (refund.status !== "failed" && refund.status !== "canceled") return; |   if (refund.status !== "failed") return;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |     .delete()\n    .eq("stripe_refund_id", refund.id) |     .delete()\n    .eq("stripe_refund_id", "nothing")
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefundUpdated.ts |   if (job?.payment_status === "refunded" && stillFull === false) { |   if (false) {
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

  it("a CANCELED refund on a job that is not refunded: row removed, a warning", async () => {
    const fn = await load();
    refundEvent("canceled");
    scenario.reads.jobs = { rows: [{ id: "job-1", status: "in_progress", payment_status: "escrow" }] };
    await post(fn);
    expect(deletes()).toHaveLength(1);
    expect(alerts().some((a) => a.severity === "warning" && /A refund failed after it was booked/.test(a.title))).toBe(true);
    expect(alerts().some((a) => a.severity === "critical")).toBe(false);
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
