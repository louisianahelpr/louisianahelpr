/**
 * The Helpr-fault card-fee deduction follows the money on release-payout and
 * process-scheduled-payouts (lh-money-escrow reviews of c4ec33afb #5,
 * b1730c932 #3 #5, the exact-cents delta #5 #6 #7):
 *   - a transfer error that is NOT a definite Stripe refusal (a timeout may
 *     have created the transfer with the fee held back) keeps the deduction
 *     booked; only a definite refusal gives it back;
 *   - a transfer at Stripe the ledger does not record (the 'conflict' exit)
 *     keeps it booked and names it in the page;
 *   - adopting an orphaned transfer settles the ledger with THAT transfer's
 *     amount and books what IT withheld (its metadata), not this run's take;
 *   - once money moved, the booked deduction is set to what the transfer
 *     withheld (set_helpr_fault_fee_withheld), which also undoes another run's
 *     restore racing this one; a debt already gone (booked < withheld) pages.
 * SQL side (the true-up and the cap clamp): src/test/pglite/helprFaultFeeTrueUp.pglite.mjs.
 *
 * @mutate supabase/functions/release-payout/index.ts |    await rollBackOnboardingFeeClaim({ keepHelprFaultFee: !isDefiniteStripeRefusal(e) }); |    await rollBackOnboardingFeeClaim();
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |        await rollBackOnboardingFeeClaim({ keepHelprFaultFee: !isDefiniteStripeRefusal(e) }); |        await rollBackOnboardingFeeClaim();
 * @mutate supabase/functions/release-payout/index.ts |    await rollBackOnboardingFeeClaim({ keepHelprFaultFee: true });\n    await postSlackOpsAlert({ |    await rollBackOnboardingFeeClaim();\n    await postSlackOpsAlert({
 * @mutate supabase/functions/release-payout/index.ts |    payoutCents = unrecorded.amountCents; |    payoutCents = payoutCents + 0;
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |          payoutCents = unrecorded.amountCents; |          payoutCents = payoutCents + 0;
 * @mutate supabase/functions/release-payout/index.ts |    helprFaultFeeCents = unrecorded.helprFaultFeeCents; |    helprFaultFeeCents = helprFaultFeeCents + 0;
 * @mutate supabase/functions/_shared/helprFaultFee.ts |  if (booked !== want) { |  if (booked > want) {
 * @mutate supabase/functions/_shared/helprFaultFee.ts |    if (kept) {\n      console.warn( |    if (kept && false) {\n      console.warn(
 * @mutate supabase/functions/release-payout/index.ts |      ...(keepFault ? { helpr_fault_fee_kept_cents: helprFaultFeeCents } : {}),\n    }); |    });
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock, type SupabaseScenario } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";

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

function capturedCentsFor(job: Record<string, unknown>): number {
  return Math.round((Number(job.budget ?? 0) + Number(job.urgent_fee ?? 0)) * 100 * 1.12);
}

/** release-payout: $100 job, onboarding fee already paid -> $88 before the debt. */
function seedRelease(s: SupabaseScenario) {
  const job = {
    id: "job-1", title: "Mow the lawn", status: "completed", payment_status: "payout_pending",
    helper_id: "helper-1", customer_id: "poster-1", budget: 100, urgent_fee: 0,
    dispute_status: null, disputed_at: null, is_group_job: false, helpers_needed: null,
    stripe_payment_intent_id: "pi_1", stripe_session_id: null,
  };
  s.reads.jobs = { rows: [job] };
  s.reads.gift_cards = { rows: [] };
  s.rpc.restore_gift_card_for_job = { outcome: "would_restore", applied_cents: capturedCentsFor(job) };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_1", status: "succeeded", amount: capturedCentsFor(job), amount_received: capturedCentsFor(job),
  });
  s.reads.profiles = { rows: [{ stripe_account_id: "acct_helper", full_name: "Helpful Helper", onboarding_fee_paid: true }] };
  s.reads.platform_settings = { rows: [{ helper_fee_percent: 10, onboarding_fee_cents: 200 }] };
  s.reads.payout_transfers = { rows: [] };
  stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_helper", payouts_enabled: true, charges_enabled: true });
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_1", transfer_group: "job_job-1" });
}

