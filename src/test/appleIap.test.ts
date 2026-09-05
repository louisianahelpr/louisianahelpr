// Apple IAP: the product registry, the entitlement maths, and the two lines
// that made the previous attempt dangerous.
//
// The unmerged feat/apple-iap branch (50efe839c) granted tiers with
// `.update({...}).eq("id", user.id)`. `profiles.id` is not `auth.users.id` —
// measured against prod 2026-09-05, 43 of 43 rows have `id <> user_id`, zero
// match. So the write touched no rows, supabase-js returned
// `{ data: [], error: null }`, and the function answered HTTP 200 with a tier
// it had not granted. The buyer pays Apple and gets nothing, silently.
//
// That is why the last block here reads the function's SOURCE. A mocked test
// does not reliably catch it: whether a zero-row update is distinguishable from
// a successful one depends entirely on how lenient the mock is, so a green
// mocked test would have been consistent with the shipped bug. The defect is
// "the query names the wrong column and the result is never checked", and that
// is visible in the source with no ambiguity at all.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  APPLE_TIERS,
  APPLE_CYCLES,
  appleProductId,
  PRODUCT_TIER_MAP,
  PRODUCT_IDS,
  resolveProduct,
  computeExpiry,
  isEntitled,
  decodeJwsPayload,
  type AppleTransaction,
} from "../../supabase/functions/_shared/appleAppStore";
import { PRO_PRICE_MAP, type ProTierKey, type ProBillingCycle } from "../lib/proTiers";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

/**
 * Source with comments removed.
 *
 * Necessary, not cosmetic: this file's assertions are about what the CODE does,
 * and verify-apple-iap's header quotes the exact broken patterns
 * (`.eq("id", user.id)`, a hand-written tier order) in order to explain why
 * they are wrong. Asserting against raw text would fail on the documentation of
 * the bug — and, worse, would PASS if someone deleted the explanation while
 * leaving the bug in place. Strip the prose, test the program.
 */
const codeOnly = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
    .replace(/^[ \t]*\/\/.*$/gm, "");     // whole-line // comments

describe("Apple product registry", () => {
  // THE POINT OF THIS TEST. A hand-written product map can only be checked
  // against itself: it cannot fail for a member it never had. So derive the
  // expected set from the app's OWN tier list (the Stripe price map, which the
  // storefront and checkout already agree on) and diff. Add a tier there and
  // this fails until its Apple products exist — which is exactly the guard the
  // Stripe side lacked when Plus shipped with price_TODO_LIVE_PLUS_* ids.
  it("covers every paid tier and cycle the app actually sells", () => {
    const cycles = Object.keys(PRO_PRICE_MAP) as ProBillingCycle[];
    const tiers = Object.keys(PRO_PRICE_MAP[cycles[0]]) as ProTierKey[];

    expect([...APPLE_CYCLES].sort()).toEqual([...cycles].sort());
    expect([...APPLE_TIERS].sort()).toEqual([...tiers].sort());

    for (const tier of tiers) {
      for (const cycle of cycles) {
        const id = appleProductId(tier, cycle);
        expect(PRODUCT_TIER_MAP[id], `missing Apple product for ${tier}/${cycle}`)
          .toBeDefined();
      }
    }
    expect(PRODUCT_IDS).toHaveLength(tiers.length * cycles.length);
  });

  it("round-trips every product id back to its tier and cycle", () => {
    for (const tier of APPLE_TIERS) {
      for (const cycle of APPLE_CYCLES) {
        const meta = resolveProduct(appleProductId(tier, cycle));
        expect(meta).not.toBeNull();
        expect(meta!.tier).toBe(tier);
        expect(meta!.cadence).toBe(cycle);
      }
    }
  });

  it("marks one-time products as non-renewing and the rest as auto", () => {
    expect(resolveProduct("com.helpr.pro.monthly")!.kind).toBe("auto");
    expect(resolveProduct("com.helpr.pro.annual")!.kind).toBe("auto");
    expect(resolveProduct("com.helpr.pro.onetime")!.kind).toBe("once");
  });

  it("uses no underscore in the one-time id, matching App Store Connect", () => {
    // The internal cycle key is `one_time`; the product id must be `onetime`.
    // Getting this wrong means the product simply never resolves and every
    // one-time purchase is rejected as an unknown product.
    expect(appleProductId("pro", "one_time")).toBe("com.helpr.pro.onetime");
    expect(PRODUCT_IDS.some((id) => id.includes("one_time"))).toBe(false);
  });

  it("refuses a product id that is not ours", () => {
    expect(resolveProduct("com.someoneelse.pro.monthly")).toBeNull();
    expect(resolveProduct("")).toBeNull();
  });
});

