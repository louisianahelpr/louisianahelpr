// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | if (failedJob && FUNDED_PAYMENT_STATES.has(String(failedJob.payment_status))) { | if (false) {
// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | if (job.stripe_payment_intent_id !== piId) { | if (false) {
// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | if (!liveStatus \|\| !FAILED_PI_STATUSES.has(liveStatus)) { | if (false) {
// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | const hired = Boolean(job.helper_id && job.helper_confirmed_at); | const hired = Boolean(job.helper_id);
// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | : job.status === "in_progress" | : job.status === "in_progressX"
// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | if (job.payment_status === "released") { | if (false) {
// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | } else if (cancelOutcome === "cancelled") { | } else if (cancelOutcome === "cancelledX") {
// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | if (cancelErr && !cancelNotDeployed) { | if (false) {
// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | } else if (cancelOutcome === "moved_on" \|\| cancelOutcome === "not_found") { | } else if (cancelOutcome === "not_found") {
// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | } else if (cancelOutcome !== "not_hired" && cancelOutcome !== "not_cancellable") { | } else if (false) {
// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | { p_job_id: job.id, p_payment_intent_id: piId, p_gift_card_id: giftCardId }, | { p_job_id: job.id, p_payment_intent_id: piId, p_gift_card_id: null },
// @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | if (giftCardId && gift?.outcome !== "returned" && gift?.outcome !== "not_consumed") { | if (false) {
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
 * Q1972 (owner, 2026-10-17): a HIRED job whose bank payment failed is
 * cancelled, with no fee and no strike, through
 * public.cancel_job_after_failed_bank_payment (20261017205845), which decides
 * under the row lock and writes the poster's and confirmed Helprs' notices in
 * the same transaction. The handler calls it first and keeps the Q1970 un-fund
 * for a job the RPC leaves alone (nobody hired, work done) or while the RPC is
 * not deployed yet. The RPC's own behaviour is proved in PGlite:
 * src/test/pglite/failedBankPaymentCancelsHiredJob.pglite.mjs.
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

