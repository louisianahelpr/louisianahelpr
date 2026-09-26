/**
 * ME-009: a card dispute on a job whose payout had NOT gone out yet (escrow /
 * payout_pending) blocked the payout in silence — admins were notified, the
 * Helpr saw a healthy job and was never told the money was held, nor how it
 * ended. A released job's Helpr is told by the clawback (chargebackClawback.test.ts).
 *
 * Now, on the real stripe-webhook source, the held Helpr is told once when the
 * hold is placed, and again on each outcome: inquiry dismissed, won, lost. An
 * outcome notice goes only to a Helpr who got the hold notice: a paid job
 * flipped to 'chargeback' with nothing to claw back looks the same on the row.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeCreated.ts | if (blockedNow && chargebackJob.helper_id) { | if (true && chargebackJob.helper_id) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeCreated.ts |           blockedNow = true; |           void 0;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeCreated.ts | if (holdNotice && (clawback?.reversedTotalCents ?? 0) === 0) { | if (holdNotice) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeCreated.ts | message: isInquiry | message: false
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | if (decidedClose !== "closed" && lost.rows === 0 && closedJob.helper_id | if (decidedClose !== "closed" && false && closedJob.helper_id
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | admins are asked to.\n        if (closedJob.helper_id | admins are asked to.\n        if (false
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | say how it ended.\n          if (closedJob.helper_id | say how it ended.\n          if (false
 * @mutate supabase/functions/stripe-webhook/handlers/_chargebackClawback.ts | return !error && (data?.length ?? 0) > 0; | return true;
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
    scenario.reads.notifications = { rows: [{ id: "n-hold" }] };
    expect((await post(fn)).status).toBe(200);
    expect(helperNotices().map((n) => n.title)).toEqual(["Payout hold lifted"]);
  });

  it("WON with nothing clawed back tells them the payout is being released", async () => {
    const fn = await load();
    event("evt_h4", "charge.dispute.closed", dispute("won"));
    scenario.reads.jobs = { rows: [job({ payment_status: "chargeback", dispute_status: "stripe_chargeback", disputed_at: "2026-09-20T00:00:00.000Z" })] };
    scenario.reads.notifications = { rows: [{ id: "n-hold" }] };
    scenario.reads.chargeback_clawbacks = { rows: [] };
    expect((await post(fn)).status).toBe(200);
    expect(helperNotices().map((n) => n.title)).toEqual(["Card dispute decided in our favor"]);
  });

  it("LOST with nothing clawed back tells them the payout stays on hold", async () => {
    const fn = await load();
    event("evt_h5", "charge.dispute.closed", dispute("lost"));
    // Q342: a lost dispute first asks settle_dispute_by_chargeback to close a
    // decided internal dispute; this job has none.
    stripeMock.charges.retrieve.mockResolvedValue({ id: "ch_job", amount: 10000, amount_captured: 10000 });
    scenario.rpc.settle_dispute_by_chargeback = { outcome: "no_unsettled_dispute" };
    scenario.reads.jobs = { rows: [job({ payment_status: "chargeback", dispute_status: "stripe_chargeback", disputed_at: "2026-09-20T00:00:00.000Z" })] };
    scenario.reads.notifications = { rows: [{ id: "n-hold" }] };
    scenario.reads.chargeback_clawbacks = { rows: [] };
    expect((await post(fn)).status).toBe(200);
    const told = helperNotices();
    expect(told).toHaveLength(1);
    expect(told[0].message).toMatch(/stays on hold/);
  });

  it("created on an inquiry says the bank asked, not that it is disputed", async () => {
    const fn = await load();
    event("evt_h6", "charge.dispute.created", dispute("warning_needs_response"));
    scenario.reads.jobs = { rows: [job()] };
    await post(fn);
    const told = helperNotices();
    expect(told).toHaveLength(1);
    expect(told[0].message).toMatch(/has asked about/);
    expect(told[0].message).not.toMatch(/disputed/);
  });

  it("a payout that went out before the block is reversed: the payee gets the clawback notice only", async () => {
    const fn = await load();
    event("evt_h7", "charge.dispute.created", dispute("needs_response"));
    scenario.reads.jobs = { rows: [job({ status: "completed", payment_status: "payout_pending" })] };
    scenario.reads.payout_transfers = { rows: [{ stripe_transfer_id: "tr_1", helper_id: "helper-1", status: "pending" }] };
    stripeMock.transfers.list.mockResolvedValue({ data: [{ id: "tr_1", amount: 9000, amount_reversed: 0, created: 1, destination: "acct_helper", transfer_group: "job_job-h" }] });
    stripeMock.transfers.createReversal.mockResolvedValue({ id: "trr_1" });
    scenario.writeSelectRows["chargeback_clawbacks:insert"] = [{
      id: "cb-1", dispute_id: "dp_h", job_id: "job-h", helper_id: "helper-1", original_transfer_id: "tr_1",
      stripe_account_id: "acct_helper", transfer_amount_cents: 9000, reversed_cents: 9000,
      stripe_reversal_id: null, repay_transfer_id: null, status: "reversing",
    }];
    await post(fn);
    const titles = helperNotices().map((n) => n.title);
    expect(titles).not.toContain("Payout on hold: card dispute");
    expect(titles).toHaveLength(1);
  });

  it("a Helpr never told of a hold (paid job, nothing clawed back) gets no won/lost notice", async () => {
    for (const outcome of ["won", "lost"]) {
      resetSupabaseMock();
      const fn = await load();
      event(`evt_h8_${outcome}`, "charge.dispute.closed", dispute(outcome));
      scenario.reads.jobs = { rows: [job({ status: "completed", payment_status: "chargeback", dispute_status: "stripe_chargeback", disputed_at: "2026-09-20T00:00:00.000Z" })] };
      scenario.reads.chargeback_clawbacks = { rows: [] };
      scenario.reads.notifications = { rows: [] };
      await post(fn);
      expect(helperNotices(), outcome).toHaveLength(0);
    }
  });
});
