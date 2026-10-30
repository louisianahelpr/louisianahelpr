/**
 * Unit tests for the `auto-release-payment` Supabase edge function.
 *
 * This cron does two separable things. Phase 1 moves a job the POSTER APPROVED
 * (poster_completed_at, or Instant Release) from `escrow` to `payout_pending`
 * and NOTIFIES both parties with the day; a job past its approval window with
 * NO approval is escalated to Helpr support instead and its money stays held
 * (owner 2026-10-23). Phase 2 — gated behind `RELEASE_PAYOUT_AUTO=1` — hands
 * matured jobs to `release-payout`.
 *
 * WHY THIS FILE EXISTS. Phase 1's helper notification quotes a dollar figure:
 * "$X will be sent to your account Sun, Oct 25." (owner 2026-10-23)
 * No money moves here —
 * `process-scheduled-payouts` re-resolves the rate and pays — so a wrong number
 * on this path is not a wrong payout. It is a wrong PROMISE, which is the same
 * defect class as a report emailing the wrong figure, and the helper has no way
 * to tell the two apart.
 *
 * The preview therefore has to agree with the payer on BOTH paths, not just the
 * happy one. `process-scheduled-payouts` resolves the helper's live tier and, if
 * that read fails, prefers the rate FROZEN on the job at escrow
 * (`job.helper_fee_percent`) before it settles for `DEFAULT_TIER_FEE_PERCENT`.
 * This function must walk the identical chain or an Elite job funded at 8% is
 * previewed at 12% the moment the tier read blips.
 *
 * Runs the REAL function source via the edge harness — only Stripe, Supabase,
 * the shared alert helpers, and the Deno runtime are doubles.
 *
 * PROVEN ABLE TO FAIL 2026-09-21, twice.
 *
 *   1. Deleting `.is("revision_requested_at", null)` from the due query — the
 *      sweep pays out work the poster formally sent back — goes red:
 *      1 failed, 13 passed.
 *   2. Neutralising the Stripe capture gate goes red on the two tests added
 *      that day. It did NOT before: measured 2026-09-21, replacing
 *      `if (pi.status !== "succeeded")` with `if (false)` left ALL 53 edge
 *      guards green (818 passed), so the one check standing between an
 *      authorised-but-uncaptured charge and `payout_pending` was unasserted
 *      anywhere in the repo. That is now two behavioural tests, and the
 *      mutation below is the tripwire.
 */
// @mutate supabase/functions/auto-release-payment/index.ts | .is("revision_requested_at", null)\n      .or(`poster_completed_at | .or(`poster_completed_at
// @mutate supabase/functions/auto-release-payment/index.ts | if (pi.status !== "succeeded") { | if (false) {
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
import {
  DEFAULT_TIER_FEE_PERCENT,
  helperCommissionDollars,
} from "../../../supabase/functions/_shared/helperFees";
import { netUrgentFeeDollars } from "../../../supabase/functions/_shared/stripeFees";

const CRON_SECRET = "cron-secret-auto";
const HELPER_ID = "helper-1";
const POSTER_ID = "poster-1";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    CRON_SECRET,
    // Phase 2 stays off: everything under test here is Phase 1's preview.
    RELEASE_PAYOUT_AUTO: "0",
  });
  return loadEdgeFunction("auto-release-payment");
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

/** A cron-authenticated request. */
function cronRequest(fn: EdgeHarness): Request {
  return fn.request({
    method: "POST",
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
    url: "https://edge.test/auto-release-payment",
  });
}

/**
 * Seed ONE due, escrow-funded, gift-card-free job ready for Phase 1 release.
 *
 * `budget` is deliberately 200 so every fee percentage on the ladder lands on
 * whole dollars and an off-by-a-rung preview is unmistakable: 8% → $184,
 * 12% → $176.
 */
/**
 * A job the helper FIXED and the poster then ghosted past the 72h acceptance
 * deadline. Distinct from seedDueJob: it is `revision_requested`, its clock is
 * revision_acceptance_deadline rather than helper_completed_at, and it is
 * returned ONLY for the selector that asks for the revision columns — the
 * ordinary due query must not see it, exactly as in production where
 * `.is("revision_requested_at", null)` excludes it.
 */
function seedRevisionDueJob(s: SupabaseScenario, jobOverrides: Record<string, unknown> = {}) {
  const row = {
    id: "job-rev-1",
    title: "Repaint the trim",
    helper_id: HELPER_ID,
    customer_id: POSTER_ID,
    budget: 200,
    platform_fee_amount: 16,
    urgent_fee: 0,
    poster_completed_at: null,
    helper_completed_at: new Date(Date.now() - 120 * 3600 * 1000).toISOString(),
    revision_completed_at: new Date(Date.now() - 80 * 3600 * 1000).toISOString(),
    revision_acceptance_deadline: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
    stripe_session_id: "cs_1",
    stripe_payment_intent_id: "pi_1",
    status: "revision_requested",
    is_group_job: false,
    helpers_needed: 1,
    helper_fee_percent: 8,
    ...jobOverrides,
  };
  s.reads.jobs = {
    rows: [],
    selectOverrides: [{ includes: "revision_acceptance_deadline", result: { rows: [row] } }],
  };
  // Same three the ordinary due-job seed sets, for the same reasons: not
  // gift-card-funded so the Stripe capture check runs, an empty profiles BASE so the
  // instant-release flag lookup enqueues nobody, and a captured PaymentIntent
  // to verify against.
  s.reads.gift_cards = { rows: [] };
  s.reads.profiles = { rows: [] };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_1",
    status: "succeeded",
  });
}

