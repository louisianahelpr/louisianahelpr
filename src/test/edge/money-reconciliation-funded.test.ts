/**
 * money-reconciliation: a FUNDED job whose PaymentIntent failed (docs/OPEN.md Q1974).
 *
 * THE GAP. The Stripe comparison (Q50) only asked Stripe about jobs the DB
 * says are settled, and returned early on any PaymentIntent that was not
 * succeeded. A job still in 'escrow' / 'payout_pending' whose payment failed
 * (a bounced bank debit, a refused capture, an expired card hold) is flipped
 * to 'failed' only by the webhook. If that event is missed the job stays
 * "funded" and a payout run would pay the Helpr money that was never
 * collected; nothing noticed.
 *
 * Runs the REAL function source through the edge harness, Stripe mocked.
 *
 * RED WITH THE CHECK REMOVED (each mutation turns a named test red):
 * @mutate supabase/functions/money-reconciliation/index.ts | if (FAILED_PI_STATUSES.has(piStatus)) { | if (false) {
 * @mutate supabase/functions/money-reconciliation/index.ts | (j.payment_status === "escrow" \|\| j.payment_status === "payout_pending") && | j.payment_status === "escrow" &&
 * @mutate supabase/functions/money-reconciliation/index.ts | const FAILED_PI_STATUSES = new Set(["requires_payment_method", "canceled"]); | const FAILED_PI_STATUSES = new Set(["requires_payment_method"]);
 * @mutate supabase/functions/money-reconciliation/index.ts | fundedFailures.push(`${job.id}: PaymentIntent ${piId} came back with no status`); | void 0;
 * @mutate supabase/functions/money-reconciliation/index.ts | if (job.is_seed !== true) checks.stripeTestObjectOnRealJob.add({ job_id: job.id, payment_intent: piId, phase: "funded" }); |
 * @mutate supabase/functions/money-reconciliation/index.ts | if (Date.now() - fundedStartedMs > FUNDED_STRIPE_PHASE_BUDGET_MS) { | if (false) {
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { testModeUnderLiveKey, captureTestModeSkips } from "../helpers/testModeUnderLiveKey";

const CRON_SECRET = "cron-secret";
const DAY = 86_400_000;
const CHECK = "stripe_payment_failed_on_funded_job";

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

/** An open, funded $25 job five days out, nobody hired yet. */
function fundedJob(over: Record<string, unknown> = {}) {
  return {
    id: "job-f",
    is_seed: false,
    status: "open",
    payment_status: "escrow",
    budget: 25,
    customer_fee_amount: 3,
    stripe_payment_intent_id: "pi_f",
    date_needed: new Date(Date.now() + 5 * DAY).toISOString(),
    start_time: null,
    cancelled_at: null,
    helper_id: null,
    helper_confirmed_at: null,
    cancellation_fee: 0,
    cancellation_fee_status: null,
    late_cancellation: false,
    platform_fee_amount: null,
    helper_fee_percent: null,
    is_group_job: false,
    helpers_needed: 1,
    has_active_dispute: false,
    dispute_status: null,
    poster_completed_at: null,
    helper_completed_at: null,
    payout_scheduled_at: null,
    updated_at: new Date(Date.now() - DAY).toISOString(),
    ...over,
  };
}

function seed(jobs: Array<Record<string, unknown>> = [fundedJob()]) {
  scenario.reads.jobs = { rows: jobs };
  scenario.reads.payout_transfers = { rows: [] };
  scenario.reads.disputes = { rows: [] };
  scenario.reads.profiles = { rows: [] };
  scenario.reads.gift_cards = { rows: [] };
  scenario.reads.payment_refunds = { rows: [] };
}

const pi = (status: string) => ({ id: "pi_f", status, amount: 2800, amount_received: status === "succeeded" ? 2800 : 0, amount_capturable: 0, latest_charge: null });

const finding = (b: Record<string, any>, check: string) =>
  (b.findings as Array<{ check: string; severity: string; count: number; sample: any[] }>).find((f) => f.check === check);

