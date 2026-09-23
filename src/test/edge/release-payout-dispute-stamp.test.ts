/**
 * Q153: a payout that settles an already-closed dispute stamps the dispute row.
 *
 * `auto-resolve-disputes` (and `settle_dispute_record`) mark a dispute decided +
 * executed and leave the money to `release-payout` / `process-scheduled-payouts`,
 * neither of which wrote the disputes row. Prod dispute 9756a585 (job e6979a12)
 * was paid 3520c by tr_3UCwOtKp2H4b7tEC1UMtZPxp on 2026-09-23 and still read
 * execution_transfer_id / execution_helper_cents NULL, so the admin DisputeCard
 * said "Settled: $0.00 to the Helpr" and DisputeTimelineDialog showed no amount.
 *
 * Two halves, because the harness mock applies no read/write filters:
 *   1. the edge functions, through the harness: the stamp is written, with the
 *      transfer id and the cents actually sent, by id, guarded on NULLs;
 *   2. `stampDisputePayout` against an in-memory table that DOES apply
 *      eq/is/order/limit: an already-stamped row is never overwritten, and a
 *      re-filed job's newest row is the one stamped.
 */
// @mutate supabase/functions/release-payout/index.ts | transferId: transfer.id, | transferId: "tr_wrong",
// @mutate supabase/functions/release-payout/index.ts | transferId: paidRows[0].stripe_transfer_id, | transferId: "tr_wrong",
// @mutate supabase/functions/process-scheduled-payouts/index.ts | if (!job.is_group_job) {\n          const disputeStamp | if (true) {\n          const disputeStamp
// @mutate supabase/functions/_shared/disputePayoutStamp.ts | .is("execution_refund_id", null)\n | \n
// @mutate supabase/functions/_shared/disputePayoutStamp.ts | .is("execution_transfer_id", null)\n      .is("execution_helper_cents", null)\n      .select("id"); | .select("id");
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock, type SupabaseScenario } from "./mocks/supabase";
import { resetSharedMocks, postSlackOpsAlert } from "./mocks/shared";
import { stampDisputePayout } from "../../../supabase/functions/_shared/disputePayoutStamp.ts";

const CRON_SECRET = "cron-secret-xyz";

async function load(name: "release-payout" | "process-scheduled-payouts"): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    CRON_SECRET,
  });
  return loadEdgeFunction(name);
}

const json = async (res: Response) => JSON.parse(await res.text()) as Record<string, unknown>;
const capturedCents = (budget: number) => Math.round(budget * 100 * 1.12);

/** The shape 9756a585 was in: auto-resolved to the helper, job payout_pending. */
function seedAutoResolvedJob(s: SupabaseScenario, unstampedDispute: Record<string, unknown> | null) {
  const budget = 40;
  s.reads.jobs = {
    rows: [
      {
        id: "job-1",
        title: "Auto-resolved haul-off",
        status: "completed",
        payment_status: "payout_pending",
        helper_id: "helper-1",
        customer_id: "poster-1",
        budget,
        urgent_fee: 0,
        dispute_status: "auto_resolved",
        disputed_at: "2026-09-13T02:12:01Z",
        is_group_job: false,
        helpers_needed: null,
        stripe_payment_intent_id: "pi_1",
        stripe_session_id: null,
      },
    ],
  };
  // The settlement gate's read ("id, execution_status, payout_split") answers
  // empty: the dispute IS executed. Only the stamp's own read (it selects
  // execution_helper_cents) sees the unstamped row.
  s.reads.disputes = {
    rows: [],
    selectOverrides: [
      { includes: "execution_helper_cents", result: { rows: unstampedDispute ? [unstampedDispute] : [] } },
    ],
  };
  s.reads.gift_cards = { rows: [] };
  s.rpc.restore_gift_card_for_job = { outcome: "would_restore", applied_cents: capturedCents(budget) };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_1",
    status: "succeeded",
    amount: capturedCents(budget),
    amount_received: capturedCents(budget),
  });
  s.reads.profiles = {
    rows: [{ stripe_account_id: "acct_helper", full_name: "Helpful Helper", onboarding_fee_paid: true }],
  };
  s.reads.platform_settings = { rows: [{ helper_fee_percent: 12, onboarding_fee_cents: 200 }] };
  s.reads.payout_transfers = { rows: [] };
  stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_helper", payouts_enabled: true, charges_enabled: true });
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_stamp_1", transfer_group: "job_job-1" });
}

