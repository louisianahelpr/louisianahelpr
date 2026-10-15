// @mutate supabase/functions/apple-app-store-notifications/index.ts | if (profile.subscription_source !== "apple") { | if (false) {
// @mutate supabase/functions/apple-app-store-notifications/index.ts | if (!entitled \|\| stripeHoldsIt) { | if (!entitled) {
// @mutate supabase/functions/apple-app-store-notifications/index.ts | if (!entitled \|\| stripeHoldsIt) { | if (true) {
// @mutate supabase/functions/apple-app-store-notifications/index.ts |     if (verdict === "does_not_count") { |     if (false) {
// @mutate supabase/functions/apple-app-store-notifications/index.ts |     if (verdict === "unknown") { |     if (false) {
// @mutate supabase/functions/apple-app-store-notifications/index.ts | if (!entitled && profile.subscription_source === "apple" && profile.stripe_subscription_id) { | if (false) {
// @mutate supabase/functions/apple-app-store-notifications/index.ts |       ? write.is("subscription_source", null)\n      : write.eq("subscription_source", profile.subscription_source); |       ? write\n      : write;
// @mutate supabase/functions/apple-app-store-notifications/index.ts |       ? write.is("stripe_subscription_id", null)\n      : write.eq("stripe_subscription_id", profile.stripe_subscription_id); |       ? write\n      : write;
// @mutate supabase/functions/_shared/appleAppStore.ts |   if (!expectsProduction() \|\| !isSandboxTransaction(tx)) return "counts"; |   return "counts";
/**
 * apple-app-store-notifications, executed through the edge harness.
 *
 * Two holes found by the reviewers of the sec-c batch (2026-10-15):
 *
 *  1. The row is found by profiles.apple_original_transaction_id, which is
 *     never cleared. A FORMER Apple member now billed by Stripe (stripe-webhook
 *     stamps subscription_source 'stripe') was still found, so a late EXPIRED
 *     or REFUND for the old Apple subscription nulled the tier they pay Stripe
 *     for, and a late DID_RENEW overwrote it. Now only a row whose authority
 *     is Apple is written.
 *
 *  2. The App Store environment was never checked. In a production
 *     deployment a Sandbox transaction (free) now changes a row only for a
 *     test account, the same rule verify-apple-iap uses (Q1794).
 *
 * Every case asserts the profiles WRITE, not just the response: the bug is a
 * write that should not happen.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";

const USER = "user-apple-1";
const TX = "2000000777";

let fn: EdgeHarness;
let env: Record<string, string>;

const b64u = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jws = (o: unknown) => `${b64u({ alg: "ES256" })}.${b64u(o)}.sig`;

/** Apple's authoritative transaction, as the App Store Server API returns it. */
function appleReturns(tx: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ signedTransactionInfo: jws(tx) }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )));
}

const baseTx = (over: Record<string, unknown> = {}) => ({
  transactionId: TX,
  originalTransactionId: TX,
  productId: "com.helpr.plus.monthly",
  bundleId: "com.Helpr",
  expiresDate: Date.now() + 30 * 24 * 3600 * 1000,
  purchaseDate: Date.now(),
  environment: "Production",
  ...over,
});

const notify = (notificationType: string) =>
  fn.fetch(fn.request({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: {
      signedPayload: jws({ notificationType, data: { signedTransactionInfo: jws({ transactionId: TX }) } }),
    },
  }));

const profileWrites = () => (scenario.writes ?? []).filter((w) => w.table === "profiles");

function linkedRow(source: string | null, tier: string | null = "plus", isSeed = false, extra: Record<string, unknown> = {}) {
  scenario.reads.profiles = {
    rows: [{
      user_id: USER, subscription_tier: tier, subscription_source: source, is_seed: isSeed,
      subscription_expires_at: null, stripe_subscription_id: null, ...extra,
    }],
  };
}
const STRIPE_LIVE = { stripe_subscription_id: "sub_live", subscription_expires_at: new Date(Date.now() + 9e8).toISOString() };

