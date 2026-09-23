/**
 * A refunded or charged-back GIFT CARD donation must stop being spendable.
 *
 * THE BUG THIS CLASS GUARDS (audited 2026-09-22):
 *   `charge.refunded`, `charge.dispute.created` and `charge.dispute.closed` all
 *   resolved the affected record by `jobs.stripe_payment_intent_id`. A gift
 *   donation's PaymentIntent is written ONLY to
 *   `gift_cards.stripe_payment_intent_id` and never reaches `jobs`, so every one
 *   of them found no row and silently no-op'd. The credit kept
 *   `payment_status = 'paid'` — exactly what `redeem_gift_card` requires — and
 *   stayed fully spendable. A gift-funded job carries no Stripe charge, so
 *   `release-payout` pays the helper from the PLATFORM BALANCE: a donor could
 *   charge back $500 and the platform would fund the helper out of its own
 *   money plus the chargeback fee, with no alert and no ledger row.
 *
 * These run the REAL handler source through the edge harness; only Stripe,
 * Supabase, Slack and the Deno runtime are doubled. The assertions are on
 * BEHAVIOUR (was the revocation RPC actually called with this PI? did the
 * webhook 500 so Stripe retries?), never on the presence of a string.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, sendGiftCardEmail, resetSharedMocks } from "./mocks/shared";

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
  return loadEdgeFunction("stripe-webhook");
}

function webhookRequest(fn: EdgeHarness, rawBody: string, sig = "t=1,v1=abc") {
  return fn.request({
    rawBody,
    headers: { "stripe-signature": sig, "content-type": "application/json" },
  });
}

/** What the RPC returns for a donation with unspent credit and nothing spent. */
const UNSPENT = {
  outcome: "revoked",
  reason: "refund",
  credit_id: "gc-1",
  tree_size: 2,
  revoked_count: 2,
  revoked_cents: 7500,
  spent_count: 0,
  spent_cents: 0,
  spent_job_ids: [],
};

/** What it returns when part of the donation already funded a real job. */
const PARTLY_SPENT = {
  ...UNSPENT,
  revoked_count: 1,
  revoked_cents: 2500,
  spent_count: 1,
  spent_cents: 5000,
  spent_job_ids: ["job-abc"],
};

function revokeCalls() {
  return (scenario.rpcCalls ?? []).filter(
    (c) => c.name === "revoke_gift_card_for_refund",
  );
}

function criticalAlerts() {
  return (slackAlerts as Array<{ severity?: string; title: string }>).filter(
    (a) => a.severity === "critical",
  );
}

describe("a reversed gift-card charge revokes the credit", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("charge.refunded (full) asks the DB to revoke the gift behind that PaymentIntent", async () => {
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_gift_refund",
      type: "charge.refunded",
      data: {
        object: { id: "ch_g", payment_intent: "pi_gift_1", amount: 7500, amount_refunded: 7500 },
      },
    });
    scenario.rpc.revoke_gift_card_for_refund = UNSPENT;
    // No job carries this PI — that is the whole point of the bug.
    scenario.reads.jobs = { rows: [] };

    await fn.fetch(webhookRequest(fn, "{}"));

    const calls = revokeCalls();
    expect(calls).toHaveLength(1);
    expect((calls[0].args as Record<string, unknown>).p_payment_intent_id).toBe("pi_gift_1");
  });

  it("charge.dispute.created revokes too — Stripe has already pulled the money", async () => {
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_gift_dispute",
      type: "charge.dispute.created",
      data: {
        object: {
          id: "dp_1",
          charge: "ch_g",
          payment_intent: "pi_gift_2",
          amount: 7500,
          reason: "fraudulent",
          status: "needs_response",
        },
      },
    });
    scenario.rpc.revoke_gift_card_for_refund = UNSPENT;
    scenario.reads.jobs = { rows: [] };

    await fn.fetch(webhookRequest(fn, "{}"));

    const calls = revokeCalls();
    expect(calls).toHaveLength(1);
    expect((calls[0].args as Record<string, unknown>).p_payment_intent_id).toBe("pi_gift_2");
  });

  it("pages ops CRITICAL when the reversal lands after the credit was already spent", async () => {
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_gift_spent",
      type: "charge.refunded",
      data: {
        object: { id: "ch_g", payment_intent: "pi_gift_3", amount: 7500, amount_refunded: 7500 },
      },
    });
    scenario.rpc.revoke_gift_card_for_refund = PARTLY_SPENT;
    scenario.reads.jobs = { rows: [] };

    await fn.fetch(webhookRequest(fn, "{}"));

    // The platform is out of pocket for the spent half and nobody is clawing it
    // back off the helper, so this must be a page, not a log line.
    expect(
      criticalAlerts().some((a) => /gift card charge reversed/i.test(a.title)),
    ).toBe(true);
  });

  it("stays silent for an ordinary job refund — no gift, no alert", async () => {
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_job_refund",
      type: "charge.refunded",
      data: {
        object: { id: "ch_j", payment_intent: "pi_job_1", amount: 5000, amount_refunded: 5000 },
      },
    });
    // The RPC's answer for "this PaymentIntent is not a gift".
    scenario.rpc.revoke_gift_card_for_refund = { outcome: "no_gift" };
    scenario.reads.jobs = { rows: [{ id: "job-1", customer_id: "poster-1", title: "Job" }] };

    await fn.fetch(webhookRequest(fn, "{}"));

    expect(
      (slackAlerts as Array<{ title: string }>).some((a) => /gift card/i.test(a.title)),
    ).toBe(false);
    // …and the normal job path still ran.
    const jobWrite = scenario.writes.find((w) => w.table === "jobs" && w.op === "update");
    expect((jobWrite?.payload as Record<string, unknown>).payment_status).toBe("refunded");
  });

  it("returns 500 so Stripe RETRIES when the revocation itself fails", async () => {
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_gift_rpcfail",
      type: "charge.refunded",
      data: {
        object: { id: "ch_g", payment_intent: "pi_gift_4", amount: 7500, amount_refunded: 7500 },
      },
    });
    // Not PGRST202 — a real DB failure. Swallowing it would ack 200 and leave a
    // refunded donation spendable forever with no retry path.
    scenario.rpcErrors = {
      revoke_gift_card_for_refund: { message: "deadlock detected", code: "40P01" },
    };
    scenario.reads.jobs = { rows: [] };

    const res = await fn.fetch(webhookRequest(fn, "{}"));
    expect(res.status).toBe(500);
  });
});

