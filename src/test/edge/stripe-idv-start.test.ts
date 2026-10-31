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
 *
 * @mutate supabase/functions/stripe-idv-start/index.ts |     if (verifiedAnyRoute === true \|\| (verifiedErr && profile?.idv_status === "verified")) { |     if (profile?.idv_status === "verified") {
 * @mutate supabase/functions/stripe-idv-start/index.ts |     if (verifiedErr && verifiedErr.code !== "PGRST202") {\n      throw |     if (false) {\n      throw
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

// Owner 2026-10-30: the 16 members Stripe verified and a reset wiped. Asking Stripe restores them, with no new
// session (never billed twice), only for THIS member's own session.
// @mutate supabase/functions/stripe-idv-start/index.ts | if (stored.status === "verified" && stored.metadata?.user_id === user.id) { | if (stored.status === "verified") {
// @mutate supabase/functions/stripe-idv-start/index.ts | if (profile?.idv_session_id && profile.idv_status === "not_started") { | if (false) {
describe("stripe-idv-start restores a check Stripe already verified", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  const seedReset = () => {
    scenario.authUser = USER;
    scenario.reads.profiles = { rows: [{ idv_status: "not_started", idv_session_id: "vs_old", full_name: "Dana R" }] };
    scenario.rpc.is_identity_verified = false;
    scenario.writeSelectRows.profiles = [{ user_id: USER.id }];
    scenario.rpc.claim_idv_attempt = { claimed: false, reason: "attempt_cap" };
  };
  const restores = () =>
    scenario.writes.filter((w) => w.table === "profiles" && w.op === "update" && (w.payload as Record<string, unknown>).idv_status === "verified");

  it("verified at Stripe for this member: recorded, no new session, no attempt spent", async () => {
    seedReset();
    stripeMock.identity.verificationSessions.retrieve.mockResolvedValue({ id: "vs_old", status: "verified", metadata: { user_id: USER.id } });
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));
    expect(res.status).toBe(200);
    expect((await json(res)).alreadyVerified).toBe(true);
    expect(restores()).toHaveLength(1);
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
    expect((scenario.rpcCalls ?? []).filter((c) => c.name === "claim_idv_attempt")).toHaveLength(0);
  });

  it("verified for ANOTHER member's id: nothing is restored", async () => {
    seedReset();
    stripeMock.identity.verificationSessions.retrieve.mockResolvedValue({ id: "vs_old", status: "verified", metadata: { user_id: "someone-else" } });
    const fn = await load();
    await fn.fetch(fn.request({ headers: AUTH, body: {} }));
    expect(restores()).toHaveLength(0);
  });

  it("not verified at Stripe: nothing is restored", async () => {
    seedReset();
    stripeMock.identity.verificationSessions.retrieve.mockResolvedValue({ id: "vs_old", status: "canceled", metadata: { user_id: USER.id } });
    const fn = await load();
    await fn.fetch(fn.request({ headers: AUTH, body: {} }));
    expect(restores()).toHaveLength(0);
  });

  it("Stripe unreadable: 503, nothing restored, no new session", async () => {
    seedReset();
    stripeMock.identity.verificationSessions.retrieve.mockRejectedValue(Object.assign(new Error("boom"), { statusCode: 500 }));
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));
    expect(res.status).toBe(503);
    expect(restores()).toHaveLength(0);
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
  });
});

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

  // Owner 2026-10-19: verified once, by ANY route, is never asked again. A
  // Connect-verified or admin-approved member (idv_status may still say
  // 'pending') gets alreadyVerified: no reuse, no claim, no Stripe call.
  it("verified by another route (the one rule, is_identity_verified): alreadyVerified, nothing reused, claimed or created", async () => {
    scenario.authUser = USER;
    scenario.reads.profiles = { rows: [{ idv_status: "pending", idv_session_id: "vs_open", full_name: "Dana R" }] };
    scenario.rpc.is_identity_verified = true;
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));

    expect(res.status).toBe(200);
    expect((await json(res)).alreadyVerified).toBe(true);
    expect(stripeMock.identity.verificationSessions.retrieve).not.toHaveBeenCalled();
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
    expect(scenario.rpcCalls?.filter((c) => c.name === "claim_idv_attempt") ?? []).toHaveLength(0);
    expect(scenario.rpcCalls?.find((c) => c.name === "is_identity_verified")?.args).toEqual({ p_user_id: "helper-1" });
  });

  it("is_identity_verified not deployed yet (PGRST202): the old answer, not an outage", async () => {
    scenario.authUser = USER;
    scenario.reads.profiles = { rows: [{ idv_status: "verified", idv_session_id: null, full_name: "Dana R" }] };
    scenario.rpcErrors = { is_identity_verified: { message: "Could not find the function", code: "PGRST202" } };
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));
    expect(res.status).toBe(200);
    expect((await json(res)).alreadyVerified).toBe(true);
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
  });

  it("an unreadable identity answer fails closed: no Stripe call", async () => {
    seedFreshHelper();
    scenario.rpcErrors = { is_identity_verified: { message: "boom" } };
    scenario.rpc.claim_idv_attempt = { claimed: true, reason: null, attempt: 1, max_attempts: 1 };
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));

    expect(res.status).toBe(500);
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
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