function seedDueJob(s: SupabaseScenario, jobOverrides: Record<string, unknown> = {}) {
  s.reads.jobs = {
    // The revision settle-out selector (2026-09-05) reads the SAME table and,
    // but for these two columns, the same column list. The mock keys results by
    // table name, so without this every seeded due job would also come back as
    // a revision-due job and be released twice. A due job is not a revision
    // job, so the honest answer for that query is "no rows" — tests that want
    // one seed it explicitly via seedRevisionDueJob below.
    selectOverrides: [{ includes: "revision_acceptance_deadline", result: { rows: [] } }],
    rows: [
      {
        id: "job-1",
        title: "Deep clean before move-in",
        helper_id: HELPER_ID,
        customer_id: POSTER_ID,
        budget: 200,
        platform_fee_amount: 16,
        urgent_fee: 0,
        // The poster APPROVED 26 hours ago and the Helpr never confirmed: the one road on which this cron
        // still completes and schedules a payout (owner 2026-10-23). An unapproved job is escalated instead
        // (the "nothing is paid without the poster's approval" block below).
        poster_completed_at: new Date(Date.now() - 26 * 3600 * 1000).toISOString(),
        helper_completed_at: null,
        stripe_session_id: "cs_1",
        stripe_payment_intent_id: "pi_1",
        status: "in_progress",
        is_group_job: false,
        helpers_needed: 1,
        helper_fee_percent: 8,
        ...jobOverrides,
      },
    ],
  };
  // Not gift-card-funded → the Stripe capture check runs.
  s.reads.gift_cards = { rows: [] };
  // `profiles` is read twice on this path for unrelated reasons, so the BASE
  // result answers the instant-release flag lookup (`.select("user_id")`) with
  // no rows — nobody opted in — and `selectOverrides` below answers the tier
  // read. Without the empty base the mock would hand the flag query the tier
  // row and the same job would be enqueued twice.
  s.reads.profiles = { rows: [] };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_1",
    status: "succeeded",
  });
}

/** Give the helper a readable subscription tier. */
function seedHelperTier(s: SupabaseScenario, tier: string | null, expiresAt: string | null = null) {
  s.reads.profiles = {
    ...(s.reads.profiles ?? {}),
    selectOverrides: [
      {
        includes: "subscription_tier",
        result: { rows: [{ subscription_tier: tier, subscription_expires_at: expiresAt }] },
      },
    ],
  };
}

/**
 * Error ONLY the tier read, leaving the instant-release flag lookup healthy.
 * Failing the whole `profiles` table cannot distinguish the two — and the flag
 * lookup failing would change which jobs get processed at all.
 */
function failHelperTierRead(s: SupabaseScenario) {
  s.reads.profiles = {
    ...(s.reads.profiles ?? {}),
    selectOverrides: [
      {
        includes: "subscription_tier",
        result: { error: { message: "tier read boom" } },
      },
    ],
  };
}

/** The notification row sent to the helper, if any. */
function helperNotification(): Record<string, unknown> | undefined {
  const w = scenario.writes.find(
    (x) =>
      x.table === "notifications" &&
      x.op === "insert" &&
      (x.payload as Record<string, unknown>).user_id === HELPER_ID,
  );
  return w?.payload as Record<string, unknown> | undefined;
}

/** The whole-dollar figure the helper was promised, parsed back out of the copy. */
function previewedDollars(): number {
  const msg = String(helperNotification()?.message ?? "");
  const m = msg.match(/\$([\d,]+) will be sent/);
  if (!m) throw new Error(`no payout figure in helper notification: ${msg}`);
  return Number(m[1].replace(/,/g, ""));
}

/**
 * What `process-scheduled-payouts` would actually transfer for the same job —
 * recomputed here from the SAME shared helpers that function uses, so this is a
 * parity oracle rather than a hand-copied constant.
 */
function payerWouldSend(opts: {
  budget: number;
  feePercent: number;
  urgentFee?: number;
  helpersCount?: number;
}): number {
  const n = opts.helpersCount ?? 1;
  const perHelperBudget = opts.budget / n;
  const commission = helperCommissionDollars(perHelperBudget, opts.feePercent);
  return perHelperBudget - commission + netUrgentFeeDollars(opts.urgentFee ?? 0) / n;
}

