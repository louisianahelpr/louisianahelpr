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
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import {
  scenario,
  resetSupabaseMock,
  type SupabaseScenario,
} from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { testModeUnderLiveKey, captureTestModeSkips } from "../helpers/testModeUnderLiveKey";

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
    payment_status: "payout_pending",
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
      // helper_fee_percent null is the gift card shape: create-payment's
      // gift card branch returns before the escrow stamp, so nothing was frozen.
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

    it("takes a non-whole-dollar fee BEFORE the one whole-dollar floor, not between two (Q236)", async () => {
      seedPayableJob(scenario, { job: { urgent_fee: 20 } });
      scenario.reads.platform_settings = { rows: [{ onboarding_fee_cents: 230 }] };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      expect(res.status).toBe(200);
      // $90 + $19.42 net urgent = $109.42 owed − $2.30 fee = $107.12 → $107.
      // Flooring first ($109 − $2.30 = $106.70 → $106) costs a second dollar.
      const transferArg = stripeMock.transfers.create.mock.calls[0][0] as Record<string, unknown>;
      expect(transferArg.amount).toBe(10700);
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

  // TC-008. "Already transferred, skip" is right about the transfer and was
  // wrong about the job: when a prior run's post-transfer flip died, every
  // subsequent run reached that skip, logged itself healthy, and left the job
  // reading 'payout_pending' with the helper already paid. Only hand-written
  // SQL could fix it.
  // Round-5 money review, HIGH: this cron and release-payout share the claim
  // row but not the idempotency key, so a claim orphaned by one and resumed by
  // the other under its own key paid the Helpr twice. Stripe is asked first.
  describe("an unrecorded transfer at Stripe", () => {
    const orphan = () => ({ id: "led-orphan", helper_id: "helper-1", stripe_transfer_id: null, status: "pending", created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() });
    const run = async () => {
      const fn = await load();
      return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
    };

    it("an orphaned claim + a MATCHING unrecorded transfer: adopted, no transfers.create", async () => {
      // The amount this job pays, observed from a clean run.
      seedPayableJob(scenario, { profile: { onboarding_fee_paid: true } });
      await run();
      const amount = stripeMock.transfers.create.mock.calls[0][0].amount as number;
      resetSupabaseMock(); resetStripeMock(); resetSharedMocks();

      seedPayableJob(scenario, { profile: { onboarding_fee_paid: true } });
      scenario.reads.payout_transfers = { rows: [orphan()] };
      // release-payout's transfer (its own key) went out; its ledger stamp did not.
      stripeMock.transfers.list.mockResolvedValue({
        data: [{ id: "tr_release", amount, amount_reversed: 0, destination: "acct_helper", metadata: { job_id: "job-1", helper_id: "helper-1" } }],
      });
      await run();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      const settle = scenario.writes.find((w) => w.table === "payout_transfers" && w.op === "update");
      expect((settle?.payload as Record<string, unknown>)?.stripe_transfer_id).toBe("tr_release");
    });

    it("an orphaned claim + a NON-matching unrecorded transfer: skipped, paged, no transfers.create", async () => {
      seedPayableJob(scenario);
      scenario.reads.payout_transfers = { rows: [orphan()] };
      stripeMock.transfers.list.mockResolvedValue({
        data: [{ id: "tr_other", amount: 1, amount_reversed: 0, destination: "acct_someone_else", metadata: { job_id: "job-1" } }],
      });
      await run();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect((slackAlerts as Array<{ severity?: string }>).some((a) => a.severity === "critical")).toBe(true);
    });
  });

  describe("already-transferred heal", () => {
    it("completes the missing status flip on a single-helper job instead of skipping forever", async () => {
      seedPayableJob(scenario);
      scenario.reads.payout_transfers = {
        rows: [{ stripe_transfer_id: "tr_prior", status: "paid" }],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      const body = await json(res);
      const first = (body.results as Array<Record<string, unknown>>)[0];
      expect(first.status).toBe("already_transferred");
      expect(first.healed).toBe(true);
      // The load-bearing pair: no second transfer, AND the job is finished.
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      const jobWrite = scenario.writes.find((w) => w.table === "jobs" && w.op === "update");
      expect((jobWrite?.payload as Record<string, unknown>).payment_status).toBe("released");
      // The fee columns are NOT rewritten — this path never resolved the tier,
      // and a guess would overwrite what the paid transfer was built from.
      expect(jobWrite?.payload).not.toHaveProperty("helper_fee_percent");
      expect(jobWrite?.payload).not.toHaveProperty("platform_fee_amount");
    });

    it("does NOT heal a group job — the flip there owes the whole roster", async () => {
      seedPayableJob(scenario, { job: { is_group_job: true, helpers_needed: 3 } });
      scenario.reads.payout_transfers = {
        rows: [{ stripe_transfer_id: "tr_prior", status: "paid" }],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      const body = await json(res);
      expect((body.results as Array<Record<string, unknown>>)[0].status).toBe("already_transferred");
      expect(scenario.writes.some((w) => w.table === "jobs" && w.op === "update")).toBe(false);
    });
  });

  describe("the post-transfer flip is retried on a transient DB fault", () => {
    it("retries a 57014 statement timeout rather than stranding the payout", async () => {
      seedPayableJob(scenario);
      scenario.writeErrors.jobs = {
        message: "canceling statement due to statement timeout",
        code: "57014",
      };
      const fn = await load();
      await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      const jobWrites = scenario.writes.filter((w) => w.table === "jobs" && w.op === "update");
      expect(jobWrites.length).toBe(4);
    }, 20000);

    it("does NOT retry a zero-row match — a refunded or charged-back job must alarm at once", async () => {
      seedPayableJob(scenario);
      scenario.writeSelectRows["jobs:update"] = [];
      const fn = await load();
      await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      const jobWrites = scenario.writes.filter((w) => w.table === "jobs" && w.op === "update");
      expect(jobWrites.length).toBe(1);
    });
  });

  // Defense in depth for OPEN.md (HIGH, d7a04acb9): a dismissed card inquiry
  // used to clear disputed_at — this cron's only dispute guard — on jobs whose
  // real hold lives off the job row. Both holds are now read here directly.
  describe("holds the job row may not show", () => {
    it("(1) refuses a job whose decided dispute has not executed, even with disputed_at cleared", async () => {
      seedPayableJob(scenario, { profile: { onboarding_fee_paid: true } });
      scenario.reads.disputes = {
        rows: [{ id: "disp-1", execution_status: "pending", payout_split: { poster: 0.5, helper: 0.5 } }],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      const body = await json(res);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect((body.results as Array<Record<string, unknown>>)[0].status).toBe("unsettled_dispute_hold");
      expect(scenario.writes.some((w) => w.table === "jobs" && w.op === "update")).toBe(false);
    });

    it("(2) refuses a job with a reversed transfer the per-helper ledger read does not see", async () => {
      seedPayableJob(scenario, { profile: { onboarding_fee_paid: true } });
      // The per-helper dedupe read (keyed on this helper_id) sees nothing — a
      // legacy or NULLed-helper ledger row — while the job-wide read sees the
      // reversal. Before: a second transfer went out.
      scenario.reads.payout_transfers = {
        rows: [],
        selectOverrides: [{
          includes: "helper_id",
          result: { rows: [{ id: "pt-1", status: "reversed", stripe_transfer_id: "tr_rev", helper_id: null }] },
        }],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      const body = await json(res);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect((body.results as Array<Record<string, unknown>>)[0].status).toBe("reversed_transfer_hold");
    });

    it("(2) a reversed transfer is never 'healed' to released — the clawback stays visible", async () => {
      seedPayableJob(scenario);
      scenario.reads.payout_transfers = {
        rows: [{ id: "pt-1", stripe_transfer_id: "tr_rev", status: "reversed", helper_id: "helper-1" }],
      };
      const fn = await load();
      await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(scenario.writes.some((w) => w.table === "jobs" && w.op === "update")).toBe(false);
    });

    it("fails closed and records a defect when a hold cannot be read", async () => {
      seedPayableJob(scenario, { profile: { onboarding_fee_paid: true } });
      scenario.reads.disputes = { error: { message: "disputes down" } };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      expect(res.status).toBe(500);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("a reversal an operator cleared (reversal_cleared) does not block", async () => {
      seedPayableJob(scenario, { profile: { onboarding_fee_paid: true } });
      // The mock hands rows back whatever the filter says, so this also pins
      // that the code judges each row's status itself. (The disputes query's
      // own filter is pinned in release-payout-unsettled-dispute.test.ts.)
      scenario.reads.payout_transfers = {
        rows: [],
        selectOverrides: [{
          includes: "helper_id",
          result: { rows: [{ id: "pt-1", status: "reversal_cleared", stripe_transfer_id: "tr_old", helper_id: "helper-1" }] },
        }],
      };
      const fn = await load();
      await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    });
  });

  // ── Q891: a Stripe id minted under the TEST key, read under the LIVE key ──
  //
  // Every job funded before prod went live (2026-09-27) holds one. Stripe
  // answers 404 resource_missing "a similar object exists in test mode". There
  // is no real money behind it, so the row is skipped with ONE structured log
  // line: never a 500, never a defect, never a page, never a transfer or a
  // ledger claim. Every other error keeps failing closed (the controls below).
  describe("Q891: a test-mode Stripe object under the live key", () => {
    let skips: ReturnType<typeof captureTestModeSkips>;
    beforeEach(() => {
      skips = captureTestModeSkips();
    });
    afterEach(() => {
      skips.restore();
    });

    const runCron = async () => {
      const fn = await load();
      return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
    };

    function expectNoMoneyMoved() {
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(scenario.writes.some((w) => w.table === "payout_transfers")).toBe(false);
      expect(profileUpdates()).toHaveLength(0);
      expect(scenario.writes.some((w) => w.table === "jobs" && w.op === "update")).toBe(false);
      // Q1220: a REAL job's hit pages one warning (a seed job's stays quiet,
      // below); nothing else is posted.
      expect((slackAlerts as Array<{ title?: string }>).map((a) => a.title)).toEqual(["Real job stuck on a Stripe test-mode object"]);
    }

    // @mutate supabase/functions/process-scheduled-payouts/index.ts | logTestObjectUnderLiveKey("process-scheduled-payouts", { job_id: job.id, object: "checkout.session", id: job.stripe_session_id }); | throw e;
    it("skips (200, no defect, no transfer, no claim) when the checkout SESSION is a test-mode object", async () => {
      seedPayableJob(scenario, { job: { stripe_payment_intent_id: null, stripe_session_id: "cs_test_old" } });
      stripeMock.checkout.sessions.retrieve.mockRejectedValue(testModeUnderLiveKey("checkout.session", "cs_test_old"));

      const res = await runCron();
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.defects).toBe(0);
      expect(body.defectReasons).toBeUndefined();
      expect((body.results as Array<Record<string, unknown>>)[0]).toMatchObject({ job_id: "job-1", status: "skipped_test_mode_object" });
      expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
      expectNoMoneyMoved();
      expect(skips.lines()).toEqual([
        expect.objectContaining({ fn: "process-scheduled-payouts", object: "checkout.session", id: "cs_test_old", job_id: "job-1" }),
      ]);
    });

    // @mutate supabase/functions/process-scheduled-payouts/index.ts | logTestObjectUnderLiveKey("process-scheduled-payouts", { job_id: job.id, object: "payment_intent", id: paymentIntentId }); | throw e;
    it("skips (200, no defect, no transfer, no claim) when the PaymentIntent to verify is a test-mode object", async () => {
      seedPayableJob(scenario, { job: { stripe_payment_intent_id: "pi_test_old" } });
      stripeMock.paymentIntents.retrieve.mockRejectedValue(testModeUnderLiveKey("payment_intent", "pi_test_old"));

      const res = await runCron();
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body.defects).toBe(0);
      expect(body.defectReasons).toBeUndefined();
      expect((body.results as Array<Record<string, unknown>>)[0]).toMatchObject({ job_id: "job-1", status: "skipped_test_mode_object" });
      expectNoMoneyMoved();
      expect(skips.lines()).toEqual([
        expect.objectContaining({ fn: "process-scheduled-payouts", object: "payment_intent", id: "pi_test_old", job_id: "job-1" }),
      ]);
    });

    // @mutate supabase/functions/process-scheduled-payouts/index.ts | if (job.is_seed === true) return;\n        await postSlackOpsAlert({ | await postSlackOpsAlert({
    it("Q1220: a SEED job's test-mode PaymentIntent is skipped quietly (no page)", async () => {
      seedPayableJob(scenario, { job: { stripe_payment_intent_id: "pi_test_old", is_seed: true } });
      stripeMock.paymentIntents.retrieve.mockRejectedValue(testModeUnderLiveKey("payment_intent", "pi_test_old"));
      const res = await runCron();
      expect(res.status).toBe(200);
      expect(slackAlerts).toHaveLength(0);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    // @mutate supabase/functions/process-scheduled-payouts/index.ts | await alertRealJobOnTestObject("payment_intent", paymentIntentId); |
    // @mutate supabase/functions/process-scheduled-payouts/index.ts | await alertRealJobOnTestObject("checkout.session", job.stripe_session_id); |
    it("Q1220: a REAL job's test-mode object pages one warning naming the job (session and PaymentIntent)", async () => {
      for (const which of ["session", "pi"] as const) {
        resetSupabaseMock();
        resetStripeMock();
        resetSharedMocks();
        if (which === "session") {
          seedPayableJob(scenario, { job: { stripe_payment_intent_id: null, stripe_session_id: "cs_test_old" } });
          stripeMock.checkout.sessions.retrieve.mockRejectedValue(testModeUnderLiveKey("checkout.session", "cs_test_old"));
        } else {
          seedPayableJob(scenario, { job: { stripe_payment_intent_id: "pi_test_old" } });
          stripeMock.paymentIntents.retrieve.mockRejectedValue(testModeUnderLiveKey("payment_intent", "pi_test_old"));
        }
        await runCron();
        const alerts = slackAlerts as Array<{ title?: string; severity?: string; fields?: Record<string, unknown> }>;
        expect(alerts, which).toHaveLength(1);
        expect(alerts[0]).toMatchObject({ severity: "warning", fields: expect.objectContaining({ job_id: "job-1" }) });
      }
    });

    it("control: any OTHER PaymentIntent verify error still fails closed (500, verify_error, no transfer, no log line)", async () => {
      seedPayableJob(scenario);
      stripeMock.paymentIntents.retrieve.mockRejectedValue(
        Object.assign(new Error("Stripe is down"), { type: "StripeAPIError", statusCode: 503 }),
      );

      const res = await runCron();
      expect(res.status).toBe(500);
      const body = await json(res);
      expect((body.results as Array<Record<string, unknown>>)[0].status).toBe("verify_error");
      expect(String((body.defectReasons as string[])[0])).toMatch(/payment verify job-1/);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(skips.lines()).toEqual([]);
    });
  });

  // Q1210: a gift smaller than the cost is reserved and the shortfall paid by
  // card, so the escrow is gift + capture. Capping at the gift alone refused
  // every payout larger than it, so the job could never pay out.
  describe("Q1210 a job paid partly by gift and partly by card", () => {
    function seedMixed(piStatus = "succeeded") {
      // $100 budget = $50 gift + $50 card shortfall; pro 10% → $90 payout.
      seedPayableJob(scenario, { profile: { onboarding_fee_paid: true } });
      scenario.reads.gift_cards = { rows: [{ id: "gift-1" }] };
      scenario.rpc.restore_gift_card_for_job = { outcome: "would_restore", applied_cents: 5000 };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_1",
        status: piStatus,
        latest_charge: "ch_1",
        amount: 5000,
        amount_received: piStatus === "succeeded" ? 5000 : 0,
      });
    }
    const runCron = async () => {
      const fn = await load();
      return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
    };

    // @mutate supabase/functions/process-scheduled-payouts/index.ts | if (!isPifFunded \|\| paymentIntentId \|\| job.stripe_session_id) { | if (!isPifFunded) {
    it("pays it, capped at the card capture plus the gift, never drawn from the shortfall charge", async () => {
      seedMixed();
      const res = await runCron();
      const body = await json(res);
      expect((body.results as Array<Record<string, unknown>>)[0].status).not.toBe("exceeds_captured_escrow");
      expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledWith("pi_1");
      expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
      const args = stripeMock.transfers.create.mock.calls[0][0];
      expect(args.amount).toBe(9000);
      expect(args.source_transaction).toBeUndefined();
    });

    it("still refuses a payout above card + gift", async () => {
      seedMixed();
      scenario.rpc.restore_gift_card_for_job = { outcome: "would_restore", applied_cents: 3000 };
      const res = await runCron();
      const body = await json(res);
      expect((body.results as Array<Record<string, unknown>>)[0].status).toBe("exceeds_captured_escrow");
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    // @mutate supabase/functions/process-scheduled-payouts/index.ts | if (pi.status !== "succeeded" && isPifFunded) { | if (false) {
    it("counts an uncaptured card leg as zero instead of blocking the gift's share", async () => {
      seedMixed("requires_payment_method");
      scenario.rpc.restore_gift_card_for_job = { outcome: "would_restore", applied_cents: 10000 };
      await runCron();
      expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
      expect(stripeMock.transfers.create.mock.calls[0][0].amount).toBe(9000);
    });

    it("defers (verify_error) when the card leg cannot be read, rather than capping at the gift", async () => {
      seedMixed();
      stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error("stripe down"));
      const res = await runCron();
      const body = await json(res);
      expect((body.results as Array<Record<string, unknown>>)[0].status).toBe("verify_error");
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    // @mutate supabase/functions/process-scheduled-payouts/index.ts | } else if (isPifFunded) { | } else if (false) {
    it("defers (verify_error) when the shortfall SESSION cannot be read", async () => {
      seedMixed();
      scenario.reads.jobs = {
        rows: [{ ...(scenario.reads.jobs as { rows: Record<string, unknown>[] }).rows[0], stripe_payment_intent_id: null }],
      };
      stripeMock.checkout.sessions.retrieve.mockRejectedValue(new Error("stripe down"));
      const res = await runCron();
      const body = await json(res);
      expect((body.results as Array<Record<string, unknown>>)[0].status).toBe("verify_error");
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });
  });

  // Q1211: a full refund (or cancel) that lands after this batch read its due
  // jobs flips the job; the batch used to transfer anyway (card refunded AND
  // Helpr paid). The claim re-reads the job and stands down.
  describe("Q1211 a refund that lands during the batch", () => {
    // @mutate supabase/functions/process-scheduled-payouts/index.ts | status: claim.jobMoved ? "job_moved_on" : "already_claimed" | status: "already_claimed"
    it("does not transfer, releases its claim, and reports job_moved_on (no defect)", async () => {
      seedPayableJob(scenario, { profile: { onboarding_fee_paid: true } });
      // The batch query returned the job as payout_pending; the re-read under
      // the claim sees the refund's flip.
      (scenario.reads.jobs as { selectOverrides?: unknown[] }).selectOverrides = [
        { includes: "id, payment_status", result: { rows: [{ id: "job-1", payment_status: "refunded" }] } },
      ];
      const fn = await load();
      const res = await fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
      const body = await json(res);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect((body.results as Array<Record<string, unknown>>)[0].status).toBe("job_moved_on");
      expect(body.defects).toBe(0);
      const release = scenario.writes.find((w) => w.table === "payout_transfers" && w.op === "update");
      expect(release?.payload).toMatchObject({ status: "canceled" });
    });
  });

  // Q1222 / Q1223: money a payout hold kept back is re-driven here, every
  // run, once the hold is released: claim rows + fixed idempotency keys.
  describe("Q1222/Q1223 re-drive of held money after the hold is released", () => {
    const HOLD = { helper_id: "helper-1", reason: "review", held_at: null, denied_at: null };
    const DAY = 86_400_000;
    const runCron = async () => {
      const fn = await load();
      return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
    };
    const seedNoJobs = () => {
      scenario.reads.jobs = { rows: [] };
      scenario.reads.platform_settings = { rows: [{ onboarding_fee_cents: 200 }] };
      scenario.reads.payout_transfers = { rows: [] };
      scenario.reads.chargeback_clawbacks = { rows: [] };
      scenario.reads.tip_hold_redrives = { rows: [] };
      scenario.reads.payout_holds = { rows: [] };
    };
    const heldTip = (over: Record<string, unknown> = {}) => ({
      tip_id: "tip-1", helper_id: "helper-1", transfer_id: "tr_tip", amount_cents: 1500, status: "reversed",
      updated_at: new Date(Date.now() - 3600_000).toISOString(), created_at: new Date(Date.now() - DAY).toISOString(), ...over,
    });
    const tipUpdates = () =>
      scenario.writes.filter((w) => w.table === "tip_hold_redrives" && w.op === "update");
    const alerts = () => slackAlerts as Array<{ severity?: string; title: string; message: string }>;
    const repayReady = () => {
      scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
      scenario.reads.tips = { rows: [{ job_id: "job-1" }] };
      stripeMock.transfers.list.mockResolvedValue({ data: [] });
    };

    // @mutate supabase/functions/process-scheduled-payouts/index.ts | const tipRedrive = await redriveHeldTips(stripe, supabaseAdmin); | const tipRedrive = { repaid: 0, kept: 0, waiting: 0, defects: [] as string[] };
    // @mutate supabase/functions/_shared/heldTipRepay.ts |   const group = `tip_${r.tip_id}`; |   const group = `job_${tipRow?.job_id}`;
    it("Q1222: a reversed tip is re-paid once its Helpr's hold is gone (claim, own tip_ group, fixed key, Helpr told)", async () => {
      seedNoJobs();
      scenario.reads.tip_hold_redrives = { rows: [heldTip()] };
      repayReady();
      stripeMock.transfers.create.mockResolvedValue({ id: "tr_repay" });
      const res = await runCron();
      expect(res.status).toBe(200);
      // tip_<id>, never job_<id>: the original tip has no group, so a job_
      // transfer would be an unrecorded job payout (review of Q1222).
      expect(stripeMock.transfers.list).toHaveBeenCalledWith(expect.objectContaining({ transfer_group: "tip_tip-1" }));
      expect(stripeMock.transfers.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 1500, destination: "acct_helper", transfer_group: "tip_tip-1", metadata: expect.objectContaining({ tip_id: "tip-1" }) }),
        { idempotencyKey: "tip-hold-repay-tip-1" },
      );
      const updates = tipUpdates().map((w) => w.payload as Record<string, unknown>);
      expect(updates[0]).toMatchObject({ status: "repaying" });
      expect(updates[updates.length - 1]).toMatchObject({ status: "repaid", repay_transfer_id: "tr_repay" });
      expect(scenario.writes.some((w) => w.table === "notifications" && (w.payload as Record<string, unknown>).user_id === "helper-1")).toBe(true);
      expect((await json(res)).heldRedrive).toMatchObject({ tips_repaid: 1 });
    });

    // @mutate supabase/functions/_shared/heldTipRepay.ts |       if (held) {\n        out.waiting++; |       if (false) {\n        out.waiting++;
    it("Q1222: a tip whose Helpr is STILL held waits: nothing moves, no page while young", async () => {
      seedNoJobs();
      scenario.reads.tip_hold_redrives = { rows: [heldTip()] };
      scenario.reads.payout_holds = { rows: [HOLD] };
      repayReady();
      stripeMock.transfers.create.mockResolvedValue({ id: "tr_repay" });
      await runCron();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(scenario.writes.some((w) => w.table === "tip_hold_redrives")).toBe(false);
      expect(alerts().some((a) => /tip/i.test(a.title))).toBe(false);
    });

    // @mutate supabase/functions/_shared/heldTipRepay.ts |   if (!Number.isFinite(since) \|\| now - since < HELD_TIP_AGE_ALERT_MS) return; |   return;
    it("Q1222: a held tip still owed after 14 days pages a WARNING that says not to pay it by hand", async () => {
      seedNoJobs();
      scenario.reads.tip_hold_redrives = { rows: [heldTip({ created_at: new Date(Date.now() - 15 * DAY).toISOString() })] };
      scenario.reads.payout_holds = { rows: [HOLD] };
      await runCron();
      const a = alerts().find((x) => /still owed/.test(x.title));
      expect(a?.severity).toBe("warning");
      expect(a?.message).toMatch(/NOT pay it by hand/);
    });

    // @mutate supabase/functions/_shared/heldTipRepay.ts | t.metadata?.type === "tip_hold_repay" && t.metadata?.tip_id === r.tip_id && !t.reversed); | false);
    it("Q1222: a re-pay Stripe already holds (a run died after the transfer) is adopted, never sent twice", async () => {
      seedNoJobs();
      scenario.reads.tip_hold_redrives = { rows: [heldTip({ status: "repaying" })] };
      repayReady();
      stripeMock.transfers.list.mockResolvedValue({ data: [{ id: "tr_prev", metadata: { type: "tip_hold_repay", tip_id: "tip-1" }, reversed: false }] });
      await runCron();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      const last = tipUpdates().pop();
      expect(last?.payload).toMatchObject({ status: "repaid", repay_transfer_id: "tr_prev" });
    });

    // @mutate supabase/functions/_shared/heldTipRepay.ts |       if (!claimed \|\| claimed.length === 0) continue; // another run took it |       if (false) continue;
    it("Q1222: a claim another run took first moves nothing here", async () => {
      seedNoJobs();
      scenario.reads.tip_hold_redrives = { rows: [heldTip()] };
      // Everything a re-pay would need is there: only the lost claim stops it.
      repayReady();
      stripeMock.transfers.create.mockResolvedValue({ id: "tr_repay" });
      scenario.writeSelectRows["tip_hold_redrives:update"] = [];
      await runCron();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    // review of Q1222: two runs that both read a row stale cannot both take it.
    // @mutate supabase/functions/_shared/heldTipRepay.ts |       if (r.status === "repaying") claimQ = claimQ.eq("updated_at", r.updated_at); |
    it("Q1222: re-taking a stale 'repaying' claim is pinned to the updated_at it was read at", async () => {
      seedNoJobs();
      const at = new Date(Date.now() - 3600_000).toISOString();
      scenario.reads.tip_hold_redrives = { rows: [heldTip({ status: "repaying", updated_at: at })] };
      repayReady();
      stripeMock.transfers.create.mockResolvedValue({ id: "tr_repay" });
      await runCron();
      const claim = tipUpdates()[0];
      expect(claim.payload).toMatchObject({ status: "repaying" });
      expect(claim.filters).toContainEqual({ op: "eq", column: "status", value: "repaying" });
      expect(claim.filters).toContainEqual({ op: "eq", column: "updated_at", value: at });
    });

    // review of Q1222: Stripe, not the row, says whether the reversal went out.
    // @mutate supabase/functions/_shared/heldTipRepay.ts |           const found = await ourReversal(stripe, r.transfer_id, r.tip_id); |           const found = null;
    it("Q1222: a stale 'owed' row whose reversal Stripe holds becomes 'reversed' (never 'kept' with the money stranded)", async () => {
      seedNoJobs();
      scenario.reads.tip_hold_redrives = { rows: [heldTip({ status: "owed" })] };
      stripeMock.transfers.listReversals.mockResolvedValue({ data: [{ id: "trr_prev", metadata: { reason: "payout_hold", tip_id: "tip-1" } }] });
      await runCron();
      expect(stripeMock.transfers.listReversals).toHaveBeenCalledWith("tr_tip", expect.anything());
      const ups = tipUpdates().map((w) => w.payload as Record<string, unknown>);
      expect(ups.some((p) => p.status === "kept")).toBe(false);
      expect(ups).toContainEqual(expect.objectContaining({ status: "reversed", reversal_id: "trr_prev" }));
    });

    it("Q1222: a stale 'owed' row with no reversal at Stripe and the hold gone is 'kept' (the Helpr keeps the tip)", async () => {
      seedNoJobs();
      scenario.reads.tip_hold_redrives = { rows: [heldTip({ status: "owed" })] };
      await runCron();
      expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled();
      expect(tipUpdates().map((w) => w.payload)).toContainEqual(expect.objectContaining({ status: "kept" }));
      // Second review (S-E): nobody told the Helpr when the tip was paid.
      expect(scenario.writes.some((w) => w.table === "notifications" && (w.payload as Record<string, unknown>).user_id === "helper-1")).toBe(true);
    });

    // Second review (S-F): the sweep's refused-reversal page names the tip, not "(sweep)".
    it("Q1222: a stale 'owed' row still held whose re-reversal Stripe refuses pages with the tip id", async () => {
      seedNoJobs();
      scenario.reads.tip_hold_redrives = { rows: [heldTip({ status: "owed" })] };
      scenario.reads.payout_holds = { rows: [HOLD] };
      stripeMock.transfers.createReversal.mockRejectedValue(Object.assign(new Error("transfer already fully reversed"), { type: "StripeInvalidRequestError" }));
      await runCron();
      const page = alerts().find((a) => /could not be pulled back/.test(a.title));
      expect(page?.message).toContain("tip-1");
      expect(page?.message).not.toContain("(sweep)");
    });

    // @mutate supabase/functions/_shared/heldTipRepay.ts |     else await ageAlert(r, now, "the Helpr has no payout account to send it to"); |     else void 0;
    it("Q1222: a Helpr with no payout account waits (back to 'reversed') and an old one pages a warning", async () => {
      seedNoJobs();
      scenario.reads.tip_hold_redrives = { rows: [heldTip({ created_at: new Date(Date.now() - 15 * DAY).toISOString() })] };
      scenario.reads.profiles = { rows: [{ stripe_account_id: null }] };
      await runCron();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(tipUpdates().pop()?.payload).toMatchObject({ status: "reversed" });
      expect(alerts().some((a) => a.severity === "warning" && /no payout account/.test(a.message))).toBe(true);
    });

    // review of Q1222: a key reused with other parameters never fixes itself.
    // @mutate supabase/functions/_shared/heldTipRepay.ts | type === "StripeRateLimitError" \|\|\n    (typeof | type === "StripeRateLimitError" \|\| type === "StripeIdempotencyError" \|\|\n    (typeof
    it("Q1222: StripeIdempotencyError on the re-pay is final ('failed', critical page), not retried forever", async () => {
      seedNoJobs();
      scenario.reads.tip_hold_redrives = { rows: [heldTip()] };
      repayReady();
      stripeMock.transfers.create.mockRejectedValue(Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters"), { type: "StripeIdempotencyError" }));
      await runCron();
      expect(tipUpdates().pop()?.payload).toMatchObject({ status: "failed" });
      expect(alerts().some((a) => a.severity === "critical" && /could not be re-paid/.test(a.title))).toBe(true);
    });

    // Q1293: the refused re-pay's 'failed' write is read; one that did not land
    // pages "mark it first" and is a defect, so a manual payment is not doubled
    // by a later run re-taking the still-'repaying' row.
    // @mutate supabase/functions/_shared/heldTipRepay.ts |     const unmarked = !!failErr \|\| !failedRows \|\| failedRows.length === 0; |     const unmarked = false;
    it("Q1293: a refused re-pay whose 'failed' write matches 0 rows pages 'mark it first' and is a defect", async () => {
      seedNoJobs();
      scenario.reads.tip_hold_redrives = { rows: [heldTip()] };
      repayReady();
      stripeMock.transfers.create.mockRejectedValue(Object.assign(new Error("account closed"), { type: "StripeInvalidRequestError" }));
      scenario.writeOverrides = [{ table: "tip_hold_redrives", op: "update", when: (p) => p.status === "failed", rows: [] }];
      const res = await runCron();
      expect(tipUpdates().pop()?.payload).toMatchObject({ status: "failed" });
      const page = alerts().find((a) => a.severity === "critical" && /NOT marked failed/.test(a.title));
      expect(page?.message).toMatch(/FIRST set that row's status to 'failed'/);
      const body = await res.json();
      expect(JSON.stringify(body)).toContain("refused re-pay not marked 'failed'");
    });

    // review of Q1222: the re-pay has no source charge, so a short balance waits.
    // @mutate supabase/functions/_shared/heldTipRepay.ts |     if (isBalanceShort(err)) { |     if (false) {
    it("Q1222: balance_insufficient on the re-pay waits (back to 'reversed'), never a final 'failed'", async () => {
      seedNoJobs();
      scenario.reads.tip_hold_redrives = { rows: [heldTip()] };
      repayReady();
      stripeMock.transfers.create.mockRejectedValue(Object.assign(new Error("Insufficient funds in Stripe account"), { type: "StripeInvalidRequestError", code: "balance_insufficient" }));
      await runCron();
      const last = tipUpdates().pop()?.payload as Record<string, unknown>;
      expect(last).toMatchObject({ status: "reversed" });
      expect(tipUpdates().some((w) => (w.payload as Record<string, unknown>).status === "failed")).toBe(false);
      expect(alerts().some((a) => a.severity === "critical")).toBe(false);
    });

    const owedRow = (over: Record<string, unknown> = {}) => ({
      id: "cb-1", dispute_id: "dp_1", job_id: "job-1", helper_id: "helper-1", original_transfer_id: "tr_1",
      stripe_account_id: "acct_helper", transfer_amount_cents: 9000, reversed_cents: 9000,
      stripe_reversal_id: "trr_1", repay_transfer_id: null, status: "reversed",
      failure_reason: "payout_hold: re-pay owed once the hold is released",
      held_repay_owed_at: new Date(Date.now() - DAY).toISOString(),
      updated_at: new Date(Date.now() - DAY).toISOString(), ...over,
    });
    const jobTitle = () => {
      scenario.reads.jobs = { rows: [], selectOverrides: [{ includes: "id, title", result: { rows: [{ id: "job-1", title: "Fence" }] } }] };
    };

    // @mutate supabase/functions/process-scheduled-payouts/index.ts | const clawbackRedrive = await redriveHeldClawbackRepays({ | const clawbackRedrive = { disputes: 0, repaidCents: 0, waiting: 0, defects: [] as string[] }; void ({
    // @mutate supabase/functions/_shared/chargebackClawback.ts |     .not("held_repay_owed_at", "is", null)\n    .in("status", ["reversed", "repay_failed", "repaying"]) |     .in("status", ["reversed", "repay_failed", "repaying"])
    // @mutate supabase/functions/_shared/chargebackClawback.ts |       if (res.rows > 0 && res.failed.length === 0 && res.held.length === 0 && res.holdErrors.length === 0 && res.othersOpen === 0) { |       if (false) {
    it("Q1223: a won chargeback's held re-pay runs once the hold is gone, under the webhook's own key, and the job returns to released", async () => {
      seedNoJobs();
      scenario.reads.chargeback_clawbacks = { rows: [owedRow()] };
      jobTitle();
      stripeMock.transfers.create.mockResolvedValue({ id: "tr_back" });
      const res = await runCron();
      expect(res.status).toBe(200);
      const read = scenario.readQueries.find((q) => q.table === "chargeback_clawbacks" && q.cols.includes("held_repay_owed_at"));
      expect(read?.filters).toContainEqual({ op: "not", column: "held_repay_owed_at", operator: "is", value: null });
      expect(stripeMock.transfers.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 9000, destination: "acct_helper" }),
        { idempotencyKey: "clawback-repay-dp_1-tr_1" },
      );
      expect(scenario.writes.some((w) => w.table === "chargeback_clawbacks" && (w.payload as Record<string, unknown>).held_repay_owed_at === null)).toBe(true);
      const back = scenario.writes.find((w) => w.table === "jobs" && (w.payload as Record<string, unknown>).payment_status === "released");
      expect(back?.filters).toContainEqual({ op: "eq", column: "payment_status", value: "chargeback" });
      expect((await json(res)).heldRedrive).toMatchObject({ clawback_disputes: 1, clawback_repaid_cents: 9000 });
    });

    // @mutate supabase/functions/_shared/chargebackClawback.ts |     if (r.helper_id && holds.holds.has(r.helper_id)) { |     if (false) {
    it("Q1223: still held, it waits (no transfer, no page while young)", async () => {
      seedNoJobs();
      scenario.reads.chargeback_clawbacks = { rows: [owedRow()] };
      scenario.reads.payout_holds = { rows: [HOLD] };
      jobTitle();
      stripeMock.transfers.create.mockResolvedValue({ id: "tr_back" });
      await runCron();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(slackAlerts).toHaveLength(0);
    });

    // @mutate supabase/functions/_shared/chargebackClawback.ts |       if (Number.isFinite(since) && now - since >= HELD_REPAY_AGE_ALERT_MS) { |       if (false) {
    it("Q1223: still held after 14 days pages a WARNING that says not to pay it by hand", async () => {
      seedNoJobs();
      scenario.reads.chargeback_clawbacks = { rows: [owedRow({ held_repay_owed_at: new Date(Date.now() - 15 * DAY).toISOString() })] };
      scenario.reads.payout_holds = { rows: [HOLD] };
      await runCron();
      const a = alerts().find((x) => /still waits on a payout hold/.test(x.title));
      expect(a?.severity).toBe("warning");
      expect(a?.message).toMatch(/NOT pay it by hand/);
    });

    // review of Q1223: one held crew member no longer makes the dispute wait.
    it("Q1223: per row — a clear Helpr is re-paid while a crew-mate on the same dispute stays held", async () => {
      seedNoJobs();
      scenario.reads.chargeback_clawbacks = {
        rows: [
          owedRow(),
          owedRow({ id: "cb-2", helper_id: "helper-2", original_transfer_id: "tr_2", stripe_account_id: "acct_h2", reversed_cents: 4000, transfer_amount_cents: 4000 }),
        ],
      };
      scenario.reads.payout_holds = { rows: [HOLD] };
      jobTitle();
      stripeMock.transfers.create.mockResolvedValue({ id: "tr_back2" });
      await runCron();
      expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
      expect(stripeMock.transfers.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 4000, destination: "acct_h2" }),
        { idempotencyKey: "clawback-repay-dp_1-tr_2" },
      );
      // One member still waits, so the job stays 'chargeback'.
      expect(scenario.writes.some((w) => w.table === "jobs" && (w.payload as Record<string, unknown>).payment_status === "released")).toBe(false);
    });

    // review of Q1223: a run that died after the claim is picked up again.
    // @mutate supabase/functions/_shared/chargebackClawback.ts |     r.status !== "repaying" \|\| !r.updated_at \|\| now - Date.parse(r.updated_at) > STALE_REPAYING_MS); |     r.status !== "repaying");
    it("Q1223: a stale 'repaying' row (the run died after the claim) is re-driven", async () => {
      seedNoJobs();
      scenario.reads.chargeback_clawbacks = { rows: [owedRow({ status: "repaying" })] };
      jobTitle();
      stripeMock.transfers.list.mockResolvedValue({ data: [] });
      stripeMock.transfers.create.mockResolvedValue({ id: "tr_back" });
      await runCron();
      expect(stripeMock.transfers.create).toHaveBeenCalledWith(expect.anything(), { idempotencyKey: "clawback-repay-dp_1-tr_1" });
    });

    it("Q1223: a FRESH 'repaying' row belongs to a live run and is not touched", async () => {
      seedNoJobs();
      scenario.reads.chargeback_clawbacks = { rows: [owedRow({ status: "repaying", updated_at: new Date().toISOString() })] };
      jobTitle();
      stripeMock.transfers.create.mockResolvedValue({ id: "tr_back" });
      await runCron();
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    // review of Q1223: a transient failure must not erase the debt record.
    // @mutate supabase/functions/_shared/chargebackClawback.ts |       if (isTransientStripeError(err)) {\n        // held_repay_owed_at stays: the re-drive retries it. |       await clearHeldRepayOwed(supabase, row.id, logStep);\n      if (isTransientStripeError(err)) {
    // SECOND review of Q1223, MUST-1 (double pay): row A was held (owed), its
    // sibling B was REFUSED by Stripe and handed to a person ("pay it by hand").
    // When A's hold lifts the sweep must pay A only: B may already be paid.
    // @mutate supabase/functions/_shared/chargebackClawback.ts |     if (opts.owned && (!sweepRow \|\| | if (opts.owned && (false \|\|
    it("Q1223: the sweep re-pays ONLY the owed row; a refused sibling is never paid again and keeps the job in chargeback", async () => {
      seedNoJobs();
      const a = owedRow();
      const b = owedRow({
        id: "cb-2", helper_id: "helper-2", original_transfer_id: "tr_2", stripe_account_id: "acct_h2", reversed_cents: 4000,
        transfer_amount_cents: 4000, status: "repay_failed", failure_reason: "account closed", held_repay_owed_at: null,
      });
      scenario.reads.chargeback_clawbacks = { rows: [a, b], selectOverrides: [{ includes: "held_repay_owed_at", result: { rows: [a] } }] };
      jobTitle();
      stripeMock.transfers.list.mockResolvedValue({ data: [] });
      stripeMock.transfers.create.mockResolvedValue({ id: "tr_back" });
      await runCron();
      expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
      expect(stripeMock.transfers.create).toHaveBeenCalledWith(expect.objectContaining({ destination: "acct_helper" }), expect.anything());
      expect(stripeMock.transfers.create).not.toHaveBeenCalledWith(expect.objectContaining({ destination: "acct_h2" }), expect.anything());
      expect(scenario.writes.some((w) => w.table === "jobs" && (w.payload as Record<string, unknown>).payment_status === "released")).toBe(false);
    });

    // Second review (MUST-1): the sweep's claim is pinned to what it read.
    // @mutate supabase/functions/_shared/chargebackClawback.ts |     if (row.updated_at) claimQ = claimQ.eq("updated_at", row.updated_at); |
    it("Q1223: the sweep's claim is a compare-and-set on the status AND the updated_at it read", async () => {
      seedNoJobs();
      const at = new Date(Date.now() - DAY).toISOString();
      scenario.reads.chargeback_clawbacks = { rows: [owedRow({ updated_at: at })] };
      jobTitle();
      stripeMock.transfers.create.mockResolvedValue({ id: "tr_back" });
      await runCron();
      const claim = scenario.writes.find((w) => w.table === "chargeback_clawbacks" && (w.payload as Record<string, unknown>).status === "repaying");
      expect(claim?.filters).toContainEqual({ op: "eq", column: "status", value: "reversed" });
      expect(claim?.filters).toContainEqual({ op: "eq", column: "updated_at", value: at });
      // First attempt stamped: the clock money-reconciliation measures from.
      expect((claim?.payload as Record<string, unknown>).held_repay_first_attempt_at).toEqual(expect.any(String));
    });

    it("Q1223: a TRANSIENT re-pay failure keeps the row owed for the next run", async () => {
      seedNoJobs();
      scenario.reads.chargeback_clawbacks = { rows: [owedRow()] };
      jobTitle();
      stripeMock.transfers.create.mockRejectedValue(Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" }));
      await runCron();
      expect(scenario.writes.some((w) => w.table === "chargeback_clawbacks" && (w.payload as Record<string, unknown>).held_repay_owed_at === null)).toBe(false);
    });
  });

  describe("group-job urgent split (#114)", () => {
    it("splits the urgent fee across the roster like the budget", async () => {
      // The poster is charged the urgent fee ONCE, bundled into escrow, so a
      // group job must divide it across helpers — else N helpers each collect
      // the full urgent bonus and the platform over-pays N×.
      // budget 300 / 3 helpers = $100 each; 10% commission = $10; urgent $30
      // nets its own 2.9% bundled Stripe cost ($30 − $0.87 = $29.13) then splits
      // 3 ways = $9.71. Payout = 100 − 10 + 9.71 = $99.71 → paid 9900¢ (Q236).
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
      // Q236: $99.71 owed is paid as $99; the platform keeps the 71 cents.
      expect(transferArg.amount).toBe(9900);
    });
  });
});

// Proof this guard can fail: restore the legacy 10% fallback rate and every
// payout on a job with no frozen percent under-collects the platform fee
// ($4 on a $200 job) — the fallback this file's `fee fallback` block pins to 12.
// @mutate supabase/functions/process-scheduled-payouts/index.ts | job.helper_fee_percent ?? DEFAULT_TIER_FEE_PERCENT, | job.helper_fee_percent ?? 10,
