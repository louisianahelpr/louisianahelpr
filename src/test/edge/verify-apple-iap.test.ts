/**
 * verify-apple-iap — executed, because a grep cannot prove a grant happened.
 *
 * This function takes money's word from Apple and writes a paid tier. Its
 * existing coverage was source assertions in src/test/appleIap.test.ts, which
 * pin the SHAPE of the fix (`user_id` not `id`, `.select()` present). That was
 * worth doing — the unmerged branch failed exactly there — but it cannot answer
 * the question that matters: given a real request, does the right row change,
 * and does the function refuse when it should?
 *
 * The bug this guards against is specific and silent. supabase-js returns
 * `{ data: [], error: null }` for an UPDATE matching zero rows, so a grant that
 * writes nothing is indistinguishable from one that worked unless something
 * asserts the row. The buyer pays Apple either way.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const JWT = "Bearer caller.jwt.sig";
const USER = { id: "user-1", email: "buyer@example.com" };
const TX = "2000000001";

let fn: EdgeHarness;

/** Apple's authoritative transaction, delivered the way the API delivers it. */
function appleReturns(tx: Record<string, unknown>, status = 200) {
  const b64u = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ signedTransactionInfo: `${b64u({ alg: "ES256" })}.${b64u(tx)}.sig` }),
    { status, headers: { "Content-Type": "application/json" } },
  )));
}

const baseTx = (over: Record<string, unknown> = {}) => ({
  transactionId: TX,
  originalTransactionId: TX,
  productId: "com.helpr.plus.monthly",
  bundleId: "com.Helpr",
  expiresDate: Date.now() + 30 * 24 * 3600 * 1000,
  purchaseDate: Date.now(),
  ...over,
});

const post = (body: unknown, auth: string | null = JWT) =>
  fn.fetch(fn.request({
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: auth } : {}) },
    body,
  }));

beforeEach(async () => {
  resetEnv(); resetSupabaseMock(); resetSharedMocks();
  const ENV = {
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    APPLE_IAP_ISSUER_ID: "issuer",
    APPLE_IAP_KEY_ID: "keyid",
    APPLE_IAP_BUNDLE_ID: "com.Helpr",
    // A REAL P-256 PKCS8 key, generated once for this test and used nowhere
    // else. mintBearer runs before the (stubbed) fetch, and crypto.subtle
    // genuinely imports and signs with it — a placeholder throws
    // "Invalid keyData" and every case fails before reaching an assertion.
    APPLE_IAP_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgzWhoA6+l7Icd5++A\n9TLFfCMN1mj3J7s7h0cJFfX7lAehRANCAAQ5JneSHCYRL5DsV2O7bMFhn+IkZrRT\nLZEI9I3/xi1qIOI+QAajQ4TEeVBcQDXHcn675+Dnxf3RpZUV8dtLOzob\n-----END PRIVATE KEY-----",
  };
  setEnv(ENV);
  // _shared/appleAppStore.ts reads `globalThis.Deno` directly (deliberately —
  // it keeps the module importable from vitest), and the harness only rewrites
  // the bare `Deno` identifier inside the function's own source. So the shared
  // module needs the global itself.
  vi.stubGlobal("Deno", { env: { get: (k: string) => (ENV as Record<string, string>)[k] } });
  scenario.authUser = USER;
  appleReturns(baseTx());
  fn = await loadEdgeFunction("verify-apple-iap");
});

describe("the grant actually writes the buyer's row", () => {
  it("updates profiles by user_id and returns the tier", async () => {
    scenario.reads.profiles = { rows: [{ user_id: USER.id, subscription_tier: null, subscription_source: null, stripe_subscription_id: null }] };

    const res = await post({ transactionId: TX });
    expect(res.status).toBe(200);
    expect((await res.json()).tier).toBe("plus");

    const write = (scenario.writes ?? []).find((w) => w.table === "profiles" && w.op === "update");
    expect(write, "no profiles UPDATE was issued").toBeTruthy();
    // The branch bug: filtering on `id` matches zero rows in prod.
    expect(JSON.stringify(write!.filters)).toContain("user_id");
    expect(JSON.stringify(write!.filters)).not.toMatch(/"column"\s*:\s*"id"/);
    expect(write!.payload).toMatchObject({ subscription_tier: "plus", subscription_source: "apple" });
  });

  it("REFUSES when the update matches zero rows instead of reporting success", async () => {
    // The exact silent failure: supabase-js gives { data: [], error: null }.
    scenario.reads.profiles = { rows: [{ user_id: USER.id, subscription_tier: null, subscription_source: null, stripe_subscription_id: null }] };
    // The mock defaults to "the write matched a row"; the zero-row case is an
    // explicit opt-in, which is the right default — but it means the silent
    // failure this test exists for has to be asked for by name.
    scenario.writeSelectRows["profiles:update"] = [];

    const res = await post({ transactionId: TX });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/nothing was changed/i);
  });
});

describe("it refuses what it should", () => {
  it("rejects an unauthenticated caller", async () => {
    const res = await post({ transactionId: TX }, null);
    expect(res.status).toBe(401);
  });

  it("rejects a product that is not ours", async () => {
    appleReturns(baseTx({ productId: "com.someoneelse.pro.monthly" }));
    scenario.reads.profiles = { rows: [{ user_id: USER.id }] };
    const res = await post({ transactionId: TX });
    expect(res.status).toBe(400);
  });

  it("rejects a refunded transaction rather than granting", async () => {
    appleReturns(baseTx({ revocationDate: Date.now() }));
    scenario.reads.profiles = { rows: [{ user_id: USER.id }] };
    const res = await post({ transactionId: TX });
    expect(res.status).toBe(409);
    expect((scenario.writes ?? []).filter((w) => w.table === "profiles")).toHaveLength(0);
  });

  it("refuses a transaction already linked to a different account", async () => {
    // The duplicate-claim guard, which the branch broke in the other direction.
    scenario.reads.profiles = { rows: [{ user_id: "someone-else" }] };
    const res = await post({ transactionId: TX });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/different Helpr account/i);
  });
});
