/**
 * Unit tests for the `process-scheduled-payouts` Supabase edge function.
 *
 * This cron is the AUTOMATED sibling of `release-payout`: it sweeps every
 * completed, `payout_pending`, undisputed job whose `payout_scheduled_at`
 * has elapsed and transfers the helper's net to their Stripe Connect account.
 * It is a money-moving path, so the same invariants that guard release-payout
 * apply here — plus one this file exists to pin down:
 *
 *   The one-time $2 onboarding fee is claimed with a race-safe atomic
 *   `UPDATE ... WHERE onboarding_fee_paid = false`, and that claim is
 *   DEFERRED to immediately before the Stripe transfer. Every viability
 *   `continue` (no Connect account, no/failed payment intent, ledger read
 *   error, an already-existing transfer) runs BEFORE the claim, and the two
 *   post-claim exits — a too-small payout and a failed transfer — both roll
 *   the claim back. Otherwise a skip-after-claim would orphan
 *   `onboarding_fee_paid = true` with no money collected, and the retry would
 *   read the flag as paid and never charge the $2 (a silent fee leak).
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
  return loadEdgeFunction("process-scheduled-payouts");
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

/**
 * Seed one fully-payable scheduled job: completed, payout_pending, helper with
 * an active Connect account, PI succeeded, no existing transfer.
 * `onboarding_fee_paid` defaults FALSE (fee owed) so the claim path runs.
 */
/**
 * The poster-side charge for a seeded job, in cents — i.e. what Stripe
 * captured into escrow. Budget + urgent fee + the 12% customer fee.
 *
 * Deliberately the POSTER total and not the helper payout: the cap under test
 * asserts payout <= captured, and a fixture that captured exactly the payout
 * would pass that assertion for the wrong reason and stop catching a raise.
 */
function capturedCentsFor(job: Record<string, unknown>): number {
  const budget = Number(job.budget ?? 0);
  const urgent = Number(job.urgent_fee ?? 0);
  return Math.round((budget + urgent) * 100 * 1.12);
}

function seedPayableJob(s: SupabaseScenario, overrides: {
  job?: Record<string, unknown>;
  profile?: Record<string, unknown>;
} = {}) {
  const job = {
    id: "job-1",
    title: "Mow the lawn",
    helper_id: "helper-1",
    customer_id: "poster-1",
    budget: 100,
    platform_fee_amount: 10,
    helper_fee_percent: 10,
    urgent_fee: 0,
    stripe_session_id: "cs_1",
    stripe_payment_intent_id: "pi_1",
    status: "completed",
    is_group_job: false,
    helpers_needed: 1,
    sales_tax_rate: 0,
    ...overrides.job,
  };
  s.reads.jobs = { rows: [job] };
  s.reads.platform_settings = { rows: [{ onboarding_fee_cents: 200 }] };
  s.reads.profiles = {
    rows: [
      {
        stripe_account_id: "acct_helper",
        onboarding_fee_paid: false,
        subscription_tier: "pro", // 10% commission
        subscription_expires_at: null,
        ...overrides.profile,
      },
    ],
  };
  s.reads.payout_transfers = { rows: [] };
  s.reads.user_roles = { rows: [] };
  // A successful atomic claim: the `.update(...).select("user_id")` returns a row.
  s.writeSelectRows.profiles = [{ user_id: "helper-1" }];

  // What the POSTER was charged, which is what Stripe captured — budget plus
  // the urgent fee plus the 12% customer fee. Derived from the seeded job so a
  // test that raises the budget raises the escrow with it.
  //
  // This mock used to carry a status and no amount at all, which no real
  // succeeded PaymentIntent ever does. That was invisible for as long as
  // nothing read the figure; the moment the payout cap did, every test in this
  // file failed, because a fixture that models a $100 job had been asserting
  // payouts against $0 of escrow the whole time.
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_1",
    status: "succeeded",
    latest_charge: "ch_1",
    amount: capturedCentsFor(job),
    amount_received: capturedCentsFor(job),
  });
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_1" });
}

function profileUpdates() {
  return scenario.writes.filter((w) => w.table === "profiles" && w.op === "update");
}

