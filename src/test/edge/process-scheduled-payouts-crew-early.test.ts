/**
 * JOBS-3 (owner 2026-10-31 ~9:35 PM): crew members are paid individually once
 * the poster confirms they worked; a no-show member gets nothing + a strike;
 * the others are never held up.
 *
 * The poster confirms ONE member (rpc_poster_approve_member, 20261101044659)
 * and crew_members_due_early_payout() lists that member 3 days later. This
 * runs the REAL process-scheduled-payouts source through the edge harness:
 *   E1 an early pass pays exactly that member, from their frozen share, on a
 *      crew still under way (payment held as 'escrow'), and NEVER refunds,
 *      closes a decision or releases the job;
 *   E2 the normal pass later (the crew done and approved; the no-show's spot
 *      closed): the early-paid member is NOT paid again, the other member is
 *      paid once, the closed spot's share is refunded once, the job released
 *      once ("all members paid closes the job");
 *   E3 an unreadable due list pays nobody early and is a defect; a list not
 *      deployed yet (PGRST202) is simply no early pass.
 * The SQL side (who is due, the dispute rule) is proven in
 * src/test/pglite/crewMemberPaidOnApproval.pglite.mjs.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock, PAYABLE_CONNECT_ACCOUNT } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret-crew-early";

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
  const res = await fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
  return { status: res.status, body: await res.json().catch(() => null) };
};

/** A $100 crew of 3 (shares 3334 / 3333 / 3333). `inMainPass` = the job is completed and its payout due. */
function seedCrew(members: Array<[string, number, number]>, { inMainPass, paidCount = [] as string[] }: { inMainPass: boolean; paidCount?: string[] }) {
  const job = {
    id: "job-crew", title: "Move a piano", helper_id: null, customer_id: "poster-1",
    budget: 100, platform_fee_amount: 10, helper_fee_percent: 10, urgent_fee: 0,
    stripe_session_id: "cs_1", stripe_payment_intent_id: "pi_1",
    status: inMainPass ? "completed" : "in_progress",
    payment_status: inMainPass ? "payout_pending" : "escrow",
    is_group_job: true, helpers_needed: 3, sales_tax_rate: 0,
  };
  // The normal pass's query filters status = completed; the early pass's does
  // not (it reads by id). A job under way is in the early read only.
  scenario.reads.jobs = {
    rows: [job],
    eqOverrides: inMainPass ? [] : [{ column: "status", value: "completed", result: { rows: [] } }],
  };
  scenario.reads.platform_settings = { rows: [{ onboarding_fee_cents: 200 }] };
  scenario.reads.profiles = {
    rows: [{ stripe_account_id: "acct_member", onboarding_fee_paid: true, subscription_tier: "pro", subscription_expires_at: null }],
  };
  scenario.reads.group_job_helpers = {
    rows: members.map(([helper_id, slot_no, share_cents]) => ({ helper_id, slot_no, share_cents })),
  };
  scenario.reads.payout_transfers = {
    rows: [],
    selectOverrides: [{
      includes: "helper_id, amount_cents",
      result: { rows: paidCount.map((helper_id) => ({ helper_id, amount_cents: 3000 })) },
    }],
  };
  scenario.reads.payment_refunds = { rows: [] };
  scenario.reads.user_roles = { rows: [] };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_1", status: "succeeded", latest_charge: "ch_1", amount: 11200, amount_received: 11200,
  });
  stripeMock.transfers.create.mockImplementation(async (params: { destination: string; metadata?: Record<string, string> }) => ({
    id: `tr_${params.metadata?.helper_id ?? params.destination}`,
  }));
  stripeMock.refunds.create.mockResolvedValue({ id: "re_unfilled", amount: 3333, currency: "usd" });
}

const released = () =>
  scenario.writes.some((w) => w.table === "jobs" && (w.payload as Record<string, unknown>).payment_status === "released");
const claimsFor = () =>
  scenario.writes
    .filter((w) => w.table === "payout_transfers" && w.op === "insert")
    .map((w) => (w.payload as Record<string, unknown>).helper_id);