const callAsCron = (fn: EdgeHarness) =>
  fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: { job_id: "job-1" } }));

const disputeWrites = () => scenario.writes.filter((w) => w.table === "disputes");

describe("release-payout stamps the closed dispute it settles (Q153)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("stamps execution_transfer_id + execution_helper_cents with what was actually sent", async () => {
    seedAutoResolvedJob(scenario, { id: "dispute-9", execution_transfer_id: null, execution_helper_cents: null });
    const fn = await load("release-payout");
    const res = await callAsCron(fn);

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.dispute_stamp).toBe("stamped");
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);

    const writes = disputeWrites();
    expect(writes).toHaveLength(1);
    const w = writes[0];
    expect(w.op).toBe("update");
    expect(w.payload).toEqual({
      execution_transfer_id: "tr_stamp_1",
      execution_helper_cents: body.amount_cents,
    });
    expect(typeof body.amount_cents).toBe("number");
    expect(body.amount_cents as number).toBeGreaterThan(0);
    // By id, and never over an existing stamp.
    expect(w.filters).toContainEqual({ op: "eq", column: "id", value: "dispute-9" });
    expect(w.filters).toContainEqual({ op: "is", column: "execution_transfer_id", value: null });
    expect(w.filters).toContainEqual({ op: "is", column: "execution_helper_cents", value: null });
    expect(w.selectCols).toBe("id");

    // The read targets only a decided, executed, unstamped row of THIS job.
    const read = scenario.readQueries.find((q) => q.table === "disputes" && q.cols.includes("execution_helper_cents"));
    expect(read).toBeDefined();
    expect(read!.filters).toContainEqual({ op: "eq", column: "job_id", value: "job-1" });
    expect(read!.filters).toContainEqual({ op: "eq", column: "status", value: "decided" });
    expect(read!.filters).toContainEqual({ op: "eq", column: "execution_status", value: "executed" });
    expect(read!.limit).toBe(1);
  });

  it("writes nothing to disputes when no closed dispute is waiting for a stamp", async () => {
    seedAutoResolvedJob(scenario, null);
    const fn = await load("release-payout");
    const res = await callAsCron(fn);

    expect(res.status).toBe(200);
    expect((await json(res)).dispute_stamp).toBe("none");
    expect(disputeWrites()).toHaveLength(0);
  });

  it("a zero-row stamp (another writer got there first) is reported, not forced", async () => {
    seedAutoResolvedJob(scenario, { id: "dispute-9", execution_transfer_id: null, execution_helper_cents: null });
    scenario.writeSelectRows["disputes:update"] = [];
    const fn = await load("release-payout");
    const res = await callAsCron(fn);

    expect(res.status).toBe(200);
    expect((await json(res)).dispute_stamp).toBe("raced");
    expect(disputeWrites()).toHaveLength(1);
  });

  it("a failed stamp does not turn a sent payout into a 500, and it alerts", async () => {
    seedAutoResolvedJob(scenario, { id: "dispute-9", execution_transfer_id: null, execution_helper_cents: null });
    scenario.writeErrors.disputes = { message: "permission denied", code: "42501" };
    const fn = await load("release-payout");
    const res = await callAsCron(fn);

    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.success).toBe(true);
    expect(body.dispute_stamp).toBe("error");
    const alert = postSlackOpsAlert.mock.calls
      .map((c) => c[0] as { title?: string; fields?: Record<string, string> })
      .find((a) => /dispute record/i.test(a.title ?? ""));
    expect(alert).toBeDefined();
    expect(alert!.fields?.["Dispute ID"]).toBe("dispute-9");
  });

  it("the heal retry (transfer already paid, flip missing) stamps from the ledger row", async () => {
    seedAutoResolvedJob(scenario, { id: "dispute-9", execution_transfer_id: null, execution_helper_cents: null });
    scenario.reads.payout_transfers = {
      rows: [{ id: "pt-1", stripe_transfer_id: "tr_prior", status: "paid", created_at: "2026-09-23T12:52:15Z", amount_cents: 3520 }],
    };
    const fn = await load("release-payout");
    const res = await callAsCron(fn);

    expect(res.status).toBe(200);
    expect((await json(res)).already_paid).toBe(true);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    const writes = disputeWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toEqual({ execution_transfer_id: "tr_prior", execution_helper_cents: 3520 });
  });
});