describe("process-scheduled-payouts edge function", () => {
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

    it("rejects a request with no bearer token 401", async () => {
      const fn = await load();
      const res = await fn.fetch(fn.request({ body: {} }));
      expect(res.status).toBe(401);
    });

    it("accepts the CRON_SECRET bearer token", async () => {
      seedPayableJob(scenario);
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      expect(res.status).toBe(200);
    });
  });

  // ── Fee fallback when the helper's PROFILE READ FAILS ────────────────────
  //
  // The twin of the same block in release-payout.test.ts, and it exists as a
  // PAIR on purpose: either path can settle the same job depending on whether
  // release was manual or automatic, so if the two disagree on this fallback
  // the commission a helper is charged depends on which one reached them
  // first. Both must resolve the FREE rate (12), derived from
  // DEFAULT_TIER_FEE_PERCENT rather than a literal.
  describe("fee fallback on a failed tier read", () => {
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

    it("falls back to the FREE rate (12) when the job carries no frozen percent", async () => {
      // helper_fee_percent null is the Pay-It-Forward shape: create-payment's
      // PIF branch returns before the escrow stamp, so nothing was frozen.
      seedPayableJob(scenario, {
        job: { helper_fee_percent: null, platform_fee_amount: null },
        profile: { onboarding_fee_paid: true },
      });
      failTierRead();

      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      expect(res.status).toBe(200);

      // The percent COMMITTED to the job is the direct observation of what the
      // fallback resolved to. $100 budget at 12% → $12.00 platform cut.
      const jobWrite = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect((jobWrite?.payload as Record<string, unknown>).helper_fee_percent).toBe(12);
      expect((jobWrite?.payload as Record<string, unknown>).platform_fee_amount).toBe(12);

      // …and the money that actually moved matches it: $100 − $12 = $88.
      const transferArgs = stripeMock.transfers.create.mock.calls[0][0];
      expect(transferArgs.amount).toBe(8800);
    });

    it("still prefers the rate FROZEN on the job over the free rate", async () => {
      seedPayableJob(scenario, {
        job: { helper_fee_percent: 8 },
        profile: { onboarding_fee_paid: true },
      });
      failTierRead();

      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      expect(res.status).toBe(200);
      const jobWrite = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect((jobWrite?.payload as Record<string, unknown>).helper_fee_percent).toBe(8);
      expect(stripeMock.transfers.create.mock.calls[0][0].amount).toBe(9200);
    });
  });

  describe("onboarding-fee claim + deduction", () => {
    it("claims and deducts the $2 fee on the helper's first payout", async () => {
      seedPayableJob(scenario);
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      expect(res.status).toBe(200);
      const body = await json(res);
      expect((body.results as Array<Record<string, unknown>>)[0].status).toBe("transferred");

      // Exactly one profiles update — the claim — flipping the flag true.
      const updates = profileUpdates();
      expect(updates).toHaveLength(1);
      expect((updates[0].payload as Record<string, unknown>).onboarding_fee_paid).toBe(true);

      // Transfer amount = budget(100) - 10% commission(10) - $2 fee = $88 → 8800¢.
      const transferArg = stripeMock.transfers.create.mock.calls[0][0] as Record<string, unknown>;
      expect(transferArg.amount).toBe(8800);
      expect((transferArg.metadata as Record<string, unknown>).onboarding_fee_first_payout).toBe("true");
    });

    it("does not claim or deduct when the helper already paid the fee", async () => {
      seedPayableJob(scenario, { profile: { onboarding_fee_paid: true } });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      expect(res.status).toBe(200);

      // No profiles update at all — the fee was already collected elsewhere.
      expect(profileUpdates()).toHaveLength(0);

      // Full net payout, no deduction: 100 - 10 = $90 → 9000¢.
      const transferArg = stripeMock.transfers.create.mock.calls[0][0] as Record<string, unknown>;
      expect(transferArg.amount).toBe(9000);
      expect((transferArg.metadata as Record<string, unknown>).onboarding_fee_first_payout).toBe("false");
    });

    // ── The payout CAP ────────────────────────────────────────────────────
    //
    // This cron pays MOST jobs and had no cap at all until it was added; it
    // then shipped with no test, against fixtures whose PaymentIntent carried
    // no amount. Both directions are asserted here so the guard cannot rot
    // into either a no-op or a blanket refusal.
    it("refuses the payout when the budget was raised after checkout", async () => {
      seedPayableJob(scenario, { job: { budget: 500 } });
      // Escrow still holds what the $100 session captured.
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_1",
        status: "succeeded",
        latest_charge: "ch_1",
        amount: 11200,
        amount_received: 11200,
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      expect(res.status).not.toBe(200);
      const results = (await json(res)).results as Array<Record<string, unknown>>;
      expect(results[0].status).toBe("exceeds_captured_escrow");
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("skips under its OWN status when the captured amount cannot be established", async () => {
      seedPayableJob(scenario);
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_1",
        status: "succeeded",
        latest_charge: "ch_1",
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      const results = (await json(res)).results as Array<Record<string, unknown>>;
      // Not "exceeds_captured_escrow": that would point the on-call at the
      // poster's budget for what is an integration fault.
      expect(results[0].status).toBe("escrow_amount_unverifiable");
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("rolls back the claim when the transfer fails so the retry re-collects the fee", async () => {
      seedPayableJob(scenario);
      stripeMock.transfers.create.mockRejectedValue(
        Object.assign(new Error("insufficient funds"), { type: "StripeError" }),
      );
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      // Non-2xx, not 200. A cron that answers 200 on a failed run is invisible
      // to sweep_cron_http_failures — which is how auto-release-payment failed
      // a payout 83 times with nobody able to see it from the outside. The
      // defect tracker now decides the status code, so a run that could not
      // move money says so at the HTTP layer.
      expect(res.status).not.toBe(200);
      const body = await json(res);
      expect((body.results as Array<Record<string, unknown>>)[0].status).toBe("transfer_failed");

      // Two profiles updates: the claim (true), then the rollback (false + null).
      const updates = profileUpdates();
      expect(updates.length).toBeGreaterThanOrEqual(2);
      expect((updates[0].payload as Record<string, unknown>).onboarding_fee_paid).toBe(true);
      const last = updates[updates.length - 1].payload as Record<string, unknown>;
      expect(last.onboarding_fee_paid).toBe(false);
      expect(last.onboarding_fee_charged_at).toBeNull();
    });

    it("does NOT claim the fee before the no-Connect-account skip (no orphaned claim)", async () => {
      seedPayableJob(scenario, { profile: { stripe_account_id: null } });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      expect(res.status).toBe(200);
      const body = await json(res);
      expect((body.results as Array<Record<string, unknown>>)[0].status).toBe("no_connect_account");

      // The claim is deferred past this skip, so the flag was never flipped —
      // nothing to orphan, and the retry will still collect the $2.
      expect(profileUpdates()).toHaveLength(0);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("does NOT claim the fee before the already-transferred skip", async () => {
      seedPayableJob(scenario);
      scenario.reads.payout_transfers = {
        rows: [{ stripe_transfer_id: "tr_prior", status: "paid" }],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      expect(res.status).toBe(200);
      const body = await json(res);
      expect((body.results as Array<Record<string, unknown>>)[0].status).toBe("already_transferred");
      expect(profileUpdates()).toHaveLength(0);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });
  });

  describe("group-job urgent split (#114)", () => {
    it("splits the urgent fee across the roster like the budget", async () => {
      // The poster is charged the urgent fee ONCE, bundled into escrow, so a
      // group job must divide it across helpers — else N helpers each collect
      // the full urgent bonus and the platform over-pays N×.
      // budget 300 / 3 helpers = $100 each; 10% commission = $10; urgent $30
      // nets its own 2.9% bundled Stripe cost ($30 − $0.87 = $29.13) then splits
      // 3 ways = $9.71. Payout = 100 − 10 + 9.71 = $99.71 → 9971¢.
      // (Fee already paid so no $2 onboarding deduction clouds the urgent math.)
      seedPayableJob(scenario, {
        job: { budget: 300, urgent_fee: 30, is_group_job: true, helpers_needed: 3 },
        profile: { onboarding_fee_paid: true },
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      expect(res.status).toBe(200);
      const transferArg = stripeMock.transfers.create.mock.calls[0][0] as Record<string, unknown>;
      expect(transferArg.amount).toBe(9971);
    });
  });
});
