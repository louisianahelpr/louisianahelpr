// @mutate supabase/functions/subscription-reconciliation/index.ts | if (verdict === "counts") continue; | continue;
// @mutate supabase/functions/subscription-reconciliation/index.ts |       if (profile.subscription_source !== "stripe") { |       if (false) {
// @mutate supabase/functions/subscription-reconciliation/index.ts | if (matchedUserIds.has(p.user_id)) continue; // Stripe pays for it: report only | void 0;
// @mutate supabase/functions/subscription-reconciliation/index.ts | if (verdict === "unknown") { | if (false) {
// @mutate supabase/functions/subscription-reconciliation/index.ts | if (p.subscription_source !== "apple" \|\| !p.subscription_tier) continue; | if (true) continue;
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
