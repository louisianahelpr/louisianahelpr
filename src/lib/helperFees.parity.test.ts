import { describe, it, expect } from "vitest";
import { TIER_PERKS, tierFeePercent, type SubscriptionTier } from "./subscriptionTiers";
// The edge helper lives in the Deno functions tree. It is plain TS (no Deno
// imports at module scope), so vitest can import it directly. This test is the
// guard that keeps the duplicated fee ladder in sync across the two runtimes.
import {
  TIER_FEE_PERCENT,
  feePercentForTier,
  DEFAULT_TIER_FEE_PERCENT,
} from "../../supabase/functions/_shared/helperFees";

describe("helper-fee tier ladder parity (UI ↔ edge)", () => {
  const tiers: SubscriptionTier[] = ["free", "basic", "pro", "elite"];

  it("edge TIER_FEE_PERCENT matches UI TIER_PERKS.platformFeePercent for every tier", () => {
    for (const tier of tiers) {
      expect(TIER_FEE_PERCENT[tier]).toBe(TIER_PERKS[tier].platformFeePercent);
    }
  });

  it("covers exactly the UI tier set (no extra/missing edge tiers)", () => {
    // Derive BOTH sides from their own tables rather than comparing two
    // hardcoded lists. The old form compared `Object.keys(TIER_FEE_PERCENT)`
    // against the local `tiers` literal, so adding a row to TIER_PERKS alone
    // — exactly the half of the retired `business` tier that lived on the
    // client — slipped straight past this guard. Now either table growing a key
    // the other lacks reds here, in whichever direction it happens.
    expect(Object.keys(TIER_FEE_PERCENT).sort()).toEqual(Object.keys(TIER_PERKS).sort());
    // And the literal above still has to name every one of them, so a tier
    // added to both tables cannot quietly skip the per-tier loops in this file.
    expect(Object.keys(TIER_PERKS).sort()).toEqual([...tiers].sort());
  });

  it("encodes the agreed 12 / 11 / 10 / 8 ladder", () => {
    expect(TIER_FEE_PERCENT).toEqual({ free: 12, basic: 11, pro: 10, elite: 8 });
  });

  it("normalizes case and falls back to the free rate for unknown tiers", () => {
    expect(feePercentForTier("ELITE")).toBe(8);
    expect(feePercentForTier(null)).toBe(DEFAULT_TIER_FEE_PERCENT);
    expect(feePercentForTier("nonsense")).toBe(DEFAULT_TIER_FEE_PERCENT);
    expect(DEFAULT_TIER_FEE_PERCENT).toBe(12);
  });
});

describe("tierFeePercent (client dashboard resolver) mirrors the edge payout resolver", () => {
  const tiers: SubscriptionTier[] = ["free", "basic", "pro", "elite"];

  it("resolves the same percent as edge feePercentForTier for every active tier", () => {
    for (const tier of tiers) {
      // No expiry (or a future one) → the tier's own rate on both runtimes.
      expect(tierFeePercent(tier)).toBe(feePercentForTier(tier));
    }
  });

  it("encodes the agreed 12 / 11 / 10 / 8 ladder", () => {
    expect(tierFeePercent("free")).toBe(12);
    expect(tierFeePercent("basic")).toBe(11);
    expect(tierFeePercent("pro")).toBe(10);
    expect(tierFeePercent("elite")).toBe(8);
  });

  it("has NO rung below Elite — 'business' is off the ladder and pays free", () => {
    // The `business` tier was removed on 2026-09-01 (nothing could sell or
    // store it; the prod census was zero rows). A legacy string must resolve
    // through the unknown-tier default to the FREE rate, never to the 6% the
    // retired rung used to grant.
    expect(tierFeePercent("business")).toBe(12);
    expect(feePercentForTier("business")).toBe(DEFAULT_TIER_FEE_PERCENT);
    expect(Object.values(TIER_FEE_PERCENT).every((p) => p >= 8)).toBe(true);
  });

  it("reverts an EXPIRED paid tier to the free rate, matching getHelperFeePercent", () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(tierFeePercent("elite", past)).toBe(12);
    expect(tierFeePercent("pro", past)).toBe(12);
    // A still-active paid tier keeps its discounted rate.
    expect(tierFeePercent("elite", future)).toBe(8);
  });

  it("normalizes case and falls back to free for unknown / null tiers", () => {
    expect(tierFeePercent("PRO")).toBe(10);
    expect(tierFeePercent(null)).toBe(12);
    expect(tierFeePercent(undefined)).toBe(12);
    expect(tierFeePercent("nonsense")).toBe(12);
  });
});
