/**
 * The money CRONS pick each job's Stripe client by that job's mode (owner
 * decision 2026-10-12, "Test mode for test accounts"), and a guard drives them
 * through it (lh-money-escrow review of 000ca9c1e, finding 1: no edge test of
 * process-scheduled-payouts or auto-tip-charge named a test account or a key,
 * so swapping their per-job client for the run's live one, or deciding a
 * payout without its payee, stayed green). The payout's payee is checked twice
 * (kind "payout" and the [helperId] extra party), so only dropping both lets
 * live escrow reach a test Helpr; that is the second mutation.
 *
 * Each test runs the REAL function through the edge harness with
 * `stripeMock.__trackClients`, so every Stripe call is recorded with the key of
 * the client that made it.
 *
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |         ({ stripe } = await stripes.clientForJob(job.id, "payout", [helperId])); |         ({ stripe } = { stripe: stripes.clientFor("live") });
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |         ({ stripe } = await stripes.clientForJob(job.id, "payout", [helperId])); |         ({ stripe } = await stripes.clientForJob(job.id, "read", []));
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |       (await stripes.clientForJob(jobId, "payout", payees)).stripe; |       stripes.clientFor("live");
 * @mutate supabase/functions/_shared/heldTipRepay.ts |       rowStripe = await stripeForJob!((tipJob?.job_id as string \| undefined) ?? null, [r.helper_id]); |       rowStripe = liveStripe;
 * @mutate supabase/functions/_shared/chargebackClawback.ts |       const stripe = ctx.stripeForJob ? await ctx.stripeForJob(jobId, [...(payees.get(disputeId) ?? [])]) : ctx.stripe; |       const stripe = ctx.stripe;
 * @mutate supabase/functions/_shared/chargebackClawback.ts | await ctx.stripeForJob(jobId, [...(payees.get(disputeId) ?? [])]) | await ctx.stripeForJob(jobId, [])
 * @mutate supabase/functions/auto-tip-charge/index.ts |         ({ stripe } = await stripes.clientForJob(jobId, "new", [c.customer_id as string \| null, c.helper_id as string \| null])); |         ({ stripe } = { stripe: stripes.clientFor("live") });
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const LIVE_KEY = "sk_live_real_money";
const TEST_KEY = "sk_test_sandbox";
const CRON_SECRET = "cron-secret-xyz";

const TEST_POSTER = "11111111-1111-4111-8111-111111111111";
const TEST_HELPR = "22222222-2222-4222-8222-222222222222";
const REAL_POSTER = "33333333-3333-4333-8333-333333333333";
const REAL_HELPR = "44444444-4444-4444-8444-444444444444";
const JOB = "77777777-7777-4777-8777-777777777777";

/** Enrol these ids as TEST ACCOUNTS: a test_accounts row AND profiles.is_seed. */
function enrol(...ids: string[]) {
  scenario.reads.test_accounts = { rows: ids.map((user_id) => ({ user_id })) };
  scenario.reads.profiles = {
    ...(scenario.reads.profiles ?? {}),
    selectOverrides: [
      { includes: "user_id, is_seed", result: { rows: ids.map((user_id) => ({ user_id, is_seed: true })) } },
      ...(scenario.reads.profiles?.selectOverrides ?? []),
    ],
  };
}

function env() {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: LIVE_KEY,
    STRIPE_TEST_SECRET_KEY: TEST_KEY,
    CRON_SECRET,
  });
}

const callsOn = (key: string, method: string) => stripeMock.__calls.filter((c) => c.key === key && c.method === method);

