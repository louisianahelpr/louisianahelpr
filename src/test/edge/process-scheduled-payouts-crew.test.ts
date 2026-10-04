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
import { testModeUnderLiveKey, captureTestModeSkips } from "../helpers/testModeUnderLiveKey";

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
    payment_status: "payout_pending",
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

  // The registration that guarded the frozen share used to sit on the even
  // $100/3 case below, where budget / 3 rounds to the same whole dollars as
  // every frozen share: it SURVIVED its own mutation (measured 2026-10-04 on
  // origin/main). Uneven shares tell the two apart.
  // @mutate supabase/functions/process-scheduled-payouts/index.ts | const perHelperBudget = crewSlot?.shareCents != null ? crewSlot.shareCents / 100 : job.budget / helpersCount; | const perHelperBudget = job.budget / helpersCount;
  it("uneven frozen shares ($50 / $30 / $20): each member is paid from THEIR share, not budget / 3", async () => {
    seedCrew([["m1", 0, 5000], ["m2", 1, 3000], ["m3", 2, 2000]]);
    await run();
    const gross = settledLedger().map((r) => Number(r.amount_cents) + Number(r.platform_fee_cents)).sort((x, y) => x - y);
    const shares = [2000, 3000, 5000];
    expect(gross).toHaveLength(3);
    gross.forEach((g, i) => {
      expect(shares[i] - g).toBeGreaterThanOrEqual(0);
      expect(shares[i] - g).toBeLessThan(100);
    });
  });

  it("$100 across 3: each member is paid from their frozen share, in whole dollars rounded down (Q236)", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333], ["m3", 2, 3333]]);
    await run();
    const rows = settledLedger();
    expect(rows).toHaveLength(3);
    // Q236 (owner, 2026-09-27): the transfer is a whole dollar, rounded DOWN;
    // the platform keeps the cents. So payout + commission sits within a
    // dollar BELOW the member's frozen share, never above it.
    for (const r of rows) expect(Number(r.amount_cents) % 100).toBe(0);
    const gross = rows.map((r) => Number(r.amount_cents) + Number(r.platform_fee_cents)).sort();
    const shares = [3333, 3333, 3334];
    gross.forEach((g, i) => {
      expect(shares[i] - g).toBeGreaterThanOrEqual(0);
      expect(shares[i] - g).toBeLessThan(100);
    });
    const total = gross.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(10000);
    expect(total).toBeGreaterThan(10000 - 300);
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

  // ── docs/OPEN.md Q728 + Q396(c): a crew dispute decided member by member ──
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

  const released = () =>
    scenario.writes.some((w) => w.table === "jobs" && (w.payload as Record<string, unknown>).payment_status === "released");

  // Money review M4: the decision is closed BEFORE the flip.
  // @mutate supabase/functions/process-scheduled-payouts/index.ts |           allRosterPaid = crewSettle.ready && await closeCrewDecision(job, crewSettle); |           allRosterPaid = crewSettle.ready;
  it("a crew decision that cannot be closed keeps the job payout_pending (a released job would never retry the close)", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333], ["m3", 2, 3333]]);
    seedCrewDecision(["m3"], ["m1", "m2", "m3"]);
    scenario.rpc.mark_crew_dispute_executed = false;
    (scenario.reads.payout_transfers as { selectOverrides: Array<{ includes: string; result: { rows: unknown[] } }> })
      .selectOverrides[0].result.rows = [{ helper_id: "m1", amount_cents: 2934 }, { helper_id: "m2", amount_cents: 2933 }];
    await run();
    expect((scenario.rpcCalls ?? []).some((c) => c.name === "mark_crew_dispute_executed")).toBe(true);
    expect(released()).toBe(false);
  });

  // Money review M4, the retry: an earlier run closed the decision and then
  // failed the flip. The closed decision's outcomes still bind.
  // @mutate supabase/functions/process-scheduled-payouts/index.ts |              crewDecisionRows = closedRows as Array<{ id: string }>; |              crewDecisionRows = [];
  it("a crew decision closed by an earlier run (whose flip failed) still refunds m3, never pays m3, and is not closed twice", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333], ["m3", 2, 3333]]);
    seedCrewDecision(["m3"], ["m1", "m2", "m3"]);
    scenario.reads.disputes = {
      rows: [],
      selectOverrides: [
        { includes: "payout_split", result: { rows: [] } },
        { includes: "executed_at", result: { rows: [{ id: "disp-1", executed_at: "2026-09-26T00:00:00Z" }] } },
      ],
    };
    scenario.reads.crew_dispute_member_outcomes = {
      rows: [{ helper_id: "m1", member_outcome: "pay" }, { helper_id: "m2", member_outcome: "pay" }, { helper_id: "m3", member_outcome: "refund" }],
      selectOverrides: [{ includes: "dispute_id", result: { rows: [{ dispute_id: "disp-1" }] } }],
    };
    (scenario.reads.payout_transfers as { selectOverrides: Array<{ includes: string; result: { rows: unknown[] } }> })
      .selectOverrides[0].result.rows = [{ helper_id: "m1", amount_cents: 2934 }, { helper_id: "m2", amount_cents: 2933 }];
    await run();
    // Three members, two transfers: m3 (refunded by the decision) is not paid.
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(2);
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 3333 },
      { idempotencyKey: "crew-dispute-refund-disp-1" },
    );
    expect((scenario.rpcCalls ?? []).some((c) => c.name === "mark_crew_dispute_executed")).toBe(false);
    expect(released()).toBe(true);
  });

  // Money review M3: a refund the charge can no longer cover in full.
  // @mutate supabase/functions/process-scheduled-payouts/index.ts |        if (refundCents < cardOwedCents) return shortRefund(refund.id, refundCents); |        if (false) return shortRefund(refund.id, refundCents);
  it("a crew refund short of what the decision owes pages ops and leaves the decision OPEN (not closed as settled)", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333], ["m3", 2, 3333]]);
    seedCrewDecision(["m3"], ["m1", "m2", "m3"]);
    (scenario.reads.payout_transfers as { selectOverrides: Array<{ includes: string; result: { rows: unknown[] } }> })
      .selectOverrides[0].result.rows = [{ helper_id: "m1", amount_cents: 2934 }, { helper_id: "m2", amount_cents: 2933 }];
    // Only $80.00 was captured: 8000 - 5867 = 2133c left of the 3333c owed.
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_1", status: "succeeded", latest_charge: "ch_1", amount: 8000, amount_received: 8000,
    });
    stripeMock.refunds.create.mockResolvedValue({ id: "re_short", amount: 2133, currency: "usd" });
    await run();
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 2133 },
      { idempotencyKey: "crew-dispute-refund-disp-1" },
    );
    expect((slackAlerts as Array<{ title?: string }>).some((a) => /Crew refund short/.test(a.title ?? ""))).toBe(true);
    expect((scenario.rpcCalls ?? []).some((c) => c.name === "mark_crew_dispute_executed")).toBe(false);
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

  // ── MQ31(C) (owner, 2026-09-27): the unpaid share of the service fee and
  // sales tax (and of any gift) goes back too, not just the base price.
  // Rounding: each of fee and tax is floored to the cent, pro-rata on the
  // unpaid share of the budget; the sub-cent remainder stays with the platform.

  const setJob = (patch: Record<string, unknown>) => {
    const rows = (scenario.reads.jobs as { rows: Array<Record<string, unknown>> }).rows;
    Object.assign(rows[0], patch);
  };
  const shortPages = () =>
    (slackAlerts as Array<{ title?: string }>).filter((a) => /Crew refund short/.test(a.title ?? "")).length;

  // @mutate supabase/functions/process-scheduled-payouts/index.ts | const feeReturnCents = budgetCents > 0 ? Math.floor((feeCents * unpaidBudgetCents) / budgetCents) : 0; | const feeReturnCents = 0;
  it("MQ31(C): 2 of 3 filled, $12 fee + $9 tax: the poster gets 3333 + floor(1200*3333/10000)=399 + floor(900*3333/10000)=299 = 4031c, recorded at 4031", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333]], { paidAll: true });
    setJob({ customer_fee_amount: 12, sales_tax_amount: 9 });
    stripeMock.refunds.create.mockResolvedValue({ id: "re_unfilled", amount: 4031, currency: "usd" });
    await run();
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 4031 },
      { idempotencyKey: "crew-unfilled-refund-job-crew" },
    );
    const ledger = scenario.writes.find((w) => w.table === "payment_refunds");
    expect(ledger?.payload).toEqual(expect.objectContaining({ source: "crew_unfilled_refund", amount_cents: 4031 }));
    expect(shortPages()).toBe(0);
  });

  // @mutate supabase/functions/process-scheduled-payouts/index.ts | if (priorCents < cardOwedCents) return shortRefund(row.stripe_refund_id, priorCents, false); | if (false) return shortRefund(row.stripe_refund_id, priorCents, false);
  it("MQ31(C) re-run: a prior refund at the full 4031c is not sent again and does not page; one at the old base-only 3333c pages as short", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333]], { paidAll: true });
    setJob({ customer_fee_amount: 12, sales_tax_amount: 9 });
    scenario.reads.payment_refunds = { rows: [{ stripe_refund_id: "re_prev", amount_cents: 4031 }] };
    await run();
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(shortPages()).toBe(0);

    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333]], { paidAll: true });
    setJob({ customer_fee_amount: 12, sales_tax_amount: 9 });
    scenario.reads.payment_refunds = { rows: [{ stripe_refund_id: "re_prev", amount_cents: 3333 }] };
    await run();
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(shortPages()).toBe(1);
  });

  // @mutate supabase/functions/process-scheduled-payouts/index.ts | if (a.isPifFunded) { | if (false) {
  it("MQ31(C): a gift-funded crew (2 of 3) gets the unfilled share back as gift credit (3333 bps of a 10000c gift), with no card refund and no manual page", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333]], { paidAll: true });
    setJob({ stripe_payment_intent_id: null, stripe_session_id: null });
    scenario.reads.gift_cards = { rows: [{ id: "gc-1" }] };
    scenario.rpc.restore_gift_card_for_job = (args?: unknown) => {
      const a = args as { p_share_bps: number; p_dry_run: boolean };
      return a.p_dry_run
        ? { outcome: "would_restore", applied_cents: 10000 }
        : { outcome: "restored", restore_cents: Math.floor((10000 * a.p_share_bps) / 10000) };
    };
    await run();
    const restores = (scenario.rpcCalls ?? []).filter(
      (c) => c.name === "restore_gift_card_for_job" && (c.args as { p_dry_run: boolean }).p_dry_run === false,
    );
    expect(restores).toHaveLength(1);
    expect(restores[0].args).toEqual({ p_job_id: "job-crew", p_share_bps: 3333, p_dry_run: false });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect((slackAlerts as Array<{ title?: string }>).some((a) => /manual refund|could not be restored|Crew refund short/i.test(a.title ?? ""))).toBe(false);
  });

  // Since Q1210 the card difference is read once, in the main loop (the crew refund used to re-read it).
  // @mutate supabase/functions/process-scheduled-payouts/index.ts | capturedCents = captured.cents; | capturedCents = 0;
  it("MQ31(C) review #1: a partial-gift crew (4000c gift + 6000c card, 2 of 3) restores 1333c as gift credit and refunds the other 2000c to the card, no manual page", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333]], { paidAll: true });
    scenario.reads.gift_cards = { rows: [{ id: "gc-1" }] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_1", status: "succeeded", latest_charge: "ch_1", amount: 6000, amount_received: 6000,
    });
    scenario.rpc.restore_gift_card_for_job = (args?: unknown) => {
      const a = args as { p_share_bps: number; p_dry_run: boolean };
      return a.p_dry_run
        ? { outcome: "would_restore", applied_cents: 4000 }
        : { outcome: "restored", restore_cents: Math.floor((4000 * a.p_share_bps) / 10000) };
    };
    stripeMock.refunds.create.mockResolvedValue({ id: "re_unfilled", amount: 2000, currency: "usd" });
    await run();
    const restores = (scenario.rpcCalls ?? []).filter(
      (c) => c.name === "restore_gift_card_for_job" && (c.args as { p_dry_run: boolean }).p_dry_run === false,
    );
    expect(restores).toHaveLength(1);
    expect(restores[0].args).toEqual({ p_job_id: "job-crew", p_share_bps: 3334, p_dry_run: false });
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 2000 },
      { idempotencyKey: "crew-unfilled-refund-job-crew" },
    );
    expect((slackAlerts as Array<{ title?: string }>).some((a) => /manual refund|could not be restored|Crew refund short/i.test(a.title ?? ""))).toBe(false);
  });

  // @mutate supabase/functions/process-scheduled-payouts/index.ts | (outcome === "already_restored" && restoreCentsRaw === expectedCents); | (outcome === "already_restored");
  it("MQ31(C) review #2: an already_restored gift of a different amount (another path's return) pages a person instead of being booked as this share", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333]], { paidAll: true });
    setJob({ stripe_payment_intent_id: null, stripe_session_id: null });
    scenario.reads.gift_cards = { rows: [{ id: "gc-1" }] };
    scenario.rpc.restore_gift_card_for_job = (args?: unknown) => {
      const a = args as { p_dry_run: boolean };
      return a.p_dry_run
        ? { outcome: "would_restore", applied_cents: 10000 }
        : { outcome: "already_restored", restore_cents: 5000 };
    };
    await run();
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect((slackAlerts as Array<{ title?: string }>).filter((a) => /could not be restored/i.test(a.title ?? ""))).toHaveLength(1);
  });
  // ── Q891: the partial-gift crew's charge is a test-mode PaymentIntent ──
  // Minted under the TEST key before prod went live; the live key answers 404
  // "a similar object exists in test mode". No real money sits behind it, so
  // the card refund is skipped with one structured log line: no refund, no
  // defect (the run answers 200, not 500), no page, the job not released.
  function seedPartialGiftCrew() {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333]], { paidAll: true });
    // Every member was paid on an earlier run, so this run is only the
    // unfilled-share refund (the already-transferred branch).
    (scenario.reads.payout_transfers as { selectOverrides: Array<{ includes: string; result: { rows: unknown[] } }> }).selectOverrides.push({
      includes: "stripe_transfer_id, status, created_at",
      result: { rows: [{ id: "pt-1", stripe_transfer_id: "tr_prev", status: "paid", created_at: "2026-09-25T00:00:00Z" }] },
    });
    scenario.reads.gift_cards = { rows: [{ id: "gc-1" }] };
    scenario.rpc.restore_gift_card_for_job = (args?: unknown) => {
      const a = args as { p_share_bps: number; p_dry_run: boolean };
      return a.p_dry_run
        ? { outcome: "would_restore", applied_cents: 4000 }
        : { outcome: "restored", restore_cents: Math.floor((4000 * a.p_share_bps) / 10000) };
    };
  }

  // @mutate supabase/functions/process-scheduled-payouts/index.ts | if (a.isPifFunded && a.cardLegTestMode) return { ok: false }; |
  // @mutate supabase/functions/process-scheduled-payouts/index.ts | cardLegTestMode = true;\n            } else { | \n            } else {
  it("Q891: a partial-gift crew whose charge is a TEST-mode PaymentIntent: no card refund, no defect (200), no page, not released, one structured log line", async () => {
    const skips = captureTestModeSkips();
    try {
      seedPartialGiftCrew();
      stripeMock.paymentIntents.retrieve.mockRejectedValue(testModeUnderLiveKey("payment_intent", "pi_1"));
      const res = await run();
      expect(res.status).toBe(200);
      const body = JSON.parse(await res.text()) as Record<string, unknown>;
      expect(body.defects).toBe(0);
      expect(body.defectReasons).toBeUndefined();
      expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledWith("pi_1");
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(scenario.writes.some((w) => w.table === "payment_refunds")).toBe(false);
      expect(scenario.writes.some((w) => w.table === "payout_transfers")).toBe(false);
      expect(scenario.writes.some((w) => w.table === "jobs" && (w.payload as Record<string, unknown>).payment_status === "released")).toBe(false);
      expect(new Set((slackAlerts as Array<{ title?: string }>).map((a) => a.title))).toEqual(new Set(["Real job stuck on a Stripe test-mode object"])); // Q1220: a real job pages (once a day per job; oncePerDayKey dedupes the per-member repeats)
      // One line per ask: each member's pass re-asks whether the crew may
      // release (the refund is read from the ledger), so it may log per member.
      const lines = skips.lines();
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line).toMatchObject({ fn: "process-scheduled-payouts", object: "payment_intent", id: "pi_1", job_id: "job-crew" });
      }
    } finally {
      skips.restore();
    }
  });

  // @mutate supabase/functions/process-scheduled-payouts/index.ts | cardLegTestMode = true;\n            } else if (isPifFunded) { | \n            } else if (isPifFunded) {
  it("Q1210 + Q891: a partial-gift crew whose shortfall SESSION is a test-mode object: no card refund, no page, not released", async () => {
    const skips = captureTestModeSkips();
    try {
      seedPartialGiftCrew();
      setJob({ stripe_payment_intent_id: null, stripe_session_id: "cs_test_old" });
      stripeMock.checkout.sessions.retrieve.mockRejectedValue(testModeUnderLiveKey("checkout.session", "cs_test_old"));
      const res = await run();
      expect(res.status).toBe(200);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(scenario.writes.some((w) => w.table === "jobs" && (w.payload as Record<string, unknown>).payment_status === "released")).toBe(false);
      expect(new Set((slackAlerts as Array<{ title?: string }>).map((a) => a.title))).toEqual(new Set(["Real job stuck on a Stripe test-mode object"])); // Q1220: a real job pages (once a day per job; oncePerDayKey dedupes the per-member repeats)
      expect(skips.lines().length).toBeGreaterThan(0);
    } finally {
      skips.restore();
    }
  });

  it("Q891 control: any OTHER error on that crew PI read still fails closed (500, a defect, no refund, no log line)", async () => {
    const skips = captureTestModeSkips();
    try {
      seedPartialGiftCrew();
      stripeMock.paymentIntents.retrieve.mockRejectedValue(
        Object.assign(new Error("Stripe is down"), { type: "StripeAPIError", statusCode: 503 }),
      );
      const res = await run();
      expect(res.status).toBe(500);
      const body = JSON.parse(await res.text()) as Record<string, unknown>;
      // Since Q1210 the main loop reads a mixed (gift + card) job's charge too,
      // so the fault now surfaces at that first read, before the crew refund.
      expect((body.defectReasons as string[]).some((r) => /payment verify job-crew/.test(r))).toBe(true);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(skips.lines()).toEqual([]);
    } finally {
      skips.restore();
    }
  });
});