/** process-scheduled-payouts: $100 job, pro tier 10%, onboarding fee already paid. */
function seedScheduled(s: SupabaseScenario) {
  const job = {
    id: "job-1", title: "Mow the lawn", helper_id: "helper-1", customer_id: "poster-1", budget: 100,
    platform_fee_amount: 10, helper_fee_percent: 10, urgent_fee: 0, stripe_session_id: "cs_1",
    stripe_payment_intent_id: "pi_1", status: "completed", payment_status: "payout_pending",
    is_group_job: false, helpers_needed: 1, sales_tax_rate: 0,
  };
  s.reads.jobs = { rows: [job] };
  s.reads.platform_settings = { rows: [{ onboarding_fee_cents: 200 }] };
  s.reads.profiles = {
    rows: [{ stripe_account_id: "acct_helper", onboarding_fee_paid: true, subscription_tier: "pro", subscription_expires_at: null }],
  };
  s.reads.payout_transfers = { rows: [] };
  s.reads.user_roles = { rows: [] };
  s.writeSelectRows.profiles = [{ user_id: "helper-1" }];
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_1", status: "succeeded", latest_charge: "ch_1", amount: capturedCentsFor(job), amount_received: capturedCentsFor(job),
  });
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_1" });
}

const rpcCalls = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name);
const settleWrite = () =>
  scenario.writes.find((w) => w.table === "payout_transfers" && w.op === "update" && (w.payload as Record<string, unknown>)?.stripe_transfer_id)
    ?.payload as { amount_cents?: number; stripe_transfer_id?: string; metadata?: Record<string, unknown> } | undefined;
const timeout = () => Object.assign(new Error("Request timed out"), { type: "StripeConnectionError" });
const refusal = () => Object.assign(new Error("Insufficient funds in Stripe account"), { type: "StripeInvalidRequestError" });
const orphanClaim = (amountCents: number) => ({
  rows: [{
    id: "led-orphan", helper_id: "helper-1", stripe_transfer_id: null, status: "pending", amount_cents: amountCents,
    created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  }],
});

