/**
 * money-reconciliation: the cancellation-fee ledger vs Stripe, both ways
 * (docs/OPEN.md LOW-2).
 *
 * THE GAP. void-cancelled-payments sent a cancelled job's fee to its Helpr as
 * a Stripe transfer and wrote NO ledger row: not payout_transfers (on purpose,
 * a fee is not a job payout) and nothing else. Money left the platform that
 * the books did not show, and no reconciler check could compare it with
 * anything. cancellation_fee_transfers is that ledger; these tests pin the
 * five checks that make it and Stripe agree.
 *
 * Runs the REAL function source through the edge harness, Stripe mocked.
 *
 * RED WITH EACH COMPARISON REMOVED — each mutation turns a named test red:
 * @mutate supabase/functions/money-reconciliation/index.ts | if (rowByPair.has(`${job.id}:${job.helper_id}`)) continue; | continue;
 * @mutate supabase/functions/money-reconciliation/index.ts | if (r.status !== "pending" && r.status !== "failed") continue; | continue;
 * @mutate supabase/functions/money-reconciliation/index.ts | if (listedIds.has(r.stripe_transfer_id)) continue; | continue;
 * @mutate supabase/functions/money-reconciliation/index.ts | if (t.amount !== ledgerCents) { | if (false) {
 * @mutate supabase/functions/money-reconciliation/index.ts | if (!row) { | if (false) {
 * @mutate supabase/functions/money-reconciliation/index.ts | if (!matched) { | if (false) {
 * @mutate supabase/functions/money-reconciliation/index.ts | if (!includeSeed && typeof id === "string" && seedOutside.has(id)) continue; | if (false) continue;
 * @mutate supabase/functions/money-reconciliation/index.ts | notes.push(`cancellation-fee ledger checks skipped: ${feeLedgerDefect}`); | void 0;
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { jobLocalDateISO } from "../helpers/jobLocalDate";

const CRON_SECRET = "cron-secret";
const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const FEE_CHECKS = [
  "cancellation_fee_charged_without_ledger_row",
  "cancellation_fee_transfer_not_paid",
  "cancellation_fee_row_without_stripe_transfer",
  "cancellation_fee_stripe_transfer_without_row",
  "cancellation_fee_transfer_amount_mismatch",
];

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_x",
    CRON_SECRET,
  });
  return loadEdgeFunction("money-reconciliation");
}

async function run(fn: EdgeHarness) {
  const res = await fn.fetch(fn.request({ url: "https://edge.test/fn", headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
  return { res, b: JSON.parse(await res.text()) as Record<string, any> };
}

/** A $40 job its poster cancelled late yesterday; a $10 fee was charged for Helpr helper-1. */
function chargedJob(over: Record<string, unknown> = {}) {
  return {
    id: "job-f",
    is_seed: false,
    status: "cancelled",
    payment_status: "refunded",
    budget: 40,
    customer_fee_amount: 0,
    stripe_payment_intent_id: null,
    date_needed: jobLocalDateISO(0),
    start_time: null,
    cancelled_at: ago(DAY),
    helper_id: "helper-1",
    helper_confirmed_at: ago(2 * DAY),
    cancellation_fee: 10,
    cancellation_fee_status: "charged",
    late_cancellation: true,
    platform_fee_amount: null,
    helper_fee_percent: null,
    is_group_job: false,
    helpers_needed: 1,
    has_active_dispute: false,
    dispute_status: null,
    poster_completed_at: null,
    helper_completed_at: null,
    payout_scheduled_at: null,
    updated_at: ago(DAY),
    ...over,
  };
}

function feeRow(over: Record<string, unknown> = {}) {
  return {
    id: "fee-1",
    job_id: "job-f",
    helper_id: "helper-1",
    status: "paid",
    stripe_transfer_id: "tr_1",
    helper_amount: 8,
    created_at: ago(DAY),
    updated_at: ago(DAY),
    ...over,
  };
}

function feeTransfer(over: { id?: string; amount?: number; metadata?: Record<string, string> } = {}) {
  return {
    id: over.id ?? "tr_1",
    amount: over.amount ?? 800,
    metadata: over.metadata ?? {
      type: "cancellation_fee",
      job_id: "job-f",
      helper_id: "helper-1",
      fee_transfer_id: "fee-1",
    },
  };
}