describe("process-scheduled-payouts stamps the closed dispute it settles (Q153)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  function seedScheduled(s: SupabaseScenario, isGroup: boolean) {
    const job = {
      id: "job-1", title: "Auto-resolved haul-off", helper_id: "helper-1", customer_id: "poster-1",
      budget: 40, platform_fee_amount: 4.8, helper_fee_percent: 12, urgent_fee: 0,
      stripe_session_id: "cs_1", stripe_payment_intent_id: "pi_1", status: "completed",
      is_group_job: isGroup, helpers_needed: 1, sales_tax_rate: 0,
    };
    s.reads.jobs = { rows: [job] };
    s.reads.platform_settings = { rows: [{ onboarding_fee_cents: 200 }] };
    s.reads.profiles = {
      rows: [{ stripe_account_id: "acct_helper", onboarding_fee_paid: true, subscription_tier: "free", subscription_expires_at: null }],
    };
    s.reads.payout_transfers = { rows: [] };
    s.reads.user_roles = { rows: [] };
    s.reads.group_job_helpers = { rows: [{ helper_id: "helper-1", status: "completed" }] };
    s.reads.disputes = {
      rows: [],
      selectOverrides: [
        { includes: "execution_helper_cents", result: { rows: [{ id: "dispute-9", execution_transfer_id: null, execution_helper_cents: null }] } },
      ],
    };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_1", status: "succeeded", latest_charge: "ch_1", amount: capturedCents(40), amount_received: capturedCents(40),
    });
    stripeMock.transfers.create.mockResolvedValue({ id: "tr_sched_1" });
  }

  it("stamps the transfer and the cents the ledger recorded", async () => {
    seedScheduled(scenario, false);
    const fn = await load("process-scheduled-payouts");
    const res = await fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
    const body = await json(res);
    expect((body.results as Array<Record<string, unknown>>)[0]?.status).toBe("transferred");

    const ledger = scenario.writes.find(
      (w) => w.table === "payout_transfers" && w.op === "update" && (w.payload as Row).stripe_transfer_id === "tr_sched_1",
    );
    expect(ledger).toBeDefined();
    const writes = disputeWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toEqual({
      execution_transfer_id: "tr_sched_1",
      execution_helper_cents: (ledger!.payload as Row).amount_cents,
    });
    expect(writes[0].filters).toContainEqual({ op: "is", column: "execution_transfer_id", value: null });
    expect(writes[0].selectCols).toBe("id");
  });

  it("a failed stamp leaves the payout transferred and records a defect", async () => {
    seedScheduled(scenario, false);
    scenario.writeErrors.disputes = { message: "permission denied", code: "42501" };
    const fn = await load("process-scheduled-payouts");
    const res = await fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
    const body = await json(res);
    expect((body.results as Array<Record<string, unknown>>)[0]?.status).toBe("transferred");
    expect(JSON.stringify(body)).toMatch(/dispute stamp job-1/);
  });

  it("does not stamp from a group job's per-helper transfer", async () => {
    seedScheduled(scenario, true);
    const fn = await load("process-scheduled-payouts");
    await fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
    expect(stripeMock.transfers.create).toHaveBeenCalled();
    expect(disputeWrites()).toHaveLength(0);
  });
});

/**
 * `stampDisputePayout` against a table that applies its filters for real.
 * This is where "an already-stamped dispute is not overwritten" is proven:
 * the harness above cannot, because it answers by table name.
 */
type Row = Record<string, unknown>;
function memoryClient(rows: Row[]) {
  const from = (_t: string) => {
    const preds: Array<(r: Row) => boolean> = [];
    let op: "select" | "update" = "select";
    let patch: Row = {};
    let orderCol: string | null = null;
    let asc = true;
    let lim: number | null = null;
    const run = () => {
      let hit = rows.filter((r) => preds.every((p) => p(r)));
      if (op === "update") {
        hit.forEach((r) => Object.assign(r, patch));
        return { data: hit.map((r) => ({ id: r.id })), error: null };
      }
      if (orderCol) {
        const c = orderCol;
        hit = [...hit].sort((a, b) => String(a[c]).localeCompare(String(b[c])) * (asc ? 1 : -1));
      }
      if (lim !== null) hit = hit.slice(0, lim);
      return { data: hit, error: null };
    };
    const b = {
      select: () => (op === "update" ? Promise.resolve(run()) : b),
      update: (p: Row) => { op = "update"; patch = p; return b; },
      eq: (c: string, v: unknown) => { preds.push((r) => r[c] === v); return b; },
      is: (c: string, v: unknown) => { preds.push((r) => (r[c] ?? null) === v); return b; },
      order: (c: string, o?: { ascending?: boolean }) => { orderCol = c; asc = o?.ascending !== false; return b; },
      limit: (n: number) => { lim = n; return Promise.resolve(run()); },
    };
    return b;
  };
  return { from };
}

