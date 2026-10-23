/**
 * Payout setup pause (owner ruling by pop-up, 2026-10-23): Stripe closed Helpr's
 * platform account, so stripe-connect refuses every payout-SETUP action while
 * the `payout_setup` switch is off for the caller, before any Stripe call:
 *   - onboard, update_onboarding and reset answer 409 { code:
 *     "payout_setup_paused" } with the calm notice's words, and make NO Stripe
 *     call (no accounts.create, no accountLinks.create, no accounts.del);
 *   - a switch read that FAILS refuses the same way (fails closed);
 *   - the switch is asked for the VERIFIED caller (auth.getUser), never a body id;
 *   - the non-Express arm of `dashboard` (an Account Link) is refused too;
 *   - with the switch on, onboard still creates the account and the link (the
 *     refusal is the switch, not a blanket stop);
 *   - status, list_payout_methods and delete_payout_method are not setup and
 *     still answer while paused.
 *
 * Runs the REAL function source through the edge harness (Stripe and Supabase
 * are doubled; nothing here reaches Stripe). The static class guard (every
 * action and every account/link call classified) is
 * src/test/payoutSetupPausedEntryPoints.test.ts.
 *
 * @mutate supabase/functions/stripe-connect/index.ts | if (PAYOUT_SETUP_ACTIONS.has(action) && (await payoutSetupPausedFor(supabaseAdmin, user))) { | if (false) {
 * @mutate supabase/functions/stripe-connect/index.ts |       if (account.type !== "express" && (await payoutSetupPausedFor(supabaseAdmin, user))) { |       if (false) {
 * @mutate supabase/functions/_shared/payoutSetupPause.ts | export const PAYOUT_SETUP_ACTIONS: ReadonlySet<string> = new Set(["onboard", "update_onboarding", "reset"]); | export const PAYOUT_SETUP_ACTIONS: ReadonlySet<string> = new Set(["onboard", "update_onboarding"]);
 * @mutate supabase/functions/_shared/payoutSetupPause.ts |   return !(await featureEnabledForUser(client, PAYOUT_SETUP_SWITCH, user)); |   return !(await featureEnabledForUser(client, "payout_setup_v2", user));
 * @mutate supabase/functions/_shared/payoutSetupPause.ts |     { status: 409, headers: |     { status: 200, headers:
 * @mutate supabase/functions/_shared/featureSwitch.ts |       return false;\n    }\n    return data === true; |       return true;\n    }\n    return data === true;
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { PAYOUT_SETUP_PAUSED_COPY } from "@/lib/payoutSetupPaused";

const REAL = { id: "55555555-5555-4555-8555-555555555555", email: "real@example.test" };
const ON_FILE = "acct_on_file";
const RETURN_URL = "https://louisianahelpr.com/profile";

async function call(body: Record<string, unknown>) {
  const fn = await loadEdgeFunction("stripe-connect");
  return fn.fetch(fn.request({ headers: { Authorization: "Bearer good" }, body }));
}

const stripeSetupCalls = () =>
  stripeMock.accounts.create.mock.calls.length +
  stripeMock.accountLinks.create.mock.calls.length +
  stripeMock.accounts.del.mock.calls.length;

const switchAsks = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "feature_enabled_for_user");

describe("payout setup paused: stripe-connect refuses setup before any Stripe call", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_live_real_money",
      STRIPE_TEST_SECRET_KEY: "sk_test_sandbox",
    });
    scenario.authUser = REAL;
    scenario.reads.test_accounts = { rows: [] };
    scenario.reads.error_logs = { rows: [], count: 0 };
    stripeMock.accounts.create.mockResolvedValue({ id: "acct_new" });
    stripeMock.accounts.retrieve.mockResolvedValue({ id: ON_FILE, type: "express" });
    stripeMock.accounts.del.mockResolvedValue({ id: ON_FILE, deleted: true });
    stripeMock.accountLinks.create.mockResolvedValue({ url: "https://connect.stripe.test/onboard" });
    // The pause: the switch is OFF for this caller.
    scenario.rpc.feature_enabled_for_user = false;
  });
  afterEach(() => resetEnv());

  const SETUP_CASES: Array<{ action: string; accountOnFile: string | null }> = [
    { action: "onboard", accountOnFile: null },
    { action: "onboard", accountOnFile: ON_FILE },
    { action: "update_onboarding", accountOnFile: ON_FILE },
    { action: "reset", accountOnFile: ON_FILE },
  ];

  it("reads a real inventory (floor)", () => {
    expect(SETUP_CASES.length).toBeGreaterThan(3);
  });

  for (const c of SETUP_CASES) {
    it(`${c.action} (account on file: ${c.accountOnFile ?? "none"}) answers 409 payout_setup_paused and calls Stripe for nothing`, async () => {
      scenario.reads.profiles = { rows: [{ stripe_account_id: c.accountOnFile, full_name: "Real Person" }] };

      const res = await call({ action: c.action, return_url: RETURN_URL });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe("payout_setup_paused");
      expect(body.error).toBe(PAYOUT_SETUP_PAUSED_COPY);
      expect(body.url).toBeUndefined();
      expect(stripeSetupCalls()).toBe(0);
      expect(scenario.writes.filter((w) => w.table === "profiles")).toEqual([]);
      // Asked for the VERIFIED caller, of the payout_setup switch.
      expect(switchAsks().map((a) => a.args)).toEqual([{ p_key: "payout_setup", p_user_id: REAL.id }]);
    });
  }

  it("a switch read that fails refuses too (fails closed)", async () => {
    scenario.rpcErrors = { feature_enabled_for_user: { message: "switch read boom" } };
    scenario.reads.profiles = { rows: [{ stripe_account_id: null, full_name: "Real Person" }] };

    const res = await call({ action: "onboard", return_url: RETURN_URL });

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("payout_setup_paused");
    expect(stripeSetupCalls()).toBe(0);
  });

  it("a body that names another user changes nothing: the switch is asked for the signed-in caller", async () => {
    scenario.reads.profiles = { rows: [{ stripe_account_id: null, full_name: "Real Person" }] };

    const res = await call({ action: "onboard", return_url: RETURN_URL, user_id: "66666666-6666-4666-8666-666666666666" });

    expect(res.status).toBe(409);
    expect(switchAsks().map((a) => (a.args as { p_user_id: string }).p_user_id)).toEqual([REAL.id]);
  });

  it("dashboard for a non-Express account (an Account Link) is refused before the link and before any Stripe write", async () => {
    scenario.reads.profiles = { rows: [{ stripe_account_id: ON_FILE }] };
    stripeMock.accounts.retrieve.mockResolvedValue({ id: ON_FILE, type: "standard" });

    const res = await call({ action: "dashboard", return_url: RETURN_URL });

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("payout_setup_paused");
    expect(stripeMock.accountLinks.create).not.toHaveBeenCalled();
    expect(stripeMock.accounts.update, "no Stripe write while paused").not.toHaveBeenCalled();
  });

  it("with the switch ON, onboard still creates the account and returns the link", async () => {
    scenario.rpc.feature_enabled_for_user = true;
    scenario.reads.profiles = { rows: [{ stripe_account_id: null, full_name: "Real Person" }] };

    const res = await call({ action: "onboard", return_url: RETURN_URL });

    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe("https://connect.stripe.test/onboard");
    expect(stripeMock.accounts.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.accountLinks.create).toHaveBeenCalledTimes(1);
  });

  it("list_payout_methods is not setup: it still answers while paused, and the switch is not asked", async () => {
    scenario.reads.profiles = { rows: [{ stripe_account_id: ON_FILE }] };

    const res = await call({ action: "list_payout_methods" });

    expect(res.status).not.toBe(409);
    expect(switchAsks()).toEqual([]);
  });
});
