/**
 * Unit tests for the `stripe-webhook` Supabase edge function.
 *
 * This webhook is the inbound side of every Stripe-driven state change:
 * checkout completion (escrow funding, tips, boosts, onboarding-fee
 * collection), subscription lifecycle, payment failures, refunds, Connect
 * account updates, and payout transfer settlement.
 *
 * Critical, previously-untested invariants exercised here:
 *   - It ALWAYS returns HTTP 200, even when misconfigured or on a bad
 *     signature, so Stripe stops retrying (a non-2xx triggers infinite
 *     retry storms).
 *   - Signature verification gates all event processing.
 *   - The idempotency guard (unique event_id insert) skips replays.
 *   - checkout.session.completed funds escrow / marks tips paid.
 *   - charge.refunded + payment_intent.payment_failed update the job.
 *
 * Runs the REAL function source via the edge harness; only Stripe, Supabase,
 * the Slack alerter, and the Deno runtime are doubled.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, resetSharedMocks } from "./mocks/shared";

/** Load stripe-webhook with both Stripe key + webhook secret present. */
async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
  return loadEdgeFunction("stripe-webhook");
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

/** A webhook POST carrying a raw body + signature header. */
function webhookRequest(fn: EdgeHarness, rawBody: string, sig = "t=1,v1=abc") {
  return fn.request({
    rawBody,
    headers: { "stripe-signature": sig, "content-type": "application/json" },
  });
}

