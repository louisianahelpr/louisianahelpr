/**
 * "Stuck payment — webhook may be failing" means Stripe TOOK the money and our
 * side never settled the job (owner report, 2026-10-09).
 *
 * THE FALSE ALARM. detect_stuck_payments paged at 12:15Z on 2026-10-09 for
 * Ben's "Grass cutting" job (bcf08d0b): 10 minutes after posting, the job was
 * still 'unpaid' with a Checkout Session. Measured read-only in live Stripe the
 * same day: that session (cs_live_b1zHlX4z…) was 'open'/'unpaid' with no
 * PaymentIntent (now 'expired'/'unpaid'). He never paid. SQL could not ask
 * Stripe, so a checkout someone walked away from looked like a dropped
 * webhook.
 *
 * THE FIX. stuck-payment-check reads each candidate's session from Stripe and
 * records whether it took the money (stuck_payment_stripe_checks.money_moved);
 * detect_stuck_payments alerts only on money_moved (migration
 * 20261009223355_stuck_payment_needs_stripe_proof.sql, its static guard
 * src/test/stuckPaymentNeedsStripeProof.test.ts, and the PGlite proof
 * src/test/pglite/stuckPaymentNeedsStripeProof.pglite.mjs).
 *
 * Both cases are pinned here with Stripe's real shapes: the paid session of
 * Ben's second job (1e16c281: 'complete'/'paid', pi_3UOciY…) is the true
 * positive; the open/unpaid session of the first is the false one.
 *
 * @mutate supabase/functions/stuck-payment-check/index.ts |   return session.status === "complete"\n    && (session.payment_status === "paid" \|\| session.payment_status === "no_payment_required"); |   return session.status === "complete" \|\| session.status === "open";
 * @mutate supabase/functions/stuck-payment-check/index.ts |   return session.status === "complete"\n    && (session.payment_status === "paid" \|\| session.payment_status === "no_payment_required"); |   return session.payment_status === "unpaid";
 * @mutate supabase/functions/stuck-payment-check/index.ts |   const denied = verifyCronSecret(req);\n  if (denied) return denied; |   const denied = null;
 * @mutate supabase/functions/stuck-payment-check/index.ts |           defects.record(`session ${job.stripe_session_id} (job ${job.id}) could not be read: ${caughtMessage(e)}`); |           void e;
 * @mutate supabase/functions/stuck-payment-check/index.ts |     if (error) return cronError(FN, `candidate read failed: ${error.message}`, corsHeaders); |     if (error) void error;
 * @mutate supabase/functions/stuck-payment-check/index.ts |       .lt("created_at", new Date(now - MIN_AGE_MS).toISOString()) |       .lt("created_at", new Date(now - 15 * 60 * 1000).toISOString())
 * @mutate supabase/functions/stuck-payment-check/index.ts |         if (!isTestObjectUnderLiveKey(e)) { |         if (!isTestObjectUnderLiveKey(e) && (e as { statusCode?: number })?.statusCode !== 404) {
 * @mutate supabase/functions/stuck-payment-check/index.ts |           if (r.money_moved === true \|\| r.session_status === "expired" \|\| r.session_status === "missing") { |           if (r.money_moved === true \|\| r.session_status === "expired" \|\| r.session_status === "missing" \|\| r.session_status === "open") {
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

const UNFINISHED_JOB = "bcf08d0b-47bd-46bf-971d-5d59f59f61ac";
const UNFINISHED_SESSION = "cs_live_b1zHlX4z_unfinished";
const PAID_JOB = "1e16c281-e9fc-4d9a-9380-1ecefdac8932";
const PAID_SESSION = "cs_live_b1Dqmjkck_paid";

/** Stripe's answer for each session, in the shapes measured on 2026-10-09. */
const SESSIONS: Record<string, Record<string, unknown>> = {
  [UNFINISHED_SESSION]: { id: UNFINISHED_SESSION, status: "open", payment_status: "unpaid", payment_intent: null },
  [PAID_SESSION]: { id: PAID_SESSION, status: "complete", payment_status: "paid", payment_intent: "pi_3UOciYKp2H4b7tEC0P1HGQxH" },
};