// Each directive must kill this guard on its own.
//
// 1+2: delete the revocation call from each handler — precisely the pre-fix
//      code, where a gift PI reached a `jobs` lookup that could never match it.
// 3:   swallow a hard RPC failure instead of throwing, so the webhook 200-acks
//      a donation whose credit is still spendable.
// @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | await revokeGiftCardForRefund(supabase, refundPiId, "refund", logStep); |
// @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeCreated.ts | await revokeGiftCardForRefund(supabase, disputePiId, "chargeback", logStep); |
// @mutate supabase/functions/stripe-webhook/handlers/_giftCardRefund.ts | throw new Error(\n      `revoke_gift_card_for_refund failed for ${paymentIntentId}: ${error.message}`,\n    ); | return NO_GIFT;

/**
 * The gift claim email must reach the RETRYING queue, not a one-shot send.
 *
 * `sendGiftCardEmail` used to call Resend directly from inside the webhook:
 * no retry, no `email_send_log` row, and — since there is no resend path
 * anywhere in the codebase and no admin gift surface — no way to ever try
 * again. The only trace of a failure was a `logStep` line. That is worse here
 * than almost anywhere else in the product: the headline use of this feature is
 * gifting somebody with no account, whose `recipient_id` is therefore null, so
 * the in-app notification is skipped and this email is the ONLY delivery
 * channel. One transient blip meant the donor was charged and the gift was
 * invisible forever.
 *
 * It now takes the supabase client and routes through `queueEmail`. The edge
 * harness replaces the giftCardEmail module wholesale (it imports npm:react and
 * renders a react-email template), so what is asserted here is the WIRING that
 * makes queueing possible — the client actually reaching the helper. The
 * queue behaviour itself is `queueEmail`'s own, already exercised by the
 * send-notification-email path.
 */
describe("the gift claim email is handed a client so it can queue", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("passes a supabase client as the first argument, not the options object", async () => {
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_gift_mint",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_gift_1",
          mode: "payment",
          payment_intent: "pi_gift_mint",
          customer_email: "donor@example.com",
          metadata: {
            kind: "gift_card_purchase",
            donor_id: "donor-1",
            donor_name: "Donor",
            recipient_email: "newperson@example.com",
            amount_cents: "5000",
          },
        },
      },
    });
    // Nobody holds that address yet — the recipient_id-null case, where the
    // email is the only channel there is.
    scenario.reads.profiles = { rows: [] };
    scenario.reads.gift_cards = { rows: [] };

    await fn.fetch(webhookRequest(fn, "{}"));

    expect(sendGiftCardEmail).toHaveBeenCalled();
    const [first, second] = sendGiftCardEmail.mock.calls[0] as [unknown, Record<string, unknown>];
    // A supabase client, not the options bag.
    expect(first).toBeTruthy();
    expect(typeof (first as { from?: unknown })?.from).toBe("function");
    // …and the options still arrive intact in the second slot.
    expect(second?.recipientEmail).toBe("newperson@example.com");
    expect(second?.claimToken).toBeTruthy();
  });
});

// @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | const emailed = await sendGiftCardEmail(supabase, { | const emailed = await sendGiftCardEmail({

/**
 * Q139: a SEED (test) donor's gift is never emailed to a real person.
 *
 * The gift email goes to an ADDRESS, outside both Q137 choke points (the
 * notifications trigger and send-notification-email). With no account behind
 * the address the recipient is an unknown person, so it is treated as real.
 */
