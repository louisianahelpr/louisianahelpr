/**
 * Payout setup only after a hire (owner decision 2026-10-25, item 9): Stripe
 * rejected 45 of our 46 connected accounts, most opened at sign-up by people
 * nobody hired. The REAL stripe-connect source, through the edge harness
 * (Stripe and Supabase doubled; nothing here reaches Stripe), proves:
 *
 *   (hire) onboard, update_onboarding and reset answer 403
 *     payout_setup_needs_hire for a member public.payout_setup_hire_allowed
 *     says no to, and make NO Stripe call; a failed or non-true answer refuses
 *     the same way (fails closed); the question is asked for the VERIFIED
 *     caller, never a body id; the App Store review account is exempt; the
 *     pause (payout_setup off) still answers first; a non-Express dashboard
 *     link is refused too; status and list_payout_methods are not setup.
 *   (fresh) with payout_after_hire on, a hired Helpr whose account Stripe
 *     REJECTED gets a fresh account instead of a dead-end link: created first
 *     (idempotency keyed on the old id), linked ONLY in place of that id (the
 *     cached gate columns reset), the old one deleted at Stripe when allowed,
 *     recorded in connect_account_retirements either way, ops told when Stripe
 *     keeps it, the member told; reset takes the same road instead of its 409.
 *     A failed create changes nothing; an account that is not rejected, or
 *     the switch off, keeps today's behaviour.
 *
 * Static class guard: src/test/payoutSetupNeedsHire.test.ts.
 *
 * @mutate supabase/functions/stripe-connect/index.ts |       !(await payoutSetupHireAllowed(supabaseAdmin, user.id))\n    ) { |       false\n    ) {
 * @mutate supabase/functions/_shared/payoutSetupHire.ts |     return data === true; |     return data !== false;
 * @mutate supabase/functions/_shared/payoutSetupHire.ts |       return false;\n    }\n    return data === true; |       return true;\n    }\n    return data === true;
 * @mutate supabase/functions/_shared/payoutSetupHire.ts |     const { data, error } = await client.rpc("payout_setup_hire_allowed", { p_user_id: userId }); |     const { data, error } = await client.rpc("payout_setup_hire_allowed", { p_user_id: "x" });
 * @mutate supabase/functions/stripe-connect/index.ts |       if (!(await featureEnabledForUser(supabaseAdmin, "payout_after_hire", user))) return accountId; |       if (true) return accountId;
 * @mutate supabase/functions/stripe-connect/index.ts |           ? linkWrite.eq("stripe_account_id", replacing) |           ? linkWrite
 * @mutate supabase/functions/stripe-connect/index.ts |       if (outcome === "delete_refused" \|\| !recorded) { |       if (!recorded) {
 * @mutate supabase/functions/stripe-connect/index.ts |         if (opts.beforeLink) await opts.beforeLink(account.id); | 
 * @mutate supabase/functions/stripe-connect/index.ts |       const linkAccountId = await freshIfRejected(profile.stripe_account_id); |       const linkAccountId = profile.stripe_account_id;
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, postSlackOpsAlert } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { PAYOUT_SETUP_NEEDS_HIRE_COPY } from "@/lib/payoutSetupPaused";

const REAL = { id: "55555555-5555-4555-8555-555555555555", email: "real@example.test" };
const APP_REVIEW = { id: "f2098932-5563-47c3-9589-1d22cca72003", email: "apple-reviewer@louisianahelpr.com" };
const OLD = "acct_rejected_old";
const RETURN_URL = "https://louisianahelpr.com/profile";

async function call(body: Record<string, unknown>) {
  const fn = await loadEdgeFunction("stripe-connect");
  return fn.fetch(fn.request({ headers: { Authorization: "Bearer good" }, body }));
}

const stripeSetupCalls = () =>
  stripeMock.accounts.create.mock.calls.length +
  stripeMock.accountLinks.create.mock.calls.length +
  stripeMock.accounts.del.mock.calls.length;
const hireAsks = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "payout_setup_hire_allowed");
const switchesOn = (keys: string[]) => (a?: unknown) => keys.includes((a as { p_key?: string } | undefined)?.p_key ?? "");
const writesTo = (table: string) => scenario.writes.filter((w) => w.table === table);

function base() {
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
  stripeMock.accounts.create.mockResolvedValue({ id: "acct_fresh" });
  stripeMock.accounts.retrieve.mockImplementation(async (id: string) => ({ id, type: "express", requirements: { disabled_reason: null } }));
  stripeMock.accounts.del.mockResolvedValue({ id: OLD, deleted: true });
  stripeMock.accountLinks.create.mockResolvedValue({ url: "https://connect.stripe.test/onboard" });
}

describe("payout setup needs a hire: stripe-connect refuses a member nobody hired", () => {
  beforeEach(() => {
    base();
    scenario.rpc.feature_enabled_for_user = switchesOn(["payout_setup"]);
    scenario.rpc.payout_setup_hire_allowed = false;
  });
  afterEach(() => resetEnv());

  const CASES: Array<{ action: string; accountOnFile: string | null }> = [
    { action: "onboard", accountOnFile: null },
    { action: "onboard", accountOnFile: OLD },
    { action: "update_onboarding", accountOnFile: OLD },
    { action: "reset", accountOnFile: OLD },
  ];

  it("reads a real inventory (floor)", () => {
    expect(CASES.length).toBeGreaterThan(3);
  });

  for (const c of CASES) {
    it(`${c.action} (account on file: ${c.accountOnFile ?? "none"}) answers 403 payout_setup_needs_hire and calls Stripe for nothing`, async () => {
      scenario.reads.profiles = { rows: [{ stripe_account_id: c.accountOnFile, full_name: "Real Person" }] };

      const res = await call({ action: c.action, return_url: RETURN_URL });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe("payout_setup_needs_hire");
      expect(body.error).toBe(PAYOUT_SETUP_NEEDS_HIRE_COPY);
      expect(body.url).toBeUndefined();
      expect(stripeSetupCalls()).toBe(0);
      expect(writesTo("profiles")).toEqual([]);
      expect(hireAsks().map((a) => a.args)).toEqual([{ p_user_id: REAL.id }]);
    });
  }

  it("a failed hire read refuses too (fails closed)", async () => {
    scenario.rpcErrors = { payout_setup_hire_allowed: { message: "boom" } };
    scenario.reads.profiles = { rows: [{ stripe_account_id: null, full_name: "Real Person" }] };
    const res = await call({ action: "onboard", return_url: RETURN_URL });
    expect(res.status).toBe(403);
    expect(stripeSetupCalls()).toBe(0);
  });

  it("an answer that is not a literal true refuses (a missing function answers null)", async () => {
    scenario.rpc.payout_setup_hire_allowed = null;
    scenario.reads.profiles = { rows: [{ stripe_account_id: null, full_name: "Real Person" }] };
    const res = await call({ action: "onboard", return_url: RETURN_URL });
    expect(res.status).toBe(403);
    expect(stripeSetupCalls()).toBe(0);
  });

  it("a body that names a hired member changes nothing: the signed-in caller is asked about", async () => {
    scenario.reads.profiles = { rows: [{ stripe_account_id: null, full_name: "Real Person" }] };
    const res = await call({ action: "onboard", return_url: RETURN_URL, user_id: "66666666-6666-4666-8666-666666666666", p_user_id: "x" });
    expect(res.status).toBe(403);
    expect(hireAsks().map((a) => (a.args as { p_user_id: string }).p_user_id)).toEqual([REAL.id]);
  });

  it("the App Store review account is exempt: it reaches Stripe's onboarding", async () => {
    scenario.authUser = APP_REVIEW;
    scenario.reads.profiles = { rows: [{ stripe_account_id: null, full_name: "App Review" }] };
    const res = await call({ action: "onboard", return_url: RETURN_URL });
    expect(res.status).toBe(200);
    expect(hireAsks()).toEqual([]);
    expect(stripeMock.accountLinks.create).toHaveBeenCalledTimes(1);
  });

  it("while payout setup is paused, the pause answers first and the hire is not asked", async () => {
    scenario.rpc.feature_enabled_for_user = switchesOn([]);
    scenario.reads.profiles = { rows: [{ stripe_account_id: null, full_name: "Real Person" }] };
    const res = await call({ action: "onboard", return_url: RETURN_URL });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("payout_setup_paused");
    expect(hireAsks()).toEqual([]);
  });

  it("a non-Express dashboard link (an Account Link) is refused before any Stripe write", async () => {
    scenario.reads.profiles = { rows: [{ stripe_account_id: OLD }] };
    stripeMock.accounts.retrieve.mockResolvedValue({ id: OLD, type: "standard" });
    const res = await call({ action: "dashboard", return_url: RETURN_URL });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("payout_setup_needs_hire");
    expect(stripeMock.accountLinks.create).not.toHaveBeenCalled();
    expect(stripeMock.accounts.update).not.toHaveBeenCalled();
  });

  it("status and list_payout_methods are not setup: they answer and the hire is not asked", async () => {
    scenario.reads.profiles = { rows: [{ stripe_account_id: null }] };
    expect((await call({ action: "status" })).status).toBe(200);
    expect((await call({ action: "list_payout_methods" })).status).toBe(200);
    expect(hireAsks()).toEqual([]);
  });

  it("a hired member's onboard creates the account and the link", async () => {
    scenario.rpc.payout_setup_hire_allowed = true;
    scenario.reads.profiles = { rows: [{ stripe_account_id: null, full_name: "Real Person" }] };
    const res = await call({ action: "onboard", return_url: RETURN_URL });
    expect(res.status).toBe(200);
    expect(stripeMock.accounts.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.accountLinks.create).toHaveBeenCalledTimes(1);
  });
});

describe("a hired Helpr's REJECTED account is replaced with a fresh one (payout_after_hire on)", () => {
  beforeEach(() => {
    base();
    scenario.rpc.feature_enabled_for_user = switchesOn(["payout_setup", "payout_after_hire"]);
    scenario.rpc.payout_setup_hire_allowed = true;
    scenario.reads.profiles = { rows: [{ stripe_account_id: OLD, full_name: "Real Person" }] };
    stripeMock.accounts.retrieve.mockImplementation(async (id: string) =>
      id === OLD
        ? { id, type: "express", requirements: { disabled_reason: "rejected.fraud" } }
        : { id, type: "express", requirements: { disabled_reason: null } });
  });
  afterEach(() => resetEnv());

  const linkedAccount = () => (stripeMock.accountLinks.create.mock.calls[0]?.[0] as { account?: string } | undefined)?.account;
  const retirementInserts = () => writesTo("connect_account_retirements").filter((w) => w.op === "insert").map((w) => w.payload as Record<string, unknown>);
  const retirement = () => writesTo("connect_account_retirements").filter((w) => w.op === "update").map((w) => w.payload as Record<string, unknown>);
  const profileLink = () =>
    writesTo("profiles").find((w) => w.op === "update" && (w.payload as Record<string, unknown>).stripe_account_id === "acct_fresh");

  for (const action of ["onboard", "update_onboarding"]) {
    it(`${action}: creates a fresh account first, links it only in place of the rejected id, deletes the old one and records it`, async () => {
      const res = await call({ action, return_url: RETURN_URL });

      expect(res.status).toBe(200);
      expect(stripeMock.accounts.create).toHaveBeenCalledTimes(1);
      const opts = stripeMock.accounts.create.mock.calls[0][1] as { idempotencyKey?: string };
      expect(opts.idempotencyKey).toBe(`stripe-connect-create-${REAL.id}-replacing-${OLD}`);
      const link = profileLink();
      expect(link, "the fresh account is linked").toBeDefined();
      expect(link!.filters).toContainEqual(expect.objectContaining({ column: "stripe_account_id", value: OLD }));
      expect(link!.payload).toMatchObject({ stripe_payouts_enabled: false, stripe_charges_enabled: false, stripe_identity_verified: false });
      expect(stripeMock.accounts.del).toHaveBeenCalledWith(OLD);
      // The old id is recorded BEFORE the swap (lh-money-escrow #4), then settled.
      expect(retirementInserts()).toEqual([
        expect.objectContaining({ user_id: REAL.id, stripe_account_id: OLD, replacement_account_id: "acct_fresh", reason: "rejected", delete_outcome: "pending" }),
      ]);
      const order = scenario.writes.map((w) => `${w.table}:${w.op}`);
      expect(order.indexOf("connect_account_retirements:insert")).toBeLessThan(order.indexOf("profiles:update"));
      expect(retirement()).toEqual([expect.objectContaining({ delete_outcome: "deleted", replacement_account_id: "acct_fresh" })]);
      expect(linkedAccount()).toBe("acct_fresh");
      expect(writesTo("notifications").map((w) => (w.payload as { title?: string }).title)).toContain("Payout account replaced");
      expect(postSlackOpsAlert).not.toHaveBeenCalled();
    });
  }

  it("Stripe refusing the delete does not stop the replacement: recorded delete_refused and ops are told", async () => {
    stripeMock.accounts.del.mockRejectedValue(Object.assign(new Error("This account cannot be deleted: it has a balance."), { statusCode: 400 }));
    const res = await call({ action: "onboard", return_url: RETURN_URL });
    expect(res.status).toBe(200);
    expect(linkedAccount()).toBe("acct_fresh");
    expect(retirementInserts()).toEqual([expect.objectContaining({ stripe_account_id: OLD, delete_outcome: "pending" })]);
    expect(retirement()).toEqual([
      expect.objectContaining({ replacement_account_id: "acct_fresh", delete_outcome: "delete_refused", delete_error: expect.stringContaining("balance") }),
    ]);
    expect(postSlackOpsAlert).toHaveBeenCalledWith(expect.objectContaining({ kind: "money_at_risk", fields: expect.objectContaining({ old_account_id: OLD }) }));
  });

  it("a read that answers 'the account has been rejected' is a rejected account too", async () => {
    stripeMock.accounts.retrieve.mockImplementation(async (id: string) => {
      if (id === OLD) throw new Error("An account link cannot be created for this account because the account has been rejected.");
      return { id };
    });
    const res = await call({ action: "onboard", return_url: RETURN_URL });
    expect(res.status).toBe(200);
    expect(linkedAccount()).toBe("acct_fresh");
  });

  it("reset of a rejected account takes the same road instead of its 409", async () => {
    stripeMock.accounts.del.mockRejectedValue(Object.assign(new Error("has activity"), { statusCode: 400 }));
    const res = await call({ action: "reset", return_url: RETURN_URL });
    expect(res.status).toBe(200);
    expect((await res.json()).account_id).toBe("acct_fresh");
    expect(retirement()).toEqual([expect.objectContaining({ delete_outcome: "delete_refused" })]);
  });

  it("a failed create changes nothing: no link, no delete, no record", async () => {
    stripeMock.accounts.create.mockRejectedValue(new Error("You cannot create new accounts because your account has been rejected."));
    const res = await call({ action: "onboard", return_url: RETURN_URL });
    expect(res.status).toBe(500);
    expect(writesTo("profiles")).toEqual([]);
    expect(stripeMock.accounts.del).not.toHaveBeenCalled();
    expect(retirement()).toEqual([]);
    expect(retirementInserts()).toEqual([]);
    expect(stripeMock.accountLinks.create).not.toHaveBeenCalled();
  });

  it("if the old id cannot be recorded first, nothing is linked and nothing is deleted", async () => {
    scenario.writeErrors.connect_account_retirements = { message: "permission denied", code: "42501" };
    const res = await call({ action: "onboard", return_url: RETURN_URL });
    expect(res.status).toBe(500);
    expect(writesTo("profiles")).toEqual([]);
    expect(stripeMock.accounts.del).not.toHaveBeenCalled();
    expect(stripeMock.accountLinks.create).not.toHaveBeenCalled();
  });

  it("an account Stripe has NOT rejected is kept: no create, the link is for it", async () => {
    stripeMock.accounts.retrieve.mockImplementation(async (id: string) => ({ id, type: "express", requirements: { disabled_reason: null } }));
    const res = await call({ action: "onboard", return_url: RETURN_URL });
    expect(res.status).toBe(200);
    expect(stripeMock.accounts.create).not.toHaveBeenCalled();
    expect(linkedAccount()).toBe(OLD);
  });

  it("with payout_after_hire off, today's behaviour: the rejected account gets its link", async () => {
    scenario.rpc.feature_enabled_for_user = switchesOn(["payout_setup"]);
    const res = await call({ action: "onboard", return_url: RETURN_URL });
    expect(res.status).toBe(200);
    expect(stripeMock.accounts.create).not.toHaveBeenCalled();
    expect(linkedAccount()).toBe(OLD);
    expect(retirement()).toEqual([]);
    expect(retirementInserts()).toEqual([]);
  });
});