function failedEvent(piId = PI, metadata: Record<string, string> = {}) {
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({
    id: `evt_${piId}`,
    type: "payment_intent.payment_failed",
    data: { object: { id: piId, metadata: { job_id: "job-ach", ...metadata } } },
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

const CANCEL_RPC = "cancel_job_after_failed_bank_payment";
/** What the cancel RPC answers for this scenario. */
function cancelAnswers(outcome: string, extra: Record<string, unknown> = {}) {
  scenario.rpc[CANCEL_RPC] = { outcome, ...extra };
}
/** The RPC is not deployed yet (edge function shipped before its migration). */
function cancelNotDeployed() {
  scenario.rpcErrors = { ...(scenario.rpcErrors ?? {}), [CANCEL_RPC]: { message: "Could not find the function", code: "PGRST202" } };
}
const cancelCalls = () => (scenario.rpcCalls ?? []).filter((c) => c.name === CANCEL_RPC);

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

  it("replays 7440a72d (hired, unconfirmed): the job is CANCELLED through the sanctioned RPC, pinned to its own PI", async () => {
    const fn = await loadConfigured();
    failedEvent();
    fundedJob();
    cancelAnswers("cancelled", { helpers_told: [] });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: PI, status: "requires_payment_method", amount_received: 0 });
    const res = await fn.fetch(webhookRequest(fn));
    expect(res.status).toBe(200);

    expect(cancelCalls().map((c) => c.args)).toEqual([{ p_job_id: "job-ach", p_payment_intent_id: PI, p_gift_card_id: null }]);
    // The RPC did the whole cancel: the handler writes no second jobs row and
    // no notice of its own (the RPC wrote the poster's in the same transaction).
    expect(jobUpdates()).toHaveLength(0);
    expect(notices()).toHaveLength(0);
    expect(slackAlerts.some((a) => /cancelled/.test(String((a as { title?: string }).title)))).toBe(true);
  });

  it("hired and confirmed: cancelled the same way; the handler adds no notice of its own", async () => {
    const fn = await loadConfigured();
    failedEvent();
    fundedJob({ helper_confirmed_at: "2026-10-16T18:40:55Z" });
    cancelAnswers("cancelled", { helpers_told: ["helper-1"] });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: PI, status: "requires_payment_method" });
    const res = await fn.fetch(webhookRequest(fn));
    expect(res.status).toBe(200);
    expect(cancelCalls()).toHaveLength(1);
    expect(jobUpdates()).toHaveLength(0);
    expect(notices()).toHaveLength(0);
  });

  it("a job part-paid by a gift card: the RPC is handed the gift the checkout spent, and a gift it did not give back pages ops", async () => {
    for (const [giftOutcome, pages] of [["returned", false], ["not_consumed", false], ["not_deployed", true], ["checkout_open", true]] as const) {
      resetStripeMock();
      resetSupabaseMock();
      resetSharedMocks();
      const fn = await loadConfigured();
      failedEvent(PI, { gift_card_id: "gift-1" });
      fundedJob();
      cancelAnswers("cancelled", { helpers_told: [], gift: { outcome: giftOutcome } });
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: PI, status: "requires_payment_method" });
      const res = await fn.fetch(webhookRequest(fn));
      expect(res.status, giftOutcome).toBe(200);
      expect(cancelCalls().map((c) => c.args), giftOutcome).toEqual([{ p_job_id: "job-ach", p_payment_intent_id: PI, p_gift_card_id: "gift-1" }]);
      // The gift goes back inside the RPC only: the handler never calls a
      // second gift return (exactly once).
      expect((scenario.rpcCalls ?? []).filter((c) => c.name !== CANCEL_RPC), giftOutcome).toEqual([]);
      const paged = slackAlerts.some((a) => /gift card was NOT returned/.test(String((a as { title?: string }).title)));
      expect(paged, giftOutcome).toBe(pages);
    }
  });

  it("the job moved on under the lock (another PI, refunded, released): nothing is written and nobody told", async () => {
    for (const outcome of ["moved_on", "not_found"]) {
      resetStripeMock();
      resetSupabaseMock();
      resetSharedMocks();
      const fn = await loadConfigured();
      failedEvent();
      fundedJob({ helper_confirmed_at: "2026-10-16T00:00:00Z" });
      cancelAnswers(outcome);
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: PI, status: "requires_payment_method" });
      const res = await fn.fetch(webhookRequest(fn));
      expect(res.status, outcome).toBe(200);
      expect(jobUpdates(), outcome).toHaveLength(0);
      expect(notices(), outcome).toHaveLength(0);
    }
  });

  it("an RPC error is retried (500) with nothing written; an answer the handler does not know is too", async () => {
    for (const setup of [
      () => { scenario.rpcErrors = { [CANCEL_RPC]: { message: "deadlock detected", code: "40P01" } }; },
      () => cancelAnswers("something_new"),
    ]) {
      resetStripeMock();
      resetSupabaseMock();
      resetSharedMocks();
      const fn = await loadConfigured();
      failedEvent();
      fundedJob();
      setup();
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: PI, status: "requires_payment_method" });
      const res = await fn.fetch(webhookRequest(fn));
      expect(res.status).toBe(500);
      expect(jobUpdates()).toHaveLength(0);
      expect(notices()).toHaveLength(0);
    }
  });

  it("nobody hired (not_hired): Q1970's un-fund — out of escrow, poster told plainly", async () => {
    const fn = await loadConfigured();
    failedEvent();
    fundedJob({ status: "open", helper_id: null });
    cancelAnswers("not_hired");
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
    expect(n.map((x) => x.user_id)).toEqual(["poster-1"]);
    expect(String(n[0].message)).toMatch(/bank payment .* didn't go through/);
    expect(String(n[0].message)).toMatch(/isn't paid for/);
    expect(slackAlerts.length).toBeGreaterThan(0);
  });

  it("before the RPC is deployed (PGRST202) the hired job still leaves escrow; only a confirmed Helpr is told", async () => {
    for (const [confirmedAt, users] of [[null, ["poster-1"]], ["2026-10-16T18:40:55Z", ["helper-1", "poster-1"]]] as const) {
      resetStripeMock();
      resetSupabaseMock();
      resetSharedMocks();
      const fn = await loadConfigured();
      failedEvent();
      fundedJob({ helper_confirmed_at: confirmedAt });
      cancelNotDeployed();
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: PI, status: "requires_payment_method" });
      const res = await fn.fetch(webhookRequest(fn));
      expect(res.status).toBe(200);
      expect(jobUpdates()[0]?.payload).toEqual({ payment_status: "failed", stripe_session_id: null });
      const n = notices();
      expect(n.map((x) => x.user_id).sort()).toEqual([...users]);
      if (confirmedAt) {
        expect(String(n.find((x) => x.user_id === "helper-1")!.message)).toMatch(/don't start work/);
        // A hired job is not "hireable again" and cannot be re-checked-out from
        // My Posts (which hides 'failed'): no promise of a button that isn't there.
        const poster = n.find((x) => x.user_id === "poster-1")!;
        expect(String(poster.message)).not.toMatch(/hire|pay again|Post a Job/i);
        expect(poster.link).toBeNull();
      }
    }
  });

  it("not yet deployed: a Helpr mid-job is asked to stop; work done (not_cancellable): the payout is on hold", async () => {
    for (const [over, want, setup] of [
      [{ status: "in_progress" }, /stop work on it/, cancelNotDeployed],
      [{ status: "completed", payment_status: "payout_pending" }, /payout for it is on hold/, () => cancelAnswers("not_cancellable")],
    ] as const) {
      resetStripeMock();
      resetSupabaseMock();
      resetSharedMocks();
      const fn = await loadConfigured();
      failedEvent();
      fundedJob({ helper_confirmed_at: "2026-10-16T00:00:00Z", ...over });
      setup();
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: PI, status: "requires_payment_method" });
      await fn.fetch(webhookRequest(fn));
      const helper = notices().find((x) => x.user_id === "helper-1");
      expect(String(helper?.message), JSON.stringify(over)).toMatch(want);
    }
  });

  it("zero rows (a refund, cancel or release moved the job first) tells nobody", async () => {
    const fn = await loadConfigured();
    failedEvent();
    fundedJob({ helper_confirmed_at: "2026-10-16T00:00:00Z", status: "completed" });
    cancelAnswers("not_cancellable");
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
    cancelAnswers("not_cancellable");
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
      expect(cancelCalls(), status).toHaveLength(0);
    }
  });

  it("a failure for a DIFFERENT PaymentIntent than the one that funded the job is ignored", async () => {
    const fn = await loadConfigured();
    failedEvent("pi_old_card_decline");
    fundedJob();
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_old_card_decline", status: "requires_payment_method" });
    await fn.fetch(webhookRequest(fn));
    expect(cancelCalls()).toHaveLength(0);
    expect(jobUpdates()).toHaveLength(0);
    expect(notices()).toHaveLength(0);
  });

  it("already released: writes nothing and pages (the Helpr was paid from money that never arrived)", async () => {
    const fn = await loadConfigured();
    failedEvent();
    fundedJob({ payment_status: "released", status: "completed" });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: PI, status: "requires_payment_method" });
    await fn.fetch(webhookRequest(fn));
    expect(cancelCalls()).toHaveLength(0); // a released job stays page-only
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
    expect(cancelCalls()).toHaveLength(0);
    expect(jobUpdates()).toHaveLength(0);
  });
});