/**
 * RESTART (owner report 2026-10-21): a check "with our team" (manual_review)
 * may start a FRESH session when its previous session is requires_input or
 * canceled at Stripe, or cannot be read (gone, or made on the other mode), and
 * never while Stripe is processing it or has verified it. The claim is asked
 * with p_restart; its refusals (a ban, an admin's rejection, a fourth attempt)
 * still spend nothing.
 */
describe("stripe-idv-start restart from manual review", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  const claimArgs = () =>
    (scenario.rpcCalls?.filter((c) => c.name === "claim_idv_attempt") ?? []).map((c) => c.args as Record<string, unknown>);

  function inReview(sessionId: string | null = "vs_old") {
    scenario.authUser = USER;
    scenario.reads.profiles = { rows: [{ idv_status: "manual_review", idv_session_id: sessionId, full_name: "Dana R" }] };
  }

  for (const prev of ["requires_input", "canceled"]) {
    it(`previous session ${prev}: claims WITH p_restart and creates a FRESH session (never the old one)`, async () => {
      inReview();
      stripeMock.identity.verificationSessions.retrieve.mockResolvedValue({
        id: "vs_old", status: prev, url: prev === "requires_input" ? "https://verify.stripe.com/vs_old" : null,
      });
      scenario.rpc.claim_idv_attempt = { claimed: true, reason: null, attempt: 2, max_attempts: 3, restarted: true };
      stripeMock.identity.verificationSessions.create.mockResolvedValue({ id: "vs_new", url: "https://verify.stripe.com/vs_new" });
      const fn = await load();
      const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));

      expect(res.status).toBe(200);
      const out = await json(res);
      expect(out.sessionId).toBe("vs_new");
      expect(claimArgs()).toEqual([{ p_user_id: "helper-1", p_skip_fee_gate: true, p_restart: true }]);
      expect(stripeMock.identity.verificationSessions.create).toHaveBeenCalledTimes(1);
      // Idempotent as before: keyed to the claimed attempt.
      expect(stripeMock.identity.verificationSessions.create.mock.calls[0][1].idempotencyKey).toBe("idv:helper-1:2");
    });
  }

  it("previous session gone (Stripe resource_missing: other mode, or deleted): restart", async () => {
    inReview();
    stripeMock.identity.verificationSessions.retrieve.mockRejectedValue(
      Object.assign(new Error("No such verificationsession: 'vs_old'"), { code: "resource_missing", statusCode: 404 }),
    );
    scenario.rpc.claim_idv_attempt = { claimed: true, reason: null, attempt: 2, max_attempts: 3 };
    stripeMock.identity.verificationSessions.create.mockResolvedValue({ id: "vs_new", url: "https://verify.stripe.com/vs_new" });
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));
    expect(res.status).toBe(200);
    expect(claimArgs()[0].p_restart).toBe(true);
  });

  it("Stripe did not answer (429, 5xx, network): fail closed, no restart, nothing claimed or created", async () => {
    inReview();
    stripeMock.identity.verificationSessions.retrieve.mockRejectedValue(
      Object.assign(new Error("Too many requests"), { code: "rate_limit", statusCode: 429 }),
    );
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));
    expect(res.status).toBe(503);
    expect(claimArgs()).toHaveLength(0);
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
  });

  it("no stored session at all (the seed's shape): restart", async () => {
    inReview(null);
    scenario.rpc.claim_idv_attempt = { claimed: true, reason: null, attempt: 1, max_attempts: 3 };
    stripeMock.identity.verificationSessions.create.mockResolvedValue({ id: "vs_new", url: "https://verify.stripe.com/vs_new" });
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));
    expect(res.status).toBe(200);
    expect(stripeMock.identity.verificationSessions.retrieve).not.toHaveBeenCalled();
    expect(claimArgs()[0].p_restart).toBe(true);
  });

  for (const prev of ["processing", "verified"]) {
    it(`previous session ${prev} at Stripe: NO restart is asked, nothing is created`, async () => {
      inReview();
      stripeMock.identity.verificationSessions.retrieve.mockResolvedValue({ id: "vs_old", status: prev, url: null });
      scenario.rpc.claim_idv_attempt = { claimed: false, reason: "in_manual_review" };
      const fn = await load();
      const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));
      expect(claimArgs()[0].p_restart).toBe(false);
      expect(res.status).toBe(429);
      expect((await json(res)).inManualReview).toBe(true);
      expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
    });
  }

  it("an admin's rejection ('failed') is refused: 403 rejected, no Stripe session", async () => {
    scenario.authUser = USER;
    scenario.reads.profiles = { rows: [{ idv_status: "failed", idv_session_id: "vs_old", full_name: "Dana R" }] };
    scenario.rpc.claim_idv_attempt = { claimed: false, reason: "rejected" };
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));
    expect(claimArgs()[0].p_restart).toBe(false);
    expect(res.status).toBe(403);
    expect((await json(res)).rejected).toBe(true);
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
  });

  it("a banned member's restart is refused by the claim: 403, no Stripe session", async () => {
    inReview(null);
    scenario.rpc.claim_idv_attempt = { claimed: false, reason: "account_restricted" };
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));
    expect(res.status).toBe(403);
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
  });

  it("the restart cap reached: still with our team, no Stripe session", async () => {
    inReview(null);
    scenario.rpc.claim_idv_attempt = { claimed: false, reason: "in_manual_review", attempt: 3, max_attempts: 3 };
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));
    expect(res.status).toBe(429);
    expect((await json(res)).inManualReview).toBe(true);
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
  });

  it("the 4-argument claim not deployed yet (PGRST202): asks the old claim, never restarts, fails closed", async () => {
    inReview(null);
    scenario.rpcErrors = { claim_idv_attempt: { message: "Could not find the function", code: "PGRST202" } };
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));
    expect(claimArgs()).toEqual([
      { p_user_id: "helper-1", p_skip_fee_gate: true, p_restart: true },
      { p_user_id: "helper-1", p_skip_fee_gate: true },
    ]);
    expect(res.status).toBe(503);
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
  });

  it("a pending check whose session still takes input is handed back free (no restart, no claim)", async () => {
    scenario.authUser = USER;
    scenario.reads.profiles = { rows: [{ idv_status: "pending", idv_session_id: "vs_open", full_name: "Dana R" }] };
    stripeMock.identity.verificationSessions.retrieve.mockResolvedValue({ id: "vs_open", status: "requires_input", url: "https://verify.stripe.com/vs_open" });
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));
    expect((await json(res)).sessionId).toBe("vs_open");
    expect(claimArgs()).toHaveLength(0);
  });
});

