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
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

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
      tip_amount: 10,
    },
  ];
  scenario.reads.profiles = { error: { message: "connection reset", code: "08006" } };
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
  describe("giveUp() — the terminal failure write", () => {
    /** Helper profile reads fine but has no connected account → giveUp(). */
    async function runGiveUp(): Promise<Response> {
      const fn = await loadConfigured();
      scenario.rpc.auto_tip_candidates = [
        { job_id: "job-1", customer_id: "poster-1", helper_id: "helper-1", budget: 100, tip_amount: 10 },
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
        { job_id: "job-1", customer_id: "poster-1", helper_id: "helper-1", budget: 100, tip_amount: 10 },
      ];
      scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_1" }] };
      scenario.adminUsers = { "poster-1": { email: "poster@test.com" } };
      // No Stripe customer → giveUp(..., notify: true).
      stripeMock.customers.list.mockResolvedValue({ data: [] });

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
        { job_id: "job-1", customer_id: "poster-1", helper_id: "helper-1", budget: 100, tip_amount: 10 },
      ];
      scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
      // The Stripe customer is resolved by email (there is no
      // stripe_customer_id column on profiles), so the poster needs one.
      scenario.adminUsers = { "poster-1": { email: "poster@test.com" } };
      stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_1" }] });
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

    it("charges off-session and records the intent id on the tips row", async () => {
      const res = await runSuccessfulCharge();
      expect(res.status).toBe(200);
      const b = await body(res);
      expect(b.charged).toBe(1);
      expect(b.defects).toBe(0);

      // The charge is idempotency-keyed on the claim row, so a Stripe-level
      // retry of this exact call can never mint a second charge.
      expect(stripeMock.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({ off_session: true, confirm: true, amount: 1000 }),
        { idempotencyKey: "auto-tip:mock-matched-row" },
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
