/**
 * A crew has no lead (docs/OPEN.md Q407) and each member's share of the budget
 * is FROZEN in cents at hire (group_job_helpers.share_cents / slot_no,
 * 20260925154606, largest remainder). The payout cron pays each member from
 * their frozen share, never budget / helpers_needed re-derived from columns the
 * poster could edit (money review HIGH-1), and the shares add up to the budget
 * exactly (MEDIUM-3: $100 across 3 used to pay $99.99). An under-filled crew
 * refunds its unfilled slots' shares to the poster once, when the hired crew
 * is paid (MEDIUM-4).
 *
 * Runs the REAL function source via the edge harness.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";

const CRON_SECRET = "cron-secret-crew";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    CRON_SECRET,
  });
  return loadEdgeFunction("process-scheduled-payouts");
}

const run = async () => {
  const fn = await load();
  return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
};

/** A $100 crew job. `members` are [helper_id, slot_no, share_cents]. */
function seedCrew(members: Array<[string, number, number]>, { needed = 3, paidAll = false } = {}) {
  const job = {
    id: "job-crew",
    title: "Move a piano",
    helper_id: null,
    customer_id: "poster-1",
    budget: 100,
    platform_fee_amount: 10,
    helper_fee_percent: 10,
    urgent_fee: 0,
    stripe_session_id: "cs_1",
    stripe_payment_intent_id: "pi_1",
    status: "completed",
    is_group_job: true,
    helpers_needed: needed,
    sales_tax_rate: 0,
  };
  scenario.reads.jobs = { rows: [job] };
  scenario.reads.platform_settings = { rows: [{ onboarding_fee_cents: 200 }] };
  scenario.reads.profiles = {
    rows: [{ stripe_account_id: "acct_member", onboarding_fee_paid: true, subscription_tier: "pro", subscription_expires_at: null }],
  };
  scenario.reads.group_job_helpers = {
    rows: members.map(([helper_id, slot_no, share_cents]) => ({ helper_id, slot_no, share_cents })),
  };
  scenario.reads.payout_transfers = {
    rows: [],
    // The "has the whole crew been paid" count.
    selectOverrides: [{
      includes: "helper_id, amount_cents",
      result: { rows: paidAll ? members.map(([helper_id]) => ({ helper_id, amount_cents: 2900 })) : [] },
    }],
  };
  scenario.reads.payment_refunds = { rows: [] };
  scenario.reads.user_roles = { rows: [] };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_1", status: "succeeded", latest_charge: "ch_1", amount: 11200, amount_received: 11200,
  });
  stripeMock.transfers.create.mockImplementation(async (params: { destination: string }) => ({ id: `tr_${params.destination}` }));
  stripeMock.refunds.create.mockResolvedValue({ id: "re_unfilled", amount: 3333, currency: "usd" });
}

const settledLedger = () =>
  scenario.writes
    .filter((w) => w.table === "payout_transfers" && w.op === "update")
    .map((w) => w.payload as Record<string, unknown>)
    .filter((p) => p.stripe_transfer_id);

