/**
 * void-cancelled-payments must not refund an escrow an admin's dispute
 * decision owns.
 *
 * rpc_decide_dispute moves a poster-wins decision to status 'cancelled' with
 * the escrow still held for execute-dispute-split — the exact cancelled +
 * escrow shape Part A refunds by the cancellation rules. Both then refunded the
 * same charge; a party re-file + withdraw + poster_cancel_job reached it for
 * any decision (lh-authz-rls review, dispute-races round 2).
 *
 * Runs the REAL function source via the edge harness.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";

const CRON_SECRET = "cron-secret-void";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_void",
    CRON_SECRET,
  });
  return loadEdgeFunction("void-cancelled-payments");
}

const cronReq = () =>
  new Request("https://x/functions/v1/void-cancelled-payments", {
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });

function seedCancelledEscrowJob() {
  scenario.reads.jobs = {
    selectOverrides: [
      {
        // Part A's read — the only jobs select that names cancellation_fee.
        includes: "cancellation_fee",
        result: {
          rows: [{
            id: "job-decided",
            title: "Decided for the poster",
            stripe_session_id: null,
            stripe_payment_intent_id: "pi_decided",
            budget: 100,
            customer_fee_amount: 10,
            cancellation_fee: 0,
            date_needed: null,
            start_time: null,
            cancelled_at: null,
            helper_id: "helper-1",
            helper_confirmed_at: null,
            customer_id: "poster-1",
            helper_fee_percent: 10,
          }],
        },
      },
    ],
    rows: [],
  };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_decided", status: "succeeded", amount: 11000, amount_received: 11000, latest_charge: null,
  });
  stripeMock.refunds.create.mockResolvedValue({ id: "re_void", amount: 10000 });
}

describe("void-cancelled-payments — an unexecuted dispute decision owns the escrow", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });

  it("does NOT refund a cancelled + escrow job carrying a decided, unexecuted dispute", async () => {
    seedCancelledEscrowJob();
    scenario.reads.disputes = { rows: [{ id: "dispute-1", execution_status: "pending", payout_split: { poster: 1, helper: 0 } }] };
    const h = await load();
    const res = await h.fetch(cronReq());
    const body = JSON.parse(await res.text());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    // Nor the Helpr's cancellation fee: a poster-wins decision is `cancelled`,
    // and Part A pays that fee from the same charge.
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(scenario.writes.filter((w) => w.table === "jobs")).toHaveLength(0);
    // Matched on the serialized results: the fixture-schema guard reads a
    // `status:` literal beside a `disputes` read as a disputes row.
    expect(JSON.stringify(body.results)).toContain('"job_id":"job-decided","title":"Decided for the poster","status":"dispute_decision_pending"');
    expect(res.status).toBe(200);
  });

  it("fails CLOSED when the dispute check cannot be read: no refund, and the run reports a defect", async () => {
    seedCancelledEscrowJob();
    scenario.reads.disputes = { error: { message: "read blew up" } };
    const h = await load();
    const res = await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
  });

  it("does NOT refund while a dispute settlement claim is held (a withdrawal took the job out of disputed under it)", async () => {
    seedCancelledEscrowJob();
    scenario.reads.dispute_settlement_claims = { rows: [{ action: "release", claimed_at: "2026-09-14T20:00:00Z" }] };
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("does NOT refund a cancelled + escrow job whose escrow already went to the Helpr (a live payout_transfers row) — pages critical (round 3, H1)", async () => {
    // A Quick Release that transferred and then could not flip leaves the job
    // disputed with a paid ledger row; a withdrawal + poster_cancel_job then
    // lands it here as cancelled + escrow, and the cancellation refund paid
    // the poster on top of the Helpr.
    seedCancelledEscrowJob();
    scenario.reads.payout_transfers = { rows: [{ id: "pt-1", status: "paid" }] };
    const h = await load();
    const res = await h.fetch(cronReq());
    const body = JSON.parse(await res.text());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(scenario.writes.filter((w) => w.table === "jobs")).toHaveLength(0);
    expect(JSON.stringify(body.results)).toContain('"job_id":"job-decided","title":"Decided for the poster","status":"escrow_already_released"');
    expect((slackAlerts as Array<{ title?: string; severity?: string }>).some(
      (a) => a.title === "Cancelled job NOT refunded — its escrow was already paid to the Helpr" && a.severity === "critical",
    )).toBe(true);
    expect(res.status).toBe(500);
  });

  it("fails CLOSED when the payout ledger cannot be read: no refund, defect (round 3, H1)", async () => {
    seedCancelledEscrowJob();
    scenario.reads.payout_transfers = { error: { message: "ledger read blew up" } };
    const h = await load();
    const res = await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
  });

  it("does NOT refund when Stripe shows a live transfer for the job that is not this loop's cancellation fee (round 5)", async () => {
    seedCancelledEscrowJob();
    stripeMock.transfers.list.mockResolvedValue({
      data: [{ id: "tr_quick", amount: 8800, amount_reversed: 0, metadata: { job_id: "job-decided", initiated_by: "admin" } }],
    });
    const h = await load();
    const res = await h.fetch(cronReq());
    const body = JSON.parse(await res.text());
    expect(stripeMock.transfers.list).toHaveBeenCalledWith(expect.objectContaining({ transfer_group: "job_job-decided" }));
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(JSON.stringify(body.results)).toContain('"status":"escrow_already_released"');
    expect(res.status).toBe(500);
  });

  it("control: an earlier run's own cancellation-fee transfer does not block the settlement (round 5)", async () => {
    seedCancelledEscrowJob();
    stripeMock.transfers.list.mockResolvedValue({
      data: [{ id: "tr_fee", amount: 900, amount_reversed: 0, metadata: { job_id: "job-decided", type: "cancellation_fee" } }],
    });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalled();
  });

  it("fails CLOSED when the Stripe transfer list cannot be read (round 5)", async () => {
    seedCancelledEscrowJob();
    stripeMock.transfers.list.mockRejectedValue(new Error("stripe down"));
    const h = await load();
    const res = await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
  });

  it("control: with no dispute decision the job still proceeds to its refund checks", async () => {
    seedCancelledEscrowJob();
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalled();
  });
});
