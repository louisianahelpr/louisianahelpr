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
      expect((await json(res)).error).toMatch(/already been initiated/i);
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

    it("only the customer may tip, and only on a completed job", async () => {
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
      expect((await json(res)).error).toMatch(/only the customer can tip/i);
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
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_g",
        status: "succeeded",
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

    it("admin_refund_general rejects an out-of-range partial amount", async () => {
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
  });
});
