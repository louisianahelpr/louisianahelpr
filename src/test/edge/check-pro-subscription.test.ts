/**
 * Tests for `check-pro-subscription` failing CLOSED (EF-01, hole hunt
 * 2026-09-15).
 *
 * The outer catch used to answer HTTP 200 {subscribed:false, tier:null} on ANY
 * internal failure — a Stripe blip, a network hiccup, an auth error. The
 * client's `unwrap` reads a 200 as success, so a paying member's tier was
 * silently overwritten with `null` and their membership chip dropped to free.
 *
 * The fix: auth failures return 401, internal failures return a 5xx carrying
 * NO subscription verdict, so the client keeps its placeholderData (the
 * profile's own subscription_tier column) instead of a confident wrong answer.
 *
 * Runs the REAL function source through the edge harness.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetStripeMock, stripeMock } from "./mocks/stripe";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    PUBLISHABLE_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_x",
  });
  return loadEdgeFunction("check-pro-subscription");
}

describe("check-pro-subscription — fail closed", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
  });

  it("returns 401 for a missing auth header — never a confident 'not subscribed'", async () => {
    // Before the fix: 200 {subscribed:false, tier:null}.
    const fn = await load();
    const res = await fn.fetch(fn.request({ body: {} })); // no Authorization
    expect(res.status).toBe(401);
    const body = JSON.parse(await res.text());
    expect(body).not.toHaveProperty("subscribed");
  });

  it("returns 401 when the bearer resolves to no user", async () => {
    scenario.authUser = null;
    const fn = await load();
    const res = await fn.fetch(
      fn.request({ headers: { Authorization: "Bearer nope" }, body: {} }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 5xx with NO verdict when Stripe throws mid-check", async () => {
    // THE REGRESSION. Auth is fine, the profile reads fine, but the Stripe
    // lookup blows up. Before the fix this booked a 200 {subscribed:false},
    // silently demoting a paying member.
    scenario.authUser = { id: "u-1", email: "member@test.dev" };
    scenario.reads.profiles = {
      rows: [{ subscription_tier: "pro", subscription_expires_at: null }],
    };
    stripeMock.customers.list.mockRejectedValue(new Error("Stripe unreachable"));

    const fn = await load();
    const res = await fn.fetch(
      fn.request({ headers: { Authorization: "Bearer good" }, body: {} }),
    );
    expect(res.status).toBeGreaterThanOrEqual(500);
    const body = JSON.parse(await res.text());
    // The whole point: it emits no subscription verdict the client could
    // mistake for "you are not a member".
    expect(body).not.toHaveProperty("subscribed");
    expect(body).not.toHaveProperty("tier");
  });

  it("still returns 503 when the profile read itself fails", async () => {
    // The branch that was already correct — kept as a regression guard.
    scenario.authUser = { id: "u-1", email: "member@test.dev" };
    scenario.reads.profiles = { error: { message: "db down" } };
    const fn = await load();
    const res = await fn.fetch(
      fn.request({ headers: { Authorization: "Bearer good" }, body: {} }),
    );
    expect(res.status).toBe(503);
    const body = JSON.parse(await res.text());
    expect(body).not.toHaveProperty("subscribed");
  });
});
