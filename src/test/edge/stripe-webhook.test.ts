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
import {
  REAL_ACTIVE_SUBSCRIPTION,
  REAL_CANCELLED_SUBSCRIPTION,
} from "./subscriptionLinkage.test";

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
      // The tip UPDATE is gated on `payment_status='pending'` and returns the
      // flipped row via `.select("id")`; the helper is notified ONLY when a row
      // actually transitioned (so a webhook redelivery of an already-paid tip
      // does not double-notify). Model the first-delivery case: one row flips.
      scenario.writeSelectRows.tips = [{ id: "tip-1" }];
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

    it("does NOT re-notify the helper when a tip webhook is redelivered (no row flips)", async () => {
      const fn = await loadConfigured();
      // Duplicate delivery: the tip was already 'paid', so the conditional
      // UPDATE matches zero rows and `.select("id")` returns []. The helper
      // must NOT be notified a second time (F-WEBHOOK-03).
      scenario.writeSelectRows.tips = [];
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_tip_dup",
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
      const notif = scenario.writes.find((w) => w.table === "notifications");
      expect(notif).toBeUndefined();
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
        data: {
          object: {
            id: "pi_failed",
            receipt_email: "poster@test.com",
            // ME-040: a declined Checkout never writes
            // jobs.stripe_payment_intent_id (only the success path does), so
            // the handler resolves the job via `pi.metadata.job_id` — the
            // one field create-payment sets unconditionally on every
            // Checkout Session's payment_intent_data.
            metadata: { job_id: "job-1" },
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
        "failed",
      );
      const notif = scenario.writes.find((w) => w.table === "notifications");
      expect((notif?.payload as Record<string, unknown>).type).toBe("warning");
    });

    it("ME-040: does nothing (no crash, no write) for a PI with no job_id metadata, rather than falling back to a column the decline path never wrote", async () => {
      // Before the fix this branch looked up `jobs.stripe_payment_intent_id`,
      // a column ONLY the success path writes — a declined-at-Checkout PI
      // always misses it, so the handler silently found nothing, notified no
      // one, and never marked the job failed, with no error to surface the
      // gap. The fix resolves via `pi.metadata.job_id` instead, which
      // create-payment sets unconditionally. This case (metadata genuinely
      // absent — e.g. a PI created outside create-payment) should still be a
      // clean no-op, not a crash from reading `.job_id` off `undefined`.
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_fail_no_meta",
        type: "payment_intent.payment_failed",
        data: { object: { id: "pi_failed_no_meta", receipt_email: "poster@test.com" } },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job" }],
      };
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      expect(scenario.writes.find((w) => w.table === "jobs" && w.op === "update")).toBeUndefined();
      expect(scenario.writes.find((w) => w.table === "notifications")).toBeUndefined();
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

  describe("pif_donation checkout", () => {
    it("returns 500 + rolls back idempotency row when pif_credits idempotency check fails (DB error)", async () => {
      // Regression: the handler used to `return` instead of `throw` on a transient
      // pif_credits DB error. That returned 200 to Stripe (event marked processed,
      // idempotency row kept), so Stripe stopped retrying and the credit was never
      // minted — donor paid, recipient got nothing.
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_pif_idem_err",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_pif_1",
            mode: "payment",
            customer_email: "donor@test.com",
            metadata: {
              kind: "pif_donation",
              donor_id: "user-donor-1",
              donor_name: "Jane",
              recipient_email: "recipient@test.com",
              amount_cents: "5000",
              category: "Any",
            },
          },
        },
      });
      // Simulate a transient DB error on the pif_credits idempotency look-up.
      scenario.reads.pif_credits = { error: { message: "connection timeout" } };
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      // Must be 500 so Stripe retries, not 200 which would permanently drop the event.
      expect(res.status).toBe(500);
      const body = await json(res);
      expect(body.received).toBe(false);
      expect(body.error).toBe("processing_error");
      // The idempotency row we inserted before processing must be rolled back so
      // Stripe's retry can re-run the handler rather than being blocked as a dup.
      const rollback = scenario.writes.find(
        (w) => w.table === "stripe_webhook_events" && w.op === "delete",
      );
      expect(rollback).toBeDefined();
    });
  });

  /**
   * Membership lifecycle: purchase → grant, renewal → extend, lapse/cancel →
   * clear.
   *
   * These exist because every RECURRING purchase and every renewal was silently
   * broken. Stripe removed `current_period_start`/`current_period_end` from the
   * Subscription object in API version **2025-03-31.basil**; these functions pin
   * `2025-08-27.basil` and import `esm.sh/stripe@18.5.0`, whose own
   * `types/Subscriptions.d.ts` has no such property. So
   * `new Date(subscription.current_period_end * 1000).toISOString()` was
   * `new Date(NaN).toISOString()` — a `RangeError`, not a wrong date. The throw
   * reached the dispatcher, which rolled back the dedupe row and returned 500,
   * so Stripe redelivered and it threw again until it gave up: the customer was
   * charged and never received the tier. Nothing caught it because
   * `tsconfig.app.json` does not compile `supabase/functions/**`.
   *
   * `PERIOD_END` below is the real item timestamp from a subscription created
   * against the live test-mode API on 2026-09-01 (Elite monthly $20). Note it is
   * set ONLY on the subscription ITEM — putting it on the subscription root
   * instead is the exact shape Stripe no longer sends.
   */
  describe("membership lifecycle", () => {
    const PERIOD_END = 1790815257;
    const PERIOD_END_ISO = new Date(PERIOD_END * 1000).toISOString();
    /** Live-mode Pro monthly product, from _shared/productTiers.ts. */
    const PRO_PRODUCT = "prod_U8rTRJZSUyzaha";

    const subscriptionObject = (over: Record<string, unknown> = {}) => ({
      id: "sub_test_1",
      customer: "cus_1",
      status: "active",
      metadata: { user_id: "user-1", tier: "pro" },
      items: {
        data: [
          {
            price: { product: PRO_PRODUCT },
            current_period_start: 1788223257,
            current_period_end: PERIOD_END,
          },
        ],
      },
      ...over,
    });

    const profileWrite = () =>
      scenario.writes.find((w) => w.table === "profiles" && w.op === "update")
        ?.payload as Record<string, unknown> | undefined;

    it("grants the tier and stamps the expiry from the ITEM on a subscription checkout", async () => {
      const fn = await loadConfigured();
      stripeMock.subscriptions.retrieve.mockResolvedValue(subscriptionObject());
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_sub_checkout",
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "subscription",
            customer_email: "buyer@test.com",
            client_reference_id: "user-1",
            subscription: "sub_test_1",
            metadata: { tier: "pro", billing_cycle: "monthly", user_id: "user-1" },
          },
        },
      });

      const res = await fn.fetch(webhookRequest(fn, "{}"));

      // Before the fix this was 500 + processing_error, forever.
      expect(res.status).toBe(200);
      expect(profileWrite()?.subscription_tier).toBe("pro");
      expect(profileWrite()?.subscription_expires_at).toBe(PERIOD_END_ISO);
    });

    it("still grants the tier — and pages ops — when NO item carries a period end", async () => {
      const fn = await loadConfigured();
      stripeMock.subscriptions.retrieve.mockResolvedValue(
        subscriptionObject({ items: { data: [{ price: { product: PRO_PRODUCT } }] } }),
      );
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_sub_no_period",
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "subscription",
            customer_email: "buyer@test.com",
            client_reference_id: "user-1",
            subscription: "sub_test_1",
            metadata: { tier: "pro", billing_cycle: "monthly", user_id: "user-1" },
          },
        },
      });

      const res = await fn.fetch(webhookRequest(fn, "{}"));

      // Denying a paying customer is the worse failure, so the tier is still
      // granted — but an expiry-less tier is one `expire-subscriptions` can
      // never clear (it filters `subscription_expires_at IS NOT NULL`), so it
      // must not pass quietly.
      expect(res.status).toBe(200);
      expect(profileWrite()?.subscription_tier).toBe("pro");
      expect(profileWrite()?.subscription_expires_at).toBeUndefined();
      expect(
        slackAlerts.some((a) =>
          String((a as { title?: string }).title).includes("no period end"),
        ),
      ).toBe(true);
    });

    it("recovers the tier from session metadata when the product id is unmapped, and alerts", async () => {
      const fn = await loadConfigured();
      stripeMock.subscriptions.retrieve.mockResolvedValue(
        subscriptionObject({
          items: {
            data: [
              { price: { product: "prod_not_in_the_map" }, current_period_end: PERIOD_END },
            ],
          },
        }),
      );
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_sub_unmapped",
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "subscription",
            customer_email: "buyer@test.com",
            client_reference_id: "user-1",
            subscription: "sub_test_1",
            metadata: { tier: "elite", billing_cycle: "monthly", user_id: "user-1" },
          },
        },
      });

      const res = await fn.fetch(webhookRequest(fn, "{}"));

      // Without the metadata fallback the handler's `if (tier)` block is skipped
      // entirely: paid, no entitlement, no alert. That was live for the
      // test-mode Basic and Pro products.
      expect(res.status).toBe(200);
      expect(profileWrite()?.subscription_tier).toBe("elite");
      expect(
        slackAlerts.some((a) =>
          String((a as { title?: string }).title).includes("PRODUCT_TO_TIER"),
        ),
      ).toBe(true);
    });

    it("extends the expiry on a renewal (customer.subscription.updated, active)", async () => {
      const fn = await loadConfigured();
      stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_1", email: "buyer@test.com" });
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_sub_renew",
        type: "customer.subscription.updated",
        data: { object: subscriptionObject() },
      });

      const res = await fn.fetch(webhookRequest(fn, "{}"));

      expect(res.status).toBe(200);
      expect(profileWrite()?.subscription_tier).toBe("pro");
      expect(profileWrite()?.subscription_expires_at).toBe(PERIOD_END_ISO);
    });

    it("clears the tier when a renewal FAILS (status past_due)", async () => {
      const fn = await loadConfigured();
      stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_1", email: "buyer@test.com" });
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_sub_past_due",
        type: "customer.subscription.updated",
        data: { object: subscriptionObject({ status: "past_due" }) },
      });

      const res = await fn.fetch(webhookRequest(fn, "{}"));

      // Stripe reports a failed renewal as a subscription status change, so
      // this branch — not a separate invoice.payment_failed handler — is what
      // stops a lapsed card keeping a paid tier.
      expect(res.status).toBe(200);
      expect(profileWrite()?.subscription_tier).toBeNull();
      expect(profileWrite()?.subscription_expires_at).toBeNull();
    });

    it("keeps the tier through the paid-for period when cancel_at_period_end is set", async () => {
      const fn = await loadConfigured();
      stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_1", email: "buyer@test.com" });
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_sub_cancel_at_period_end",
        type: "customer.subscription.updated",
        // Stripe keeps status "active" and only flips cancel_at_period_end when
        // someone cancels in the portal. Perks must last until the period they
        // already paid for ends — the later subscription.deleted event is what
        // actually revokes.
        data: { object: subscriptionObject({ cancel_at_period_end: true }) },
      });

      const res = await fn.fetch(webhookRequest(fn, "{}"));

      expect(res.status).toBe(200);
      expect(profileWrite()?.subscription_tier).toBe("pro");
      expect(profileWrite()?.subscription_expires_at).toBe(PERIOD_END_ISO);
    });

    // ── Stripe linkage (migration 20260901011254) ─────────────────────────
    //
    // Before these columns the ONLY join from a membership back to Stripe was
    // the customer's email — not unique in `profiles`, and one person can hold
    // several Stripe customers on one address. That is why the
    // `current_period_end` outage could not be detected from our own data.

    const linkageWrites = () =>
      scenario.writes.filter((w) => w.table === "profiles" && w.op === "update");
    /** The MOST RECENT profiles update — profileWrite() returns the first. */
    const lastProfileWrite = () => {
      const all = linkageWrites();
      return all[all.length - 1]?.payload as Record<string, unknown> | undefined;
    };

    it("stamps the Stripe customer, subscription and billing cycle on a subscription checkout", async () => {
      const fn = await loadConfigured();
      stripeMock.subscriptions.retrieve.mockResolvedValue(
        subscriptionObject({
          items: {
            data: [
              {
                price: { product: PRO_PRODUCT, recurring: { interval: "month" } },
                current_period_end: PERIOD_END,
              },
            ],
          },
        }),
      );
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_link_checkout",
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "subscription",
            customer_email: "buyer@test.com",
            client_reference_id: "user-1",
            subscription: "sub_test_1",
            metadata: { tier: "pro", billing_cycle: "monthly", user_id: "user-1" },
          },
        },
      });

      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      const w = profileWrite()!;
      expect(w.stripe_customer_id).toBe("cus_1");
      expect(w.stripe_subscription_id).toBe("sub_test_1");
      expect(w.subscription_billing_cycle).toBe("monthly");
      expect(w.subscription_cancel_at_period_end).toBe(false);
    });

    it("reads the cycle from the PRICE, not the session metadata, when they disagree", async () => {
      const fn = await loadConfigured();
      // The price is what Stripe will actually charge; metadata is only what
      // the checkout was asked for. An annual price with stale monthly metadata
      // must not tell the member they are billed monthly.
      stripeMock.subscriptions.retrieve.mockResolvedValue(
        subscriptionObject({
          items: {
            data: [
              {
                price: { product: PRO_PRODUCT, recurring: { interval: "year" } },
                current_period_end: PERIOD_END,
              },
            ],
          },
        }),
      );
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_link_annual",
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "subscription",
            customer_email: "buyer@test.com",
            client_reference_id: "user-1",
            subscription: "sub_test_1",
            metadata: { tier: "pro", billing_cycle: "monthly", user_id: "user-1" },
          },
        },
      });

      await fn.fetch(webhookRequest(fn, "{}"));
      expect(profileWrite()?.subscription_billing_cycle).toBe("annual");
    });

    it("marks a one-time pass as one_time with NO subscription id", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_pass",
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "payment",
            customer: "cus_pass",
            customer_email: "buyer@test.com",
            client_reference_id: "user-1",
            metadata: { tier: "pro", billing_cycle: "one_time", user_id: "user-1" },
          },
        },
      });

      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      const w = profileWrite()!;
      // A pass is a real paid entitlement with no Stripe subscription object.
      // Recording the cycle is what keeps every pass buyer out of the
      // reconciler's "tier with no live subscription" bucket, and what stops
      // the Membership card telling them their 30-day pass renews.
      expect(w.subscription_tier).toBe("pro");
      expect(w.subscription_billing_cycle).toBe("one_time");
      expect(w.stripe_subscription_id).toBeNull();
      expect(w.stripe_customer_id).toBe("cus_pass");
      expect(typeof w.subscription_expires_at).toBe("string");
    });

    it("stores cancel_at_period_end so the card can say 'Ends' instead of 'Renews'", async () => {
      const fn = await loadConfigured();
      stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_1", email: "buyer@test.com" });
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_cape",
        type: "customer.subscription.updated",
        data: { object: subscriptionObject({ cancel_at_period_end: true }) },
      });

      await fn.fetch(webhookRequest(fn, "{}"));
      const w = profileWrite()!;
      // Tier survives — they paid through the period — but the renewal claim
      // must not.
      expect(w.subscription_tier).toBe("pro");
      expect(w.subscription_cancel_at_period_end).toBe(true);
      expect(w.stripe_subscription_id).toBe("sub_test_1");
    });

    it("clears the subscription linkage (but keeps the customer) on deletion", async () => {
      const fn = await loadConfigured();
      stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_1", email: "buyer@test.com" });
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_del_link",
        type: "customer.subscription.deleted",
        data: { object: subscriptionObject({ status: "canceled" }) },
      });

      await fn.fetch(webhookRequest(fn, "{}"));
      const w = profileWrite()!;
      expect(w.stripe_subscription_id).toBeNull();
      expect(w.subscription_billing_cycle).toBeNull();
      expect(w.subscription_cancel_at_period_end).toBe(false);
      // The Customer object survives cancellation and is the durable handle for
      // reconciling a later resubscribe, so it is deliberately NOT in the patch.
      expect(Object.keys(w)).not.toContain("stripe_customer_id");
    });

    // ── The REAL payloads, through the REAL handler ───────────────────────
    //
    // A hand-written fixture cannot catch a Stripe SHAPE change, because
    // whoever writes it writes the shape they already believe — which is
    // exactly how `current_period_end` went on being read for the life of the
    // pinned API version. These two objects were captured on 2026-09-01 from a
    // subscription created and then cancelled in TEST MODE on the project's own
    // account (acct_1RQbAfKp2H4b7tEC, livemode:false; cancelled, refunded and
    // marked for deletion afterwards). See subscriptionLinkage.test.ts.

    // The two constants are the Stripe objects verbatim. In production
    // `create-pro-checkout` stamps `metadata.user_id` onto the subscription and
    // `_resolveUser` prefers it over the email fallback; the ad-hoc test
    // subscription was created directly against the API and so carries none.
    // Added here rather than baked into the constants, so the captured payloads
    // stay exactly what Stripe returned.
    const withOwner = (sub: Record<string, unknown>) => ({
      ...sub,
      metadata: { user_id: "user-1", tier: "pro" },
    });

    it("derives every column from a REAL active Stripe subscription", async () => {
      const fn = await loadConfigured();
      stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_VB2aUOOVNYDZ0E", email: "buyer@test.com" });
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_real_active",
        type: "customer.subscription.updated",
        data: { object: withOwner(REAL_ACTIVE_SUBSCRIPTION) },
      });

      const res = await fn.fetch(webhookRequest(fn, "{}"));

      expect(res.status).toBe(200);
      expect(profileWrite()).toEqual({
        subscription_tier: "pro",
        // Resolved from items.data[0], NOT the absent top-level field. This
        // single expectation is the regression pin for the outage.
        subscription_expires_at: new Date(1790818146 * 1000).toISOString(),
        stripe_customer_id: "cus_VB2aUOOVNYDZ0E",
        stripe_subscription_id: "sub_1UAgVbKp2H4b7tECgY5A6IO8",
        subscription_billing_cycle: "monthly",
        subscription_cancel_at_period_end: false,
      });
    });

    it("keeps the tier but drops the renewal claim on a REAL cancelled subscription", async () => {
      const fn = await loadConfigured();
      stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_VB2aUOOVNYDZ0E", email: "buyer@test.com" });
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_real_cancelled",
        type: "customer.subscription.updated",
        data: { object: withOwner(REAL_CANCELLED_SUBSCRIPTION) },
      });

      await fn.fetch(webhookRequest(fn, "{}"));

      const w = profileWrite()!;
      // Stripe keeps status "active" and the same period end — the member paid
      // through it and keeps their perks. Only the renewal claim changes.
      expect(w.subscription_tier).toBe("pro");
      expect(w.subscription_expires_at).toBe(new Date(1790818146 * 1000).toISOString());
      expect(w.subscription_cancel_at_period_end).toBe(true);
    });

    it("is idempotent: a Stripe redelivery of the same event writes nothing a second time", async () => {
      const fn = await loadConfigured();
      const event = {
        id: "evt_replay_me",
        type: "customer.subscription.updated",
        data: { object: subscriptionObject() },
      };
      stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_1", email: "buyer@test.com" });
      stripeMock.webhooks.constructEventAsync.mockResolvedValue(event);

      const first = await fn.fetch(webhookRequest(fn, "{}"));
      expect(first.status).toBe(200);
      const afterFirst = linkageWrites().length;
      expect(afterFirst).toBe(1);
      const firstPayload = { ...profileWrite()! };

      // Stripe retries. In production the unique index on
      // stripe_webhook_events.event_id is what turns the second delivery into a
      // 23505, which the dispatcher reads as "already handled".
      scenario.writeErrors.stripe_webhook_events = {
        message: "duplicate key value violates unique constraint",
        code: "23505",
      };
      const second = await fn.fetch(webhookRequest(fn, "{}"));

      expect(second.status).toBe(200);
      expect((await json(second)).duplicate).toBe(true);
      // No SECOND profiles write — not a duplicate row, not a second update.
      expect(linkageWrites().length).toBe(afterFirst);

      // And belt-and-braces on the values themselves: even if the dedupe row
      // were lost, every field written here is a pure projection of the event's
      // own subscription object, so a replay recomputes the identical patch.
      delete scenario.writeErrors.stripe_webhook_events;
      const third = await fn.fetch(webhookRequest(fn, "{}"));
      expect(third.status).toBe(200);
      expect(linkageWrites().length).toBe(afterFirst + 1);
      expect(lastProfileWrite()).toEqual(firstPayload);
    });

    it("clears the tier on customer.subscription.deleted", async () => {
      const fn = await loadConfigured();
      stripeMock.customers.retrieve.mockResolvedValue({ id: "cus_1", email: "buyer@test.com" });
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_sub_deleted",
        type: "customer.subscription.deleted",
        data: { object: subscriptionObject({ status: "canceled" }) },
      });

      const res = await fn.fetch(webhookRequest(fn, "{}"));

      expect(res.status).toBe(200);
      expect(profileWrite()?.subscription_tier).toBeNull();
      expect(profileWrite()?.subscription_expires_at).toBeNull();
    });
  });

  describe("processing errors fail closed (retry-safe)", () => {
    it("returns 500 + processing_error and rolls back the dedupe row when a handler throws", async () => {
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
      // mid-processing. The webhook must NOT ack 200 (that would tell Stripe the
      // paid event was handled and stop redelivery), and it must delete the
      // just-inserted stripe_webhook_events dedupe row so the retry can re-run
      // the idempotent handler instead of being blocked as a duplicate.
      stripeMock.customers.retrieve.mockRejectedValue(new Error("stripe down"));
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(500);
      const body = await json(res);
      expect(body.error).toBe("processing_error");
      expect(body.received).toBe(false);
      // The dedupe row inserted before the handler ran must be rolled back.
      const rollback = scenario.writes.find(
        (w) => w.table === "stripe_webhook_events" && w.op === "delete",
      );
      expect(rollback).toBeDefined();
    });

    /**
     * The rollback DELETE used to discard its row count. A DELETE matching zero
     * rows returns `{ data: [], error: null }`, so a rollback that removed
     * nothing was indistinguishable from one that worked — and the consequence
     * of the row surviving is that Stripe's retry 200-skips as a duplicate and
     * a PAID event is dropped forever. These two tests force the delete to match
     * zero rows and assert the outcome is now visible.
     */
    async function runHandlerFailure() {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_zero_rollback",
        type: "customer.subscription.updated",
        data: {
          object: {
            customer: "cus_1",
            items: { data: [{ price: { product: "prod_U8rS2fR6KvQoRk" } }] },
            status: "active",
          },
        },
      });
      stripeMock.customers.retrieve.mockRejectedValue(new Error("stripe down"));
      return fn.fetch(webhookRequest(fn, "{}"));
    }

    it("pages ops when the idempotency rollback DELETE matches zero rows", async () => {
      // The delete reports success with an empty row set — the exact shape a
      // no-op DELETE returns from PostgREST.
      scenario.writeSelectRows["stripe_webhook_events:delete"] = [];

      const res = await runHandlerFailure();
      expect(res.status).toBe(500);

      // BEFORE the fix this produced NO alert at all: the delete's result was
      // never inspected, so a rollback that removed nothing was silent and the
      // paid event was stranded with no signal anywhere.
      const zeroRowAlert = slackAlerts.find((a) =>
        String((a as { title?: string }).title ?? "").includes("rollback matched 0 rows"),
      ) as { severity?: string; fields?: Record<string, string> } | undefined;
      expect(zeroRowAlert).toBeDefined();
      expect(zeroRowAlert?.severity).toBe("critical");
      // The alert has to name the event, or an operator cannot find the row.
      expect(zeroRowAlert?.fields?.["Event ID"]).toBe("evt_zero_rollback");
    });

    it("stays quiet about the rollback when the DELETE actually removes the row", async () => {
      scenario.writeSelectRows["stripe_webhook_events:delete"] = [
        { event_id: "evt_zero_rollback" },
      ];

      const res = await runHandlerFailure();
      expect(res.status).toBe(500);

      // A successful rollback must not page — otherwise every ordinary handler
      // failure would fire a critical alert and the alert would get muted.
      expect(
        slackAlerts.filter((a) =>
          String((a as { title?: string }).title ?? "").includes("rollback"),
        ),
      ).toHaveLength(0);
    });

    it("asks the rollback DELETE for `event_id`, the only key this table has", async () => {
      // The mock store resolves a write's `.select()` by table name and hands
      // back whatever the scenario seeded, regardless of projection — so the two
      // tests above would pass just as happily on `.select("id")`. They cannot:
      // `stripe_webhook_events` is `event_id TEXT PRIMARY KEY` with no `id`
      // column, verified against prod (`?select=id` → 400, `?select=event_id`
      // → 200). Asking for `id` would turn every rollback into a hard 400 and a
      // permanent false "rollback FAILED" page. So assert the projection itself.
      scenario.writeSelectRows["stripe_webhook_events:delete"] = [];
      await runHandlerFailure();

      const rollback = scenario.writes.find(
        (w) => w.table === "stripe_webhook_events" && w.op === "delete",
      );
      expect(rollback?.selectCols).toBe("event_id");
    });
  });
});
