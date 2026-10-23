/**
 * ID check off (owner ruling by pop-up 2026-10-23: "just remove the verify id
 * entirely, we will move to paypal"): stripe-idv-start starts no ID check while
 * the `identity_check` switch is off for the caller.
 *   - switch off: 409 { code: "identity_check_off" }, no Stripe Identity session,
 *     no claim_idv_attempt (nothing counted, nothing charged);
 *   - a switch read that FAILS is not "off": 503 "try again" (the gates may still
 *     require the ID), still no Stripe session and no claim;
 *   - the switch is asked for the VERIFIED caller, never a body id;
 *   - switch on: the function goes on to its normal path (it reaches the claim).
 * Runs the REAL function source through the edge harness (nothing reaches Stripe).
 *
 * @mutate supabase/functions/stripe-idv-start/index.ts |     if (idSwitch !== true) { |     if (false) {
 * @mutate supabase/functions/stripe-idv-start/index.ts |       p_key: "identity_check",\n      p_user_id: user.id, |       p_key: "identity_checks",\n      p_user_id: user.id,
 * @mutate supabase/functions/stripe-idv-start/index.ts |     if (idSwitchErr) { |     if (false) {
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const AUTH = { Authorization: "Bearer test-jwt" };
const USER = { id: "77777777-7777-4777-8777-777777777777", email: "member@test.com" };

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc123",
  });
  return loadEdgeFunction("stripe-idv-start");
}

const asks = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "feature_enabled_for_user");
const claims = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "claim_idv_attempt");

describe("stripe-idv-start while the ID check is off", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
    scenario.authUser = USER;
    scenario.reads.profiles = { rows: [{ idv_status: null, idv_session_id: null, full_name: "Dana R" }] };
    scenario.rpc.is_identity_verified = false;
    scenario.rpc.claim_idv_attempt = { claimed: false, reason: "attempt_limit_reached", attempt: 1 };
  });

  it("switch off: 409 identity_check_off, no Stripe session and no attempt claimed", async () => {
    scenario.rpc.feature_enabled_for_user = false;
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: { user_id: "88888888-8888-4888-8888-888888888888" } }));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("identity_check_off");
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
    expect(claims()).toEqual([]);
    expect(asks().map((a) => a.args)).toEqual([{ p_key: "identity_check", p_user_id: USER.id }]);
  });

  it("a switch read that fails says try again (503), never 'nothing is needed'", async () => {
    scenario.rpcErrors = { feature_enabled_for_user: { message: "switch read boom" } };
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toMatch(/nothing is needed/i);
    expect(stripeMock.identity.verificationSessions.create).not.toHaveBeenCalled();
    expect(claims()).toEqual([]);
  });

  it("switch on: the normal path runs (it reaches the attempt claim)", async () => {
    scenario.rpc.feature_enabled_for_user = true;
    const fn = await load();
    const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));
    expect(res.status).not.toBe(409);
    expect(claims().length).toBeGreaterThan(0);
  });
});