async function load(extraEnv: Record<string, string> = {}) {
  env = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    APPLE_IAP_ISSUER_ID: "issuer",
    APPLE_IAP_KEY_ID: "keyid",
    APPLE_IAP_BUNDLE_ID: "com.Helpr",
    // A real P-256 PKCS8 key generated for tests only (same one verify-apple-iap.test.ts uses):
    // mintBearer genuinely signs with it before the stubbed fetch.
    APPLE_IAP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgzWhoA6+l7Icd5++A\n9TLFfCMN1mj3J7s7h0cJFfX7lAehRANCAAQ5JneSHCYRL5DsV2O7bMFhn+IkZrRT\nLZEI9I3/xi1qIOI+QAajQ4TEeVBcQDXHcn675+Dnxf3RpZUV8dtLOzob\n-----END PRIVATE KEY-----",
    ...extraEnv,
  };
  setEnv(env);
  // _shared/appleAppStore.ts reads globalThis.Deno itself (see verify-apple-iap.test.ts).
  vi.stubGlobal("Deno", { env: { get: (k: string) => env[k] } });
  fn = await loadEdgeFunction("apple-app-store-notifications");
}

beforeEach(async () => {
  resetEnv(); resetSupabaseMock(); resetSharedMocks();
  appleReturns(baseTx());
  await load();
});

describe("an Apple member's row is still graded by Apple", () => {
  it("a renewal for an Apple-billed row writes the tier (the path still works)", async () => {
    linkedRow("apple");
    const res = await notify("DID_RENEW");
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("granted");
    expect(profileWrites()).toHaveLength(1);
    expect(profileWrites()[0].payload).toMatchObject({ subscription_tier: "plus", subscription_source: "apple" });
  });

  it("a refund for an Apple-billed row clears the tier", async () => {
    appleReturns(baseTx({ revocationDate: Date.now() - 1000 }));
    linkedRow("apple");
    const res = await notify("REFUND");
    expect((await res.json()).outcome).toBe("revoked");
    expect(profileWrites()[0].payload).toMatchObject({ subscription_tier: null });
  });
});

describe("a former Apple member now billed by Stripe is left alone", () => {
  it("a late REFUND for the old Apple subscription does not null the Stripe tier", async () => {
    appleReturns(baseTx({ revocationDate: Date.now() - 1000 }));
    linkedRow("stripe", "elite", false, STRIPE_LIVE);
    const res = await notify("REFUND");
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("not_apple_authority");
    expect(profileWrites()).toHaveLength(0);
  });

  it("a late EXPIRED does not null the Stripe tier", async () => {
    appleReturns(baseTx({ expiresDate: Date.now() - 3600_000 }));
    linkedRow("stripe", "elite", false, STRIPE_LIVE);
    const res = await notify("EXPIRED");
    expect((await res.json()).outcome).toBe("not_apple_authority");
    expect(profileWrites()).toHaveLength(0);
  });

  it("a late DID_RENEW does not overwrite the Stripe tier with the Apple one", async () => {
    linkedRow("stripe", "elite", false, STRIPE_LIVE);
    const res = await notify("DID_RENEW");
    expect((await res.json()).outcome).toBe("not_apple_authority");
    expect(profileWrites()).toHaveLength(0);
  });

  it("a paid Apple renewal while Stripe holds the row changes nothing, alerts ops, and does not echo the billing system", async () => {
    linkedRow("stripe", "elite", false, STRIPE_LIVE);
    const res = await notify("DID_RENEW");
    const body = await res.json();
    expect(body.outcome).toBe("not_apple_authority");
    expect(body).not.toHaveProperty("subscription_source");
    expect(profileWrites()).toHaveLength(0);
    expect((slackAlerts as Array<{ title?: string }>).some((a) => /Apple is billing/.test(a.title ?? ""))).toBe(true);
  });
});

describe("Apple takes the row back when Stripe holds nothing (lh-money-escrow review of 3b12e17b4, finding 1)", () => {
  it("a paid DID_RENEW on a 'stripe' row whose Stripe side was cancelled restores the tier as Apple's", async () => {
    // The double subscription settled by cancelling Stripe: source stays
    // 'stripe', tier and subscription id cleared. Apple is still charging.
    linkedRow("stripe", null);
    const res = await notify("DID_RENEW");
    expect((await res.json()).outcome).toBe("granted");
    expect(profileWrites()).toHaveLength(1);
    expect(profileWrites()[0].payload).toMatchObject({ subscription_tier: "plus", subscription_source: "apple" });
  });

  it("a lapsed Stripe tier (past expiry, no subscription id) is reclaimed too", async () => {
    linkedRow("stripe", "pro", false, { subscription_expires_at: new Date(Date.now() - 3600_000).toISOString() });
    const res = await notify("DID_RENEW");
    expect((await res.json()).outcome).toBe("granted");
  });

  it("an UNPAID notice never reclaims (a refund cannot touch a Stripe row)", async () => {
    appleReturns(baseTx({ revocationDate: Date.now() - 1000 }));
    linkedRow("stripe", null);
    const res = await notify("REFUND");
    expect((await res.json()).outcome).toBe("not_apple_authority");
    expect(profileWrites()).toHaveLength(0);
  });

  it("a Sandbox notice never reclaims a real member's row", async () => {
    appleReturns(baseTx({ environment: "Sandbox" }));
    linkedRow("stripe", null);
    scenario.reads.test_accounts = { rows: [] };
    const res = await notify("DID_RENEW");
    expect((await res.json()).outcome).toBe("sandbox_ignored");
    expect(profileWrites()).toHaveLength(0);
  });
});

