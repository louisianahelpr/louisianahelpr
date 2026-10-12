/**
 * Q417 (d): a chargeback on a recurring series' charge ENDS the series and
 * tells both sides. Before, charge-recurring-visits only skipped a charged-back
 * series on each run, so it looked live to both parties and nobody was told.
 *
 * On the real stripe-webhook source: a real chargeback (not an inquiry) on a
 * series visit or a series parent calls end_recurring_series_by_platform
 * (20261012194707) with kind 'chargeback'; a one-off job and an inquiry never
 * do; a failure is paged and never thrown (the payout block already landed).
 * The SQL side (who is told, idempotence) is proven in
 * src/test/pglite/seriesEndByPlatform.pglite.mjs.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeCreated.ts | if (!isInquiry && (chargebackJob.parent_job_id \|\| chargebackJob.recurrence_days)) { | if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeCreated.ts | if (!isInquiry && (chargebackJob.parent_job_id \|\| chargebackJob.recurrence_days)) { | if (chargebackJob.parent_job_id \|\| chargebackJob.recurrence_days) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeCreated.ts | if (!isInquiry && (chargebackJob.parent_job_id \|\| chargebackJob.recurrence_days)) { | if (!isInquiry) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeCreated.ts |         if (endErr) {\n | if (false) {\n
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, postSlackOpsAlert } from "./mocks/shared";

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
function event(id: string, type: string, object: Record<string, unknown>) {
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({ id, type, data: { object } });
}
const dispute = (status: string) => ({
  id: "dp_s", status, amount: 5000, reason: "fraudulent", payment_intent: "pi_visit", charge: "ch_visit",
});
const job = (over: Record<string, unknown> = {}) => ({
  id: "visit-1", customer_id: "poster-1", helper_id: "helper-1", title: "Weekly lawn",
  status: "accepted", payment_status: "escrow", dispute_status: null, disputed_at: null,
  payout_scheduled_at: null, parent_job_id: "series-1", recurrence_days: null, ...over,
});
const endCalls = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "end_recurring_series_by_platform");

describe("a chargeback on a recurring series ends it (Q417 d)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
    stripeMock.transfers.list.mockResolvedValue({ data: [] });
  });

  it("a chargeback on a series VISIT ends the series, kind chargeback", async () => {
    const fn = await load();
    event("evt_s1", "charge.dispute.created", dispute("needs_response"));
    scenario.reads.jobs = { rows: [job()] };
    scenario.rpc.end_recurring_series_by_platform = { action: "ended" };
    expect((await post(fn)).status).toBe(200);
    const calls = endCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual({ p_job_id: "visit-1", p_kind: "chargeback", p_reason: "Stripe dispute dp_s" });
  });

  it("a chargeback on the series PARENT (visit one) ends it too", async () => {
    const fn = await load();
    event("evt_s2", "charge.dispute.created", dispute("needs_response"));
    scenario.reads.jobs = { rows: [job({ id: "series-1", parent_job_id: null, recurrence_days: [1, 3] })] };
    scenario.rpc.end_recurring_series_by_platform = { action: "ended" };
    expect((await post(fn)).status).toBe(200);
    expect(endCalls()).toHaveLength(1);
  });

  it("a one-off job never touches the series RPC", async () => {
    const fn = await load();
    event("evt_s3", "charge.dispute.created", dispute("needs_response"));
    scenario.reads.jobs = { rows: [job({ id: "one-off", parent_job_id: null, recurrence_days: null })] };
    expect((await post(fn)).status).toBe(200);
    expect(endCalls()).toHaveLength(0);
  });

  it("an inquiry (warning_*) withdraws nothing and ends nothing", async () => {
    const fn = await load();
    event("evt_s4", "charge.dispute.created", dispute("warning_needs_response"));
    scenario.reads.jobs = { rows: [job()] };
    expect((await post(fn)).status).toBe(200);
    expect(endCalls()).toHaveLength(0);
  });

  it("a failure to end the series is paged and never fails the webhook", async () => {
    const fn = await load();
    event("evt_s5", "charge.dispute.created", dispute("needs_response"));
    scenario.reads.jobs = { rows: [job()] };
    scenario.rpcErrors = { end_recurring_series_by_platform: { message: "boom", code: "XX000" } };
    expect((await post(fn)).status).toBe(200);
    const paged = postSlackOpsAlert.mock.calls.map((c) => (c[0] as { title: string }).title);
    expect(paged).toContain("Chargeback on a recurring series: series NOT ended");
  });

  it("before db-deploy (PGRST202) the webhook stays green and pages once a day to end it by hand", async () => {
    const fn = await load();
    event("evt_s6", "charge.dispute.created", dispute("needs_response"));
    scenario.reads.jobs = { rows: [job()] };
    scenario.rpcErrors = { end_recurring_series_by_platform: { message: "not found", code: "PGRST202" } };
    expect((await post(fn)).status).toBe(200);
    const pages = postSlackOpsAlert.mock.calls
      .map((c) => c[0] as { title: string; message: string; oncePerDayKey?: string })
      .filter((p) => p.title === "Chargeback on a recurring series: series NOT ended");
    expect(pages).toHaveLength(1);
    expect(pages[0].message).toMatch(/after db-deploy/);
    expect(pages[0].oncePerDayKey).toBe("chargeback-series-end-failed:dp_s");
  });
});
