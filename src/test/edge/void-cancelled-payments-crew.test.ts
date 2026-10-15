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
import { testModeUnderLiveKey, captureTestModeSkips } from "../helpers/testModeUnderLiveKey";

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

  // @mutate supabase/functions/void-cancelled-payments/index.ts | crewShares ? payCrewCancellationFees(job, crewShares, pi, stripe) : payHelperCancellationFee(job, fee, pi, singleFeePercent, stripe) | payHelperCancellationFee(job, fee, pi, singleFeePercent, stripe)
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

  // Q1358: a member whose tier read FAILS is skipped this run (Part D retries
  // the share), never paid at the fallback rate; the others are still paid.
  // @mutate supabase/functions/void-cancelled-payments/index.ts |         if (!shareFeeRead.ok) { |         if (false) {
  it("a failed tier read pays no member at the fallback rate this run (Q1358)", async () => {
    seedCancelledCrew();
    scenario.reads.profiles = {
      rows: [{ stripe_account_id: "acct_member", subscription_tier: null }],
      selectOverrides: [{ includes: "subscription_tier", result: { error: { message: "tier read boom" } } }],
    };
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransfers()).toEqual([]);
    expect(ledgerFlips()).toEqual([]);
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
    // The single path claims a cancellation_fee_transfers row first (LOW-2).
    scenario.writeSelectRows["cancellation_fee_transfers:insert"] = [{
      id: "fee-legacy", status: "pending", stripe_transfer_id: null, created_at: new Date().toISOString(),
      fee_amount: 150, commission_percent: 12, platform_cut: 18, helper_amount: 132,
    }];
    const h = await load();
    await h.fetch(cronReq());
    // 50% of $300 to the lead, one transfer with the single path's key.
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.transfers.create.mock.calls[0][1]).toEqual({ idempotencyKey: "cancel-fee-fee-legacy" });
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
    // A FAILED share's retry is salted with the hour (Q1381): a new attempt, not Stripe's replay of the failure.
    // @mutate supabase/functions/void-cancelled-payments/index.ts | feeTransferIdempotencyKey(`cancel-fee-${job.id}-${share.helper_id}`, share.status === "failed"), | `cancel-fee-${job.id}-${share.helper_id}`,
    expect(feeTransfers()).toEqual([{ helper: "member-b", cents: 4400, key: expect.stringMatching(/^cancel-fee-job-crew-member-b-h\d+$/) }]);
    expect(ledgerFlips()[0]).toEqual(expect.objectContaining({ status: "paid", stripe_transfer_id: "tr_member-b" }));
    // The sweep asks for FAILED shares as well as pending ones.
    const sweep = (scenario.readQueries ?? []).find(
      (q) => q.table === "crew_cancellation_fee_shares" && q.filters.some((f) => f.column === "status"),
    );
    expect(sweep?.filters.find((f) => f.column === "status")?.value).toEqual(["pending", "failed"]);
    expect(slackAlerts).toHaveLength(0);
  });

  // Q1381 review (lh-money-escrow, MEDIUM): a PENDING share whose transfer
  // times out may have been paid; it is not marked failed, so its next attempt
  // keeps the unsalted key and Stripe dedupes it.
  // @mutate supabase/functions/void-cancelled-payments/index.ts |           if (!isDefiniteStripeRefusal(transferErr)) {\n            // Q1381 review: the transfer may exist. The share keeps its status, |           if (false) {\n            // Q1381 review: the transfer may exist. The share keeps its status,
  it("a crew share whose transfer errors ambiguously stays pending (same key next time), never marked failed", async () => {
    scenario.reads.jobs = {
      selectOverrides: [
        { includes: "cancellation_fee,", result: { rows: [] } },
        { includes: "cancellation_fee_status", result: { rows: [{ id: "job-crew", title: "Move a piano", helper_fee_percent: 10, payment_status: "refunded", cancellation_fee_status: "charged", stripe_payment_intent_id: "pi_crew" }] } },
      ],
      rows: [],
    };
    scenario.reads.crew_cancellation_fee_shares = {
      rows: [{ id: "share-3", job_id: "job-crew", helper_id: "member-c", committed: true, share_basis_cents: 10000, share_amount: "50.00", status: "pending", stripe_transfer_id: null }],
    };
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_member", subscription_tier: null }] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_crew", status: "succeeded", latest_charge: "ch_crew" });
    stripeMock.transfers.create.mockRejectedValue(Object.assign(new Error("Request timed out"), { type: "StripeConnectionError" }));
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransfers()).toEqual([{ helper: "member-c", cents: 4400, key: "cancel-fee-job-crew-member-c" }]);
    expect(ledgerFlips().filter((p) => (p as Record<string, unknown>).status === "failed")).toHaveLength(0);
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
  // ── Q891: Part D's PaymentIntent is a TEST-mode object under the live key ──
  /** A settled crew job with one FAILED share still owed (the Part D shape above). */
  function seedPartDRetry() {
    scenario.reads.jobs = {
      selectOverrides: [
        { includes: "cancellation_fee,", result: { rows: [] } },
        { includes: "cancellation_fee_status", result: { rows: [{ id: "job-crew", title: "Move a piano", helper_fee_percent: 10, payment_status: "refunded", cancellation_fee_status: "charged", stripe_payment_intent_id: "pi_test_old" }] } },
      ],
      rows: [],
    };
    scenario.reads.crew_cancellation_fee_shares = {
      rows: [{ id: "share-2", job_id: "job-crew", helper_id: "member-b", committed: true, share_basis_cents: 10000, share_amount: "50.00", status: "failed", stripe_transfer_id: null }],
    };
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_member", subscription_tier: null }] };
    stripeMock.transfers.create.mockImplementation(async (params: { metadata: { helper_id: string } }) => ({ id: `tr_${params.metadata.helper_id}` }));
  }

  // @mutate supabase/functions/void-cancelled-payments/index.ts | logTestObjectUnderLiveKey("void-cancelled-payments", { job_id: job.id, object: "payment_intent", id: job.stripe_payment_intent_id });\n            continue;\n          }\n          defects.record(`crew share retry | throw retryErr;\n          }\n          defects.record(`crew share retry
  it("Q891: Part D on a TEST-mode PaymentIntent pays no share, records no defect (200), pages nobody, writes one structured line", async () => {
    const skips = captureTestModeSkips();
    try {
      seedPartDRetry();
      stripeMock.paymentIntents.retrieve.mockRejectedValue(testModeUnderLiveKey("payment_intent", "pi_test_old"));
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = JSON.parse(await res.text()) as Record<string, unknown>;
      expect(res.status).toBe(200);
      expect(body.defects).toBe(0);
      expect(body.defectReasons).toBeUndefined();
      expect(body.crew_shares_retried).toBe(0);
      expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledWith("pi_test_old");
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(ledgerFlips()).toHaveLength(0);
      expect(scenario.writes.some((w) => w.table === "payout_transfers")).toBe(false);
      expect(slackAlerts).toHaveLength(0);
      expect(skips.lines()).toEqual([
        expect.objectContaining({ fn: "void-cancelled-payments", object: "payment_intent", id: "pi_test_old", job_id: "job-crew" }),
      ]);
    } finally {
      skips.restore();
    }
  });

  it("Q891 control: any OTHER Part D PaymentIntent error still fails closed (500, a defect, no transfer, no test-mode line)", async () => {
    const skips = captureTestModeSkips();
    try {
      seedPartDRetry();
      stripeMock.paymentIntents.retrieve.mockRejectedValue(
        Object.assign(new Error("Stripe is down"), { type: "StripeAPIError", statusCode: 503 }),
      );
      const h = await load();
      const res = await h.fetch(cronReq());
      const body = JSON.parse(await res.text()) as Record<string, unknown>;
      expect(res.status).toBe(500);
      expect((body.defectReasons as string[]).some((r) => r.startsWith("crew share retry job-crew"))).toBe(true);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(skips.lines()).toEqual([]);
    } finally {
      skips.restore();
    }
  });
});

