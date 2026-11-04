/**
 * Memberships RETIRED (owner 2026-11-04, Builder 114): fees and payouts for a
 * real member are byte-identical before and after, and no paid-tier fee branch
 * is reachable.
 *
 * Measured on prod 2026-11-04 (read-only): 0 of 260 real profiles hold a
 * subscription_tier (all null). So the "real member" inputs are a null tier
 * (and, defensively, undefined / "" / "free"), with any expiry.
 *
 * BEFORE is the resolver as it stood on origin/main before this change, copied
 * verbatim below (feePercentForTier + TIER_FEE_PERCENT from
 * supabase/functions/_shared/helperFees.ts @ ac10ccf8cf). AFTER is the live
 * module. For every real-member input, every budget and both commission
 * helpers, the cents match exactly. For every paid tier AFTER is the standard
 * rate (no discount reachable), and getHelperFeePercent's read-failure and
 * no-helper fallbacks are unchanged.
 *
 * @mutate supabase/functions/_shared/helperFees.ts |   return DEFAULT_TIER_FEE_PERCENT;\n} |   return _rawTier === "pro" ? 10 : DEFAULT_TIER_FEE_PERCENT;\n}
 * @mutate supabase/functions/_shared/helperFees.ts |   return DEFAULT_TIER_FEE_PERCENT;\n} |   return (_rawTier ?? null) === null ? 11 : DEFAULT_TIER_FEE_PERCENT;\n}
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIER_FEE_PERCENT,
  feePercentForTier,
  getHelperFeePercent,
  helperCommissionDollars,
  readHelperFeePercentStrict,
} from "../../supabase/functions/_shared/helperFees";
import { tierFeePercent } from "@/lib/subscriptionTiers";

// BEFORE (verbatim from origin/main @ ac10ccf8cf).
const BEFORE_TABLE: Record<string, number> = { free: 12, basic: 11, pro: 10, plus: 9, elite: 8 };
function beforeFeePercentForTier(rawTier: string | null | undefined, expiresAt?: string | null): number {
  const expired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;
  const tier = (expired ? "free" : (rawTier ?? "")).toLowerCase();
  return BEFORE_TABLE[tier] ?? 12;
}

const PAST = new Date(Date.now() - 86_400_000).toISOString();
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const EXPIRIES = [undefined, null, PAST, FUTURE, "not-a-date"];
const REAL_MEMBER_TIERS = [null, undefined, "", "free", "FREE"];
const BUDGETS = [1, 9.99, 20, 47.5, 100, 120, 333.33, 999.99, 1000];

/** Minimal service client: profiles.select().eq().single()/maybeSingle(). */
function client(result: { data: unknown; error: unknown } | "throw") {
  const chain = {
    select: () => chain,
    eq: () => chain,
    single: async () => { if (result === "throw") throw new Error("boom"); return result; },
    maybeSingle: async () => { if (result === "throw") throw new Error("boom"); return result; },
  };
  return { from: () => chain } as never;
}

describe("memberships retired: a real member's fee and payout are byte-identical", () => {
  it("the resolver gives a real member the same percent as before, every expiry state", () => {
    let n = 0;
    for (const t of REAL_MEMBER_TIERS) for (const e of EXPIRIES) {
      expect(feePercentForTier(t, e), `${t} ${e}`).toBe(beforeFeePercentForTier(t, e));
      expect(tierFeePercent(t, e), `client ${t} ${e}`).toBe(beforeFeePercentForTier(t, e));
      n++;
    }
    expect(n).toBeGreaterThan(20);
  });

  it("the commission and take-home cents are identical for every budget", () => {
    for (const t of REAL_MEMBER_TIERS) for (const b of BUDGETS) {
      const before = helperCommissionDollars(b, beforeFeePercentForTier(t));
      const after = helperCommissionDollars(b, feePercentForTier(t));
      expect(Math.round(after * 100), `${t} $${b}`).toBe(Math.round(before * 100));
      expect(Math.round((b - after) * 100)).toBe(Math.round((b - before) * 100));
    }
  });

  it("the live profile read gives a real member the same percent, and failures fall back exactly as before", async () => {
    const real = client({ data: { subscription_tier: null, subscription_expires_at: null }, error: null });
    expect(await getHelperFeePercent(real, "h1", 10)).toBe(beforeFeePercentForTier(null, null));
    expect(await readHelperFeePercentStrict(real, "h1", 10)).toEqual({ ok: true, percent: 12 });
    // Unchanged fallbacks: no helper, read error, thrown read, no row.
    expect(await getHelperFeePercent(real, null, 10)).toBe(10);
    expect(await getHelperFeePercent(client({ data: null, error: { message: "x" } }), "h1", 10)).toBe(10);
    expect(await getHelperFeePercent(client("throw"), "h1", 10)).toBe(10);
    expect(await readHelperFeePercentStrict(client({ data: null, error: null }), "h1", 10)).toEqual({ ok: true, percent: 10 });
    expect((await readHelperFeePercentStrict(client({ data: null, error: { message: "x" } }), "h1", 10)).ok).toBe(false);
  });
});

describe("memberships retired: no paid-tier fee branch is reachable", () => {
  it("every paid tier, any casing, any expiry, resolves to the standard rate on both runtimes", async () => {
    const paid = Object.keys(BEFORE_TABLE).filter((t) => t !== "free");
    expect(paid.length).toBe(4);
    for (const t of [...paid, ...paid.map((x) => x.toUpperCase())]) for (const e of EXPIRIES) {
      expect(feePercentForTier(t, e), `${t} ${e}`).toBe(DEFAULT_TIER_FEE_PERCENT);
      expect(tierFeePercent(t, e), `client ${t} ${e}`).toBe(DEFAULT_TIER_FEE_PERCENT);
    }
    const elite = client({ data: { subscription_tier: "elite", subscription_expires_at: FUTURE }, error: null });
    expect(await getHelperFeePercent(elite, "h1", 10)).toBe(12);
    expect(await readHelperFeePercentStrict(elite, "h1", 10)).toEqual({ ok: true, percent: 12 });
    expect(DEFAULT_TIER_FEE_PERCENT).toBe(12);
  });
});
