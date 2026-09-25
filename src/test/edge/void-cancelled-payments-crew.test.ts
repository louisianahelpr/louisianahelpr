/**
 * A crew has no lead (docs/OPEN.md Q407): a late poster cancellation of a group
 * job pays EVERY hired member their own share of the fee, one Stripe transfer
 * each, from the server-owned crew_cancellation_fee_shares ledger that
 * poster_cancel_job writes (20260925154606). Before, the whole fee went to
 * jobs.helper_id, the crew's "lead", and the other members got nothing.
 *
 * Money-path properties proved here, on the REAL function source:
 *   - one transfer per member, each with its own idempotency key;
 *   - a share already marked paid is never paid again;
 *   - a member Stripe already shows a fee transfer for is never paid again (the
 *     ledger is repaired instead);
 *   - a share that does not match its recomputation moves NO money (F-MONEY-32);
 *   - an unreadable ledger moves no money.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";

const CRON_SECRET = "cron-secret-void-crew";

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

const MEMBERS = ["member-a", "member-b", "member-c"];

/**
 * $300 crew of 3, cancelled 1 hour before a 10:00 Central start: the 50% tier,
 * so each confirmed member's share is $300 * 50% / 3 = $50.00.
 */
function seedCancelledCrew(shares: Array<Record<string, unknown>> = MEMBERS.map((m, i) => ({
  id: `share-${i + 1}`, helper_id: m, committed: true, share_basis_cents: 10000, share_amount: "50.00", status: "pending", stripe_transfer_id: null,
}))) {
  scenario.reads.jobs = {
    selectOverrides: [
      {
        includes: "cancellation_fee",
        result: {
          rows: [{
            id: "job-crew",
            title: "Move a piano",
            stripe_session_id: null,
            stripe_payment_intent_id: "pi_crew",
            budget: 300,
            customer_fee_amount: 30,
            cancellation_fee: 150,
            date_needed: "2024-06-25",
            start_time: "10:00:00",
            cancelled_at: "2024-06-25T14:00:00Z",
            helper_id: null,
            helper_confirmed_at: null,
            customer_id: "poster-1",
            helper_fee_percent: 10,
            is_group_job: true,
            helpers_needed: 3,
          }],
        },
      },
    ],
    rows: [],
  };
  scenario.reads.crew_cancellation_fee_shares = { rows: shares };
  scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_member", subscription_tier: null }] };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_crew", status: "succeeded", amount: 33000, amount_received: 33000, latest_charge: "ch_crew",
  });
  stripeMock.refunds.create.mockResolvedValue({ id: "re_crew", amount: 15000 });
  stripeMock.transfers.create.mockImplementation(async (params: { metadata: { helper_id: string } }) => ({
    id: `tr_${params.metadata.helper_id}`,
  }));
}

const feeTransfers = () =>
  stripeMock.transfers.create.mock.calls.map(([params, opts]) => ({
    helper: (params as { metadata: { helper_id: string } }).metadata.helper_id,
    cents: (params as { amount: number }).amount,
    key: (opts as { idempotencyKey: string }).idempotencyKey,
  }));
const ledgerFlips = () =>
  scenario.writes
    .filter((w) => w.table === "crew_cancellation_fee_shares" && w.op === "update")
    .map((w) => w.payload as Record<string, unknown>);

