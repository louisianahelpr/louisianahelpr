/**
 * LOW-2: a single Helpr's cancellation fee is money that leaves the platform,
 * so it has a ledger, cancellation_fee_transfers (20261002052502). Before, the
 * transfer went out with no row anywhere: reconciliation could not see it, a
 * failed transfer was never retried, and the idempotency key was the job id.
 *
 * Money-path properties proved here, on the REAL function source:
 *   - the row is CLAIMED (inserted 'pending') before any transfer is created;
 *   - the transfer is keyed to the row (`cancel-fee-<row id>`) and names it in
 *     metadata.fee_transfer_id, which the webhook settles by;
 *   - the row is marked 'paid' / 'failed' by compare-and-swap on the status
 *     this run read, and a zero-row mark that is not the webhook's own write
 *     pages instead of passing silently;
 *   - a row already paid, or claimed by a run still in flight, moves no money;
 *   - a transfer Stripe already shows repairs the row, never pays twice;
 *   - no claim means no transfer;
 *   - a 'failed' row on a settled job is retried (Part E);
 *   - nothing is ever written to payout_transfers.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";

const CRON_SECRET = "cron-secret-void-fee-ledger";

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

/** $300 single-Helpr job cancelled 1 hour before a 10:00 Central start. */
const cancelledJob = () => ({
  id: "job-1",
  title: "Mow the lawn",
  stripe_session_id: null,
  stripe_payment_intent_id: "pi_1",
  budget: 300,
  customer_fee_amount: 30,
  cancellation_fee: 150,
  date_needed: "2024-06-25",
  start_time: "10:00:00",
  cancelled_at: "2024-06-25T14:00:00Z",
  helper_id: "helper-1",
  helper_confirmed_at: "2024-06-20T00:00:00Z",
  customer_id: "poster-1",
  helper_fee_percent: 10,
  is_group_job: false,
  helpers_needed: 1,
  parent_job_id: null,
  recurrence_days: null,
});

const OLD = "2024-06-25T15:00:00Z";
const ledgerRow = (over: Record<string, unknown> = {}) => ({
  id: "fee-1",
  job_id: "job-1",
  helper_id: "helper-1",
  status: "pending",
  stripe_transfer_id: null,
  created_at: new Date().toISOString(),
  fee_amount: 150,
  commission_percent: 12,
  platform_cut: 18,
  helper_amount: 132,
  ...over,
});

/**
 * @param existing the row the function's own ledger read finds (null = none)
 * @param reread   what the zero-row re-read after a mark finds
 */
function seed({
  existing = null as Record<string, unknown> | null,
  reread = null as Record<string, unknown> | null,
  partA = true,
  retry = [] as Array<Record<string, unknown>>,
} = {}) {
  scenario.reads.jobs = {
    selectOverrides: [
      // Part A's sweep: the only jobs read that names cancelled_at.
      { includes: "cancelled_at", result: { rows: partA ? [cancelledJob()] : [] } },
      // Part E's settled-job read.
      {
        includes: "cancellation_fee_status",
        result: {
          rows: retry.length
            ? [{ id: "job-1", title: "Mow the lawn", helper_fee_percent: 10, payment_status: "refunded", cancellation_fee_status: "charged", stripe_payment_intent_id: "pi_1" }]
            : [],
        },
      },
    ],
    rows: [],
  };
  scenario.reads.cancellation_fee_transfers = {
    selectOverrides: [
      // Part E: owed rows.
      { includes: "job_id, helper_id, fee_amount", result: { rows: retry } },
      // payHelperCancellationFee's own read of the row.
      { includes: "commission_percent", result: { rows: existing ? [existing] : [] } },
      // markFeeRow's zero-row re-read.
      { includes: "status, stripe_transfer_id", result: { rows: reread ? [reread] : [] } },
    ],
    rows: [],
  };
  scenario.writeSelectRows["cancellation_fee_transfers:insert"] = [ledgerRow()];
  scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper", subscription_tier: null }] };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_1", status: "succeeded", amount: 33000, amount_received: 33000, latest_charge: "ch_1",
  });
  stripeMock.refunds.create.mockResolvedValue({ id: "re_1", amount: 15000 });
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_fee" });
}

const feeWrites = (op?: string) =>
  scenario.writes.filter((w) => w.table === "cancellation_fee_transfers" && (!op || w.op === op));
const feeTransferCalls = () =>
  stripeMock.transfers.create.mock.calls.filter(
    ([p]) => (p as { metadata?: { type?: string } }).metadata?.type === "cancellation_fee",
  );

