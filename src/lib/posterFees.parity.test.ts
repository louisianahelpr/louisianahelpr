import { describe, it, expect } from "vitest";
import {
  posterFeePercentForTier as uiPosterFeePercentForTier,
  posterServiceFeeCents as uiPosterServiceFeeCents,
} from "./posterFees";
// The edge helpers are plain TS (no Deno imports at module scope), so vitest can
// import them directly. This test is the guard that keeps the poster-fee logic
// identical across the two runtimes — a drift here would make the shown checkout
// total disagree with what the poster is actually charged.
import {
  posterFeePercentForTier as edgePosterFeePercentForTier,
  posterServiceFeeCents as edgePosterServiceFeeCents,
} from "../../supabase/functions/_shared/posterFees";
import { stripeProcessingCostCents } from "./stripeFees";

describe("poster-fee tier ladder + Stripe floor parity (UI ↔ edge)", () => {
  const tiers = ["free", "basic", "pro", "elite", "business", "PRO", null, undefined, "nonsense"];

  it("resolves the same fee percent for every tier on both runtimes", () => {
    for (const tier of tiers) {
      expect(uiPosterFeePercentForTier(tier)).toBe(edgePosterFeePercentForTier(tier));
    }
  });

  it("encodes the agreed 12 / 11 / 10 / 8 / 6 ladder from the free/paid tiers", () => {
    expect(uiPosterFeePercentForTier("free")).toBe(12);
    expect(uiPosterFeePercentForTier("basic")).toBe(11);
    expect(uiPosterFeePercentForTier("pro")).toBe(10);
    expect(uiPosterFeePercentForTier("elite")).toBe(8);
    expect(uiPosterFeePercentForTier("business")).toBe(6);
  });

  it("reverts an EXPIRED paid tier to the free rate on both runtimes", () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(uiPosterFeePercentForTier("elite", past)).toBe(12);
    expect(edgePosterFeePercentForTier("elite", past)).toBe(12);
    // A still-active paid tier keeps its discounted rate.
    expect(uiPosterFeePercentForTier("elite", future)).toBe(8);
    expect(edgePosterFeePercentForTier("elite", future)).toBe(8);
  });

  it("computes the same service fee (with floor) for a grid of budgets/tiers/extras", () => {
    const budgets = [1000, 2500, 5000, 10_000, 25_000, 100]; // cents; incl. a sub-floor tiny value
    const percents = [12, 11, 10, 8, 6];
    const extras = [0, 500, 700];
    for (const b of budgets) {
      for (const p of percents) {
        for (const e of extras) {
          expect(uiPosterServiceFeeCents(b, p, e)).toBe(edgePosterServiceFeeCents(b, p, e));
        }
      }
    }
  });

  it("floors the fee at Stripe's processing cost so a tiny job can't lose money", () => {
    // $1 job at 6% → tier fee = 6¢, but Stripe costs ~33¢: the floor must win.
    const fee = uiPosterServiceFeeCents(100, 6, 0);
    expect(fee).toBeGreaterThan(6);
    expect(fee).toBe(edgePosterServiceFeeCents(100, 6, 0));
  });

  it("uses the raw tier percentage when it already exceeds the Stripe floor", () => {
    // A $250 job at 12% → tier fee = $30, far above Stripe's ~$8.70 cost.
    expect(uiPosterServiceFeeCents(25_000, 12, 0)).toBe(3000);
  });

  it("never collects less than Stripe's real cost on the WHOLE charge (fee incl.)", () => {
    // Regression guard for the floor self-reference bug: the collected fee is
    // itself part of the charge, so the invariant is
    // `fee ≥ stripeCost(budget + fee + other)`. The old floor measured against
    // `budget + tierFee + other` and undershot by ~1¢ exactly when the floor
    // was meant to protect us. Sweep the small-budget/high-extra region where
    // the floor binds and assert the invariant holds on BOTH runtimes.
    for (const b of [100, 500, 1000, 1500, 5000]) {
      for (const p of [12, 11, 10, 8, 6]) {
        for (const e of [0, 200, 500, 900]) {
          const fee = uiPosterServiceFeeCents(b, p, e);
          expect(fee).toBe(edgePosterServiceFeeCents(b, p, e));
          expect(fee).toBeGreaterThanOrEqual(stripeProcessingCostCents(b + fee + e));
        }
      }
    }
  });
});
