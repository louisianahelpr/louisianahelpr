/**
 * ME-009: a card dispute on a job whose payout had NOT gone out yet (escrow /
 * payout_pending) blocked the payout in silence — admins were notified, the
 * Helpr saw a healthy job and was never told the money was held, nor how it
 * ended. A released job's Helpr is told by the clawback (chargebackClawback.test.ts).
 *
 * Now, on the real stripe-webhook source, the held Helpr is told once when the
 * hold is placed, and again on each outcome: inquiry dismissed, won, lost.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeCreated.ts | if (blockedNow && chargebackJob.helper_id) { | if (true && chargebackJob.helper_id) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeCreated.ts |           blockedNow = true; |           void 0;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | if (lost.rows === 0 && closedJob.helper_id | if (false && closedJob.helper_id
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | if (!held && !hold.readError && closedJob.helper_id | if (false && closedJob.helper_id
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | if (!held && closedJob.helper_id) { | if (false) {
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

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
  id: "dp_h", status, amount: 10000, reason: "fraudulent", payment_intent: "pi_job", charge: "ch_job",
});
const job = (over: Record<string, unknown> = {}) => ({
  id: "job-h", customer_id: "poster-1", helper_id: "helper-1", title: "Fence repair",
  status: "in_progress", payment_status: "escrow", dispute_status: null, disputed_at: null,
  payout_scheduled_at: null, ...over,
});
const helperNotices = () =>
  scenario.writes
    .filter((w) => w.table === "notifications" && w.op === "insert")
    .map((w) => w.payload as { user_id: string; title: string; message: string })
    .filter((n) => n.user_id === "helper-1");

describe("held payout: the Helpr is told (ME-009)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("created on an escrow job tells the Helpr their payout is on hold", async () => {
    const fn = await load();
    event("evt_h1", "charge.dispute.created", dispute("needs_response"));
    scenario.reads.jobs = { rows: [job()] };
    stripeMock.transfers.list.mockResolvedValue({ data: [] });
    expect((await post(fn)).status).toBe(200);
    const told = helperNotices();
    expect(told).toHaveLength(1);
    expect(told[0].title).toBe("Payout on hold: card dispute");
    expect(told[0].message).toMatch(/Fence repair/);
  });

  it("a delivery whose block matches no row (already held) does not tell them again", async () => {
    const fn = await load();
    event("evt_h2", "charge.dispute.created", dispute("needs_response"));
    scenario.reads.jobs = { rows: [job()] };
    scenario.writeSelectRows["jobs:update"] = [];
    stripeMock.transfers.list.mockResolvedValue({ data: [] });
    await post(fn);
    expect(helperNotices()).toHaveLength(0);
  });

  it("an inquiry dismissed (warning_closed) tells them the hold is lifted", async () => {
    const fn = await load();
    event("evt_h3", "charge.dispute.closed", dispute("warning_closed"));
    scenario.reads.jobs = { rows: [job({ payment_status: "chargeback", dispute_status: "stripe_chargeback", disputed_at: "2026-09-20T00:00:00.000Z" })] };
    expect((await post(fn)).status).toBe(200);
    expect(helperNotices().map((n) => n.title)).toEqual(["Payout hold lifted"]);
  });

  it("WON with nothing clawed back tells them the payout is being released", async () => {
    const fn = await load();
    event("evt_h4", "charge.dispute.closed", dispute("won"));
    scenario.reads.jobs = { rows: [job({ payment_status: "chargeback", dispute_status: "stripe_chargeback", disputed_at: "2026-09-20T00:00:00.000Z" })] };
    scenario.reads.chargeback_clawbacks = { rows: [] };
    expect((await post(fn)).status).toBe(200);
    expect(helperNotices().map((n) => n.title)).toEqual(["Card dispute decided in our favor"]);
  });

  it("LOST with nothing clawed back tells them the payout stays on hold", async () => {
    const fn = await load();
    event("evt_h5", "charge.dispute.closed", dispute("lost"));
    scenario.reads.jobs = { rows: [job({ payment_status: "chargeback", dispute_status: "stripe_chargeback", disputed_at: "2026-09-20T00:00:00.000Z" })] };
    scenario.reads.chargeback_clawbacks = { rows: [] };
    expect((await post(fn)).status).toBe(200);
    const told = helperNotices();
    expect(told).toHaveLength(1);
    expect(told[0].message).toMatch(/stays on hold/);
  });
});