describe("void-cancelled-payments — a crew's cancellation fee is split, one transfer per member", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | crewShares ? payCrewCancellationFees(job, crewShares, pi) : payHelperCancellationFee(job, fee, pi) | payHelperCancellationFee(job, fee, pi)
  // @mutate supabase/functions/void-cancelled-payments/index.ts | (!e.code && /relation "[^"]*crew_cancellation_fee_shares[^"]*" does not exist | /does not exist/i.test(e.message ?? "") \|\| (!e.code && /relation "[^"]*crew_cancellation_fee_shares[^"]*" does not exist
  it("pays every member their own $50.00 share (minus commission) with its own idempotency key, and marks each paid", async () => {
    seedCancelledCrew();
    // Commission is each member's LIVE tier (getHelperFeePercent), as on the
    // single path: no subscription is the free tier, 12%, so $50.00 -> $44.00.
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransfers()).toEqual(
      MEMBERS.map((m) => ({ helper: m, cents: 4400, key: `cancel-fee-job-crew-${m}` })),
    );
    expect(ledgerFlips().map((p) => [p.status, p.stripe_transfer_id])).toEqual(
      MEMBERS.map((m) => ["paid", `tr_${m}`]),
    );
    // The poster keeps getting everything but the $150 fee and the service fee.
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_crew", amount: 33000 - 15000 - 3000 },
      { idempotencyKey: "cancel-refund-job-crew" },
    );
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | const owed = shares.filter((s) => Number(s.share_amount ?? 0) > 0 && s.status !== "paid"); | const owed = shares.filter((s) => Number(s.share_amount ?? 0) > 0);
  it("never pays a share the ledger already marks paid", async () => {
    seedCancelledCrew(MEMBERS.map((m, i) => ({
      id: `share-${i + 1}`, helper_id: m, committed: true, share_basis_cents: 10000, share_amount: "50.00",
      status: i === 0 ? "paid" : "pending", stripe_transfer_id: i === 0 ? "tr_earlier" : null,
    })));
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransfers().map((t) => t.helper)).toEqual(["member-b", "member-c"]);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | const existing = priorByHelper.get(share.helper_id); | const existing = undefined;
  it("never pays a member Stripe already shows a fee transfer for; repairs the ledger instead", async () => {
    seedCancelledCrew();
    stripeMock.transfers.list.mockResolvedValue({
      data: [{ id: "tr_seen", amount: 4500, amount_reversed: 0, reversed: false, metadata: { job_id: "job-crew", helper_id: "member-a", type: "cancellation_fee" } }],
    });
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransfers().map((t) => t.helper)).toEqual(["member-b", "member-c"]);
    expect(ledgerFlips()[0]).toEqual(expect.objectContaining({ status: "paid", stripe_transfer_id: "tr_seen" }));
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | if (priced.mismatch) { | if (false) {
  it("a share that does not match its recomputation moves NO money and pages critical", async () => {
    seedCancelledCrew(MEMBERS.map((m, i) => ({
      id: `share-${i + 1}`, helper_id: m, committed: true, share_basis_cents: 10000, share_amount: i === 2 ? "99.00" : "50.00", status: "pending", stripe_transfer_id: null,
    })));
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(scenario.writes.filter((w) => w.table === "jobs")).toHaveLength(0);
    expect((slackAlerts as Array<{ title?: string; severity?: string }>).some(
      (a) => a.title === "Crew cancellation-fee share does not match its price" && a.severity === "critical",
    )).toBe(true);
  });

  it("a member recorded as not committed (the owner rule flipped) gets a $0 share, not paid; the rest still are", async () => {
    seedCancelledCrew(MEMBERS.map((m, i) => ({
      id: `share-${i + 1}`, helper_id: m, committed: i !== 2, share_basis_cents: 10000, share_amount: i === 2 ? "0.00" : "50.00", status: "pending", stripe_transfer_id: null,
    })));
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransfers().map((t) => t.helper)).toEqual(["member-a", "member-b"]);
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_crew", amount: 33000 - 10000 - 3000 },
      { idempotencyKey: "cancel-refund-job-crew" },
    );
  });

  // @mutate supabase/functions/_shared/crewShares.ts | if (basisTotal > budgetCents) { | if (false) {
  it("shares whose frozen bases add up to more than the budget move NO money", async () => {
    seedCancelledCrew(MEMBERS.map((m, i) => ({
      id: `share-${i + 1}`, helper_id: m, committed: true, share_basis_cents: 20000, share_amount: "100.00", status: "pending", stripe_transfer_id: null,
    })));
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | if (job.is_group_job && !job.helper_id) { | if (job.is_group_job) {
  it("a crew cancelled before the no-lead migration (lead in helper_id, no ledger) settles on the single path, as deployed", async () => {
    seedCancelledCrew([]);
    const jobs = scenario.reads.jobs as { selectOverrides: Array<{ result: { rows: Array<Record<string, unknown>> } }> };
    Object.assign(jobs.selectOverrides[0].result.rows[0], { helper_id: "old-lead", helper_confirmed_at: "2024-06-24T12:00:00Z", budget: 300 });
    const h = await load();
    await h.fetch(cronReq());
    // 50% of $300 to the lead, one transfer with the single path's key.
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.transfers.create.mock.calls[0][1]).toEqual({ idempotencyKey: "cancel-fee-job-crew" });
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | .in("status", ["pending", "failed"]) | .in("status", ["pending"])
  it("Part D retries a FAILED share on a crew job that already settled, without paging again", async () => {
    scenario.reads.jobs = {
      selectOverrides: [
        { includes: "cancellation_fee,", result: { rows: [] } },
        { includes: "cancellation_fee_status", result: { rows: [{ id: "job-crew", title: "Move a piano", helper_fee_percent: 10, payment_status: "refunded", cancellation_fee_status: "charged", stripe_payment_intent_id: "pi_crew" }] } },
      ],
      rows: [],
    };
    scenario.reads.crew_cancellation_fee_shares = {
      rows: [{ id: "share-2", job_id: "job-crew", helper_id: "member-b", committed: true, share_basis_cents: 10000, share_amount: "50.00", status: "failed", stripe_transfer_id: null }],
    };
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_member", subscription_tier: null }] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_crew", status: "succeeded", latest_charge: "ch_crew" });
    stripeMock.transfers.create.mockImplementation(async (params: { metadata: { helper_id: string } }) => ({ id: `tr_${params.metadata.helper_id}` }));
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransfers()).toEqual([{ helper: "member-b", cents: 4400, key: "cancel-fee-job-crew-member-b" }]);
    expect(ledgerFlips()[0]).toEqual(expect.objectContaining({ status: "paid", stripe_transfer_id: "tr_member-b" }));
    // The sweep asks for FAILED shares as well as pending ones.
    const sweep = (scenario.readQueries ?? []).find(
      (q) => q.table === "crew_cancellation_fee_shares" && q.filters.some((f) => f.column === "status"),
    );
    expect(sweep?.filters.find((f) => f.column === "status")?.value).toEqual(["pending", "failed"]);
    expect(slackAlerts).toHaveLength(0);
  });

  it("Part D pays nothing on a crew job with a decided, unexecuted dispute (Q231)", async () => {
    scenario.reads.jobs = {
      selectOverrides: [
        { includes: "cancellation_fee,", result: { rows: [] } },
        { includes: "cancellation_fee_status", result: { rows: [{ id: "job-crew", title: "Move a piano", helper_fee_percent: 10, payment_status: "refunded", cancellation_fee_status: "charged", stripe_payment_intent_id: "pi_crew" }] } },
      ],
      rows: [],
    };
    scenario.reads.crew_cancellation_fee_shares = {
      rows: [{ id: "share-2", job_id: "job-crew", helper_id: "member-b", committed: true, share_basis_cents: 10000, share_amount: "50.00", status: "failed", stripe_transfer_id: null }],
    };
    scenario.reads.disputes = { rows: [{ id: "dispute-1", execution_status: "pending", payout_split: { poster: 1, helper: 0 } }] };
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("fails CLOSED on a COLUMN error on an existing ledger (42703 is not 'table missing')", async () => {
    // Money review of daf5f8870: `column ... does not exist` matched the old
    // message-regex for a missing table, read as "no shares", refunded the
    // poster in full and dropped the crew's committed fee with no page.
    seedCancelledCrew();
    scenario.reads.crew_cancellation_fee_shares = {
      error: { code: "42703", message: "column crew_cancellation_fee_shares.stripe_transfer_id does not exist" },
    };
    const h = await load();
    const res = await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
  });

  it("fails CLOSED when the crew ledger cannot be read: no refund, no transfer", async () => {
    seedCancelledCrew();
    scenario.reads.crew_cancellation_fee_shares = { error: { message: "ledger read blew up" } };
    const h = await load();
    const res = await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
  });
});