function seed(opts: { jobs?: Record<string, unknown>[]; rows?: Record<string, unknown>[]; transfers?: unknown[] } = {}) {
  scenario.reads.jobs = { rows: opts.jobs ?? [chargedJob()] };
  scenario.reads.payout_transfers = { rows: [] };
  scenario.reads.disputes = { rows: [] };
  scenario.reads.profiles = { rows: [] };
  scenario.reads.gift_cards = { rows: [] };
  scenario.reads.payment_refunds = { rows: [] };
  scenario.reads.crew_cancellation_fee_shares = { rows: [] };
  scenario.reads.cancellation_fee_transfers = { rows: opts.rows ?? [feeRow()] };
  stripeMock.transfers.list.mockResolvedValue({ data: opts.transfers ?? [feeTransfer()], has_more: false });
}

const finding = (b: Record<string, any>, check: string) =>
  (b.findings as Array<{ check: string; severity: string; count: number; samples?: unknown[] }>).find(
    (f) => f.check === check,
  );
const feeFindings = (b: Record<string, any>) =>
  FEE_CHECKS.filter((c) => (finding(b, c)?.count ?? 0) > 0);

describe("money-reconciliation — cancellation-fee ledger vs Stripe (LOW-2)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
  });

  it("stays silent when the job, its ledger row and Stripe agree", async () => {
    const fn = await load();
    seed();
    const { b } = await run(fn);
    expect(feeFindings(b)).toEqual([]);
    expect(b.scanned.cancellation_fee_transfers).toBe(1);
    expect(b.scanned.stripe_fee_transfers_listed).toBe(1);
    expect(stripeMock.transfers.list).toHaveBeenCalled();
  });

  it("pages a charged fee with no ledger row (the claim never happened)", async () => {
    const fn = await load();
    seed({ rows: [], transfers: [] });
    const { b } = await run(fn);
    const f = finding(b, "cancellation_fee_charged_without_ledger_row");
    expect(f?.severity).toBe("critical");
    expect(f?.count).toBe(1);
  });

  it("does not page a charge still inside the settle window", async () => {
    const fn = await load();
    seed({ jobs: [chargedJob({ updated_at: ago(10 * 60_000), cancelled_at: ago(10 * 60_000) })], rows: [], transfers: [] });
    const { b } = await run(fn);
    expect(finding(b, "cancellation_fee_charged_without_ledger_row")?.count ?? 0).toBe(0);
  });

  it("warns on a row left pending or failed past the settle window", async () => {
    const fn = await load();
    seed({
      rows: [feeRow({ status: "failed", stripe_transfer_id: null, created_at: ago(DAY), updated_at: ago(3 * 3_600_000) })],
      transfers: [],
    });
    const { b } = await run(fn);
    const f = finding(b, "cancellation_fee_transfer_not_paid");
    expect(f?.severity).toBe("warning");
    expect(f?.count).toBe(1);
  });

  // Q1241: void-cancelled-payments claims the fee row as 'pending' BEFORE it
  // checks the payout hold, so a held Helpr's fee waits there on purpose for
  // the whole hold; this warning posted on every run for that time.
  // @mutate supabase/functions/money-reconciliation/index.ts | if (r.helper_id && feeHolds.has(r.helper_id)) { | if (false) {
  it("Q1241: a HELD Helpr's waiting fee row is reported in cancellation_fee_held, not warned", async () => {
    const fn = await load();
    seed({
      rows: [feeRow({ status: "pending", stripe_transfer_id: null, created_at: ago(DAY), updated_at: ago(DAY) })],
      transfers: [],
    });
    scenario.reads.payout_holds = { rows: [{ helper_id: "helper-1", reason: "review", held_at: null, denied_at: null }] };
    const { b } = await run(fn);
    expect(finding(b, "cancellation_fee_transfer_not_paid")?.count ?? 0).toBe(0);
    expect(b.cancellation_fee_held).toEqual([{ job_id: "job-f", fee_transfer_id: "fee-1", helper_id: "helper-1" }]);
  });

  // @mutate supabase/functions/money-reconciliation/index.ts | notes.push(`payout hold read failed, no held cancellation fee exempted: ${feeHoldLookup.message}`); | void 0;
  it("Q1241 fails closed: an unreadable hold exempts no fee row, and the run is degraded", async () => {
    const fn = await load();
    seed({
      rows: [feeRow({ status: "pending", stripe_transfer_id: null, created_at: ago(DAY), updated_at: ago(DAY) })],
      transfers: [],
    });
    scenario.reads.payout_holds = { error: { message: "connection reset", code: "08006" } };
    const { res, b } = await run(fn);
    expect(finding(b, "cancellation_fee_transfer_not_paid")?.count).toBe(1);
    expect((b.notes as string[]).join(" ")).toContain("no held cancellation fee exempted");
    expect(res.status).toBe(500);
  });

  it("pages a ledger row whose Stripe transfer Stripe does not have", async () => {
    const fn = await load();
    seed({ transfers: [] });
    const { b } = await run(fn);
    expect(finding(b, "cancellation_fee_row_without_stripe_transfer")?.count).toBe(1);
  });

  it("never invents 'missing in Stripe' from an incomplete listing", async () => {
    const fn = await load();
    seed();
    stripeMock.transfers.list.mockRejectedValue(new Error("stripe down"));
    const { b } = await run(fn);
    expect(finding(b, "cancellation_fee_row_without_stripe_transfer")?.count ?? 0).toBe(0);
    // Unverified is not clean: the run is degraded, which is a defect.
    expect(JSON.stringify(b)).toContain("transfers.list failed");
  });

  it("pages a single-Helpr Stripe fee transfer with no ledger row", async () => {
    const fn = await load();
    seed({
      transfers: [
        feeTransfer(),
        feeTransfer({ id: "tr_orphan", metadata: { type: "cancellation_fee", job_id: "job-f", helper_id: "helper-1", fee_transfer_id: "fee-gone" } }),
      ],
    });
    const { b } = await run(fn);
    expect(finding(b, "cancellation_fee_stripe_transfer_without_row")?.count).toBe(1);
  });

  it("pages a crew-share fee transfer whose share row does not record it", async () => {
    const fn = await load();
    seed({
      transfers: [
        feeTransfer(),
        feeTransfer({ id: "tr_crew", metadata: { type: "cancellation_fee", job_id: "job-f", helper_id: "helper-2", share_id: "share-x" } }),
      ],
    });
    scenario.reads.crew_cancellation_fee_shares = { rows: [{ id: "share-x", stripe_transfer_id: "tr_other" }] };
    const { b } = await run(fn);
    expect(finding(b, "cancellation_fee_stripe_transfer_without_row")?.count).toBe(1);
  });

  it("matches a crew-share transfer its share row records", async () => {
    const fn = await load();
    seed({
      transfers: [
        feeTransfer(),
        feeTransfer({ id: "tr_crew", metadata: { type: "cancellation_fee", job_id: "job-f", helper_id: "helper-2", share_id: "share-x" } }),
      ],
    });
    scenario.reads.crew_cancellation_fee_shares = { rows: [{ id: "share-x", stripe_transfer_id: "tr_crew" }] };
    const { b } = await run(fn);
    expect(feeFindings(b)).toEqual([]);
  });

  it("pages a Stripe amount that differs from the ledger's helper_amount", async () => {
    const fn = await load();
    seed({ transfers: [feeTransfer({ amount: 900 })] });
    const { b } = await run(fn);
    expect(finding(b, "cancellation_fee_transfer_amount_mismatch")?.count).toBe(1);
  });

  it("ignores Stripe transfers that are not cancellation fees", async () => {
    const fn = await load();
    seed({ transfers: [feeTransfer(), { id: "tr_payout", amount: 5000, metadata: { job_id: "job-z" } }] });
    const { b } = await run(fn);
    expect(feeFindings(b)).toEqual([]);
    expect(b.scanned.stripe_fee_transfers_listed).toBe(1);
  });

  it("a failed ledger read is a degraded run, never 'no rows'", async () => {
    const fn = await load();
    seed({ rows: [], transfers: [] });
    scenario.reads.cancellation_fee_transfers = { error: { message: "relation does not exist", code: "42P01" } };
    const { res, b } = await run(fn);
    // Without the guard a missing ledger would read as "no rows" and page the
    // charged job as missingRow; with it, the checks are skipped and the run is
    // degraded instead.
    expect(finding(b, "cancellation_fee_charged_without_ledger_row")?.count ?? 0).toBe(0);
    expect(JSON.stringify(b)).toContain("cancellation-fee ledger checks skipped");
    expect(res.status).toBe(500);
  });

  it("drops a hit on an is_seed job outside the default scan, and keeps one on a real job", async () => {
    const fn = await load();
    seed({
      transfers: [
        feeTransfer(),
        feeTransfer({ id: "tr_seed", metadata: { type: "cancellation_fee", job_id: "job-seed", helper_id: "h", fee_transfer_id: "nope-1" } }),
        feeTransfer({ id: "tr_gone", metadata: { type: "cancellation_fee", job_id: "job-gone", helper_id: "h", fee_transfer_id: "nope-2" } }),
      ],
    });
    scenario.reads.jobs = {
      rows: [chargedJob()],
      selectOverrides: [{ includes: "is_seed, id", result: { rows: [{ id: "job-seed", is_seed: true }] } }],
    };
    const { b } = await run(fn);
    // job-seed is dropped; job-gone (deleted, so not known to be seed) pages.
    expect(finding(b, "cancellation_fee_stripe_transfer_without_row")?.count).toBe(1);
  });
});