const checkWrites = () => scenario.writes.filter((w) => w.table === "stuck_payment_stripe_checks");
const recorded = () => checkWrites().flatMap((w) => (Array.isArray(w.payload) ? w.payload : [w.payload]) as Array<Record<string, unknown>>);

async function cron(bearer = "service-key") {
  const fn = await loadEdgeFunction("stuck-payment-check");
  return fn.fetch(fn.request({
    url: "https://edge.test/stuck-payment-check",
    headers: { Authorization: `Bearer ${bearer}` },
    body: {},
  }));
}

describe("stuck-payment-check: only a checkout that took the money counts as stuck", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_live_x",
    });
    scenario.reads.jobs = {
      rows: [
        { id: UNFINISHED_JOB, stripe_session_id: UNFINISHED_SESSION },
        { id: PAID_JOB, stripe_session_id: PAID_SESSION },
      ],
    };
    scenario.reads.stuck_payment_stripe_checks = { rows: [] };
    stripeMock.checkout.sessions.retrieve.mockImplementation(async (id: string) => SESSIONS[id]);
  });
  afterEach(() => resetEnv());

  it("records the paid checkout as money moved and the unfinished one as not (the 2026-10-09 pair)", async () => {
    const res = await cron();
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ fn: "stuck-payment-check", candidates: 2, checked: 2, paid: 1, defects: 0 });
    const rows = recorded();
    expect(rows, "inventory floor: one answer per candidate").toHaveLength(2);
    const byJob = Object.fromEntries(rows.map((r) => [r.job_id, r]));
    // TRUE POSITIVE stays: complete + paid is money our webhook must settle.
    expect(byJob[PAID_JOB]).toMatchObject({
      stripe_session_id: PAID_SESSION, session_status: "complete", payment_status: "paid",
      money_moved: true, payment_intent_id: "pi_3UOciYKp2H4b7tEC0P1HGQxH",
    });
    // FALSE POSITIVE goes: an open, unpaid checkout took nothing.
    expect(byJob[UNFINISHED_JOB]).toMatchObject({
      stripe_session_id: UNFINISHED_SESSION, session_status: "open", payment_status: "unpaid",
      money_moved: false, payment_intent_id: null,
    });
  });

  it("expired, and complete-but-unpaid (an async bank payment still settling), are not money moved", async () => {
    SESSIONS[UNFINISHED_SESSION] = { id: UNFINISHED_SESSION, status: "expired", payment_status: "unpaid", payment_intent: null };
    SESSIONS[PAID_SESSION] = { id: PAID_SESSION, status: "complete", payment_status: "unpaid", payment_intent: "pi_async" };
    try {
      const res = await cron();
      expect(res.status).toBe(200);
      expect(recorded().map((r) => r.money_moved)).toEqual([false, false]);
    } finally {
      SESSIONS[UNFINISHED_SESSION] = { id: UNFINISHED_SESSION, status: "open", payment_status: "unpaid", payment_intent: null };
      SESSIONS[PAID_SESSION] = { id: PAID_SESSION, status: "complete", payment_status: "paid", payment_intent: "pi_3UOciYKp2H4b7tEC0P1HGQxH" };
    }
  });

  it("reads only unpaid jobs with a session, 5 minutes to 24 hours old", async () => {
    const before = Date.now();
    await cron();
    const read = scenario.readQueries.find((q) => q.table === "jobs");
    expect(read, "the candidate read happened").toBeTruthy();
    const f = read!.filters;
    expect(f).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "not", column: "stripe_session_id", operator: "is", value: null }),
      expect.objectContaining({ op: "eq", column: "payment_status", value: "unpaid" }),
    ]));
    // Wider than the detector's 10 minutes, so every detector candidate
    // already has Stripe's answer when the detector runs 3 minutes later.
    const lt = f.find((x) => x.op === "lt" && x.column === "created_at");
    const gt = f.find((x) => x.op === "gt" && x.column === "created_at");
    const ageMin = (iso: unknown) => (before - Date.parse(String(iso))) / 60000;
    expect(ageMin(lt?.value)).toBeGreaterThan(4.9);
    expect(ageMin(lt?.value)).toBeLessThan(5.1);
    expect(ageMin(gt?.value) / 60).toBeGreaterThan(23.9);
  });

  it("a session Stripe cannot read is a defect (500) and gets NO answer, so the detector cannot treat it as unpaid", async () => {
    stripeMock.checkout.sessions.retrieve.mockImplementation(async (id: string) => {
      if (id === PAID_SESSION) throw new Error("stripe 503");
      return SESSIONS[id];
    });

    const res = await cron();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(JSON.stringify(body.defectReasons)).toContain("could not be read");
    expect(recorded().map((r) => r.job_id)).toEqual([UNFINISHED_JOB]);
  });

  it("a 404 is NOT proof the checkout took no money (a wrong or rotated key 404s every live session): defect, no answer", async () => {
    stripeMock.checkout.sessions.retrieve.mockImplementation(async (id: string) => {
      if (id === PAID_SESSION) throw Object.assign(new Error("No such checkout.session: a similar object exists in live mode, but a test mode key was used"), { statusCode: 404, code: "resource_missing" });
      return SESSIONS[id];
    });

    const res = await cron();
    expect(res.status).toBe(500);
    // The paid job gets NO "not paid" answer, so the detector files it as awaiting_stripe.
    expect(recorded().map((r) => r.job_id)).toEqual([UNFINISHED_JOB]);
  });

  it("only a TEST-mode session under the live key is recorded as missing (it can never take live money)", async () => {
    stripeMock.checkout.sessions.retrieve.mockImplementation(async (id: string) => {
      if (id === UNFINISHED_SESSION) throw Object.assign(new Error("No such checkout.session; a similar object exists in test mode, but a live mode key was used to make this request."), { statusCode: 404, code: "resource_missing" });
      return SESSIONS[id];
    });

    const res = await cron();
    expect(res.status).toBe(200);
    const byJob = Object.fromEntries(recorded().map((r) => [r.job_id, r]));
    expect(byJob[UNFINISHED_JOB]).toMatchObject({ session_status: "missing", money_moved: false });
    expect(byJob[PAID_JOB]).toMatchObject({ money_moved: true });
  });

  it("an answer that can never change for the same session is not re-read; an open one is", async () => {
    scenario.reads.stuck_payment_stripe_checks = {
      rows: [
        { job_id: PAID_JOB, stripe_session_id: PAID_SESSION, session_status: "complete", money_moved: true },
        { job_id: UNFINISHED_JOB, stripe_session_id: UNFINISHED_SESSION, session_status: "open", money_moved: false },
      ],
    };

    const res = await cron();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ candidates: 2, skipped_final: 1, checked: 1 });
    expect(stripeMock.checkout.sessions.retrieve).toHaveBeenCalledTimes(1);
    expect(stripeMock.checkout.sessions.retrieve).toHaveBeenCalledWith(UNFINISHED_SESSION);
  });

  it("an unreadable candidate list is a failed run, not a clean one", async () => {
    scenario.reads.jobs = { error: { message: "boom", code: "XX000" } };

    const res = await cron();

    expect(res.status).toBe(500);
    expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
    expect(checkWrites()).toEqual([]);
  });

  it("only the schedule may run it: a user token is refused and Stripe is not read", async () => {
    const res = await cron("some-user-jwt");

    expect(res.status).toBe(401);
    expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
  });

  it("never writes to Stripe: no expire, no create", async () => {
    await cron();
    expect(stripeMock.checkout.sessions.expire).not.toHaveBeenCalled();
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });
});
