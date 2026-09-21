/**
 * Unit tests for the `create-payment` Supabase edge function.
 *
 * `create-payment` is the entry point for every money-moving action on the
 * platform: opening Stripe escrow checkout, releasing payout when both
 * parties confirm, revision requests, tips, escrow cancellation, and the
 * admin dispute-resolution branches. It had ZERO automated coverage.
 *
 * These tests run the REAL function source via the edge harness
 * (`./harness.ts`) — only Stripe, Supabase, the rate limiter, and the Deno
 * runtime are replaced with inspectable doubles. The branching logic
 * (auth, ownership checks, idempotency guards, fee math, payout scheduling)
 * is exercised exactly as it runs in production.
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
import { rateLimitState, resetSharedMocks, slackAlerts } from "./mocks/shared";

const AUTH = { Authorization: "Bearer test-jwt" };
const POSTER = { id: "poster-1", email: "poster@test.com" };
const HELPER = { id: "helper-1", email: "helper@test.com" };
const ADMIN = { id: "admin-1", email: "admin@test.com" };

/** Load create-payment with a standard env. */
async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc123",
  });
  return loadEdgeFunction("create-payment");
}

/** Convenience: parse a JSON Response body. */
async function json(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

/** Seed an authenticated user + a happy customer.list (no Stripe create). */
function seedAuth(s: SupabaseScenario, user: typeof POSTER) {
  s.authUser = user;
  stripeMock.customers.list.mockResolvedValue({
    data: [{ id: "cus_existing" }],
  });
}

describe("create-payment edge function", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  describe("request gating", () => {
    it("returns 200 with CORS headers for an OPTIONS preflight", async () => {
      const fn = await load();
      const res = await fn.fetch(fn.request({ method: "OPTIONS" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("returns 429 when the rate limiter rejects the request", async () => {
      rateLimitState.allowed = false;
      rateLimitState.retryAfter = 42;
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: AUTH, body: { action: "escrow" } }),
      );
      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBe("42");
    });

    it("returns 401 when the Authorization header is missing", async () => {
      const fn = await load();
      const res = await fn.fetch(fn.request({ body: { action: "escrow" } }));
      expect(res.status).toBe(401);
      expect((await json(res)).error).toMatch(/authorization header/i);
    });

    it("returns 500 'Not authenticated' when the JWT resolves to no user", async () => {
      scenario.authUser = null;
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: AUTH, body: { action: "escrow" } }),
      );
      expect(res.status).toBe(500);
      expect((await json(res)).error).toMatch(/not authenticated/i);
    });

    it("rejects an unknown action", async () => {
      seedAuth(scenario, POSTER);
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: AUTH, body: { action: "definitely-not-real" } }),
      );
      expect(res.status).toBe(500);
      expect((await json(res)).error).toMatch(/invalid action/i);
    });
  });

  describe("Stripe customer get-or-create", () => {
    it("reuses an existing Stripe customer by email", async () => {
      scenario.authUser = POSTER;
      stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_old" }] });
      // jobId missing → escrow throws after customer lookup, which is fine:
      // the assertion below is that customers.create was NOT called.
      const fn = await load();
      await fn.fetch(fn.request({ headers: AUTH, body: { action: "escrow" } }));
      expect(stripeMock.customers.list).toHaveBeenCalledWith({
        email: POSTER.email,
        limit: 1,
      });
      expect(stripeMock.customers.create).not.toHaveBeenCalled();
    });

    it("creates a Stripe customer when none exists, tagged with the supabase user id", async () => {
      scenario.authUser = POSTER;
      scenario.reads.profiles = { rows: [{ full_name: "Pat Poster" }] };
      stripeMock.customers.list.mockResolvedValue({ data: [] });
      stripeMock.customers.create.mockResolvedValue({ id: "cus_new" });
      const fn = await load();
      await fn.fetch(fn.request({ headers: AUTH, body: { action: "escrow" } }));
      expect(stripeMock.customers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: POSTER.email,
          name: "Pat Poster",
          metadata: { supabase_user_id: POSTER.id },
        }),
      );
    });
  });

  describe("action: escrow", () => {
    it("rejects when jobId is missing", async () => {
      seedAuth(scenario, POSTER);
      const fn = await load();
      const res = await fn.fetch(
        fn.request({ headers: AUTH, body: { action: "escrow" } }),
      );
      expect((await json(res)).error).toMatch(/missing jobid/i);
    });

    it("rejects when the caller is not the job's customer (ownership check)", async () => {
      seedAuth(scenario, HELPER);
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: POSTER.id, budget: 100 }],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "escrow", jobId: "job-1" },
        }),
      );
      expect((await json(res)).error).toMatch(/not authorized/i);
    });

    it("rejects a job that is missing entirely", async () => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = { rows: [] };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "escrow", jobId: "ghost" },
        }),
      );
      expect((await json(res)).error).toMatch(/job not found/i);
    });

    it("blocks a second checkout when payment is already in progress (idempotency)", async () => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            budget: 100,
            stripe_session_id: "cs_old",
            payment_status: "escrow",
          },
        ],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "escrow", jobId: "job-1" },
        }),
      );
      expect((await json(res)).error).toMatch(/already been processed/i);
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    /**
     * Re-minting an unfunded checkout.
     *
     * `UnfundedJobNotice`'s "Finish paying" button covers exactly three
     * payment_status values — 'unpaid', 'abandoned' and 'failed' — and two of
     * them KEEP `stripe_session_id` (void-cancelled-payments' abandoned sweep
     * and stripe-webhook's payment_intent.payment_failed both leave it set).
     * The old guard refused any job with a session id whose status was not
     * 'unpaid', so the notice's only CTA 500'd forever with a message naming a
     * "cancel the existing payment" control that does not exist. Reproduced
     * live 2026-09-07 against prod job b732b37d ('abandoned').
     */
    describe("re-minting a checkout for an unfunded job", () => {
      function seedRemintable(paymentStatus: string, sessionId: string | null) {
        seedAuth(scenario, POSTER);
        scenario.reads.jobs = {
          rows: [
            {
              id: "job-1",
              customer_id: POSTER.id,
              budget: 100,
              category: "cleaning",
              title: "Clean my house",
              payment_status: paymentStatus,
              stripe_session_id: sessionId,
            },
          ],
        };
        scenario.reads.platform_settings = {
          rows: [{ customer_fee_percent: 10, helper_fee_percent: 10, onboarding_fee_cents: 200 }],
        };
        scenario.reads.profiles = {
          rows: [{ onboarding_fee_paid: true, subscription_tier: "pro" }],
        };
        stripeMock.checkout.sessions.create.mockResolvedValue({
          id: "cs_fresh",
          url: "https://checkout.stripe.test/cs_fresh",
        });
      }

      for (const status of ["unpaid", "abandoned", "failed"]) {
        it(`mints a fresh session for a '${status}' job that still holds a dead one`, async () => {
          seedRemintable(status, "cs_dead");
          // The old session is open-but-unpaid: the abandoned/declined shape.
          stripeMock.checkout.sessions.retrieve.mockResolvedValue({
            id: "cs_dead",
            status: "open",
            payment_status: "unpaid",
            payment_intent: null,
          });
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "escrow", jobId: "job-1" } }),
          );
          expect(res.status).toBe(200);
          expect((await json(res)).url).toBe("https://checkout.stripe.test/cs_fresh");

          // The dead session is retired, so only ONE payable session exists.
          expect(stripeMock.checkout.sessions.expire).toHaveBeenCalledWith("cs_dead");

          // The idempotency key is scoped to the session being REPLACED —
          // `escrow-job-1` alone would replay the expired session's response
          // for 24h and hand the poster a url that leads nowhere.
          const opts = stripeMock.checkout.sessions.create.mock.calls[0][1];
          expect(opts.idempotencyKey).toBe("escrow-job-1-after-cs_dead");

          // payment_status returns to the money-in-flight state: the
          // checkout.session.expired handler, void-cancelled-payments' sweep
          // and payment_intent.payment_failed all key on 'unpaid', so leaving
          // it 'abandoned'/'failed' would strand a live checkout.
          const stamp = scenario.writes.find(
            (w) => w.table === "jobs" && (w.payload as Record<string, unknown>)?.stripe_session_id === "cs_fresh",
          );
          expect(stamp).toBeTruthy();
          expect((stamp!.payload as Record<string, unknown>).payment_status).toBe("unpaid");
          // Guarded on the session id we read, so a concurrent re-mint cannot
          // be clobbered.
          expect(stamp!.filters).toContainEqual(
            expect.objectContaining({ column: "stripe_session_id", value: "cs_dead" }),
          );
        });
      }

      it("tolerates a concurrent re-mint that already expired the prior session", async () => {
        // `checkout.sessions.expire` is NOT idempotent, and nothing dedupes it
        // (the CREATE below is covered by its idempotency key, this is not).
        // Measured live 2026-09-07: two concurrent "Finish paying" taps, and the
        // loser got a 500 carrying Stripe's raw "Only Checkout Sessions with a
        // status in [open] can be expired" — the same dead end, one race
        // narrower. The loser must re-read and carry on.
        seedRemintable("abandoned", "cs_dead");
        stripeMock.checkout.sessions.retrieve
          .mockResolvedValueOnce({ id: "cs_dead", status: "open", payment_status: "unpaid", payment_intent: null })
          .mockResolvedValueOnce({ id: "cs_dead", status: "expired", payment_status: "unpaid", payment_intent: null });
        stripeMock.checkout.sessions.expire.mockRejectedValue(
          new Error("Only Checkout Sessions with a status in [\"open\"] can be expired."),
        );
        const fn = await load();
        const res = await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "escrow", jobId: "job-1" } }),
        );
        expect(res.status).toBe(200);
        expect((await json(res)).url).toBe("https://checkout.stripe.test/cs_fresh");
      });

      it("refuses if the prior session completed between the two reads", async () => {
        seedRemintable("abandoned", "cs_dead");
        stripeMock.checkout.sessions.retrieve
          .mockResolvedValueOnce({ id: "cs_dead", status: "open", payment_status: "unpaid", payment_intent: null })
          .mockResolvedValueOnce({ id: "cs_dead", status: "complete", payment_status: "paid", payment_intent: { id: "pi_1", status: "succeeded" } });
        stripeMock.checkout.sessions.expire.mockRejectedValue(new Error("cannot expire"));
        const fn = await load();
        const res = await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "escrow", jobId: "job-1" } }),
        );
        expect((await json(res)).error).toMatch(/still being processed/i);
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
      });

      it("refuses to re-mint when Stripe says the prior session was actually paid", async () => {
        // The webhook has not landed yet (or a stale payment_failed stamped the
        // job), so our copy of payment_status lies in the one direction that
        // would let a poster pay twice. Stripe is the last word.
        seedRemintable("failed", "cs_paid");
        stripeMock.checkout.sessions.retrieve.mockResolvedValue({
          id: "cs_paid",
          status: "complete",
          payment_status: "paid",
          payment_intent: { id: "pi_1", status: "succeeded" },
        });
        const fn = await load();
        const res = await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "escrow", jobId: "job-1" } }),
        );
        expect((await json(res)).error).toMatch(/still being processed/i);
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
        expect(stripeMock.checkout.sessions.expire).not.toHaveBeenCalled();
      });

      it("keeps the plain idempotency key for a job that never had a session", async () => {
        seedRemintable("unpaid", null);
        const fn = await load();
        const res = await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "escrow", jobId: "job-1" } }),
        );
        expect(res.status).toBe(200);
        expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
        expect(stripeMock.checkout.sessions.create.mock.calls[0][1].idempotencyKey).toBe(
          "escrow-job-1",
        );
      });
    });

    it("creates a manual-capture-free checkout session and returns its url", async () => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            budget: 100,
            category: "cleaning",
            title: "Clean my house",
            payment_status: "unpaid",
          },
        ],
      };
      scenario.reads.platform_settings = {
        rows: [{ customer_fee_percent: 10, helper_fee_percent: 10, onboarding_fee_cents: 200 }],
      };
      // Poster fee now derives from the poster's OWN tier, not the global fallback.
      // Pro tier = 10%, so the $10 service-fee assertion below still holds.
      scenario.reads.profiles = { rows: [{ onboarding_fee_paid: true, subscription_tier: "pro" }] };
      stripeMock.checkout.sessions.create.mockResolvedValue({
        id: "cs_new",
        url: "https://checkout.stripe.test/cs_new",
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "escrow", jobId: "job-1" },
        }),
      );
      expect(res.status).toBe(200);
      expect((await json(res)).url).toBe("https://checkout.stripe.test/cs_new");

      const args = stripeMock.checkout.sessions.create.mock.calls[0][0];
      expect(args.mode).toBe("payment");
      expect(args.automatic_tax).toEqual({ enabled: true });
      // job budget line item is $100 → 10000 cents
      expect(args.line_items[0].price_data.unit_amount).toBe(10000);
      // Pro-tier 10% customer fee → a $10 service-fee line item (1000 cents)
      const feeItem = args.line_items.find(
        (li: { price_data: { product_data: { name: string } } }) =>
          li.price_data.product_data.name === "Service fee",
      );
      expect(feeItem.price_data.unit_amount).toBe(1000);
      // poster already paid onboarding fee → no setup line item
      expect(
        args.line_items.some(
          (li: { price_data: { product_data: { name: string } } }) =>
            li.price_data.product_data.name === "One-time account setup",
        ),
      ).toBe(false);
    });

    it("appends the $2 onboarding line item for a poster who has not paid it", async () => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            budget: 50,
            category: "cleaning",
            title: "First job",
            payment_status: "unpaid",
          },
        ],
      };
      scenario.reads.platform_settings = {
        rows: [{ customer_fee_percent: 10, helper_fee_percent: 10, onboarding_fee_cents: 200 }],
      };
      scenario.reads.profiles = { rows: [{ onboarding_fee_paid: false }] };
      stripeMock.checkout.sessions.create.mockResolvedValue({
        id: "cs_first",
        url: "https://checkout.stripe.test/cs_first",
      });
      const fn = await load();
      await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "escrow", jobId: "job-1" },
        }),
      );
      const args = stripeMock.checkout.sessions.create.mock.calls[0][0];
      const setupItem = args.line_items.find(
        (li: { price_data: { product_data: { name: string } } }) =>
          li.price_data.product_data.name === "One-time account setup",
      );
      expect(setupItem).toBeDefined();
      expect(setupItem.price_data.unit_amount).toBe(200);
      expect(args.metadata.onboarding_fee_charged).toBe("true");
    });

    it("flags an assembly job as LA-taxable labor (tax_code txcd_20030000)", async () => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-asm",
            customer_id: POSTER.id,
            budget: 80,
            category: "assembly",
            title: "Build IKEA desk",
            payment_status: "unpaid",
          },
        ],
      };
      scenario.reads.platform_settings = {
        rows: [{ customer_fee_percent: 10, helper_fee_percent: 10, onboarding_fee_cents: 0 }],
      };
      scenario.reads.profiles = { rows: [{ onboarding_fee_paid: true }] };
      stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_a", url: "u" });
      const fn = await load();
      await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "escrow", jobId: "job-asm" },
        }),
      );
      const args = stripeMock.checkout.sessions.create.mock.calls[0][0];
      expect(args.line_items[0].price_data.product_data.tax_code).toBe(
        "txcd_20030000",
      );
    });

    // ── Server-authoritative urgent fee (silent-client H-001) ─────────────
    //
    // is_urgent / urgent_fee are client-set at INSERT and the jobs INSERT
    // column-lock trigger deliberately leaves them writable, so a poster
    // could POST a job directly with is_urgent=true and urgent_fee=NULL/0 and
    // reach the urgent notification fan-out for free. create-payment must not
    // trust the stored column: it charges the urgent tip ONLY when the job is
    // urgent, and never below the $5 floor. These pin that recompute at the
    // one place a real card is charged.
    describe("urgent fee is recomputed, never trusted", () => {
      function seedUrgentJob(overrides: Record<string, unknown>) {
        seedAuth(scenario, POSTER);
        scenario.reads.jobs = {
          rows: [
            {
              id: "job-urgent",
              customer_id: POSTER.id,
              budget: 100,
              category: "cleaning",
              title: "Urgent clean",
              payment_status: "unpaid",
              ...overrides,
            },
          ],
        };
        scenario.reads.platform_settings = {
          rows: [{ customer_fee_percent: 10, helper_fee_percent: 10, onboarding_fee_cents: 0 }],
        };
        scenario.reads.profiles = { rows: [{ onboarding_fee_paid: true, subscription_tier: "pro" }] };
        stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_u", url: "https://checkout.stripe.test/cs_u" });
      }

      function urgentLineItem(): { price_data: { unit_amount: number } } | undefined {
        const args = stripeMock.checkout.sessions.create.mock.calls[0][0];
        return args.line_items.find(
          (li: { price_data: { product_data: { name: string } } }) =>
            li.price_data.product_data.name === "Urgent tip",
        );
      }

      async function run() {
        const fn = await load();
        const res = await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "escrow", jobId: "job-urgent" } }),
        );
        expect(res.status).toBe(200);
      }

      it("charges the stored fee when the urgent job carries one at/above the floor", async () => {
        seedUrgentJob({ is_urgent: true, urgent_fee: 15 });
        await run();
        expect(urgentLineItem()?.price_data.unit_amount).toBe(1500);
      });

      it("floors the urgent tip at $5 even if the stored fee is NULL", async () => {
        // The free-placement bypass: is_urgent=true, urgent_fee never set.
        seedUrgentJob({ is_urgent: true, urgent_fee: null });
        await run();
        // Old code added NO urgent line (`(job.urgent_fee ?? 0) > 0` was false),
        // so the poster reached checkout urgent-for-free. Now it is floored.
        expect(urgentLineItem()?.price_data.unit_amount).toBe(500);
      });

      it("floors the urgent tip at $5 even if the stored fee is 0", async () => {
        seedUrgentJob({ is_urgent: true, urgent_fee: 0 });
        await run();
        expect(urgentLineItem()?.price_data.unit_amount).toBe(500);
      });

      it("charges NO urgent tip when the job is not urgent, whatever the column holds", async () => {
        // A stray positive urgent_fee on a non-urgent job must not be charged.
        seedUrgentJob({ is_urgent: false, urgent_fee: 25 });
        await run();
        expect(urgentLineItem()).toBeUndefined();
      });
    });

    // ── Poster fee fallback when the poster's PROFILE READ FAILS ──────────
    //
    // The charge-side twin of release-payout's "fee fallback on a failed tier
    // read". `create-payment` resolves the poster's service fee from their own
    // tier; when that profile read errors it has to fall back to SOMETHING, and
    // the number it picks is the number a real card is charged — there is no
    // later re-resolution to correct it the way there is on the payout side.
    //
    // It must be `DEFAULT_TIER_FEE_PERCENT` (the advertised free rate, 12), not
    // `platform_settings.customer_fee_percent`. The stored global is 10, so the
    // old fallback under-charged every free-tier poster by two points of budget
    // and the shortfall is not clawable after the fact — whereas over-charging
    // a discounted poster is refundable. Same principle the helper side now
    // follows: an unexpected value must never under-charge the platform.
    describe("poster fee fallback on a failed tier read", () => {
      /** Error ONLY the tier read; leave any other `profiles` read healthy. */
      function failPosterTierRead() {
        const healthy = scenario.reads.profiles;
        scenario.reads.profiles = {
          ...healthy,
          selectOverrides: [
            {
              includes: "subscription_tier",
              result: { error: { message: "poster tier read boom" } },
            },
          ],
        };
      }

      function seedEscrowJob() {
        seedAuth(scenario, POSTER);
        scenario.reads.jobs = {
          rows: [
            {
              id: "job-fb",
              customer_id: POSTER.id,
              budget: 200,
              category: "cleaning",
              title: "Fallback job",
              payment_status: "unpaid",
            },
          ],
        };
        // The global is deliberately left at the legacy 10 so this test keeps
        // proving the code no longer reads it, even if platform_settings is
        // later retuned to 12 in prod.
        scenario.reads.platform_settings = {
          rows: [{ customer_fee_percent: 10, helper_fee_percent: 12, onboarding_fee_cents: 200 }],
        };
        scenario.reads.profiles = {
          rows: [{ onboarding_fee_paid: true, subscription_tier: "free", subscription_expires_at: null }],
        };
        stripeMock.checkout.sessions.create.mockResolvedValue({
          id: "cs_fb",
          url: "https://checkout.stripe.test/cs_fb",
        });
      }

      /** The "Service fee" line item's unit_amount, in cents. */
      function serviceFeeCents(): number {
        const args = stripeMock.checkout.sessions.create.mock.calls[0][0];
        const item = args.line_items.find(
          (li: { price_data: { product_data: { name: string } } }) =>
            li.price_data.product_data.name === "Service fee",
        );
        return item.price_data.unit_amount;
      }

      it("charges the FREE rate (12), not the global 10, when the poster profile read fails", async () => {
        seedEscrowJob();
        failPosterTierRead();

        const fn = await load();
        const res = await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "escrow", jobId: "job-fb" } }),
        );
        expect(res.status).toBe(200);
        // $200 budget: 12% = $24.00. At the old global-10 fallback it was $20.00.
        expect(serviceFeeCents()).toBe(2400);
        // …and the percent STAMPED on the job matches what was charged, so the
        // admin console and every downstream display agree with the card.
        const jobWrite = scenario.writes.find(
          (w) => w.table === "jobs" && w.op === "update",
        );
        const payload = jobWrite?.payload as Record<string, unknown>;
        expect(payload.customer_fee_amount).toBe(24);
        expect(payload.platform_fee_percent).toBe(12);
      });

      it("still bills a readable Elite poster their own 8%, not the free rate", async () => {
        // The fix is error-path only: the happy path must keep honouring a
        // paid tier's discount.
        seedEscrowJob();
        scenario.reads.profiles = {
          rows: [{
            onboarding_fee_paid: true,
            subscription_tier: "elite",
            subscription_expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
          }],
        };

        const fn = await load();
        const res = await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "escrow", jobId: "job-fb" } }),
        );
        expect(res.status).toBe(200);
        expect(serviceFeeCents()).toBe(1600);
      });

      it("never bills the one-time onboarding fee when the profile read failed", async () => {
        // Unchanged guard, pinned here because the fallback edit sits on top of
        // it: a read failure leaves `posterProfile` null, and we must not
        // re-charge $2 to somebody who already paid it.
        seedEscrowJob();
        failPosterTierRead();

        const fn = await load();
        await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "escrow", jobId: "job-fb" } }),
        );
        const args = stripeMock.checkout.sessions.create.mock.calls[0][0];
        expect(
          args.line_items.some(
            (li: { price_data: { product_data: { name: string } } }) =>
              li.price_data.product_data.name === "One-time account setup",
          ),
        ).toBe(false);
      });
    });
  });

  describe("action: release", () => {
    /** Job started long enough ago that the 30-minute minimum is satisfied. */
    const longAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    it("rejects a caller who is neither poster nor helper", async () => {
      seedAuth(scenario, { id: "stranger", email: "x@test.com" });
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            status: "in_progress",
          },
        ],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "release", jobId: "job-1" },
        }),
      );
      expect((await json(res)).error).toMatch(/not authorized/i);
    });

    it("rejects release while the job is under dispute", async () => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            status: "disputed",
          },
        ],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "release", jobId: "job-1" },
        }),
      );
      expect((await json(res)).error).toMatch(/dispute|not in progress/i);
    });

    it("enforces the 30-minute minimum job time", async () => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            status: "in_progress",
            // The window is anchored to poster_confirmed_working_at ?? helper_arrived_at,
            // matching enforce_helper_completion_gates and both clients. It used to be
            // anchored to helper_confirmed_at ?? updated_at — and because `jobs` carries
            // update_updated_at_column, that window restarted on every write to the row
            // and could never elapse. Seeding helper_confirmed_at here would now prove
            // nothing: it is no longer the anchor.
            helper_arrived_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          },
        ],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "release", jobId: "job-1" },
        }),
      );
      expect((await json(res)).error).toMatch(/at least 30 minutes/i);
    });

    it("first party to confirm: marks not-both-done, no payout scheduled", async () => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            status: "in_progress",
            budget: 100,
            helper_confirmed_at: longAgo,
            poster_completed_at: null,
            helper_completed_at: null,
          },
        ],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "release", jobId: "job-1" },
        }),
      );
      const out = await json(res);
      expect(res.status).toBe(200);
      expect(out.bothDone).toBe(false);
      expect(out.helperPayout).toBe(0);
      // The job update must NOT have flipped status to completed.
      const jobUpdate = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect((jobUpdate?.payload as Record<string, unknown>).status).not.toBe(
        "completed",
      );
    });

    it("both parties confirmed: verifies the charge succeeded and schedules payout", async () => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            status: "in_progress",
            budget: 100,
            urgent_fee: 0,
            helper_fee_percent: 10,
            platform_fee_amount: 10,
            helper_confirmed_at: longAgo,
            poster_completed_at: null,
            // helper already confirmed — poster confirming now makes bothDone
            helper_completed_at: longAgo,
            stripe_payment_intent_id: "pi_123",
          },
        ],
      };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_123",
        status: "succeeded",
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "release", jobId: "job-1" },
        }),
      );
      const out = await json(res);
      expect(res.status).toBe(200);
      expect(out.bothDone).toBe(true);
      // budget 100 - 10% commission = 90 payout
      expect(out.helperPayout).toBe(90);
      const jobUpdate = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      const payload = jobUpdate?.payload as Record<string, unknown>;
      expect(payload.status).toBe("completed");
      expect(payload.payment_status).toBe("payout_pending");
      expect(payload.payout_scheduled_at).toBeTruthy();
    });

    it("refuses to schedule payout when the payment intent has not succeeded", async () => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            status: "in_progress",
            budget: 100,
            helper_confirmed_at: longAgo,
            helper_completed_at: longAgo,
            stripe_payment_intent_id: "pi_bad",
          },
        ],
      };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_bad",
        status: "requires_payment_method",
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "release", jobId: "job-1" },
        }),
      );
      expect(res.status).toBe(500);
      expect((await json(res)).error).toMatch(/payment not captured/i);
    });
  });

  describe("action: request_revision", () => {
    it("only the poster may request a revision", async () => {
      seedAuth(scenario, HELPER);
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            status: "in_progress",
          },
        ],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "request_revision", jobId: "job-1" },
        }),
      );
      expect((await json(res)).error).toMatch(/not authorized/i);
    });

    it("flips the job to revision_requested and notifies the helper", async () => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            status: "in_progress",
            title: "Paint fence",
          },
        ],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "request_revision", jobId: "job-1", note: "Missed a spot" },
        }),
      );
      expect(res.status).toBe(200);
      const jobUpdate = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect((jobUpdate?.payload as Record<string, unknown>).status).toBe(
        "revision_requested",
      );
      const notif = scenario.writes.find((w) => w.table === "notifications");
      expect((notif?.payload as Record<string, unknown>).user_id).toBe(HELPER.id);
    });
  });

  describe("action: resolve_revision", () => {
    it("only the helper may resolve a revision", async () => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            status: "revision_requested",
          },
        ],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "resolve_revision", jobId: "job-1" },
        }),
      );
      expect((await json(res)).error).toMatch(/not authorized/i);
    });

    it("records completion + acceptance deadline and notifies the poster", async () => {
      seedAuth(scenario, HELPER);
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            status: "revision_requested",
            title: "Paint fence",
          },
        ],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "resolve_revision", jobId: "job-1" },
        }),
      );
      expect(res.status).toBe(200);
      const jobUpdate = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      const payload = jobUpdate?.payload as Record<string, unknown>;
      expect(payload.revision_completed_at).toBeTruthy();
      expect(payload.revision_acceptance_deadline).toBeTruthy();
    });
  });

  describe("action: tip", () => {
    it("rejects a non-numeric tip amount", async () => {
      seedAuth(scenario, POSTER);
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "tip", jobId: "job-1", amount: "abc" },
        }),
      );
      expect((await json(res)).error).toMatch(/invalid tip amount/i);
    });

    it("rejects a sub-$1 tip below the fee-crossover floor", async () => {
      seedAuth(scenario, POSTER);
      const fn = await load();
      // A $0.25 tip would make the application_fee_amount (≥30¢) exceed the
      // charge, which Stripe rejects — the floor turns that into a clean error.
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "tip", jobId: "job-1", amount: 0.25 },
        }),
      );
      expect((await json(res)).error).toMatch(/between \$1 and \$1,000/i);
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it("rejects a tip above the $1,000 ceiling", async () => {
      seedAuth(scenario, POSTER);
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "tip", jobId: "job-1", amount: 5000 },
        }),
      );
      expect((await json(res)).error).toMatch(/between \$1 and \$1,000/i);
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it("only the person who posted the job may tip, and only on a completed job", async () => {
      seedAuth(scenario, HELPER);
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            status: "completed",
          },
        ],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "tip", jobId: "job-1", amount: 10 },
        }),
      );
      expect((await json(res)).error).toMatch(/only the person who posted this job can tip/i);
    });

    it("creates a tip checkout with a direct transfer to the helper's connected account", async () => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            status: "completed",
            title: "Mow lawn",
          },
        ],
      };
      scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
      stripeMock.checkout.sessions.create.mockResolvedValue({
        id: "cs_tip",
        url: "https://checkout.stripe.test/tip",
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "tip", jobId: "job-1", amount: 15 },
        }),
      );
      expect(res.status).toBe(200);
      const args = stripeMock.checkout.sessions.create.mock.calls[0][0];
      expect(args.line_items[0].price_data.unit_amount).toBe(1500);
      expect(args.payment_intent_data.transfer_data.destination).toBe(
        "acct_helper",
      );
      // The tip covers its own Stripe fee: the platform retains exactly the
      // processing cost as the application fee (round(1500*0.029)+30 = 74),
      // so the helper nets tip-minus-fee and the platform never subsidizes it.
      expect(args.payment_intent_data.application_fee_amount).toBe(74);
      // tips ledger row written
      expect(
        scenario.writes.some((w) => w.table === "tips" && w.op === "insert"),
      ).toBe(true);
    });
  });

  describe("action: cancel_escrow", () => {
    it("refunds a succeeded payment intent minus the non-refundable service fee and cancels the job", async () => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            status: "open",
            stripe_payment_intent_id: "pi_live",
            budget: 100,
            customer_fee_amount: 10,
          },
        ],
      };
      // $110 captured at checkout ($100 budget + $10 service fee).
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_live",
        status: "succeeded",
        amount: 11000,
        amount_received: 11000,
      });
      stripeMock.refunds.create.mockResolvedValue({ id: "re_1" });
      // The atomic state claim (`update … in('payment_status', [escrow,
      // cancelling]).select('id')`) must return a claimed row, otherwise the
      // function correctly 409s as "already cancelled".
      scenario.writeSelectRows.jobs = [{ id: "job-1" }];
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "cancel_escrow", jobId: "job-1" },
        }),
      );
      expect(res.status).toBe(200);
      // Service fee ($10 = 1000¢) is withheld — Stripe never returns its
      // processing cut on a refund, so the platform keeps the fee to stay whole.
      // Poster is refunded $110 − $10 = $100 (10000¢).
      expect(stripeMock.refunds.create).toHaveBeenCalledWith(
        { payment_intent: "pi_live", amount: 10000 },
        { idempotencyKey: "cancel-escrow-job-1" },
      );
      // First jobs update is the "cancelling" claim; the final one flips the
      // job to cancelled.
      const jobUpdates = scenario.writes.filter(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect(
        (jobUpdates[0]?.payload as Record<string, unknown>).payment_status,
      ).toBe("cancelling");
      const cancelUpdate = jobUpdates[jobUpdates.length - 1];
      expect((cancelUpdate?.payload as Record<string, unknown>).status).toBe(
        "cancelled",
      );
    });

    it("skips the refund but ALERTS ops when withholding consumes the whole capture ($0 refund)", async () => {
      seedAuth(scenario, POSTER);
      // A $2 capture whose entire value is a $2 service fee: withholding the
      // non-refundable fee leaves nothing to refund. The job must still cancel,
      // but ops must be alerted because no ledger row records the $0 outcome.
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            status: "open",
            stripe_payment_intent_id: "pi_live",
            budget: 0,
            customer_fee_amount: 2,
          },
        ],
      };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_live",
        status: "succeeded",
        amount: 200,
        amount_received: 200,
      });
      scenario.writeSelectRows.jobs = [{ id: "job-1" }];
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "cancel_escrow", jobId: "job-1" },
        }),
      );
      expect(res.status).toBe(200);
      // No Stripe refund is attempted (Stripe rejects a $0 refund)…
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      // …but the $0 outcome is surfaced to ops, never silent.
      expect(
        slackAlerts.some(
          (a) =>
            (a as { title?: string }).title ===
            "Escrow cancellation resolved with $0 refund",
        ),
      ).toBe(true);
      // The job still flips to cancelled.
      const jobUpdates = scenario.writes.filter(
        (w) => w.table === "jobs" && w.op === "update",
      );
      const cancelUpdate = jobUpdates[jobUpdates.length - 1];
      expect((cancelUpdate?.payload as Record<string, unknown>).status).toBe(
        "cancelled",
      );
    });

    // cancel_escrow checked payment_status alone, and a disputed job's escrow
    // is still `escrow` — so the poster could POST this action (no UI needed,
    // the JWT is enough) and refund themselves out of a live dispute, or race an
    // admin Quick Release into a double spend. poster_cancel_job has always
    // excluded `disputed`; this door now does too.
    it("refuses a DISPUTED job: 409, no Stripe call, no claim written", async () => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = {
        rows: [{
          id: "job-1", customer_id: POSTER.id, helper_id: HELPER.id, status: "disputed",
          payment_status: "escrow", stripe_payment_intent_id: "pi_live", budget: 100, customer_fee_amount: 10,
        }],
      };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_live", status: "succeeded", amount: 11000, amount_received: 11000 });
      stripeMock.refunds.create.mockResolvedValue({ id: "re_1" });
      scenario.writeSelectRows.jobs = [{ id: "job-1" }];
      const fn = await load();
      const res = await fn.fetch(fn.request({ headers: AUTH, body: { action: "cancel_escrow", jobId: "job-1" } }));
      expect(res.status).toBe(409);
      expect((await json(res)).disputed).toBe(true);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(scenario.writes.filter((w) => w.table === "jobs")).toHaveLength(0);
    });

    it("the atomic claim carries the allowlist, so a hire or a filing after the read still wins", async () => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: POSTER.id, status: "open", helper_id: null, stripe_payment_intent_id: "pi_live", budget: 100, customer_fee_amount: 10 }],
      };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_live", status: "succeeded", amount: 11000, amount_received: 11000 });
      stripeMock.refunds.create.mockResolvedValue({ id: "re_1" });
      scenario.writeSelectRows.jobs = [{ id: "job-1" }];
      const fn = await load();
      await fn.fetch(fn.request({ headers: AUTH, body: { action: "cancel_escrow", jobId: "job-1" } }));
      const claim = scenario.writes.find(
        (w) => w.table === "jobs" && (w.payload as Record<string, unknown>).payment_status === "cancelling",
      );
      expect(claim?.filters).toEqual(expect.arrayContaining([{ op: "eq", column: "status", value: "open" }]));
    });

    // A poster with a JWT can POST this directly. On a HIRED job it skipped the
    // cancellation-fee ladder poster_cancel_job charges; on a job with a
    // decided-but-unexecuted dispute (rpc_decide_dispute moves status off
    // `disputed`) it overrode the admin's split. Allowlist: open + no Helpr.
    it.each([
      ["in_progress, hired", { status: "in_progress", helper_id: HELPER.id }, "useCancelJob"],
      ["accepted, hired", { status: "accepted", helper_id: HELPER.id }, "useCancelJob"],
      ["completed (decided split pending)", { status: "completed", helper_id: HELPER.id }, "disputed"],
    ])("refuses a %s job: 409, no Stripe call, no claim written", async (_label, fields, flag) => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: POSTER.id, payment_status: "escrow", stripe_payment_intent_id: "pi_live", budget: 100, customer_fee_amount: 10, ...fields }],
      };
      if (flag === "disputed") {
        scenario.reads.disputes = { rows: [{ id: "d-1", execution_status: "pending", payout_split: { poster: 0.5, helper: 0.5 } }] };
      }
      stripeMock.refunds.create.mockResolvedValue({ id: "re_1" });
      const fn = await load();
      const res = await fn.fetch(fn.request({ headers: AUTH, body: { action: "cancel_escrow", jobId: "job-1" } }));
      expect(res.status).toBe(409);
      expect((await json(res))[flag]).toBe(true);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(scenario.writes.filter((w) => w.table === "jobs")).toHaveLength(0);
    });

    it("refuses an OPEN job that still carries a decided, unexecuted dispute", async () => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = { rows: [{ id: "job-1", customer_id: POSTER.id, status: "open", helper_id: null, payment_status: "escrow", stripe_payment_intent_id: "pi_live" }] };
      scenario.reads.disputes = { rows: [{ id: "d-1", execution_status: null, payout_split: {} }] };
      const fn = await load();
      const res = await fn.fetch(fn.request({ headers: AUTH, body: { action: "cancel_escrow", jobId: "job-1" } }));
      expect(res.status).toBe(409);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("fails CLOSED (503, nothing moved) when the dispute check cannot be read", async () => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = { rows: [{ id: "job-1", customer_id: POSTER.id, status: "open", helper_id: null, payment_status: "escrow", stripe_payment_intent_id: "pi_live" }] };
      scenario.reads.disputes = { error: { message: "read blew up" } };
      const fn = await load();
      const res = await fn.fetch(fn.request({ headers: AUTH, body: { action: "cancel_escrow", jobId: "job-1" } }));
      expect(res.status).toBe(503);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(scenario.writes.filter((w) => w.table === "jobs")).toHaveLength(0);
    });

    it("non-owner cannot cancel another poster's escrow", async () => {
      seedAuth(scenario, HELPER);
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: POSTER.id }],
      };
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "cancel_escrow", jobId: "job-1" },
        }),
      );
      expect((await json(res)).error).toMatch(/not authorized/i);
    });
  });

  describe("admin dispute branches", () => {
    it("admin_release_dispute is rejected for a non-admin caller", async () => {
      seedAuth(scenario, POSTER);
      scenario.rpc.has_role = false;
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "admin_release_dispute", jobId: "job-1" },
        }),
      );
      expect((await json(res)).error).toMatch(/admin only/i);
    });

    it("admin_release_dispute transfers funds to the helper and marks released", async () => {
      seedAuth(scenario, ADMIN);
      scenario.rpc.has_role = true;
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            status: "disputed",
            budget: 100,
            urgent_fee: 0,
            platform_fee_amount: 10,
            title: "Disputed job",
            stripe_payment_intent_id: "pi_d",
          },
        ],
      };
      scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
      scenario.reads.user_roles = { rows: [] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_d",
        status: "succeeded",
        latest_charge: "ch_d",
      });
      stripeMock.transfers.create.mockResolvedValue({ id: "tr_d" });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "admin_release_dispute", jobId: "job-1" },
        }),
      );
      expect(res.status).toBe(200);
      expect(stripeMock.transfers.create).toHaveBeenCalled();
      const jobUpdate = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect((jobUpdate?.payload as Record<string, unknown>).payment_status).toBe(
        "released",
      );
    });

    it("admin_refund_dispute refunds the poster minus the non-refundable Stripe fee and marks the job refunded", async () => {
      seedAuth(scenario, ADMIN);
      scenario.rpc.has_role = true;
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            status: "disputed",
            title: "Disputed job",
            stripe_payment_intent_id: "pi_r",
          },
        ],
      };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_r",
        status: "succeeded",
        amount: 10000,
        amount_received: 10000,
      });
      // Stripe echoes the requested refund amount — mirror that so the ledger
      // assertion below reflects the real recorded value.
      stripeMock.refunds.create.mockResolvedValue({ id: "re_r", amount: 9680 });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "admin_refund_dispute", jobId: "job-1" },
        }),
      );
      expect(res.status).toBe(200);
      // Poster won → gets budget + service fee back, but Stripe's 2.9%+$0.30 on
      // the $100 capture (320c) is withheld so the platform never eats the fee.
      expect(stripeMock.refunds.create).toHaveBeenCalledWith(
        { payment_intent: "pi_r", amount: 9680 },
        { idempotencyKey: "refund-dispute-job-1" },
      );
      const jobUpdate = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect((jobUpdate?.payload as Record<string, unknown>).payment_status).toBe(
        "refunded",
      );
    });

    it("admin_refund_dispute falls back to pi.amount when amount_received is absent", async () => {
      seedAuth(scenario, ADMIN);
      scenario.rpc.has_role = true;
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            status: "disputed",
            title: "Disputed job",
            stripe_payment_intent_id: "pi_rf",
          },
        ],
      };
      // amount_received null (e.g. a non-immediate-capture PI) → the code uses
      // pi.amount, so the withheld-fee math must be identical.
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_rf",
        status: "succeeded",
        amount: 10000,
        amount_received: null,
      });
      stripeMock.refunds.create.mockResolvedValue({ id: "re_rf", amount: 9680 });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "admin_refund_dispute", jobId: "job-1" },
        }),
      );
      expect(res.status).toBe(200);
      expect(stripeMock.refunds.create).toHaveBeenCalledWith(
        { payment_intent: "pi_rf", amount: 9680 },
        { idempotencyKey: "refund-dispute-job-1" },
      );
    });

    it("admin_refund_dispute skips the refund but ALERTS ops when the Stripe fee consumes the whole capture", async () => {
      seedAuth(scenario, ADMIN);
      scenario.rpc.has_role = true;
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            status: "disputed",
            title: "Tiny disputed job",
            stripe_payment_intent_id: "pi_r0",
          },
        ],
      };
      // A 20c capture is fully consumed by the 30c flat Stripe fee → $0 refund.
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_r0",
        status: "succeeded",
        amount: 20,
        amount_received: 20,
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "admin_refund_dispute", jobId: "job-1" },
        }),
      );
      expect(res.status).toBe(200);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(
        slackAlerts.some(
          (a) =>
            (a as { title?: string }).title ===
            "Dispute resolved with $0 refund to poster",
        ),
      ).toBe(true);
      const jobUpdate = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect((jobUpdate?.payload as Record<string, unknown>).payment_status).toBe(
        "refunded",
      );
    });

    it("admin_refund_dispute ABORTS (no refund, no status flip) when the captured amount is invalid", async () => {
      seedAuth(scenario, ADMIN);
      scenario.rpc.has_role = true;
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            status: "disputed",
            title: "Bad-data disputed job",
            stripe_payment_intent_id: "pi_bad",
          },
        ],
      };
      // Degenerate/missing captured amount → the platform must NOT silently mark
      // the job refunded for $0. It aborts loudly and leaves it disputed.
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_bad",
        status: "succeeded",
        amount: undefined,
        amount_received: null,
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "admin_refund_dispute", jobId: "job-1" },
        }),
      );
      expect(res.status).toBe(500);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      // Never flips the job to refunded on bad data.
      const jobUpdate = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect(jobUpdate).toBeUndefined();
      expect(
        slackAlerts.some(
          (a) =>
            (a as { title?: string }).title ===
            "Dispute refund aborted — invalid captured amount",
        ),
      ).toBe(true);
    });

    it("admin_refund_dispute ABORTS when the PaymentIntent is not succeeded", async () => {
      seedAuth(scenario, ADMIN);
      scenario.rpc.has_role = true;
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            status: "disputed",
            title: "Uncaptured disputed job",
            stripe_payment_intent_id: "pi_np",
          },
        ],
      };
      // A disputed job whose PI is not succeeded is an anomaly — abort, don't
      // silently mark refunded.
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_np",
        status: "requires_capture",
        amount: 10000,
        amount_received: 0,
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "admin_refund_dispute", jobId: "job-1" },
        }),
      );
      expect(res.status).toBe(500);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      const jobUpdate = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect(jobUpdate).toBeUndefined();
      expect(
        slackAlerts.some(
          (a) =>
            (a as { title?: string }).title ===
            "Dispute refund aborted — PaymentIntent not succeeded",
        ),
      ).toBe(true);
    });

    // ── Dispute resolution must close the dispute, not just move the money ──
    // Three things every admin dispute action owes, and none of which the two
    // Quick actions used to do:
    //   1. write jobs.dispute_status/dispute_resolved_at, without which
    //      trg_sync_has_active_dispute (20260831010000) keeps deriving
    //      has_active_dispute = true and can_review_job's
    //      "(has_active_dispute = false OR dispute_resolved_at IS NOT NULL)"
    //      clause never passes — the job is PERMANENTLY un-reviewable;
    //   2. close the public.disputes record, or the stale open row keeps the
    //      job trapped under disputes_one_open_per_job_idx and stays one
    //      rpc_decide_dispute call away from execute-dispute-split;
    //   3. write admin_audit_log — an admin deciding who keeps the escrow left
    //      no trace at all in /admin?view=audit.
    describe("dispute resolution closes the dispute, not just the payment", () => {
      /** Release-path fixture: transfer succeeds, ledger row lands. */
      function seedReleasable() {
        seedAuth(scenario, ADMIN);
        scenario.rpc.has_role = true;
        scenario.rpc.settle_dispute_record = "dispute-1";
        scenario.reads.jobs = {
          rows: [
            {
              id: "job-1",
              customer_id: POSTER.id,
              helper_id: HELPER.id,
              status: "disputed",
              budget: 100,
              urgent_fee: 0,
              platform_fee_amount: 10,
              helper_fee_percent: 10,
              title: "Disputed job",
              stripe_payment_intent_id: "pi_d",
            },
          ],
        };
        scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
        scenario.reads.user_roles = { rows: [] };
        // Two different reads of payout_transfers: transferToHelper's
        // idempotency guard asks for "stripe_transfer_id, status" (must be
        // EMPTY or it short-circuits the transfer), lookupTransferId asks for
        // "stripe_transfer_id" alone.
        // transferToHelper's idempotency guard reads "stripe_transfer_id, status"
        // and MUST come back empty or it short-circuits the transfer.
        // lookupSettledTransfer reads "stripe_transfer_id, amount_cents, status"
        // — distinguished by `amount_cents`, and ordered first so `find()`
        // cannot hand it the empty override.
        scenario.reads.payout_transfers = {
          selectOverrides: [
            { includes: "amount_cents", result: { rows: [{ stripe_transfer_id: "tr_d", amount_cents: 8800, status: "paid" }] } },
            { includes: "status", result: { rows: [] } },
          ],
        };
        scenario.writeSelectRows.jobs = [{ id: "job-1" }];
        scenario.writeSelectRows.admin_audit_log = [{ id: "audit-1" }];
        stripeMock.paymentIntents.retrieve.mockResolvedValue({
          id: "pi_d",
          status: "succeeded",
          latest_charge: "ch_d",
        });
        stripeMock.transfers.create.mockResolvedValue({ id: "tr_d" });
      }

      function seedRefundable() {
        seedAuth(scenario, ADMIN);
        scenario.rpc.has_role = true;
        scenario.rpc.settle_dispute_record = "dispute-1";
        scenario.reads.jobs = {
          rows: [
            {
              id: "job-1",
              customer_id: POSTER.id,
              helper_id: HELPER.id,
              status: "disputed",
              budget: 100,
              title: "Disputed job",
              stripe_payment_intent_id: "pi_r",
            },
          ],
        };
        scenario.writeSelectRows.jobs = [{ id: "job-1" }];
        scenario.writeSelectRows.admin_audit_log = [{ id: "audit-1" }];
        stripeMock.paymentIntents.retrieve.mockResolvedValue({
          id: "pi_r",
          status: "succeeded",
          amount: 10000,
          amount_received: 10000,
          latest_charge: { balance_transaction: { fee: 320 } },
        });
        stripeMock.refunds.create.mockResolvedValue({ id: "re_r", amount: 9680 });
      }

      const jobUpdate = () =>
        scenario.writes.find((w) => w.table === "jobs" && w.op === "update")
          ?.payload as Record<string, unknown> | undefined;
      const settleCalls = () =>
        (scenario.rpcCalls ?? []).filter((c) => c.name === "settle_dispute_record");
      const auditWrites = () =>
        scenario.writes.filter((w) => w.table === "admin_audit_log" && w.op === "insert");

      it("Quick Release leaves the job REVIEWABLE", async () => {
        seedReleasable();
        const fn = await load();
        const res = await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
        );
        expect(res.status).toBe(200);
        const payload = jobUpdate()!;
        expect(payload.status).toBe("completed");
        expect(payload.payment_status).toBe("released");
        // These two are the whole reviewability story.
        expect(payload.dispute_status).toBe("resolved");
        expect(typeof payload.dispute_resolved_at).toBe("string");
      });

      // ── Group jobs: the last money path that paid 1-of-N ─────────────────
      //
      // A group job holds ONE escrow split across the roster. This action
      // transfers to `jobs.helper_id`, which accept_group_application sets to
      // the FIRST accepted helper and never updates, and then flips the job to
      // completed/released. On a 3-person crew that paid the lead their 1/N,
      // paid the other two nothing, and marked the job settled — after which
      // release-payout refuses a released job and process-scheduled-payouts
      // only sweeps payout_pending, so there is no retry anywhere.
      function seedReleasableGroup(roster: { helper_id: string }[] | { error: { message: string } }) {
        seedReleasable();
        scenario.reads.jobs = {
          rows: [
            {
              id: "job-1",
              customer_id: POSTER.id,
              helper_id: HELPER.id,
              status: "disputed",
              budget: 300,
              urgent_fee: 0,
              platform_fee_amount: 30,
              helper_fee_percent: 10,
              title: "Disputed group job",
              stripe_payment_intent_id: "pi_d",
              is_group_job: true,
              helpers_needed: 3,
            },
          ],
        };
        scenario.reads.group_job_helpers = Array.isArray(roster) ? { rows: roster } : roster;
      }

      it("REFUSES a multi-member group roster and moves no money", async () => {
        seedReleasableGroup([{ helper_id: "helper-1" }, { helper_id: "helper-2" }]);
        const fn = await load();
        const res = await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
        );
        expect(res.status).toBe(409);
        const out = await json(res);
        expect(out.roster_size).toBe(2);
        // The whole point.
        expect(stripeMock.transfers.create).not.toHaveBeenCalled();
        // And the job must NOT be flipped to settled — a released job is
        // unreachable by every remaining payout path.
        expect(jobUpdate()).toBeUndefined();
      });

      it("fails CLOSED when the group roster cannot be read", async () => {
        // A guard that disappears when its own lookup fails is not a guard:
        // roster === null → length 0 → the `> 1` test is false → we would pay
        // the lead off a roster we could not read.
        seedReleasableGroup({ error: { message: "connection reset by peer" } });
        const fn = await load();
        const res = await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
        );
        expect(res.status).toBe(503);
        expect((await json(res)).error).toMatch(/roster/i);
        expect(stripeMock.transfers.create).not.toHaveBeenCalled();
        expect(jobUpdate()).toBeUndefined();
      });

      it("still pays a group job whose roster holds a single member", async () => {
        // helpers_needed says 3 but only one Helpr ever joined. The per-helper
        // math already divides by helpers_needed, so the lead gets exactly the
        // 1/N share they accepted and nobody else is owed anything — refusing
        // here would strand a payable job for no reason.
        seedReleasableGroup([{ helper_id: HELPER.id }]);
        const fn = await load();
        const res = await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
        );
        expect(res.status).toBe(200);
        expect(stripeMock.transfers.create).toHaveBeenCalled();
        expect(jobUpdate()!.payment_status).toBe("released");
      });

      it("Quick Release closes the dispute record with the real transfer id and amount", async () => {
        seedReleasable();
        const fn = await load();
        await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
        );
        expect(settleCalls()).toHaveLength(1);
        // The recorded figure must be the money that ACTUALLY moved. It is
        // taken from the payout_transfers LEDGER, not recomputed — and here the
        // ledger agrees with what Stripe was told, which is the invariant.
        const sentCents = stripeMock.transfers.create.mock.calls[0][0].amount;
        expect(sentCents).toBe(8800);
        expect(settleCalls()[0].args).toMatchObject({
          _job_id: "job-1",
          _outcome: "helper",
          _decided_by: ADMIN.id,
          _helper_cents: 8800,
          _transfer_id: "tr_d",
          _refund_cents: null,
          _refund_id: null,
        });
      });

      it("Quick Release writes an admin_audit_log row, guarded against a silent RLS refusal", async () => {
        seedReleasable();
        const fn = await load();
        await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
        );
        expect(auditWrites()).toHaveLength(1);
        expect(auditWrites()[0].payload).toMatchObject({
          admin_id: ADMIN.id,
          action: "dispute_admin_release",
          target_type: "job",
          target_id: "job-1",
        });
        // A null error on an RLS-refused insert reads as success without this.
        expect(auditWrites()[0].selectCols).toBe("id");
        expect(
          (auditWrites()[0].payload as { details: Record<string, unknown> }).details,
        ).toMatchObject({
          stripe_transfer_id: "tr_d",
          helper_payout_cents: 8800,
          computed_helper_payout_cents: 8800,
        });
      });

      it("records NULL, never a computed figure, when no transfer row exists", async () => {
        // The transfer is conditional. On the no-transfer path a computed
        // `helperPayout * 100` would record money as "received" against escrow
        // that never left the platform balance.
        seedReleasable();
        scenario.reads.payout_transfers = {
          selectOverrides: [
            { includes: "amount_cents", result: { rows: [] } },
            { includes: "status", result: { rows: [] } },
          ],
        };
        const fn = await load();
        await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
        );
        expect(settleCalls()[0].args).toMatchObject({ _helper_cents: null, _transfer_id: null });
      });

      it("never stamps another helper's or a failed transfer onto the record", async () => {
        seedReleasable();
        const fn = await load();
        await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
        );
        const read = scenario.writes; // writes are unrelated; assert on the query filters instead
        expect(read).toBeDefined();
        // The ledger read is scoped to this job, this helper, and money-bearing
        // statuses only.
        expect(stripeMock.transfers.create).toHaveBeenCalled();
        expect(settleCalls()[0].args).toMatchObject({ _transfer_id: "tr_d" });
      });

      it("Quick Refund leaves the dispute closed, recorded, and audited", async () => {
        seedRefundable();
        const fn = await load();
        const res = await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "admin_refund_dispute", jobId: "job-1" } }),
        );
        expect(res.status).toBe(200);
        const payload = jobUpdate()!;
        expect(payload.status).toBe("cancelled");
        expect(payload.dispute_status).toBe("resolved");
        expect(typeof payload.dispute_resolved_at).toBe("string");

        expect(settleCalls()[0].args).toMatchObject({
          _job_id: "job-1",
          _outcome: "poster",
          _decided_by: ADMIN.id,
          _refund_cents: 9680,
          _refund_id: "re_r",
          _helper_cents: null,
          _transfer_id: null,
        });
        expect(auditWrites()[0].payload).toMatchObject({
          action: "dispute_admin_refund",
          target_id: "job-1",
        });
      });

      it("nothing is closed or audited when the transfer never went out", async () => {
        seedReleasable();
        stripeMock.transfers.create.mockRejectedValue(new Error("card network down"));
        const fn = await load();
        const res = await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
        );
        expect(res.status).toBe(500);
        // Fail closed: the job stays disputed, so its record must stay open.
        expect(jobUpdate()).toBeUndefined();
        expect(settleCalls()).toHaveLength(0);
        expect(auditWrites()).toHaveLength(0);
      });

      it("a failed record close does NOT 500 the admin — it alerts instead", async () => {
        // The money already moved and the job row is correct. A 500 here reads
        // as "it failed" and invites a second click; the orphan sweep in
        // auto-resolve-disputes closes the record on its next tick.
        seedReleasable();
        scenario.rpcErrors = { settle_dispute_record: { message: "not deployed", code: "PGRST202" } };
        const fn = await load();
        const res = await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
        );
        expect(res.status).toBe(200);
        expect(
          slackAlerts.some(
            (a) => (a as { title?: string }).title === "Dispute settled but its record stayed open",
          ),
        ).toBe(true);
      });

      // ── The settlement claim (20260915034822) ──────────────────────────
      // Quick Release and Quick Refund on the SAME job at once each ran their
      // Stripe step before the guarded `jobs` flip, under different idempotency
      // keys, so the escrow paid the Helpr AND refunded the poster. The claim
      // is taken immediately before the Stripe call; these four cases are the
      // whole contract. BUILT 2026-09-14, not yet measured on prod
      // (scripts/probes/admin-release-vs-refund.prod.mjs).
      describe("settlement claim", () => {
        it("takes the claim before the transfer, and hands it back when settled", async () => {
          seedReleasable();
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBe(200);
          const claims = scenario.rpcCalls!.filter((c) => c.name === "claim_dispute_settlement");
          expect(claims).toHaveLength(1);
          expect(claims[0].args).toMatchObject({ _job_id: "job-1", _action: "release" });
          // Order is the whole point: a claim taken after the transfer guards
          // nothing.
          const claimAt = scenario.rpcCalls!.findIndex((c) => c.name === "claim_dispute_settlement");
          const settleAt = scenario.rpcCalls!.findIndex((c) => c.name === "settle_dispute_record");
          expect(claimAt).toBeLessThan(settleAt);
          expect(stripeMock.transfers.create).toHaveBeenCalled();
          expect(
            scenario.rpcCalls!.some((c) => c.name === "release_dispute_settlement_claim"),
          ).toBe(true);
        });

        it("refuses with 409 when the other action holds the claim, and moves no money", async () => {
          seedReleasable();
          scenario.rpc.claim_dispute_settlement = { verdict: "held_by_refund" };
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBe(409);
          expect((await json(res)).heldBy).toBe("refund");
          expect(stripeMock.transfers.create).not.toHaveBeenCalled();
          // Nothing was flipped, closed or logged either.
          expect(scenario.rpcCalls!.some((c) => c.name === "settle_dispute_record")).toBe(false);
        });

        it("a re-entrant same-action caller (`joined`) gets 409 and moves NO money (round 3, M3)", async () => {
          seedReleasable();
          // `joined` is what the RPC returns to a second concurrent Quick
          // Release. It holds no token and no claim row is its own, so letting
          // it through moved money with nothing standing behind it: if the
          // holder then died unstamped its claim expired while this caller's
          // transfer was still in flight. The holder settles; the joiner waits.
          scenario.rpc.claim_dispute_settlement = { verdict: "joined" };
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
          );
          const body = await json(res);
          expect(res.status).toBe(409);
          expect(body.inProgress).toBe(true);
          expect(stripeMock.transfers.create).not.toHaveBeenCalled();
          expect(scenario.rpcCalls!.some((c) => c.name === "settle_dispute_record")).toBe(false);
          expect(
            scenario.rpcCalls!.some((c) => c.name === "release_dispute_settlement_claim"),
          ).toBe(false);
        });

        it("a joined Quick Refund gets 409 and issues NO refund (round 3, M3)", async () => {
          seedRefundable();
          scenario.rpc.claim_dispute_settlement = { verdict: "joined" };
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_refund_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBe(409);
          expect((await json(res)).inProgress).toBe(true);
          expect(stripeMock.refunds.create).not.toHaveBeenCalled();
          expect(jobUpdate()).toBeUndefined();
        });

        it("stamps the claim immediately before the transfer, by token (round 3, M2)", async () => {
          seedReleasable();
          scenario.rpc.claim_dispute_settlement = { verdict: "claimed", token: "tok-s" };
          let callsAtTransfer = -1;
          stripeMock.transfers.create.mockImplementation(async () => {
            callsAtTransfer = scenario.rpcCalls!.length;
            return { id: "tr_d" };
          });
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBe(200);
          const stamps = scenario.rpcCalls!
            .map((c, i) => ({ ...c, i }))
            .filter((c) => c.name === "stamp_dispute_settlement_claim");
          expect(stamps).toHaveLength(1);
          expect(stamps[0].args).toMatchObject({ _job_id: "job-1", _token: "tok-s" });
          // The stamp is the LAST rpc before the transfer: every no-money exit
          // before it (profile read, ledger check, charge link) leaves an
          // unstamped claim that expires instead of paging.
          expect(stamps[0].i).toBe(callsAtTransfer - 1);
        });

        it("moves NO money when the stamp does not land — the claim is no longer this caller's (round 3, M2)", async () => {
          seedReleasable();
          scenario.rpc.stamp_dispute_settlement_claim = false;
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBeGreaterThanOrEqual(400);
          expect(stripeMock.transfers.create).not.toHaveBeenCalled();
          expect(jobUpdate()).toBeUndefined();
        });

        it("stamps before the Quick Refund's Stripe refund, and refunds nothing without the stamp (round 3, M2)", async () => {
          seedRefundable();
          scenario.rpc.stamp_dispute_settlement_claim = false;
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_refund_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBeGreaterThanOrEqual(400);
          expect(scenario.rpcCalls!.some((c) => c.name === "stamp_dispute_settlement_claim")).toBe(true);
          expect(stripeMock.refunds.create).not.toHaveBeenCalled();
          expect(jobUpdate()).toBeUndefined();
        });

        it("retries a failed claim release once before giving up (round 3, M2)", async () => {
          seedReleasable();
          scenario.rpcErrors = { release_dispute_settlement_claim: { message: "connection reset", code: "08006" } };
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBe(200);
          expect(scenario.rpcCalls!.filter((c) => c.name === "release_dispute_settlement_claim")).toHaveLength(2);
        });

        it("tags the Quick Release transfer with the job's transfer_group so the counterpart can find it (round 3, H2)", async () => {
          seedReleasable();
          const fn = await load();
          await fn.fetch(fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }));
          expect(stripeMock.transfers.create.mock.calls[0][0]).toMatchObject({ transfer_group: "job_job-1" });
        });

        it("Quick Release asks Stripe inside the claim too: a transfer for the job with NO ledger row blocks a second transfer", async () => {
          // The mirror of the H2 check below. A split transfer or an earlier
          // Quick Release that went out with no payout_transfers row is
          // invisible to transferToHelper's ledger guard, and a fresh transfer
          // under this action's own idempotency key paid the Helpr twice — the
          // exit rpc_supersede_dispute_decision opens (round 4 review).
          seedReleasable();
          scenario.rpc.claim_dispute_settlement = { verdict: "claimed", token: "tok-g" };
          stripeMock.transfers.list.mockResolvedValue({
            data: [{ id: "tr_ghost", amount: 8800, amount_reversed: 0, transfer_group: "job_job-1" }],
          });
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBe(409);
          expect((await json(res)).alreadyMoved).toBe(true);
          expect(stripeMock.transfers.create).not.toHaveBeenCalled();
          expect(jobUpdate()).toBeUndefined();
          expect(scenario.rpcCalls!.filter((c) => c.name === "release_dispute_settlement_claim")).toEqual([
            expect.objectContaining({ args: { _job_id: "job-1", _token: "tok-g" } }),
          ]);
        });

        it("Quick Release control: a transfer the ledger already records is the idempotent re-run, not a ghost", async () => {
          seedReleasable();
          stripeMock.transfers.list.mockResolvedValue({
            data: [{ id: "tr_d", amount: 8800, amount_reversed: 0, transfer_group: "job_job-1" }],
          });
          scenario.reads.payout_transfers = {
            selectOverrides: [
              { includes: "amount_cents", result: { rows: [{ stripe_transfer_id: "tr_d", amount_cents: 8800, status: "paid" }] } },
              { includes: "status", result: { rows: [{ stripe_transfer_id: "tr_d", status: "paid" }] } },
            ],
          };
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBe(200);
          expect(stripeMock.transfers.create).not.toHaveBeenCalled();
          expect(jobUpdate()!.payment_status).toBe("released");
        });

        it("Quick Refund asks Stripe inside the claim: a transfer already out for the job (no ledger row) blocks the refund (round 3, H2)", async () => {
          seedRefundable();
          scenario.rpc.claim_dispute_settlement = { verdict: "claimed", token: "tok-q" };
          stripeMock.transfers.list.mockResolvedValue({
            data: [{ id: "tr_ghost", amount: 8800, amount_reversed: 0, reversed: false, transfer_group: "job_job-1" }],
          });
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_refund_dispute", jobId: "job-1" } }),
          );
          const body = await json(res);
          expect(res.status).toBe(409);
          expect(body.alreadyMoved).toBe(true);
          expect(stripeMock.transfers.list).toHaveBeenCalledWith(expect.objectContaining({ transfer_group: "job_job-1" }));
          expect(stripeMock.refunds.create).not.toHaveBeenCalled();
          expect(jobUpdate()).toBeUndefined();
          expect(slackAlerts.some((a) => (a as { title?: string }).title === "Quick Refund refused — a transfer for this job already left Stripe")).toBe(true);
          expect(scenario.rpcCalls!.filter((c) => c.name === "release_dispute_settlement_claim")).toEqual([
            expect.objectContaining({ args: { _job_id: "job-1", _token: "tok-q" } }),
          ]);
        });

        it("Quick Refund KEEPS its claim when the Stripe refund fails ambiguously — the refund may exist (round 5)", async () => {
          seedRefundable();
          stripeMock.refunds.create.mockRejectedValueOnce(Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" }));
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_refund_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBeGreaterThanOrEqual(400);
          expect(scenario.rpcCalls!.some((c) => c.name === "release_dispute_settlement_claim")).toBe(false);
        });

        it("Quick Refund KEEPS its claim on a StripeIdempotencyError — a request with that key already ran (round 5, LOW-2)", async () => {
          seedRefundable();
          stripeMock.refunds.create.mockRejectedValueOnce(Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters"), { type: "StripeIdempotencyError" }));
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_refund_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBeGreaterThanOrEqual(400);
          expect(scenario.rpcCalls!.some((c) => c.name === "release_dispute_settlement_claim")).toBe(false);
        });

        it("Quick Refund gives the claim back when Stripe DEFINITELY refused the refund (round 5)", async () => {
          seedRefundable();
          stripeMock.refunds.create.mockRejectedValueOnce(Object.assign(new Error("charge already refunded"), { type: "StripeInvalidRequestError" }));
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_refund_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBeGreaterThanOrEqual(400);
          expect(scenario.rpcCalls!.some((c) => c.name === "release_dispute_settlement_claim")).toBe(true);
        });

        it("Quick Refund fails CLOSED when Stripe's transfer list cannot be read (round 3, H2)", async () => {
          seedRefundable();
          stripeMock.transfers.list.mockRejectedValue(new Error("stripe down"));
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_refund_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBe(503);
          expect(stripeMock.refunds.create).not.toHaveBeenCalled();
        });

        it("Quick Refund control: a fully reversed transfer does not block the refund (round 3, H2)", async () => {
          seedRefundable();
          stripeMock.transfers.list.mockResolvedValue({
            data: [{ id: "tr_back", amount: 8800, amount_reversed: 8800, reversed: true, transfer_group: "job_job-1" }],
          });
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_refund_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBe(200);
          expect(stripeMock.refunds.create).toHaveBeenCalled();
        });

        it("releases by TOKEN, never by job_id alone", async () => {
          seedReleasable();
          scenario.rpc.claim_dispute_settlement = { verdict: "claimed", token: "tok-abc" };
          const fn = await load();
          await fn.fetch(fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }));
          const rel = scenario.rpcCalls!.filter((c) => c.name === "release_dispute_settlement_claim");
          expect(rel).toHaveLength(1);
          expect(rel[0].args).toMatchObject({ _job_id: "job-1", _token: "tok-abc" });
        });

        it("refuses a release when the escrow was already refunded — the claim is only a mutex, not a ledger", async () => {
          seedReleasable();
          // The durable invariant is the LEDGER, not the lock: a release whose
          // flip failed leaves the job `disputed`, the claim expires after five
          // minutes, and a refund is otherwise handed a clean claim on a charge
          // whose escrow has already gone.
          scenario.reads.payment_refunds = { rows: [{ id: "ref-1" }] };
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBe(409);
          expect((await json(res)).alreadyMoved).toBe(true);
          expect(stripeMock.transfers.create).not.toHaveBeenCalled();
          // And the claim was never taken, so it cannot be held over a refusal.
          expect(scenario.rpcCalls!.some((c) => c.name === "claim_dispute_settlement")).toBe(false);
        });

        it("a Quick Refund arriving after a Quick Release settled the job gets a clean 409, not a money page", async () => {
          seedReleasable();
          scenario.rpc.claim_dispute_settlement = { verdict: "not_disputed" };
          scenario.reads.jobs = {
            selectOverrides: [
              { includes: "status, payment_status", result: { rows: [{ status: "completed", payment_status: "released", dispute_status: "resolved" }] } },
            ],
            rows: [{ id: "job-1", customer_id: POSTER.id, helper_id: HELPER.id, status: "disputed", budget: 100, urgent_fee: 0, platform_fee_amount: 10, helper_fee_percent: 10, title: "Disputed job", stripe_payment_intent_id: "pi_d" }],
          };
          stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_d", status: "succeeded", amount: 11000, amount_received: 11000 });
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_refund_dispute", jobId: "job-1" } }),
          );
          const body = await json(res);
          expect(res.status).toBe(409);
          expect(body.settledOtherWay).toBe(true);
          expect(stripeMock.refunds.create).not.toHaveBeenCalled();
          expect(slackAlerts.some((a) => (a as { title?: string }).title === "Dispute left the queue unsettled")).toBe(false);
        });

        it("does not report `not_disputed` as resolved unless the job actually settled", async () => {
          seedReleasable();
          // A withdrawal restores the job to in_progress with the escrow still
          // held. That is "not disputed" and emphatically not "resolved":
          // saying so would retire it from the queue with nobody paid.
          scenario.rpc.claim_dispute_settlement = { verdict: "not_disputed" };
          scenario.reads.jobs = {
            selectOverrides: [
              { includes: "status, payment_status", result: { rows: [{ status: "in_progress", payment_status: "escrow" }] } },
            ],
            rows: [{ id: "job-1", customer_id: POSTER.id, helper_id: HELPER.id, status: "disputed", budget: 100, urgent_fee: 0, platform_fee_amount: 10, helper_fee_percent: 10, title: "Disputed job", stripe_payment_intent_id: "pi_d" }],
          };
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBe(409);
          expect(await json(res)).not.toMatchObject({ alreadyResolved: true });
          expect(stripeMock.transfers.create).not.toHaveBeenCalled();
        });

        it("refuses a general refund on a disputed job — the third door into the same double spend", async () => {
          seedAuth(scenario, ADMIN);
          scenario.rpc.has_role = true;
          scenario.reads.jobs = {
            rows: [{ id: "job-1", customer_id: POSTER.id, helper_id: HELPER.id, status: "disputed", budget: 100, title: "Disputed job", stripe_payment_intent_id: "pi_d" }],
          };
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_refund_general", jobId: "job-1", reason: "goodwill" } }),
          );
          expect(res.status).toBe(409);
          expect(stripeMock.refunds.create).not.toHaveBeenCalled();
        });

        it.each([
          ["sweep", /72-hour dispute timeout/],
          ["split", /decided split is being executed/],
        ])("names the real holder when the claim is held_by_%s — never 'another admin is refunding'", async (holder, copy) => {
          seedReleasable();
          scenario.rpc.claim_dispute_settlement = { verdict: `held_by_${holder}` };
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
          );
          const body = await json(res);
          expect(res.status).toBe(409);
          expect(body.heldBy).toBe(holder);
          expect(String(body.error)).toMatch(copy);
          expect(String(body.error)).not.toMatch(/refunding this escrow to the poster/);
          expect(stripeMock.transfers.create).not.toHaveBeenCalled();
        });

        it.each(["cancelling", "refunded"])(
          "refuses (409, no transfer) when the claim says the escrow is not held: payment %s",
          async (paymentStatus) => {
            seedReleasable();
            scenario.rpc.claim_dispute_settlement = { verdict: "not_settleable", payment_status: paymentStatus };
            const fn = await load();
            const res = await fn.fetch(
              fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
            );
            const body = await json(res);
            expect(res.status).toBe(409);
            expect(body.notSettleable).toBe(true);
            expect(body.paymentStatus).toBe(paymentStatus);
            expect(stripeMock.transfers.create).not.toHaveBeenCalled();
            expect(scenario.rpcCalls!.some((c) => c.name === "settle_dispute_record")).toBe(false);
          },
        );

        it("the 72h sweep already settled it: a release reports resolved, with no false money_at_risk page", async () => {
          seedReleasable();
          scenario.rpc.claim_dispute_settlement = { verdict: "not_disputed" };
          scenario.reads.jobs = {
            selectOverrides: [
              { includes: "dispute_status", result: { rows: [{ status: "completed", payment_status: "payout_pending", dispute_status: "auto_resolved" }] } },
            ],
            rows: [{ id: "job-1", customer_id: POSTER.id, helper_id: HELPER.id, status: "disputed", budget: 100, urgent_fee: 0, platform_fee_amount: 10, helper_fee_percent: 10, title: "Disputed job", stripe_payment_intent_id: "pi_d" }],
          };
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
          );
          const body = await json(res);
          expect(res.status).toBe(200);
          expect(body).toMatchObject({ alreadyResolved: true, resolvedBy: "auto_resolve" });
          expect(stripeMock.transfers.create).not.toHaveBeenCalled();
          expect(slackAlerts.some((a) => (a as { title?: string }).title === "Dispute left the queue unsettled")).toBe(false);
        });

        it.each([
          ["split_pending", "splitPending"],
          ["stuck_release", "stuck"],
        ])("refuses (409, no transfer) when the claim answers %s", async (verdict, key) => {
          seedReleasable();
          scenario.rpc.claim_dispute_settlement = { verdict };
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
          );
          const body = await json(res);
          expect(res.status).toBe(409);
          expect(body[key]).toBeTruthy();
          expect(stripeMock.transfers.create).not.toHaveBeenCalled();
        });

        it("asks Stripe inside the claim: a charge already refunded (no ledger row) blocks the transfer and frees the claim", async () => {
          seedReleasable();
          scenario.rpc.claim_dispute_settlement = { verdict: "claimed", token: "tok-r" };
          stripeMock.paymentIntents.retrieve.mockResolvedValue({
            id: "pi_d", status: "succeeded", latest_charge: { id: "ch_1", amount_refunded: 5000 },
          });
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBe(409);
          expect((await json(res)).alreadyMoved).toBe(true);
          expect(stripeMock.transfers.create).not.toHaveBeenCalled();
          expect(scenario.rpcCalls!.filter((c) => c.name === "release_dispute_settlement_claim")).toEqual([
            expect.objectContaining({ args: { _job_id: "job-1", _token: "tok-r" } }),
          ]);
        });

        it("KEEPS the claim when the transfer went out but its ledger write failed — a free claim there is the double spend", async () => {
          seedReleasable();
          scenario.rpc.claim_dispute_settlement = { verdict: "claimed", token: "tok-m" };
          stripeMock.transfers.create.mockResolvedValue({ id: "tr_sent" });
          scenario.writeErrors.payout_transfers = { message: "insert refused" };
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBeGreaterThanOrEqual(500);
          expect(stripeMock.transfers.create).toHaveBeenCalled();
          expect(scenario.rpcCalls!.some((c) => c.name === "release_dispute_settlement_claim")).toBe(false);
        });

        it("refuses a general refund over a decided, unexecuted dispute", async () => {
          seedAuth(scenario, ADMIN);
          scenario.rpc.has_role = true;
          scenario.reads.jobs = {
            rows: [{ id: "job-1", customer_id: POSTER.id, helper_id: HELPER.id, status: "completed", payment_status: "escrow", budget: 100, title: "Decided job", stripe_payment_intent_id: "pi_d" }],
          };
          scenario.reads.disputes = { rows: [{ id: "d-1", execution_status: "pending", payout_split: { poster: 0.5, helper: 0.5 } }] };
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_refund_general", jobId: "job-1", reason: "goodwill" } }),
          );
          expect(res.status).toBe(409);
          expect(stripeMock.refunds.create).not.toHaveBeenCalled();
        });

        it("fails CLOSED when the claim RPC errors — guessing here spends twice", async () => {
          seedReleasable();
          scenario.rpcErrors = { claim_dispute_settlement: { message: "boom", code: "XX000" } };
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBe(503);
          expect(stripeMock.transfers.create).not.toHaveBeenCalled();
        });

        it("KEEPS the claim when Stripe fails ambiguously (timeout / connection / 5xx) — the transfer may exist", async () => {
          seedReleasable();
          stripeMock.transfers.create.mockRejectedValueOnce(Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" }));
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBeGreaterThanOrEqual(400);
          expect(
            scenario.rpcCalls!.some((c) => c.name === "release_dispute_settlement_claim"),
          ).toBe(false);
        });

        it("KEEPS the claim on a StripeIdempotencyError from the transfer — a request with that key already ran (round-5 review, LOW-5)", async () => {
          seedReleasable();
          stripeMock.transfers.create.mockRejectedValueOnce(Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters"), { type: "StripeIdempotencyError" }));
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBeGreaterThanOrEqual(400);
          expect(scenario.rpcCalls!.some((c) => c.name === "release_dispute_settlement_claim")).toBe(false);
        });

        it("gives the claim back when Stripe DEFINITELY refused the transfer, so the counterpart is not locked out", async () => {
          seedReleasable();
          stripeMock.transfers.create.mockRejectedValueOnce(Object.assign(new Error("insufficient funds"), { type: "StripeInvalidRequestError" }));
          const fn = await load();
          const res = await fn.fetch(
            fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
          );
          expect(res.status).toBeGreaterThanOrEqual(400);
          expect(
            scenario.rpcCalls!.some((c) => c.name === "release_dispute_settlement_claim"),
          ).toBe(true);
        });
      });

      it("an audit-log write that matches zero rows is never silent", async () => {
        seedReleasable();
        scenario.writeSelectRows.admin_audit_log = [];
        const fn = await load();
        const res = await fn.fetch(
          fn.request({ headers: AUTH, body: { action: "admin_release_dispute", jobId: "job-1" } }),
        );
        expect(res.status).toBe(200);
        expect(
          slackAlerts.some(
            (a) => (a as { title?: string }).title === "Admin money action left no audit trail",
          ),
        ).toBe(true);
      });
    });

    it("admin_refund_general issues a partial refund and leaves the job state intact", async () => {
      seedAuth(scenario, ADMIN);
      scenario.rpc.has_role = true;
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            budget: 100,
            title: "Goodwill job",
            stripe_payment_intent_id: "pi_g",
          },
        ],
      };
      // $112 captured ($100 budget + $12 poster service fee). The partial
      // ceiling is this captured amount, not job.budget (MS-6).
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_g",
        status: "succeeded",
        amount: 11200,
        amount_received: 11200,
      });
      stripeMock.refunds.create.mockResolvedValue({ id: "re_g" });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: {
            action: "admin_refund_general",
            jobId: "job-1",
            amountCents: 2500,
            reason: "partial completion",
          },
        }),
      );
      const out = await json(res);
      expect(res.status).toBe(200);
      expect(out.partial).toBe(true);
      // Partial refund passes an explicit amount.
      expect(stripeMock.refunds.create.mock.calls[0][0].amount).toBe(2500);
      // Job is NOT cancelled on a partial refund.
      const jobUpdate = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect(jobUpdate).toBeUndefined();
      // Audit log row is still written.
      expect(
        scenario.writes.some((w) => w.table === "admin_audit_log"),
      ).toBe(true);
    });

    // The full-refund flip matched on id alone and wrote cancelled/refunded
    // over whatever landed during the Stripe round-trips (a dispute filed, a
    // Quick Release, a payout). Deferred from the 2026-09-14 lifecycle-writes
    // audit to this branch.
    describe("admin_refund_general full-refund flip", () => {
      const seedFull = (payment_status: string | null = "payout_pending") => {
        seedAuth(scenario, ADMIN);
        scenario.rpc.has_role = true;
        scenario.reads.jobs = {
          rows: [{ id: "job-1", customer_id: POSTER.id, helper_id: HELPER.id, status: "completed", payment_status, budget: 100, title: "Goodwill job", stripe_payment_intent_id: "pi_g" }],
        };
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_g", status: "succeeded" });
        stripeMock.refunds.create.mockResolvedValue({ id: "re_g", amount: 10000 });
      };
      const call = async () => {
        const fn = await load();
        return fn.fetch(fn.request({ headers: AUTH, body: { action: "admin_refund_general", jobId: "job-1", reason: "goodwill" } }));
      };

      it("is pinned to the status AND payment_status it read", async () => {
        seedFull();
        const res = await call();
        expect(res.status).toBe(200);
        const flip = scenario.writes.find((w) => w.table === "jobs" && w.op === "update");
        expect(flip?.payload).toMatchObject({ status: "cancelled", payment_status: "refunded" });
        expect(flip?.filters).toEqual(expect.arrayContaining([
          { op: "eq", column: "status", value: "completed" },
          { op: "eq", column: "payment_status", value: "payout_pending" },
        ]));
      });

      it("zero rows because the job MOVED during the refund: 500 and a critical page, never a silent success", async () => {
        seedFull();
        scenario.writeSelectRows.jobs = [];
        scenario.reads.jobs.selectOverrides = [
          { includes: "id, status, payment_status", result: { rows: [{ id: "job-1", status: "disputed", payment_status: "payout_pending" }] } },
        ];
        const res = await call();
        expect(res.status).toBe(500);
        expect(slackAlerts.some((a) => (a as { title?: string }).title === "General refund issued while the job changed state")).toBe(true);
      });

      it("zero rows because a concurrent copy of this refund already flipped it: success, no page", async () => {
        seedFull();
        scenario.writeSelectRows.jobs = [];
        scenario.reads.jobs.selectOverrides = [
          { includes: "id, status, payment_status", result: { rows: [{ id: "job-1", status: "cancelled", payment_status: "refunded" }] } },
        ];
        const res = await call();
        expect(res.status).toBe(200);
        expect(slackAlerts.some((a) => (a as { title?: string }).title === "General refund issued while the job changed state")).toBe(false);
      });

      it("refuses while the poster's cancel_escrow refund is in flight (payment_status cancelling)", async () => {
        seedFull("cancelling");
        const res = await call();
        expect(res.status).toBe(409);
        expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      });
    });

    it("admin_refund_general rejects a partial amount above the captured total", async () => {
      seedAuth(scenario, ADMIN);
      scenario.rpc.has_role = true;
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            budget: 100,
            title: "Job",
            stripe_payment_intent_id: "pi_g",
          },
        ],
      };
      // $112 captured; a $9,999.99 partial is far above it and is refused.
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_g",
        status: "succeeded",
        amount: 11200,
        amount_received: 11200,
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: {
            action: "admin_refund_general",
            jobId: "job-1",
            amountCents: 999999,
          },
        }),
      );
      expect(res.status).toBe(500);
      expect((await json(res)).error).toMatch(/invalid partial amount/i);
    });

    // ── MS-6: a partial refund of exactly the budget must STAY partial ───────
    // Regression for the money-state hole hunt (2026-09-15). The "full vs
    // partial" test used to compare the request against job.budget, so a
    // request for exactly the budget was treated as a FULL refund: it refunded
    // the WHOLE capture (budget + fees + tax) and cancelled the job. A provided
    // amountCents is now ALWAYS partial and is sent verbatim; the ceiling is the
    // captured amount, never job.budget.
    it("admin_refund_general keeps a refund of exactly the budget PARTIAL — no full-capture refund, no cancellation (MS-6)", async () => {
      seedAuth(scenario, ADMIN);
      scenario.rpc.has_role = true;
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            budget: 100,
            title: "Budget-equal refund",
            payment_status: "escrow",
            stripe_payment_intent_id: "pi_be",
          },
        ],
      };
      // $112 captured ($100 budget + $12 poster fee). The admin asks to refund
      // exactly $100.00 (10000¢ == budget).
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_be",
        status: "succeeded",
        amount: 11200,
        amount_received: 11200,
      });
      stripeMock.refunds.create.mockResolvedValue({ id: "re_be" });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: {
            action: "admin_refund_general",
            jobId: "job-1",
            amountCents: 10000, // === budget in cents
          },
        }),
      );
      const out = await json(res);
      expect(res.status).toBe(200);
      // It is treated as PARTIAL…
      expect(out.partial).toBe(true);
      // …so Stripe is asked for EXACTLY $100 — never the full $112 capture.
      expect(stripeMock.refunds.create.mock.calls[0][0].amount).toBe(10000);
      // …and the job is NOT cancelled / flipped to refunded.
      const jobUpdate = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect(jobUpdate).toBeUndefined();
    });

    // A partial equal to the FULL capture is a full refund in disguise. It must
    // NOT slip past the escrow-already-moved guard that a real full refund hits
    // when the Helpr has already been paid — otherwise the MS-6 ceiling widening
    // (job.budget → full capture) would re-open the double-pay hole for partials.
    it("admin_refund_general REFUSES a full-capture partial when the Helpr was already paid (guard not bypassed)", async () => {
      seedAuth(scenario, ADMIN);
      scenario.rpc.has_role = true;
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            helper_id: HELPER.id,
            budget: 100,
            title: "Paid-out job",
            payment_status: "released",
            stripe_payment_intent_id: "pi_paid",
          },
        ],
      };
      // A live (paid) payout row — money already left to the Helpr.
      scenario.reads.payout_transfers = {
        rows: [
          {
            id: "pt-1",
            job_id: "job-1",
            status: "paid",
            stripe_transfer_id: "tr_live",
          },
        ],
      };
      // $112 captured; the admin asks to refund the WHOLE $112 as a "partial".
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_paid",
        status: "succeeded",
        amount: 11200,
        amount_received: 11200,
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: {
            action: "admin_refund_general",
            jobId: "job-1",
            amountCents: 11200, // === full capture
          },
        }),
      );
      // Refused by the escrow-already-moved guard — 409, nothing moved.
      expect(res.status).toBe(409);
      expect((await json(res)).alreadyMoved).toBe(true);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    // A degenerate captured amount (non-finite / zero) makes the partial ceiling
    // meaningless (`x > NaN` is always false), so it must abort rather than issue
    // an unbounded partial — matching admin_refund_dispute's capture guard.
    it("admin_refund_general aborts a partial when the captured amount is unreadable", async () => {
      seedAuth(scenario, ADMIN);
      scenario.rpc.has_role = true;
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            budget: 100,
            title: "Bad-capture job",
            payment_status: "escrow",
            stripe_payment_intent_id: "pi_bad",
          },
        ],
      };
      // No captured amount at all — capturedCents resolves to 0.
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_bad",
        status: "succeeded",
        amount: null,
        amount_received: null,
      });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: {
            action: "admin_refund_general",
            jobId: "job-1",
            amountCents: 5000,
          },
        }),
      );
      expect(res.status).toBe(500);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(
        slackAlerts.some(
          (a) => (a as { severity?: string }).severity === "critical",
        ),
      ).toBe(true);
    });
  });
});

// ─── proven able to fail, 2026-09-21 ───────────────────────────────────────
// Deleting the transfer_group tag from the Quick Release transfer makes that
// live transfer invisible to every `transfers.list({ transfer_group })`
// duplicate check — the sibling guard that was hollow for exactly this. Red:
//   × tags the Quick Release transfer with the job's transfer_group …
//   AssertionError: expected { amount: 8800, … } to match object { transfer_group: 'job_job-1' }
// @mutate supabase/functions/create-payment/index.ts | answered (round 3, H2).\n      transfer_group: `job_${jobId}`, | answered (round 3, H2).
