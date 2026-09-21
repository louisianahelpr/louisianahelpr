/**
 * Tests for the `calculate-tax` edge function's cost gate (EF-1 / MS-5,
 * hole hunt 2026-09-15).
 *
 * `stripe.tax.calculations.create` is a BILLED Stripe Tax call. The function
 * used to run `verify_jwt = false` with no in-function auth and no rate limit,
 * so an anonymous curl loop was one billable Stripe object per iteration with
 * nothing to revoke. The fix requires a signed-in caller (the only real caller
 * — useStripeSalesTax — is reached exclusively from the ProtectedRoute-gated
 * `/post-job` checkout, so there is no legitimate anonymous caller) AND rate
 * limits per JWT-subject / per IP.
 *
 * Runs the REAL function source through the edge harness; only Supabase,
 * Stripe, the shared helpers and the Deno runtime are doubled.
 *
 * PROVEN ABLE TO FAIL 2026-09-21. Neutralising the "did this bearer resolve to
 * a real user" branch — the second half of the cost gate — answers 200 to
 * `Bearer nope`: 1 failed, 3 passed.
 */
// @mutate supabase/functions/calculate-tax/index.ts | if (authError \|\| !authData?.user) { | if (false) {
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
    STRIPE_SECRET_KEY: "sk_test_x",
  });
  return loadEdgeFunction("calculate-tax");
}

const VALID_BODY = { budget: 100, category: "cleaning", zip: "70112", state: "LA" };

describe("calculate-tax — cost gate", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
  });

  it("refuses an unauthenticated caller with 401 — not a free billable quote", async () => {
    // THE HOLE. Before the fix this reached Stripe (or answered 200) with no
    // Authorization header at all.
    scenario.authUser = null;
    const fn = await load();
    const res = await fn.fetch(fn.request({ body: VALID_BODY })); // no Authorization
    expect(res.status).toBe(401);
  });

  it("refuses a bearer that resolves to no user with 401", async () => {
    scenario.authUser = null;
    const fn = await load();
    const res = await fn.fetch(
      fn.request({ headers: { Authorization: "Bearer nope" }, body: VALID_BODY }),
    );
    expect(res.status).toBe(401);
  });

  it("rate-limits before spending anything — 429 when the limiter says stop", async () => {
    // The rate limit runs FIRST, so a flood is refused before we touch Stripe.
    rateLimitState.allowed = false;
    rateLimitState.retryAfter = 42;
    scenario.authUser = { id: "u-1", email: "poster@test.dev" };
    const fn = await load();
    const res = await fn.fetch(
      fn.request({ headers: { Authorization: "Bearer good" }, body: VALID_BODY }),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
  });

  it("still serves an authenticated caller — an exempt category returns 200 without touching Stripe", async () => {
    // Proves the guards did not break the real flow. `cleaning` is not an
    // enumerated taxable service, so the function answers before Stripe.
    scenario.authUser = { id: "u-1", email: "poster@test.dev" };
    const fn = await load();
    const res = await fn.fetch(
      fn.request({ headers: { Authorization: "Bearer good" }, body: VALID_BODY }),
    );
    expect(res.status).toBe(200);
    const body = JSON.parse(await res.text());
    expect(body).toEqual({ taxCents: 0, exempt: true });
  });
});