describe("entitlement maths", () => {
  const base = (over: Partial<AppleTransaction> = {}): AppleTransaction => ({
    transactionId: "2000000001",
    originalTransactionId: "2000000001",
    productId: "com.helpr.pro.monthly",
    bundleId: "com.Helpr",
    expiresDate: Date.parse("2026-10-05T00:00:00Z"),
    purchaseDate: Date.parse("2026-09-05T00:00:00Z"),
    ...over,
  });

  it("uses Apple's expiry for an auto-renewable subscription", () => {
    const meta = resolveProduct("com.helpr.pro.monthly")!;
    expect(computeExpiry(base(), meta)).toBe("2026-10-05T00:00:00.000Z");
  });

  it("gives a one-time purchase a year from the purchase date", () => {
    const meta = resolveProduct("com.helpr.pro.onetime")!;
    const got = computeExpiry(base({ productId: "com.helpr.pro.onetime" }), meta)!;
    expect(new Date(got).getUTCFullYear()).toBe(2027);
  });

  it("grants nothing once Apple has revoked or refunded it", () => {
    const meta = resolveProduct("com.helpr.pro.monthly")!;
    const tx = base({ revocationDate: Date.parse("2026-09-06T00:00:00Z") });
    expect(computeExpiry(tx, meta)).toBeNull();
    expect(isEntitled(tx, meta)).toBe(false);
  });

  it("treats a lapsed subscription as unentitled without calling it revoked", () => {
    const meta = resolveProduct("com.helpr.pro.monthly")!;
    const tx = base({ expiresDate: Date.parse("2026-09-01T00:00:00Z") });
    // Still has an expiry — it is simply in the past.
    expect(computeExpiry(tx, meta)).toBe("2026-09-01T00:00:00.000Z");
    expect(isEntitled(tx, meta, Date.parse("2026-09-05T00:00:00Z"))).toBe(false);
    expect(isEntitled(tx, meta, Date.parse("2026-08-30T00:00:00Z"))).toBe(true);
  });
});

describe("decodeJwsPayload", () => {
  const jws = (payload: unknown) => {
    const b64 = (s: string) =>
      Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return `${b64('{"alg":"ES256"}')}.${b64(JSON.stringify(payload))}.sig`;
  };

  it("decodes a base64url payload", () => {
    expect(decodeJwsPayload(jws({ productId: "com.helpr.pro.monthly" })))
      .toEqual({ productId: "com.helpr.pro.monthly" });
  });

  it("handles a payload whose length needs re-padding", () => {
    // base64url strips '=' padding. atob rejects an unpadded string in some
    // runtimes, so the decoder re-pads; without that this throws on roughly
    // three quarters of real payloads, depending on length.
    for (const n of [1, 2, 3, 4, 5, 6, 7]) {
      const payload = { p: "x".repeat(n) };
      expect(decodeJwsPayload(jws(payload))).toEqual(payload);
    }
  });

  it("rejects anything that is not a three-part compact JWS", () => {
    expect(() => decodeJwsPayload("a.b")).toThrow(/Malformed JWS/);
    expect(() => decodeJwsPayload("")).toThrow(/Malformed JWS/);
  });
});

describe("verify-apple-iap — the regressions that made the branch dangerous", () => {
  const SRC = codeOnly(read("supabase/functions/verify-apple-iap/index.ts"));

  it("never keys a profile lookup or write on `id`", () => {
    // profiles.id is not auth.users.id. 43/43 rows differ in prod, so any
    // `.eq("id", user.id)` matches nothing and reports success.
    expect(SRC).not.toMatch(/\.eq\(\s*["']id["']\s*,\s*user\.id/);
    expect(SRC).toMatch(/\.eq\(\s*["']user_id["']\s*,\s*user\.id/);
  });

  it("asserts the grant actually touched a row", () => {
    // A zero-row UPDATE returns { data: [], error: null }. Without .select()
    // and a length check, taking money and granting nothing is indistinguishable
    // from success.
    const grant = SRC.slice(SRC.indexOf("subscription_tier: grantedTier"));
    expect(grant).toContain('.select("user_id")');
    expect(grant).toMatch(/updated\.length === 0/);
  });

  it("compares the duplicate-claim guard on user_id, not id", () => {
    const guard = SRC.slice(
      SRC.indexOf("const { data: claimant"),
      SRC.indexOf("const { data: current"),
    );
    expect(guard).toContain('.select("user_id")');
    expect(guard).toMatch(/claimant\.user_id !== user\.id/);
  });

  it("does not refuse a purchase Apple has already been paid for", () => {
    // The pre-purchase gate is subscription_purchase_eligibility(). Refusing
    // HERE would leave a member charged and unentitled, which is strictly worse
    // than the double subscription it would be preventing.
    expect(SRC).not.toMatch(/active_subscription_elsewhere/);
    expect(SRC).toContain("double_subscription");
    expect(SRC).toMatch(/grantedTier/);
  });

  it("records which system is the authority for the tier", () => {
    // Without this the nightly Stripe reconciliation strips every Apple member.
    expect(SRC).toMatch(/subscription_source:\s*["']apple["']/);
  });

  it("ranks tiers from the fee table rather than a hand-written order", () => {
    expect(SRC).toContain("TIER_FEE_PERCENT");
    expect(SRC).not.toMatch(/\[\s*["']basic["']\s*,\s*["']pro["']\s*,\s*["']elite["']\s*\]/);
  });
});