/**
 * Q1390: a crew cancelled after a poster blocked a committed member close to
 * the start still owes that member the block fee (crew_block_fees). It is tried
 * before the poster's refund and always withheld from it; one that cannot go now
 * never holds the refund up (lh-money-escrow review) and Part F pays it once
 * the job has settled.
 */
describe("void-cancelled-payments — a cancelled crew's block fee is paid before the refund (Q1390)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });

  const seedWithBlockFee = () => {
    seedCancelledCrew();
    scenario.reads.crew_block_fees = {
      rows: [{ id: "bf-1", job_id: "job-crew", helper_id: "member-d", slot_no: 3, share_basis_cents: 10000, fee_percent: 25, fee_cents: 2500, status: "owed", stripe_transfer_id: null }],
    };
  };
  const blockTransfers = () =>
    stripeMock.transfers.create.mock.calls.filter(([p]) => (p as { metadata?: { type?: string } }).metadata?.type === "crew_block_fee");

  // @mutate supabase/functions/void-cancelled-payments/index.ts |             otherKeptCents: Math.round(cancellationFee * 100) + blockFeeCents, |             otherKeptCents: Math.round(cancellationFee * 100),
  // @mutate supabase/functions/void-cancelled-payments/index.ts |           await payBlockFees(pi);\n |           void payBlockFees;\n
  it("pays the block fee once and withholds it from the poster's refund", async () => {
    seedWithBlockFee();
    const h = await load();
    await h.fetch(cronReq());
    const fee = blockTransfers();
    expect(fee).toHaveLength(1);
    expect((fee[0][1] as { idempotencyKey: string }).idempotencyKey).toBe("crew-block-fee-bf-1");
    expect((fee[0][0] as { metadata: Record<string, unknown> }).metadata).toEqual(expect.objectContaining({ block_fee_id: "bf-1", helper_id: "member-d" }));
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_crew", amount: 33000 - 15000 - 2500 - 3000 },
      { idempotencyKey: "cancel-refund-job-crew" },
    );
  });

  it("a block fee that cannot be paid now never holds up the poster: still withheld, the rest refunded, the row failed for Part F", async () => {
    seedWithBlockFee();
    stripeMock.transfers.create.mockImplementation(async (params: { metadata: { helper_id: string; type?: string } }) => {
      if (params.metadata.type === "crew_block_fee") throw Object.assign(new Error("account restricted"), { type: "StripeInvalidRequestError" });
      return { id: `tr_${params.metadata.helper_id}` };
    });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_crew", amount: 33000 - 15000 - 2500 - 3000 },
      { idempotencyKey: "cancel-refund-job-crew" },
    );
    expect(scenario.writes.some((w) => w.table === "crew_block_fees" && (w.payload as Record<string, unknown>).status === "failed")).toBe(true);
  });

  // Q1381 review (lh-money-escrow, MEDIUM): Part A's first attempt times out
  // (Stripe may have made the transfer); Part F re-reads the row later in the
  // SAME run. It must retry under the SAME key so Stripe dedupes it, never a
  // salted one that would be a second transfer.
  // @mutate supabase/functions/_shared/crewBlockFees.ts |       if (!isDefiniteStripeRefusal(e)) { |       if (false) {
  it("an ambiguous block-fee transfer error is retried in the same run under the same key, never a new one", async () => {
    seedWithBlockFee();
    stripeMock.transfers.create.mockImplementation(async (params: { metadata: { helper_id: string; type?: string } }) => {
      if (params.metadata.type === "crew_block_fee") throw Object.assign(new Error("Request timed out"), { type: "StripeConnectionError" });
      return { id: `tr_${params.metadata.helper_id}` };
    });
    const h = await load();
    await h.fetch(cronReq());
    expect(scenario.writes.some((w) => w.table === "crew_block_fees" && (w.payload as Record<string, unknown>).status === "failed")).toBe(false);
    const keys = new Set(
      stripeMock.transfers.create.mock.calls
        .filter((call) => (call[0] as { metadata?: { type?: string } }).metadata?.type === "crew_block_fee")
        .map((call) => (call[1] as { idempotencyKey: string }).idempotencyKey),
    );
    expect([...keys]).toEqual(["crew-block-fee-bf-1"]);
  });

  // HIGH (lh-money-escrow review): a block fee already out is this loop's own
  // transfer, never "the escrow was already paid to a Helpr".
  // @mutate supabase/functions/void-cancelled-payments/index.ts |  && t.metadata?.type !== "crew_block_fee"); | );
  it("a block-fee transfer already in the job's transfer group does not stop the refund", async () => {
    seedWithBlockFee();
    (scenario.reads.crew_block_fees as { rows: Array<Record<string, unknown>> }).rows[0].status = "paid";
    (scenario.reads.crew_block_fees as { rows: Array<Record<string, unknown>> }).rows[0].stripe_transfer_id = "tr_bf";
    stripeMock.transfers.list.mockResolvedValue({ data: [{ id: "tr_bf", amount: 2200, amount_reversed: 0, reversed: false, metadata: { job_id: "job-crew", helper_id: "member-d", type: "crew_block_fee", block_fee_id: "bf-1" } }] });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_crew", amount: 33000 - 15000 - 2500 - 3000 },
      { idempotencyKey: "cancel-refund-job-crew" },
    );
    expect((slackAlerts as Array<{ title?: string }>).some((a) => /NOT refunded/.test(a.title ?? ""))).toBe(false);
  });

  // Part F: a fee still owed on a settled job is paid by the sweep, once.
  // @mutate supabase/functions/void-cancelled-payments/index.ts | const paid = await payCrewBlockFees({ stripe, admin: supabaseAdmin, fn: "void-cancelled-payments", settled: true }, fj, byJob.get(fj.id) ?? [], chargeId); | const paid = { problems: [] as string[] };
  it("Part F pays a block fee still owed on a settled job, keyed on its row", async () => {
    scenario.reads.jobs = {
      rows: [],
      selectOverrides: [{
        includes: "helper_fee_percent, payment_status, stripe_payment_intent_id",
        result: { rows: [{ id: "job-done", title: "Move a piano", helper_fee_percent: 10, payment_status: "refunded", stripe_payment_intent_id: "pi_done" }] },
      }],
    };
    scenario.reads.crew_block_fees = {
      rows: [{ id: "bf-9", job_id: "job-done", helper_id: "member-d", slot_no: 1, share_basis_cents: 10000, fee_percent: 25, fee_cents: 2500, status: "failed", stripe_transfer_id: null }],
    };
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_member", subscription_tier: null }] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_done", status: "succeeded", latest_charge: "ch_done" });
    stripeMock.transfers.create.mockImplementation(async (params: { metadata: { helper_id: string } }) => ({ id: `tr_${params.metadata.helper_id}` }));
    const h = await load();
    await h.fetch(cronReq());
    const fee = blockTransfers();
    expect(fee).toHaveLength(1);
    // A FAILED row's retry: keyed on its row, salted with the hour (Q1381).
    expect((fee[0][1] as { idempotencyKey: string }).idempotencyKey).toMatch(/^crew-block-fee-bf-9-h\d+$/);
    expect((fee[0][0] as Record<string, unknown>).source_transaction).toBe("ch_done");
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  // Round 2 nit 1: a fully refunded charge (an admin full refund) cannot fund
  // a source_transaction; the platform balance pays rather than failing hourly.
  // @mutate supabase/functions/void-cancelled-payments/index.ts |                 else if (ch && Number(ch.amount_refunded ?? 0) < Number(ch.amount ?? 0)) chargeId = ch.id; |                 else if (ch) chargeId = ch.id;
  it("Part F never links a fully refunded charge to the fee transfer", async () => {
    scenario.reads.jobs = {
      rows: [],
      selectOverrides: [{
        includes: "helper_fee_percent, payment_status, stripe_payment_intent_id",
        result: { rows: [{ id: "job-done", title: "Move a piano", helper_fee_percent: 10, payment_status: "refunded", stripe_payment_intent_id: "pi_done" }] },
      }],
    };
    scenario.reads.crew_block_fees = {
      rows: [{ id: "bf-9", job_id: "job-done", helper_id: "member-d", slot_no: 1, share_basis_cents: 10000, fee_percent: 25, fee_cents: 2500, status: "failed", stripe_transfer_id: null }],
    };
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_member", subscription_tier: null }] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_done", status: "succeeded", latest_charge: { id: "ch_done", amount: 33000, amount_refunded: 33000 } });
    stripeMock.transfers.create.mockImplementation(async (params: { metadata: { helper_id: string } }) => ({ id: `tr_${params.metadata.helper_id}` }));
    const h = await load();
    await h.fetch(cronReq());
    const fee = blockTransfers();
    expect(fee).toHaveLength(1);
    expect((fee[0][0] as Record<string, unknown>).source_transaction).toBeUndefined();
  });

  it("an unreadable block-fee ledger moves no money for the job", async () => {
    seedWithBlockFee();
    scenario.reads.crew_block_fees = { error: { message: "boom" } } as never;
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });
});