describe("money-reconciliation — funded job whose PaymentIntent failed (Q1974)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
  });

  it("pages CRITICAL when an escrow job's PaymentIntent is requires_payment_method (payment failed, webhook missed)", async () => {
    const fn = await load();
    seed();
    stripeMock.paymentIntents.retrieve.mockResolvedValue(pi("requires_payment_method"));

    const { res, b } = await run(fn);

    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledWith("pi_f");
    const f = finding(b, CHECK);
    expect(f).toMatchObject({ severity: "critical", count: 1 });
    expect(f!.sample[0]).toMatchObject({ job_id: "job-f", payment_intent: "pi_f", db_payment_status: "escrow", stripe_status: "requires_payment_method" });
    expect(b.checks_run).toContain(CHECK);
    expect(b.scanned.stripe_funded_payment_intents).toBe(1);
    expect(res.status).toBe(500);
    expect(slackAlerts.some((a: any) => a.kind === "money_at_risk" && JSON.stringify(a.fields ?? {}).includes(CHECK))).toBe(true);
  });

  it("pages CRITICAL when a payout_pending job's PaymentIntent is canceled (hold expired or voided)", async () => {
    const fn = await load();
    seed([fundedJob({ payment_status: "payout_pending", helper_id: "helper-1" })]);
    stripeMock.paymentIntents.retrieve.mockResolvedValue(pi("canceled"));

    const { b } = await run(fn);
    expect(finding(b, CHECK)).toMatchObject({ severity: "critical", count: 1 });
    expect(finding(b, CHECK)!.sample[0]).toMatchObject({ db_payment_status: "payout_pending", stripe_status: "canceled" });
  });

  it("stays silent on a funded job whose money is held, arriving or captured", async () => {
    for (const status of ["succeeded", "requires_capture", "processing"]) {
      resetSupabaseMock();
      resetSharedMocks();
      resetStripeMock();
      const fn = await load();
      seed();
      stripeMock.paymentIntents.retrieve.mockResolvedValue(pi(status));
      const { b } = await run(fn);
      expect(finding(b, CHECK), status).toBeUndefined();
      expect(b.scanned.stripe_funded_payment_intents, status).toBe(1);
    }
  });

  it("does not ask Stripe about an unfunded job or a funded job with no PaymentIntent", async () => {
    const fn = await load();
    seed([
      fundedJob({ id: "job-u", payment_status: "unpaid" }),
      fundedJob({ id: "job-g", stripe_payment_intent_id: null }),
    ]);
    stripeMock.paymentIntents.retrieve.mockResolvedValue(pi("requires_payment_method"));
    const { b } = await run(fn);
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(finding(b, CHECK)).toBeUndefined();
  });

  it("an answer with no status is unverified (the run is degraded), never 'not failed'", async () => {
    const fn = await load();
    seed();
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_f" });
    const { b } = await run(fn);
    expect(finding(b, CHECK)).toBeUndefined();
    expect((b.notes as string[]).join(" ")).toMatch(/funded-job stripe check incomplete: 1 of 1/);
  });

  it("a read that fails is reported as incomplete, not clean", async () => {
    const fn = await load();
    seed();
    stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error("connection reset"));
    const { b } = await run(fn);
    expect((b.notes as string[]).join(" ")).toMatch(/funded-job stripe check incomplete: 1 of 1 .*connection reset/);
  });

  it("a missing PaymentIntent is stripe_payment_intent_not_found", async () => {
    const fn = await load();
    seed();
    stripeMock.paymentIntents.retrieve.mockRejectedValue(Object.assign(new Error("No such payment_intent"), { statusCode: 404, code: "resource_missing" }));
    const { b } = await run(fn);
    expect(finding(b, "stripe_payment_intent_not_found")).toMatchObject({ count: 1 });
  });

  describe("a test-mode PaymentIntent under the live key", () => {
    let cap: ReturnType<typeof captureTestModeSkips>;
    beforeEach(() => {
      cap = captureTestModeSkips();
    });
    afterEach(() => cap.restore());

    it("on a REAL funded job is a stripe_test_object_on_real_job finding", async () => {
      const fn = await load();
      seed();
      stripeMock.paymentIntents.retrieve.mockRejectedValue(testModeUnderLiveKey("payment_intent", "pi_f"));
      const { b } = await run(fn);
      expect(finding(b, "stripe_test_object_on_real_job")).toMatchObject({ count: 1 });
      expect(finding(b, "stripe_payment_intent_not_found")).toBeUndefined();
    });
  });

  it("stops at its own budget and reports a truncated scan, never a quiet sample", async () => {
    const fn = await load();
    seed(Array.from({ length: 25 }, (_, i) => fundedJob({ id: `job-${i}`, stripe_payment_intent_id: `pi_${i}` })));
    let now = 1_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    stripeMock.paymentIntents.retrieve.mockImplementation(async () => {
      now += 1_000; // each read "takes" 1 s, so the 8 s budget runs out
      return pi("succeeded");
    });
    try {
      const { b } = await run(fn);
      expect(JSON.stringify(b)).toMatch(/funded-job stripe check stopped at its 8s budget/);
      expect(stripeMock.paymentIntents.retrieve.mock.calls.length).toBeLessThan(25);
    } finally {
      spy.mockRestore();
    }
  });
});
