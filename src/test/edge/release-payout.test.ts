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
 * The poster-side charge for a seeded job, in cents — what Stripe captured
 * into escrow. Budget + urgent fee + the 12% customer fee.
 *
 * Deliberately the POSTER total, not the helper payout: the cap asserts
 * payout <= captured, and capturing exactly the payout would satisfy that for
 * the wrong reason and stop catching a post-checkout budget raise.
 */
function capturedCentsFor(job: Record<string, unknown>): number {
  const budget = Number(job.budget ?? 0);
  const urgent = Number(job.urgent_fee ?? 0);
  return Math.round((budget + urgent) * 100 * 1.12);
}

/**
 * Seed a fully-payable job: completed, payout_pending, helper with an
 * active Connect account, no dispute, no existing transfer.
 */
function seedPayableJob(s: SupabaseScenario, overrides: Record<string, unknown> = {}) {
  const job = {
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
    is_group_job: false,
    helpers_needed: null,
    stripe_payment_intent_id: "pi_1",
    stripe_session_id: null,
    ...overrides,
  };
  s.reads.jobs = { rows: [job] };
  // Not a Pay-It-Forward job by default, and the escrow charge captured.
  //
  // The amount matters as much as the status. This mock carried only a status
  // until the payout cap started reading the figure — a succeeded
  // PaymentIntent with no amount is not a thing Stripe returns, and modelling
  // one meant every payout here was asserted against $0 of escrow.
  s.reads.pif_credits = { rows: [] };
  // A gift-funded job has no Stripe charge, so its escrow is valued through the
  // same dry-run RPC the other payout paths use. Seeded by default rather than
  // per-test: a test flips a job to Pay-It-Forward by seeding `pif_credits`,
  // and without this the valuation would fail and the payout 503 for a reason
  // that has nothing to do with what the test is asserting. A test that WANTS
  // the valuation to fail sets `scenario.rpcErrors`, which wins over this.
  s.rpc.restore_pif_credit_for_job = {
    outcome: "would_restore",
    applied_cents: capturedCentsFor(job),
  };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_1",
    status: "succeeded",
    amount: capturedCentsFor(job),
    amount_received: capturedCentsFor(job),
  });
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

      // The ledger row is INSERTed as `pending` BEFORE Stripe is called, then
      // settled to `paid` by a follow-up update. That inversion is the claim
      // protocol (20260831190418): the row is what arbitrates between two
      // concurrent payout paths — a partial unique index on
      // (job_id, helper_id) means the loser gets 23505 and never reaches
      // transfers.create. Writing it afterwards, as this test used to assert,
      // is exactly the ordering that allowed a double transfer.
      const ledger = scenario.writes.find(
        (w) => w.table === "payout_transfers" && w.op === "insert",
      );
      expect((ledger?.payload as Record<string, unknown>).status).toBe("pending");
      expect((ledger?.payload as Record<string, unknown>).amount_cents).toBe(8800);

      // …and it must be settled once the transfer returns, or the claim
      // strands and blocks every future payout on this job.
      const settle = scenario.writes.find(
        (w) => w.table === "payout_transfers" && w.op === "update",
      );
      expect((settle?.payload as Record<string, unknown>).status).toBe("paid");

      const jobWrite = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect((jobWrite?.payload as Record<string, unknown>).payment_status).toBe(
        "released",
      );
    });

    it("includes the net urgent_fee in the gross payout", async () => {
      seedPayableJob(scenario, { budget: 100, urgent_fee: 20 });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      // Untiered helper → free tier → 12%.
      // The urgent fee nets its own bundled 2.9% Stripe cost: $20 − $0.58 =
      // $19.42. net = (100 − 12% of 100) + 19.42 = 88 + 19.42 = $107.42.
      expect((await json(res)).amount_cents).toBe(10742);
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

    it("splits the budget per-helper on a group job instead of paying one helper the full budget", async () => {
      // 3-helper $300 group job: poster charged the budget ONCE, so each helper
      // is paid 300/3 = $100 → minus 12% free-tier fee = $88 → 8800 cents.
      // The pre-fix bug paid the FULL $300 (26400 cents) to a single helper.
      seedPayableJob(scenario, {
        budget: 300,
        is_group_job: true,
        helpers_needed: 3,
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      const out = await json(res);
      expect(res.status).toBe(200);
      expect(out.amount_cents).toBe(8800);
      expect(out.platform_fee_cents).toBe(1200);
      expect(stripeMock.transfers.create.mock.calls[0][0].amount).toBe(8800);
    });

    it("refuses the payout when the group roster CANNOT be read, instead of paying the lead helper", async () => {
      // Regression: the roster guard used to drop the read error, so a failed
      // lookup produced roster === null → rosterSize 0 → the `> 1` refusal
      // never fired → we transferred to the lead helper and flipped the job to
      // "released", permanently stranding the rest of the roster's shares. A
      // guard that disappears when its own lookup fails is not a guard.
      seedPayableJob(scenario, {
        budget: 300,
        is_group_job: true,
        helpers_needed: 3,
      });
      scenario.reads.group_job_helpers = {
        error: { message: "connection reset by peer" },
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      expect(res.status).toBe(503);
      expect((await json(res)).error).toMatch(/roster/i);
      // The whole point: no money moved.
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("refuses a multi-member group roster with 409 and moves no money", async () => {
      seedPayableJob(scenario, {
        budget: 300,
        is_group_job: true,
        helpers_needed: 3,
      });
      scenario.reads.group_job_helpers = {
        rows: [{ helper_id: "helper-1" }, { helper_id: "helper-2" }],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      const out = await json(res);
      expect(res.status).toBe(409);
      expect(out.roster_size).toBe(2);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    // ── The payout CAP ────────────────────────────────────────────────────
    //
    // These four are the tests the cap shipped without. It landed with every
    // fixture in this file modelling a succeeded PaymentIntent that carried no
    // amount at all, so the guard read $0 captured, refused all 20 payouts,
    // and turned main red — while the case it exists to catch had no coverage
    // in either direction. A guard nothing exercises is indistinguishable from
    // a guard that is wrong.
    it("refuses the payout when the budget was raised after checkout", async () => {
      // Escrow captured $112 for a $100 job; the budget is then $500. Nothing
      // about the PaymentIntent changes — this is exactly the shape of the bug.
      seedPayableJob(scenario);
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_1",
        status: "succeeded",
        amount: 11200,
        amount_received: 11200,
      });
      scenario.reads.jobs = {
        rows: [{ ...(scenario.reads.jobs!.rows as Record<string, unknown>[])[0], budget: 500 }],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: { job_id: "job-1" } }),
      );
      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/exceeds captured escrow/i);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("refuses a gift-funded payout the gift does not cover", async () => {
      // The gift path omits `source_transaction`, so Stripe's own ceiling is
      // absent and this assertion is the ONLY thing standing there.
      seedPayableJob(scenario, { stripe_payment_intent_id: null, stripe_session_id: null, budget: 500 });
      scenario.reads.pif_credits = { rows: [{ id: "pif-1" }] };
      scenario.rpc.restore_pif_credit_for_job = { outcome: "would_restore", applied_cents: 5000 };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: { job_id: "job-1" } }),
      );
      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/exceeds captured escrow/i);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("refuses under its OWN error when the captured amount cannot be established", async () => {
      // A succeeded intent with no amount is not a poster problem, and must not
      // be reported as one — "exceeds captured escrow" would send the on-call
      // after a budget that is perfectly fine.
      seedPayableJob(scenario);
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded" });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: { job_id: "job-1" } }),
      );
      expect(res.status).toBe(409);
      const body = await json(res);
      expect(body.error).toMatch(/could not verify how much escrow was captured/i);
      expect(body.error).not.toMatch(/exceeds/i);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("pays out on `amount` when Stripe omits `amount_received`", async () => {
      // The fallback that keeps one missing field from halting every payout on
      // the platform. On a succeeded intent the two are equal.
      seedPayableJob(scenario);
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_1",
        status: "succeeded",
        amount: 11200,
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: { job_id: "job-1" } }),
      );
      expect(res.status).toBe(200);
      expect(stripeMock.transfers.create).toHaveBeenCalled();
    });

    it("refuses to transfer and returns 409 when the escrow charge did not capture", async () => {
      seedPayableJob(scenario);
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_1",
        status: "requires_payment_method",
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/not captured/i);
      // No money moves against an uncaptured charge.
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("returns 409 when there is no payment intent to verify (non-PIF job)", async () => {
      seedPayableJob(scenario, {
        stripe_payment_intent_id: null,
        stripe_session_id: null,
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/cannot verify escrow capture/i);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("pays a Pay-It-Forward job from platform balance WITHOUT requiring a captured charge", async () => {
      // PIF jobs are funded from the prepaid platform balance and have no poster
      // charge on this job, so the PI-capture gate must be skipped for them.
      seedPayableJob(scenario, {
        stripe_payment_intent_id: null,
        stripe_session_id: null,
      });
      scenario.reads.pif_credits = { rows: [{ id: "pif-1" }] };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: { Authorization: `Bearer ${CRON_SECRET}` },
          body: { job_id: "job-1" },
        }),
      );
      expect(res.status).toBe(200);
      expect((await json(res)).success).toBe(true);
      // Never touched Stripe to verify a (nonexistent) charge.
      expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    });

    // ── Fee fallback when the helper's PROFILE READ FAILS ──────────────────
    //
    // Not the same thing as the "untiered helper" case above: that one reads a
    // real profile row with no tier and resolves 12 through the ladder. THIS
    // one never gets a row at all, so `getHelperFeePercent` returns whatever
    // fallback the caller passed — the number under test.
    //
    // It fires on every Pay-It-Forward job, because create-payment's PIF
    // branch short-circuits before the escrow stamp, so a PIF job carries no
    // frozen `helper_fee_percent` to prefer.
    describe("fee fallback on a failed tier read", () => {
      /** Error ONLY the `subscription_tier` read; leave the Connect-account read healthy. */
      function failTierRead() {
        const healthy = scenario.reads.profiles;
        scenario.reads.profiles = {
          ...healthy,
          selectOverrides: [
            {
              includes: "subscription_tier",
              result: { error: { message: "tier read boom" } },
            },
          ],
        };
      }

      it("falls back to the FREE rate (12), not the global 10, on a PIF job with no frozen percent", async () => {
        seedPayableJob(scenario, {
          stripe_payment_intent_id: null,
          stripe_session_id: null,
        });
        scenario.reads.pif_credits = { rows: [{ id: "pif-1" }] };
        // The global is deliberately left at the legacy 10 so this test still
        // proves the code no longer reads it, even after platform_settings is
        // retuned to 12 in prod.
        scenario.reads.platform_settings = {
          rows: [{ helper_fee_percent: 10, onboarding_fee_cents: 200 }],
        };
        failTierRead();

        const fn = await load();
        const res = await fn.fetch(
          fn.request({
            headers: { Authorization: `Bearer ${CRON_SECRET}` },
            body: { job_id: "job-1" },
          }),
        );
        const out = await json(res);
        expect(res.status).toBe(200);
        // $100 budget: 12% = $12.00 platform cut, $88.00 to the helper.
        // At the old global-10 fallback these were 1000 / 9000.
        expect(out.platform_fee_cents).toBe(1200);
        expect(out.amount_cents).toBe(8800);

        // …and the percent COMMITTED to the job row is 12, so the ledger and
        // every downstream display agree with what was actually transferred.
        const jobWrite = scenario.writes.find(
          (w) => w.table === "jobs" && w.op === "update",
        );
        expect((jobWrite?.payload as Record<string, unknown>).helper_fee_percent).toBe(12);
      });

      it("still prefers the rate FROZEN on the job over the free rate", async () => {
        // An Elite helper's job funded at 8% must not be re-priced to 12 just
        // because their profile happened to be unreadable at payout time.
        seedPayableJob(scenario, { helper_fee_percent: 8 });
        failTierRead();

        const fn = await load();
        const res = await fn.fetch(
          fn.request({
            headers: { Authorization: `Bearer ${CRON_SECRET}` },
            body: { job_id: "job-1" },
          }),
        );
        const out = await json(res);
        expect(res.status).toBe(200);
        expect(out.platform_fee_cents).toBe(800);
        expect(out.amount_cents).toBe(9200);
      });
    });

    it("a failed ledger write means NO transfer was attempted", async () => {
      // This test used to assert the opposite shape — "the transfer succeeded
      // but the ledger write failed", 500 with a transfer id to reconcile by
      // hand. That scenario is no longer reachable, and its unreachability is
      // the whole point of the claim protocol (20260831190418).
      //
      // The ledger row is now INSERTed as `pending` BEFORE Stripe is called,
      // because that row is what arbitrates between two concurrent payout
      // paths: a partial unique index on (job_id, helper_id) means the second
      // claimant gets 23505 and stands down without reaching transfers.create.
      // A consequence worth having is this one — money can no longer move
      // while the record of it fails to. The old ordering left an operator
      // reconciling a real transfer by hand from an error message.
      seedPayableJob(scenario);
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
      expect((await json(res)).error).toMatch(/claim/i);
      // The load-bearing assertion: Stripe was never touched, so there is no
      // real transfer stranded behind a failed write.
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });
  });
});
