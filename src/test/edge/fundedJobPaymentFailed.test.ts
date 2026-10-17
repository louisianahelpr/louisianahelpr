// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | if (failedJob && FUNDED_PAYMENT_STATES.has(String(failedJob.payment_status))) { | if (false) {
// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | if (job.stripe_payment_intent_id !== piId) { | if (false) {
// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | if (!liveStatus \|\| !FAILED_PI_STATUSES.has(liveStatus)) { | if (false) {
// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | const hired = Boolean(job.helper_id && job.helper_confirmed_at); | const hired = Boolean(job.helper_id);
// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | : job.status === "in_progress" | : job.status === "in_progressX"
// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | if (job.payment_status === "released") { | if (false) {
/**
 * A bank (ACH) payment that fails on a job already marked FUNDED takes the job
 * out of escrow (ach-fix, 2026-10-17).
 *
 * The incident: real job 7440a72d was paid by us_bank_account. Checkout
 * completed 10-12 and the job went to 'escrow' while the debit was pending; on
 * 10-15 the debit failed (insufficient_funds, PI now requires_payment_method,
 * amount_received 0). payment_intent.payment_failed WAS delivered and
 * processed, but the handler only acted on null/unpaid/failed jobs, so it
 * acked "Stale payment_failed ignored" and the job stayed in escrow: hired,
 * offered, reminded and re-broadcast to Helprs as funded.
 *
 * ME-046 (10-16) stopped a NEW async checkout from setting escrow, but an ACH
 * debit can also fail AFTER it first succeeded (a late bank return), which
 * lands on an escrow job again. This file is the funded-job half of the class.
 *
 * Runs the REAL webhook source via the edge harness; Stripe and Supabase are
 * doubled (handler logic, not a prod verification).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, resetSharedMocks } from "./mocks/shared";

async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
  return loadEdgeFunction("stripe-webhook");
}

function webhookRequest(fn: EdgeHarness) {
  return fn.request({
    rawBody: "{}",
    headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" },
  });
}

const PI = "pi_ach_funded";

function failedEvent(piId = PI) {
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({
    id: `evt_${piId}`,
    type: "payment_intent.payment_failed",
    data: { object: { id: piId, metadata: { job_id: "job-ach" } } },
  });
}

function fundedJob(over: Record<string, unknown> = {}) {
  scenario.reads.jobs = {
    rows: [{
      id: "job-ach",
      customer_id: "poster-1",
      title: "Mow & Weed Eat Yard",
      status: "accepted",
      payment_status: "escrow",
      stripe_session_id: "cs_live_done",
      stripe_payment_intent_id: PI,
      // The incident's shape: offered to a Helpr who had NOT confirmed.
      helper_id: "helper-1",
      helper_confirmed_at: null,
      is_seed: false,
      ...over,
    }],
  };
}

const jobUpdates = () => scenario.writes.filter((w) => w.table === "jobs" && w.op === "update");
const notices = () =>
  scenario.writes
    .filter((w) => w.table === "notifications")
    .flatMap((w) => (Array.isArray(w.payload) ? w.payload : [w.payload])) as Array<Record<string, unknown>>;

describe("payment_intent.payment_failed on a job marked funded", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("replays 7440a72d: an escrow job whose own ACH debit failed leaves escrow and the poster is told plainly", async () => {
    const fn = await loadConfigured();
    failedEvent();
    fundedJob();
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: PI, status: "requires_payment_method", amount_received: 0 });
    const res = await fn.fetch(webhookRequest(fn));
    expect(res.status).toBe(200);

    const [w, ...rest] = jobUpdates();
    expect(rest).toHaveLength(0);
    expect(w?.payload).toEqual({ payment_status: "failed", stripe_session_id: null });
    // Pinned to the PI that funded it and to a funded state, so a concurrent
    // refund/cancel/release wins.
    expect(w?.filters).toEqual(expect.arrayContaining([
      { op: "eq", column: "stripe_payment_intent_id", value: PI },
      { op: "in", column: "payment_status", value: ["escrow", "payout_pending"] },
    ]));

    const n = notices();
    expect(n.map((x) => x.user_id)).toEqual(["poster-1"]); // the unconfirmed Helpr is not told
    expect(String(n[0].message)).toMatch(/bank payment .* didn't go through/);
    expect(String(n[0].message)).toMatch(/isn't paid for/);
    expect(slackAlerts.length).toBeGreaterThan(0);
  });

  it("a Helpr who had confirmed is told too", async () => {
    const fn = await loadConfigured();
    failedEvent();
    fundedJob({ helper_confirmed_at: "2026-10-16T18:40:55Z" });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: PI, status: "requires_payment_method" });
    await fn.fetch(webhookRequest(fn));
    const n = notices();
    expect(n.map((x) => x.user_id).sort()).toEqual(["helper-1", "poster-1"]);
    const helper = n.find((x) => x.user_id === "helper-1")!;
    expect(String(helper.message)).toMatch(/don't start work/);
    // A hired job is not "hireable again" and cannot be re-checked-out from
    // My Posts (which hides 'failed'): no promise of a button that isn't there.
    const poster = n.find((x) => x.user_id === "poster-1")!;
    expect(String(poster.message)).not.toMatch(/hire|pay again|Post a Job/i);
    expect(poster.link).toBeNull();
  });

  it("a Helpr mid-job is asked to stop; a Helpr who finished is told the payout is on hold", async () => {
    for (const [over, want] of [
      [{ status: "in_progress" }, /stop work on it/],
      [{ status: "completed", payment_status: "payout_pending" }, /payout for it is on hold/],
    ] as const) {
      resetStripeMock();
      resetSupabaseMock();
      resetSharedMocks();
      const fn = await loadConfigured();
      failedEvent();
      fundedJob({ helper_confirmed_at: "2026-10-16T00:00:00Z", ...over });
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: PI, status: "requires_payment_method" });
      await fn.fetch(webhookRequest(fn));
      const helper = notices().find((x) => x.user_id === "helper-1");
      expect(String(helper?.message), JSON.stringify(over)).toMatch(want);
    }
  });

  it("zero rows (a refund, cancel or release moved the job first) tells nobody", async () => {
    const fn = await loadConfigured();
    failedEvent();
    fundedJob({ helper_confirmed_at: "2026-10-16T00:00:00Z" });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: PI, status: "requires_payment_method" });
    scenario.writeSelectRows["jobs:update"] = [];
    const res = await fn.fetch(webhookRequest(fn));
    expect(res.status).toBe(200);
    expect(notices()).toHaveLength(0);
  });

  it("payout_pending is taken out too, so the scheduled payout never selects it", async () => {
    const fn = await loadConfigured();
    failedEvent();
    fundedJob({ payment_status: "payout_pending", status: "completed", helper_confirmed_at: "2026-10-16T00:00:00Z" });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: PI, status: "canceled" });
    await fn.fetch(webhookRequest(fn));
    expect(jobUpdates()[0]?.payload).toMatchObject({ payment_status: "failed" });
  });

  it("a live PI that is NOT failed (retried and processing, or succeeded) is left alone", async () => {
    for (const status of ["processing", "succeeded", "requires_action"]) {
      resetStripeMock();
      resetSupabaseMock();
      resetSharedMocks();
      const fn = await loadConfigured();
      failedEvent();
      fundedJob();
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: PI, status });
      await fn.fetch(webhookRequest(fn));
      expect(jobUpdates(), status).toHaveLength(0);
      expect(notices(), status).toHaveLength(0);
    }
  });

  it("a failure for a DIFFERENT PaymentIntent than the one that funded the job is ignored", async () => {
    const fn = await loadConfigured();
    failedEvent("pi_old_card_decline");
    fundedJob();
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_old_card_decline", status: "requires_payment_method" });
    await fn.fetch(webhookRequest(fn));
    expect(jobUpdates()).toHaveLength(0);
    expect(notices()).toHaveLength(0);
  });

  it("already released: writes nothing and pages (the Helpr was paid from money that never arrived)", async () => {
    const fn = await loadConfigured();
    failedEvent();
    fundedJob({ payment_status: "released", status: "completed" });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: PI, status: "requires_payment_method" });
    await fn.fetch(webhookRequest(fn));
    expect(jobUpdates()).toHaveLength(0);
    expect(slackAlerts.some((a) => (a as { severity?: string }).severity === "critical")).toBe(true);
  });

  it("a Stripe read error is retried (500), never decided on the event alone", async () => {
    const fn = await loadConfigured();
    failedEvent();
    fundedJob();
    stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error("stripe down"));
    const res = await fn.fetch(webhookRequest(fn));
    expect(res.status).toBe(500);
    expect(jobUpdates()).toHaveLength(0);
  });
});
