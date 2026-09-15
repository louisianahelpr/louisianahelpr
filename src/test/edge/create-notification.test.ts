/**
 * EF-02 (hole hunt 2026-09-15): `create-notification` let any job counterparty
 * (or a mere applicant on a job) fan unlimited caller-supplied copy out over
 * three Helpr-branded channels (in-app + push + service-role email) with no
 * budget — a phishing and email/push-bomb primitive. It was the only
 * client-reachable notification producer without a rate limit.
 *
 * The fix adds `checkRateLimit` (keyed narrow per JWT-subject, wide per IP).
 * The relationship gate and the 200/1000-char length caps already existed and
 * are exercised here as regression guards.
 *
 * Runs the REAL function source through the edge harness.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, rateLimitState } from "./mocks/shared";
import { resetStripeMock } from "./mocks/stripe";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    PUBLISHABLE_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
  });
  return loadEdgeFunction("create-notification");
}

describe("create-notification — volume ceiling", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
  });

  it("returns 429 when the rate limiter says stop — before any fan-out", async () => {
    // THE FIX. The limiter runs ahead of auth and the insert, so a flood is
    // refused before an email or push is ever produced. Before the fix there
    // was no limiter and an authenticated caller could repeat without bound.
    rateLimitState.allowed = false;
    rateLimitState.retryAfter = 60;
    scenario.authUser = { id: "sender-1", email: "sender@test.dev" };
    const fn = await load();
    const res = await fn.fetch(
      fn.request({
        headers: { Authorization: "Bearer good" },
        body: { user_id: "sender-1", title: "hi", message: "there", type: "info" },
      }),
    );
    expect(res.status).toBe(429);
  });

  it("still rejects an over-long message with 400 (length cap regression guard)", async () => {
    scenario.authUser = { id: "sender-1", email: "sender@test.dev" };
    const fn = await load();
    const res = await fn.fetch(
      fn.request({
        headers: { Authorization: "Bearer good" },
        body: { user_id: "sender-1", title: "ok", message: "x".repeat(1001), type: "info" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("still 403s a stranger targeting another user (relationship gate regression guard)", async () => {
    // No shared job, no application either way → forbidden.
    scenario.authUser = { id: "sender-1", email: "sender@test.dev" };
    scenario.reads.jobs = { rows: [], count: 0 };
    scenario.reads.applications = { rows: [], count: 0 };
    scenario.rpc.has_role = false;
    const fn = await load();
    const res = await fn.fetch(
      fn.request({
        headers: { Authorization: "Bearer good" },
        body: {
          user_id: "11111111-1111-4111-8111-111111111111",
          title: "hi",
          message: "there",
          type: "info",
        },
      }),
    );
    expect(res.status).toBe(403);
  });
});
