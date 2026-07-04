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
import { rateLimitState, resetSharedMocks } from "./mocks/shared";

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
      scenario.reads.profiles = { rows: [{ onboarding_fee_paid: true }] };
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
      // 10% customer fee → a $10 service-fee line item (1000 cents)
      const feeItem = args.line_items.find(
        (li: { price_data: { product_data: { name: string } } }) =>
          li.price_data.product_data.name === "Service Fee",
      );
      expect(feeItem.price_data.unit_amount).toBe(1000);
      // poster already paid onboarding fee → no setup line item
      expect(
        args.line_items.some(
          (li: { price_data: { product_data: { name: string } } }) =>
            li.price_data.product_data.name === "One-time Account Setup",
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
          li.price_data.product_data.name === "One-time Account Setup",
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
            helper_confirmed_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
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
    it("rejects a non-positive tip amount", async () => {
      seedAuth(scenario, POSTER);
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "tip", jobId: "job-1", amount: 0 },
        }),
      );
      expect((await json(res)).error).toMatch(/invalid tip amount/i);
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
      // tips ledger row written
      expect(
        scenario.writes.some((w) => w.table === "tips" && w.op === "insert"),
      ).toBe(true);
    });
  });

  describe("action: cancel_escrow", () => {
    it("refunds a succeeded payment intent and cancels the job", async () => {
      seedAuth(scenario, POSTER);
      scenario.reads.jobs = {
        rows: [
          {
            id: "job-1",
            customer_id: POSTER.id,
            stripe_payment_intent_id: "pi_live",
          },
        ],
      };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_live",
        status: "succeeded",
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
      expect(stripeMock.refunds.create).toHaveBeenCalledWith(
        { payment_intent: "pi_live" },
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

    it("admin_refund_dispute refunds the captured payment and cancels the job", async () => {
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
      });
      stripeMock.refunds.create.mockResolvedValue({ id: "re_r" });
      const fn = await load();
      const res = await fn.fetch(
        fn.request({
          headers: AUTH,
          body: { action: "admin_refund_dispute", jobId: "job-1" },
        }),
      );
      expect(res.status).toBe(200);
      expect(stripeMock.refunds.create).toHaveBeenCalled();
      const jobUpdate = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect((jobUpdate?.payload as Record<string, unknown>).payment_status).toBe(
        "refunded",
      );
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