/**
 * Q1490 (lh-money-escrow review of Q1390): a FULLY gift-funded crew has no
 * PaymentIntent, so it settles on the "no payment found" branch. The whole
 * gift used to come back to the poster while Part F paid the blocked member's
 * fee from the platform's balance. The gift now keeps the block fee: the
 * restore is sized (from a dry run of what the gift paid) to the gift less the
 * fee, by the largest share that does not overshoot.
 */
describe("void-cancelled-payments: a fully gift-funded crew's block fee is kept from the gift (Q1490)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });

  const seedGiftCrew = (blockRows: Array<Record<string, unknown>>) => {
    // Uncommitted members owe no late-cancel fee, so these cases test the
    // block fee alone (Q1806's gift-funded crew FEE is proved in
    // void-cancelled-payments-gift-fee.test.ts).
    seedCancelledCrew(MEMBERS.map((m, i) => ({
      id: `share-${i + 1}`, helper_id: m, committed: false, share_basis_cents: 10000, share_amount: "0.00", status: "pending", stripe_transfer_id: null,
    })));
    const jobs = scenario.reads.jobs as { selectOverrides: Array<{ result: { rows: Array<Record<string, unknown>> } }> };
    jobs.selectOverrides[0].result.rows[0].stripe_payment_intent_id = null;
    // Copies: the fee payer marks its rows in place (paid, void).
    scenario.reads.crew_block_fees = { rows: blockRows.map((r) => ({ ...r })) };
    scenario.rpc.restore_gift_card_for_job = (args?: unknown) => {
      const a = (args ?? {}) as { p_dry_run?: boolean; p_share_bps?: number };
      if (a.p_dry_run) return { outcome: "would_restore", credit_id: "gift-1", applied_cents: 30000, restore_cents: 30000 };
      const bps = a.p_share_bps ?? 10000;
      return { outcome: "restored", credit_id: "gift-2", recipient_id: "poster-1", applied_cents: 30000, restore_cents: Math.floor((30000 * bps) / 10000) };
    };
  };
  const restoreCalls = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "restore_gift_card_for_job").map((c) => c.args as Record<string, unknown>);
  const BLOCK = { id: "bf-1", job_id: "job-crew", helper_id: "member-d", slot_no: 3, share_basis_cents: 10000, fee_percent: 25, fee_cents: 2500, status: "owed", stripe_transfer_id: null };

  // @mutate supabase/functions/void-cancelled-payments/index.ts |           giftFeeCents + giftBlockCents, |           giftFeeCents,
  // @mutate supabase/functions/void-cancelled-payments/index.ts |           const target = Math.max(0, applied - withholdCents); |           const target = applied;
  it("restores the gift less the block fee, never a cent of the fee", async () => {
    seedGiftCrew([BLOCK]);
    const h = await load();
    await h.fetch(cronReq());
    const calls = restoreCalls();
    expect(calls[0]).toEqual({ p_job_id: "job-crew", p_dry_run: true });
    const mint = calls.find((c) => !c.p_dry_run)!;
    const restored = Math.floor((30000 * Number(mint.p_share_bps)) / 10000);
    expect(restored).toBeLessThanOrEqual(30000 - 2500);
    expect(restored).toBeGreaterThan(30000 - 2500 - 5);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(scenario.writes.some((w) => w.table === "jobs" && (w.payload as Record<string, unknown>).payment_status === "cancelled")).toBe(true);
  });

  // Review #7: the fees are tried first, as the card paths do, from the
  // platform balance (no charge to link); review #6: the gift notice says
  // what the gift kept.
  // @mutate supabase/functions/void-cancelled-payments/index.ts |           const paidFirst = await payCrewBlockFees({ stripe, admin: supabaseAdmin, fn: "void-cancelled-payments" }, job, blockFeeRows, null); |           const paidFirst = { problems: [] as string[] };
  // @mutate supabase/functions/void-cancelled-payments/index.ts |                 ? ` $${formatExactDollars(Math.min(withholdCents, keptForBlockFees) / 100)} of it paid ${withholdReason}.` |                 ? ""
  it("pays the block fee first from the platform balance, and the gift notice names what it kept", async () => {
    seedGiftCrew([BLOCK]);
    const h = await load();
    await h.fetch(cronReq());
    const fee = stripeMock.transfers.create.mock.calls.filter(([p]) => (p as { metadata?: { type?: string } }).metadata?.type === "crew_block_fee");
    expect(fee).toHaveLength(1);
    expect((fee[0][0] as Record<string, unknown>).source_transaction).toBeUndefined();
    const note = scenario.writes.find((w) => w.table === "notifications" && (w.payload as Record<string, unknown>).title === "Your gift is back");
    expect(String((note?.payload as Record<string, unknown>)?.message)).toMatch(/\$25 of it paid the cancellation fee for the crew spots you closed\./);
  });

  it("a member whose account is gone is voided first, so the whole gift comes back", async () => {
    seedGiftCrew([{ ...BLOCK, helper_id: null }]);
    const h = await load();
    await h.fetch(cronReq());
    expect(scenario.writes.some((w) => w.table === "crew_block_fees" && (w.payload as Record<string, unknown>).status === "void")).toBe(true);
    expect(restoreCalls()).toEqual([{ p_job_id: "job-crew" }]);
  });

  it("a void block fee (member gone) is not kept: the whole gift comes back, no dry run", async () => {
    seedGiftCrew([{ ...BLOCK, status: "void" }]);
    const h = await load();
    await h.fetch(cronReq());
    expect(restoreCalls()).toEqual([{ p_job_id: "job-crew" }]);
  });

  it("a crew with no block fee restores the gift exactly as before", async () => {
    seedGiftCrew([]);
    const h = await load();
    await h.fetch(cronReq());
    expect(restoreCalls()).toEqual([{ p_job_id: "job-crew" }]);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts |         if (dryErr) { |         if (false) {
  it("a dry run that fails leaves the job in escrow for the next run (fails closed)", async () => {
    seedGiftCrew([BLOCK]);
    scenario.rpcErrors = { restore_gift_card_for_job: { message: "boom" } };
    const h = await load();
    await h.fetch(cronReq());
    expect(scenario.writes.some((w) => w.table === "jobs" && (w.payload as Record<string, unknown>).payment_status === "cancelled")).toBe(false);
    // Never falls through to restoring the WHOLE gift.
    expect(restoreCalls().filter((c) => !c.p_dry_run)).toEqual([]);
  });
});

