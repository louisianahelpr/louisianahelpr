/**
 * S-003: the hourly Stripe price check covered monthly and annual only, so the
 * "Once" pass charged three live Prices whose amounts nothing compared with
 * the price shown beside it (the monthly price, tierConfig.tsx oneTime).
 *
 * @mutate supabase/functions/subscription-reconciliation/index.ts | for (const cycle of ["monthly", "annual", "one_time"] as const) { // S-003 all three cycles | for (const cycle of ["monthly", "annual"] as const) { // S-003 all three cycles
 * @mutate supabase/functions/_shared/proTiers.ts | = PRO_RECURRING_AMOUNT_CENTS.monthly; // S-003 once = monthly | = PRO_RECURRING_AMOUNT_CENTS.annual; // S-003 once = monthly
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TIER_PERKS, type SubscriptionTier } from "@/lib/subscriptionTiers";
import { PRO_ONE_TIME_AMOUNT_CENTS, PRO_PRICE_MAP } from "../../supabase/functions/_shared/proTiers";

const recon = readFileSync("supabase/functions/subscription-reconciliation/index.ts", "utf8");
const tierConfig = readFileSync("src/components/profile/subscriptionTab/tierConfig.tsx", "utf8");

describe("the one-time pass price is asked of Stripe (S-003)", () => {
  it("every one_time Price has an expected amount", () => {
    expect(Object.keys(PRO_ONE_TIME_AMOUNT_CENTS).sort()).toEqual(Object.keys(PRO_PRICE_MAP.one_time).sort());
  });
  it("the expected amount is the price the UI shows beside Once", () => {
    expect(tierConfig).toContain("oneTime: `$${monthlyPrice}`");
    for (const [tier, cents] of Object.entries(PRO_ONE_TIME_AMOUNT_CENTS)) {
      expect(cents, tier).toBe(Math.round(TIER_PERKS[tier as SubscriptionTier].price! * 100));
    }
  });
  it("reconciliation retrieves the one_time Prices", () => {
    expect(recon).toMatch(/for \(const cycle of \[[^\]]*"one_time"[^\]]*\] as const\)/);
    expect(recon).toContain("one_time: PRO_ONE_TIME_AMOUNT_CENTS");
  });
});
