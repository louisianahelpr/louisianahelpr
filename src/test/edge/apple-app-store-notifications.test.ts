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

/**
 * Apple's authoritative answers, as the App Store Server API returns them:
 * GET /transactions/{id} answers `tx`; GET /subscriptions/{originalTransactionId}
 * answers the subscription's LATEST transaction, `latest` (default: the same
 * one, the common case where the notice names the newest transaction).
 * `statusCode` fails the status lookup.
 */
function appleReturns(
  tx: Record<string, unknown>,
  latest: Record<string, unknown> | null = tx,
  statusCode = 200,
) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/inApps/v1/subscriptions/")) {
      if (statusCode !== 200) return new Response("{}", { status: statusCode });
      const lastTransactions = latest
        ? [{ originalTransactionId: latest.originalTransactionId, status: 1, signedTransactionInfo: jws(latest) }]
        : [];
      return new Response(
        JSON.stringify({ environment: "Production", data: [{ subscriptionGroupIdentifier: "g1", lastTransactions }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ signedTransactionInfo: jws(tx) }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }));
}
const appleUrls = () => (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0]));

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
  const { generateKeyPairSync } = await import("node:crypto");
  env = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    APPLE_IAP_ISSUER_ID: "issuer",
    APPLE_IAP_KEY_ID: "keyid",
    APPLE_IAP_BUNDLE_ID: "com.Helpr",
    // A P-256 PKCS8 key generated per run (as mapkit-token.test.ts does): mintBearer genuinely
    // signs with it before the stubbed fetch, and no commit carries key material.
    APPLE_IAP_PRIVATE_KEY: generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
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
  // The memberships switch is on unless a case is ABOUT it being off (Q1849).
  scenario.rpc.feature_enabled_for_user = true;
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

// Q1860: an old or retried notice must not revoke a paid-up member. Apple
// retries a failed notice for up to three days and this endpoint is
// unauthenticated, so the posted transaction can be an OLD one of the same
// subscription; the subscription's latest state decides.
// @mutate supabase/functions/apple-app-store-notifications/index.ts |     const tx = postedMeta.kind === "auto"\n      ? await fetchLatestSubscriptionTransaction(postedTx)\n      : postedTx; |     const tx = postedTx;
// @mutate supabase/functions/_shared/appleAppStore.ts |       if (last.originalTransactionId !== tx.originalTransactionId \|\| !last.signedTransactionInfo) continue; |       if (!last.signedTransactionInfo) continue;
// @mutate supabase/functions/_shared/appleAppStore.ts |   throw new Error("App Store returned no status for this subscription"); |   return tx;
describe("Q1860 · the subscription's latest state decides, never the posted transaction", () => {
  const OLD = baseTx({ transactionId: "2000000100", expiresDate: Date.now() - 30 * 24 * 3600 * 1000 });
  const RENEWED = baseTx({ transactionId: "2000000200", expiresDate: Date.now() + 25 * 24 * 3600 * 1000 });

  it("a stale EXPIRED notice for a subscription that has since renewed never clears the tier", async () => {
    appleReturns(OLD, RENEWED);
    linkedRow("apple", "plus");
    const res = await notify("EXPIRED");
    expect(res.status).toBe(200);
    expect((await res.json()).outcome).toBe("granted");
    expect(profileWrites().every((w) => (w.payload as { subscription_tier?: unknown }).subscription_tier !== null)).toBe(true);
    // What is written is the LATEST transaction's expiry, not the posted one's.
    expect(profileWrites()[0].payload).toMatchObject({
      subscription_tier: "plus",
      subscription_expires_at: new Date(RENEWED.expiresDate as number).toISOString(),
    });
    expect(appleUrls().some((u) => u.includes(`/inApps/v1/subscriptions/${TX}`))).toBe(true);
  });

  it("grading by the latest state cuts both ways: an old paid notice cannot grant a refunded subscription", async () => {
    appleReturns(RENEWED, baseTx({ transactionId: "2000000300", revocationDate: Date.now() - 1000 }));
    linkedRow("apple", "plus");
    const res = await notify("DID_RENEW");
    expect((await res.json()).outcome).toBe("revoked");
    expect(profileWrites()[0].payload).toMatchObject({ subscription_tier: null });
  });

  it("an App Store status lookup failure writes nothing and answers 500, so Apple retries", async () => {
    appleReturns(OLD, RENEWED, 500);
    linkedRow("apple", "plus");
    const res = await notify("EXPIRED");
    expect(res.status).toBe(500);
    expect(profileWrites()).toHaveLength(0);
  });

  it("a status answer that does not name this subscription writes nothing (never falls back to the posted one)", async () => {
    appleReturns(OLD, baseTx({ transactionId: "9", originalTransactionId: "someone-else" }));
    linkedRow("apple", "plus");
    const res = await notify("EXPIRED");
    expect(res.status).toBe(500);
    expect(profileWrites()).toHaveLength(0);
  });

  it("a one-time pass has no subscription to re-read: graded from its own transaction", async () => {
    appleReturns(baseTx({ productId: "com.helpr.plus.onetime", expiresDate: undefined }), null);
    linkedRow("apple", null);
    const res = await notify("ONE_TIME_CHARGE");
    expect((await res.json()).outcome).toBe("granted");
    expect(appleUrls().some((u) => u.includes("/inApps/v1/subscriptions/"))).toBe(false);
  });
});

