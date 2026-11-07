// @mutate supabase/functions/stripe-webhook/handlers/customerSubscriptionUpdated.ts |         subscription_source: "stripe", |         // source dropped
// @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | const updateData: any = { subscription_tier: tier, subscription_source: "stripe" }; | const updateData: any = { subscription_tier: tier };
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
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, resetSharedMocks, notificationEmails } from "./mocks/shared";
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


// Split 2026-11-07 (lander): stripe-webhook.test.ts was one 5,100-line file whose single worker hit the
// heap limit in CI (m1 #4217 shard 1/6, twice); this file holds transfers, gift cards, unknown kinds, memberships, fail-closed errors, recurring visits and livemode. Same tests, no assertion changed.
describe("stripe-webhook edge function", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
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
      // Q444: never a crew job: only the payout cron's roster gate releases one.
      // @mutate supabase/functions/stripe-webhook/handlers/transferCreated.ts |         .not("is_group_job", "is", true)\n        .select("id") |         .select("id")
      expect(jobWrite?.filters).toContainEqual({ op: "not", column: "is_group_job", operator: "is", value: true });
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
        // Q1797: a Stripe grant says Stripe is the authority, so Manage opens
        // the Stripe portal even for a former Apple member.
        subscription_source: "stripe",
      });
    });

    it("Q1797: a Stripe checkout tier grant stamps subscription_source 'stripe' (source pin)", async () => {
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");
      const { blankComments } = await import("../helpers/blankNonCode");
      const src = blankComments(readFileSync(resolve(__dirname, "../../../supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts"), "utf8"));
      expect(src).toMatch(/const updateData: any = \{ subscription_tier: tier, subscription_source: "stripe" \};/);
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

/*
 * Q210(b): a $300+ recurring visit is paid on-session through a Checkout of
 * kind "recurring_visit". Money that cannot be booked is refunded, never kept.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts |   else if (!row) refundReason = "payment row not found"; |   else if (false) refundReason = "payment row not found";
 * @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts |   } else if (meta?.payer_id !== row.payer_id) { |   } else if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts |   } else if ((session.currency ?? "").toLowerCase() !== "usd") { |   } else if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts |   else if (row.status !== "pending") refundReason | else if (false) refundReason
 *
 * Q843: a TAXED visit's amount_total equals amount_cents (the tax is in both),
 * and a short payment is still refunded.
 * @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts |   else if (session.amount_total !== row.amount_cents) { |   else if (false) {
 * Q750 (4): a payment for a series that is over is refunded in full, never marked paid.
 * @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts |   else if (seriesOver) refundReason | else if (false) refundReason
 * @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts | seriesOver = !parent \|\| Boolean(parent.series_ended_on) \|\| parent.status === "cancelled"; | seriesOver = !parent \|\| Boolean(parent.series_ended_on);
 * @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts | seriesOver = !parent \|\| Boolean(parent.series_ended_on) \|\| parent.status === "cancelled"; | seriesOver = !parent \|\| parent.status === "cancelled";
 * @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts |     if (seriesOver \|\| dateUnheld) {\n      const { error: expErr } |     if (false) {\n      const { error: expErr }
 * @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts |     if (parentErr) throw | if (false) throw
 * Q2071: a payment for a date nobody holds any more (released) is refunded in full and the row expired.
 * @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts |   else if (dateUnheld) refundReason | else if (false) refundReason
 * @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts |     dateUnheld = (holds ?? []).length === 0; |     dateUnheld = false;
 * @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts |     if (seriesOver \|\| dateUnheld) { |     if (seriesOver) {
 * @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts |     if (holdErr) throw | if (false) throw
 * @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts |       .eq("visit_date", row.visit_date)\n      .limit(1); |       .limit(1);
 * Q750 (3): a retried refund Stripe answers "already refunded" is done, not a page.
 * @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts |     const maybeDone = err?.code === "charge_already_refunded" \|\| | const maybeDone =
 * @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts |     if (!live) throw e; |     if (!live) return { alreadyRefunded: true, refund: { id: null, amount: null } };
 */
describe("stripe-webhook: recurring_visit Checkout (Q210b)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
    // The series the row belongs to: live unless a test says otherwise.
    scenario.reads.jobs = { rows: [{ id: "parent-1", series_ended_on: null, status: "in_progress" }] };
    // Q2071: the date is still held by a Helpr unless a test says otherwise.
    scenario.reads.series_visit_holds = { rows: [{ id: "hold-1" }] };
    // Q1714: Stripe answers a refund with its id; the payer's notice is claimed on it.
    stripeMock.refunds.create.mockResolvedValue({ id: "re_rv", amount: 31500, status: "succeeded" });
  });

  const ROW = {
    id: "rvp-1",
    parent_job_id: "parent-1",
    visit_date: "2026-10-01",
    status: "pending",
    amount_cents: 31500,
    payer_id: "poster-1",
    stripe_payment_intent_id: null,
  };

  async function deliver(meta: Record<string, string>, over: Record<string, unknown> = {}) {
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: `evt_rv_${Math.random()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_rv",
          mode: "payment",
          payment_status: "paid",
          payment_intent: "pi_rv",
          amount_total: 31500,
          currency: "usd",
          metadata: { kind: "recurring_visit", ...meta },
          ...over,
        },
      },
    });
    return fn.fetch(webhookRequest(fn, "{}"));
  }

  const flips = () =>
    scenario.writes.filter((w) => w.table === "recurring_visit_payments" && w.op === "update");

  it("marks a pending row paid when payer, amount and currency match", async () => {
    scenario.reads.recurring_visit_payments = { rows: [ROW] };
    scenario.writeSelectRows.recurring_visit_payments = [{ id: "rvp-1" }];
    const kick = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", kick);
    try {
      const res = await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" });
      expect(res.status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }
    expect((flips()[0]?.payload as Record<string, unknown>).status).toBe("paid");
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    // Books the paid visit now, narrowed to this series.
    expect(String((kick.mock.calls[0] as unknown[])?.[0])).toContain("/functions/v1/charge-recurring-visits?parentJobId=parent-1");
  });

  it("refunds a paid session that carries no row id", async () => {
    await deliver({ payer_id: "poster-1" });
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_rv" },
      { idempotencyKey: "recurring-visit-refund:pi_rv" },
    );
    expect(flips()).toHaveLength(0);
  });

  it("refunds a paid session whose row id matches no row", async () => {
    scenario.reads.recurring_visit_payments = { rows: [] };
    await deliver({ recurring_visit_payment_id: "rvp-missing", payer_id: "poster-1" });
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(flips()).toHaveLength(0);
  });

  it("refunds when the session's payer is not the row's payer", async () => {
    scenario.reads.recurring_visit_payments = { rows: [ROW] };
    await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "someone-else" });
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(flips()).toHaveLength(0);
  });

  it("refunds a non-usd payment", async () => {
    scenario.reads.recurring_visit_payments = { rows: [ROW] };
    await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" }, { currency: "eur" });
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(flips()).toHaveLength(0);
  });

  it("refunds a payment for a row the sweep already expired", async () => {
    scenario.reads.recurring_visit_payments = { rows: [{ ...ROW, status: "expired" }] };
    await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" });
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(flips()).toHaveLength(0);
  });

  // ── Q843 (verified 2026-10-03): a taxed visit is NOT refunded ─────────────
  // charge-recurring-visits parks amount_cents = budget + fee + tax (DB CHECK
  // recurring_visit_payments_amount_adds_up), and create-payment charges the
  // tax as its own line with automatic_tax off, so Stripe's amount_total for a
  // taxed visit is exactly amount_cents.
  const TAXED = { ...ROW, amount_cents: 30000 + 1500 + 2925 };

  it("Q843: a taxed visit whose total includes the tax line is marked paid, not refunded", async () => {
    scenario.reads.recurring_visit_payments = { rows: [TAXED] };
    scenario.writeSelectRows.recurring_visit_payments = [{ id: "rvp-1" }];
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}")));
    try {
      const res = await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" }, { amount_total: 34425 });
      expect(res.status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect((flips()[0]?.payload as Record<string, unknown>).status).toBe("paid");
  });

  it("Q843: a taxed visit paid WITHOUT its tax (total short of amount_cents) is refunded", async () => {
    scenario.reads.recurring_visit_payments = { rows: [TAXED] };
    await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" }, { amount_total: 31500 });
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_rv" },
      { idempotencyKey: "recurring-visit-refund:pi_rv" },
    );
    expect(flips()).toHaveLength(0);
  });

  // ── Q750 (4): ending or cancelling the series leaves its Checkout open ────
  // A payment that still lands is refunded IN FULL at once (the platform left
  // the Checkout open), the row stops asking to be paid, and nothing is booked.
  // On main it was marked paid and held until the visit-date sweep returned it
  // less the card fee.
  const statusWrites = () =>
    flips().map((w) => (w.payload as Record<string, unknown>).status);

  it("Q750 (4): a payment for an ENDED series is refunded in full and its row expired, never marked paid", async () => {
    scenario.reads.recurring_visit_payments = { rows: [ROW] };
    scenario.reads.jobs = { rows: [{ id: "parent-1", series_ended_on: "2026-09-30", status: "in_progress" }] };
    scenario.writeSelectRows.recurring_visit_payments = [{ id: "rvp-1" }];
    const kick = vi.fn(async (_url: unknown, _init?: unknown) => new Response("{}"));
    vi.stubGlobal("fetch", kick);
    try {
      const res = await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" });
      expect(res.status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_rv" },
      { idempotencyKey: "recurring-visit-refund:pi_rv" },
    );
    expect(statusWrites()).toEqual(["expired"]);
    const expire = flips()[0];
    expect(expire.filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "status", value: "pending" })]));
    // No booking kick (the refund's email, Q1714, is the only call).
    expect(kick.mock.calls.filter((c) => String(c[0]).includes("charge-recurring-visits"))).toHaveLength(0);
  });

  it("Q750 (4): a payment for a series whose parent was CANCELLED is refunded in full, never marked paid", async () => {
    scenario.reads.recurring_visit_payments = { rows: [ROW] };
    scenario.reads.jobs = { rows: [{ id: "parent-1", series_ended_on: null, status: "cancelled" }] };
    scenario.writeSelectRows.recurring_visit_payments = [{ id: "rvp-1" }];
    await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" });
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(statusWrites()).toEqual(["expired"]);
  });

  // ── Q2071: a RELEASED date (no Helpr holds it) leaves its Checkout open ──
  // A payment that still lands is refunded IN FULL at once and the row expired;
  // on main it was marked paid, and the visit-date sweep returned it less the
  // card fee (a fee lost to a release the payer did not make).
  it("Q2071: a payment for a date nobody holds any more is refunded in full and its row expired, never marked paid", async () => {
    scenario.reads.recurring_visit_payments = { rows: [ROW] };
    scenario.reads.series_visit_holds = { rows: [] };
    scenario.writeSelectRows.recurring_visit_payments = [{ id: "rvp-1" }];
    const kick = vi.fn(async (_url: unknown, _init?: unknown) => new Response("{}"));
    vi.stubGlobal("fetch", kick);
    try {
      const res = await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" });
      expect(res.status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      { payment_intent: "pi_rv" },
      { idempotencyKey: "recurring-visit-refund:pi_rv" },
    );
    expect(statusWrites()).toEqual(["expired"]);
    expect(flips()[0].filters).toEqual(expect.arrayContaining([expect.objectContaining({ column: "status", value: "pending" })]));
    // The hold was asked for this row's own series and date.
    const holdRead = scenario.readQueries.find((r) => r.table === "series_visit_holds");
    expect(holdRead?.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: "parent_job_id", value: "parent-1" }),
      expect.objectContaining({ column: "visit_date", value: "2026-10-01" }),
    ]));
    expect(kick.mock.calls.filter((c) => String(c[0]).includes("charge-recurring-visits"))).toHaveLength(0);
  });

  it("Q2071: an unreadable hold is retried by Stripe (500), neither marked paid nor refunded", async () => {
    scenario.reads.recurring_visit_payments = { rows: [ROW] };
    scenario.reads.series_visit_holds = { error: { message: "boom", code: "XX000" } };
    const res = await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" });
    expect(res.status).toBe(500);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(flips()).toHaveLength(0);
  });

  it("Q750 (4): an unreadable series is retried by Stripe (500), neither marked paid nor refunded", async () => {
    scenario.reads.recurring_visit_payments = { rows: [ROW] };
    scenario.reads.jobs = { error: { message: "boom", code: "XX000" } };
    const res = await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" });
    expect(res.status).toBe(500);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(flips()).toHaveLength(0);
  });

  // ── Q750 (3): what Stripe answers to a refund that already happened ───────
  // Within 24h the same key + params replays the first refund. After that a
  // second full refund is refused with code `charge_already_refunded`
  // (docs.stripe.com/error-codes, read 2026-10-03). That is done, not a
  // "refund by hand" page plus a 500 that makes Stripe redeliver for 3 days.
  /** The handler's own "refund failed, refund by hand" page. */
  const refundFailedPages = () =>
    slackAlerts.filter((a) => JSON.stringify(a).includes("the refund failed"));
  const alreadyRefunded = () =>
    Object.assign(new Error("Charge ch_1 has already been refunded."), {
      type: "StripeInvalidRequestError",
      code: "charge_already_refunded",
    });

  it("Q750 (3): a retried delivery whose refund Stripe calls 'already refunded' is acknowledged, not paged", async () => {
    scenario.reads.recurring_visit_payments = { rows: [{ ...ROW, status: "expired" }] };
    stripeMock.refunds.create.mockRejectedValue(alreadyRefunded());
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_1", status: "succeeded", amount: 31500 }] });
    const res = await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" });
    expect(res.status).toBe(200);
    expect(stripeMock.refunds.list).toHaveBeenCalledWith({ payment_intent: "pi_rv", limit: 100 });
    expect(refundFailedPages()).toHaveLength(0);
  });

  it("Q750 (3): 'already refunded' with no live refund on the intent is still a failed refund (paged, retried)", async () => {
    scenario.reads.recurring_visit_payments = { rows: [{ ...ROW, status: "expired" }] };
    stripeMock.refunds.create.mockRejectedValue(alreadyRefunded());
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_1", status: "failed", amount: 31500 }] });
    const res = await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" });
    expect(res.status).toBe(500);
    expect(refundFailedPages()).toHaveLength(1);
  });

  it("Q750 (3): any other refund error is still a failed refund (paged, retried)", async () => {
    scenario.reads.recurring_visit_payments = { rows: [{ ...ROW, status: "expired" }] };
    stripeMock.refunds.create.mockRejectedValue(Object.assign(new Error("charge disputed"), { type: "StripeInvalidRequestError", code: "charge_disputed" }));
    const res = await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" });
    expect(res.status).toBe(500);
    // Listed once BEFORE the refund (Q1248 replay check), never re-read after a
    // refusal that is not "already refunded".
    expect(stripeMock.refunds.list).toHaveBeenCalledTimes(1);
    expect(refundFailedPages()).toHaveLength(1);
  });

  // ── Q1247 (a): the payer hears about a refund from us ─────────────────────
  // On main every refund branch refunded and paged ops but wrote the payer
  // nothing: the money came back with no word. Each branch is driven here.
  // Q1714: the notice is THE refund notice (_shared/refundNotice.ts), in the
  // app and by email, claimed on the refund's id.
  // @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts |   if (result.status === "sent" \|\| result.status === "dropped") return { told: true, alreadyTold: false }; |   if (false) return { told: true, alreadyTold: false };
  // @mutate supabase/functions/_shared/refundNotice.ts |       if (!seedErr && seed === true) return { status: "dropped" }; |       return { status: "dropped" };
  const payerNotices = () =>
    scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert")
      .map((w) => w.payload as Record<string, unknown>);
  const refundBranches: Array<[string, () => void, Record<string, string>, Record<string, unknown>]> = [
    ["no row id", () => {}, { payer_id: "poster-1" }, {}],
    ["row not found", () => { scenario.reads.recurring_visit_payments = { rows: [] }; }, { recurring_visit_payment_id: "rvp-x", payer_id: "poster-1" }, {}],
    ["row already expired", () => { scenario.reads.recurring_visit_payments = { rows: [{ ...ROW, status: "expired" }] }; }, { recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" }, {}],
    ["series ended", () => {
      scenario.reads.recurring_visit_payments = { rows: [ROW] };
      scenario.reads.jobs = { rows: [{ id: "parent-1", series_ended_on: "2026-09-30", status: "in_progress" }] };
    }, { recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" }, {}],
    ["amount mismatch", () => { scenario.reads.recurring_visit_payments = { rows: [ROW] }; }, { recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" }, { amount_total: 100 }],
    ["non-usd", () => { scenario.reads.recurring_visit_payments = { rows: [ROW] }; }, { recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" }, { currency: "eur" }],
    ["payer mismatch", () => { scenario.reads.recurring_visit_payments = { rows: [ROW] }; }, { recurring_visit_payment_id: "rvp-1", payer_id: "someone-else" }, {}],
    ["lost the race with the sweep", () => {
      scenario.reads.recurring_visit_payments = { rows: [ROW] };
      scenario.writeSelectRows.recurring_visit_payments = [];
    }, { recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" }, {}],
  ];
  for (const [label, arrange, meta, over] of refundBranches) {
    it(`Q1247 (a): a refund because of "${label}" tells the payer it was refunded`, async () => {
      arrange();
      scenario.writeSelectRows.notifications = [{ id: "n1" }];
      const res = await deliver(meta, over);
      expect(res.status).toBe(200);
      expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
      const notices = payerNotices();
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({ user_id: meta.payer_id, title: "Refund issued: $315", type: "payment" });
      expect(String(notices[0].message)).toContain("refund reference re_rv");
      // ONE email, the same words, and one claim on the refund.
      expect(notificationEmails).toHaveLength(1);
      expect(notificationEmails[0]).toMatchObject({ user_id: meta.payer_id, title: "Refund issued: $315", type: "payment" });
      expect(scenario.writes.filter((w) => w.table === "refund_notices" && w.op === "insert").map((w) => (w.payload as { notice_key: string }).notice_key)).toEqual(["refund:re_rv"]);
      // Only the row's own payer sees the row's series and date.
      if (label === "payer mismatch") expect(notices[0].job_id).toBeNull();
      expect(JSON.stringify(slackAlerts)).toContain("refunded in full");
      expect(JSON.stringify(slackAlerts)).not.toContain("could NOT be told");
    });
  }

  it("Q1247 (a): a retried delivery (refund already done) does not tell the payer twice", async () => {
    scenario.reads.recurring_visit_payments = { rows: [{ ...ROW, status: "expired" }] };
    // The earlier delivery's notice for this payment is there.
    scenario.reads.notifications = { rows: [{ id: "n-earlier" }] };
    stripeMock.refunds.create.mockRejectedValue(alreadyRefunded());
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_1", status: "succeeded", amount: 31500 }] });
    await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" });
    expect(payerNotices()).toHaveLength(0);
    expect(JSON.stringify(slackAlerts)).not.toContain("paid but not bookable");
  });

  // Second lh-money-escrow review of Q1248: a first delivery that refunded and
  // died before the notice must not leave the payer untold on its retry.
  // @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts |   if (!priorErr && (prior ?? []).length > 0) return { told: true, alreadyTold: true }; |   return { told: true, alreadyTold: true };
  it("Q1248 review: a retry after a run that refunded but never told the payer tells them, and warns ops", async () => {
    scenario.reads.recurring_visit_payments = { rows: [{ ...ROW, status: "expired" }] };
    scenario.reads.notifications = { rows: [] };
    scenario.writeSelectRows.notifications = [{ id: "n1" }];
    stripeMock.refunds.create.mockRejectedValue(alreadyRefunded());
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_1", status: "succeeded", amount: 31500 }] });
    await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" });
    expect(payerNotices()).toHaveLength(1);
    // Q1714 review N6: the refund's id rides in the link beside the payment's.
    expect(String(payerNotices()[0].link)).toBe("/posts?visit_refund=pi_rv&refund=re_1");
    expect(JSON.stringify(slackAlerts)).toContain("paid but not bookable");
  });

  // Q1248: within the key's 24h Stripe replays the first refund as a success.
  // A redelivered event must not tell the payer, or warn ops, a second time.
  // @mutate supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts |     const replayed = Boolean(created?.id) && (before ?? []).includes(created.id); |     const replayed = false;
  it("Q1248: two deliveries of one refunded payment post exactly one warning and one payer notice", async () => {
    scenario.reads.recurring_visit_payments = { rows: [{ ...ROW, status: "expired" }] };
    scenario.writeSelectRows.notifications = [{ id: "n1" }];
    const refund = { id: "re_once", status: "succeeded", amount: 31500 };
    // First delivery: nothing refunded yet; Stripe creates re_once.
    stripeMock.refunds.list.mockResolvedValueOnce({ data: [] });
    stripeMock.refunds.create.mockResolvedValue(refund);
    await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" });
    // Redelivery within 24h: the intent already carries re_once, Stripe
    // replays it for the same key, and the first delivery's notice is there.
    stripeMock.refunds.list.mockResolvedValueOnce({ data: [refund] });
    scenario.reads.notifications = { rows: [{ id: "n1" }] };
    await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" });

    const warnings = slackAlerts.filter((a) => JSON.stringify(a).includes("paid but not bookable"));
    expect(warnings).toHaveLength(1);
    expect(payerNotices()).toHaveLength(1);
  });

  it("Q1247 (a) review: the payer is told even when the row write after the refund fails (Stripe retries it)", async () => {
    scenario.reads.recurring_visit_payments = { rows: [ROW] };
    scenario.reads.jobs = { rows: [{ id: "parent-1", series_ended_on: "2026-09-30", status: "in_progress" }] };
    scenario.writeSelectRows.notifications = [{ id: "n1" }];
    scenario.writeErrors.recurring_visit_payments = { message: "boom", code: "XX000" };
    const res = await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" });
    expect(res.status).toBe(500);
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(payerNotices()).toHaveLength(1);
  });

  it("Q1247 (a) review: a second payment for a visit already paid says so, not 'couldn't be booked'", async () => {
    scenario.reads.recurring_visit_payments = { rows: [{ ...ROW, status: "paid", stripe_payment_intent_id: "pi_first" }] };
    scenario.writeSelectRows.notifications = [{ id: "n1" }];
    await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" });
    expect(String(payerNotices()[0]?.message)).toContain("was already paid, so we refunded the second payment");
  });

  it("Q1247 (a): a notice that could not be written is named in the ops alert", async () => {
    scenario.reads.recurring_visit_payments = { rows: [{ ...ROW, status: "expired" }] };
    scenario.writeSelectRows.notifications = [];
    scenario.rpc.notification_crosses_seed_boundary = false;
    await deliver({ recurring_visit_payment_id: "rvp-1", payer_id: "poster-1" });
    expect(JSON.stringify(slackAlerts)).toContain("could NOT be told");
  });
});

/*
 * Q891 item 4: a correctly signed event can still belong to the OTHER Stripe
 * mode. Nothing in the handlers tells the two apart, so index.ts decides it
 * before the dedupe row is written. Before this check a livemode:false event
 * under the live key (a test-mode endpoint left pointed at the function) was
 * processed like any other.
 *
 * @mutate supabase/functions/stripe-webhook/index.ts | keyMode !== "UNKNOWN" && eventMode !== "UNKNOWN" && keyMode !== eventMode | false
 * @mutate supabase/functions/stripe-webhook/index.ts | if (keyMode === "LIVE") { | if (keyMode !== "LIVE") {
 * @mutate supabase/functions/stripe-webhook/index.ts |     });\n    return webhookRejectResponse("livemode_mismatch"); |     });\n    return new Response(JSON.stringify({ received: true }), { status: 200 });
 * @mutate supabase/functions/stripe-webhook/index.ts | oncePerDayKey: "stripe-webhook-live-event-test-key", | oncePerDayKey: undefined,
 * @mutate supabase/functions/_shared/stripeWebhookReject.ts | livemode_mismatch: 400, | livemode_mismatch: 200,
 */
describe("stripe-webhook rejects an event whose livemode differs from the key's mode (Q891)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  async function loadWithKey(key: string): Promise<EdgeHarness> {
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: key,
      STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
    });
    return loadEdgeFunction("stripe-webhook");
  }

  const event = (livemode: boolean | undefined) => ({
    id: "evt_mode",
    type: "tax.settings.updated",
    ...(livemode === undefined ? {} : { livemode }),
    data: { object: {} },
  });

  it("LIVE key + TEST event: acked 200 but NOT processed, no dedupe row, no alert", async () => {
    const fn = await loadWithKey("sk_live_abc");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue(event(false));
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a) => { logs.push(String(a[0])); });
    try {
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ received: true, ignored: "livemode_mismatch" });
    } finally {
      spy.mockRestore();
    }
    expect(scenario.writes).toHaveLength(0);
    expect(slackAlerts).toHaveLength(0);
    const line = logs.find((l) => l.includes("stripe_webhook_livemode_mismatch"));
    expect(JSON.parse(line ?? "{}")).toMatchObject({ key_mode: "LIVE", event_mode: "TEST", event_id: "evt_mode" });
  });

  it("TEST key + LIVE event: REFUSED 400 (Stripe retries), nothing processed, paged once a day", async () => {
    const fn = await loadWithKey("sk_test_abc");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue(event(true));
    const res = await fn.fetch(webhookRequest(fn, "{}"));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("livemode_mismatch");
    expect(scenario.writes).toHaveLength(0);
    const alert = slackAlerts.find((a) => /LIVE event but runs a TEST key/.test(String((a as { title?: string }).title ?? ""))) as
      | { kind: string; severity: string; oncePerDayKey?: string }
      | undefined;
    expect(alert?.kind).toBe("stripe_webhook_error");
    expect(alert?.severity).toBe("critical");
    expect(alert?.oncePerDayKey).toBe("stripe-webhook-live-event-test-key");
  });

  it("matching modes still process: LIVE key + LIVE event writes the dedupe row", async () => {
    const fn = await loadWithKey("sk_live_abc");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue(event(true));
    const res = await fn.fetch(webhookRequest(fn, "{}"));
    expect(res.status).toBe(200);
    expect((await json(res)).received).toBe(true);
    expect(scenario.writes.some((w) => w.table === "stripe_webhook_events" && w.op === "insert")).toBe(true);
  });

  it("an event with no boolean livemode is not judged (old path)", async () => {
    const fn = await loadWithKey("sk_live_abc");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue(event(undefined));
    const res = await fn.fetch(webhookRequest(fn, "{}"));
    expect(res.status).toBe(200);
    expect(scenario.writes.some((w) => w.table === "stripe_webhook_events" && w.op === "insert")).toBe(true);
  });
});
