/**
 * Q2082 (b), owner 2026-10-18 ("J4"): a Helpr ruled at fault owes the card
 * cost of the poster's full refund, and it comes out of their NEXT job payout
 * (migration 20261019015303: take_helpr_fault_fee / restore_helpr_fault_fee,
 * edge helper _shared/helprFaultFee.ts). Both single-Helpr payout paths
 * (release-payout and process-scheduled-payouts) must:
 *   - ask for the debt under the job's payout ref, capped so $1 stays,
 *   - send the payout less what it took (then rounded down to whole dollars),
 *   - record it on the ledger row as its own line (never as rounding),
 *   - refuse to pay when the debt cannot be read (fails closed),
 *   - give it back when the transfer fails before money moved.
 *
 * @mutate supabase/functions/release-payout/index.ts |       payoutCents = roundPayoutDownCents(unroundedPayoutCents - onboardingFeeDeductedCents - helprFaultFeeCents); |       payoutCents = roundPayoutDownCents(unroundedPayoutCents - onboardingFeeDeductedCents);
 * @mutate supabase/functions/release-payout/index.ts |    if (helprFaultFeeCents > 0) await restoreHelprFaultFee(supabaseAdmin, job.helper_id, job.id, "release-payout"); |    if (helprFaultFeeCents < 0) await restoreHelprFaultFee(supabaseAdmin, job.helper_id, job.id, "release-payout");
 * @mutate supabase/functions/release-payout/index.ts |      return jsonResponse({ error: "could not read the Helpr's card-fee debt — retry. Nothing was moved." }, 500); |      console.error("ignored");
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |          helperPayout = roundPayoutDownCents(unroundedPayoutCents - (owesOnboardingFee ? onboardingFeeCents : 0) - helprFaultFeeCents) / 100; |          helperPayout = helperPayout + 0;
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |          continue;\n        }\n        if (take.cents > 0) { |        }\n        if (take.cents > 0) {
 * @mutate supabase/functions/_shared/money.ts |    ...(fault > 0 ? { helpr_fault_fee_cents: fault } : {}), |    ...({}),
 * @mutate supabase/functions/_shared/helprFaultFee.ts |  const v = Math.floor(Number(unroundedAfterOtherFeesCents) - 100); |  const v = Math.floor(Number(unroundedAfterOtherFeesCents));
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock, type SupabaseScenario } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

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

/** release-payout: $100 job, 12% free tier, onboarding fee already paid -> $88. */
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

const takeCalls = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "take_helpr_fault_fee");
const restoreCalls = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "restore_helpr_fault_fee");
const claimMeta = () =>
  (scenario.writes.find((w) => w.table === "payout_transfers" && w.op === "insert")?.payload as { metadata?: Record<string, unknown> } | undefined)?.metadata;