describe("process-scheduled-payouts — a crew is paid from its frozen shares", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });

  // @mutate supabase/functions/process-scheduled-payouts/index.ts | const perHelperBudget = crewSlot?.shareCents != null ? crewSlot.shareCents / 100 : job.budget / helpersCount; | const perHelperBudget = job.budget / helpersCount;
  it("$100 across 3: each member's payout + commission is their frozen share, and the three add up to exactly $100.00", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333], ["m3", 2, 3333]]);
    await run();
    const rows = settledLedger();
    expect(rows).toHaveLength(3);
    const gross = rows.map((r) => Number(r.amount_cents) + Number(r.platform_fee_cents));
    expect(gross.sort()).toEqual([3333, 3333, 3334]);
    expect(gross.reduce((a, b) => a + b, 0)).toBe(10000);
  });

  // @mutate supabase/functions/process-scheduled-payouts/index.ts | return { ready: refund.ok, paidCents, | return { ready: true, paidCents,
  it("an under-filled crew (2 of 3), all paid: the unfilled slot's $33.33 is refunded to the poster once, recorded, then the job releases", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333]], { paidAll: true });
    await run();
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 3333 },
      { idempotencyKey: "crew-unfilled-refund-job-crew" },
    );
    const ledger = scenario.writes.find((w) => w.table === "payment_refunds");
    expect(ledger?.payload).toEqual(expect.objectContaining({ source: "crew_unfilled_refund", amount_cents: 3333, customer_id: "poster-1" }));
    expect(scenario.writes.some((w) => w.table === "jobs" && (w.payload as Record<string, unknown>).payment_status === "released")).toBe(true);
  });

  // @mutate supabase/functions/process-scheduled-payouts/index.ts |           if (autoRefunds) { |           if (false) {
  it("an under-filled crew whose shares are frozen is refunded, not paged; one from before the shares still pages", async () => {
    const unallocated = () =>
      (slackAlerts as Array<{ title?: string }>).filter((a) => /escrow remainder unallocated/.test(a.title ?? "")).length;
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333]]);
    await run();
    expect(unallocated()).toBe(0);
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
    // A roster row from before 20260925154606: no slot, no frozen share.
    seedCrew([["m1", 0, 3334]]);
    (scenario.reads.group_job_helpers as { rows: Array<Record<string, unknown>> }).rows = [
      { helper_id: "m1", slot_no: null, share_cents: null },
      { helper_id: "m2", slot_no: null, share_cents: null },
    ];
    await run();
    expect(unallocated()).toBe(1);
  });

  it("the unfilled refund is never sent twice: a prior crew_unfilled_refund row skips it", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333]], { paidAll: true });
    scenario.reads.payment_refunds = { rows: [{ stripe_refund_id: "re_earlier" }] };
    await run();
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it("a failed unfilled refund holds the job in payout_pending for the next run (not released)", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333]], { paidAll: true });
    stripeMock.refunds.create.mockRejectedValue(new Error("stripe down"));
    await run();
    expect(scenario.writes.some((w) => w.table === "jobs" && (w.payload as Record<string, unknown>).payment_status === "released")).toBe(false);
  });

  // ── docs/OPEN.md Q409 + Q396(c): a crew dispute decided member by member ──
  /** A live crew decision on job-crew: `refunded` members' shares go back to the poster. */
  function seedCrewDecision(refunded: string[], outcomesFor: string[]) {
    scenario.reads.disputes = {
      rows: [{ id: "disp-1" }],
      // checkUnsettledDispute's read (it asks for payout_split): a crew_fanout
      // decision is not "unsettled" to this cron, which is its executor.
      selectOverrides: [{ includes: "payout_split", result: { rows: [] } }],
    };
    scenario.reads.crew_dispute_member_outcomes = {
      rows: outcomesFor.map((helper_id) => ({ helper_id, member_outcome: refunded.includes(helper_id) ? "refund" : "pay" })),
    };
    scenario.rpc.mark_crew_dispute_executed = true;
  }

  // @mutate supabase/functions/process-scheduled-payouts/index.ts | .or("disputed_at.is.null,and(is_group_job.is.true,dispute_status.in.(resolved,auto_resolved))") | .is("disputed_at", null)
  it("Q396(c): the payout query admits a CREW whose dispute CLOSED (resolved / auto_resolved); a single job still needs disputed_at IS NULL", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333], ["m3", 2, 3333]]);
    await run();
    const q = scenario.readQueries.find((r) => r.table === "jobs" && r.cols.includes("sales_tax_rate"));
    expect(q?.filters).toEqual(
      expect.arrayContaining([expect.objectContaining({ op: "or", value: "disputed_at.is.null,and(is_group_job.is.true,dispute_status.in.(resolved,auto_resolved))" })]),
    );
    expect(q?.filters.some((f) => f.op === "is" && f.column === "disputed_at")).toBe(false);
    // A group job reads the unsettled-dispute hold WITHOUT its own crew
    // decision; a single-helper job would still see a crew_fanout row as unsettled.
    const hold = scenario.readQueries.find((r) => r.table === "disputes" && r.cols.includes("payout_split"));
    expect(JSON.stringify(hold?.filters)).toContain("execution_status.neq.crew_fanout");
  });

  // @mutate supabase/functions/process-scheduled-payouts/index.ts |           if (refundedByDecision.has(helperId)) continue; |           if (false) continue;
  it("a crew decision paying m1, m2 and refunding m3: two transfers, m3's frozen $33.33 refunded once on the dispute's key, the job released, the dispute closed through its one writer", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333], ["m3", 2, 3333]]);
    seedCrewDecision(["m3"], ["m1", "m2", "m3"]);
    (scenario.reads.payout_transfers as { selectOverrides: Array<{ includes: string; result: { rows: unknown[] } }> })
      .selectOverrides[0].result.rows = [{ helper_id: "m1", amount_cents: 2934 }, { helper_id: "m2", amount_cents: 2933 }];
    stripeMock.refunds.create.mockResolvedValue({ id: "re_crew_dispute", amount: 3333, currency: "usd" });
    await run();
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(2);
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 3333 },
      { idempotencyKey: "crew-dispute-refund-disp-1" },
    );
    const ledger = scenario.writes.find((w) => w.table === "payment_refunds");
    expect(ledger?.payload).toEqual(expect.objectContaining({ source: "crew_dispute_refund", amount_cents: 3333 }));
    expect(scenario.writes.some((w) => w.table === "jobs" && (w.payload as Record<string, unknown>).payment_status === "released")).toBe(true);
    const close = (scenario.rpcCalls ?? []).filter((c) => c.name === "mark_crew_dispute_executed");
    expect(close).toHaveLength(1);
    expect(close[0].args).toEqual({ _dispute_id: "disp-1", _helper_cents: 5867, _refund_cents: 3333, _refund_id: "re_crew_dispute" });
  });

  it("a crew decision whose outcomes cannot be read pays NOBODY (fail closed: a refunded member must never be paid)", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333], ["m3", 2, 3333]]);
    seedCrewDecision(["m3"], []);
    await run();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  // @mutate supabase/functions/process-scheduled-payouts/index.ts |         if (job.is_group_job && !crewSettled.has(job.id)) { |         if (false) {
  it("every member already paid but the refund never went out (it failed on the last member's run): the next run refunds and releases — before, nothing ever asked again", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333]], { paidAll: true });
    // Each member's own ledger read finds their settled transfer.
    (scenario.reads.payout_transfers as { selectOverrides: Array<{ includes: string; result: { rows: unknown[] } }> }).selectOverrides.push({
      includes: "stripe_transfer_id, status, created_at",
      result: { rows: [{ id: "pt-1", stripe_transfer_id: "tr_prev", status: "paid", created_at: "2026-09-25T00:00:00Z" }] },
    });
    await run();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 3333 },
      { idempotencyKey: "crew-unfilled-refund-job-crew" },
    );
    expect(scenario.writes.some((w) => w.table === "jobs" && (w.payload as Record<string, unknown>).payment_status === "released")).toBe(true);
  });
});