describe("the Helpr-fault deduction follows the money on the two payout runs", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
    scenario.rpcCalls = [];
  });
  afterEach(() => resetEnv());

  describe("release-payout", () => {
    const run = async () => {
      const fn = await load("release-payout");
      return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: { job_id: "job-1" } }));
    };

    it("a transfer TIMEOUT keeps the deduction booked (no restore: it may have gone out)", async () => {
      seedRelease(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      stripeMock.transfers.create.mockRejectedValue(timeout());
      const res = await run();
      expect(res.status).toBe(502);
      expect(rpcCalls("restore_helpr_fault_fee")).toHaveLength(0);
    });

    it("a timeout stamps the failed claim so a later run's early exit does not give the fee back", async () => {
      seedRelease(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      stripeMock.transfers.create.mockRejectedValue(timeout());
      await run();
      const failedWrite = scenario.writes.find((w) => w.table === "payout_transfers" && w.op === "update" && (w.payload as Record<string, unknown>)?.status === "failed");
      expect((failedWrite?.payload as { metadata?: Record<string, unknown> })?.metadata?.helpr_fault_fee_kept_cents).toBe(369);
      expect(JSON.stringify(slackAlerts)).toContain("kept booked");

      // Run 2: the earlier attempt is a failed row with the marker; the
      // Stripe check errors (same outage) -> an early exit that must keep it.
      resetStripeMock();
      resetSupabaseMock();
      resetSharedMocks();
      scenario.rpcCalls = [];
      seedRelease(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      scenario.reads.payout_transfers = {
        rows: [{ id: "led-1", job_id: "job-1", helper_id: "helper-1", stripe_transfer_id: null, status: "failed", amount_cents: 8431, metadata: { helpr_fault_fee_kept_cents: 369 } }],
      };
      stripeMock.transfers.list.mockRejectedValue(new Error("stripe down"));
      const res2 = await run();
      expect(res2.status).toBeGreaterThanOrEqual(500);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(rpcCalls("restore_helpr_fault_fee")).toHaveLength(0);
    });

    it("control: an early exit with no unclear earlier attempt still gives the fee back", async () => {
      seedRelease(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      stripeMock.transfers.list.mockRejectedValue(new Error("stripe down"));
      const res = await run();
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(rpcCalls("restore_helpr_fault_fee")).toHaveLength(1);
    });

    it("a DEFINITE refusal gives the deduction back", async () => {
      seedRelease(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      stripeMock.transfers.create.mockRejectedValue(refusal());
      const res = await run();
      expect(res.status).toBe(502);
      expect(rpcCalls("restore_helpr_fault_fee")).toHaveLength(1);
    });

    it("a transfer at Stripe with no ledger row keeps the deduction booked and names it in the page", async () => {
      seedRelease(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      stripeMock.transfers.list.mockResolvedValue({
        data: [{ id: "tr_other", amount: 1234, amount_reversed: 0, destination: "acct_helper", metadata: { job_id: "job-1" } }],
      });
      const res = await run();
      expect(res.status).toBe(409);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(rpcCalls("restore_helpr_fault_fee")).toHaveLength(0);
      expect(JSON.stringify(slackAlerts)).toContain("369c stays booked");
    });

    it("an adopted orphan settles with ITS amount and books what IT withheld, not this run's take", async () => {
      seedRelease(scenario);
      // The earlier run sent the full $88 (no debt then); a bill landed since,
      // so this run's take answers 369.
      scenario.rpc.take_helpr_fault_fee = 369;
      scenario.reads.payout_transfers = orphanClaim(8800);
      stripeMock.transfers.list.mockResolvedValue({
        data: [{ id: "tr_orphan", amount: 8800, amount_reversed: 0, destination: "acct_helper", metadata: { job_id: "job-1", helpr_fault_fee_cents: "0" } }],
      });
      const res = await run();
      expect(res.status).toBe(200);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(settleWrite()?.stripe_transfer_id).toBe("tr_orphan");
      expect(settleWrite()?.amount_cents).toBe(8800);
      expect(settleWrite()?.metadata).not.toHaveProperty("helpr_fault_fee_cents");
      const trueUp = rpcCalls("set_helpr_fault_fee_withheld");
      expect(trueUp).toHaveLength(1);
      expect(trueUp[0].args).toEqual({ p_helper_id: "helper-1", p_payout_ref: "job_payout_job-1", p_cents: 0 });
    });

    it("a sent transfer books exactly what it withheld (undoes a racing run's restore)", async () => {
      seedRelease(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      const res = await run();
      expect(res.status).toBe(200);
      const trueUp = rpcCalls("set_helpr_fault_fee_withheld");
      expect(trueUp).toHaveLength(1);
      expect(trueUp[0].args).toEqual({ p_helper_id: "helper-1", p_payout_ref: "job_payout_job-1", p_cents: 369 });
      expect(slackAlerts).toHaveLength(0);
    });

    it("withheld more than is still owed: pays out (money is out) and pages money_at_risk", async () => {
      seedRelease(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      scenario.rpc.set_helpr_fault_fee_withheld = 100;
      const res = await run();
      expect(res.status).toBe(200);
      expect((slackAlerts as Array<{ kind?: string }>).some((a) => a.kind === "money_at_risk")).toBe(true);
    });
  });

  describe("process-scheduled-payouts", () => {
    const run = async () => {
      const fn = await load("process-scheduled-payouts");
      return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
    };

    it("a transfer TIMEOUT keeps the deduction booked; a definite refusal gives it back", async () => {
      seedScheduled(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      stripeMock.transfers.create.mockRejectedValue(timeout());
      await run();
      expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
      expect(rpcCalls("restore_helpr_fault_fee")).toHaveLength(0);

      resetStripeMock();
      resetSupabaseMock();
      scenario.rpcCalls = [];
      seedScheduled(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      stripeMock.transfers.create.mockRejectedValue(refusal());
      await run();
      expect(rpcCalls("restore_helpr_fault_fee")).toHaveLength(1);
    });

    it("an adopted orphan settles with ITS amount and books what IT withheld", async () => {
      seedScheduled(scenario);
      const baseline = await run();
      expect(baseline.status).toBe(200);
      const fullCents = stripeMock.transfers.create.mock.calls[0][0].amount as number;

      resetStripeMock();
      resetSupabaseMock();
      scenario.rpcCalls = [];
      seedScheduled(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      scenario.reads.payout_transfers = orphanClaim(fullCents);
      stripeMock.transfers.list.mockResolvedValue({
        data: [{ id: "tr_orphan", amount: fullCents, amount_reversed: 0, destination: "acct_helper", metadata: { job_id: "job-1", helpr_fault_fee_cents: "0" } }],
      });
      await run();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(settleWrite()?.stripe_transfer_id).toBe("tr_orphan");
      expect(settleWrite()?.amount_cents).toBe(fullCents);
      const trueUp = rpcCalls("set_helpr_fault_fee_withheld");
      expect(trueUp).toHaveLength(1);
      expect((trueUp[0].args as { p_cents: number }).p_cents).toBe(0);
    });
  });

  it("inventory floor: both payout runs restore only on a definite refusal and true up after the money moves", async () => {
    const { readFileSync } = await import("node:fs");
    const { blankComments } = await import("../helpers/blankNonCode");
    const files = ["supabase/functions/release-payout/index.ts", "supabase/functions/process-scheduled-payouts/index.ts"];
    let n = 0;
    for (const f of files) {
      const src = blankComments(readFileSync(f, "utf8"));
      expect(src).toMatch(/keepHelprFaultFee:\s*!isDefiniteStripeRefusal\(e\)/);
      expect(src).toMatch(/recordHelprFaultFeeWithheld\(/);
      n++;
    }
    expect(n).toBeGreaterThan(1);
  });
});