// RESTART guards (vacuity): a restart offered while Stripe is still processing
// or has verified, or one never asked for, each fails a test above.
// @mutate supabase/functions/stripe-idv-start/index.ts | const RESTART_AFTER = ["requires_input", "canceled"]; | const RESTART_AFTER = ["requires_input", "canceled", "processing", "verified"];
// @mutate supabase/functions/stripe-idv-start/index.ts |       p_restart: restart,\n | \n
// @mutate supabase/functions/stripe-idv-start/index.ts |   return !previousReadable \|\| RESTART_AFTER.includes(previousStatus ?? ""); |   return RESTART_AFTER.includes(previousStatus ?? "");
// @mutate supabase/functions/stripe-idv-start/index.ts |         if (profile.idv_status !== "manual_review" && existing.status === "requires_input" && existing.url) { |         if (existing.status === "requires_input" && existing.url) {
// @mutate supabase/functions/stripe-idv-start/index.ts |         case "rejected":\n | \n
// @mutate supabase/functions/stripe-idv-start/index.ts |         if (code !== "resource_missing" && http !== 404) { |         if (false) {

// Proof this guard can fail (scripts/vacuity). Ignoring the claim's refusal is
// exactly the unbounded-billing hole this file exists for.
// @mutate supabase/functions/stripe-idv-start/index.ts | if (!claim.claimed) { | if (false) {
