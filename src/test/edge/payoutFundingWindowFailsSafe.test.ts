/**
 * CLASS GUARD — a payout delayed past the window in which its charge can
 * still fund it must FAIL LOUD, never quietly succeed.
 *
 * Proven on prod 2026-09-22: two runs of `process-scheduled-payouts` four
 * minutes apart, same helper, same $22.
 *   job dd9e4db7… / charge ch_3UGKk7… (2026-09-16) → `balance_insufficient`
 *   job 3cb04981… / charge ch_3UILij… (today)      → paid (tr_3UILij…)
 *
 * Mechanism, and why it is a CLASS and not one bad job: the platform Stripe
 * account runs `settings.payouts.schedule = { interval: "daily",
 * delay_days: 2 }`. A transfer with `source_transaction` funds itself off a
 * still-PENDING charge. Two days later those funds go `available` and the
 * next daily payout sweeps them to the bank. After that sweep the charge can
 * fund nothing and the platform balance is $0.00, so EVERY charge-funded
 * transfer attempted more than the delay window after its charge fails the
 * same way. The owner-side remedy is a `manual` platform payout schedule —
 * a dashboard action. This file is the code-side half: whatever the schedule
 * is set to, the payout path must not be able to lose money or mislead
 * quietly when a transfer cannot be funded.
 *
 * Two assertions, both derived from source rather than hand-listed:
 *
 *  1. DRIFT — the inventory of charge-funded transfer paths is read out of
 *     `supabase/functions/*` by finding the real `source_transaction`
 *     assignments. Every one must be classified below. A sixth function that
 *     starts linking a charge to a transfer fails this test until someone
 *     says what happens to it when the charge can no longer fund.
 *
 *  2. BEHAVIOUR — the real function source is executed through the edge
 *     harness with Stripe rejecting `transfers.create` exactly as it did on
 *     prod (`code: "balance_insufficient"`). The run must not flip the job to
 *     `released`, must not tell the helper they were paid, must report the
 *     failure with its reason, and must raise an operator alert. Those four
 *     together are what distinguishes "the money did not move and we know it"
 *     from the silent version of this defect.
 *
 * @mutate supabase/functions/process-scheduled-payouts/index.ts | results.push({ job_id: job.id, status: "transfer_failed", error: (e as Error).message }); | results.push({ job_id: job.id, status: "transferred", amount: helperPayout });
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock, type SupabaseScenario } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";

const FUNCTIONS_DIR = join(process.cwd(), "supabase", "functions");
const CRON_SECRET = "cron-secret-xyz";

/**
 * Every edge function that funds a Stripe transfer off a specific charge,
 * read out of the tree. A comment mentioning `source_transaction` does not
 * count — only a real assignment (`source_transaction = …` or
 * `source_transaction: …`) on a line that is not itself a comment.
 */
function chargeFundedTransferFunctions(): string[] {
  const found: string[] = [];
  for (const name of readdirSync(FUNCTIONS_DIR)) {
    const file = join(FUNCTIONS_DIR, name, "index.ts");
    if (!existsSync(file)) continue;
    const assigns = readFileSync(file, "utf8")
      .split("\n")
      .some((line) => {
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return false;
        return /source_transaction\s*[:=]/.test(code);
      });
    if (assigns) found.push(name);
  }
  return found.sort();
}

/**
 * What each charge-funded path is, and how it is held to the invariant.
 * `proven: true` means this file executes its funding-failure branch below.
 * A new charge-funded function has to be added here with a reason, which is
 * the point: the decision cannot be skipped silently.
 */
const CLASSIFIED: Record<string, { proven: boolean; why: string }> = {
  "process-scheduled-payouts": {
    proven: true,
    why: "The cron that produced the prod failure. Its funding-failure branch is executed below.",
  },
  "release-payout": {
    proven: false,
    why: "Admin/manual sibling of the cron, same transfer shape; covered for other invariants in release-payout.test.ts.",
  },
  "execute-dispute-split": {
    proven: false,
    why: "Dispute split pays off the same escrow charge; covered in execute-dispute-split.test.ts.",
  },
  "create-payment": {
    proven: false,
    why: "Links the charge on refund/transfer admin paths, not on the scheduled payout path.",
  },
  "void-cancelled-payments": {
    proven: false,
    why: "Cancellation sweep; a failed transfer there leaves escrow held, which is the safe direction.",
  },
};

async function loadPayoutCron(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    CRON_SECRET,
  });
  return loadEdgeFunction("process-scheduled-payouts");
}

function capturedCentsFor(job: Record<string, unknown>): number {
  const budget = Number(job.budget ?? 0);
  const urgent = Number(job.urgent_fee ?? 0);
  return Math.round((budget + urgent) * 100 * 1.12);
}

/** A job that is payable in every respect except that the charge is stale. */
function seedPayableJob(s: SupabaseScenario) {
  const job = {
    id: "job-stale-charge",
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
  };
  s.reads.jobs = { rows: [job] };
  s.reads.platform_settings = { rows: [{ onboarding_fee_cents: 200 }] };
  s.reads.profiles = {
    rows: [
      {
        stripe_account_id: "acct_helper",
        onboarding_fee_paid: true,
        subscription_tier: "pro",
        subscription_expires_at: null,
      },
    ],
  };
  s.reads.payout_transfers = { rows: [] };
  s.reads.user_roles = { rows: [] };
  s.writeSelectRows.profiles = [{ user_id: "helper-1" }];
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_1",
    status: "succeeded",
    // The charge exists and succeeded — this defect is NOT a failed charge.
    // It is a succeeded charge whose funds have already been swept to the
    // bank, so linking it can no longer fund anything.
    latest_charge: "ch_swept",
    amount: capturedCentsFor(job),
    amount_received: capturedCentsFor(job),
  });
}

