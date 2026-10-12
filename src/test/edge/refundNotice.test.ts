/**
 * Q1652 (owner report 2026-10-12): "was i refunded for mow and weed eat yard?
 * i dont think i got an email that i was refunded".
 *
 * Measured on prod: job 5d43debf was auto-cancelled, void-cancelled-payments
 * refunded $100.00 of the $112.00 (re_3UOcZ8Kp2H4b7tEC1cVCF92O, $12 service
 * fee kept), and NOTHING told the poster: the charge.refunded webhook wrote
 * its "Refund processed" row only on a FULL refund, in-app only, and no
 * refund path sent an email.
 *
 * Every person whose money goes back gets ONE in-app notice and ONE email:
 * how much, to which card, the refund reference, 5-10 business days, and what
 * was kept and why. Runs the REAL function source via the edge harness.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |   if (!isOnboardingFeeCorrection && ordinaryRefunds.length > 0) { |   if (!isOnboardingFeeCorrection && isFullRefund && ordinaryRefunds.length > 0) {
 * @mutate supabase/functions/_shared/refundNotice.ts |     if (claimErr?.code === "23505") { |     if (false) {
 * @mutate supabase/functions/_shared/refundNotice.ts |         await release();
        if (PERMANENT.has(insErr.code |         if (PERMANENT.has(insErr.code
 * @mutate supabase/functions/_shared/refundNotice.ts |           const res = await fetch(`${ep.url}/functions/v1/send-notification-email`, { |           const res = await fetch(`${ep.url}/functions/v1/send-notification-email-off`, {
 * @mutate supabase/functions/_shared/refundNotice.ts |   if (m.type && METHOD_TYPES[m.type]) return METHOD_TYPES[m.type]; |   if (m.type) return m.type;
 * @mutate supabase/functions/_shared/refundNotice.ts |       if (Date.now() - Date.parse(h.created_at) <= 5 * 60_000) return { status: "in_flight" }; |       if (false) return { status: "in_flight" };
 * @mutate supabase/functions/void-cancelled-payments/index.ts |             await tellPosterMoneyBack(job, pi, { key: `release:${pi.id}`, kind: "release", amountCents: Number(pi.amount ?? 0), keptCents: 0, keptReason: null }); |             void tellPosterMoneyBack;
 * @mutate supabase/functions/void-cancelled-payments/index.ts |               amountCents: Math.max(0, Number(pi.amount ?? 0) - feeCents), keptCents: feeCents, |               amountCents: 0, keptCents: feeCents,
 * @mutate supabase/functions/void-cancelled-payments/index.ts |             if (cancellationRefundNotice) await tellPosterMoneyBack(job, pi, cancellationRefundNotice); |             void cancellationRefundNotice;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |       if (pathAnnouncesRefund((r.metadata ?? null) as Record<string, string> \| null)) { |       if (false) {
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts, notificationEmails, notificationEmailAnswer } from "./mocks/shared";

const OWNER_JOB = {
  id: "5d43debf-6a0b-4a51-9686-a3e49b5dae0a",
  customer_id: "7f65ef12-poster",
  helper_id: null,
  title: "Mow & Weed Eat Yard",
  status: "cancelled",
  payment_status: "escrow",
  cancellation_fee: "0",
  customer_fee_amount: "12",
  dispute_status: null,
};
const OWNER_REFUND = { id: "re_3UOcZ8Kp2H4b7tEC1cVCF92O", amount: 10000, status: "succeeded", metadata: {}, created: Math.floor(Date.now() / 1000) };
const VISA_4242 = { type: "card", card: { brand: "visa", last4: "4242", wallet: null } };
// The owner's real charge (ch_3UOcZ8Kp2H4b7tEC1lZSOnVi, read live by the
// review of Q1652): paid with Link, not a card.
const LINK = { type: "link", link: { country: "US" } };

const posterNotices = () =>
  scenario.writes
    .filter((w) => w.table === "notifications" && w.op === "insert")
    .map((w) => w.payload as Record<string, unknown>)
    .filter((n) => n.user_id === OWNER_JOB.customer_id);
const claims = () =>
  scenario.writes
    .filter((w) => w.table === "refund_notices" && w.op === "insert")
    .map((w) => (w.payload as { notice_key: string }).notice_key);

async function deliverChargeRefunded(over: Record<string, unknown> = {}) {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
  const fn = await loadEdgeFunction("stripe-webhook");
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({
    id: `evt_${Math.random()}`,
    type: "charge.refunded",
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: "ch_mow",
        payment_intent: "pi_3UOcZ8Kp2H4b7tEC15bAHH9d",
        amount: 11200,
        amount_refunded: 10000,
        currency: "usd",
        refunds: null,
        payment_method_details: LINK,
        ...over,
      },
    },
  });
  return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=abc" } }));
}

describe("Q1652: the charge.refunded webhook tells the poster about EVERY refund", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
    scenario.reads.jobs = { rows: [OWNER_JOB] };
    scenario.writeSelectRows.notifications = [{ id: "notice-1" }];
    stripeMock.refunds.list.mockResolvedValue({ data: [OWNER_REFUND] });
  });

  it("the owner's case: a $100.00 partial refund of $112.00 sends ONE notice and ONE email with the card, reference, timing and the kept fee", async () => {
    const res = await deliverChargeRefunded();
    expect(res.status).toBe(200);
    const notices = posterNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ title: "Refund issued: $100", type: "payment", job_id: OWNER_JOB.id });
    const msg = String(notices[0].message);
    expect(msg).toContain('We refunded $100 for "Mow & Weed Eat Yard" to your Link account');
    expect(msg).toContain("refund reference re_3UOcZ8Kp2H4b7tEC1cVCF92O");
    expect(msg).toContain("5-10 business days");
    expect(msg).toContain("We kept $12: the service fee, which isn't refunded when a job is cancelled.");
    expect(String(notices[0].link)).toBe(`/posts?job=${OWNER_JOB.id}&refund=re_3UOcZ8Kp2H4b7tEC1cVCF92O`);
    expect(notificationEmails).toHaveLength(1);
    expect(notificationEmails[0]).toMatchObject({
      user_id: OWNER_JOB.customer_id,
      title: "Refund issued: $100",
      message: msg,
      type: "payment",
      job_id: OWNER_JOB.id,
    });
    expect(claims()).toEqual(["refund:re_3UOcZ8Kp2H4b7tEC1cVCF92O"]);
  });

  it("a redelivery (or the path that made the refund) already claimed it: no second notice, no second email", async () => {
    scenario.writeErrors.refund_notices = { message: "duplicate key value violates unique constraint", code: "23505" };
    scenario.reads.refund_notices = { rows: [{ notification_id: "notice-1", created_at: new Date().toISOString() }] };
    const res = await deliverChargeRefunded();
    expect(res.status).toBe(200);
    expect(posterNotices()).toHaveLength(0);
    expect(notificationEmails).toHaveLength(0);
  });

  it("a claim left by a sender that died before its notice is taken over after 5 minutes", async () => {
    scenario.writeOverrides = [{
      table: "refund_notices", op: "insert",
      when: () => scenario.writes.filter((w) => w.table === "refund_notices" && w.op === "insert").length === 1,
      error: { message: "duplicate key", code: "23505" },
    }];
    scenario.reads.refund_notices = { rows: [{ notification_id: null, created_at: new Date(Date.now() - 10 * 60_000).toISOString() }] };
    scenario.writeSelectRows["refund_notices:delete"] = [{ notice_key: "refund:re_3UOcZ8Kp2H4b7tEC1cVCF92O" }];
    await deliverChargeRefunded();
    expect(posterNotices()).toHaveLength(1);
    expect(notificationEmails).toHaveLength(1);
  });

  it("a FULL refund sends the same one notice (no separate 'Refund processed')", async () => {
    stripeMock.refunds.list.mockResolvedValue({ data: [{ ...OWNER_REFUND, amount: 11200 }] });
    await deliverChargeRefunded({ amount_refunded: 11200 });
    const notices = posterNotices();
    expect(notices.map((n) => n.title)).toEqual(["Refund issued: $112"]);
    expect(String(notices[0].message)).not.toContain("We kept");
    expect(notificationEmails).toHaveLength(1);
  });

  it("a notice that could not be written gives its claim back and answers 500, so Stripe redelivers", async () => {
    scenario.writeErrors.notifications = { message: "insert blew up", code: "XX000" };
    const res = await deliverChargeRefunded();
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(scenario.writes.some((w) => w.table === "refund_notices" && w.op === "delete")).toBe(true);
    expect(notificationEmails).toHaveLength(0);
  });

  it("the person switched payment emails off: the in-app notice still lands, the email is the sender's to skip", async () => {
    notificationEmailAnswer.body = { skipped: true, reason: "email_disabled" };
    const res = await deliverChargeRefunded();
    expect(res.status).toBe(200);
    expect(posterNotices()).toHaveLength(1);
    // Asked exactly once, as type "payment": send-notification-email applies the switch.
    expect(notificationEmails).toHaveLength(1);
    expect(notificationEmails[0].type).toBe("payment");
    expect(JSON.stringify(slackAlerts)).not.toContain("not fully told");
  });

  it("a refund on a payment with no job is told to the payer the PaymentIntent names", async () => {
    scenario.reads.jobs = { rows: [] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_x", metadata: { payer_id: "payer-9" } });
    await deliverChargeRefunded();
    const n = scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert").map((w) => w.payload as Record<string, unknown>);
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ user_id: "payer-9", title: "Refund issued: $100" });
  });

  it("a refund nobody can be told about pages ops instead of passing silently", async () => {
    scenario.reads.jobs = { rows: [] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_x", metadata: {} });
    await deliverChargeRefunded();
    expect(JSON.stringify(slackAlerts)).toContain("Refund made, but the card holder was not fully told");
  });

  it("a card payment names the card's brand and last 4, never a raw type", async () => {
    await deliverChargeRefunded({ payment_method_details: VISA_4242 });
    expect(String(posterNotices()[0].message)).toContain("to your Visa ending in 4242");
    scenario.writes.length = 0;
    await deliverChargeRefunded({ payment_method_details: { type: "some_new_method", some_new_method: {} } });
    expect(String(posterNotices()[0].message)).toContain("to your original payment method");
  });

  it("a fresh claim still being written by the path that made the refund: the webhook leaves it (in_flight), no second notice", async () => {
    scenario.writeErrors.refund_notices = { message: "duplicate key", code: "23505" };
    scenario.reads.refund_notices = { rows: [{ notification_id: null, created_at: new Date().toISOString() }] };
    const res = await deliverChargeRefunded();
    expect(res.status).toBe(200);
    expect(posterNotices()).toHaveLength(0);
    expect(notificationEmails).toHaveLength(0);
  });

  it("a refund its own path announces (admin, dispute split, visit card fee) is left to that path", async () => {
    for (const md of [{ source: "admin_refund_general" }, { source: "admin_refund_dispute" }, { dispute_id: "d-1" }, { fee_withheld: "true" }]) {
      scenario.writes.length = 0;
      stripeMock.refunds.list.mockResolvedValue({ data: [{ ...OWNER_REFUND, metadata: md }] });
      await deliverChargeRefunded();
      expect(posterNotices(), JSON.stringify(md)).toHaveLength(0);
      expect(claims(), JSON.stringify(md)).toEqual([]);
    }
  });

  it("a tip refund is told to the tipper its ledger names (the tip's PaymentIntent names nobody)", async () => {
    scenario.reads.jobs = { rows: [] };
    scenario.reads.tips = { rows: [{ tipper_id: "tipper-3" }] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_tip", metadata: { type: "tip" } });
    await deliverChargeRefunded();
    const n = scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert").map((w) => w.payload as Record<string, unknown>);
    expect(n.map((x) => x.user_id)).toEqual(["tipper-3"]);
  });

  it("a recipient whose account is gone (FK) is paged once and acknowledged, not redelivered for days", async () => {
    scenario.writeErrors.refund_notices = { message: "violates foreign key constraint", code: "23503" };
    const res = await deliverChargeRefunded();
    expect(res.status).toBe(200);
    expect(JSON.stringify(slackAlerts)).toContain("not fully told");
  });

  it("an email that fails (not the person's own switch) is recorded on the claim and paged", async () => {
    notificationEmailAnswer.status = 500;
    notificationEmailAnswer.body = { error: "boom" };
    const res = await deliverChargeRefunded();
    expect(res.status).toBe(200);
    expect(posterNotices()).toHaveLength(1);
    const stamp = scenario.writes.find((w) => w.table === "refund_notices" && w.op === "update" && "email_error" in (w.payload as object));
    expect(stamp?.payload).toMatchObject({ emailed: false, email_error: "send-notification-email answered 500" });
    expect(JSON.stringify(slackAlerts)).toContain("its email was not");
  });

  it("an onboarding-fee correction keeps its own notice (no refund notice)", async () => {
    stripeMock.refunds.list.mockResolvedValue({ data: [{ ...OWNER_REFUND, metadata: { reason: "duplicate_onboarding_fee" } }] });
    await deliverChargeRefunded();
    expect(posterNotices()).toHaveLength(0);
    expect(notificationEmails).toHaveLength(0);
  });
});

describe("Q1652: void-cancelled-payments tells the poster when it releases a card hold", () => {
  const CRON_SECRET = "cron-secret-void";
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });

  async function runVoid(job: Record<string, unknown>, pi: Record<string, unknown>) {
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_test_void",
      CRON_SECRET,
    });
    scenario.reads.jobs = {
      selectOverrides: [{ includes: "cancellation_fee", result: { rows: [job] } }],
      rows: [],
    };
    scenario.writeSelectRows.notifications = [{ id: "notice-hold" }];
    stripeMock.paymentIntents.retrieve.mockResolvedValue(pi);
    stripeMock.paymentIntents.cancel.mockResolvedValue({ ...pi, status: "canceled" });
    const h = await loadEdgeFunction("void-cancelled-payments");
    return h.fetch(new Request("https://x/functions/v1/void-cancelled-payments", {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    }));
  }

  const HOLD_JOB = {
    id: "job-hold",
    title: "Gutter clean",
    status: "cancelled",
    stripe_session_id: null,
    stripe_payment_intent_id: "pi_hold",
    budget: 100,
    customer_fee_amount: 12,
    cancellation_fee: 0,
    date_needed: null,
    start_time: null,
    cancelled_at: null,
    helper_id: null,
    helper_confirmed_at: null,
    customer_id: "poster-hold",
    helper_fee_percent: 10,
    dispute_status: null,
  };

  it("a hold released in full: ONE 'Payment hold released' notice and ONE email, with the card and the reference", async () => {
    const res = await runVoid(HOLD_JOB, {
      id: "pi_hold", status: "requires_capture", amount: 11200,
      latest_charge: { id: "ch_hold", payment_method_details: { type: "card", card: { brand: "mastercard", last4: "5555", wallet: { type: "apple_pay" } } } },
    });
    expect(stripeMock.paymentIntents.cancel).toHaveBeenCalledWith("pi_hold");
    const n = scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert").map((w) => w.payload as Record<string, unknown>)
      .filter((x) => x.user_id === "poster-hold");
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ title: "Payment hold released: $112", type: "payment", job_id: "job-hold" });
    expect(String(n[0].message)).toContain('We released the $112 hold for "Gutter clean" on Apple Pay (Mastercard ending in 5555) (reference pi_hold)');
    expect(String(n[0].message)).toContain("5-10 business days");
    expect(notificationEmails).toHaveLength(1);
    expect(notificationEmails[0]).toMatchObject({ user_id: "poster-hold", title: "Payment hold released: $112" });
    expect(claims()).toEqual(["release:pi_hold"]);
    expect(res.status).toBeLessThan(500);
  });

  it("a captured payment refunded on cancellation: void-cancelled-payments itself announces it with the amounts it computed (the owner's case)", async () => {
    stripeMock.refunds.create.mockResolvedValue({ id: "re_3UOcZ8Kp2H4b7tEC1cVCF92O", amount: 10000 });
    await runVoid({ ...HOLD_JOB, id: OWNER_JOB.id, title: OWNER_JOB.title, customer_id: "poster-hold", stripe_payment_intent_id: "pi_mow" }, {
      id: "pi_mow", status: "succeeded", amount: 11200, amount_received: 11200,
      latest_charge: { id: "ch_mow", payment_method_details: LINK, balance_transaction: { fee: 356 } },
    });
    expect(stripeMock.refunds.create.mock.calls[0]?.[0]).toMatchObject({ payment_intent: "pi_mow", amount: 10000 });
    const n = scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert").map((w) => w.payload as Record<string, unknown>)
      .filter((x) => x.user_id === "poster-hold");
    expect(n).toHaveLength(1);
    expect(n[0].title).toBe("Refund issued: $100");
    expect(String(n[0].message)).toBe(
      'We refunded $100 for "Mow & Weed Eat Yard" to your Link account (refund reference re_3UOcZ8Kp2H4b7tEC1cVCF92O). ' +
      "It usually shows on your statement within 5-10 business days. We kept $12: the service fee, which isn't refunded when a job is cancelled.",
    );
    expect(notificationEmails).toHaveLength(1);
    expect(claims()).toEqual(["refund:re_3UOcZ8Kp2H4b7tEC1cVCF92O"]);
  });

  it("a hold the cancellation fee was captured from: the rest is released, and the notice says the fee was kept for the Helpr", async () => {
    // $300 job cancelled 1 hour before a 10:00 Central start with a confirmed
    // Helpr: the ladder prices a fee, so only the fee is captured.
    stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_fee", status: "succeeded" });
    await runVoid({
      ...HOLD_JOB,
      id: "job-fee",
      title: "Mow the lawn",
      stripe_payment_intent_id: "pi_fee",
      budget: 300,
      customer_fee_amount: 30,
      cancellation_fee: 150,
      date_needed: "2024-06-25",
      start_time: "10:00:00",
      cancelled_at: "2024-06-25T14:00:00Z",
      helper_id: "helper-1",
      helper_confirmed_at: "2024-06-20T00:00:00Z",
      is_group_job: false,
      helpers_needed: 1,
      parent_job_id: null,
      recurrence_days: null,
    }, {
      id: "pi_fee", status: "requires_capture", amount: 33000,
      latest_charge: { id: "ch_fee", payment_method_details: { type: "card", card: { brand: "visa", last4: "4242", wallet: null } } },
    });
    const captured = stripeMock.paymentIntents.capture.mock.calls[0];
    expect(captured?.[0]).toBe("pi_fee");
    const feeCents = Number((captured?.[1] as { amount_to_capture: number }).amount_to_capture);
    expect(feeCents).toBeGreaterThan(0);
    const n = scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert").map((w) => w.payload as Record<string, unknown>)
      .filter((x) => x.user_id === "poster-hold");
    expect(n).toHaveLength(1);
    const released = (33000 - feeCents) / 100;
    expect(n[0].title).toBe(`Payment hold released: $${released.toLocaleString("en-US", { minimumFractionDigits: released % 1 ? 2 : 0 })}`);
    expect(String(n[0].message)).toContain("on your Visa ending in 4242 (reference pi_fee)");
    expect(String(n[0].message)).toMatch(/We kept \$[\d.,]+: the cancellation fee for your Helpr\./);
    expect(notificationEmails).toHaveLength(1);
    expect(claims()).toEqual(["release:pi_fee"]);
  });
});
