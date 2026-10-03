/**
 * Q342 + Q343: the stripe-webhook writes that closed (or failed to close) an
 * escrow's record, run through the REAL function source.
 *
 * Q342: a LOST chargeback on a job whose internal dispute was decided but whose
 * split never ran left that dispute decided/'pending' forever: the split
 * refuses a 'chargeback' job, supersede and the no-payment close refuse too.
 * The lost branch now calls settle_dispute_by_chargeback (proved in PGlite by
 * src/test/pglite/chargebackLostClosesDecidedDispute.pglite.mjs) and pages on
 * every answer but "nothing to close".
 *
 * Q343: charge.refunded set payment_status='refunded' matched on id alone, so
 * a full refund overwrote 'released' (the Helpr was already paid: the platform
 * paid twice and the row hid it) and 'chargeback'. It is a compare-and-set on
 * REFUND_CLOSABLE_PAYMENT_STATES now; anything else pages and is left alone.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | await closeDecidedDisputeOnLostChargeback( | void (
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | if (outcome === "no_unsettled_dispute") return outcome; | if (outcome !== "closed") return outcome;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | _disputed_cents: dispute.amount, | _disputed_cents: chargeCents,
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | .in("payment_status", [...REFUND_CLOSABLE_PAYMENT_STATES]) | .neq("id", "")
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | "escrow", "payout_pending", "cancelling", | "escrow", "payout_pending", "cancelling", "released", "chargeback",
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | if (decidedClose !== "closed" && lost.rows === 0 | if (lost.rows === 0
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | && nowStatus !== "refunded") { | ) {
 *
 * Q449: a WON chargeback on a job an internal hold still holds (a decided
 * split that has not run) left it 'chargeback' forever; it now restores the
 * pre-chargeback payment state, keeping the hold's markers.
 * Q450: a FULL refund made outside the split (the Stripe Dashboard) on a
 * decided-but-unexecuted dispute left it pending forever; charge.refunded now
 * closes it via settle_dispute_by_external_refund, keyed on WHO refunded.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | } else if (repaid.rows === 0 && held && closedJob.payment_status === "chargeback") { | } else if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | disputed_at: closedJob.disputed_at ?? new Date().toISOString(), | disputed_at: null,
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | if (hold.readError) { | if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | .eq("status", closedJob.status) |
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | if (nowRefunded) { | if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | if (decisions.length === 0) return "no_unsettled_dispute"; |
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | if (crew) { | if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | severity: helperShare > 0 ? "critical" : "warning", | severity: "warning",
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | hold.unsettledExecutionStatus !== "crew_fanout" && |
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | closedJob.is_group_job !== true && |
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | hold.unsettledDisputeId != null && hold.unsettledDisputeId !== "unknown" && | hold.unsettledDisputeId != null &&
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | holdReasons(closedJob, { openDisputeId: hold.openDisputeId, reversedTransferId: hold.reversedTransferId }).length === 0; | true;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | return job.payout_scheduled_at ? "payout_pending" : "escrow"; | return "payout_pending";
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | wonNeedsHuman = true; |
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | severity: outcome === "won" ? (wonNeedsHuman ? "critical" : "info") | severity: outcome === "won" ? (wonNeedsHuman ? "warning" : "info")
 * @mutate supabase/functions/stripe-webhook/handlers/_chargebackHold.ts | ? "a settlement of this job is running or stopped part-way (a settlement claim is held)" | ? `dispute ${hold.unsettledDisputeId} is decided and its split has not executed`
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts |           : wonNeedsHuman\n          ? " It stays blocked as |           : true\n          ? " It stays blocked as
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | if (outcome === "busy") { | if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | if (outside.length === 0 && bySplit.every((r) => splitOf(r) === decidedId)) { | if (false) {
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, resetSharedMocks } from "./mocks/shared";

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
  return loadEdgeFunction("stripe-webhook");
}

function post(fn: EdgeHarness) {
  return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=abc" } }));
}

type Alert = { title: string; severity?: string; message?: string };
const alerts = () => slackAlerts as unknown as Alert[];

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
});

describe("Q342: a lost chargeback closes a decided-but-unexecuted dispute", () => {
  function closed(id: string, status: string, amount = 5000) {
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id,
      type: "charge.dispute.closed",
      data: { object: { id: `dp_${id}`, status, amount, payment_intent: "pi_disputed", charge: "ch_d" } },
    });
    stripeMock.charges.retrieve.mockResolvedValue({ id: "ch_d", amount: 5000, amount_captured: 5000 });
  }
  const decidedJob = {
    id: "job-decided", customer_id: "p", helper_id: "h", title: "Gutter clean",
    dispute_status: "resolved", disputed_at: "2026-09-20T00:00:00.000Z",
    payment_status: "chargeback", status: "completed", payout_scheduled_at: null,
  };
  const rpcCalls = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "settle_dispute_by_chargeback");

  it("calls settle_dispute_by_chargeback with the job, the Stripe dispute and both amounts", async () => {
    const fn = await loadConfigured();
    closed("evt_q342_close", "lost");
    scenario.reads.jobs = { rows: [decidedJob] };
    scenario.rpc.settle_dispute_by_chargeback = {
      outcome: "closed", dispute_id: "d-1", payout_split: { poster: 0.5, helper: 0.5 },
    };
    const res = await post(fn);
    expect(res.status).toBe(200);
    expect(rpcCalls()).toHaveLength(1);
    expect(rpcCalls()[0].args).toEqual({
      _job_id: "job-decided",
      _stripe_dispute_id: "dp_evt_q342_close",
      _disputed_cents: 5000,
      _charge_cents: 5000,
    });
    const a = alerts().find((x) => /dispute closed, nothing left to split/i.test(x.title));
    expect(a, JSON.stringify(alerts().map((x) => x.title))).toBeDefined();
    // A decision that gave the Helpr a share the platform no longer holds says so.
    expect(a?.message).toMatch(/Helpr a share/);
  });

  it("pages ops (critical) when the close answers needs_human, e.g. a partial chargeback", async () => {
    const fn = await loadConfigured();
    closed("evt_q342_partial", "lost", 2000);
    scenario.reads.jobs = { rows: [decidedJob] };
    scenario.rpc.settle_dispute_by_chargeback = {
      outcome: "needs_human", dispute_id: "d-1", reason: "the bank took back 2000 of 5000 cents",
      payout_split: { poster: 1, helper: 0 },
    };
    const res = await post(fn);
    expect(res.status).toBe(200);
    expect(rpcCalls()[0].args).toMatchObject({ _disputed_cents: 2000, _charge_cents: 5000 });
    const a = alerts().find((x) => /settle it by hand/i.test(x.title));
    expect(a?.severity).toBe("critical");
    expect(a?.message).toMatch(/2000 of 5000/);
  });

  it("stays quiet when there is no decided dispute to close", async () => {
    const fn = await loadConfigured();
    closed("evt_q342_none", "lost");
    scenario.reads.jobs = { rows: [{ ...decidedJob, dispute_status: "stripe_chargeback" }] };
    scenario.rpc.settle_dispute_by_chargeback = { outcome: "no_unsettled_dispute" };
    await post(fn);
    expect(rpcCalls()).toHaveLength(1);
    expect(alerts().some((x) => /decided dispute/i.test(x.title))).toBe(false);
  });

  it("a DB error on the close throws (non-2xx) so Stripe redelivers, and pages", async () => {
    const fn = await loadConfigured();
    closed("evt_q342_err", "lost");
    scenario.reads.jobs = { rows: [decidedJob] };
    scenario.rpcErrors = { settle_dispute_by_chargeback: { message: "connection reset" } };
    const res = await post(fn);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(alerts().some((x) => /decided dispute NOT closed/i.test(x.title) && x.severity === "critical")).toBe(true);
  });

  it("a failed charge read throws (Stripe redelivers) instead of stranding the dispute (review L1)", async () => {
    const fn = await loadConfigured();
    closed("evt_q342_ch_err", "lost");
    stripeMock.charges.retrieve.mockRejectedValue(new Error("stripe down"));
    scenario.reads.jobs = { rows: [decidedJob] };
    const res = await post(fn);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(rpcCalls()).toHaveLength(0);
  });

  it("a Helpr share the close leaves unpaid becomes a lasting admin notice, and both parties are told once (review M2)", async () => {
    const fn = await loadConfigured();
    closed("evt_q342_notices", "lost");
    scenario.reads.jobs = { rows: [decidedJob] };
    scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
    // The Helpr WAS told their payout was on hold, so the old lost-branch
    // notice would fire too without the dedupe.
    scenario.reads.notifications = { rows: [{ id: "n-hold" }] };
    scenario.rpc.settle_dispute_by_chargeback = {
      outcome: "closed", dispute_id: "d-1", payout_split: { poster: 0.5, helper: 0.5 },
    };
    await post(fn);
    const notes = scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert")
      .map((w) => w.payload as Record<string, unknown>);
    expect(notes.some((n) => n.user_id === "admin-1" && /Helpr share unpaid/.test(String(n.title)))).toBe(true);
    expect(notes.filter((n) => n.user_id === "p" && /closed by your bank/i.test(String(n.title)))).toHaveLength(1);
    // The Helpr gets the close notice and NOT also the lost branch's "stays on hold" one.
    expect(notes.filter((n) => n.user_id === "h")).toHaveLength(1);
  });

  it("the close is only attempted on a LOST outcome (won and warning_closed return the money)", async () => {
    for (const status of ["won", "warning_closed"]) {
      resetSupabaseMock();
      const fn = await loadConfigured();
      closed(`evt_q342_${status}`, status);
      scenario.reads.jobs = { rows: [decidedJob] };
      await post(fn);
      expect(rpcCalls(), status).toHaveLength(0);
    }
  });
});

describe("Q343: charge.refunded is a compare-and-set on the refundable states", () => {
  function refunded(id: string) {
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id,
      type: "charge.refunded",
      data: { object: { id: `ch_${id}`, payment_intent: "pi_r", amount: 5000, amount_refunded: 5000, currency: "usd", refunds: { data: [{ id: `re_${id}`, amount: 5000 }] } } },
    });
  }
  const statusWrite = () =>
    scenario.writes.find((w) => w.table === "jobs" && w.op === "update" && "payment_status" in (w.payload as object));

  it("escrow -> refunded, with the CAS filter and an observable row count", async () => {
    const fn = await loadConfigured();
    refunded("evt_q343_escrow");
    scenario.reads.jobs = { rows: [{ id: "job-r", customer_id: "p", title: "Job", payment_status: "escrow" }] };
    await post(fn);
    const w = statusWrite();
    expect((w?.payload as Record<string, unknown>).payment_status).toBe("refunded");
    const cas = w?.filters.find((f) => f.column === "payment_status");
    expect(cas?.op).toBe("in");
    expect(cas?.value).not.toContain("released");
    expect(cas?.value).not.toContain("chargeback");
    expect(w?.selectCols).toBe("id");
  });

  for (const prior of ["released", "chargeback"]) {
    it(`a full refund on a '${prior}' job never overwrites it, pages critical, and still writes the ledger`, async () => {
      const fn = await loadConfigured();
      refunded(`evt_q343_${prior}`);
      scenario.reads.jobs = { rows: [{ id: "job-r", customer_id: "p", title: "Job", payment_status: prior }] };
      const res = await post(fn);
      expect(res.status).toBe(200);
      expect(statusWrite()).toBeUndefined();
      expect(alerts().some((x) => x.severity === "critical" && x.title.includes(`'${prior}'`))).toBe(true);
      expect(scenario.writes.some((w) => w.table === "payment_refunds")).toBe(true);
    });
  }

  it("zero rows on a closable state (moved since the read) pages instead of passing silently", async () => {
    const fn = await loadConfigured();
    refunded("evt_q343_zero");
    scenario.reads.jobs = { rows: [{ id: "job-r", customer_id: "p", title: "Job", payment_status: "payout_pending" }] };
    scenario.writeSelectRows["jobs:update"] = [];
    await post(fn);
    expect(alerts().some((x) => /changed underneath/i.test(x.title))).toBe(true);
  });

  it("zero rows because the refund path already wrote 'refunded' is quiet (review L2)", async () => {
    const fn = await loadConfigured();
    refunded("evt_q343_raced");
    scenario.reads.jobs = {
      rows: [{ payment_status: "refunded" }],
      selectOverrides: [{ includes: "customer_id", result: { rows: [{ id: "job-r", customer_id: "p", title: "Job", payment_status: "cancelling" }] } }],
    };
    scenario.writeSelectRows["jobs:update"] = [];
    await post(fn);
    expect(alerts().some((x) => x.severity === "critical")).toBe(false);
  });

  it("an already-refunded job (redelivery, or another path's own write) is a quiet no-op", async () => {
    const fn = await loadConfigured();
    refunded("evt_q343_again");
    scenario.reads.jobs = { rows: [{ id: "job-r", customer_id: "p", title: "Job", payment_status: "refunded" }] };
    await post(fn);
    expect(statusWrite()).toBeUndefined();
    expect(alerts().some((x) => x.severity === "critical")).toBe(false);
  });
});

describe("Q449: a WON chargeback lets a decided split run", () => {
  const HELD_AT = "2026-09-20T00:00:00.000Z";
  function won(id: string) {
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id,
      type: "charge.dispute.closed",
      data: { object: { id: `dp_${id}`, status: "won", amount: 5000, payment_intent: "pi_disputed", charge: "ch_d" } },
    });
  }
  // What rpc_decide_dispute leaves (completed / resolved / disputed_at) after
  // charge.dispute.created blocked the escrow as 'chargeback'.
  const decidedJob = {
    id: "job-decided", customer_id: "p", helper_id: "h", title: "Gutter clean",
    dispute_status: "resolved", disputed_at: HELD_AT,
    payment_status: "chargeback", status: "completed", payout_scheduled_at: null,
  };
  const decidedRow = { id: "d-1", execution_status: "pending", payout_split: { poster: 0.5, helper: 0.5 } };
  const jobUpdates = () => scenario.writes.filter((w) => w.table === "jobs" && w.op === "update");
  const payloadOf = (w: { payload: unknown }) => w.payload as Record<string, unknown>;
  const adminNotes = () => scenario.writes
    .filter((w) => w.table === "notifications" && w.op === "insert")
    .map((w) => w.payload as Record<string, unknown>)
    .filter((n) => n.user_id === "admin-1");

  it("restores the state the DECISION left, KEEPS disputed_at, CAS on status + block + the read dispute_status", async () => {
    const fn = await loadConfigured();
    won("evt_q449_restore");
    scenario.reads.jobs = { rows: [decidedJob] };
    scenario.reads.disputes = { rows: [decidedRow] };
    scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
    const res = await post(fn);
    expect(res.status).toBe(200);
    const restore = jobUpdates().find((w) => "payment_status" in payloadOf(w));
    expect(restore, JSON.stringify(jobUpdates())).toBeDefined();
    // rpc_decide_dispute never touches payment_status or payout_scheduled_at:
    // no schedule means the decision left 'escrow' (preDecisionPaymentStatus),
    // even on a completed job (review LOW-5: payout_pending with no schedule
    // would page money-reconciliation's payout_pending_stranded).
    expect(payloadOf(restore!).payment_status).toBe("escrow");
    expect(payloadOf(restore!).disputed_at).toBe(HELD_AT);
    expect(restore?.filters).toContainEqual({ op: "eq", column: "payment_status", value: "chargeback" });
    expect(restore?.filters).toContainEqual({ op: "eq", column: "status", value: "completed" });
    expect(restore?.filters).toContainEqual({ op: "or", column: "", value: "dispute_status.eq.resolved" });
    expect(restore?.selectCols).toBe("id");
    // The internal dispute's markers are not this outcome's to write.
    for (const w of jobUpdates()) expect(payloadOf(w)).not.toHaveProperty("dispute_status");
    // Admins are told to run the decided split now, and to check first that
    // the charge can still be refunded (unverified in Stripe test mode).
    const note = adminNotes()[0];
    expect(String(note?.title)).toMatch(/still on hold/);
    expect(String(note?.message)).toMatch(/back to escrow/);
    expect(String(note?.message)).toMatch(/Retry settlement/);
    expect(String(note?.message)).toMatch(/can still be refunded/);
    expect(alerts().some((a) => a.severity === "critical")).toBe(false);
  });

  it("a decided job whose payout was already scheduled restores to payout_pending", async () => {
    const fn = await loadConfigured();
    won("evt_q449_sched");
    scenario.reads.jobs = { rows: [{ ...decidedJob, payout_scheduled_at: "2026-09-19T00:00:00.000Z" }] };
    scenario.reads.disputes = { rows: [decidedRow] };
    await post(fn);
    const restore = jobUpdates().find((w) => "payment_status" in payloadOf(w));
    expect(payloadOf(restore!).payment_status).toBe("payout_pending");
  });

  it("with NO internal hold the job stays 'chargeback' (a human confirms before a payout)", async () => {
    const fn = await loadConfigured();
    won("evt_q449_nohold");
    scenario.reads.jobs = { rows: [{ ...decidedJob, dispute_status: "stripe_chargeback" }] };
    await post(fn);
    expect(jobUpdates().some((w) => "payment_status" in payloadOf(w))).toBe(false);
  });

  // lh-money-escrow review, HIGH: every OTHER hold has an automatic settler
  // that lifting the block would switch back on, so the job stays blocked and
  // a person is paged, critical (no admin tool can settle a 'chargeback' job;
  // review LOW-b), with the manual step named.
  const staysBlocked = async (id: string) => {
    expect(jobUpdates().some((w) => "payment_status" in payloadOf(w)), id).toBe(false);
    const page = alerts().find((a) => /settle it by hand/.test(a.title));
    expect(page?.severity, id).toBe("critical");
    expect(page?.message, id).toMatch(/restore its payment state by hand/);
    return page;
  };

  it("an OPEN internal dispute (the 72h sweep would auto-settle it) keeps the job 'chargeback' and pages", async () => {
    const fn = await loadConfigured();
    won("evt_q449_open");
    scenario.reads.jobs = { rows: [{ ...decidedJob, status: "disputed", dispute_status: "open" }] };
    scenario.reads.disputes = {
      rows: [],
      selectOverrides: [{ includes: "opener_id", result: { rows: [{ id: "d-open", status: "open", opener_id: "p" }] } }],
    };
    await post(fn);
    await staysBlocked("open dispute");
  });

  it("a CREW decision (the payout fan-out would run it) keeps the job 'chargeback' and pages", async () => {
    const fn = await loadConfigured();
    won("evt_q449_crew");
    scenario.reads.jobs = { rows: [{ ...decidedJob, is_group_job: false }] };
    scenario.reads.disputes = { rows: [{ ...decidedRow, execution_status: "crew_fanout" }] };
    await post(fn);
    await staysBlocked("crew_fanout");
  });

  it("a legacy GROUP decision (the split refuses group jobs) keeps the job 'chargeback' and pages", async () => {
    const fn = await loadConfigured();
    won("evt_q449_group");
    scenario.reads.jobs = { rows: [{ ...decidedJob, is_group_job: true }] };
    scenario.reads.disputes = { rows: [decidedRow] };
    await post(fn);
    await staysBlocked("group job");
  });

  it("a settlement CLAIM with no decided row behind it keeps the job 'chargeback' and pages", async () => {
    const fn = await loadConfigured();
    won("evt_q449_claim");
    scenario.reads.jobs = { rows: [decidedJob] };
    scenario.reads.disputes = { rows: [] };
    scenario.reads.dispute_settlement_claims = { rows: [{ action: "release", claimed_at: HELD_AT }] };
    await post(fn);
    const page = await staysBlocked("claim");
    // A claim is worded as a claim, never as "dispute unknown is decided" (review LOW-c).
    expect(page?.message).toMatch(/settlement claim is held/);
    expect(page?.message).not.toMatch(/dispute unknown/);
  });

  it("a held job the restore cannot reach (read as 'chargeback', moved since) is not told it 'stays blocked' (review LOW-a)", async () => {
    const fn = await loadConfigured();
    won("evt_q449_copy");
    scenario.reads.jobs = { rows: [decidedJob] };
    scenario.reads.disputes = { rows: [decidedRow] };
    scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
    scenario.writeSelectRows["jobs:update"] = [];
    await post(fn);
    const note = adminNotes()[0];
    expect(String(note?.message)).not.toMatch(/stays blocked/);
    expect(alerts().some((a) => /stays blocked/.test(a.message ?? ""))).toBe(false);
  });

  it("a decided split PLUS a reversed payout keeps the job 'chargeback' and pages", async () => {
    const fn = await loadConfigured();
    won("evt_q449_reversed");
    scenario.reads.jobs = { rows: [decidedJob] };
    scenario.reads.disputes = { rows: [decidedRow] };
    scenario.reads.payout_transfers = { rows: [{ id: "pt-1", status: "reversed", stripe_transfer_id: "tr_rev" }] };
    await post(fn);
    await staysBlocked("reversed transfer");
  });

  it("a restore that matches no row (state moved underneath) pages critical", async () => {
    const fn = await loadConfigured();
    won("evt_q449_zero");
    scenario.reads.jobs = { rows: [decidedJob] };
    scenario.reads.disputes = { rows: [decidedRow] };
    scenario.writeSelectRows["jobs:update"] = [];
    const res = await post(fn);
    expect(res.status).toBe(200);
    expect(alerts().some((a) => a.severity === "critical" && /restore matched no row/.test(a.title))).toBe(true);
  });

  it("a restore DB error pages and throws (Stripe redelivers)", async () => {
    const fn = await loadConfigured();
    won("evt_q449_dberr");
    scenario.reads.jobs = { rows: [decidedJob] };
    scenario.reads.disputes = { rows: [decidedRow] };
    scenario.writeErrors.jobs = { message: "connection reset" };
    const res = await post(fn);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(alerts().some((a) => a.severity === "critical" && /payment state NOT restored/.test(a.title))).toBe(true);
  });

  it("a failed hold read fails closed BEFORE any write (500, Stripe redelivers)", async () => {
    const fn = await loadConfigured();
    won("evt_q449_readerr");
    scenario.reads.jobs = { rows: [decidedJob] };
    scenario.reads.payout_transfers = { error: { message: "boom" } };
    const res = await post(fn);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(jobUpdates()).toHaveLength(0);
    expect(alerts().some((a) => a.severity === "critical" && /HOLD CHECK FAILED/.test(a.title))).toBe(true);
  });
});

describe("Q450: a full refund made outside the split closes a decided dispute", () => {
  function refundedEvent(id: string) {
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id,
      type: "charge.refunded",
      data: { object: { id: `ch_${id}`, payment_intent: "pi_r", amount: 5000, amount_refunded: 5000, currency: "usd", refunds: null } },
    });
  }
  const job = { id: "job-r", customer_id: "p", helper_id: "h", title: "Job", payment_status: "escrow" };
  const closeCalls = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "settle_dispute_by_external_refund");
  const notes = () => scenario.writes
    .filter((w) => w.table === "notifications" && w.op === "insert")
    .map((w) => w.payload as Record<string, unknown>);
  const dashboardRefund = { id: "re_dash", amount: 5000, status: "succeeded", metadata: {} };

  it("closes it with the charge and both amounts, and says what the Helpr is owed", async () => {
    const fn = await loadConfigured();
    refundedEvent("evt_q450_close");
    scenario.reads.jobs = { rows: [job] };
    scenario.reads.disputes = { rows: [{ id: "d-1" }] };
    scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
    stripeMock.refunds.list.mockResolvedValue({ data: [dashboardRefund] });
    scenario.rpc.settle_dispute_by_external_refund = {
      outcome: "closed", dispute_id: "d-1", payout_split: { poster: 0.5, helper: 0.5 },
    };
    const res = await post(fn);
    expect(res.status).toBe(200);
    expect(closeCalls()).toHaveLength(1);
    expect(closeCalls()[0].args).toEqual({
      _job_id: "job-r", _stripe_charge_id: "ch_evt_q450_close", _refunded_cents: 5000, _charge_cents: 5000,
    });
    expect(stripeMock.refunds.list).toHaveBeenCalledWith(expect.objectContaining({ charge: "ch_evt_q450_close" }));
    const read = (scenario.readQueries ?? []).find((q) => q.table === "disputes");
    // A crew decision is READ (to page it) but never closed (the RPC skips it).
    expect(read?.filters).toContainEqual({ op: "or", column: "", value: "execution_status.is.null,execution_status.in.(pending,executing,failed,crew_fanout)" });
    expect(read?.filters).toContainEqual({ op: "eq", column: "status", value: "decided" });
    // A decided Helpr share the platform no longer holds is critical (review LOW-7).
    expect(alerts().find((a) => /dispute closed, nothing left to split/.test(a.title))?.severity).toBe("critical");
    expect(notes().some((n) => n.user_id === "admin-1" && /decided Helpr share unpaid/.test(String(n.title)))).toBe(true);
    const helperNote = notes().filter((n) => n.user_id === "h");
    expect(helperNote).toHaveLength(1);
    expect(helperNote[0].link).toBe("/jobs?job=job-r");
    // The refund's own effects still happen after the close.
    expect(scenario.writes.some((w) => w.table === "payment_refunds")).toBe(false); // refunds: null on the event
    expect(notes().some((n) => n.user_id === "p" && n.title === "Refund processed")).toBe(true);
  });

  it("a CREW decision on the refunded job is handed to a person (the fan-out never runs on a refunded job), before any Stripe read", async () => {
    const fn = await loadConfigured();
    refundedEvent("evt_q450_crew");
    scenario.reads.jobs = { rows: [job] };
    scenario.reads.disputes = { rows: [{ id: "d-crew", execution_status: "crew_fanout" }] };
    const res = await post(fn);
    expect(res.status).toBe(200);
    expect(closeCalls()).toHaveLength(0);
    expect(stripeMock.refunds.list).not.toHaveBeenCalled();
    const page = alerts().find((a) => /settle it by hand/.test(a.title));
    expect(page?.severity).toBe("critical");
    expect(page?.message).toMatch(/crew decision/);
  });

  it("the split's OWN refund (metadata.dispute_id) is never closed here: the split records itself", async () => {
    const fn = await loadConfigured();
    refundedEvent("evt_q450_own");
    scenario.reads.jobs = { rows: [job] };
    scenario.reads.disputes = { rows: [{ id: "d-1" }] };
    stripeMock.refunds.list.mockResolvedValue({ data: [{ ...dashboardRefund, id: "re_split", metadata: { dispute_id: "d-1" } }] });
    const res = await post(fn);
    expect(res.status).toBe(200);
    expect(closeCalls()).toHaveLength(0);
    expect(alerts().some((a) => a.severity === "critical")).toBe(false);
  });

  it("a charge with BOTH the split's refund and an outside one pages critical and closes nothing", async () => {
    const fn = await loadConfigured();
    refundedEvent("evt_q450_mixed");
    scenario.reads.jobs = { rows: [job] };
    scenario.reads.disputes = { rows: [{ id: "d-1" }] };
    stripeMock.refunds.list.mockResolvedValue({
      data: [{ ...dashboardRefund, amount: 2000 }, { ...dashboardRefund, id: "re_split", amount: 3000, metadata: { dispute_id: "d-1" } }],
    });
    await post(fn);
    expect(closeCalls()).toHaveLength(0);
    expect(alerts().some((a) => a.severity === "critical" && /settle it by hand/.test(a.title))).toBe(true);
  });

  it("no decided dispute waiting: no Stripe read and no close (the common refund pays nothing extra)", async () => {
    const fn = await loadConfigured();
    refundedEvent("evt_q450_none");
    scenario.reads.jobs = { rows: [job] };
    scenario.reads.disputes = { rows: [] };
    await post(fn);
    expect(stripeMock.refunds.list).not.toHaveBeenCalled();
    expect(closeCalls()).toHaveLength(0);
  });

  it("a run in flight ('busy') throws before the ledger row and the notice, so Stripe redelivers", async () => {
    const fn = await loadConfigured();
    refundedEvent("evt_q450_busy");
    scenario.reads.jobs = { rows: [job] };
    scenario.reads.disputes = { rows: [{ id: "d-1" }] };
    stripeMock.refunds.list.mockResolvedValue({ data: [dashboardRefund] });
    scenario.rpc.settle_dispute_by_external_refund = { outcome: "busy", dispute_id: "d-1" };
    const res = await post(fn);
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(notes().some((n) => n.title === "Refund processed")).toBe(false);
  });

  it("needs_human pages critical with the reason (200: nothing to retry)", async () => {
    const fn = await loadConfigured();
    refundedEvent("evt_q450_human");
    scenario.reads.jobs = { rows: [job] };
    scenario.reads.disputes = { rows: [{ id: "d-1" }] };
    stripeMock.refunds.list.mockResolvedValue({ data: [dashboardRefund] });
    scenario.rpc.settle_dispute_by_external_refund = {
      outcome: "needs_human", dispute_id: "d-1", reason: "a gift card funded part of this job",
      payout_split: { poster: 0.5, helper: 0.5 },
    };
    const res = await post(fn);
    expect(res.status).toBe(200);
    const a = alerts().find((x) => /settle it by hand/.test(x.title));
    expect(a?.severity).toBe("critical");
    expect(a?.message).toMatch(/gift card funded part/);
  });

  it("a DB error on the close pages and throws; a failed refund list throws before the RPC", async () => {
    const fn = await loadConfigured();
    refundedEvent("evt_q450_err");
    scenario.reads.jobs = { rows: [job] };
    scenario.reads.disputes = { rows: [{ id: "d-1" }] };
    stripeMock.refunds.list.mockResolvedValue({ data: [dashboardRefund] });
    scenario.rpcErrors = { settle_dispute_by_external_refund: { message: "connection reset" } };
    expect((await post(fn)).status).toBeGreaterThanOrEqual(500);
    expect(alerts().some((a) => a.severity === "critical" && /dispute NOT closed \(DB error\)/.test(a.title))).toBe(true);

    resetSupabaseMock();
    resetSharedMocks();
    const fn2 = await loadConfigured();
    refundedEvent("evt_q450_listerr");
    scenario.reads.jobs = { rows: [job] };
    scenario.reads.disputes = { rows: [{ id: "d-1" }] };
    stripeMock.refunds.list.mockRejectedValue(new Error("stripe down"));
    expect((await post(fn2)).status).toBeGreaterThanOrEqual(500);
    expect(closeCalls()).toHaveLength(0);
  });

  it("a job the refund could not close ('released') never reaches the decided-dispute close", async () => {
    const fn = await loadConfigured();
    refundedEvent("evt_q450_released");
    scenario.reads.jobs = { rows: [{ ...job, payment_status: "released" }] };
    scenario.reads.disputes = { rows: [{ id: "d-1" }] };
    await post(fn);
    expect(closeCalls()).toHaveLength(0);
    expect(stripeMock.refunds.list).not.toHaveBeenCalled();
  });
});
