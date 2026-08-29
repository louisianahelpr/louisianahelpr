/**
 * Unit tests for the `stripe-idv-start` edge function's COST GUARD.
 *
 * Every `identity.verificationSessions.create` on this path is billed to the
 * platform, on a LIVE Stripe account. Before 2026-08-27 the function had no
 * rate limit, no attempt counter, no idempotency key and no payment check — any
 * signed-in user whose `idv_status` was not `verified`/`pending`/`processing`
 * could loop it and run up an unbounded bill.
 *
 * So the assertions that matter here are all of the same shape: **Stripe was
 * not called.** A test that only checks the status code would pass while the
 * money still moved.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { rateLimitState, resetSharedMocks } from "./mocks/shared";

const AUTH = { Authorization: "Bearer test-jwt" };
const USER = { id: "helper-1", email: "helper@test.com" };

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc123",
  });
  return loadEdgeFunction("stripe-idv-start");
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

/** Signed-in helper with a profile that has never attempted verification. */
function seedFreshHelper() {
  scenario.authUser = USER;
  scenario.reads.profiles = {
    rows: [{ idv_status: null, idv_session_id: null, full_name: "Dana R" }],
  };
}

describe("stripe-idv-start cost guard", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("does not touch Stripe when the claim refuses for an unpaid setup fee", async () => {
    seedFreshHelper();
    scenario.rpc.claim_idv_attempt = { claimed: false, reason: "onboarding_fee_unpaid" };
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));

    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
    expect(res.status).toBe(402);
    // The flag is what turns a refusal into a pay-now button in the client
    // instead of a toast about a fee with no way to settle it.
    expect((await json(res)).needsOnboardingFee).toBe(true);
  });

  it("does not touch Stripe once the attempt cap is reached", async () => {
    seedFreshHelper();
    scenario.rpc.claim_idv_attempt = {
      claimed: false,
      reason: "attempt_limit_reached",
      attempt: 1,
      max_attempts: 1,
    };
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));

    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
    expect(res.status).toBe(429);
  });

  it("does not touch Stripe for an account already in manual review", async () => {
    // The one paid attempt is spent and a human has it. A second session here
    // would bill the platform again AND stomp the reviewable state back to
    // 'pending', dropping the person out of the admin queue.
    seedFreshHelper();
    scenario.rpc.claim_idv_attempt = { claimed: false, reason: "in_manual_review" };
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));

    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
    expect(res.status).toBe(429);
    expect((await json(res)).inManualReview).toBe(true);
  });

  it("does not touch Stripe for a banned account", async () => {
    seedFreshHelper();
    scenario.rpc.claim_idv_attempt = { claimed: false, reason: "account_restricted" };
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));

    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
    expect(res.status).toBe(403);
  });

  it("fails CLOSED when the claim itself errors — an unreadable cap is not permission to spend", async () => {
    seedFreshHelper();
    scenario.rpcErrors = { claim_idv_attempt: { message: "boom" } };
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));

    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
    expect(res.status).toBe(503);
  });

  it("creates exactly one session, keyed to the claimed attempt, when the claim succeeds", async () => {
    seedFreshHelper();
    scenario.rpc.claim_idv_attempt = { claimed: true, reason: null, attempt: 1, max_attempts: 1 };
    stripeMock.identity.verificationSessions.create.mockResolvedValue({
      id: "vs_1",
      url: "https://verify.stripe.com/vs_1",
    });
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));

    expect(res.status).toBe(200);
    expect(stripeMock.identity.verificationSessions.create).toHaveBeenCalledTimes(1);
    // The idempotency key is what stops a retried request (a dropped response,
    // a bounced native handoff) billing for a second session.
    const opts = stripeMock.identity.verificationSessions.create.mock.calls[0][1];
    expect(opts.idempotencyKey).toBe("idv:helper-1:1");
  });

  it("reuses an open session WITHOUT claiming an attempt — reuse is free, so it must not cost one", async () => {
    scenario.authUser = USER;
    scenario.reads.profiles = {
      rows: [{ idv_status: "pending", idv_session_id: "vs_open", full_name: "Dana R" }],
    };
    stripeMock.identity.verificationSessions.retrieve.mockResolvedValue({
      id: "vs_open",
      status: "requires_input",
      url: "https://verify.stripe.com/vs_open",
    });
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));

    expect(res.status).toBe(200);
    expect((await json(res)).sessionId).toBe("vs_open");
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
    const claimCalls = scenario.rpcCalls?.filter((c) => c.name === "claim_idv_attempt") ?? [];
    expect(claimCalls).toHaveLength(0);
  });

  it("returns 429 without reaching auth when the rate limiter rejects", async () => {
    rateLimitState.allowed = false;
    rateLimitState.retryAfter = 30;
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
  });
});