/** The exact rejection Stripe returned on prod for the 2026-09-16 charge. */
function stripeRefusesToFund() {
  const err = Object.assign(
    new Error(
      "Insufficient funds in your Stripe account. In test mode, you can add funds to your available balance " +
        "(bypassing your pending balance) with a charge that has a card number of 4000 0000 0000 0077.",
    ),
    {
      type: "StripeInvalidRequestError",
      code: "balance_insufficient",
      rawType: "invalid_request_error",
    },
  );
  stripeMock.transfers.create.mockRejectedValue(err);
}

type Result = { job_id?: string; status?: string; error?: string };

describe("payouts fail safe when the charge can no longer fund the transfer", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  describe("inventory drift", () => {
    it("finds the charge-funded transfer paths in the tree at all", () => {
      // Guards the derivation itself: if the regex stops matching, the
      // classification check below would pass vacuously.
      const found = chargeFundedTransferFunctions();
      expect(found.length).toBeGreaterThan(0);
      expect(found).toContain("process-scheduled-payouts");
    });

    it("every charge-funded transfer path is classified", () => {
      const found = chargeFundedTransferFunctions();
      const unclassified = found.filter((fn) => !(fn in CLASSIFIED));
      expect(
        unclassified,
        `These edge functions fund a Stripe transfer off a specific charge but are not classified in ` +
          `CLASSIFIED: ${unclassified.join(", ")}. A charge can only fund a transfer while its funds are ` +
          `still pending; say what happens to this path once they are not.`,
      ).toEqual([]);

      const stale = Object.keys(CLASSIFIED).filter((fn) => !found.includes(fn));
      expect(
        stale,
        `CLASSIFIED lists ${stale.join(", ")}, which no longer assign source_transaction. ` +
          `Remove them so the list stays a description of the tree.`,
      ).toEqual([]);
    });

    it("at least one path has its funding-failure branch actually executed", () => {
      expect(Object.values(CLASSIFIED).filter((c) => c.proven).length).toBeGreaterThan(0);
    });
  });

  describe("process-scheduled-payouts, charge past its fundable window", () => {
    async function run() {
      seedPayableJob(scenario);
      stripeRefusesToFund();
      const fn = await loadPayoutCron();
      const res = await fn.fetch(
        fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }),
      );
      const body = JSON.parse(await res.text()) as { results?: Result[] };
      return { res, results: body.results ?? [] };
    }

    it("does not report the unfunded transfer as a payout", async () => {
      const { results } = await run();
      const mine = results.find((r) => r.job_id === "job-stale-charge");
      expect(mine, `no result was reported for the job at all: ${JSON.stringify(results)}`).toBeDefined();
      expect(
        mine?.status,
        `Stripe refused the transfer with balance_insufficient, but the run reported ` +
          `"${mine?.status}" for the job. A transfer that never moved money must never be reported ` +
          `as one that did — that is how a swept charge becomes an invisible unpaid helper.`,
      ).not.toBe("transferred");
      // The reason Stripe gave has to survive into the report. The function
      // propagates `e.message` (Stripe's `code` is dropped — noted, not
      // asserted here), so this is the text an operator actually sees.
      expect(
        mine?.error ?? "",
        "the failure was reported without the reason Stripe gave, so nobody can tell a charge " +
          "that can no longer fund apart from any other payout failure",
      ).toContain("Insufficient funds");
    });

    it("leaves the job payout_pending — never flips it to released", async () => {
      await run();
      const released = scenario.writes.filter(
        (w) =>
          w.table === "jobs" &&
          w.op === "update" &&
          (w.payload as Record<string, unknown>)?.payment_status === "released",
      );
      expect(
        released,
        "the job was marked payment_status='released' although no money reached the helper; " +
          "the cron selects on payout_pending, so this row would never be retried or noticed again",
      ).toEqual([]);
    });

    it("never tells the helper they were paid", async () => {
      await run();
      const paidNotices = scenario.writes.filter(
        (w) =>
          w.table === "notifications" &&
          w.op === "insert" &&
          String((w.payload as Record<string, unknown>)?.title ?? "").toLowerCase().includes("payout sent"),
      );
      expect(
        paidNotices,
        "a 'Payout sent!' notification was written for a transfer Stripe refused",
      ).toEqual([]);
    });

    it("raises an operator alert instead of retrying in silence", async () => {
      await run();
      expect(
        slackAlerts.length,
        "Stripe refused to fund the transfer and no operator alert was raised. This failure repeats " +
          "on every cron run for as long as the charge stays swept, so with no alert it repeats forever " +
          "with nobody watching.",
      ).toBeGreaterThan(0);
      const alerted = JSON.stringify(slackAlerts);
      expect(alerted).toContain("job-stale-charge");
      expect(
        alerted,
        "the alert named the job but not why the transfer failed",
      ).toContain("Insufficient funds");
    });
  });
});