// Q1859: the double-billing alert is posted once per day per member and
// subscription (postSlackOpsAlert's oncePerDayKey), and says which arm matched.
// @mutate supabase/functions/apple-app-store-notifications/index.ts |               oncePerDayKey: `apple-double-billing:${profile.user_id}:${tx.originalTransactionId}`, |
// @mutate supabase/functions/apple-app-store-notifications/index.ts |           const message = profile.stripe_subscription_id | const message = true
describe("Q1859 · the double-billing alert is deduped and worded by the arm that matched", () => {
  type Alert = { title?: string; message?: string; oncePerDayKey?: string };
  const billingAlerts = () => (slackAlerts as Alert[]).filter((a) => /Apple is billing/.test(a.title ?? ""));

  it("two identical replayed notices carry one once-per-day key, so they page once", async () => {
    linkedRow("stripe", "elite", false, STRIPE_LIVE);
    await notify("DID_RENEW");
    await notify("DID_RENEW");
    const alerts = billingAlerts();
    expect(alerts).toHaveLength(2);
    expect(alerts[0].oncePerDayKey).toBe(`apple-double-billing:${USER}:${TX}`);
    expect(new Set(alerts.map((a) => a.oncePerDayKey)).size).toBe(1);
  });

  it("only a live Stripe subscription is called paying twice", async () => {
    linkedRow("stripe", "elite", false, STRIPE_LIVE);
    await notify("DID_RENEW");
    expect(billingAlerts()[0].message).toMatch(/paying twice/);
  });

  it("a Stripe tier with no subscription behind it is not called paying twice", async () => {
    linkedRow("stripe", "pro", false, { subscription_expires_at: null });
    await notify("DID_RENEW");
    const msg = billingAlerts()[0].message ?? "";
    expect(msg).not.toMatch(/paying twice/);
    expect(msg).toMatch(/one-time pass/);
  });
});

// Q1849: Apple can charge without our purchase gate (auto-renewal, iOS
// Settings, offer codes). The grant stands; a switch-off member is reported.
// @mutate supabase/functions/apple-app-store-notifications/index.ts |       if (membershipsSwitch !== "on") { |       if (false) {
// @mutate supabase/functions/_shared/appleAppStore.ts |     if (data === false) return "off"; |     if (data === false) return "on";
describe("Q1849 · a grant to a member the memberships switch is off for is reported, never refused", () => {
  type Alert = { kind?: string; title?: string; message?: string };
  const offAlerts = () => (slackAlerts as Alert[]).filter((a) => a.kind === "money_at_risk");

  it("switch off: the renewal still grants AND raises a money_at_risk alert", async () => {
    scenario.rpc.feature_enabled_for_user = false;
    linkedRow("apple", "plus");
    const res = await notify("DID_RENEW");
    expect((await res.json()).outcome).toBe("granted");
    expect(profileWrites()[0].payload).toMatchObject({ subscription_tier: "plus" });
    expect(offAlerts()).toHaveLength(1);
    expect(offAlerts()[0].message).toMatch(/switch is off/);
    const ask = (scenario.rpcCalls ?? []).find((c) => c.name === "feature_enabled_for_user");
    expect(ask?.args).toEqual({ p_key: "memberships", p_user_id: USER });
  });

  it("switch on (a tester): no alert", async () => {
    linkedRow("apple", "plus");
    await notify("DID_RENEW");
    expect(offAlerts()).toHaveLength(0);
  });

  it("switch unreadable: still grants, and reports it as unreadable (never as on)", async () => {
    scenario.rpcErrors = { feature_enabled_for_user: { message: "boom" } };
    linkedRow("apple", "plus");
    const res = await notify("DID_RENEW");
    expect((await res.json()).outcome).toBe("granted");
    expect(offAlerts()).toHaveLength(1);
    expect(offAlerts()[0].message).toMatch(/could not be read/);
  });

  it("a revocation never asks or alerts", async () => {
    scenario.rpc.feature_enabled_for_user = false;
    appleReturns(baseTx({ revocationDate: Date.now() - 1000 }));
    linkedRow("apple", "plus");
    await notify("REFUND");
    expect(offAlerts()).toHaveLength(0);
  });
});
