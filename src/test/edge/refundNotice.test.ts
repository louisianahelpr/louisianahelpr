/**
 * Q1714 (owner report 2026-10-12): "was i refunded for mow and weed eat yard?
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
 * @mutate supabase/functions/_shared/refundNotice.ts |         await release();\n        if (PERMANENT.has(insErr.code |         if (PERMANENT.has(insErr.code
 * @mutate supabase/functions/_shared/refundNotice.ts |     const res = await fetchFunction(`${ep.url}/functions/v1/send-notification-email`, { |     const res = await fetchFunction(`${ep.url}/functions/v1/send-notification-email-off`, {
 * @mutate supabase/functions/_shared/refundNotice.ts |   if (m.type && METHOD_TYPES[m.type]) return METHOD_TYPES[m.type]; |   if (m.type) return m.type;
 * @mutate supabase/functions/_shared/refundNotice.ts |       if (Date.now() - Date.parse(h.created_at) <= 5 * 60_000) return { status: "in_flight" }; |       if (false) return { status: "in_flight" };
 * @mutate supabase/functions/void-cancelled-payments/index.ts |             await tellPosterMoneyBack(job, pi, { key: `release:${pi.id}`, kind: "release", amountCents: Number(pi.amount ?? 0), keptCents: 0, keptReason: null }); |             void tellPosterMoneyBack;
 * @mutate supabase/functions/void-cancelled-payments/index.ts |               amountCents: Math.max(0, Number(pi.amount ?? 0) - feeCents), keptCents: feeCents, |               amountCents: 0, keptCents: feeCents,
 * @mutate supabase/functions/void-cancelled-payments/index.ts |             if (cancellationRefundNotice) await tellPosterMoneyBack(job, pi, cancellationRefundNotice); |             void cancellationRefundNotice;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |       if (pathAnnouncesRefund(md) \|\| madeByAPath.has(r.id)) { |       if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |         typeof r.created === "number" && Math.abs(r.created - releaseTold.createdS) < 600 |         false
 * @mutate supabase/functions/void-cancelled-payments/index.ts |             if (!r.stripe_refund_id \|\| done.has(key) \|\| !(Number(r.amount_cents) > 0)) continue; |             if (!r.stripe_refund_id \|\| !(Number(r.amount_cents) > 0)) continue;
 * @mutate supabase/functions/void-cancelled-payments/index.ts |       } else if ((ledger ?? []).length > 0) { |       } else if (false) {
 * @mutate supabase/functions/_shared/refundNotice.ts |       const jobId = md.job_id ?? md.parent_job_id; |       const jobId = md.job_id;
 * @mutate supabase/functions/_shared/refundNotice.ts |   const kept = keptSentence(Number(input.keptCents ?? 0), input, jobOwnsCharge ? job : null); |   const kept = keptSentence(Number(input.keptCents ?? 0), input, job);
 * @mutate supabase/functions/void-cancelled-payments/index.ts |             if (sameMoneyAsRelease(r)) continue; |
 * @mutate supabase/functions/void-cancelled-payments/index.ts |             if (!rel \|\| r.source !== "stripe_dashboard" \|\| rel.cents !== Number(r.amount_cents)) return false; |             if (!rel \|\| rel.cents !== Number(r.amount_cents)) return false;
 * @mutate supabase/functions/_shared/refundNotice.ts |     const emailed = res.ok && !body.skipped && body.success !== false; |     const emailed = res.ok && !body.skipped;
 * @mutate supabase/functions/execute-dispute-split/index.ts |         keptCents: Math.max(0, capturedCents - refundCents), |         keptCents: movedHelperCents + movedPlatformFeeCents,
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
const OWNER_REFUND = { id: "re_3UOcZ8Kp2H4b7tEC1cVCF92O", amount: 10000, status: "succeeded", metadata: {}, created: Math.floor(Date.now() / 1000) - 600 };
const VISA_4242 = { type: "card", card: { brand: "visa", last4: "4242", wallet: null } };
// The owner's real charge (ch_3UOcZ8Kp2H4b7tEC1lZSOnVi, read live by the
// review of Q1714): paid with Link, not a card.
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

describe("Q1714: the charge.refunded webhook tells the poster about EVERY refund", () => {
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

  it("a notice that could not be written gives its claim back and pages; the hourly sweep sends it (no redelivery loop)", async () => {
    scenario.writeErrors.notifications = { message: "insert blew up", code: "XX000" };
    const res = await deliverChargeRefunded();
    expect(res.status).toBe(200);
    expect(scenario.writes.some((w) => w.table === "refund_notices" && w.op === "delete")).toBe(true);
    expect(notificationEmails).toHaveLength(0);
    expect(JSON.stringify(slackAlerts)).toContain("not fully told");
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

  it("a fresh claim still being written by the path that made the refund: left to that sender (in_flight), no second notice", async () => {
    // Only the first claim is refused, so a takeover (the wrong answer for a
    // FRESH claim) would succeed and send: the test tells the two apart.
    scenario.writeOverrides = [{
      table: "refund_notices", op: "insert",
      when: () => scenario.writes.filter((w) => w.table === "refund_notices" && w.op === "insert").length === 1,
      error: { message: "duplicate key", code: "23505" },
    }];
    scenario.reads.refund_notices = { rows: [{ notification_id: null, created_at: new Date().toISOString() }] };
    const res = await deliverChargeRefunded();
    expect(res.status).toBe(200);
    expect(posterNotices()).toHaveLength(0);
    expect(notificationEmails).toHaveLength(0);
  });

  it("a refund its own path announces (admin, dispute split, visit card fee) is left to that path: 200, no second notice", async () => {
    for (const md of [{ source: "admin_refund_general" }, { source: "admin_refund_dispute" }, { dispute_id: "d-1" }, { fee_withheld: "true" }]) {
      scenario.writes.length = 0;
      stripeMock.refunds.list.mockResolvedValue({ data: [{ ...OWNER_REFUND, metadata: md }] });
      const res = await deliverChargeRefunded();
      expect(res.status, JSON.stringify(md)).toBe(200);
      expect(posterNotices(), JSON.stringify(md)).toHaveLength(0);
      expect(claims(), JSON.stringify(md)).toEqual([]);
    }
  });

  // Q1674 with Q1714: the webhook's own wording (charge.refunded first) names a
  // first job's kept $2 setup fee instead of folding it into "card fees".
  // @mutate supabase/functions/_shared/refundNotice.ts |     const setupCents = Math.min(keptCents - feeCents, setupFeeKeptCents(job)); |     const setupCents = 0;
  it("a first job's kept $2 setup fee is named on its own in the webhook's notice (Q1674)", async () => {
    scenario.reads.jobs = { rows: [{ ...OWNER_JOB, onboarding_fee_amount: "2" }] };
    const res = await deliverChargeRefunded({ amount: 11400 });
    expect(res.status).toBe(200);
    const msg = String(posterNotices()[0]?.message);
    expect(msg).toContain("We kept $14: $12 service fee, which isn't refunded when a job is cancelled and $2 one-time account setup fee, which is paid once and never refunded.");
    expect(msg).not.toContain("card processing");
  });

  it("a refund a path wrote to the ledger (void-cancelled-payments, cancel_escrow, crew) is left to that path", async () => {
    scenario.reads.payment_refunds = { rows: [{ stripe_refund_id: OWNER_REFUND.id, source: "void_cancelled_payments" }] };
    const res = await deliverChargeRefunded();
    expect(res.status).toBe(200);
    expect(posterNotices()).toHaveLength(0);
    // Asked for path rows only: a Dashboard refund's own ledger row does not count.
    const q = scenario.readQueries.find((r) => r.table === "payment_refunds" && r.cols.includes("source"));
    expect(q?.filters).toContainEqual({ op: "neq", column: "source", value: "stripe_dashboard" });
  });

  it("a released hold already announced is not announced again as a refund of the same amount made with it (review N8)", async () => {
    const releasedAt = new Date((OWNER_REFUND.created + 30) * 1000).toISOString();
    scenario.reads.refund_notices = {
      rows: [],
      selectOverrides: [{ includes: "amount_cents", result: { rows: [{ amount_cents: 10000, notification_id: "n-release", created_at: releasedAt }] } }],
    };
    const res = await deliverChargeRefunded();
    expect(res.status).toBe(200);
    expect(posterNotices()).toHaveLength(0);
  });

  it("a LATER refund of the same amount on a released hold is still announced (review 3, finding 4)", async () => {
    const releasedAt = new Date((OWNER_REFUND.created - 3 * 86_400) * 1000).toISOString();
    scenario.reads.refund_notices = {
      rows: [],
      selectOverrides: [{ includes: "amount_cents", result: { rows: [{ amount_cents: 10000, notification_id: "n-release", created_at: releasedAt }] } }],
    };
    await deliverChargeRefunded();
    expect(posterNotices()).toHaveLength(1);
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

  it("an email the sender answers 200 { success: false } for (both delivery paths failed) is recorded as not sent and paged", async () => {
    notificationEmailAnswer.body = { success: false, reason: "send_failed", error: "resend down" };
    const res = await deliverChargeRefunded();
    expect(res.status).toBe(200);
    expect(posterNotices()).toHaveLength(1);
    const stamp = scenario.writes.find((w) => w.table === "refund_notices" && w.op === "update" && "email_error" in (w.payload as object));
    expect(stamp?.payload).toMatchObject({ emailed: false, email_error: "send failed: resend down" });
    expect(JSON.stringify(slackAlerts)).toContain("its email was not");
  });

  it("a recurring visit's refund is told to the parent job's poster (its PaymentIntent names only parent_job_id)", async () => {
    // Not found by the visit's PaymentIntent (the parent job's escrow is a different one); found by its id.
    scenario.reads.jobs = { rows: [], eqOverrides: [{ column: "id", value: OWNER_JOB.id, result: { rows: [OWNER_JOB] } }] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_visit",
      metadata: { type: "recurring_visit", parent_job_id: OWNER_JOB.id, visit_date: "2026-10-15", recurring_visit_payment_id: "rvp-1" },
    });
    await deliverChargeRefunded();
    expect(posterNotices()).toHaveLength(1);
    // The parent's own service fee is not what this visit's charge kept.
    expect(String(posterNotices()[0].message)).not.toContain("service fee");
    expect(JSON.stringify(slackAlerts)).not.toContain("not fully told");
  });

  it("an onboarding-fee correction keeps its own notice (no refund notice)", async () => {
    stripeMock.refunds.list.mockResolvedValue({ data: [{ ...OWNER_REFUND, metadata: { reason: "duplicate_onboarding_fee" } }] });
    await deliverChargeRefunded();
    expect(posterNotices()).toHaveLength(0);
    expect(notificationEmails).toHaveLength(0);
  });
});

describe("Q1714: void-cancelled-payments tells the poster when it releases a card hold", () => {
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

describe("Q1714: the hourly untold-refund sweep (void-cancelled-payments Part G)", () => {
  const CRON_SECRET = "cron-secret-void";
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });
  async function runSweep() {
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_void", CRON_SECRET });
    scenario.reads.jobs = { rows: [], selectOverrides: [{ includes: "customer_fee_amount, dispute_status", result: { rows: [OWNER_JOB] } }] };
    scenario.writeSelectRows.notifications = [{ id: "notice-sweep" }];
    const h = await loadEdgeFunction("void-cancelled-payments");
    return h.fetch(new Request("https://x/functions/v1/void-cancelled-payments", { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
  }
  const LEDGER_ROW = { stripe_refund_id: "re_untold", stripe_payment_intent_id: "pi_x", job_id: OWNER_JOB.id, customer_id: OWNER_JOB.customer_id, amount_cents: 10000 };

  it("a refund on the ledger that its path never announced is announced here, once", async () => {
    scenario.reads.payment_refunds = { rows: [], selectOverrides: [{ includes: "customer_id, amount_cents", result: { rows: [LEDGER_ROW] } }] };
    scenario.reads.refund_notices = { rows: [] };
    await runSweep();
    expect(posterNotices().map((n) => n.title)).toEqual(["Refund issued: $100"]);
    expect(claims()).toEqual(["refund:re_untold"]);
    expect(notificationEmails).toHaveLength(1);
    // Only refunds 15+ minutes old, and none from before the sweep shipped.
    const q = scenario.readQueries.find((r) => r.table === "payment_refunds" && r.cols.includes("amount_cents"));
    expect(q?.filters.map((f) => f.op)).toEqual(expect.arrayContaining(["gte", "lte"]));
    expect(String(q?.filters.find((f) => f.op === "gte")?.value) >= "2026-10-12T12:00:00").toBe(true);
  });

  // Q1726 (finding lh-money-escrow@51461f2e6#1): a released hold, announced as
  // "Payment hold released", that Stripe also lists as a Refund of the same
  // amount (charge.refunded wrote it as a stripe_dashboard ledger row) is the
  // same money: the sweep does not send "Refund issued" for it a second time.
  const RELEASED_AT = "2026-10-12T20:00:00Z";
  const DASHBOARD_ROW = { ...LEDGER_ROW, source: "stripe_dashboard", created_at: "2026-10-12T20:00:40Z" };
  it("a refund of the same amount as a released hold already announced is not announced again", async () => {
    scenario.reads.payment_refunds = { rows: [], selectOverrides: [{ includes: "customer_id, amount_cents", result: { rows: [DASHBOARD_ROW] } }] };
    scenario.reads.refund_notices = { rows: [{ notice_key: "release:pi_x", amount_cents: 10000, created_at: RELEASED_AT }] };
    await runSweep();
    expect(posterNotices()).toHaveLength(0);
    expect(claims()).toEqual([]);
    expect(notificationEmails).toHaveLength(0);
  });

  it("control: a released hold of a DIFFERENT amount does not hide a later refund", async () => {
    scenario.reads.payment_refunds = { rows: [], selectOverrides: [{ includes: "customer_id, amount_cents", result: { rows: [DASHBOARD_ROW] } }] };
    scenario.reads.refund_notices = { rows: [{ notice_key: "release:pi_x", amount_cents: 1200, created_at: RELEASED_AT }] };
    await runSweep();
    expect(claims()).toEqual(["refund:re_untold"]);
  });

  it("a PATH's own refund of the same amount (a crashed admin refund) is still announced", async () => {
    scenario.reads.payment_refunds = { rows: [], selectOverrides: [{ includes: "customer_id, amount_cents", result: { rows: [{ ...DASHBOARD_ROW, source: "admin_refund_general" }] } }] };
    scenario.reads.refund_notices = { rows: [{ notice_key: "release:pi_x", amount_cents: 10000, created_at: RELEASED_AT }] };
    await runSweep();
    expect(claims()).toEqual(["refund:re_untold"]);
  });

  it("a same-amount dashboard refund days after the release is a separate refund, announced", async () => {
    scenario.reads.payment_refunds = { rows: [], selectOverrides: [{ includes: "customer_id, amount_cents", result: { rows: [{ ...DASHBOARD_ROW, created_at: "2026-10-14T09:00:00Z" }] } }] };
    scenario.reads.refund_notices = { rows: [{ notice_key: "release:pi_x", amount_cents: 10000, created_at: RELEASED_AT }] };
    await runSweep();
    expect(claims()).toEqual(["refund:re_untold"]);
  });

  it("a refund already announced is left alone", async () => {
    scenario.reads.payment_refunds = { rows: [], selectOverrides: [{ includes: "customer_id, amount_cents", result: { rows: [LEDGER_ROW] } }] };
    scenario.reads.refund_notices = { rows: [{ notice_key: "refund:re_untold" }] };
    await runSweep();
    expect(posterNotices()).toHaveLength(0);
    expect(claims()).toEqual([]);
  });
});

// The two owner-approved one-time notices for the 10-11 refunds (2026-10-12):
// in-app notices written, both emails "send-notification-email answered 401",
// and nothing ever retried them. void-cancelled-payments Part H re-sends a
// failed email, bounded: 3 sends in all, notices under 7 days old, never one
// the person's own switches held back.
// @mutate supabase/functions/void-cancelled-payments/index.ts |       const r = await retryFailedRefundEmails(supabaseAdmin); |       const r = { retried: 0, emailed: 0, problems: [] as string[], gaveUp: [] as string[], skipped: undefined as string \| undefined };
// @mutate supabase/functions/_shared/refundNotice.ts |       if ((row.email_error ?? "").startsWith("skipped:")) continue; |       if (false) continue;
// @mutate supabase/functions/_shared/refundNotice.ts |       if (!row.notification_id \|\| row.notification_id === ZERO_UUID \|\| !(tried < REFUND_EMAIL_MAX_ATTEMPTS)) continue; |       if (!row.notification_id) continue;
// @mutate supabase/functions/_shared/refundNotice.ts |       if ((claimedRows ?? []).length === 0 \|\| !note) continue; |       if (!note) continue;
// @mutate supabase/functions/_shared/refundNotice.ts |       if (tried + 1 >= REFUND_EMAIL_MAX_ATTEMPTS) out.gaveUp.push(row.notice_key); |       void 0;
describe("refund notice emails that failed are retried, bounded (void-cancelled-payments Part H)", () => {
  const CRON_SECRET = "cron-secret-void";
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
  });
  async function runSweep() {
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_void", CRON_SECRET });
    const h = await loadEdgeFunction("void-cancelled-payments");
    return h.fetch(new Request("https://x/functions/v1/void-cancelled-payments", { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
  }
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const FAILED = {
    notice_key: "refund:re_3UOcZ8Kp2H4b7tEC1cVCF92O", user_id: OWNER_JOB.customer_id, job_id: OWNER_JOB.id,
    notification_id: "6ab00306-d7aa-4c2a-a8a8-a2c257946532", email_attempts: 1,
    email_error: "send-notification-email answered 401", created_at: hoursAgo(1),
  };
  const NOTICE = {
    id: FAILED.notification_id, title: "Refund issued: $100", link: `/posts?job=${OWNER_JOB.id}&refund=re_3UOcZ8Kp2H4b7tEC1cVCF92O`, job_id: OWNER_JOB.id,
    message: "We refunded $100 for \"Mow & Weed Eat Yard\" to your Link account (refund reference re_3UOcZ8Kp2H4b7tEC1cVCF92O).",
  };
  const failedRows = (rows: Array<Record<string, unknown>>) => {
    scenario.reads.refund_notices = { rows: [], selectOverrides: [{ includes: "email_attempts", result: { rows } }] };
    scenario.reads.notifications = { rows: [NOTICE] };
  };
  const noticeUpdates = () => scenario.writes.filter((w) => w.table === "refund_notices" && w.op === "update");

  it("re-sends the failed email with the in-app notice's own words, claiming the attempt first", async () => {
    failedRows([FAILED]);
    await runSweep();
    expect(notificationEmails).toHaveLength(1);
    expect(notificationEmails[0]).toMatchObject({ notification_id: NOTICE.id, user_id: OWNER_JOB.customer_id, title: NOTICE.title, message: NOTICE.message, type: "payment", link: NOTICE.link });
    const [claim, stamp] = noticeUpdates();
    expect(claim.payload).toEqual({ email_attempts: 2 });
    expect(claim.filters).toEqual(expect.arrayContaining([{ op: "eq", column: "email_attempts", value: 1 }, { op: "eq", column: "emailed", value: false }]));
    expect(stamp.payload).toEqual({ emailed: true, email_error: null });
    // No new in-app notice: only the email goes again.
    expect(scenario.writes.some((w) => w.table === "notifications" && w.op === "insert")).toBe(false);
    // The read is bounded: under 3 attempts, 7 days old at most, 15 minutes old at least.
    const q = scenario.readQueries.find((r) => r.table === "refund_notices" && r.cols.includes("email_attempts"));
    expect(q?.filters).toEqual(expect.arrayContaining([{ op: "eq", column: "emailed", value: false }, { op: "lt", column: "email_attempts", value: 3 }]));
    expect(q?.filters.map((f) => f.op)).toEqual(expect.arrayContaining(["gte", "lte"]));
  });

  it("never re-sends one the person's switches held back, one at the cap, one a week old, or one a trigger dropped", async () => {
    failedRows([
      { ...FAILED, email_error: "skipped: email_disabled" },
      { ...FAILED, email_attempts: 3 },
      { ...FAILED, created_at: hoursAgo(24 * 8) },
      { ...FAILED, notification_id: "00000000-0000-0000-0000-000000000000" },
    ]);
    await runSweep();
    expect(notificationEmails).toHaveLength(0);
    expect(noticeUpdates()).toHaveLength(0);
  });

  it("another run already claimed the attempt: nothing is sent", async () => {
    failedRows([FAILED]);
    scenario.writeSelectRows["refund_notices:update"] = [];
    await runSweep();
    expect(notificationEmails).toHaveLength(0);
  });

  it("the last allowed attempt failing pages a person to tell them by hand", async () => {
    failedRows([{ ...FAILED, email_attempts: 2, created_at: hoursAgo(7) }]);
    notificationEmailAnswer.status = 401;
    notificationEmailAnswer.body = { error: "unauthorized" };
    await runSweep();
    expect(notificationEmails).toHaveLength(1);
    const stamp = noticeUpdates()[1];
    expect(stamp.payload).toEqual({ emailed: false, email_error: "send-notification-email answered 401" });
    expect((slackAlerts as Array<{ title: string }>).some((a) => /refund notice email failed every try/.test(a.title))).toBe(true);
  });

  // Review #4: the last try waits 6 hours, so one outage of a couple of hours
  // does not use up every try.
  // @mutate supabase/functions/_shared/refundNotice.ts |   return tried <= 1 ? REFUND_EMAIL_RETRY_AFTER_MS : 6 * 3_600_000; |   return REFUND_EMAIL_RETRY_AFTER_MS;
  it("the last try waits until the notice is 6 hours old", async () => {
    failedRows([{ ...FAILED, email_attempts: 2, created_at: hoursAgo(2) }]);
    await runSweep();
    expect(notificationEmails).toHaveLength(0);
    expect(noticeUpdates()).toHaveLength(0);
  });

  // Review #1: an email the person's switches held back is excluded in the
  // query itself, so 50 of them never crowd a failed one out.
  it("the read leaves out emails the person's switches held back", async () => {
    failedRows([FAILED]);
    await runSweep();
    const q = scenario.readQueries.find((r) => r.table === "refund_notices" && r.cols.includes("email_attempts"));
    expect(q?.filters).toEqual(expect.arrayContaining([expect.objectContaining({ op: "or", value: "email_error.is.null,email_error.not.like.skipped:*" })]));
  });

  // Review #2: a person may delete their own notice once read. They saw it:
  // closed without an email and without a page.
  // @mutate supabase/functions/_shared/refundNotice.ts |       if ((claimedRows ?? []).length === 0 \|\| !note) continue; |       if ((claimedRows ?? []).length === 0) continue;
  it("a notice the person deleted is closed without an email or a page", async () => {
    failedRows([FAILED]);
    scenario.reads.notifications = { rows: [] };
    const res = await runSweep();
    expect(await res.text()).not.toContain("refund email retry");
    expect(notificationEmails).toHaveLength(0);
    expect(noticeUpdates().map((u) => u.payload)).toEqual([{ email_attempts: 3, email_error: "the in-app notice was deleted by the person; email not retried" }]);
    expect((slackAlerts as Array<{ title: string }>).some((a) => /failed every try/.test(a.title))).toBe(false);
  });

  // Review #5: the column not deployed yet is recorded as a defect, not only logged.
  // @mutate supabase/functions/void-cancelled-payments/index.ts |       if (r.skipped) defects.record(`refund email retry skipped: ${r.skipped}`); |       if (r.skipped) console.warn(r.skipped);
  it("before the column deploys, nothing is sent and the run says why", async () => {
    scenario.reads.refund_notices = { rows: [], selectOverrides: [{ includes: "email_attempts", result: { error: { code: "42703", message: "column refund_notices.email_attempts does not exist" } } }] };
    const res = await runSweep();
    expect(notificationEmails).toHaveLength(0);
    expect(await res.text()).toContain("refund email retry skipped: email_attempts column not deployed yet");
  });

  it("an attempt that fails before the cap pages nobody; the next run retries it", async () => {
    failedRows([FAILED]);
    notificationEmailAnswer.status = 500;
    notificationEmailAnswer.body = { error: "boom" };
    await runSweep();
    expect(notificationEmails).toHaveLength(1);
    expect((slackAlerts as Array<{ title: string }>).some((a) => /failed every try/.test(a.title))).toBe(false);
  });
});
