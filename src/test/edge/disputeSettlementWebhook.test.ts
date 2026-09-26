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
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | if (outcome === "no_unsettled_dispute") return; | if (outcome !== "closed") return;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | _disputed_cents: dispute.amount, | _disputed_cents: chargeCents,
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | .in("payment_status", [...REFUND_CLOSABLE_PAYMENT_STATES]) | .neq("id", "")
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | "escrow", "payout_pending", "cancelling", | "escrow", "payout_pending", "cancelling", "released", "chargeback",
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | if (decidedClose !== "closed" && lost.rows === 0 | if (lost.rows === 0
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | && nowStatus !== "refunded") { | ) {
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
