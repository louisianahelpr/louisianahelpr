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
