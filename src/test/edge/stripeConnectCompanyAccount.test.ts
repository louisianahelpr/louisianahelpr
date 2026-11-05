/**
 * M14 (audit 1105, Shops): an LLC or corporation can be paid.
 *
 * stripe-connect created every Express account as `business_type:
 * "individual"`, so a shop run as an LLC could only be paid to its owner as a
 * person. Payout setup now sends `business_type: "company"` with the legal
 * name, and a NEW account is created as a company (no individual block);
 * Stripe's onboarding collects the EIN and representative. Everything else is
 * unchanged:
 *   - no choice (old builds) or "individual" creates the individual account it
 *     always did, prefilled from the profile;
 *   - an account already on file is used as it is (no create, no conversion);
 *   - a company with no usable name, or an unknown type, is refused (400)
 *     before Stripe is called, and nothing is linked;
 *   - the company create uses its own idempotency key, so an individual
 *     attempt in the last 24 h is never replayed for it;
 *   - reset honours the choice too, and a bad name is refused before the old
 *     account is deleted.
 *
 * Runs the REAL function source through the edge harness (Stripe and
 * Supabase are doubled; nothing here reaches Stripe).
 *
 * @mutate supabase/functions/stripe-connect/index.ts | ? { business_type: "company" as const, company: { name: business.name } } | ? { business_type: "individual" as const, company: { name: business.name } }
 * @mutate supabase/functions/stripe-connect/index.ts | const accountId = await freshIfRejected((await getOrCreateAccount({ business })).accountId, business); | const accountId = await freshIfRejected((await getOrCreateAccount()).accountId, business);
 * @mutate supabase/functions/stripe-connect/index.ts | const keyKind = business.type === "company" ? "-company" : ""; | const keyKind = "";
 * @mutate supabase/functions/stripe-connect/index.ts | const { accountId } = await getOrCreateAccount({ business }); | const { accountId } = await getOrCreateAccount();
 * @mutate supabase/functions/stripe-connect/index.ts | const business = businessOrRefusal(body);\n      if (business instanceof Response) return business;\n      const accountId | const business = { type: "individual" } as const;\n      const accountId
 * @mutate supabase/functions/_shared/connectBusinessType.ts | if (name.length < COMPANY_NAME_MIN \|\| name.length > COMPANY_NAME_MAX) { | if (name.length > COMPANY_NAME_MAX) {
 * @mutate supabase/functions/_shared/connectBusinessType.ts | if (raw !== "company") return { invalid: BUSINESS_TYPE_UNKNOWN }; | if (raw !== "company") return { type: "individual" };
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

const REAL = { id: "44444444-4444-4444-8444-444444444444", email: "shop@example.test" };
const NEW_ACCT = "acct_new_company";
const ON_FILE = "acct_individual_on_file";
const RETURN_URL = "https://louisianahelpr.com/profile";

const profileLinks = () =>
  scenario.writes.filter(
    (w) => w.table === "profiles" && w.op === "update" &&
      typeof (w.payload as Record<string, unknown>)?.stripe_account_id === "string",
  );

async function call(body: Record<string, unknown>) {
  const fn = await loadEdgeFunction("stripe-connect");
  return fn.fetch(fn.request({ headers: { Authorization: "Bearer good" }, body }));
}

const createParams = () => stripeMock.accounts.create.mock.calls.map((c) => c[0] as Record<string, unknown>);
const createKeys = () => stripeMock.accounts.create.mock.calls.map((c) => (c[1] as { idempotencyKey?: string })?.idempotencyKey);

describe("M14 stripe-connect creates a company account for a registered business", () => {
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
    scenario.reads.profiles = { rows: [{ stripe_account_id: null, full_name: "Dana Baker", phone: "5045550100" }] };
    stripeMock.accounts.create.mockResolvedValue({ id: NEW_ACCT });
    stripeMock.accounts.retrieve.mockResolvedValue({ id: NEW_ACCT });
    stripeMock.accounts.del.mockResolvedValue({ id: ON_FILE, deleted: true });
    stripeMock.accountLinks.create.mockResolvedValue({ url: "https://connect.stripe.test/onboard" });
  });
  afterEach(() => resetEnv());

  it("onboard as a company creates a company account with the legal name and no individual block", async () => {
    const res = await call({ action: "onboard", return_url: RETURN_URL, business_type: "company", company_name: "  Dana's   Bakery LLC " });

    expect(res.status).toBe(200);
    const params = createParams();
    expect(params.length, "inventory floor: one create").toBeGreaterThan(0);
    expect(params).toHaveLength(1);
    expect(params[0]).toMatchObject({ type: "express", business_type: "company", company: { name: "Dana's Bakery LLC" } });
    expect(params[0]).not.toHaveProperty("individual");
    expect(createKeys()[0]).toBe(`stripe-connect-create-${REAL.id}-company`);
    expect(profileLinks().map((w) => (w.payload as Record<string, unknown>).stripe_account_id)).toEqual([NEW_ACCT]);
  });

  it("onboard with no choice (old builds) still creates the individual account, prefilled", async () => {
    const res = await call({ action: "onboard", return_url: RETURN_URL });

    expect(res.status).toBe(200);
    const params = createParams();
    expect(params).toHaveLength(1);
    expect(params[0]).toMatchObject({ business_type: "individual", individual: { first_name: "Dana", last_name: "Baker" } });
    expect(params[0]).not.toHaveProperty("company");
    expect(createKeys()[0]).toBe(`stripe-connect-create-${REAL.id}`);
  });

  it("an explicit individual choice is the individual account", async () => {
    const res = await call({ action: "onboard", return_url: RETURN_URL, business_type: "individual" });
    expect(res.status).toBe(200);
    expect(createParams()[0]).toMatchObject({ business_type: "individual" });
  });

  it.each([
    ["no name", { business_type: "company" }],
    ["a blank name", { business_type: "company", company_name: "   " }],
    ["a one-letter name", { business_type: "company", company_name: "A" }],
    ["a name over 120 characters", { business_type: "company", company_name: "x".repeat(121) }],
    ["an unknown type", { business_type: "nonprofit", company_name: "Good Works" }],
  ])("onboard with %s is refused before Stripe and links nothing", async (_label, extra) => {
    const res = await call({ action: "onboard", return_url: RETURN_URL, ...extra });

    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe("invalid_business");
    expect(stripeMock.accounts.create).not.toHaveBeenCalled();
    expect(stripeMock.accountLinks.create).not.toHaveBeenCalled();
    expect(profileLinks()).toEqual([]);
  });

  it("an account already on file is used as it is: a company choice creates nothing", async () => {
    scenario.reads.profiles = { rows: [{ stripe_account_id: ON_FILE }] };
    stripeMock.accounts.retrieve.mockResolvedValue({ id: ON_FILE });

    const res = await call({ action: "onboard", return_url: RETURN_URL, business_type: "company", company_name: "Dana's Bakery LLC" });

    expect(res.status).toBe(200);
    expect(stripeMock.accounts.create).not.toHaveBeenCalled();
    expect(stripeMock.accountLinks.create.mock.calls[0][0]).toMatchObject({ account: ON_FILE });
  });

  it("reset as a company replaces the account with a company one", async () => {
    // Reset reads the old id, unlinks it, then getOrCreateAccount reads the profile again (now unlinked).
    scenario.reads.profiles = {
      rows: [{ stripe_account_id: ON_FILE }],
      selectOverrides: [{ includes: "full_name", result: { rows: [{ stripe_account_id: null, full_name: "Dana Baker" }] } }],
    };

    const res = await call({ action: "reset", return_url: RETURN_URL, business_type: "company", company_name: "Dana's Bakery LLC" });

    expect(res.status).toBe(200);
    expect(createParams()).toHaveLength(1);
    expect(createParams()[0]).toMatchObject({ business_type: "company", company: { name: "Dana's Bakery LLC" } });
  });

  it("reset with a bad business name is refused before the old account is deleted", async () => {
    scenario.reads.profiles = { rows: [{ stripe_account_id: ON_FILE }] };

    const res = await call({ action: "reset", return_url: RETURN_URL, business_type: "company", company_name: "" });

    expect(res.status).toBe(400);
    expect(stripeMock.accounts.del).not.toHaveBeenCalled();
    expect(stripeMock.accounts.create).not.toHaveBeenCalled();
    expect(scenario.writes.filter((w) => w.table === "profiles")).toEqual([]);
  });
});