describe("auto-release-payment edge function", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  describe("authorization", () => {
    it("returns 200 with CORS headers for an OPTIONS preflight", async () => {
      const fn = await load();
      const res = await fn.fetch(fn.request({ method: "OPTIONS" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("rejects a request with no Authorization header", async () => {
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ method: "POST", url: "https://edge.test/auto-release-payment" }),
      );
      expect(res.status).toBe(401);
    });

    it("rejects a wrong bearer token", async () => {
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          method: "POST",
          headers: { Authorization: "Bearer not-the-secret" },
          url: "https://edge.test/auto-release-payment",
        }),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("phase 1 release", () => {
    it("moves a due escrow job to payout_pending, guarded on payment_status", async () => {
      seedDueJob(scenario);
      seedHelperTier(scenario, "elite", new Date(Date.now() + 30 * 864e5).toISOString());

      const fn = await load();
      const res = await fn.fetch(cronRequest(fn));
      expect(res.status).toBe(200);
      const out = await json(res);
      expect(out.released).toBe(1);

      const jobWrite = scenario.writes.find((w) => w.table === "jobs" && w.op === "update");
      expect((jobWrite?.payload as Record<string, unknown>).payment_status).toBe("payout_pending");
      // Optimistic concurrency: the UPDATE must be conditional on the row still
      // being in escrow, or a chargeback landing mid-run is overwritten.
      expect(jobWrite?.filters).toContainEqual({
        op: "eq",
        column: "payment_status",
        value: "escrow",
      });
    });

    /**
     * THE CAPTURE GATE, ASSERTED.
     *
     * Step 2 re-reads the PaymentIntent and refuses to release anything whose
     * charge is not `succeeded`. Nothing in this repo asserted it: measured
     * 2026-09-21, replacing `if (pi.status !== "succeeded")` with `if (false)`
     * left ALL 53 edge guards green (818 tests), so the sweep could be made to
     * flip an authorised-but-uncaptured, a `requires_payment_method` or a
     * cancelled job to payout_pending — and `process-scheduled-payouts` then
     * transfers the helper money the platform never collected. The preview
     * parity block below pins the FIGURE; this pins whether money moves at all.
     */
    it("does NOT release a job whose charge was never captured", async () => {
      seedDueJob(scenario);
      seedHelperTier(scenario, "elite", new Date(Date.now() + 30 * 864e5).toISOString());
      // Authorised, not captured: the platform holds no money for this job.
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_1",
        status: "requires_capture",
      });

      const fn = await load();
      const res = await fn.fetch(cronRequest(fn));
      expect(res.status).toBe(200);
      const out = await json(res);
      expect(out.released).toBe(0);
      // and the row is untouched — no payout_pending, so the payout cron never
      // sees it.
      expect(scenario.writes.filter((w) => w.table === "jobs" && w.op === "update")).toHaveLength(0);
      expect(out.results).toContainEqual(
        expect.objectContaining({ job_id: "job-1", status: "pi_status_requires_capture", skipped: true }),
      );
    });

    it("fails CLOSED when the charge cannot be read at all", async () => {
      seedDueJob(scenario);
      seedHelperTier(scenario, "elite", new Date(Date.now() + 30 * 864e5).toISOString());
      stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error("stripe down"));

      const fn = await load();
      const res = await fn.fetch(cronRequest(fn));
      const out = await json(res);
      // Unknown money state is never a release.
      expect(out.released).toBe(0);
      expect(scenario.writes.filter((w) => w.table === "jobs" && w.op === "update")).toHaveLength(0);
      expect(out.results).toContainEqual(
        expect.objectContaining({ job_id: "job-1", status: "verify_failed" }),
      );
      // And it is PAGED, not swallowed: an escrow the sweep cannot read is a
      // defect, so the run answers 500 through cronResult — the one channel
      // sweep_cron_http_failures() watches.
      expect(res.status).toBe(500);
      expect((out.defectReasons as string[]).join(" ")).toContain("verify_failed job-1");
    });

    // Q764 (lh-money-escrow review): a held Helpr is not told "you'll be paid"
    // for a payout every payout path will refuse until the hold is released.
    // @mutate supabase/functions/auto-release-payment/index.ts |       if (job.helper_id && promiseHold.kind === "clear") { |       if (job.helper_id) {
    // @mutate supabase/functions/auto-release-payment/index.ts |         jobDefect(job.id, `payout hold read ${job.id}: ${promiseHold.message}`); |         void promiseHold;
    it("Q764: a held Helpr's job still completes, but no payout promise is sent", async () => {
      seedDueJob(scenario);
      scenario.reads.payout_holds = { rows: [{ helper_id: HELPER_ID, reason: "review", held_at: null, denied_at: null }] };
      const fn = await load();
      const res = await fn.fetch(cronRequest(fn));
      expect(res.status).toBe(200);
      // Told the job is approved (lh-money-escrow review should-fix 9), never an amount or a day.
      expect(helperNotification()?.message).toBe('"Deep clean before move-in" was approved.');
      const flip = scenario.writes.find((w) => w.table === "jobs" && w.op === "update");
      expect((flip?.payload as Record<string, unknown>)?.payment_status).toBe("payout_pending");
    });

    it("Q764: an unreadable hold sends no promise and is a defect", async () => {
      seedDueJob(scenario);
      scenario.reads.payout_holds = { error: { message: "connection reset", code: "08006" } };
      const fn = await load();
      const res = await fn.fetch(cronRequest(fn));
      // No promise on an unknown hold; only the neutral "was approved" line (should-fix 9).
      expect(String(helperNotification()?.message ?? "")).not.toMatch(/\$|will be sent/);
      expect(res.status).toBe(500);
      expect(((await json(res)).defectReasons as string[]).join(" ")).toContain("payout hold read job-1");
    });

    /**
     * Q891: a job funded before prod went live (2026-09-27) holds a Stripe id
     * minted under the TEST key. The LIVE key answers "No such ...; a similar
     * object exists in test mode". No real money is behind it, so the row is
     * skipped with ONE structured log line: never a release, never a defect,
     * never a page.
     */
    describe("Q891: a test-mode Stripe id read under the live key", () => {
      let skips: ReturnType<typeof captureTestModeSkips>;
      beforeEach(() => {
        skips = captureTestModeSkips();
      });
      afterEach(() => {
        skips.restore();
      });

      function expectNoMoneyMoved(out: Record<string, unknown>, res: Response) {
        expect(res.status).toBe(200);
        expect(out.released).toBe(0);
        expect((out.defectReasons as string[] | undefined) ?? []).toEqual([]);
        expect(slackAlerts).toHaveLength(0);
        expect(scenario.writes.filter((w) => w.table === "jobs")).toHaveLength(0);
        expect(stripeMock.refunds.create).not.toHaveBeenCalled();
        expect(stripeMock.transfers.create).not.toHaveBeenCalled();
        // (The Stripe mock has no paymentIntents.capture: this function never captures.)
        expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
        expect(stripeMock.paymentIntents.cancel).not.toHaveBeenCalled();
      }

      // @mutate supabase/functions/auto-release-payment/index.ts | logTestObjectUnderLiveKey("auto-release-payment", { job_id: job.id, object: "checkout.session", id: job.stripe_session_id }); | throw e;
      it("skips (never 500, never pages) when the checkout SESSION is a test-mode object", async () => {
        seedDueJob(scenario, { stripe_payment_intent_id: null, stripe_session_id: "cs_test_old" });
        seedHelperTier(scenario, "elite", new Date(Date.now() + 30 * 864e5).toISOString());
        stripeMock.checkout.sessions.retrieve.mockRejectedValue(
          testModeUnderLiveKey("checkout.session", "cs_test_old"),
        );

        const fn = await load();
        const res = await fn.fetch(cronRequest(fn));
        const out = await json(res);
        expectNoMoneyMoved(out, res);
        expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
        expect(out.results).toContainEqual(
          expect.objectContaining({ job_id: "job-1", status: "skipped_test_mode_object", skipped: true }),
        );
        expect(skips.lines()).toEqual([
          expect.objectContaining({
            event: "stripe_test_object_under_live_key",
            fn: "auto-release-payment",
            object: "checkout.session",
            id: "cs_test_old",
            job_id: "job-1",
          }),
        ]);
      });

      // @mutate supabase/functions/auto-release-payment/index.ts | logTestObjectUnderLiveKey("auto-release-payment", { job_id: job.id, object: "payment_intent", id: paymentIntentId }); | throw e;
      it("skips (never 500, never pages) when the PaymentIntent to verify is a test-mode object", async () => {
        seedDueJob(scenario, { stripe_payment_intent_id: "pi_test_old" });
        seedHelperTier(scenario, "elite", new Date(Date.now() + 30 * 864e5).toISOString());
        stripeMock.paymentIntents.retrieve.mockRejectedValue(
          testModeUnderLiveKey("payment_intent", "pi_test_old"),
        );

        const fn = await load();
        const res = await fn.fetch(cronRequest(fn));
        const out = await json(res);
        expectNoMoneyMoved(out, res);
        expect(out.results).toContainEqual(
          expect.objectContaining({ job_id: "job-1", status: "skipped_test_mode_object", skipped: true }),
        );
        expect(out.results).not.toContainEqual(expect.objectContaining({ status: "verify_failed" }));
        expect(skips.lines()).toEqual([
          expect.objectContaining({
            event: "stripe_test_object_under_live_key",
            fn: "auto-release-payment",
            object: "payment_intent",
            id: "pi_test_old",
            job_id: "job-1",
          }),
        ]);
      });

      // Control: any OTHER session-read error keeps its old outcome (no PI =>
      // skipped_no_pi, never a release) and is NOT logged as a test-mode skip.
      // The PI-verify control is "fails CLOSED when the charge cannot be read at all" above.
      it("control: a plain session-read failure still ends at skipped_no_pi, not a test-mode skip", async () => {
        seedDueJob(scenario, { stripe_payment_intent_id: null, stripe_session_id: "cs_1" });
        seedHelperTier(scenario, "elite", new Date(Date.now() + 30 * 864e5).toISOString());
        stripeMock.checkout.sessions.retrieve.mockRejectedValue(new Error("stripe down"));

        const fn = await load();
        const res = await fn.fetch(cronRequest(fn));
        const out = await json(res);
        expect(out.released).toBe(0);
        expect(scenario.writes.filter((w) => w.table === "jobs" && w.op === "update")).toHaveLength(0);
        expect(out.results).toContainEqual(expect.objectContaining({ job_id: "job-1", status: "skipped_no_pi" }));
        expect(skips.lines()).toEqual([]);
      });
    });

    it("notifies both parties", async () => {
      seedDueJob(scenario);
      seedHelperTier(scenario, "elite", new Date(Date.now() + 30 * 864e5).toISOString());

      const fn = await load();
      await fn.fetch(cronRequest(fn));

      expect(helperNotification()?.title).toBe("Job approved!");
      // A: the DAY, never "captured" / "being processed" (owner 2026-10-23).
      const helperMsg = String((helperNotification() as Record<string, unknown> | undefined)?.message ?? "");
      expect(helperMsg).toMatch(/will be sent to your account (Mon|Tue|Wed|Thu|Fri|Sat|Sun), [A-Z][a-z]{2} \d{1,2}\.$/);
      expect(helperMsg).not.toMatch(/captured|being processed|days after/);
      const posterNote = scenario.writes.find(
        (w) =>
          w.table === "notifications" &&
          (w.payload as Record<string, unknown>).user_id === POSTER_ID,
      );
      expect(posterNote).toBeDefined();
      expect(String((posterNote?.payload as Record<string, unknown>).message)).toMatch(/your Helpr is paid (Mon|Tue|Wed|Thu|Fri|Sat|Sun), /i);
    });
  });

  // ── The preview must equal what the payer will send ─────────────────────
  //
  // Each case pins the number the helper is SHOWN against the number
  // `process-scheduled-payouts` would compute for the identical job, derived
  // from the shared helpers rather than hard-coded, so a change to the ladder
  // or the rounding rule moves both sides at once.
  describe("payout preview parity with process-scheduled-payouts", () => {
    // Lead 2026-10-30: a first payout loses the setup fee, so the promise must not read higher.
    // @mutate supabase/functions/auto-release-payment/index.ts |         const promised = await payoutPromiseWords(supabaseAdmin, job.helper_id, job, helperPayout); |         const promised = `$${Math.floor(helperPayout)}`;
    // @mutate supabase/functions/_shared/payoutPromise.ts |   if (isGiveawayFixedPayJob(job)) return figure(payoutCents); |
    // @mutate supabase/functions/_shared/payoutPromise.ts |   if (profileErr) { |   if (false) {
    function owesSetupFee() {
      scenario.reads.profiles = { ...(scenario.reads.profiles ?? {}), rows: [{ onboarding_fee_paid: false }] };
      scenario.reads.platform_settings = { rows: [{ onboarding_fee_cents: 200 }] };
    }

    it("takes off a setup fee still owed, as the payout will", async () => {
      seedDueJob(scenario, { helper_fee_percent: 12 });
      seedHelperTier(scenario, null);
      owesSetupFee();
      const fn = await load();
      await fn.fetch(cronRequest(fn));
      expect(previewedDollars()).toBe(Math.floor(payerWouldSend({ budget: 200, feePercent: 12 })) - 2);
    });

    it("keeps the giveaway at $50 even with the setup fee owed", async () => {
      seedDueJob(scenario, { budget: 60, urgent_fee: 0, helper_fee_percent: 5, helper_fee_flat_cents: 700 });
      owesSetupFee();
      const fn = await load();
      await fn.fetch(cronRequest(fn));
      expect(previewedDollars()).toBe(50);
    });

    it("names no figure when the setup fee cannot be read", async () => {
      seedDueJob(scenario, { helper_fee_percent: 12 });
      scenario.reads.profiles = { selectOverrides: [{ includes: "onboarding_fee_paid", result: { error: { message: "boom" } } }] };
      const fn = await load();
      await fn.fetch(cronRequest(fn));
      expect(String(helperNotification()?.message ?? "")).toMatch(/^".*" was approved\. Your payment will be sent to your account /);
    });

    it("quotes the helper's live tier rate when the profile is readable", async () => {
      seedDueJob(scenario, { helper_fee_percent: 12 });
      seedHelperTier(scenario, "elite", new Date(Date.now() + 30 * 864e5).toISOString());

      const fn = await load();
      await fn.fetch(cronRequest(fn));

      // Live tier (8%) wins over the 12 frozen at escrow — on BOTH paths.
      expect(previewedDollars()).toBe(
        Math.floor(payerWouldSend({ budget: 200, feePercent: 8 })),
      );
      expect(previewedDollars()).toBe(184);
    });

    it("prefers the rate FROZEN on the job when the tier read fails", async () => {
      // The regression this file was written for. An Elite job funded at 8%
      // whose helper profile is briefly unreadable was previewed at
      // DEFAULT_TIER_FEE_PERCENT (12) — $176 — while the payout still paid 8%
      // ($184). No money was wrong; the promise was.
      seedDueJob(scenario, { helper_fee_percent: 8 });
      failHelperTierRead(scenario);

      const fn = await load();
      const res = await fn.fetch(cronRequest(fn));
      expect(res.status).toBe(200);

      expect(previewedDollars()).toBe(
        Math.floor(payerWouldSend({ budget: 200, feePercent: 8 })),
      );
      expect(previewedDollars()).toBe(184);
    });

    it("settles for the free rate only when the job carries no frozen percent", async () => {
      // The gift card shape: create-payment's gift card branch returns before
      // the escrow stamp, so the job has no frozen rate to prefer. The terminal
      // fallback is DEFAULT_TIER_FEE_PERCENT — the free rung, never a literal —
      // which is the safe direction: over-quoting a payout is not a thing, and
      // under-collecting the commission would be.
      seedDueJob(scenario, { helper_fee_percent: null });
      failHelperTierRead(scenario);

      const fn = await load();
      await fn.fetch(cronRequest(fn));

      expect(previewedDollars()).toBe(
        Math.floor(payerWouldSend({ budget: 200, feePercent: DEFAULT_TIER_FEE_PERCENT })),
      );
      expect(previewedDollars()).toBe(176);
    });

    // The behavioural tests above cannot see this, and that is the point of
    // stating it separately. The harness's Supabase double resolves a read by
    // TABLE NAME and hands back the whole seeded row whatever column list the
    // code asked for, so a `select` that forgot `helper_fee_percent` still
    // passes every assertion in this describe while shipping `undefined` to
    // production — where PostgREST returns exactly the columns requested and
    // the frozen rate silently becomes the free rung again.
    //
    // Verified against the real source rather than the mock. Both Phase 1
    // queries feed the same loop (the instant-release set is pushed into the
    // due set), so both have to carry the column.
    it("selects helper_fee_percent in ALL phase-1 job queries", async () => {
      const { readFileSync } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const { dirname, join, resolve } = await import("node:path");
      const here = dirname(fileURLToPath(import.meta.url));
      const src = readFileSync(
        join(resolve(here, "../../.."), "supabase/functions/auto-release-payment/index.ts"),
        "utf8",
      );
      // THREE now, not two: the due set, the instant-release set, and the
      // revision settle-out set added 2026-09-05. All three feed the same
      // release loop, so all three must carry the column — a new selector that
      // forgets it ships `undefined` to production, where PostgREST returns
      // exactly the columns asked for and the frozen rate silently becomes the
      // free rung. This count is the tripwire: adding a fourth selector must be
      // a deliberate act that updates this number.
      const phase1Selects = [...src.matchAll(/\.select\("([^"]*poster_completed_at[^"]*)"\)/g)];
      expect(phase1Selects).toHaveLength(3);
      for (const [, cols] of phase1Selects) {
        expect(cols.split(/\s*,\s*/)).toContain("helper_fee_percent");
      }
    });

    it("splits a group job's budget and urgent fee across the roster", async () => {
      // Same divisor the payer uses; a preview that forgot it would promise
      // each of three helpers the whole roster's budget.
      seedDueJob(scenario, {
        helper_fee_percent: 8,
        is_group_job: true,
        helpers_needed: 3,
        budget: 300,
        urgent_fee: 30,
      });
      failHelperTierRead(scenario);

      const fn = await load();
      await fn.fetch(cronRequest(fn));

      expect(previewedDollars()).toBe(
        Math.floor(
          payerWouldSend({ budget: 300, feePercent: 8, urgentFee: 30, helpersCount: 3 }),
        ),
      );
    });
  });

  // ── Revision settle-out (2026-09-05) ────────────────────────────────────
  // Before this, a revision job could never settle: the main query excludes
  // every revision row (correctly — it stopped posters being auto-paid out
  // from under a fix they had asked for), and nothing was written for the
  // other end. Helper delivers the fix, poster goes quiet, escrow sits
  // forever, and the only exit is a dispute the UI never mentions — while
  // three surfaces promise "payment auto-releases".
  describe("revision settle-out", () => {
    // Owner 2026-10-23: a fix the poster never answered is NOT paid; Helpr support steps in.
    // @mutate supabase/functions/auto-release-payment/index.ts | for (const j of revisionDue \|\| []) escalate.push({ job: j, reason: "revision" }); | for (const j of revisionDue \|\| []) (jobs \|\| []).push(j);
    it("escalates a fixed revision the poster ghosted past the deadline — never releases it", async () => {
      seedRevisionDueJob(scenario);
      seedHelperTier(scenario, "elite", new Date(Date.now() + 30 * 864e5).toISOString());
      scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
      scenario.rpc.file_approval_escalation = true;

      const fn = await load();
      const res = await fn.fetch(cronRequest(fn));
      expect(res.status).toBe(200);
      const out = await json(res);
      expect(out.released).toBe(0);
      expect(out.escalated).toBe(1);
      expect(scenario.writes.filter((w) => w.table === "jobs" && w.op === "update")).toHaveLength(0);
      // Filed for THIS stall: anchored on the fix's delivery, so a row closed before it is re-opened.
      const esc = (scenario.rpcCalls ?? []).find((c) => c.name === "file_approval_escalation");
      expect(esc?.args).toMatchObject({ p_job_id: "job-rev-1", p_reason: "revision" });
      expect(Date.parse(String((esc?.args as Record<string, unknown>).p_anchor))).toBeLessThan(Date.now() - 79 * 3600e3);
    });

    it("leaves an ordinary due job alone — the two selectors do not overlap", async () => {
      // Production relies on this: the due query excludes revision rows via
      // `.is("revision_requested_at", null)` and this one requires
      // status='revision_requested', so no job can be picked up twice and
      // released twice. Here the seed proves the revision selector returns
      // nothing for a plain due job.
      seedDueJob(scenario);
      seedHelperTier(scenario, "elite", new Date(Date.now() + 30 * 864e5).toISOString());

      const fn = await load();
      const res = await fn.fetch(cronRequest(fn));
      expect((await json(res)).released).toBe(1);
      expect(
        scenario.writes.filter((w) => w.table === "jobs" && w.op === "update"),
      ).toHaveLength(1);
    });
  });

  /**
   * THE DUE QUERY'S SCOPE, ASSERTED DIRECTLY.
   *
   * This could not be written before 2026-09-19. `.is()` was a chainable no-op
   * in the Supabase double — its entire body was `return this;` — so a test
   * asserting the presence OR the absence of `.is("revision_requested_at", null)`
   * was green either way. The test directly above says so in its own comment:
   * "Production relies on this: the due query excludes revision rows via
   * `.is("revision_requested_at", null)`" — and then proves it only indirectly,
   * through a seeded row count, because the clause itself was invisible.
   *
   * That guard is not decoration. Without it this sweep auto-completes and pays
   * out a job the poster formally sent back for a revision, against a UI that
   * has just promised them a 72-hour fix window and "Payment stays held until
   * you confirm". The money is gone and the poster's revision request is the
   * reason they were not watching.
   *
   * So the clause is now asserted as a clause. Deleting it from
   * `auto-release-payment/index.ts` turns this red; nothing else in the repo
   * goes red with it.
   */
  /**
   * NOTHING IS PAID WITHOUT THE POSTER'S APPROVAL (owner 2026-10-23, after "Mow two lawns" 7c6deb77).
   * A job the Helpr marked done 24 hours ago that the poster never approved used to be auto-completed
   * and paid here. Now it is escalated: one job_approval_escalations row, the poster, the Helpr and every
   * admin told, the escrow untouched.
   */
  // @mutate supabase/functions/auto-release-payment/index.ts | if (j.poster_completed_at \|\| instantIds.has(j.id)) approvedJobs.push(j); | if (true) approvedJobs.push(j);
  describe("nothing is paid without the poster's approval", () => {
    const seedUnapproved = () => {
      seedDueJob(scenario, { poster_completed_at: null, helper_completed_at: new Date(Date.now() - 25 * 3600 * 1000).toISOString() });
      seedHelperTier(scenario, "elite", new Date(Date.now() + 30 * 864e5).toISOString());
      scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }, { user_id: "admin-2" }] };
      scenario.rpc.file_approval_escalation = true;
    };
    const notesTo = (uid: string) => scenario.writes
      .filter((w) => w.table === "notifications")
      .flatMap((w) => (Array.isArray(w.payload) ? w.payload : [w.payload]) as Record<string, unknown>[])
      .filter((n) => n.user_id === uid);

    it("escalates a job the poster never approved: no money moves, everyone is told", async () => {
      seedUnapproved();
      const fn = await load();
      const res = await fn.fetch(cronRequest(fn));
      expect(res.status).toBe(200);
      const out = await json(res);
      expect(out.released).toBe(0);
      expect(out.escalated).toBe(1);
      // The escrow is untouched: no jobs write, no Stripe call.
      expect(scenario.writes.filter((w) => w.table === "jobs")).toHaveLength(0);
      expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
      const esc = (scenario.rpcCalls ?? []).find((c) => c.name === "file_approval_escalation");
      expect(esc?.args).toMatchObject({ p_job_id: "job-1", p_reason: "approval" });
      expect(notesTo(POSTER_ID).map((n) => n.title)).toEqual(["Please approve your Helpr's work"]);
      expect(String(notesTo(POSTER_ID)[0].message)).toMatch(/stays held/);
      expect(notesTo(HELPER_ID).map((n) => n.title)).toEqual(["Helpr support is stepping in"]);
      expect(notesTo("admin-1").map((n) => n.link)).toEqual(["/admin?view=stalled&job=job-1"]);
      expect(notesTo("admin-2")).toHaveLength(1);
      const all = scenario.writes.filter((w) => w.table === "notifications")
        .flatMap((w) => (Array.isArray(w.payload) ? w.payload : [w.payload]) as Record<string, unknown>[]);
      expect(all.some((n) => /auto-?releas|auto-?complet/i.test(String(n.message)))).toBe(false);
      expect(slackAlerts.some((a) => (a as { title?: string }).title === "Job waiting on approval")).toBe(true);
    });

    // lh-money-escrow review should-fix 4: a crew has no lead (helper_id NULL); every member is told.
    // @mutate supabase/functions/auto-release-payment/index.ts | if (job.is_group_job === true) {\n          const { data: crew, error: crewErr } = await supabaseAdmin | if (false) {\n          const { data: crew, error: crewErr } = await supabaseAdmin
    it("a crew job: every member is told, not a NULL lead", async () => {
      seedUnapproved();
      const due = (scenario.reads.jobs as { rows: Record<string, unknown>[] }).rows[0];
      Object.assign(due, { helper_id: null, is_group_job: true, helpers_needed: 2 });
      scenario.reads.group_job_helpers = { rows: [{ helper_id: "crew-a" }, { helper_id: "crew-b" }] };
      const fn = await load();
      const out = await json(await fn.fetch(cronRequest(fn)));
      expect(out.escalated).toBe(1);
      expect(notesTo("crew-a").map((n) => n.title)).toEqual(["Helpr support is stepping in"]);
      expect(notesTo("crew-b")).toHaveLength(1);
    });

    // lh-silent-failure review should-fix 7: a notice that did not land is a defect (no later run re-sends it).
    it("a notice that fails to write is a defect", async () => {
      seedUnapproved();
      scenario.writeErrors.notifications = { message: "rls says no" };
      const fn = await load();
      const out = await json(await fn.fetch(cronRequest(fn)));
      expect(out.escalated).toBe(1);
      expect((out.defectReasons as string[]).some((r) => /approval escalation notice to the person who posted it job-1 not written/.test(r))).toBe(true);
    });

    it("an escalation already filed is not filed or announced again", async () => {
      seedUnapproved();
      scenario.rpc.file_approval_escalation = false;
      const fn = await load();
      const out = await json(await fn.fetch(cronRequest(fn)));
      expect(out.escalated).toBe(0);
      expect(out.results).toContainEqual(expect.objectContaining({ job_id: "job-1", status: "escalated_before" }));
      expect(scenario.writes.filter((w) => w.table === "notifications")).toHaveLength(0);
    });

    it("a failed escalation write is a defect and still moves no money", async () => {
      seedUnapproved();
      scenario.rpcErrors = { file_approval_escalation: { message: "boom" } };
      const fn = await load();
      const out = await json(await fn.fetch(cronRequest(fn)));
      expect(out.escalated).toBe(0);
      expect((out.defectReasons as string[]).some((r) => /approval escalation job-1: boom/.test(r))).toBe(true);
      expect(scenario.writes.filter((w) => w.table === "jobs")).toHaveLength(0);
    });

    // B: the payout clock starts at the APPROVAL, not when the Helpr marked done.
    // @mutate supabase/functions/auto-release-payment/index.ts | standardPayoutAtIso(instantIds.has(job.id) ? null : job.poster_completed_at) | standardPayoutAtIso(job.helper_completed_at)
    it("an approved job's payout is scheduled 3 days after the APPROVAL", async () => {
      const approvedAt = Date.now() - 30 * 3600 * 1000;
      seedDueJob(scenario, {
        poster_completed_at: new Date(approvedAt).toISOString(),
        helper_completed_at: new Date(Date.now() - 50 * 3600 * 1000).toISOString(),
      });
      seedHelperTier(scenario, "elite", new Date(Date.now() + 30 * 864e5).toISOString());
      const fn = await load();
      await fn.fetch(cronRequest(fn));
      const jobWrite = scenario.writes.find((w) => w.table === "jobs" && w.op === "update");
      const at = Date.parse(String((jobWrite?.payload as Record<string, unknown>).payout_scheduled_at));
      expect(Math.abs(at - (approvedAt + 72 * 3600 * 1000))).toBeLessThan(1000);
    });
  });

  describe("the due query's scope", () => {
    const dueRead = () =>
      scenario.readQueries.find(
        (q) => q.table === "jobs" && q.cols.includes("platform_fee_amount"),
      );

    it("excludes jobs with a revision in flight", async () => {
      seedDueJob(scenario);
      seedHelperTier(scenario, "elite", new Date(Date.now() + 30 * 864e5).toISOString());
      const fn = await load();
      await fn.fetch(cronRequest(fn));

      const read = dueRead();
      expect(read, "phase 1 never read the jobs table").toBeDefined();
      expect(
        read!.filters,
        "The payout sweep must exclude jobs with a revision in flight, or it pays " +
          "out work the poster formally sent back. Expected .is(\"revision_requested_at\", null) among:\n" +
          JSON.stringify(read!.filters, null, 2),
      ).toContainEqual({ op: "is", column: "revision_requested_at", value: null });
    });

    it("is scoped to escrowed, in-flight, non-seed jobs past the hold", async () => {
      seedDueJob(scenario);
      seedHelperTier(scenario, "elite", new Date(Date.now() + 30 * 864e5).toISOString());
      const fn = await load();
      await fn.fetch(cronRequest(fn));

      const read = dueRead()!;
      // Every clause of the WHERE, each one load-bearing: the status set and
      // payment_status keep it off jobs that are not in escrow at all, is_seed
      // keeps the nightly money journeys out of a real payout run, and the
      // .or() is the 24h hold itself.
      expect(read.filters).toContainEqual({
        op: "in",
        column: "status",
        value: ["in_progress", "revision_requested", "accepted"],
      });
      expect(read.filters).toContainEqual({ op: "eq", column: "payment_status", value: "escrow" });
      expect(read.filters).toContainEqual({ op: "eq", column: "is_seed", value: false });
      const hold = read.filters.find((f) => f.op === "or");
      expect(String(hold?.value)).toMatch(/poster_completed_at\.lte\..+helper_completed_at\.lte\./);
    });
  });

});