describe("void-cancelled-payments — the single-Helpr cancellation fee has a ledger row (LOW-2)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | idempotencyKey: `cancel-fee-${feeRow.id}`, | idempotencyKey: `cancel-fee-${job.id}`,
  // @mutate supabase/functions/void-cancelled-payments/index.ts | fee_transfer_id: String(feeRow.id), | job_ref: job.id,
  it("claims the row before the transfer, keys the transfer to it, and marks it paid by compare-and-swap", async () => {
    seed();
    let claimsAtTransfer = -1;
    stripeMock.transfers.create.mockImplementation(async () => {
      claimsAtTransfer = feeWrites("insert").length;
      return { id: "tr_fee" };
    });
    const h = await load();
    await h.fetch(cronReq());

    const calls = feeTransferCalls();
    expect(calls).toHaveLength(1);
    const [params, opts] = calls[0] as [Record<string, unknown> & { metadata: Record<string, unknown>; amount: number }, { idempotencyKey: string }];
    // The claim landed before Stripe was asked to move anything.
    expect(claimsAtTransfer).toBe(1);
    const claim = feeWrites("insert")[0].payload as Record<string, unknown>;
    expect(claim).toMatchObject({ job_id: "job-1", helper_id: "helper-1", status: "pending" });
    expect(params.amount).toBe(Math.round(Number(claim.helper_amount) * 100));
    expect(opts.idempotencyKey).toBe("cancel-fee-fee-1");
    expect(params.metadata).toMatchObject({ type: "cancellation_fee", job_id: "job-1", helper_id: "helper-1", fee_transfer_id: "fee-1" });

    const marks = feeWrites("update");
    expect(marks).toHaveLength(1);
    expect(marks[0].payload).toMatchObject({ status: "paid", stripe_transfer_id: "tr_fee" });
    expect(marks[0].filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "id", value: "fee-1" },
        { op: "eq", column: "status", value: "pending" },
      ]),
    );
    // A fee is not a job payout.
    expect(scenario.writes.filter((w) => w.table === "payout_transfers")).toHaveLength(0);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | if (row && ["paid", "reversed", "waived"].includes(row.status)) return; | if (false) return;
  it("a row already paid moves no money and claims nothing", async () => {
    seed({ existing: ledgerRow({ status: "paid", stripe_transfer_id: "tr_old", created_at: OLD }) });
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(0);
    expect(feeWrites()).toHaveLength(0);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | Date.now() - new Date(row.created_at).getTime() < FEE_CLAIM_INFLIGHT_MS | false
  it("a fresh 'pending' claim belongs to a run in flight: no transfer", async () => {
    seed({ existing: ledgerRow() });
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(0);
    expect(feeWrites()).toHaveLength(0);
  });

  it("no claim, no transfer: a failed insert moves no money", async () => {
    seed();
    scenario.writeErrors.cancellation_fee_transfers = { message: "permission denied", code: "42501" };
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(0);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | if (alreadyPaidFee) { | if (false) {
  it("a fee transfer Stripe already shows repairs the row instead of paying twice", async () => {
    seed({ existing: ledgerRow({ created_at: OLD }) });
    stripeMock.transfers.list.mockResolvedValue({
      data: [{ id: "tr_prior", reversed: false, metadata: { type: "cancellation_fee", job_id: "job-1", helper_id: "helper-1" } }],
    });
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(0);
    const marks = feeWrites("update");
    expect(marks).toHaveLength(1);
    expect(marks[0].payload).toMatchObject({ status: "paid", stripe_transfer_id: "tr_prior" });
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | { status: "failed", failure_reason: reason } | { failure_reason: reason }
  it("a transfer Stripe refuses marks the row failed with the reason", async () => {
    seed();
    stripeMock.transfers.create.mockRejectedValue(new Error("insufficient platform balance"));
    const h = await load();
    await h.fetch(cronReq());
    const marks = feeWrites("update");
    expect(marks).toHaveLength(1);
    expect(marks[0].payload).toMatchObject({ status: "failed", failure_reason: "insufficient platform balance" });
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | if (!error && (!data \|\| data.length === 0)) { | if (false) {
  it("a paid mark that matches zero rows, and the row says something else, pages money_at_risk", async () => {
    seed({ reread: { status: "failed", stripe_transfer_id: null } });
    scenario.writeSelectRows["cancellation_fee_transfers:update"] = [];
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(1);
    expect(
      (slackAlerts as Array<{ kind: string; title: string }>).filter((a) => a.kind === "money_at_risk" && /ledger out of step/i.test(String(a.title))),
    ).toHaveLength(1);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | now.status === patch.status && | false &&
  it("a zero-row mark the webhook already made (same status, same transfer) is success, not an alert", async () => {
    seed({ reread: { status: "paid", stripe_transfer_id: "tr_fee" } });
    scenario.writeSelectRows["cancellation_fee_transfers:update"] = [];
    const h = await load();
    await h.fetch(cronReq());
    expect(feeTransferCalls()).toHaveLength(1);
    expect((slackAlerts as Array<{ title: string }>).filter((a) => /ledger out of step/i.test(String(a.title)))).toHaveLength(0);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | for (const fj of feeJobs ?? []) feeRetryJobs.push({ ...fj, fee_transfer_retry: true }); | void feeJobs;
  it("Part E retries a 'failed' row on a settled job, keyed to the same row", async () => {
    const failed = ledgerRow({ status: "failed", created_at: OLD });
    seed({ partA: false, existing: failed, retry: [failed] });
    const h = await load();
    await h.fetch(cronReq());
    const calls = feeTransferCalls();
    expect(calls).toHaveLength(1);
    expect((calls[0][1] as { idempotencyKey: string }).idempotencyKey).toBe("cancel-fee-fee-1");
    expect((calls[0][0] as { amount: number }).amount).toBe(13200);
    // Resumed at the price it was claimed at; nothing new claimed.
    expect(feeWrites("insert")).toHaveLength(0);
    const marks = feeWrites("update");
    expect(marks[0].payload).toMatchObject({ status: "paid", stripe_transfer_id: "tr_fee" });
    expect(marks[0].filters).toEqual(expect.arrayContaining([{ op: "eq", column: "status", value: "failed" }]));
  });
});
