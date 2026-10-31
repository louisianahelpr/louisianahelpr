/**
 * Unit tests for the `auto-tip-charge` Supabase edge function — the hourly
 * sweeper that charges a poster's standing auto-tip after a job completes.
 *
 * The invariant under test is the CLAIM RELEASE. The function inserts a `tips`
 * row to claim the job before it touches Stripe (a unique partial index on
 * `(job_id) WHERE source='auto'` is what makes a double charge impossible). On
 * a transient read failure it deletes that claim so the NEXT tick can retry,
 * rather than marking the tip failed — which would set `auto_prompt_sent_at`
 * and block every future attempt.
 *
 * That delete used to discard its result entirely: no error check, no returning
 * projection. A DELETE matching zero rows returns `{ data: [], error: null }`,
 * so a claim that survived looked exactly like one that was released — and a
 * surviving claim is worse than an error, because `auto_tip_candidates()`
 * excludes any job that already has a `source='auto'` tips row. The job drops
 * out of the candidate list permanently, the helper never gets the money, and
 * nothing anywhere says so.
 *
 * Runs the REAL function source via the edge harness.
 *
 * PROVEN ABLE TO FAIL 2026-09-21. Restoring the exact defect this file was
 * written for — a zero-row claim release treated as a success, so the
 * surviving claim row removes the job from `auto_tip_candidates` forever and
 * nothing says so — goes red: 1 failed, 10 passed.
 *
 * UNCOVERED CLASS (reported 2026-09-21, not a gap in any test here): the claim
 * row is written `amount: tipDollars` (raw) while Stripe is charged
 * `Math.round(tipDollars * 100)`. `profiles_auto_tip_valid` only bounds
 * `auto_tip_value` to 1..500 on a bare `numeric`, so a `fixed` preference of
 * 10.555 charges $10.56 and records 10.555 in the ledger. Nothing pins the two
 * to agree; every test here uses a whole-dollar tip.
 */
// @mutate supabase/functions/auto-tip-charge/index.ts | if (!released \|\| released.length === 0) { | if (false) {
// @mutate supabase/functions/auto-tip-charge/index.ts | if (await featureEnabledForUser(supabase, "payout_after_hire", { id: c.helper_id as string })) { | if (false) {
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";

const CRON_SECRET = "cron-secret";

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    CRON_SECRET,
  });
  return loadEdgeFunction("auto-tip-charge");
}

