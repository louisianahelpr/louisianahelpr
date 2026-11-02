// @mutate supabase/functions/subscription-reconciliation/index.ts | if (verdict === "counts") continue; | continue;
// @mutate supabase/functions/subscription-reconciliation/index.ts |       if (profile.subscription_source !== "stripe") { |       if (false) {
// @mutate supabase/functions/subscription-reconciliation/index.ts | if (matchedUserIds.has(p.user_id)) continue; // Stripe pays for it: report only | void 0;
// @mutate supabase/functions/subscription-reconciliation/index.ts | if (verdict === "unknown") { | if (false) {
// @mutate supabase/functions/subscription-reconciliation/index.ts | if (p.subscription_source !== "apple" \|\| !p.subscription_tier) continue; | if (true) continue;
// Q1858, the reclaim pass.
// @mutate supabase/functions/subscription-reconciliation/index.ts |       if (!meta \|\| !isEntitled(tx, meta)) continue; |       if (!meta) continue;
// @mutate supabase/functions/subscription-reconciliation/index.ts |         tx = originalMeta.kind === "auto" ? await fetchLatestSubscriptionTransaction(original) : original; |         tx = original;
// @mutate supabase/functions/subscription-reconciliation/index.ts |       if (p.stripe_subscription_id) continue;\n |
// @mutate supabase/functions/subscription-reconciliation/index.ts |       if (p.subscription_tier && (stripeExpiry === null \|\| stripeExpiry > now)) continue; // a Stripe tier still running |       void stripeExpiry;
// @mutate supabase/functions/subscription-reconciliation/index.ts |       if (reclaimVerdict === "does_not_count") continue;\n      const expiresAt |       const expiresAt
// @mutate supabase/functions/subscription-reconciliation/index.ts |       if (appleOwnsNow.has(p.user_id)) continue; // Apple took it back, or its Apple read failed (2b') |       void appleOwnsNow;
// @mutate supabase/functions/subscription-reconciliation/index.ts |         appleOwnsNow.add(p.user_id);\n        continue;\n      }\n      const meta = resolveProduct(tx.productId); |         continue;\n      }\n      const meta = resolveProduct(tx.productId);
// @mutate supabase/functions/subscription-reconciliation/index.ts |         onlyIf: { subscription_source: p.subscription_source, stripe_subscription_id: null }, |
// @mutate supabase/functions/subscription-reconciliation/index.ts |           write = value === null ? write.is(column, null) : write.eq(column, value); |           void write;
// @mutate supabase/functions/subscription-reconciliation/index.ts |       if (switchState !== "on") { |       if (false) {
// @mutate supabase/functions/subscription-reconciliation/index.ts |       if (reclaimVerdict === "unknown") { |       if (false) {
/**
 * subscription-reconciliation grades Apple rows by the App Store environment.
 *
 * Found by the reviewers of the sec-c batch (2026-10-15): the daily
 * reconciliation skipped every subscription_source 'apple' row and never
 * asked Apple anything, so a paid tier granted from a SANDBOX transaction
 * (free) on a real account would stand forever. verify-apple-iap and
 * apple-app-store-notifications refuse that now (a Sandbox transaction
 * counts only for a test account, or in a deployment that opted into
 * sandbox); this run applies the same rule (environmentVerdict) to the
 * rows already granted, reports apple_sandbox_grant and clears the tier.
 *
 * Runs the REAL function source through the edge harness.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { PRO_ONE_TIME_AMOUNT_CENTS, PRO_PRICE_MAP, PRO_RECURRING_AMOUNT_CENTS } from "../../../supabase/functions/_shared/proTiers";
import { PRODUCT_TO_TIER } from "../../../supabase/functions/_shared/productTiers";

const CRON_SECRET = "cron-secret-apple-env";
const URL_RUN = "https://edge.test/subscription-reconciliation?include_seed=1";
const ORIG = "2000000888";

const b64u = (o: unknown) =>
  Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let env: Record<string, string>;
let appleFetch: ReturnType<typeof vi.fn>;

/** Apple's transaction for ORIG, as the App Store Server API returns it. */
function appleSays(environment: "Production" | "Sandbox" | "unreachable") {
  appleFetch = vi.fn(async () => {
    if (environment === "unreachable") return new Response("{}", { status: 500 });
    const tx = {
      transactionId: ORIG, originalTransactionId: ORIG, productId: "com.helpr.plus.monthly",
      bundleId: "com.Helpr", expiresDate: Date.now() + 9e8, purchaseDate: Date.now(), environment,
    };
    return new Response(JSON.stringify({ signedTransactionInfo: `${b64u({ alg: "ES256" })}.${b64u(tx)}.sig` }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", appleFetch);
}

async function load(extraEnv: Record<string, string> = {}) {
  const { generateKeyPairSync } = await import("node:crypto");
  env = {
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    CRON_SECRET,
    APPLE_IAP_ISSUER_ID: "issuer",
    APPLE_IAP_KEY_ID: "keyid",
    APPLE_IAP_BUNDLE_ID: "com.Helpr",
    // A P-256 key generated per run (as mapkit-token.test.ts does): mintBearer really signs
    // with it, and no commit carries key material.
    APPLE_IAP_PRIVATE_KEY: generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    ...extraEnv,
  };
  setEnv(env);
  vi.stubGlobal("Deno", { env: { get: (k: string) => env[k] } });
  // Every Price says what the app says, so only the Apple check can find anything.
  const amountFor = new Map<string, number>();
  const expected = { ...PRO_RECURRING_AMOUNT_CENTS, one_time: PRO_ONE_TIME_AMOUNT_CENTS };
  for (const cycle of ["monthly", "annual", "one_time"] as const) {
    for (const [tier, cents] of Object.entries(expected[cycle])) {
      const id = PRO_PRICE_MAP[cycle][tier as keyof typeof PRO_RECURRING_AMOUNT_CENTS.monthly];
      if (id) amountFor.set(id, cents as number);
    }
  }
  (stripeMock as unknown as { prices: unknown }).prices = {
    retrieve: vi.fn(async (id: string) => ({ id, unit_amount: amountFor.get(id), active: true })),
    list: vi.fn(async () => ({
      data: [{ id: "price_mapped", product: Object.keys(PRODUCT_TO_TIER)[0], nickname: null, unit_amount: 500 }],
      has_more: false,
    })),
  };
  return loadEdgeFunction("subscription-reconciliation");
}

/** An Apple-billed member, paid through a future instant. */
function appleRow(isSeed: boolean) {
  scenario.reads.profiles = {
    rows: [{
      user_id: "u-apple", email: "a@example.test", subscription_tier: "plus",
      subscription_expires_at: new Date(Date.now() + 9e8).toISOString(), stripe_customer_id: null,
      stripe_subscription_id: null, subscription_billing_cycle: "monthly",
      subscription_cancel_at_period_end: false, subscription_source: "apple",
      apple_original_transaction_id: ORIG, is_seed: isSeed,
    }],
  };
}

const run = async (extraEnv: Record<string, string> = {}) => {
  const fn = await load(extraEnv);
  const res = await fn.fetch(fn.request({
    method: "POST", url: URL_RUN, headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {},
  }));
  return JSON.parse(await res.text()) as {
    findings: Array<{ check: string; sample: unknown[] }>;
    seed_findings: Array<{ check: string }>;
    scan_caps: string[];
  };
};
const tierClears = () =>
  (scenario.writes ?? []).filter((w) => w.table === "profiles" && w.op === "update"
    && (w.payload as Record<string, unknown>)?.subscription_tier === null);

beforeEach(() => {
  resetEnv(); resetSupabaseMock(); resetSharedMocks(); resetStripeMock();
});

describe("Apple rows are graded by the App Store environment", () => {
  it("a SANDBOX grant on a real account is reported and its tier cleared", async () => {
    appleSays("Sandbox");
    appleRow(false);
    scenario.reads.test_accounts = { rows: [] };
    const b = await run();
    const hit = b.findings.find((f) => f.check === "apple_sandbox_grant");
    expect(hit, "a free sandbox tier on a real account went unreported").toBeTruthy();
    expect(JSON.stringify(hit!.sample)).toContain("u-apple");
    expect(tierClears()).toHaveLength(1);
    // Apple stays the authority, as on an Apple revoke.
    expect(tierClears()[0].payload).not.toHaveProperty("subscription_source");
    expect(tierClears()[0].payload).not.toHaveProperty("apple_original_transaction_id");
  });

  it("a PRODUCTION grant is left alone", async () => {
    appleSays("Production");
    appleRow(false);
    const b = await run();
    expect(b.findings.map((f) => f.check)).not.toContain("apple_sandbox_grant");
    expect(tierClears()).toHaveLength(0);
    expect(appleFetch).toHaveBeenCalled();
  });

  it("a SANDBOX grant on a test account (test_accounts + is_seed) is left alone", async () => {
    appleSays("Sandbox");
    appleRow(true);
    scenario.reads.test_accounts = { rows: [{ user_id: "u-apple" }] };
    const b = await run();
    expect([...b.findings, ...b.seed_findings].map((f) => f.check)).not.toContain("apple_sandbox_grant");
    expect(tierClears()).toHaveLength(0);
  });

  it("a deployment that opted into sandbox leaves a SANDBOX grant alone", async () => {
    appleSays("Sandbox");
    appleRow(false);
    scenario.reads.test_accounts = { rows: [] };
    const b = await run({ APPLE_IAP_ENVIRONMENT: "sandbox" });
    expect(b.findings.map((f) => f.check)).not.toContain("apple_sandbox_grant");
    expect(tierClears()).toHaveLength(0);
  });

  it("a test-account read error is 'don't know': a partial scan, never a clearing (review finding 3)", async () => {
    appleSays("Sandbox");
    appleRow(true);
    scenario.reads.test_accounts = { error: { message: "boom" } };
    const b = await run();
    expect(b.scan_caps.join(" ")).toMatch(/test-account status for u-apple could not be read/);
    expect(tierClears()).toHaveLength(0);
  });

  it("a Sandbox anchor on a row a LIVE Stripe subscription pays for is reported, never cleared (review finding 2)", async () => {
    appleSays("Sandbox");
    const product = Object.entries(PRODUCT_TO_TIER).find(([, t]) => t === "plus")![0];
    scenario.reads.profiles = {
      rows: [{
        user_id: "u-apple", email: "a@example.test", subscription_tier: "plus",
        subscription_expires_at: new Date(Date.now() + 9e8).toISOString(), stripe_customer_id: "cus_1",
        stripe_subscription_id: "sub_1", subscription_billing_cycle: "monthly",
        subscription_cancel_at_period_end: false, subscription_source: "apple",
        apple_original_transaction_id: ORIG, is_seed: false,
      }],
    };
    scenario.reads.test_accounts = { rows: [] };
    stripeMock.subscriptions.list.mockResolvedValue({
      data: [{
        id: "sub_1", customer: "cus_1", status: "active", cancel_at_period_end: false,
        items: { data: [{ price: { id: "price_x", product, recurring: { interval: "month" } }, current_period_end: Math.floor((Date.now() + 9e8) / 1000) }] },
      }],
      has_more: false,
    });
    const b = await run();
    expect(b.findings.map((f) => f.check)).toContain("apple_sandbox_grant");
    expect(tierClears()).toHaveLength(0);
    // Section 2b graded it against the live Stripe subscription, so it now
    // records Stripe as the authority (re-review finding 2).
    const stamped = (scenario.writes ?? []).filter((w) => w.table === "profiles" && w.op === "update"
      && (w.payload as Record<string, unknown>)?.subscription_source === "stripe");
    expect(stamped).toHaveLength(1);
  });

  it("an Apple read that fails is a partial scan, never a clearing", async () => {
    appleSays("unreachable");
    appleRow(false);
    const b = await run();
    expect(b.scan_caps.join(" ")).toMatch(/Apple transaction for u-apple could not be read/);
    expect(tierClears()).toHaveLength(0);
  });
});

/**
 * Q1858 (lh-money-escrow re-review, 2026-10-15). After ops settle a double
 * subscription by cancelling the Stripe side, the member is paying Apple and
 * the row is still Stripe's. apple-app-store-notifications reclaims it only
 * when Apple next sends a notice (up to a year for an annual member). The
 * daily run now grades such a row from Apple's LATEST transaction.
 */
describe("Apple takes back a row Stripe no longer holds (Q1858)", () => {
  const ROW = (o: Record<string, unknown> = {}) => ({
    user_id: "u-switched", email: "s@example.test", subscription_tier: null,
    subscription_expires_at: null, stripe_customer_id: "cus_old",
    stripe_subscription_id: null, subscription_billing_cycle: null,
    subscription_cancel_at_period_end: false, subscription_source: "stripe",
    apple_original_transaction_id: ORIG, is_seed: false, ...o,
  });
  const LATEST_EXPIRY = Date.now() + 300 * 864e5;
  /** The original purchase (a past period) and the latest transaction, as Apple's two endpoints return them. */
  function appleLatest(latest: Record<string, unknown> | "unreachable", environment: "Production" | "Sandbox" = "Production") {
    const original = {
      transactionId: ORIG, originalTransactionId: ORIG, productId: "com.helpr.plus.monthly",
      bundleId: "com.Helpr", expiresDate: Date.now() - 400 * 864e5, purchaseDate: Date.now() - 430 * 864e5, environment,
    };
    const signed = (tx: unknown) => `${b64u({ alg: "ES256" })}.${b64u(tx)}.sig`;
    appleFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/inApps/v1/transactions/")) {
        return new Response(JSON.stringify({ signedTransactionInfo: signed(original) }), { status: 200 });
      }
      if (url.includes("/inApps/v1/subscriptions/")) {
        if (latest === "unreachable") return new Response("{}", { status: 503 });
        const tx = { ...original, transactionId: "2000000999", productId: "com.helpr.pro.annual", expiresDate: LATEST_EXPIRY, ...latest };
        return new Response(JSON.stringify({ data: [{ lastTransactions: [{ originalTransactionId: ORIG, signedTransactionInfo: signed(tx) }] }] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", appleFetch);
  }
  const reclaims = () => (scenario.writes ?? []).filter((w) => w.table === "profiles" && w.op === "update"
    && (w.payload as Record<string, unknown>)?.subscription_source === "apple");

  it("a paid Apple subscription takes the row back, graded from Apple's LATEST transaction, guarded on the state it read", async () => {
    appleLatest({});
    scenario.reads.profiles = { rows: [ROW()] };
    scenario.reads.test_accounts = { rows: [] };
    scenario.rpc.feature_enabled_for_user = true;
    const b = await run();
    expect(reclaims(), "the member paying Apple got no tier back").toHaveLength(1);
    const w = reclaims()[0];
    expect(w.payload).toEqual({
      subscription_tier: "pro", subscription_expires_at: new Date(LATEST_EXPIRY).toISOString(),
      subscription_billing_cycle: "annual", subscription_source: "apple",
    });
    expect(w.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: "subscription_source", value: "stripe" }),
      expect.objectContaining({ op: "is", column: "stripe_subscription_id", value: null }),
    ]));
    expect(b.findings.map((f) => f.check)).toContain("apple_reclaimed");
    expect(b.findings.map((f) => f.check)).not.toContain("apple_reclaimed_memberships_off");
  });

  it("an expired Stripe tier is not cleared by 2c in the same run: Apple's grant is the only write", async () => {
    appleLatest({});
    scenario.reads.profiles = { rows: [ROW({ subscription_tier: "plus", subscription_expires_at: new Date(Date.now() - 5 * 864e5).toISOString() })] };
    scenario.reads.test_accounts = { rows: [] };
    scenario.rpc.feature_enabled_for_user = true;
    await run();
    expect(tierClears()).toHaveLength(0);
    expect(reclaims()).toHaveLength(1);
  });

  it("the memberships switch off (or unreadable): the grant stands and it is reported for a refund", async () => {
    appleLatest({});
    scenario.reads.profiles = { rows: [ROW()] };
    scenario.reads.test_accounts = { rows: [] };
    scenario.rpc.feature_enabled_for_user = false;
    const b = await run();
    expect(reclaims()).toHaveLength(1);
    expect(b.findings.map((f) => f.check)).toContain("apple_reclaimed_memberships_off");
  });

  for (const [why, latest] of [
    ["the latest transaction has lapsed", { expiresDate: Date.now() - 864e5 }],
    ["the latest transaction was refunded", { revocationDate: Date.now() - 864e5 }],
  ] as const) {
    it(`${why}: nothing is reclaimed`, async () => {
      appleLatest(latest);
      scenario.reads.profiles = { rows: [ROW()] };
      scenario.reads.test_accounts = { rows: [] };
      await run();
      expect(reclaims()).toHaveLength(0);
    });
  }

  it("a Sandbox subscription whose test-account status cannot be read: 'don't know', a partial scan, never a grant", async () => {
    appleLatest({}, "Sandbox");
    scenario.reads.profiles = { rows: [ROW()] };
    scenario.reads.test_accounts = { error: { message: "boom" } };
    scenario.rpc.feature_enabled_for_user = true;
    const b = await run();
    expect(b.scan_caps.join(" ")).toMatch(/test-account status for u-switched could not be read; Apple reclaim not graded/);
    expect(reclaims()).toHaveLength(0);
  });

  it("a Sandbox subscription on a real account reclaims nothing", async () => {
    appleLatest({}, "Sandbox");
    scenario.reads.profiles = { rows: [ROW()] };
    scenario.reads.test_accounts = { rows: [] };
    await run();
    expect(reclaims()).toHaveLength(0);
  });

  for (const [why, row] of [
    ["a Stripe subscription id is still on the row", ROW({ stripe_subscription_id: "sub_gone" })],
    ["a Stripe tier is still running", ROW({ subscription_tier: "plus", subscription_expires_at: new Date(Date.now() + 9e8).toISOString() })],
    ["a Stripe tier with no end date", ROW({ subscription_tier: "plus" })],
  ] as const) {
    it(`${why}: Stripe still holds it, so Apple is not even asked`, async () => {
      appleLatest({});
      scenario.reads.profiles = { rows: [row] };
      scenario.reads.test_accounts = { rows: [] };
      await run();
      expect(reclaims()).toHaveLength(0);
      expect(appleFetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/inApps/"))).toEqual([]);
    });
  }

  it("Apple unreachable: a partial scan, and 2c does not clear the expired Stripe tier on a guess", async () => {
    appleLatest("unreachable");
    scenario.reads.profiles = { rows: [ROW({ subscription_tier: "plus", subscription_expires_at: new Date(Date.now() - 5 * 864e5).toISOString() })] };
    scenario.reads.test_accounts = { rows: [] };
    const b = await run();
    expect(b.scan_caps.join(" ")).toMatch(/Apple subscription for u-switched could not be read \(reclaim pass\)/);
    expect(reclaims()).toHaveLength(0);
    expect(tierClears()).toHaveLength(0);
  });
});
