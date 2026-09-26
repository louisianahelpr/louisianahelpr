/**
 * Unit tests for the `stripe-webhook` Supabase edge function.
 *
 * This webhook is the inbound side of every Stripe-driven state change:
 * checkout completion (escrow funding, tips, boosts, onboarding-fee
 * collection), subscription lifecycle, payment failures, refunds, Connect
 * account updates, and payout transfer settlement.
 *
 * Critical, previously-untested invariants exercised here:
 *   - A delivery it could not verify (bad signature, no signature, missing
 *     key or signing secret) is REFUSED with a non-2xx and never acknowledged,
 *     so Stripe keeps the event and retries it (docs/OPEN.md Q156: the old
 *     200 dropped a real delivery on 2026-09-23 12:43:27Z). Stripe's retries
 *     are bounded per event, so this is not a retry storm.
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

  /*
   * Q156: nothing it could not verify is ever acknowledged. Each of these used
   * to answer 200 "to stop Stripe retrying", which is how a genuine delivery
   * was dropped on 2026-09-23 12:43:27Z with nothing left to replay.
   *
   * @mutate supabase/functions/_shared/stripeWebhookReject.ts | stripe_key_not_configured: 500, | stripe_key_not_configured: 200,
   * @mutate supabase/functions/_shared/stripeWebhookReject.ts | webhook_secret_not_configured: 500, | webhook_secret_not_configured: 200,
   * @mutate supabase/functions/_shared/stripeWebhookReject.ts | missing_signature_header: 400, | missing_signature_header: 200,
   * @mutate supabase/functions/stripe-webhook/index.ts | return webhookRejectResponse("webhook_secret_not_configured"); | return new Response("{}", { status: 200 });
   */
  describe("misconfiguration is refused (non-2xx), never acknowledged", () => {
    it("returns 500 when STRIPE_SECRET_KEY is not set, and pages ops", async () => {
      setEnv({ SUPABASE_URL: "https://x.test", STRIPE_WEBHOOK_SECRET: "whsec_x" });
      const fn = await loadEdgeFunction("stripe-webhook");
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(500);
      expect((await json(res)).error).toBe("stripe_key_not_configured");
      expect((slackAlerts[0] as { severity?: string }).severity).toBe("critical");
    });

    it("returns 500 when STRIPE_WEBHOOK_SECRET is missing, and pages ops", async () => {
      setEnv({
        SUPABASE_URL: "https://x.test",
        SUPABASE_SERVICE_ROLE_KEY: "svc",
        STRIPE_SECRET_KEY: "sk_test_abc",
      });
      const fn = await loadEdgeFunction("stripe-webhook");
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(500);
      expect((await json(res)).error).toBe("webhook_secret_not_configured");
      expect((slackAlerts[0] as { severity?: string }).severity).toBe("critical");
    });

    it("returns 400 when the stripe-signature header is absent, and writes nothing", async () => {
      const fn = await loadConfigured();
      const res = await fn.fetch(fn.request({ rawBody: "{}" }));
      expect(res.status).toBe(400);
      expect((await json(res)).error).toBe("missing_signature_header");
      expect(stripeMock.webhooks.constructEventAsync).not.toHaveBeenCalled();
      expect(scenario.writes).toHaveLength(0);
    });

    it("OPTIONS preflight returns 200 with CORS", async () => {
      const fn = await loadConfigured();
      const res = await fn.fetch(fn.request({ method: "OPTIONS" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  /*
   * Q156, the incident itself: a real Stripe delivery (3524 bytes, header
   * t=1790167406,v1=…) failed verification and was answered 200, so Stripe
   * recorded a success and never sent it again.
   *
   * @mutate supabase/functions/_shared/stripeWebhookReject.ts | signature_verification_failed: 400, | signature_verification_failed: 200,
   * @mutate supabase/functions/stripe-webhook/index.ts | return webhookRejectResponse("signature_verification_failed"); | return new Response(JSON.stringify({ received: true, error: "signature_verification_failed" }), { status: 200 });
   * @mutate supabase/functions/_shared/stripeWebhookReject.ts | severity: "critical" as const, | severity: "warning" as const,
   * @mutate supabase/functions/_shared/stripeWebhookReject.ts | claimedLivemode = typeof j.livemode === "boolean" ? j.livemode : null; | claimedLivemode = null;
   * @mutate supabase/functions/stripe-webhook/index.ts | await postSlackOpsAlert(\n      signatureFailureAlert({\n        fn: "stripe-webhook", | void (\n      signatureFailureAlert({\n        fn: "stripe-webhook",
   */
  describe("signature verification", () => {
    it("REFUSES a bad signature with 400 (so Stripe retries), writes nothing, and pages ops naming the event", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockRejectedValue(
        new Error("No signatures found matching the expected signature"),
      );
      const res = await fn.fetch(
        webhookRequest(
          fn,
          '{"id":"evt_q156","type":"account.updated","livemode":true}',
          "t=1790167406,v1=5803cc6d86f73d12",
        ),
      );
      expect(res.status).toBe(400);
      expect(res.status >= 200 && res.status < 300).toBe(false);
      expect((await json(res)).error).toBe("signature_verification_failed");
      // Nothing from an unverified body is processed: the dedupe insert is the
      // first write, so zero writes proves it stopped at the signature.
      expect(scenario.writes).toHaveLength(0);

      // A critical alert (which opens an ops_alert_ledger item) naming what the
      // delivery claims to be, so it can be found in Stripe and resent.
      const alert = slackAlerts.find((a) =>
        /signature failed/i.test(String((a as { title?: string }).title ?? "")),
      ) as
        | { kind: string; severity: string; oncePerDayKey?: string; fields: Record<string, unknown> }
        | undefined;
      expect(alert?.kind).toBe("stripe_webhook_error");
      expect(alert?.severity).toBe("critical");
      expect(alert?.fields["Claimed event (unverified)"]).toBe("evt_q156");
      expect(alert?.fields["Claimed livemode (unverified)"]).toBe("true");
      expect(alert?.fields["Key mode"]).toBe("TEST");
      expect(alert?.fields["Signature schemes"]).toBe("t,v1");
      expect(String(alert?.fields.Error)).toMatch(/No signatures found/);
      // Stripe retries a refused event; the page goes out once a day, the
      // ledger still counts every occurrence.
      expect(alert?.oncePerDayKey).toBe("stripe-webhook:signature_verification_failed");
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
    /*
     * ME-043: a taxable category billed to Louisiana that Stripe taxed at $0
     * looked identical to the correct $0 on an exempt job. It now alerts.
     *
     * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | if (taxedZeroOnTaxableLouisianaLabor(sessionTaxCents, | if (false && taxedZeroOnTaxableLouisianaLabor(sessionTaxCents,
     */
    describe("taxable labor taxed $0 in Louisiana (ME-043)", () => {
      async function deliver(category: string, meta: Record<string, string> = {}, state = "LA") {
        const fn = await loadConfigured();
        scenario.reads.jobs = { rows: [{ id: "job-tax", budget: 100, category, is_seed: false }] };
        // The PI carries NO amount_details: the signal must come from the
        // session's own total_details, which Checkout always fills.
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_tax" });
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({
          id: `evt_tax_${category}_${state}`,
          type: "checkout.session.completed",
          data: {
            object: {
              id: "cs_tax",
              livemode: false,
              mode: "payment",
              customer_email: "poster@test.com",
              customer_details: { address: { state } },
              total_details: { amount_tax: 0 },
              payment_intent: "pi_tax",
              metadata: { job_id: "job-tax", ...meta },
            },
          },
        });
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
        return (slackAlerts as Array<{ title: string }>).filter((a) => /\$0 Louisiana sales tax/.test(a.title));
      }

      it("alerts on an assembly job billed to LA with $0 tax", async () => {
        const alerts = await deliver("assembly");
        expect(alerts).toHaveLength(1);
        expect((alerts[0] as unknown as { oncePerDayKey: string }).oncePerDayKey).toBe("taxable-zero-tax:test");
      });

      it("stays quiet on an exempt category, a non-LA address, and a gift-card shortfall", async () => {
        expect(await deliver("yard_work")).toHaveLength(0);
        resetSharedMocks();
        expect(await deliver("assembly", {}, "TX")).toHaveLength(0);
        resetSharedMocks();
        expect(await deliver("assembly", { gift_card_id: "gc-1" })).toHaveLength(0);
      });
    });

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

    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | if (pi.metadata?.type === "tip") return; | 
    it("a declined TIP never touches the job or tells the poster their job payment failed", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_tip_fail",
        type: "payment_intent.payment_failed",
        data: {
          object: {
            id: "pi_tip_failed",
            receipt_email: "poster@test.com",
            // auto-tip-charge carries job_id on its PaymentIntent for the receipt.
            metadata: { type: "tip", source: "auto", job_id: "job-1" },
          },
        },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job" }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(scenario.writes.find((w) => w.table === "jobs" && w.op === "update")).toBeUndefined();
      expect(scenario.writes.find((w) => w.table === "notifications")).toBeUndefined();
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
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "escrow" }],
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

  describe("charge.dispute.closed restores the pre-dispute payment state", () => {
    // charge.dispute.created blocks only a PAYABLE job (escrow or
    // payout_pending) by flipping it to 'chargeback'. A dismissed inquiry used
    // to write payout_pending back unconditionally, so a job whose work was not
    // done yet (escrow) landed in a state no sweep reads: auto-release-payment
    // only takes escrow, process-scheduled-payouts only takes completed jobs
    // with a payout_scheduled_at. Stranded.
    function closedEvent(id: string, status: string) {
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id,
        type: "charge.dispute.closed",
        data: {
          object: { id: `dp_${id}`, status, amount: 5000, payment_intent: "pi_disputed", charge: "ch_d" },
        },
      });
    }
    function unblockWrite() {
      return scenario.writes.find(
        (w) =>
          w.table === "jobs" &&
          w.op === "update" &&
          "payment_status" in (w.payload as Record<string, unknown>),
      );
    }

    it("dismissed on an in_progress job (work not done) returns it to escrow", async () => {
      const fn = await loadConfigured();
      closedEvent("evt_wc_escrow", "warning_closed");
      scenario.reads.jobs = {
        rows: [{
          id: "job-ip", customer_id: "p", helper_id: "h", title: "Job",
          dispute_status: "stripe_chargeback", disputed_at: "2026-09-12T00:00:00.000Z",
          payment_status: "chargeback", status: "in_progress", payout_scheduled_at: null,
        }],
      };
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      const w = unblockWrite();
      expect((w?.payload as Record<string, unknown>).payment_status).toBe("escrow");
      expect((w?.payload as Record<string, unknown>).disputed_at).toBeNull();
      // Still a compare-and-set on the block, and the row count is observable.
      expect(w?.filters).toContainEqual({ op: "eq", column: "payment_status", value: "chargeback" });
      expect(w?.selectCols).toBe("id");
    });

    it("dismissed on a completed job with its payout scheduled returns it to payout_pending", async () => {
      const fn = await loadConfigured();
      closedEvent("evt_wc_pp", "warning_closed");
      scenario.reads.jobs = {
        rows: [{
          id: "job-done", customer_id: "p", helper_id: "h", title: "Job",
          dispute_status: "stripe_chargeback", disputed_at: "2026-09-12T00:00:00.000Z",
          payment_status: "chargeback", status: "completed",
          payout_scheduled_at: "2026-09-13T00:00:00.000Z",
        }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      expect((unblockWrite()?.payload as Record<string, unknown>).payment_status).toBe("payout_pending");
    });

    it("a completed job with no payout schedule (hand-released, transfer re-queued) still returns to payout_pending", async () => {
      const fn = await loadConfigured();
      closedEvent("evt_wc_pp_nosched", "warning_closed");
      scenario.reads.jobs = {
        rows: [{
          id: "job-requeued", customer_id: "p", helper_id: "h", title: "Job",
          dispute_status: "stripe_chargeback", disputed_at: "2026-09-12T00:00:00.000Z",
          payment_status: "chargeback", status: "completed", payout_scheduled_at: null,
        }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      expect((unblockWrite()?.payload as Record<string, unknown>).payment_status).toBe("payout_pending");
    });

    it("the admin notice names the restored state (escrow is not a payout unblock)", async () => {
      const fn = await loadConfigured();
      closedEvent("evt_wc_notice", "warning_closed");
      scenario.reads.jobs = {
        rows: [{
          id: "job-notice", customer_id: "p", helper_id: "h", title: "Job",
          dispute_status: "stripe_chargeback", disputed_at: "2026-09-12T00:00:00.000Z",
          payment_status: "chargeback", status: "accepted", payout_scheduled_at: null,
        }],
      };
      scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
      await fn.fetch(webhookRequest(fn, "{}"));
      const notices = scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert"
        && (w.payload as Record<string, unknown>).user_id === "admin-1");
      expect(notices).toHaveLength(1);
      expect((notices[0].payload as Record<string, unknown>).title).toMatch(/escrow/i);
      expect((notices[0].payload as Record<string, unknown>).title).not.toMatch(/payout/i);
    });

    it("pages ops when the unblock matches zero rows on a job that was read as chargeback", async () => {
      const fn = await loadConfigured();
      closedEvent("evt_wc_zero", "warning_closed");
      scenario.reads.jobs = {
        rows: [{
          id: "job-moved", customer_id: "p", helper_id: "h", title: "Job",
          dispute_status: "stripe_chargeback", disputed_at: "2026-09-12T00:00:00.000Z",
          payment_status: "chargeback", status: "in_progress", payout_scheduled_at: null,
        }],
      };
      scenario.writeSelectRows.jobs = [];
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(
        slackAlerts.some((a) => /unblock matched no row/i.test((a as { title: string }).title)),
      ).toBe(true);
    });

    it("a LOST dispute leaves payment_status untouched", async () => {
      const fn = await loadConfigured();
      closedEvent("evt_lost", "lost");
      scenario.reads.jobs = {
        rows: [{
          id: "job-lost", customer_id: "p", helper_id: "h", title: "Job",
          dispute_status: "stripe_chargeback", disputed_at: "2026-09-12T00:00:00.000Z",
          payment_status: "chargeback", status: "in_progress", payout_scheduled_at: null,
        }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(unblockWrite()).toBeUndefined();
      const outcome = scenario.writes.find((w) => w.table === "jobs" && w.op === "update");
      expect((outcome?.payload as Record<string, unknown>).dispute_status).toBe("dispute_lost");
    });
  });

  // OPEN.md (HIGH, d7a04acb9): charge.dispute.created overwrote dispute_status
  // and disputed_at whatever hold was already on the job, and a dismissed
  // inquiry (warning_closed) then cleared disputed_at — the only guard
  // process-scheduled-payouts has. Two ways that paid out wrongly:
  //   (1) a decided internal dispute whose split never ran (rpc_decide_dispute
  //       sets dispute_status='resolved' and leaves disputed_at) went back to
  //       payout_pending with no hold: Helpr paid in full, poster never refunded;
  //   (2) a transferReversed 'reversal_hold' job lost its hold and was re-payable.
  describe("a card dispute never lifts a hold it did not place", () => {
    const HELD_AT = "2026-09-10T00:00:00.000Z";

    function createdEvent(id: string) {
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id,
        type: "charge.dispute.created",
        data: {
          object: {
            id: `dp_${id}`, status: "warning_needs_response", amount: 5000, reason: "general",
            payment_intent: "pi_disputed", charge: "ch_d",
          },
        },
      });
    }
    function closedEvent(id: string, status: string) {
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id,
        type: "charge.dispute.closed",
        data: {
          object: { id: `dp_${id}`, status, amount: 5000, payment_intent: "pi_disputed", charge: "ch_d" },
        },
      });
    }
    const jobUpdates = () => scenario.writes.filter((w) => w.table === "jobs" && w.op === "update");
    const payloadOf = (w: { payload: unknown }) => w.payload as Record<string, unknown>;
    const criticalAlerts = () =>
      (slackAlerts as Array<{ severity?: string; title: string }>).filter((a) => a.severity === "critical");

    describe("charge.dispute.created", () => {
      it("(1) blocks the payout on a job with a decided internal dispute but keeps its dispute_status and disputed_at", async () => {
        const fn = await loadConfigured();
        createdEvent("evt_cb_decided");
        scenario.reads.jobs = {
          rows: [{
            id: "job-decided", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "escrow",
            dispute_status: "resolved", disputed_at: HELD_AT,
          }],
        };
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
        const block = jobUpdates().find((w) => "payment_status" in payloadOf(w));
        expect(payloadOf(block!).payment_status).toBe("chargeback");
        expect(block?.filters).toContainEqual({ op: "in", column: "payment_status", value: ["payout_pending", "escrow"] });
        expect(block?.selectCols).toBe("id");
        for (const w of jobUpdates()) {
          expect(payloadOf(w)).not.toHaveProperty("dispute_status");
          expect(payloadOf(w)).not.toHaveProperty("disputed_at");
        }
      });

      it("(2) blocks the payout on a reversal_hold job but keeps the reversal hold", async () => {
        const fn = await loadConfigured();
        createdEvent("evt_cb_reversal");
        scenario.reads.jobs = {
          rows: [{
            id: "job-reversed", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "payout_pending",
            dispute_status: "reversal_hold", disputed_at: HELD_AT,
          }],
        };
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(jobUpdates().some((w) => payloadOf(w).payment_status === "chargeback")).toBe(true);
        for (const w of jobUpdates()) {
          expect(payloadOf(w)).not.toHaveProperty("dispute_status");
          expect(payloadOf(w)).not.toHaveProperty("disputed_at");
        }
      });

      it("normal path: an unheld payable job gets the block and the chargeback markers, each as a conditional write", async () => {
        const fn = await loadConfigured();
        createdEvent("evt_cb_plain");
        scenario.reads.jobs = {
          rows: [{
            id: "job-plain", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "payout_pending",
            dispute_status: null, disputed_at: null,
          }],
        };
        await fn.fetch(webhookRequest(fn, "{}"));
        const block = jobUpdates().find((w) => "payment_status" in payloadOf(w));
        expect(payloadOf(block!).payment_status).toBe("chargeback");
        const markers = jobUpdates().find((w) => "dispute_status" in payloadOf(w));
        expect(payloadOf(markers!).dispute_status).toBe("stripe_chargeback");
        expect(typeof payloadOf(markers!).disputed_at).toBe("string");
        // Never over an internal status: only null-with-no-hold, or a status the
        // card-dispute handlers own themselves.
        const guard = markers?.filters.find((f) => f.op === "or");
        expect(String(guard?.value)).toContain("and(dispute_status.is.null,disputed_at.is.null)");
        expect(String(guard?.value)).toContain("dispute_status.in.(");
        expect(String(guard?.value)).not.toMatch(/resolved|reversal_hold|open|escalated/);
        expect(markers?.selectCols).toBe("id");
      });
    });

    describe("charge.dispute.closed (warning_closed)", () => {
      it("(1) keeps disputed_at and pages ops critical when a decided dispute has not executed", async () => {
        const fn = await loadConfigured();
        closedEvent("evt_wc_decided", "warning_closed");
        // The shape the OLD created handler left behind: dispute_status
        // overwritten to stripe_chargeback. Only the disputes row still knows.
        scenario.reads.jobs = {
          rows: [{
            id: "job-decided", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: "2026-09-09T00:00:00.000Z",
            dispute_status: "stripe_chargeback", disputed_at: HELD_AT,
          }],
        };
        scenario.reads.disputes = {
          rows: [{ id: "disp-1", execution_status: "pending", payout_split: { poster: 0.5, helper: 0.5 } }],
        };
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
        for (const w of jobUpdates()) {
          if ("disputed_at" in payloadOf(w)) expect(payloadOf(w).disputed_at).not.toBeNull();
        }
        expect(criticalAlerts().some((a) => /hold/i.test(a.title))).toBe(true);
      });

      it("(1) keeps an internal 'resolved' dispute_status: the outcome is not written over it", async () => {
        const fn = await loadConfigured();
        closedEvent("evt_wc_decided_new", "warning_closed");
        scenario.reads.jobs = {
          rows: [{
            id: "job-decided", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: null,
            dispute_status: "resolved", disputed_at: HELD_AT,
          }],
        };
        scenario.reads.disputes = { rows: [{ id: "disp-1", execution_status: "failed", payout_split: null }] };
        await fn.fetch(webhookRequest(fn, "{}"));
        for (const w of jobUpdates()) {
          expect(payloadOf(w)).not.toHaveProperty("dispute_status");
          expect(payloadOf(w)).not.toHaveProperty("dispute_resolved_at");
          if ("disputed_at" in payloadOf(w)) expect(payloadOf(w).disputed_at).not.toBeNull();
        }
        expect(criticalAlerts().some((a) => /hold/i.test(a.title))).toBe(true);
      });

      it("(2) keeps disputed_at and pages ops critical when the job has a reversed transfer", async () => {
        const fn = await loadConfigured();
        closedEvent("evt_wc_reversed", "warning_closed");
        scenario.reads.jobs = {
          rows: [{
            id: "job-reversed", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: "2026-09-09T00:00:00.000Z",
            dispute_status: "stripe_chargeback", disputed_at: HELD_AT,
          }],
        };
        scenario.reads.payout_transfers = {
          rows: [{ id: "pt-1", status: "reversed", stripe_transfer_id: "tr_rev" }],
        };
        await fn.fetch(webhookRequest(fn, "{}"));
        for (const w of jobUpdates()) {
          if ("disputed_at" in payloadOf(w)) expect(payloadOf(w).disputed_at).not.toBeNull();
        }
        expect(criticalAlerts().some((a) => /hold/i.test(a.title))).toBe(true);
      });

      it("(2) a reversal_hold job keeps its dispute_status", async () => {
        const fn = await loadConfigured();
        closedEvent("evt_wc_reversal_hold", "warning_closed");
        scenario.reads.jobs = {
          rows: [{
            id: "job-reversed", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: "2026-09-09T00:00:00.000Z",
            dispute_status: "reversal_hold", disputed_at: HELD_AT,
          }],
        };
        scenario.reads.payout_transfers = {
          rows: [{ id: "pt-1", status: "reversed", stripe_transfer_id: "tr_rev" }],
        };
        await fn.fetch(webhookRequest(fn, "{}"));
        for (const w of jobUpdates()) {
          expect(payloadOf(w)).not.toHaveProperty("dispute_status");
          if ("disputed_at" in payloadOf(w)) expect(payloadOf(w).disputed_at).not.toBeNull();
        }
      });

      it("fails closed (500, Stripe retries) when the hold lookup cannot be read", async () => {
        const fn = await loadConfigured();
        closedEvent("evt_wc_hold_read_err", "warning_closed");
        scenario.reads.jobs = {
          rows: [{
            id: "job-x", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: null,
            dispute_status: "stripe_chargeback", disputed_at: HELD_AT,
          }],
        };
        scenario.reads.payout_transfers = { error: { message: "boom" } };
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(500);
        expect(jobUpdates().some((w) => payloadOf(w).disputed_at === null)).toBe(false);
      });

      it("normal path: no internal hold → restores the payment state and clears disputed_at, CAS on a chargeback-owned status", async () => {
        const fn = await loadConfigured();
        closedEvent("evt_wc_plain", "warning_closed");
        scenario.reads.jobs = {
          rows: [{
            id: "job-plain", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: "2026-09-09T00:00:00.000Z",
            dispute_status: "stripe_chargeback", disputed_at: HELD_AT,
          }],
        };
        await fn.fetch(webhookRequest(fn, "{}"));
        const unblock = jobUpdates().find((w) => "payment_status" in payloadOf(w));
        expect(payloadOf(unblock!).payment_status).toBe("payout_pending");
        expect(payloadOf(unblock!).disputed_at).toBeNull();
        expect(unblock?.filters).toContainEqual({ op: "eq", column: "payment_status", value: "chargeback" });
        expect(String(unblock?.filters.find((f) => f.op === "or")?.value)).toMatch(/^dispute_status\.in\.\(/);
        expect(unblock?.selectCols).toBe("id");
        expect(criticalAlerts()).toHaveLength(0);
      });
    });

    it("normal path: a LOST dispute records dispute_lost on a chargeback-owned job, conditionally", async () => {
      const fn = await loadConfigured();
      closedEvent("evt_lost_plain", "lost");
      scenario.reads.jobs = {
        rows: [{
          id: "job-lost", customer_id: "p", helper_id: "h", title: "Job",
          status: "completed", payment_status: "chargeback", payout_scheduled_at: null,
          dispute_status: "stripe_chargeback", disputed_at: HELD_AT,
        }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      const outcome = jobUpdates().find((w) => "dispute_status" in payloadOf(w));
      expect(payloadOf(outcome!).dispute_status).toBe("dispute_lost");
      expect(outcome?.selectCols).toBe("id");
      expect(jobUpdates().some((w) => "payment_status" in payloadOf(w) || "disputed_at" in payloadOf(w))).toBe(false);
    });
  });

  // lh-money-escrow review of the fix above (2026-09-14): B1's cheap extra, N1,
  // N2, N5.
  describe("card dispute holds — review follow-ups", () => {
    const HELD_AT = "2026-09-10T00:00:00.000Z";
    function event(id: string, type: string, object: Record<string, unknown>) {
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({ id, type, data: { object } });
    }
    const disputeObj = (id: string, status: string) => ({
      id: `dp_${id}`, status, amount: 5000, reason: "general", payment_intent: "pi_disputed", charge: "ch_d",
    });
    const jobUpdates = () => scenario.writes.filter((w) => w.table === "jobs" && w.op === "update");
    const payloadOf = (w: { payload: unknown }) => w.payload as Record<string, unknown>;
    const alerts = () => slackAlerts as Array<{ severity?: string; title: string; message: string; oncePerDayKey?: string }>;
    // Admin notices only: the Helpr's own (ME-009) are asserted in
    // chargebackHeldPayoutNotice.test.ts.
    const notices = () =>
      scenario.writes
        .filter((w) => w.table === "notifications" && w.op === "insert")
        .map((w) => w.payload as { user_id: string; title: string; message: string })
        .filter((n) => n.user_id !== "h");

    describe("B1: an open or escalated internal dispute is a hold on dismissal", () => {
      it("a job still in status 'disputed' (legacy stripe_chargeback overwrite) keeps disputed_at and pages", async () => {
        const fn = await loadConfigured();
        event("evt_b1_disputed", "charge.dispute.closed", disputeObj("b1d", "warning_closed"));
        scenario.reads.jobs = {
          rows: [{
            id: "job-esc", customer_id: "p", helper_id: "h", title: "Job",
            status: "disputed", payment_status: "chargeback", payout_scheduled_at: null,
            dispute_status: "stripe_chargeback", disputed_at: HELD_AT,
          }],
        };
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(jobUpdates().some((w) => "disputed_at" in payloadOf(w) && payloadOf(w).disputed_at === null)).toBe(false);
        expect(alerts().some((a) => a.severity === "critical" && /hold/i.test(a.title))).toBe(true);
      });

      it("an OPEN disputes row keeps disputed_at and pages", async () => {
        const fn = await loadConfigured();
        event("evt_b1_open", "charge.dispute.closed", disputeObj("b1o", "warning_closed"));
        scenario.reads.jobs = {
          rows: [{
            id: "job-open", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: "2026-09-09T00:00:00.000Z",
            dispute_status: "stripe_chargeback", disputed_at: HELD_AT,
          }],
        };
        scenario.reads.disputes = {
          rows: [],
          selectOverrides: [{ includes: "opener_id", result: { rows: [{ id: "disp-open", status: "open", opener_id: "p" }] } }],
        };
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(jobUpdates().some((w) => "disputed_at" in payloadOf(w) && payloadOf(w).disputed_at === null)).toBe(false);
        expect(alerts().some((a) => a.severity === "critical" && /hold/i.test(a.title))).toBe(true);
      });

      it("an internal 'escalated' dispute_status is a hold", async () => {
        const fn = await loadConfigured();
        event("evt_b1_esc", "charge.dispute.closed", disputeObj("b1e", "warning_closed"));
        scenario.reads.jobs = {
          rows: [{
            id: "job-esc2", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: null,
            dispute_status: "escalated", disputed_at: HELD_AT,
          }],
        };
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(alerts().some((a) => a.severity === "critical" && /hold/i.test(a.title))).toBe(true);
      });
    });

    describe("N1: a settled internal dispute is not a hold", () => {
      it("dismissal on an auto_resolved job: no hold page, and the admin notice does not say 'on hold'", async () => {
        const fn = await loadConfigured();
        event("evt_n1_wc", "charge.dispute.closed", disputeObj("n1wc", "warning_closed"));
        scenario.reads.jobs = {
          rows: [{
            id: "job-ar", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: "2026-09-09T00:00:00.000Z",
            dispute_status: "auto_resolved", disputed_at: null,
          }],
        };
        scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(alerts().some((a) => a.severity === "critical")).toBe(false);
        expect(notices()).toHaveLength(1);
        expect(notices()[0].title).not.toMatch(/hold/i);
        expect(alerts().some((a) => /hold was kept/i.test(a.message))).toBe(false);
      });

      it("won on an auto_resolved job tells admins to release the payout (not to withhold it)", async () => {
        const fn = await loadConfigured();
        event("evt_n1_won", "charge.dispute.closed", disputeObj("n1won", "won"));
        scenario.reads.jobs = {
          rows: [{
            id: "job-ar", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: null,
            dispute_status: "auto_resolved", disputed_at: null,
          }],
        };
        scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(notices()).toHaveLength(1);
        expect(notices()[0].title).toMatch(/release/i);
        expect(notices()[0].message).not.toMatch(/do not release/i);
      });

      it("won on a job with a real hold says so, and does not tell admins to release", async () => {
        const fn = await loadConfigured();
        event("evt_n1_won_held", "charge.dispute.closed", disputeObj("n1wonh", "won"));
        scenario.reads.jobs = {
          rows: [{
            id: "job-rh", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: null,
            dispute_status: "reversal_hold", disputed_at: HELD_AT,
          }],
        };
        scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(notices()).toHaveLength(1);
        expect(notices()[0].title).not.toMatch(/release Helpr payout/i);
        expect(notices()[0].message).toMatch(/hold/i);
      });
    });

    describe("N2: a released job with a live card dispute still gets a marker release-payout refuses", () => {
      it("created on a released job with a SETTLED internal status places stripe_chargeback, CAS on that status", async () => {
        const fn = await loadConfigured();
        event("evt_n2_rel", "charge.dispute.created", disputeObj("n2rel", "needs_response"));
        scenario.reads.jobs = {
          rows: [{
            id: "job-rel", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "released",
            dispute_status: "resolved", disputed_at: HELD_AT,
          }],
        };
        await fn.fetch(webhookRequest(fn, "{}"));
        const marker = jobUpdates().find((w) => "dispute_status" in payloadOf(w));
        expect(payloadOf(marker!).dispute_status).toBe("stripe_chargeback");
        expect(marker?.filters).toContainEqual({ op: "or", column: "", value: "dispute_status.eq.resolved" });
        expect(marker?.selectCols).toBe("id");
        // Q202: the only payment_status write on a released job is the
        // clawback's CAS released -> chargeback (chargebackClawback.test.ts);
        // the payable-set block (escrow/payout_pending) never touches it.
        const paymentWrites = jobUpdates().filter((w) => "payment_status" in payloadOf(w));
        expect(paymentWrites).toHaveLength(1);
        expect(payloadOf(paymentWrites[0]).payment_status).toBe("chargeback");
        expect(paymentWrites[0].filters).toContainEqual({ op: "eq", column: "payment_status", value: "released" });
      });

      it("created on a released 'resolved' job whose split has NOT executed leaves the markers alone", async () => {
        const fn = await loadConfigured();
        event("evt_n2_rel_held", "charge.dispute.created", disputeObj("n2relh", "needs_response"));
        scenario.reads.jobs = {
          rows: [{
            id: "job-rel", customer_id: "p", helper_id: "h", title: "Job", payout_scheduled_at: null,
            status: "completed", payment_status: "released",
            dispute_status: "resolved", disputed_at: HELD_AT,
          }],
        };
        scenario.reads.disputes = { rows: [{ id: "disp-1", execution_status: "pending", payout_split: null }] };
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(jobUpdates().some((w) => "dispute_status" in payloadOf(w))).toBe(false);
      });

      for (const type of ["transfer.failed", "transfer.canceled"]) {
        it(`${type} does not move a job with a live dispute back to payout_pending, and pages`, async () => {
          const fn = await loadConfigured();
          event(`evt_n2_${type}`, type, { id: "tr_bad", amount: 5000, destination: "acct_helper", failure_message: "closed" });
          scenario.writeSelectRows.payout_transfers = [{ job_id: "job-cb" }];
          scenario.reads.jobs = {
            rows: [{ id: "job-cb", status: "completed", payment_status: "released", dispute_status: "stripe_chargeback", disputed_at: HELD_AT }],
          };
          const res = await fn.fetch(webhookRequest(fn, "{}"));
          expect(res.status).toBe(200);
          expect(jobUpdates().some((w) => payloadOf(w).payment_status === "payout_pending")).toBe(false);
          expect(alerts().some((a) => a.severity === "critical" && /dispute/i.test(a.title))).toBe(true);
        });

        it(`${type} still re-queues a job with no dispute (normal path)`, async () => {
          const fn = await loadConfigured();
          event(`evt_n2_ok_${type}`, type, { id: "tr_bad", amount: 5000, destination: "acct_helper", failure_message: "closed" });
          scenario.writeSelectRows.payout_transfers = [{ job_id: "job-ok" }];
          scenario.reads.jobs = {
            rows: [{ id: "job-ok", status: "completed", payment_status: "released", dispute_status: null, disputed_at: null }],
          };
          await fn.fetch(webhookRequest(fn, "{}"));
          expect(jobUpdates().some((w) => payloadOf(w).payment_status === "payout_pending")).toBe(true);
        });
      }
    });

    it("N5: the hold-read failure page is deduped per job per day", async () => {
      const fn = await loadConfigured();
      event("evt_n5", "charge.dispute.closed", disputeObj("n5", "warning_closed"));
      scenario.reads.jobs = {
        rows: [{
          id: "job-n5", customer_id: "p", helper_id: "h", title: "Job",
          status: "completed", payment_status: "chargeback", payout_scheduled_at: null,
          dispute_status: "stripe_chargeback", disputed_at: HELD_AT,
        }],
      };
      scenario.reads.payout_transfers = { error: { message: "boom" } };
      await fn.fetch(webhookRequest(fn, "{}"));
      const page = alerts().find((a) => /hold check failed/i.test(a.title));
      expect(page?.oncePerDayKey).toContain("job-n5");
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

  describe("gift_card_purchase checkout", () => {
    it("returns 500 + rolls back idempotency row when gift_cards idempotency check fails (DB error)", async () => {
      // Regression: the handler used to `return` instead of `throw` on a transient
      // gift_cards DB error. That returned 200 to Stripe (event marked processed,
      // idempotency row kept), so Stripe stopped retrying and the credit was never
      // minted — donor paid, recipient got nothing.
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_gift_card_idem_err",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_gift_1",
            mode: "payment",
            customer_email: "donor@test.com",
            metadata: {
              kind: "gift_card_purchase",
              donor_id: "user-donor-1",
              donor_name: "Jane",
              recipient_email: "recipient@test.com",
              amount_cents: "5000",
              category: "Any",
            },
          },
        },
      });
      // Simulate a transient DB error on the gift_cards idempotency look-up.
      scenario.reads.gift_cards = { error: { message: "connection timeout" } };
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

  describe("unknown checkout kind", () => {
    it("alerts ops instead of silently skipping a paid session no branch handles", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_unknown_kind",
        type: "checkout.session.completed",
        data: { object: { id: "cs_unknown_1", mode: "payment", customer_email: "buyer@test.com", amount_total: 2500, metadata: { kind: "retired_kind" } } },
      });
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(
        slackAlerts.some((a) => JSON.stringify(a).includes("unknown kind") && JSON.stringify(a).includes("retired_kind")),
      ).toBe(true);
    });

    it("does not alert for a known kind", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_known_kind",
        type: "checkout.session.completed",
        data: { object: { id: "cs_boost_1", mode: "payment", customer_email: "buyer@test.com", metadata: { kind: "job_boost" } } },
      });
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(slackAlerts.some((a) => JSON.stringify(a).includes("unknown kind"))).toBe(false);
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

// Proof this guard can fail (scripts/vacuity). Deleting the signature check —
// parsing the attacker-supplied body as a verified Stripe event — must turn the
// "bad signature" case red. A webhook whose signature verification can be
// removed with every test still green is the worst possible hollow guard.
// @mutate supabase/functions/stripe-webhook/index.ts | return await stripe.webhooks.constructEventAsync(body, sig, secret); | return JSON.parse(body) as Stripe.Event;
