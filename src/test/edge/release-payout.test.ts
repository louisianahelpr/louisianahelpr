/**
 * Unit tests for the `release-payout` Supabase edge function.
 *
 * `release-payout` is the function that actually moves money OUT of the
 * platform balance to a helper's Stripe Connect account. It is the most
 * sensitive money path: a bug here either fails to pay helpers or
 * double-pays them.
 *
 * Coverage focus (all previously untested):
 *   - Auth: CRON_SECRET / service-role key accepted; admin JWT accepted;
 *     everything else rejected 401.
 *   - Job eligibility gates: status must be 'completed', payment_status
 *     must be 'payout_pending', helper_id required.
 *   - Dispute defense-in-depth: any dispute marker blocks payout.
 *   - Duplicate-transfer guard: an existing pending/paid ledger row blocks.
 *   - Connect-account active check.
 *   - Payout math + the one-time $2 onboarding-fee deduction.
 *   - Ledger row written + job flipped to 'released'.
 *
 * Runs the REAL function source via the edge harness.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import {
  scenario,
  resetSupabaseMock,
  type SupabaseScenario,
} from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret-xyz";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    CRON_SECRET,
  });
  return loadEdgeFunction("release-payout");
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

/**
 * Seed a fully-payable job: completed, payout_pending, helper with an
 * active Connect account, no dispute, no existing transfer.
 */
function seedPayableJob(s: SupabaseScenario, overrides: Record<string, unknown> = {}) {
  s.reads.jobs = {
    rows: [
      {
        id: "job-1",
        title: "Mow the lawn",
        status: "completed",
        payment_status: "payout_pending",
        helper_id: "helper-1",
        customer_id: "poster-1",
        budget: 100,
        urgent_fee: 0,
        dispute_status: null,
        disputed_at: null,
        ...overrides,
      },
    ],
  };
  s.reads.profiles = {
    rows: [
      {
        stripe_account_id: "acct_helper",
        full_name: "Helpful Helper",
        onboarding_fee_paid: true,
      },
    ],
  };
  s.reads.platform_settings = {
    rows: [{ helper_fee_percent: 10, onboarding_fee_cents: 200 }],
  };
  s.reads.payout_transfers = { rows: [] };
  stripeMock.accounts.retrieve.mockResolvedValue({
    id: "acct_helper",
    payouts_enabled: true,
    charges_enabled: true,
  });
  stripeMock.transfers.create.mockResolvedValue({
    id: "tr_1",
    transfer_group: "job_job-1",
  });
}