describe("money crons choose each job's Stripe client by its mode (owner 2026-10-12)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
    stripeMock.__trackClients = true;
  });
  afterEach(() => resetEnv());

  describe("process-scheduled-payouts", () => {
    /** One payable job: completed, payout_pending, captured escrow, Helpr with a Connect account. */
    function payableJob(customerId: string, helperId: string, session: string) {
      scenario.reads.jobs = {
        rows: [{
          id: JOB, title: "Mow the lawn", helper_id: helperId, customer_id: customerId, budget: 100,
          platform_fee_amount: 10, helper_fee_percent: 10, urgent_fee: 0, stripe_session_id: session,
          stripe_payment_intent_id: "pi_1", status: "completed", payment_status: "payout_pending",
          is_group_job: false, helpers_needed: 1, sales_tax_rate: 0,
        }],
      };
      scenario.reads.platform_settings = { rows: [{ onboarding_fee_cents: 200 }] };
      scenario.reads.profiles = {
        rows: [{ stripe_account_id: "acct_helper", onboarding_fee_paid: true, subscription_tier: "pro", subscription_expires_at: null }],
      };
      scenario.reads.payout_transfers = { rows: [] };
      scenario.reads.user_roles = { rows: [] };
      scenario.reads.group_job_helpers = { rows: [] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_1", status: "succeeded", latest_charge: "ch_1", amount: 11200, amount_received: 11200,
      });
      stripeMock.transfers.create.mockResolvedValue({ id: "tr_1" });
    }
    async function run() {
      env();
      const fn = await loadEdgeFunction("process-scheduled-payouts");
      return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
    }

    it("a test job pays its test Helpr on the TEST client, never the live one", async () => {
      payableJob(TEST_POSTER, TEST_HELPR, "cs_test_1");
      enrol(TEST_POSTER, TEST_HELPR);
      await run();
      expect(callsOn(TEST_KEY, "transfers.create")).toHaveLength(1);
      expect(callsOn(LIVE_KEY, "transfers.create")).toHaveLength(0);
      expect(callsOn(LIVE_KEY, "paymentIntents.retrieve")).toHaveLength(0);
    });

    it("a real job pays on the LIVE client", async () => {
      payableJob(REAL_POSTER, REAL_HELPR, "cs_live_1");
      enrol(TEST_POSTER);
      await run();
      expect(callsOn(LIVE_KEY, "transfers.create")).toHaveLength(1);
      expect(callsOn(TEST_KEY, "transfers.create")).toHaveLength(0);
    });

    it("LIVE escrow owed to a test Helpr is paid on neither key, and the run says why", async () => {
      payableJob(REAL_POSTER, TEST_HELPR, "cs_live_1");
      enrol(TEST_HELPR);
      const res = await run();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(await res.text()).toContain("stripe_mode_refused");
    });
  });

  // Q1753: the held-money re-drives at the end of process-scheduled-payouts
  // (a tip held back during a payout hold, a won chargeback re-pay) run each
  // row on the key of its job's own mode; they took the run's live client.
  describe("process-scheduled-payouts held-money re-drives (Q1753)", () => {
    const DAY = 86_400_000;
    const TIP_JOB = "88888888-8888-4888-8888-888888888888";
    function base(job: { customer_id: string; helper_id: string; stripe_session_id: string }) {
      scenario.reads.jobs = {
        rows: [],
        eqOverrides: [{ column: "id", value: TIP_JOB, result: { rows: [{ id: TIP_JOB, title: "Fence", ...job }] } }],
      };
      scenario.reads.platform_settings = { rows: [{ onboarding_fee_cents: 200 }] };
      scenario.reads.payout_transfers = { rows: [] };
      scenario.reads.chargeback_clawbacks = { rows: [] };
      scenario.reads.tip_hold_redrives = { rows: [] };
      scenario.reads.payout_holds = { rows: [] };
      scenario.reads.group_job_helpers = { rows: [] };
      scenario.reads.tips = { rows: [{ job_id: TIP_JOB }] };
      scenario.reads.profiles = { ...(scenario.reads.profiles ?? {}), rows: [{ stripe_account_id: "acct_helper" }] };
      stripeMock.transfers.list.mockResolvedValue({ data: [] });
      stripeMock.transfers.create.mockResolvedValue({ id: "tr_repay" });
    }
    const heldTip = (helperId: string) => ({
      tip_id: "tip-1", helper_id: helperId, transfer_id: "tr_tip", amount_cents: 1500, status: "reversed",
      updated_at: new Date(Date.now() - 3600_000).toISOString(), created_at: new Date(Date.now() - DAY).toISOString(),
    });
    const owedClawback = (helperId: string) => ({
      id: "cb-1", dispute_id: "dp_1", job_id: TIP_JOB, helper_id: helperId, original_transfer_id: "tr_1",
      stripe_account_id: "acct_helper", transfer_amount_cents: 9000, reversed_cents: 9000,
      stripe_reversal_id: "trr_1", repay_transfer_id: null, status: "reversed",
      failure_reason: "payout_hold: re-pay owed once the hold is released",
      held_repay_owed_at: new Date(Date.now() - DAY).toISOString(), updated_at: new Date(Date.now() - DAY).toISOString(),
    });
    async function run() {
      env();
      const fn = await loadEdgeFunction("process-scheduled-payouts");
      const res = await fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
      return { status: res.status, text: await res.text() };
    }

    it("a test job held tip is re-paid on the TEST client, never the live one", async () => {
      base({ customer_id: TEST_POSTER, helper_id: TEST_HELPR, stripe_session_id: "cs_test_1" });
      scenario.reads.tip_hold_redrives = { rows: [heldTip(TEST_HELPR)] };
      enrol(TEST_POSTER, TEST_HELPR);
      await run();
      expect(callsOn(TEST_KEY, "transfers.create")).toHaveLength(1);
      expect(callsOn(LIVE_KEY, "transfers.create")).toHaveLength(0);
    });

    it("a real job held tip is re-paid on the LIVE client", async () => {
      base({ customer_id: REAL_POSTER, helper_id: REAL_HELPR, stripe_session_id: "cs_live_1" });
      scenario.reads.tip_hold_redrives = { rows: [heldTip(REAL_HELPR)] };
      enrol(TEST_POSTER);
      await run();
      expect(callsOn(LIVE_KEY, "transfers.create")).toHaveLength(1);
      expect(callsOn(TEST_KEY, "transfers.create")).toHaveLength(0);
    });

    it("a test job won-chargeback re-pay runs on the TEST client", async () => {
      base({ customer_id: TEST_POSTER, helper_id: TEST_HELPR, stripe_session_id: "cs_test_1" });
      scenario.reads.chargeback_clawbacks = { rows: [owedClawback(TEST_HELPR)] };
      enrol(TEST_POSTER, TEST_HELPR);
      await run();
      expect(callsOn(TEST_KEY, "transfers.create")).toHaveLength(1);
      expect(callsOn(LIVE_KEY, "transfers.create")).toHaveLength(0);
    });

    it("a real job won-chargeback re-pay to a TEST Helpr moves nothing on either key and is a defect", async () => {
      base({ customer_id: REAL_POSTER, helper_id: REAL_HELPR, stripe_session_id: "cs_live_1" });
      scenario.reads.chargeback_clawbacks = { rows: [owedClawback(TEST_HELPR)] };
      enrol(TEST_HELPR);
      const { text } = await run();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(text).toContain("clawback re-pay dp_1");
      // Nothing claimed, and the job stays in chargeback (review of Q1753, #3).
      expect(scenario.writes.some((w) => w.table === "chargeback_clawbacks")).toBe(false);
      expect(scenario.writes.some((w) => w.table === "jobs")).toBe(false);
    });

    it("one dispute whose owed re-pays go to a test AND a real Helpr pays neither, and leaves both rows", async () => {
      base({ customer_id: TEST_POSTER, helper_id: TEST_HELPR, stripe_session_id: "cs_test_1" });
      scenario.reads.chargeback_clawbacks = { rows: [owedClawback(TEST_HELPR), { ...owedClawback(REAL_HELPR), id: "cb-2", original_transfer_id: "tr_2" }] };
      enrol(TEST_POSTER, TEST_HELPR);
      await run();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(scenario.writes.some((w) => w.table === "chargeback_clawbacks")).toBe(false);
    });

    it("a held tip on a REAL job owed to a TEST Helpr is refused before any claim, on neither key", async () => {
      base({ customer_id: REAL_POSTER, helper_id: TEST_HELPR, stripe_session_id: "cs_live_1" });
      scenario.reads.tip_hold_redrives = { rows: [heldTip(TEST_HELPR)] };
      enrol(TEST_HELPR);
      await run();
      expect(stripeMock.__calls.filter((c) => c.method.startsWith("transfers."))).toEqual([]);
      expect(scenario.writes.some((w) => w.table === "tip_hold_redrives")).toBe(false);
    });

    it("a stale owed tip of a test job asks Stripe on the TEST key, and finds its reversal (reversed, never kept)", async () => {
      base({ customer_id: TEST_POSTER, helper_id: TEST_HELPR, stripe_session_id: "cs_test_1" });
      scenario.reads.tip_hold_redrives = { rows: [{ ...heldTip(TEST_HELPR), status: "owed", updated_at: new Date(Date.now() - DAY).toISOString() }] };
      stripeMock.transfers.listReversals.mockResolvedValue({ data: [{ id: "trr_tip", metadata: { tip_id: "tip-1" } }] });
      enrol(TEST_POSTER, TEST_HELPR);
      await run();
      expect(callsOn(TEST_KEY, "transfers.listReversals")).toHaveLength(1);
      expect(callsOn(LIVE_KEY, "transfers.listReversals")).toHaveLength(0);
      const statuses = scenario.writes.filter((w) => w.table === "tip_hold_redrives").map((w) => (w.payload as Record<string, unknown>).status);
      expect(statuses).toEqual(["reversed"]);
    });

    it("a held tip whose job read fails waits (no transfer, no claim) and is a defect", async () => {
      base({ customer_id: TEST_POSTER, helper_id: TEST_HELPR, stripe_session_id: "cs_test_1" });
      scenario.reads.tip_hold_redrives = { rows: [heldTip(TEST_HELPR)] };
      scenario.reads.tips = { error: { message: "connection reset" } };
      enrol(TEST_POSTER, TEST_HELPR);
      const { text } = await run();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(text).toContain("tip job read");
      // Resolved BEFORE the claim: a refusal does not leave the row claimed (repaying).
      expect(scenario.writes.some((w) => w.table === "tip_hold_redrives")).toBe(false);
    });
  });

  describe("auto-tip-charge", () => {
    function candidate(customerId: string, helperId: string) {
      scenario.rpc.auto_tip_candidates = [{ job_id: JOB, customer_id: customerId, helper_id: helperId, budget: 100, tip_amount: 10 }];
      scenario.reads.jobs = { rows: [{ customer_id: customerId, helper_id: helperId, stripe_session_id: "cs_live_1" }] };
      scenario.reads.group_job_helpers = { rows: [] };
    }
    async function run() {
      env();
      const fn = await loadEdgeFunction("auto-tip-charge");
      return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
    }

    it("a tip between two test accounts is charged through the TEST client", async () => {
      candidate(TEST_POSTER, TEST_HELPR);
      enrol(TEST_POSTER, TEST_HELPR);
      await run();
      expect(stripeMock.__keys).toContain(TEST_KEY);
      expect(stripeMock.__calls.filter((c) => c.key === LIVE_KEY)).toEqual([]);
    });

    it("a tip from a real poster to a test Helpr is new money across modes: no client, no charge", async () => {
      candidate(REAL_POSTER, TEST_HELPR);
      enrol(TEST_HELPR);
      await run();
      expect(stripeMock.__keys).not.toContain(TEST_KEY);
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
      expect(stripeMock.__calls).toEqual([]);
    });
  });
});