const base = { job_id: "job-1", status: "decided", execution_status: "executed", execution_refund_cents: null };

describe("stampDisputePayout — the never-overwrite predicate, applied", () => {
  it("stamps an executed dispute that recorded nothing", async () => {
    const rows: Row[] = [{ ...base, id: "d-1", decided_at: "2026-09-16", execution_transfer_id: null, execution_helper_cents: null }];
    const r = await stampDisputePayout(memoryClient(rows), { jobId: "job-1", transferId: "tr_new", helperCents: 3520 });
    expect(r).toEqual({ outcome: "stamped", disputeId: "d-1" });
    expect(rows[0].execution_transfer_id).toBe("tr_new");
    expect(rows[0].execution_helper_cents).toBe(3520);
  });

  it("never overwrites a dispute that already carries a transfer", async () => {
    const rows: Row[] = [
      { ...base, id: "d-1", decided_at: "2026-09-16", execution_transfer_id: "tr_split", execution_helper_cents: 1760 },
    ];
    const r = await stampDisputePayout(memoryClient(rows), { jobId: "job-1", transferId: "tr_new", helperCents: 3520 });
    expect(r.outcome).toBe("none");
    expect(rows[0].execution_transfer_id).toBe("tr_split");
    expect(rows[0].execution_helper_cents).toBe(1760);
  });

  it("never overwrites a recorded amount even when the transfer id is missing", async () => {
    const rows: Row[] = [{ ...base, id: "d-1", decided_at: "2026-09-16", execution_transfer_id: null, execution_helper_cents: 1760 }];
    const r = await stampDisputePayout(memoryClient(rows), { jobId: "job-1", transferId: "tr_new", helperCents: 3520 });
    expect(r.outcome).toBe("none");
    expect(rows[0].execution_helper_cents).toBe(1760);
    expect(rows[0].execution_transfer_id).toBeNull();
  });

  it("does not touch undecided, unexecuted or other-job disputes", async () => {
    const rows: Row[] = [
      { ...base, id: "d-open", status: "open", execution_status: null, decided_at: null, execution_transfer_id: null, execution_helper_cents: null },
      { ...base, id: "d-pending", execution_status: "pending", decided_at: "2026-09-16", execution_transfer_id: null, execution_helper_cents: null },
      { ...base, id: "d-other", job_id: "job-2", decided_at: "2026-09-16", execution_transfer_id: null, execution_helper_cents: null },
    ];
    const r = await stampDisputePayout(memoryClient(rows), { jobId: "job-1", transferId: "tr_new", helperCents: 3520 });
    expect(r.outcome).toBe("none");
    expect(rows.every((x) => x.execution_transfer_id === null)).toBe(true);
  });

  it("never stamps a dispute that settled by refund", async () => {
    const rows: Row[] = [
      { ...base, id: "d-refund", decided_at: "2026-09-16", execution_transfer_id: null, execution_helper_cents: null, execution_refund_id: "re_1", execution_refund_cents: 2689 },
    ];
    const r = await stampDisputePayout(memoryClient(rows), { jobId: "job-1", transferId: "tr_new", helperCents: 3520 });
    expect(r.outcome).toBe("none");
    expect(rows[0].execution_transfer_id).toBeNull();
  });

  it("stamps only the newest decided row on a re-filed job", async () => {
    const rows: Row[] = [
      { ...base, id: "d-old", decided_at: "2026-09-10", execution_transfer_id: null, execution_helper_cents: null },
      { ...base, id: "d-new", decided_at: "2026-09-16", execution_transfer_id: null, execution_helper_cents: null },
    ];
    const r = await stampDisputePayout(memoryClient(rows), { jobId: "job-1", transferId: "tr_new", helperCents: 3520 });
    expect(r).toEqual({ outcome: "stamped", disputeId: "d-new" });
    expect(rows.find((x) => x.id === "d-old")!.execution_transfer_id).toBeNull();
  });
});