describe("process-scheduled-payouts: a crew member the poster confirmed is paid on their own (JOBS-3)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    stripeMock.accounts.retrieve.mockResolvedValue(PAYABLE_CONNECT_ACCOUNT);
    resetSharedMocks();
  });

  // @mutate supabase/functions/process-scheduled-payouts/index.ts |           if (earlyMembers && !earlyMembers.has(helperId)) continue; |           if (false) continue;
  // @mutate supabase/functions/process-scheduled-payouts/index.ts |         if (job.is_group_job && early) { |         if (false) {
  it("E1 an early pass pays only the approved member, on a crew still under way, and never refunds or releases", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333], ["m3", 2, 3333]], { inMainPass: false, paidCount: ["m1", "m2", "m3"] });
    scenario.rpc.crew_members_due_early_payout = [{ job_id: "job-crew", helper_id: "m1" }];
    await run();
    expect(claimsFor()).toEqual(["m1"]);
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    const gross = scenario.writes
      .filter((w) => w.table === "payout_transfers" && w.op === "update" && (w.payload as Record<string, unknown>).stripe_transfer_id)
      .map((w) => Number((w.payload as Record<string, unknown>).amount_cents) + Number((w.payload as Record<string, unknown>).platform_fee_cents));
    expect(gross).toHaveLength(1);
    expect(3334 - gross[0]).toBeGreaterThanOrEqual(0);
    expect(3334 - gross[0]).toBeLessThan(100);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(released()).toBe(false);
    expect((scenario.rpcCalls ?? []).some((c) => c.name === "mark_crew_dispute_executed")).toBe(false);
    expect(scenario.writes.some((w) => w.table === "payment_refunds")).toBe(false);
  });

  // @mutate supabase/functions/process-scheduled-payouts/index.ts |         expectPaymentStatus: early ? String(job.payment_status) : "payout_pending", |         expectPaymentStatus: "payout_pending",
  it("E1b the claim re-reads the job expecting its held state ('escrow'), so the early transfer is not refused as 'moved'", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333]], { inMainPass: false });
    scenario.rpc.crew_members_due_early_payout = [{ job_id: "job-crew", helper_id: "m1" }];
    await run();
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
  });

  // @mutate supabase/functions/process-scheduled-payouts/index.ts |        if (!r.job_id \|\| !r.helper_id \|\| mainJobIds.has(r.job_id)) continue; |        if (!r.job_id \|\| !r.helper_id) continue;
  it("E2 the normal pass later: the early-paid member is not paid again, the other is paid once, the no-show's closed spot refunded once, the job released once", async () => {
    // m3 was reported as a no-show: their spot closed (off the roster). m1 was
    // paid early. The crew is done and approved: the normal pass runs.
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333]], { inMainPass: true, paidCount: ["m1", "m2"] });
    (scenario.reads.payout_transfers as { eqOverrides?: unknown[] }).eqOverrides = [
      { column: "helper_id", value: "m1", result: { rows: [{ id: "pt-m1", stripe_transfer_id: "tr_m1", status: "paid", created_at: "2026-11-01T00:00:00Z" }] } },
    ];
    // A stale due list naming m1 for a job the normal pass owns is ignored.
    scenario.rpc.crew_members_due_early_payout = [{ job_id: "job-crew", helper_id: "m1" }];
    await run();
    expect(claimsFor()).toEqual(["m2"]);
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_1", amount: 3333 },
      { idempotencyKey: "crew-unfilled-refund-job-crew" },
    );
    expect(scenario.writes.filter((w) => w.table === "jobs" && (w.payload as Record<string, unknown>).payment_status === "released")).toHaveLength(1);
  });

  // lh-money-escrow review 11-01: a crashed or failed early run leaves an ORPHANED claim (pending, no transfer id).
  // The due list keeps listing the member (crewMemberPaidOnApproval.pglite.mjs D5), and the claim code resumes it
  // on the SAME idempotency key: one transfer, no second claim row.
  // @mutate supabase/functions/process-scheduled-payouts/index.ts |           ? `scheduled-payout-${job.id}-${helperId}` |           ? `scheduled-payout-early-${job.id}-${helperId}`
  it("E4 an orphaned early claim is resumed on the next early run with the same key, never a second claim", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333]], { inMainPass: false });
    scenario.rpc.crew_members_due_early_payout = [{ job_id: "job-crew", helper_id: "m1" }];
    (scenario.reads.payout_transfers as { eqOverrides?: unknown[] }).eqOverrides = [
      { column: "helper_id", value: "m1", result: { rows: [{ id: "led-orphan", helper_id: "m1", stripe_transfer_id: null, status: "pending", created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() }] } },
    ];
    await run();
    expect(claimsFor()).toEqual([]);
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.transfers.create.mock.calls[0][1]).toEqual({ idempotencyKey: "scheduled-payout-job-crew-m1" });
    expect(released()).toBe(false);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it("E5 never paid twice: a member whose transfer settled is skipped even if a stale due list names them", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333]], { inMainPass: false });
    scenario.rpc.crew_members_due_early_payout = [{ job_id: "job-crew", helper_id: "m1" }];
    (scenario.reads.payout_transfers as { eqOverrides?: unknown[] }).eqOverrides = [
      { column: "helper_id", value: "m1", result: { rows: [{ id: "led-orphan", helper_id: "m1", stripe_transfer_id: "tr_m1", status: "paid", created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() }] } },
    ];
    await run();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(claimsFor()).toEqual([]);
    expect(released()).toBe(false);
  });

  // @mutate supabase/functions/process-scheduled-payouts/index.ts |        defects.record(`early crew payout list: ${dueErr.message}`); |        void 0;
  it("E3 an unreadable due list pays nobody early and is a defect; a list not deployed yet is no early pass", async () => {
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333]], { inMainPass: false });
    scenario.rpcErrors = { crew_members_due_early_payout: { message: "boom", code: "57014" } };
    const bad = await run();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(JSON.stringify(bad.body)).toContain("early crew payout list: boom");

    resetSupabaseMock(); resetStripeMock(); stripeMock.accounts.retrieve.mockResolvedValue(PAYABLE_CONNECT_ACCOUNT); resetSharedMocks();
    seedCrew([["m1", 0, 3334], ["m2", 1, 3333]], { inMainPass: false });
    scenario.rpcErrors = { crew_members_due_early_payout: { message: "Could not find the function", code: "PGRST202" } };
    const missing = await run();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(JSON.stringify(missing.body)).not.toContain("early crew payout list");
  });
});
