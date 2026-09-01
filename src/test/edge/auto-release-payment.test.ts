/**
 * Unit tests for the `auto-release-payment` Supabase edge function.
 *
 * This cron does two separable things. Phase 1 moves a completed job from
 * `escrow` to `payout_pending` (24h hold, or immediately for posters who opted
 * into instant release) and NOTIFIES both parties. Phase 2 — gated behind
 * `RELEASE_PAYOUT_AUTO=1` — hands matured jobs to `release-payout`.
 *
 * WHY THIS FILE EXISTS. Phase 1's helper notification quotes a dollar figure:
 * "$X will be transferred to your account in 24 hours." No money moves here —
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
 * Seed ONE due, escrow-funded, PIF-free job ready for Phase 1 release.
 *
 * `budget` is deliberately 200 so every fee percentage on the ladder lands on
 * whole dollars and an off-by-a-rung preview is unmistakable: 8% → $184,
 * 12% → $176.
 */
function seedDueJob(s: SupabaseScenario, jobOverrides: Record<string, unknown> = {}) {
  s.reads.jobs = {
    rows: [
      {
        id: "job-1",
        title: "Deep clean before move-in",
        helper_id: HELPER_ID,
        customer_id: POSTER_ID,
        budget: 200,
        platform_fee_amount: 16,
        urgent_fee: 0,
        poster_completed_at: null,
        helper_completed_at: new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
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
  // Not PIF-funded → the Stripe capture check runs.
  s.reads.pif_credits = { rows: [] };
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
  const m = msg.match(/\$([\d,]+) will be transferred/);
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

    it("notifies both parties", async () => {
      seedDueJob(scenario);
      seedHelperTier(scenario, "elite", new Date(Date.now() + 30 * 864e5).toISOString());

      const fn = await load();
      await fn.fetch(cronRequest(fn));

      expect(helperNotification()?.title).toBe("Job auto-completed!");
      const posterNote = scenario.writes.find(
        (w) =>
          w.table === "notifications" &&
          (w.payload as Record<string, unknown>).user_id === POSTER_ID,
      );
      expect(posterNote).toBeDefined();
    });
  });

  // ── The preview must equal what the payer will send ─────────────────────
  //
  // Each case pins the number the helper is SHOWN against the number
  // `process-scheduled-payouts` would compute for the identical job, derived
  // from the shared helpers rather than hard-coded, so a change to the ladder
  // or the rounding rule moves both sides at once.
  describe("payout preview parity with process-scheduled-payouts", () => {
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
      // The Pay-It-Forward shape: create-payment's PIF branch returns before
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
    it("selects helper_fee_percent in BOTH phase-1 job queries", async () => {
      const { readFileSync } = await import("node:fs");
      const { fileURLToPath } = await import("node:url");
      const { dirname, join, resolve } = await import("node:path");
      const here = dirname(fileURLToPath(import.meta.url));
      const src = readFileSync(
        join(resolve(here, "../../.."), "supabase/functions/auto-release-payment/index.ts"),
        "utf8",
      );
      const phase1Selects = [...src.matchAll(/\.select\("([^"]*poster_completed_at[^"]*)"\)/g)];
      expect(phase1Selects).toHaveLength(2);
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
});