describe("the App Store environment counts only where it should", () => {
  it("in production, a Sandbox notice for a real member changes nothing", async () => {
    appleReturns(baseTx({ environment: "Sandbox", revocationDate: Date.now() - 1000 }));
    linkedRow("apple");
    scenario.reads.test_accounts = { rows: [] };
    const res = await notify("REFUND");
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("sandbox_ignored");
    expect(profileWrites()).toHaveLength(0);
  });

  it("in production, a Sandbox renewal cannot grant a real member a tier", async () => {
    appleReturns(baseTx({ environment: "Sandbox" }));
    linkedRow("apple", null);
    scenario.reads.test_accounts = { rows: [] };
    const res = await notify("DID_RENEW");
    expect((await res.json()).outcome).toBe("sandbox_ignored");
    expect(profileWrites()).toHaveLength(0);
  });

  it("a test_accounts read error writes nothing and answers 500, so Apple retries (re-review finding 5)", async () => {
    appleReturns(baseTx({ environment: "Sandbox" }));
    linkedRow("apple", null, true);
    scenario.reads.test_accounts = { error: { message: "boom" } };
    const res = await notify("DID_RENEW");
    expect(res.status).toBe(500);
    expect((await res.json()).outcome).toBe("environment_unknown");
    expect(profileWrites()).toHaveLength(0);
  });

  it("a Sandbox notice for a test account (test_accounts + is_seed) is applied", async () => {
    appleReturns(baseTx({ environment: "Sandbox" }));
    linkedRow("apple", null, true);
    scenario.reads.test_accounts = { rows: [{ user_id: USER }] };
    const res = await notify("DID_RENEW");
    expect((await res.json()).outcome).toBe("granted");
    expect(profileWrites()).toHaveLength(1);
  });

  it("a deployment that opted into sandbox (APPLE_IAP_ENVIRONMENT=sandbox) applies it for anyone", async () => {
    await load({ APPLE_IAP_ENVIRONMENT: "sandbox" });
    appleReturns(baseTx({ environment: "Sandbox" }));
    linkedRow("apple", null);
    scenario.reads.test_accounts = { rows: [] };
    const res = await notify("DID_RENEW");
    expect((await res.json()).outcome).toBe("granted");
    expect(profileWrites()).toHaveLength(1);
  });
});

describe("what counts as Stripe holding the row (lh-money-escrow re-review of 18f0d5fb3, findings 1, 2, 4)", () => {
  it("a live Stripe subscription id alone holds it (no tier yet): no reclaim", async () => {
    linkedRow("stripe", null, false, { stripe_subscription_id: "sub_live" });
    const res = await notify("DID_RENEW");
    expect((await res.json()).outcome).toBe("not_apple_authority");
    expect(profileWrites()).toHaveLength(0);
  });

  it("a Stripe tier with no expiry holds it: no reclaim", async () => {
    linkedRow("stripe", "pro", false, { subscription_expires_at: null });
    const res = await notify("DID_RENEW");
    expect((await res.json()).outcome).toBe("not_apple_authority");
    expect(profileWrites()).toHaveLength(0);
  });

  it("an Apple refund on an 'apple' row that a Stripe subscription also bills leaves the tier alone", async () => {
    appleReturns(baseTx({ revocationDate: Date.now() - 1000 }));
    linkedRow("apple", "plus", false, { stripe_subscription_id: "sub_live" });
    const res = await notify("REFUND");
    expect((await res.json()).outcome).toBe("stripe_still_billing");
    expect(profileWrites()).toHaveLength(0);
  });

  it("the write repeats the state it was decided on, so a Stripe checkout in between makes it miss and retry", async () => {
    linkedRow("stripe", null);
    await notify("DID_RENEW");
    const filters = JSON.stringify(profileWrites()[0].filters);
    expect(filters).toMatch(/subscription_source[^}]*stripe/);
    expect(filters).toMatch(/stripe_subscription_id/);
  });
});