describe("stripe-webhook edge function", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  describe("defensive 200-on-misconfig", () => {
    it("returns 200 (not 5xx) when STRIPE_SECRET_KEY is not set", async () => {
      setEnv({ SUPABASE_URL: "https://x.test", STRIPE_WEBHOOK_SECRET: "whsec_x" });
      const fn = await loadEdgeFunction("stripe-webhook");
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      expect((await json(res)).error).toBe("stripe_key_not_configured");
    });

    it("returns 200 when STRIPE_WEBHOOK_SECRET is missing", async () => {
      setEnv({
        SUPABASE_URL: "https://x.test",
        SUPABASE_SERVICE_ROLE_KEY: "svc",
        STRIPE_SECRET_KEY: "sk_test_abc",
      });
      const fn = await loadEdgeFunction("stripe-webhook");
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      expect((await json(res)).error).toBe("webhook_secret_not_configured");
    });

    it("returns 200 when the stripe-signature header is absent", async () => {
      const fn = await loadConfigured();
      const res = await fn.fetch(fn.request({ rawBody: "{}" }));
      expect(res.status).toBe(200);
      expect((await json(res)).error).toBe("missing_signature_header");
    });

    it("OPTIONS preflight returns 200 with CORS", async () => {
      const fn = await loadConfigured();
      const res = await fn.fetch(fn.request({ method: "OPTIONS" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  describe("signature verification", () => {
    it("returns 200 + signature_verification_failed on a bad signature, and alerts Slack", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockRejectedValue(
        new Error("No signatures found matching the expected signature"),
      );
      const res = await fn.fetch(webhookRequest(fn, '{"id":"evt_1"}'));
      expect(res.status).toBe(200);
      expect((await json(res)).error).toBe("signature_verification_failed");
      // A critical Slack ops alert must have fired.
      expect(slackAlerts.length).toBeGreaterThan(0);
      expect((slackAlerts[0] as { kind: string }).kind).toBe(
        "stripe_webhook_error",
      );
    });

    it("processes the event when the signature verifies", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_ok",
        type: "tax.settings.updated",
        data: { object: {} },
      });
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      expect((await json(res)).received).toBe(true);
    });
  });

  describe("idempotency guard", () => {
    it("skips an event whose id was already recorded (unique violation 23505)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_dup",
        type: "tax.settings.updated",
        data: { object: {} },
      });
      // The idempotency insert into stripe_webhook_events returns 23505.
      scenario.writeErrors.stripe_webhook_events = {
        message: "duplicate key value violates unique constraint",
        code: "23505",
      };
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      expect((await json(res)).duplicate).toBe(true);
    });

    it("continues processing when the idempotency insert is a fresh (no-error) write", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_fresh",
        type: "tax.settings.updated",
        data: { object: {} },
      });
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      const out = await json(res);
      expect(out.duplicate).toBeUndefined();
      expect(out.received).toBe(true);
    });
  });

  describe("checkout.session.completed", () => {
    it("stores the payment intent + escrow status on the job", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_co",
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "payment",
            customer_email: "poster@test.com",
            payment_intent: "pi_checkout",
            metadata: { job_id: "job-1" },
          },
        },
      });
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      const jobWrite = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      const payload = jobWrite?.payload as Record<string, unknown>;
      expect(payload.stripe_payment_intent_id).toBe("pi_checkout");
      expect(payload.payment_status).toBe("escrow");
    });

    it("marks a tip as paid and notifies the helper on a tip checkout", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_tip",
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "payment",
            customer_email: "poster@test.com",
            metadata: {
              type: "tip",
              job_id: "job-1",
              tipper_id: "poster-1",
              helper_id: "helper-1",
            },
          },
        },
      });
      await fn.fetch(webhookRequest(fn, "{}"));
      const tipWrite = scenario.writes.find(
        (w) => w.table === "tips" && w.op === "update",
      );
      expect((tipWrite?.payload as Record<string, unknown>).payment_status).toBe(
        "paid",
      );
      const notif = scenario.writes.find((w) => w.table === "notifications");
      expect((notif?.payload as Record<string, unknown>).user_id).toBe(
        "helper-1",
      );
    });

    it("auto-refunds a duplicate $2 onboarding fee when the flag was already set", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_dupfee",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_dup",
            mode: "payment",
            customer_email: "poster@test.com",
            payment_intent: "pi_dup",
            metadata: {
              job_id: "job-1",
              onboarding_fee_charged: "true",
              customer_id: "poster-1",
            },
          },
        },
      });
      // The atomic flip UPDATE ... WHERE onboarding_fee_paid=false matches
      // 0 rows → another path already collected the fee → refund the $2.
      scenario.writeSelectRows.profiles = [];
      stripeMock.refunds.create.mockResolvedValue({ id: "re_dup" });
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(stripeMock.refunds.create).toHaveBeenCalled();
      const refundArgs = stripeMock.refunds.create.mock.calls[0][0];
      expect(refundArgs.amount).toBe(200);
      expect(refundArgs.payment_intent).toBe("pi_dup");
    });

    it("does NOT refund when the onboarding-fee flip succeeded (this checkout was first)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_firstfee",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_first",
            mode: "payment",
            customer_email: "poster@test.com",
            payment_intent: "pi_first",
            metadata: {
              job_id: "job-1",
              onboarding_fee_charged: "true",
              customer_id: "poster-1",
            },
          },
        },
      });
      // Flip matched 1 row → this checkout legitimately collected the fee.
      scenario.writeSelectRows.profiles = [{ user_id: "poster-1" }];
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });
  });

  describe("payment_intent.payment_failed", () => {
    it("marks the linked job failed and notifies the poster", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_fail",
        type: "payment_intent.payment_failed",
        data: { object: { id: "pi_failed", receipt_email: "poster@test.com" } },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job" }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      const jobWrite = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect((jobWrite?.payload as Record<string, unknown>).payment_status).toBe(
        "failed",
      );
      const notif = scenario.writes.find((w) => w.table === "notifications");
      expect((notif?.payload as Record<string, unknown>).type).toBe("warning");
    });
  });

  describe("charge.refunded", () => {
    it("flips the job to refunded and notifies the poster on a FULL refund", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_refund",
        type: "charge.refunded",
        data: {
          object: {
            id: "ch_1",
            payment_intent: "pi_refunded",
            amount: 5000,
            amount_refunded: 5000,
          },
        },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job" }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      const jobWrite = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect((jobWrite?.payload as Record<string, unknown>).payment_status).toBe(
        "refunded",
      );
    });

    it("leaves the job status unchanged on a PARTIAL refund (funds still in escrow)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_refund_partial",
        type: "charge.refunded",
        data: {
          object: {
            id: "ch_2",
            payment_intent: "pi_partial",
            amount: 5000,
            amount_refunded: 300,
          },
        },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job" }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      const jobWrite = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect(jobWrite).toBeUndefined();
    });
  });

  describe("transfer.created (payout settlement)", () => {
    it("flips the ledger row to paid and the job to released", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_transfer",
        type: "transfer.created",
        data: {
          object: {
            id: "tr_1",
            amount: 9000,
            destination: "acct_helper",
            metadata: { job_id: "job-1" },
          },
        },
      });
      scenario.writeSelectRows.payout_transfers = [
        { job_id: "job-1", helper_id: "helper-1" },
      ];
      scenario.reads.profiles = {
        rows: [{ user_id: "helper-1", full_name: "Helper" }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      const ledgerWrite = scenario.writes.find(
        (w) => w.table === "payout_transfers" && w.op === "update",
      );
      expect((ledgerWrite?.payload as Record<string, unknown>).status).toBe(
        "paid",
      );
      const jobWrite = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect((jobWrite?.payload as Record<string, unknown>).payment_status).toBe(
        "released",
      );
    });
  });

  describe("transfer.failed", () => {
    it("marks the ledger row failed and posts a Slack ops alert", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_tfail",
        type: "transfer.failed",
        data: {
          object: {
            id: "tr_bad",
            amount: 5000,
            destination: "acct_helper",
            failure_message: "account closed",
          },
        },
      });
      await fn.fetch(webhookRequest(fn, "{}"));
      const ledgerWrite = scenario.writes.find(
        (w) => w.table === "payout_transfers" && w.op === "update",
      );
      const payload = ledgerWrite?.payload as Record<string, unknown>;
      expect(payload.status).toBe("failed");
      expect(payload.failure_reason).toBe("account closed");
      expect(
        slackAlerts.some((a) => (a as { kind: string }).kind === "payout_failed"),
      ).toBe(true);
    });
  });

  describe("processing errors stay 200", () => {
    it("returns 200 + processing_error when an event handler throws", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_boom",
        type: "customer.subscription.updated",
        data: {
          object: {
            customer: "cus_1",
            items: { data: [{ price: { product: "prod_U8rS2fR6KvQoRk" } }] },
            status: "active",
          },
        },
      });
      // customer.retrieve throwing simulates an unexpected Stripe failure
      // mid-processing — the webhook must still ack 200 to stop retries.
      stripeMock.customers.retrieve.mockRejectedValue(new Error("stripe down"));
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      expect((await json(res)).error).toBe("processing_error");
    });
  });
});