describe("Q2082 (b): a Helpr-fault card fee comes out of the next payout", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
    scenario.rpcCalls = [];
  });
  afterEach(() => {
    resetEnv();
  });

  describe("release-payout", () => {
    const run = async () => {
      const fn = await load("release-payout");
      return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: { job_id: "job-1" } }));
    };

    it("no debt: the payout is untouched and no fee line is written", async () => {
      seedRelease(scenario);
      const res = await run();
      expect(res.status).toBe(200);
      expect(stripeMock.transfers.create.mock.calls[0][0].amount).toBe(8800);
      expect(stripeMock.transfers.create.mock.calls[0][0].metadata.helpr_fault_fee_cents).toBe("0");
      expect(claimMeta()).not.toHaveProperty("helpr_fault_fee_cents");
    });

    it("withholds the debt (capped so $1 stays) and records it as its own line", async () => {
      seedRelease(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      const res = await run();
      expect(res.status).toBe(200);
      expect(takeCalls()).toHaveLength(1);
      expect(takeCalls()[0].args).toEqual({ p_helper_id: "helper-1", p_payout_ref: "job_payout_job-1", p_max_cents: 8700 });
      // 8800 - 369 = 8431, rounded down to whole dollars.
      expect(stripeMock.transfers.create.mock.calls[0][0].amount).toBe(8400);
      expect(stripeMock.transfers.create.mock.calls[0][0].metadata.helpr_fault_fee_cents).toBe("369");
      expect(claimMeta()).toEqual(expect.objectContaining({ helpr_fault_fee_cents: 369, rounding_remainder_cents: 31, onboarding_fee_cents: 0 }));
    });

    it("an unreadable debt pays nothing (fails closed)", async () => {
      seedRelease(scenario);
      scenario.rpcErrors = { take_helpr_fault_fee: { message: "connection reset" } };
      const res = await run();
      expect(res.status).toBe(500);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("a failed transfer gives the withheld debt back", async () => {
      seedRelease(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      stripeMock.transfers.create.mockRejectedValue(Object.assign(new Error("insufficient funds"), { type: "StripeError" }));
      const res = await run();
      expect(res.status).toBe(502);
      expect(restoreCalls()).toHaveLength(1);
      expect(restoreCalls()[0].args).toEqual({ p_helper_id: "helper-1", p_job_id: "job-1" });
    });
  });

  describe("process-scheduled-payouts", () => {
    const run = async () => {
      const fn = await load("process-scheduled-payouts");
      return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
    };

    it("withholds the debt from the scheduled payout and records it", async () => {
      seedScheduled(scenario);
      const baseline = await run();
      expect(baseline.status).toBe(200);
      const fullCents = stripeMock.transfers.create.mock.calls[0][0].amount as number;
      expect(fullCents).toBeGreaterThan(1000);
      expect(stripeMock.transfers.create.mock.calls[0][0].metadata.helpr_fault_fee_cents).toBe("0");

      resetStripeMock();
      resetSupabaseMock();
      scenario.rpcCalls = [];
      seedScheduled(scenario);
      scenario.rpc.take_helpr_fault_fee = 369;
      const res = await run();
      expect(res.status).toBe(200);
      expect(takeCalls()).toHaveLength(1);
      expect(takeCalls()[0].args).toEqual(expect.objectContaining({ p_helper_id: "helper-1", p_payout_ref: "job_payout_job-1" }));
      const sent = stripeMock.transfers.create.mock.calls[0][0];
      expect(sent.amount).toBe(Math.floor((fullCents - 369) / 100) * 100);
      expect(sent.metadata.helpr_fault_fee_cents).toBe("369");
      expect(claimMeta()).toEqual(expect.objectContaining({ helpr_fault_fee_cents: 369 }));
    });

    it("an unreadable debt pays nothing (fails closed)", async () => {
      seedScheduled(scenario);
      scenario.rpcErrors = { take_helpr_fault_fee: { message: "connection reset" } };
      await run();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });
  });

  it("inventory floor: every single-Helpr payout path takes the debt", async () => {
    const { readFileSync } = await import("node:fs");
    const { blankComments } = await import("../helpers/blankNonCode");
    // release-payout, the scheduled sweep, the Quick Release (create-payment
    // transferToHelper) and the decided split's Helpr leg (execute-dispute-split).
    const files = [
      "supabase/functions/release-payout/index.ts",
      "supabase/functions/process-scheduled-payouts/index.ts",
      "supabase/functions/create-payment/index.ts",
      "supabase/functions/execute-dispute-split/index.ts",
    ];
    const n = files.filter((f) => /takeHelprFaultFee\(/.test(blankComments(readFileSync(f, "utf8")))).length;
    expect(n).toBe(files.length);
    expect(n).toBeGreaterThan(3);
  });

  // The earnings export adds the withheld fee back, so its gross is what the
  // Helpr earned (NEWEST get_helper_earnings_export; PGlite proof:
  // src/test/pglite/helprFaultEarningsExport.pglite.mjs).
  // @mutate supabase/migrations/20261019015304_helpr_fault_earnings_export.sql | this payout kept back.\n                        + GREATEST(0, COALESCE((p.metadata->>'helpr_fault_fee_cents')::bigint, 0)) | this payout kept back.\n                        + 0
  it("the earnings export adds the Helpr-fault fee back in both ledger laterals", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { blankSqlComments } = await import("../helpers/blankNonCode");
    const dir = "supabase/migrations";
    const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    let newest = "";
    for (const f of files) {
      const sql = blankSqlComments(readFileSync(`${dir}/${f}`, "utf8"));
      const m = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.get_helper_earnings_export\s*\([\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\1/i.exec(sql);
      if (m) newest = m[2];
    }
    expect(newest.length).toBeGreaterThan(1000);
    const hits = newest.match(/metadata->>'helpr_fault_fee_cents'/g) ?? [];
    expect(hits.length).toBe(2);
  });
});