function cronRequest(fn: EdgeHarness) {
  return fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` } });
}

/**
 * One candidate job, and the helper-profile read fails — the first of the two
 * paths that release the claim for retry.
 */
async function runWithFailedHelperRead(): Promise<Response> {
  const fn = await loadConfigured();
  scenario.rpc.auto_tip_candidates = [
    {
      job_id: "job-1",
      customer_id: "poster-1",
      helper_id: "helper-1",
      budget: 100,
      tip_amount: 10, tip_state: "chargeable",
    },
  ];
  scenario.reads.profiles = {
    error: { message: "connection reset", code: "08006" },
    // The Stripe-mode read (_shared/stripeMode.ts classifyParties) answers, so
    // the run reaches the claim and fails on the helper profile read itself.
    selectOverrides: [{ includes: "user_id, is_seed, email", result: { rows: [] } }],
  };
  return fn.fetch(cronRequest(fn));
}

async function body(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

function claimDelete() {
  return scenario.writes.find((w) => w.table === "tips" && w.op === "delete");
}

describe("auto-tip-charge edge function", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("claims the job before charging, then releases the claim on a transient read failure", async () => {
    const res = await runWithFailedHelperRead();

    const claim = scenario.writes.find((w) => w.table === "tips" && w.op === "insert");
    expect((claim?.payload as { source: string }).source).toBe("auto");
    expect((claim?.payload as { payment_status: string }).payment_status).toBe("pending");

    // The claim is DELETED, not marked failed: `giveUp()` would set
    // `auto_prompt_sent_at` and cement the failure, blocking every retry.
    expect(claimDelete()).toBeDefined();
    expect(scenario.writes.some((w) => w.table === "tips" && w.op === "update")).toBe(false);

    // A released claim is a clean run — the read failure itself is recorded as a
    // defect, but the release is not an extra one.
    const b = await body(res);
    expect(b.fn).toBe("auto-tip-charge");
    expect(String((b.defectReasons as string[])[0])).toContain("helper profile read");
  });

  it("records a DEFECT when the claim release matches zero rows, so the run answers 500", async () => {
    // Force the claim DELETE — and only the delete, not the claim INSERT that
    // precedes it on the same table — to match nothing.
    scenario.writeSelectRows["tips:delete"] = [];

    const res = await runWithFailedHelperRead();

    // BEFORE the fix the delete's result was thrown away entirely, so this run
    // reported the same thing whether the claim was released or stranded. A
    // stranded `pending` claim removes the job from `auto_tip_candidates`
    // forever: the tip never reaches the helper and nobody is told.
    expect(res.status).toBe(500);
    const b = await body(res);
    const reasons = (b.defectReasons as string[]).join(" | ");
    expect(reasons).toContain("matched 0 rows");
    expect(reasons).toContain("auto_tip_candidates");
    // The alert has to name the row, or clearing it is guesswork.
    expect(reasons).toContain("tips.id=mock-matched-row");
  });

  it("records a DEFECT when the claim release errors", async () => {
    scenario.writeErrors.tips = { message: "permission denied", code: "42501" };

    const res = await runWithFailedHelperRead();
    // The claim INSERT fails first in this scenario, which is its own defect —
    // what matters is that a failing tips write is never silent.
    expect(res.status).toBe(500);
    expect(String((await body(res)).defectReasons)).toContain("permission denied");
  });

  it("asks the claim release for `id` so a no-op release is detectable", async () => {
    // The mock resolves a write's `.select()` by table name and returns the
    // seeded rows regardless of projection, so the row-count assertions above
    // would pass with no `.select()` reasoning at all. Assert the projection is
    // actually on the source.
    scenario.writeSelectRows["tips:delete"] = [];
    await runWithFailedHelperRead();
    expect(claimDelete()?.selectCols).toBe("id");
  });
  /**
   * ── The two terminal `tips` UPDATEs ──────────────────────────────────────
   *
   * Both used to fire and forget: no error check, no returning projection. An
   * UPDATE matching zero rows returns `{ data: [], error: null }`, so "wrote
   * the outcome" and "wrote nothing" were the same observable result.
   *
   * They are the mirror of the claim-release delete, and worse in one respect:
   * the delete strands a claim and blocks retries, whereas these tell the
   * system the tip is permanently RESOLVED when they may have written nothing.
   * `auto_tip_candidates()` filters on `NOT EXISTS (… tips WHERE
   * source='auto')` — the row's existence, never its status — so the job leaves
   * the candidate list either way and no tick ever revisits it to notice.
   */
  // @mutate supabase/functions/auto-tip-charge/index.ts | if (tipCents < TIP_MIN_CENTS) { | if (false) {
  it("a percent auto-tip under the $3 minimum is never charged; the poster is asked to tip by hand", async () => {
    const fn = await loadConfigured();
    scenario.rpc.auto_tip_candidates = [
      { job_id: "job-1", customer_id: "poster-1", helper_id: "helper-1", budget: 20, tip_amount: 2.5, tip_state: "chargeable" },
    ];
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    const patch = scenario.writes.find((w) => w.table === "tips" && w.op === "update")?.payload as Record<string, unknown>;
    expect(patch.failure_reason).toBe("below_tip_minimum");
    const notice = scenario.writes.find((w) => w.table === "notifications")?.payload as Record<string, unknown>;
    expect(String(notice.message)).toMatch(/\$2\.50, under the \$3 tip minimum, so nothing was charged/);
  });

  // Owner 2026-10-30: no tip until the Helpr has verified their ID. Not claimed and not charged.
  it("a Helpr who has not verified their ID: no tips row, no charge, stays a candidate", async () => {
    const fn = await loadConfigured();
    scenario.rpc.auto_tip_candidates = [
      { job_id: "job-1", customer_id: "poster-1", helper_id: "helper-1", budget: 100, tip_amount: 10, tip_state: "chargeable" },
    ];
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
    scenario.rpc.payout_waits_on_identity = true;
    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(200);
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(scenario.writes.filter((w) => w.table === "tips" && w.op === "insert")).toHaveLength(0);
  });

  it("the ID check unreadable: fails closed, no charge, a defect", async () => {
    const fn = await loadConfigured();
    scenario.rpc.auto_tip_candidates = [
      { job_id: "job-1", customer_id: "poster-1", helper_id: "helper-1", budget: 100, tip_amount: 10, tip_state: "chargeable" },
    ];
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
    scenario.rpcErrors = { ...(scenario.rpcErrors ?? {}), payout_waits_on_identity: { message: "connection reset", code: "08006" } };
    const res = await fn.fetch(cronRequest(fn));
    expect(res.status).toBe(500);
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });

  describe("giveUp() — the terminal failure write", () => {
    /** Helper profile reads fine but has no connected account → giveUp(). */
    async function runGiveUp(): Promise<Response> {
      const fn = await loadConfigured();
      scenario.rpc.auto_tip_candidates = [
        { job_id: "job-1", customer_id: "poster-1", helper_id: "helper-1", budget: 100, tip_amount: 10, tip_state: "chargeable" },
      ];
      scenario.reads.profiles = { rows: [{ stripe_account_id: null }] };
      return fn.fetch(cronRequest(fn));
    }

    function tipUpdate() {
      return scenario.writes.find((w) => w.table === "tips" && w.op === "update");
    }

    it("marks the claim failed-with-reason rather than deleting it", async () => {
      const res = await runGiveUp();
      expect(res.status).toBe(200);

      const patch = tipUpdate()?.payload as Record<string, unknown>;
      expect(patch.payment_status).toBe("failed");
      expect(patch.failure_reason).toBe("helper_not_connected");
      expect(patch.auto_prompt_sent_at).toEqual(expect.any(String));
      // A deleted row would make the sweeper re-attempt the same doomed charge
      // every tick, so this path must NOT release the claim.
      expect(scenario.writes.some((w) => w.table === "tips" && w.op === "delete")).toBe(false);
      // `helper_not_connected` is the helper's account state — never surfaced
      // to the poster, who can do nothing about it.
      expect(scenario.writes.some((w) => w.table === "notifications")).toBe(false);
    });

    // Owner 2026-10-25 (payout_after_hire): payout setup comes after the hire,
    // so a Helpr with no account yet is a normal wait. The tip is NOT given up:
    // the claim is released for a later tick, nothing is charged, nobody is told
    // (lh-money-escrow review #3).
    it("payout_after_hire on for the Helpr: releases the claim for a retry instead of giving up", async () => {
      scenario.rpc.feature_enabled_for_user = (a?: unknown) =>
        (a as { p_key?: string; p_user_id?: string } | undefined)?.p_key === "payout_after_hire" &&
        (a as { p_user_id?: string }).p_user_id === "helper-1";
      const res = await runGiveUp();
      expect(res.status).toBe(200);
      expect(tipUpdate(), "no give-up write").toBeUndefined();
      expect(scenario.writes.some((w) => w.table === "tips" && w.op === "delete")).toBe(true);
      expect(scenario.writes.some((w) => w.table === "notifications")).toBe(false);
    });

    it("records a DEFECT when the give-up write matches zero rows, so the run answers 500", async () => {
      // Only the UPDATE, not the claim INSERT that precedes it on the same table.
      scenario.writeSelectRows["tips:update"] = [];

      const res = await runGiveUp();

      // BEFORE the fix: 200, defects 0, nothing logged. The tip reads as
      // permanently resolved while the row is still `pending` with no
      // `failure_reason` and no `auto_prompt_sent_at` — so the "confirm your
      // tip" nudge that reads that column never fires either.
      expect(res.status).toBe(500);
      const b = await body(res);
      const reasons = (b.defectReasons as string[]).join(" | ");
      expect(reasons).toContain("tip give-up write");
      expect(reasons).toContain("matched 0 rows");
      expect(reasons).toContain("never nudged");
      // Name the row, or clearing it is a hunt.
      expect(reasons).toContain("tips.id=mock-matched-row");
      // The reason that could not be recorded has to travel with the alert.
      expect(reasons).toContain("helper_not_connected");
    });

    it("still tells the poster even when the give-up write itself failed", async () => {
      scenario.writeSelectRows["tips:update"] = [];
      const fn = await loadConfigured();
      scenario.rpc.auto_tip_candidates = [
        { job_id: "job-1", customer_id: "poster-1", helper_id: "helper-1", budget: 100, tip_amount: 10, tip_state: "chargeable" },
      ];
      scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_1" }] };
      scenario.adminUsers = { "poster-1": { email: "poster@test.com" } };
      // No stored wallet customer (Q2138) → giveUp(..., notify: true).
      scenario.reads.stripe_customers = { rows: [] };

      await fn.fetch(cronRequest(fn));
      // Whether we managed to RECORD the failure has no bearing on whether it
      // happened to them — a poster who configured an automatic tip and got
      // silence would reasonably believe their helper was tipped.
      const notify = scenario.writes.find((w) => w.table === "notifications");
      expect((notify?.payload as { title: string }).title).toBe("Your tip didn't go through");
    });

    it("asks the give-up write for `id` — the column `tips` actually has", async () => {
      // The mock resolves a write's `.select()` by table name and returns the
      // seeded rows whatever the projection, so the row-count assertions above
      // would pass on a projection that 400s in prod. `stripe_webhook_events`
      // is exactly that trap (`event_id` PK, no `id`); `tips` is the opposite,
      // so the correct column here is `id`. Assert it on the source.
      scenario.writeSelectRows["tips:update"] = [];
      await runGiveUp();
      expect(tipUpdate()?.selectCols).toBe("id");
    });
  });

  describe("paid settlement — the write that runs AFTER the money moves", () => {
    /** Full happy path: saved card, off-session intent succeeds. */
    async function runSuccessfulCharge(): Promise<Response> {
      const fn = await loadConfigured();
      scenario.rpc.auto_tip_candidates = [
        { job_id: "job-1", customer_id: "poster-1", helper_id: "helper-1", budget: 100, tip_amount: 10, tip_state: "chargeable" },
      ];
      scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
      // The card sits on the poster's stored wallet customer (Q2138: never
      // a customer found by email); the email is for the receipt only.
      scenario.adminUsers = { "poster-1": { email: "poster@test.com" } };
      scenario.reads.stripe_customers = { rows: [{ stripe_customer_id: "cus_1" }] };
      stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_1", invoice_settings: { default_payment_method: { id: "pm_1", type: "card", customer: "cus_1" } } });
      stripeMock.paymentMethods.list.mockResolvedValue({ data: [{ id: "pm_1" }] });
      stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_auto_1", status: "succeeded" });
      return fn.fetch(cronRequest(fn));
    }

    function settleWrite() {
      return scenario.writes.find(
        (w) =>
          w.table === "tips" &&
          w.op === "update" &&
          (w.payload as { payment_status?: string }).payment_status === "paid",
      );
    }

    // Lead 2026-10-23: a tip is a destination charge; Stripe refuses it when
    // the Helpr's account cannot receive money. Loud, not silent: the poster is
    // told what happened (not "no saved card") and ops get an alert (error_logs).
    // @mutate supabase/functions/_shared/livePayoutHold.ts |   if (!platformRefused && !DESTINATION_NOT_PAYABLE.test(message)) return null; |   return null;
    // @mutate supabase/functions/auto-tip-charge/index.ts |         if (refused) { |         if (false) {
    it("a destination Stripe refuses: nothing charged, the poster told why, ops alerted (Stripe-refused, handled)", async () => {
      const refusal = Object.assign(
        new Error("Your destination account needs to have at least one of the following capabilities enabled: transfers, crypto_transfers, legacy_payments"),
        { type: "StripeInvalidRequestError", statusCode: 400 },
      );
      const fn = await loadConfigured();
      scenario.rpc.auto_tip_candidates = [
        { job_id: "job-1", customer_id: "poster-1", helper_id: "helper-1", budget: 100, tip_amount: 10, tip_state: "chargeable" },
      ];
      scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
      scenario.adminUsers = { "poster-1": { email: "poster@test.com" } };
      scenario.reads.stripe_customers = { rows: [{ stripe_customer_id: "cus_1" }] };
      stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_1", invoice_settings: { default_payment_method: { id: "pm_1", type: "card", customer: "cus_1" } } });
      stripeMock.paymentMethods.list.mockResolvedValue({ data: [{ id: "pm_1" }] });
      stripeMock.paymentIntents.create.mockRejectedValue(refusal);
      await fn.fetch(cronRequest(fn));
      const fail = scenario.writes.find((w) => w.table === "tips" && w.op === "update" && (w.payload as { payment_status?: string }).payment_status === "failed");
      expect(String((fail?.payload as { failure_reason?: string })?.failure_reason)).toMatch(/^payee_not_payable: /);
      const notice = scenario.writes.find((w) => w.table === "notifications" && w.op === "insert");
      expect(String((notice?.payload as { message?: string })?.message)).toContain("payout account can't receive tips right now");
      expect((slackAlerts as Array<{ oncePerDayKey?: string }>).some((a) => a.oncePerDayKey === "destination-charge-refused-helper-1")).toBe(true);
    });

    it("charges off-session and records the intent id on the tips row", async () => {
      const res = await runSuccessfulCharge();
      expect(res.status).toBe(200);
      const b = await body(res);
      expect(b.charged).toBe(1);
      expect(b.defects).toBe(0);

      // The charge is idempotency-keyed on the claim row, so a Stripe-level
      // retry of this exact call can never mint a second charge.
      expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
        // $10 tip: the poster is charged 1000 + 61 card fee, the application
        // fee is 61, so the Helpr's destination transfer is exactly 1000.
        expect.objectContaining({ off_session: true, confirm: true, amount: 1061, application_fee_amount: 61 }),
        { idempotencyKey: "auto-tip:mock-matched-row:c1061" },
      );
      expect((settleWrite()?.payload as { stripe_payment_intent_id: string }).stripe_payment_intent_id)
        .toBe("pi_auto_1");
    });

    it("records a DEFECT when the paid settlement matches zero rows — the poster HAS been charged", async () => {
      scenario.writeSelectRows["tips:update"] = [];

      const res = await runSuccessfulCharge();

      // BEFORE the fix this answered 200 with `charged: 1` and `defects: 0`:
      // money debited, transfer on its way, and the tips row still reading
      // 'pending' with a null stripe_payment_intent_id — the only join key
      // between the charge and the ledger — with nothing anywhere saying so.
      expect(res.status).toBe(500);
      const b = await body(res);
      const reasons = (b.defectReasons as string[]).join(" | ");
      expect(reasons).toContain("tip paid-settlement write");
      expect(reasons).toContain("matched 0 rows");
      expect(reasons).toContain("unreconcilable");
      // The alert must carry the payment_intent, or the charge cannot be found.
      expect(reasons).toContain("pi_auto_1");
      expect(reasons).toContain("tips.id=mock-matched-row");

      // The success path itself is unchanged: the charge really did succeed, so
      // the counter stays truthful and nothing is re-charged.
      expect(b.charged).toBe(1);
      expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
    });

    it("asks the paid settlement for `id` so a no-op settlement is detectable", async () => {
      scenario.writeSelectRows["tips:update"] = [];
      await runSuccessfulCharge();
      expect(settleWrite()?.selectCols).toBe("id");
    });
  });
});
