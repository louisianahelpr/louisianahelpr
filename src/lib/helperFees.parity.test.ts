import { describe, it, expect } from "vitest";
import { TIER_PERKS, type SubscriptionTier } from "./subscriptionTiers";
// The edge helper lives in the Deno functions tree. It is plain TS (no Deno
// imports at module scope), so vitest can import it directly. This test is the
// guard that keeps the duplicated fee ladder in sync across the two runtimes.
import {
  TIER_FEE_PERCENT,
  feePercentForTier,
  DEFAULT_TIER_FEE_PERCENT,
} from "../../supabase/functions/_shared/helperFees";

describe("helper-fee tier ladder parity (UI ↔ edge)", () => {
  const tiers: SubscriptionTier[] = ["free", "pro", "elite", "business"];

  it("edge TIER_FEE_PERCENT matches UI TIER_PERKS.platformFeePercent for every tier", () => {
    for (const tier of tiers) {
      expect(TIER_FEE_PERCENT[tier]).toBe(TIER_PERKS[tier].platformFeePercent);
    }
  });

  it("covers exactly the UI tier set (no extra/missing edge tiers)", () => {
    expect(Object.keys(TIER_FEE_PERCENT).sort()).toEqual([...tiers].sort());
  });

  it("encodes the agreed 12 / 10 / 8 / 6 ladder", () => {
    expect(TIER_FEE_PERCENT).toEqual({ free: 12, pro: 10, elite: 8, business: 6 });
  });

  it("normalizes case and falls back to the free rate for unknown tiers", () => {
    expect(feePercentForTier("ELITE")).toBe(8);
    expect(feePercentForTier(null)).toBe(DEFAULT_TIER_FEE_PERCENT);
    expect(feePercentForTier("nonsense")).toBe(DEFAULT_TIER_FEE_PERCENT);
    expect(DEFAULT_TIER_FEE_PERCENT).toBe(12);
  });
});
