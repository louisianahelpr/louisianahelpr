/**
 * Gift first on the jobs poster fee (owner 2026-10-18, Q1996 slice 3b).
 *
 * On the poster-fee model the gift pays the job price AND the 5% + 70c fee
 * first; any rest is the card shortfall. redeem_gift_card (20261018031451)
 * adds the stamped fee to the cost it applies the gift against, so the app's
 * quote must add the same fee, or the poster is shown less than the shortfall
 * checkout charges (create-payment then opens a checkout for the larger
 * amount). Flat model (switch off): unchanged, no fee.
 *
 * @mutate src/pages/post-job/useJobDerived.ts |   const giftCostCents = Math.round((budgetNum + urgentFeeNum) * 100) + Math.round(customerFeeAmount * 100); |   const giftCostCents = Math.round((budgetNum + urgentFeeNum) * 100);
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

describe("gift first on the poster fee (client quote == redeem_gift_card)", () => {
  it("switch ON, $90 gift on a $100 job: the gift applies $90 and the card pays $15.70 (job + $5.70 fee)", () => {
    const d = derive({ posterFeeOn: true, giftCardAmount: 90 });
    expect(d.customerFeeAmount).toBe(5.7);
    expect(d.giftAppliedAmount).toBe(90);
    expect(d.totalCharge).toBeCloseTo(15.7, 2);
  });

  it("switch ON, $120 gift: the gift covers job + fee ($105.70) and nothing is charged", () => {
    const d = derive({ posterFeeOn: true, giftCardAmount: 120 });
    expect(d.giftAppliedAmount).toBeCloseTo(105.7, 2);
    expect(d.totalCharge).toBe(0);
  });

  it("switch OFF: a gift pays the job price only (flat model, no fee)", () => {
    const d = derive({ posterFeeOn: false, giftCardAmount: 90 });
    expect(d.customerFeeAmount).toBe(0);
    expect(d.totalCharge).toBeCloseTo(10, 2);
  });
});