describe("Q139: a seed donor's gift email never reaches a real person", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  const giftEvent = (id: string) => ({
    id,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_${id}`,
        mode: "payment",
        payment_intent: `pi_${id}`,
        customer_email: "donor@example.com",
        metadata: {
          kind: "gift_card_purchase",
          donor_id: "donor-1",
          donor_name: "Donor",
          recipient_email: "newperson@example.com",
          amount_cents: "5000",
        },
      },
    },
  });

  it("a seed donor to an address with no account: minted, NOT emailed", async () => {
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue(giftEvent("evt_seed_gift"));
    // Nobody holds the address; the donor's own profile answers is_seed.
    scenario.reads.profiles = {
      rows: [],
      selectOverrides: [{ includes: "is_seed", result: { rows: [{ is_seed: true }] } }],
    };
    scenario.reads.gift_cards = { rows: [] };

    await fn.fetch(webhookRequest(fn, "{}"));

    expect(scenario.writes.some((w) => w.table === "gift_cards")).toBe(true);
    expect(sendGiftCardEmail).not.toHaveBeenCalled();
  });

  it("a real donor: emailed exactly as before", async () => {
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue(giftEvent("evt_real_gift"));
    scenario.reads.profiles = {
      rows: [],
      selectOverrides: [{ includes: "is_seed", result: { rows: [{ is_seed: false }] } }],
    };
    scenario.reads.gift_cards = { rows: [] };

    await fn.fetch(webhookRequest(fn, "{}"));

    expect(sendGiftCardEmail).toHaveBeenCalledTimes(1);
  });

  it("a recipient WITH an account: the trigger's own question, donor as actor", async () => {
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue(giftEvent("evt_acct_gift"));
    scenario.reads.profiles = { rows: [{ user_id: "recipient-1" }] };
    scenario.reads.gift_cards = { rows: [] };
    scenario.rpc.notification_crosses_seed_boundary = true;

    await fn.fetch(webhookRequest(fn, "{}"));

    const asked = (scenario.rpcCalls ?? []).filter((c) => c.name === "notification_crosses_seed_boundary");
    expect(asked.map((c) => c.args)).toEqual([
      { p_recipient: "recipient-1", p_job_id: null, p_link: null, p_actor: "donor-1" },
    ]);
    expect(sendGiftCardEmail).not.toHaveBeenCalled();
    // The in-app row names the donor, so the trigger judges it the same way.
    const note = scenario.writes.find((w) => w.table === "notifications" && w.op === "insert");
    expect((note?.payload as { link?: string })?.link).toBe("/profile?tab=gift_card&user=donor-1");
  });

  it("a check that cannot answer: NOT emailed, and ops is paged", async () => {
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue(giftEvent("evt_check_down"));
    scenario.reads.profiles = {
      rows: [],
      selectOverrides: [{ includes: "is_seed", result: { error: { message: "connection timeout" } } }],
    };
    scenario.reads.gift_cards = { rows: [] };

    await fn.fetch(webhookRequest(fn, "{}"));

    expect(sendGiftCardEmail).not.toHaveBeenCalled();
    expect(slackAlerts.some((a) => JSON.stringify(a).includes("Gift card email withheld"))).toBe(true);
  });
});

/**
 * An INQUIRY is not a chargeback.
 *
 * Stripe delivers inquiries and early-fraud warnings through the same
 * `charge.dispute.created` event, with a `warning_*` status, and they withdraw
 * NOTHING from the platform balance. Revocation is deliberately one-way — even
 * a WON dispute is not auto-restored, because un-revoking is a mint and a
 * redelivered event would repeat it — so revoking on an inquiry destroys a live
 * gift permanently over a question the bank may never turn into a chargeback.
 */
describe("an inquiry does not destroy the gift", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  function disputeEvent(status: string, id: string) {
    return {
      id,
      type: "charge.dispute.created",
      data: {
        object: {
          id: "dp_x",
          charge: "ch_g",
          payment_intent: "pi_gift_inq",
          amount: 7500,
          reason: "fraudulent",
          status,
        },
      },
    };
  }

  it("leaves the credit alone on warning_needs_response", async () => {
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue(
      disputeEvent("warning_needs_response", "evt_inq_1"),
    );
    scenario.rpc.revoke_gift_card_for_refund = UNSPENT;
    scenario.reads.jobs = { rows: [] };

    await fn.fetch(webhookRequest(fn, "{}"));

    expect(revokeCalls()).toHaveLength(0);
  });

  it("still revokes on a real chargeback", async () => {
    const fn = await loadConfigured();
    stripeMock.webhooks.constructEventAsync.mockResolvedValue(
      disputeEvent("needs_response", "evt_real_1"),
    );
    scenario.rpc.revoke_gift_card_for_refund = UNSPENT;
    scenario.reads.jobs = { rows: [] };

    await fn.fetch(webhookRequest(fn, "{}"));

    expect(revokeCalls()).toHaveLength(1);
  });
});

// 5: revoke on an inquiry — the pre-fix code, which permanently destroyed a
//    live gift over a bank question that withdrew nothing.
// @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeCreated.ts | const isInquiry = typeof dispute.status === "string" && dispute.status.startsWith("warning_"); | const isInquiry = false;
