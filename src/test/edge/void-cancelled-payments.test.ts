/**
 * void-cancelled-payments must not refund an escrow an admin's dispute
 * decision owns.
 *
 * rpc_decide_dispute moves a poster-wins decision to status 'cancelled' with
 * the escrow still held for execute-dispute-split — the exact cancelled +
 * escrow shape Part A refunds by the cancellation rules. Both then refunded the
 * same charge; a party re-file + withdraw + poster_cancel_job reached it for
 * any decision (lh-authz-rls review, dispute-races round 2).
 *
 * Runs the REAL function source via the edge harness.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { testModeUnderLiveKey, captureTestModeSkips } from "../helpers/testModeUnderLiveKey";

const CRON_SECRET = "cron-secret-void";

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

function seedCancelledEscrowJob() {
  scenario.reads.jobs = {
    selectOverrides: [
      {
        // Part A's read — the only jobs select that names cancellation_fee.
        includes: "cancellation_fee",
        result: {
          rows: [{
            id: "job-decided",
            title: "Decided for the poster",
            stripe_session_id: null,
            stripe_payment_intent_id: "pi_decided",
            budget: 100,
            customer_fee_amount: 10,
            cancellation_fee: 0,
            date_needed: null,
            start_time: null,
            cancelled_at: null,
            helper_id: "helper-1",
            helper_confirmed_at: null,
            customer_id: "poster-1",
            helper_fee_percent: 10,
          }],
        },
      },
    ],
    rows: [],
  };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_decided", status: "succeeded", amount: 11000, amount_received: 11000, latest_charge: null,
  });
  stripeMock.refunds.create.mockResolvedValue({ id: "re_void", amount: 10000 });
}

describe("void-cancelled-payments — an unexecuted dispute decision owns the escrow", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });

  it("does NOT refund a cancelled + escrow job carrying a decided, unexecuted dispute", async () => {
    seedCancelledEscrowJob();
    scenario.reads.disputes = { rows: [{ id: "dispute-1", execution_status: "pending", payout_split: { poster: 1, helper: 0 } }] };
    const h = await load();
    const res = await h.fetch(cronReq());
    const body = JSON.parse(await res.text());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    // Nor the Helpr's cancellation fee: a poster-wins decision is `cancelled`,
    // and Part A pays that fee from the same charge.
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(scenario.writes.filter((w) => w.table === "jobs")).toHaveLength(0);
    // Matched on the serialized results: the fixture-schema guard reads a
    // `status:` literal beside a `disputes` read as a disputes row.
    expect(JSON.stringify(body.results)).toContain('"job_id":"job-decided","title":"Decided for the poster","status":"dispute_decision_pending"');
    expect(res.status).toBe(200);
  });

  it("fails CLOSED when the dispute check cannot be read: no refund, and the run reports a defect", async () => {
    seedCancelledEscrowJob();
    scenario.reads.disputes = { error: { message: "read blew up" } };
    const h = await load();
    const res = await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
  });

  it("does NOT refund while a dispute settlement claim is held (a withdrawal took the job out of disputed under it)", async () => {
    seedCancelledEscrowJob();
    scenario.reads.dispute_settlement_claims = { rows: [{ action: "release", claimed_at: "2026-09-14T20:00:00Z" }] };
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("does NOT refund a cancelled + escrow job whose escrow already went to the Helpr (a live payout_transfers row) — pages critical (round 3, H1)", async () => {
    // A Quick Release that transferred and then could not flip leaves the job
    // disputed with a paid ledger row; a withdrawal + poster_cancel_job then
    // lands it here as cancelled + escrow, and the cancellation refund paid
    // the poster on top of the Helpr.
    seedCancelledEscrowJob();
    scenario.reads.payout_transfers = { rows: [{ id: "pt-1", status: "paid" }] };
    const h = await load();
    const res = await h.fetch(cronReq());
    const body = JSON.parse(await res.text());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(scenario.writes.filter((w) => w.table === "jobs")).toHaveLength(0);
    expect(JSON.stringify(body.results)).toContain('"job_id":"job-decided","title":"Decided for the poster","status":"escrow_already_released"');
    expect((slackAlerts as Array<{ title?: string; severity?: string }>).some(
      (a) => a.title === "Cancelled job NOT refunded — its escrow was already paid to the Helpr" && a.severity === "critical",
    )).toBe(true);
    expect(res.status).toBe(500);
  });

  it("fails CLOSED when the payout ledger cannot be read: no refund, defect (round 3, H1)", async () => {
    seedCancelledEscrowJob();
    scenario.reads.payout_transfers = { error: { message: "ledger read blew up" } };
    const h = await load();
    const res = await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
  });

  it("does NOT refund when Stripe shows a live transfer for the job that is not this loop's cancellation fee (round 5)", async () => {
    seedCancelledEscrowJob();
    stripeMock.transfers.list.mockResolvedValue({
      data: [{ id: "tr_quick", amount: 8800, amount_reversed: 0, metadata: { job_id: "job-decided", initiated_by: "admin" } }],
    });
    const h = await load();
    const res = await h.fetch(cronReq());
    const body = JSON.parse(await res.text());
    expect(stripeMock.transfers.list).toHaveBeenCalledWith(expect.objectContaining({ transfer_group: "job_job-decided" }));
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(JSON.stringify(body.results)).toContain('"status":"escrow_already_released"');
    expect(res.status).toBe(500);
  });

  it("control: an earlier run's own cancellation-fee transfer does not block the settlement (round 5)", async () => {
    seedCancelledEscrowJob();
    stripeMock.transfers.list.mockResolvedValue({
      data: [{ id: "tr_fee", amount: 900, amount_reversed: 0, metadata: { job_id: "job-decided", type: "cancellation_fee" } }],
    });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalled();
  });

  it("fails CLOSED when the Stripe transfer list cannot be read (round 5)", async () => {
    seedCancelledEscrowJob();
    stripeMock.transfers.list.mockRejectedValue(new Error("stripe down"));
    const h = await load();
    const res = await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
  });

  it("control: with no dispute decision the job still proceeds to its refund checks", async () => {
    seedCancelledEscrowJob();
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalled();
  });
});

// ── Q891: a Stripe id minted under the TEST key, read under the LIVE key ────
//
// Every job funded before prod went live (2026-09-27) holds one, and Stripe
// answers 404 resource_missing "a similar object exists in test mode". No real
// money sits behind it, so the row is skipped (or, for a never-paid checkout,
// abandoned exactly as a missing session is) with ONE structured log line:
// never a 500, never a defect, never a page, never a refund/capture/cancel or
// transfer. Every other error keeps the behaviour it had (the controls).
describe("void-cancelled-payments — Q891: a test-mode Stripe object under the live key", () => {
  let skips: ReturnType<typeof captureTestModeSkips>;
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
    skips = captureTestModeSkips();
  });
  afterEach(() => {
    skips.restore();
  });

  const run = async () => {
    const h = await load();
    const res = await h.fetch(cronReq());
    return { res, body: JSON.parse(await res.text()) as Record<string, unknown> };
  };

  /** Part B (open + unpaid) or Part B2 (cancelled + unpaid) holds one job on `cs_test_old`. */
  function seedUnpaidCheckout(part: "B" | "B2") {
    const row = { id: "job-unpaid", title: "Never paid", stripe_session_id: "cs_test_old", is_seed: false };
    scenario.reads.jobs = {
      selectOverrides: [
        // Part A (and the D/E retry reads that also name cancellation_fee): nothing.
        { includes: "cancellation_fee", result: { rows: [] } },
        // Part B2's read — the only jobs select that names is_seed.
        { includes: "is_seed", result: { rows: part === "B2" ? [row] : [] } },
        // Part B's read: exactly "id, title, stripe_session_id".
        { includes: "id, title, stripe_session_id", result: { rows: part === "B" ? [row] : [] } },
      ],
      rows: [],
    };
  }

  const abandonWrites = () =>
    scenario.writes.filter(
      (w) => w.table === "jobs" && w.op === "update" && (w.payload as Record<string, unknown>).payment_status === "abandoned",
    );

  function expectCleanRun(res: Response, body: Record<string, unknown>) {
    expect(res.status).toBe(200);
    expect(body.defects).toBe(0);
    expect(body.defectReasons).toBeUndefined();
    expect(slackAlerts).toHaveLength(0);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(stripeMock.paymentIntents.cancel).not.toHaveBeenCalled();
    expect(scenario.writes.some((w) => w.table === "payout_transfers" || w.table === "cancellation_fee_transfers" || w.table === "payment_refunds")).toBe(false);
  }

  // Red on the old code by the log line alone: the test-mode error is ALSO a
  // 404 resource_missing, so the old catch abandoned it as "session 404".
  // @mutate supabase/functions/void-cancelled-payments/index.ts | logTestObjectUnderLiveKey("void-cancelled-payments", { job_id: job.id, object: "checkout.session", id: job.stripe_session_id });\n          if (await markAbandoned(job, "test-mode session")) abandonedCount++; | throw e;
  it("Part B: an open unpaid job on a TEST-mode checkout session is abandoned, named in one structured line, no defect", async () => {
    seedUnpaidCheckout("B");
    stripeMock.checkout.sessions.retrieve.mockRejectedValue(testModeUnderLiveKey("checkout.session", "cs_test_old"));
    const { res, body } = await run();
    expectCleanRun(res, body);
    expect(body.abandoned).toBe(1);
    expect(abandonWrites()).toHaveLength(1);
    expect(abandonWrites()[0].filters).toEqual(expect.arrayContaining([{ op: "eq", column: "id", value: "job-unpaid" }]));
    expect(stripeMock.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(skips.lines()).toEqual([
      expect.objectContaining({ fn: "void-cancelled-payments", object: "checkout.session", id: "cs_test_old", job_id: "job-unpaid" }),
    ]);
  });

  it("Part B control: a transient Stripe error (503) still leaves the job alone for the next run, and writes no test-mode line", async () => {
    seedUnpaidCheckout("B");
    stripeMock.checkout.sessions.retrieve.mockRejectedValue(
      Object.assign(new Error("Stripe is down"), { type: "StripeAPIError", statusCode: 503 }),
    );
    const { body } = await run();
    expect(body.abandoned).toBe(0);
    expect(abandonWrites()).toHaveLength(0);
    expect(skips.lines()).toEqual([]);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | logTestObjectUnderLiveKey("void-cancelled-payments", { job_id: job.id, object: "checkout.session", id: job.stripe_session_id });\n          if (await markAbandoned(job, "cancelled, test-mode session")) abandonedCount++; | throw e;
  it("Part B2: a cancelled unpaid job on a TEST-mode checkout session is abandoned, named in one structured line, no defect", async () => {
    seedUnpaidCheckout("B2");
    stripeMock.checkout.sessions.retrieve.mockRejectedValue(testModeUnderLiveKey("checkout.session", "cs_test_old"));
    const { res, body } = await run();
    expectCleanRun(res, body);
    expect(body.abandoned).toBe(1);
    expect(abandonWrites()).toHaveLength(1);
    expect(stripeMock.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(skips.lines()).toEqual([
      expect.objectContaining({ fn: "void-cancelled-payments", object: "checkout.session", id: "cs_test_old", job_id: "job-unpaid" }),
    ]);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | logTestObjectUnderLiveKey("void-cancelled-payments", { job_id: job.id, object: "checkout.session", id: job.stripe_session_id });\n            results.push({ job_id: job.id, title: job.title, status: "skipped_test_mode_object", skipped: true }); | throw e;
  it("Part A: a cancelled escrow job whose SESSION (to resolve its PaymentIntent) is a test-mode object is skipped, not settled, no defect", async () => {
    seedCancelledEscrowJob();
    const partA = (scenario.reads.jobs as { selectOverrides: Array<{ result: { rows: Array<Record<string, unknown>> } }> }).selectOverrides[0].result.rows[0];
    Object.assign(partA, { stripe_payment_intent_id: null, stripe_session_id: "cs_test_old" });
    stripeMock.checkout.sessions.retrieve.mockRejectedValue(testModeUnderLiveKey("checkout.session", "cs_test_old"));
    const { res, body } = await run();
    expectCleanRun(res, body);
    expect(body.results).toEqual([
      expect.objectContaining({ job_id: "job-decided", status: "skipped_test_mode_object", skipped: true }),
    ]);
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(scenario.writes.filter((w) => w.table === "jobs")).toHaveLength(0);
    expect(skips.lines()).toEqual([
      expect.objectContaining({ fn: "void-cancelled-payments", object: "checkout.session", id: "cs_test_old", job_id: "job-decided" }),
    ]);
  });

  // @mutate supabase/functions/void-cancelled-payments/index.ts | logTestObjectUnderLiveKey("void-cancelled-payments", { job_id: job.id, object: "payment_intent", id: paymentIntentId }); | throw e;
  it("Part A: a cancelled escrow job whose PaymentIntent is a test-mode object is skipped: no refund, capture, cancel or fee transfer, not settled, no defect", async () => {
    seedCancelledEscrowJob();
    stripeMock.paymentIntents.retrieve.mockRejectedValue(testModeUnderLiveKey("payment_intent", "pi_decided"));
    const { res, body } = await run();
    expectCleanRun(res, body);
    expect(body.refunded).toBe(0);
    expect(body.results).toEqual([
      expect.objectContaining({ job_id: "job-decided", status: "skipped_test_mode_object", skipped: true }),
    ]);
    expect(scenario.writes.filter((w) => w.table === "jobs")).toHaveLength(0);
    expect(skips.lines()).toEqual([
      expect.objectContaining({ fn: "void-cancelled-payments", object: "payment_intent", id: "pi_decided", job_id: "job-decided" }),
    ]);
  });

  it("Part A control: any OTHER PaymentIntent read error keeps its old 'error' row, no refund, and no test-mode line", async () => {
    seedCancelledEscrowJob();
    stripeMock.paymentIntents.retrieve.mockRejectedValue(
      Object.assign(new Error("Stripe is down"), { type: "StripeAPIError", statusCode: 503 }),
    );
    const { body } = await run();
    expect(body.results).toEqual([expect.objectContaining({ job_id: "job-decided", status: "error" })]);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(scenario.writes.filter((w) => w.table === "jobs")).toHaveLength(0);
    expect(skips.lines()).toEqual([]);
  });
});

// Proof this guard can fail: ignore the unsettled-dispute verdict and the loop
// refunds a cancelled job whose escrow a dispute decision still owns — refund
// plus split on one charge, the double-settle this file exists to prevent.
// @mutate supabase/functions/void-cancelled-payments/index.ts | if (settlement.blocked) { | if (false) {
// @mutate supabase/functions/void-cancelled-payments/index.ts | if ((livePayouts ?? []).length > 0) { | if (false) {

// ── Q1345: the uncaptured-hold path stamps the fee it captured ─────────────
//
// On a requires_capture PaymentIntent the cron captures ONLY the fee and
// releases the rest. The amount lived only in Stripe: the job row kept the
// client-written cancellation_fee, which Spent and the fee pill read. The
// settle write now carries the fee this capture charged.
// @mutate supabase/functions/void-cancelled-payments/index.ts |               cancellation_fee_status: "charged",\n              cancellation_fee: cancellationFee,\n | cancellation_fee_status: "charged",\n
describe("void-cancelled-payments — Q1345: a fee captured from an uncaptured hold is stamped on the job", () => {
  beforeEach(() => {
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });
  afterEach(() => resetEnv());

  it("the settle write stamps cancellation_fee = the captured amount, not the client-written figure", async () => {
    scenario.reads.jobs = {
      selectOverrides: [{
        includes: "cancellation_fee",
        result: {
          rows: [{
            id: "job-hold", title: "Late cancel on a hold", stripe_session_id: null, stripe_payment_intent_id: "pi_hold",
            budget: 100, customer_fee_amount: 10,
            // Client-written and wrong on purpose: the stamp must not echo it.
            cancellation_fee: 99,
            date_needed: "2024-10-20", start_time: "10:00:00", cancelled_at: "2024-10-20T13:00:00.000Z",
            helper_id: "helper-1", helper_confirmed_at: "2024-10-18T12:00:00.000Z",
            customer_id: "poster-1", helper_fee_percent: 10,
          }],
        },
      }],
      rows: [],
    };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_hold", status: "requires_capture", amount: 11000, amount_received: 0, latest_charge: null,
    });
    stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.paymentIntents.capture).toHaveBeenCalledTimes(1);
    const capturedCents = stripeMock.paymentIntents.capture.mock.calls[0][1].amount_to_capture as number;
    expect(capturedCents).toBeGreaterThan(0);
    const settle = scenario.writes.find((w) => w.table === "jobs" && w.op === "update" &&
      (w.payload as Record<string, unknown>).cancellation_fee_status === "charged");
    expect(settle, "no settle write with cancellation_fee_status 'charged'").toBeDefined();
    expect((settle!.payload as Record<string, unknown>).cancellation_fee).toBe(capturedCents / 100);
  });
});

// ── Q1675: an earlier refund on the same charge comes off this refund ────────
//
// settleOnboardingFee refunds a duplicate $2 setup fee off the job's own
// charge (payment_refunds source duplicate_onboarding_fee, job_id NULL), and
// pi.amount_received does not go down after it, so this cancellation refunded
// the $2 a second time out of platform money. The charge's amount_refunded is
// now subtracted (lh-money-escrow@c4e1df1bb#4).
describe("void-cancelled-payments — Q1675: a charge already partly refunded", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });

  // $100 job + $10 fee = $110 captured; the fee is kept, so $100 is refundable,
  // less the $2 duplicate setup fee already refunded = $98.
  // @mutate supabase/functions/void-cancelled-payments/index.ts |             alreadyRefundedCents: chargeRefundedCents,\n |
  it("a prior duplicate $2 setup-fee refund is not refunded again", async () => {
    seedCancelledEscrowJob();
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_decided", status: "succeeded", amount: 11000, amount_received: 11000,
      latest_charge: { id: "ch_dup", amount: 11000, amount_refunded: 200, balance_transaction: { fee: 349 } },
    });
    stripeMock.refunds.create.mockResolvedValue({ id: "re_void", amount: 9800 });
    scenario.writeSelectRows.notifications = [{ id: "notice-v" }];
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_decided", amount: 9800 },
      { idempotencyKey: "cancel-refund-job-decided" },
    );
    // The notice keeps only the $10 fee: the $2 already went back, it was not kept.
    // @mutate supabase/functions/void-cancelled-payments/index.ts |                 keptCents: Math.max(0, capturedCents - chargeRefundedCents - refundedCents), |                 keptCents: Math.max(0, capturedCents - refundedCents),
    const notice = scenario.writes
      .filter((w) => w.table === "notifications" && w.op === "insert")
      .map((w) => String((w.payload as Record<string, unknown>).message ?? ""))
      .find((m) => m.includes("We kept"));
    expect(notice).toMatch(/We kept \$10(\.00)?\b/);
  });

  // lh-money-escrow review of Q1675 #1: earlier refunds that returned MORE
  // than this cancel may ($105 back of $110, $100 refundable) are paged and the job
  // is left alone; settling would pay the Helpr's fee out of money that
  // already went back to the poster.
  // @mutate supabase/functions/void-cancelled-payments/index.ts |           if (chargeRefundedCents > voidSplit.ceilingCents + 1) { |           if (false) {
  it("a charge already refunded past what the cancel keeps is not settled and pages", async () => {
    seedCancelledEscrowJob();
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_decided", status: "succeeded", amount: 11000, amount_received: 11000,
      latest_charge: { id: "ch_over", amount: 11000, amount_refunded: 10500, balance_transaction: { fee: 349 } },
    });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(slackAlerts.map((a) => (a as { title?: string }).title)).toContain("Cancelled job's charge was already refunded past what the cancel keeps");
    const settle = scenario.writes.filter((w) => w.table === "jobs" && w.op === "update" &&
      (w.payload as Record<string, unknown>).payment_status === "refunded");
    expect(settle).toHaveLength(0);
  });

  // A charge Stripe already shows refunded down to what this cancel keeps (its
  // own refund whose ledger row was lost, past the 24 h key) settles the status
  // only: the old fallback refunded the whole refundable amount again.
  // @mutate supabase/functions/void-cancelled-payments/index.ts |           const alreadyRefunded = (priorRefunds ?? []).length > 0 \|\| refundedAtStripe; |           const alreadyRefunded = (priorRefunds ?? []).length > 0;
  it("a charge already refunded to the kept amount is not refunded again", async () => {
    seedCancelledEscrowJob();
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_decided", status: "succeeded", amount: 11000, amount_received: 11000,
      latest_charge: { id: "ch_done", amount: 11000, amount_refunded: 10000, balance_transaction: { fee: 349 } },
    });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    // Settled as already refunded, not reported as a $0 cancellation.
    expect(slackAlerts.map((a) => (a as { title?: string }).title)).not.toContain("Escrow cancellation resolved with $0 refund");
  });

  it("control: a charge with no earlier refund is refunded in full less the kept fee", async () => {
    seedCancelledEscrowJob();
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_decided", status: "succeeded", amount: 11000, amount_received: 11000,
      latest_charge: { id: "ch_none", amount: 11000, amount_refunded: 0, balance_transaction: { fee: 349 } },
    });
    const h = await load();
    await h.fetch(cronReq());
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_decided", amount: 10000 },
      { idempotencyKey: "cancel-refund-job-decided" },
    );
  });
});
