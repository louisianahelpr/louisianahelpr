/**
 * A gift card pays the job price (budget + urgent bonus) and nothing else: the
 * poster-fee model, whose 5% + 70c the gift also paid, was removed (owner
 * 2026-10-23, #3556). The quote's gift cost must equal what redeem_gift_card
 * applies the gift against on a job with no poster stamp (budget + urgent fee),
 * or the shortfall shown would differ from the one charged.
 *
 * @mutate src/pages/post-job/useJobDerived.ts |   const giftCostCents = Math.round((budgetNum + urgentFeeNum) * 100); |   const giftCostCents = Math.round((budgetNum + urgentFeeNum) * 100) + 570;
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useJobDerived, type UseJobDerivedParams } from "./useJobDerived";

// The Helpr-activity line reads Supabase; the money math does not.
vi.mock("@/hooks/useHelprActivity", () => ({ useHelprActivity: () => ({ activity: null, loading: false }) }));

const base: UseJobDerivedParams = {
  budget: "100", isUrgent: false, urgentFee: "", onboardingFeePaid: true, onboardingFeeCents: 200,
  category: "cleaning", title: "t", description: "d", streetAddress: "1 Main", city: "Lafayette",
  addrState: "LA", zipCode: "70501", dateNeeded: "2099-01-01", startTime: "09:00",
  isFlexibleSchedule: false, parish: "Lafayette",
};
const derive = (p: Partial<UseJobDerivedParams>) => renderHook(() => useJobDerived({ ...base, ...p })).result.current;

describe("a gift pays the job price only", () => {
  it("$90 gift on a $100 job: the gift applies $90 and the card pays $10", () => {
    const d = derive({ giftCardAmount: 90 });
    expect(d.giftAppliedAmount).toBe(90);
    expect(d.totalCharge).toBeCloseTo(10, 2);
  });

  it("$120 gift on a $100 job: the gift covers $100 and nothing is charged", () => {
    const d = derive({ giftCardAmount: 120 });
    expect(d.giftAppliedAmount).toBe(100);
    expect(d.totalCharge).toBe(0);
  });

  it("an urgent bonus is part of what the gift pays", () => {
    const d = derive({ giftCardAmount: 90, isUrgent: true, urgentFee: "20" });
    expect(d.giftAppliedAmount).toBe(90);
    expect(d.totalCharge).toBeCloseTo(30, 2);
  });
});