describe("release-payout edge function", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  describe("authorization", () => {
    it("OPTIONS preflight returns 200", async () => {
      const fn = await load();
      const res = await fn.fetch(fn.request({ method: "OPTIONS" }));
      expect(res.status).toBe(200);
    });

    it("accepts the CRON_SECRET bearer token", async () => {
      seedPayableJob(scenario);
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      expect(res.status).toBe(200);
      expect((await json(res)).success).toBe(true);
    });

    it("rejects an unknown bearer token with 401", async () => {
      // A non-cron token forces the admin-JWT path; getUser returns no user.
      scenario.authUser = null;
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: "Bearer not-a-real-token" },
          body: { job_id: "job-1" },
        }),
      );
      expect(res.status).toBe(401);
    });

    it("rejects a valid JWT that lacks the admin role with 401", async () => {
      scenario.authUser = { id: "user-1", email: "u@test.com" };
      scenario.rpc.has_role = false;
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: "Bearer user-jwt" },
          body: { job_id: "job-1" },
        }),
      );
      expect(res.status).toBe(401);
      expect((await json(res)).error).toMatch(/admin role required/i);
    });

    it("accepts an admin JWT", async () => {
      scenario.authUser = { id: "admin-1", email: "admin@test.com" };
      scenario.rpc.has_role = true;
      seedPayableJob(scenario);
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: "Bearer admin-jwt" },
          body: { job_id: "job-1" },
        }),
      );
      expect(res.status).toBe(200);
      expect((await json(res)).initiated_by).toBe("admin");
    });
  });

  describe("request validation", () => {
    it("returns 400 on an invalid JSON body", async () => {
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          rawBody: "{not json",
        }),
      );
      expect(res.status).toBe(400);
    });

    it("returns 400 when job_id is missing", async () => {
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: {},
        }),
      );
      expect(res.status).toBe(400);
      expect((await json(res)).error).toMatch(/job_id required/i);
    });
  });

  describe("job eligibility gates", () => {
    it("returns 404 when the job does not exist", async () => {
      scenario.reads.jobs = { rows: [] };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "ghost" },
        }),
      );
      expect(res.status).toBe(404);
    });

    it("returns 409 when the job is not completed", async () => {
      seedPayableJob(scenario, { status: "in_progress" });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/expected completed/i);
    });

    it("returns 409 when payment_status is not payout_pending", async () => {
      seedPayableJob(scenario, { payment_status: "released" });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/expected payout_pending/i);
    });

    it("returns 409 when the job has no helper", async () => {
      seedPayableJob(scenario, { helper_id: null });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/no helper_id/i);
    });
  });

  describe("dispute defense-in-depth", () => {
    it("blocks payout on an active dispute marker", async () => {
      seedPayableJob(scenario, {
        disputed_at: new Date().toISOString(),
        dispute_status: "open",
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/active dispute marker/i);
    });

    it("allows payout when a dispute was resolved in the helper's favor", async () => {
      seedPayableJob(scenario, {
        disputed_at: new Date().toISOString(),
        dispute_status: "resolved",
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      expect(res.status).toBe(200);
      expect((await json(res)).success).toBe(true);
    });
  });

  describe("duplicate-transfer guard", () => {
    it("returns 409 when a pending transfer already exists for the job", async () => {
      seedPayableJob(scenario);
      scenario.reads.payout_transfers = {
        rows: [{ id: "led-1", stripe_transfer_id: "tr_old", status: "pending" }],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/transfer already exists/i);
      // Crucially, no Stripe transfer was attempted.
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });
  });

  describe("Connect account check", () => {
    it("returns 409 when the helper has no Connect account", async () => {
      seedPayableJob(scenario);
      scenario.reads.profiles = {
        rows: [{ stripe_account_id: null, onboarding_fee_paid: true }],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/connect onboarding/i);
    });

    it("returns 409 when the Connect account is not fully active", async () => {
      seedPayableJob(scenario);
      stripeMock.accounts.retrieve.mockResolvedValue({
        id: "acct_helper",
        payouts_enabled: false,
        charges_enabled: true,
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/not fully active/i);
    });
  });

  describe("payout math + transfer", () => {
    it("transfers budget minus the platform fee, writes a ledger row, flips job to released", async () => {
      seedPayableJob(scenario, { budget: 100, urgent_fee: 0 });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      const out = await json(res);
      expect(res.status).toBe(200);
      // Untiered helper resolves to the free tier → 12% fee.
      // $100 budget - 12% fee = $88 → 8800 cents
      expect(out.amount_cents).toBe(8800);
      expect(out.platform_fee_cents).toBe(1200);

      const transferArgs = stripeMock.transfers.create.mock.calls[0][0];
      expect(transferArgs.amount).toBe(8800);
      expect(transferArgs.destination).toBe("acct_helper");

      const ledger = scenario.writes.find(
        (w) => w.table === "payout_transfers" && w.op === "insert",
      );
      expect((ledger?.payload as Record<string, unknown>).status).toBe("paid");
      expect((ledger?.payload as Record<string, unknown>).amount_cents).toBe(8800);

      const jobWrite = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect((jobWrite?.payload as Record<string, unknown>).payment_status).toBe(
        "released",
      );
    });

    it("includes the urgent_fee in the gross payout", async () => {
      seedPayableJob(scenario, { budget: 100, urgent_fee: 20 });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      // Untiered helper → free tier → 12%.
      // gross = 100 + 20 = 120; fee = 12% of budget (100) = 12; net = 108
      expect((await json(res)).amount_cents).toBe(10800);
    });

    it("deducts the one-time $2 onboarding fee from a helper who has not paid it", async () => {
      seedPayableJob(scenario, { budget: 100 });
      scenario.reads.profiles = {
        rows: [
          {
            stripe_account_id: "acct_helper",
            full_name: "New Helper",
            onboarding_fee_paid: false,
          },
        ],
      };
      // The atomic claim UPDATE returns 1 row → this payout owns the deduction.
      scenario.writeSelectRows.profiles = [{ user_id: "helper-1" }];
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      // Untiered helper → free tier → 12%.
      // $88 net - $2 onboarding fee = $86 → 8600 cents
      expect((await json(res)).amount_cents).toBe(8600);
    });

    it("returns 502 when the Stripe transfer call fails", async () => {
      seedPayableJob(scenario);
      stripeMock.transfers.create.mockRejectedValue(
        Object.assign(new Error("insufficient funds"), { type: "StripeError" }),
      );
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      expect(res.status).toBe(502);
      expect((await json(res)).error).toMatch(/transfers\.create failed/i);
    });

    it("rolls back the onboarding-fee claim when the transfer fails so the retry re-collects it", async () => {
      seedPayableJob(scenario, { budget: 100 });
      scenario.reads.profiles = {
        rows: [
          {
            stripe_account_id: "acct_helper",
            full_name: "New Helper",
            onboarding_fee_paid: false,
          },
        ],
      };
      // The atomic claim UPDATE returns 1 row → this payout owned the deduction.
      scenario.writeSelectRows.profiles = [{ user_id: "helper-1" }];
      stripeMock.transfers.create.mockRejectedValue(
        Object.assign(new Error("insufficient funds"), { type: "StripeError" }),
      );
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      expect(res.status).toBe(502);
      const profileWrites = scenario.writes.filter(
        (w) => w.table === "profiles" && w.op === "update",
      );
      // First write claims the fee (true); the last un-claims it (false) so a
      // retry sees onboarding_fee_paid=false and deducts the $2 again.
      expect((profileWrites[0].payload as Record<string, unknown>).onboarding_fee_paid).toBe(true);
      const last = profileWrites[profileWrites.length - 1].payload as Record<string, unknown>;
      expect(last.onboarding_fee_paid).toBe(false);
      expect(last.onboarding_fee_charged_at).toBeNull();
    });

    it("returns 500 when the transfer succeeded but the ledger write failed", async () => {
      seedPayableJob(scenario);
      // Transfer goes through, but the payout_transfers INSERT errors.
      scenario.writeErrors.payout_transfers = {
        message: "ledger insert failed",
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      expect(res.status).toBe(500);
      const out = await json(res);
      expect(out.error).toMatch(/ledger write failed/i);
      // The transfer id is surfaced so an operator can reconcile by hand.
      expect(out.stripe_transfer_id).toBeTruthy();
    });
  });
});
