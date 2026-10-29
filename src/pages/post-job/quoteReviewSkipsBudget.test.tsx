/**
 * A2-C32 (audit 2026-10-28, testers; lead option A): Get quotes has a Review screen too. A quote ask has no
 * price, so useJobSubmit's handleReview opens Review for it without the budget checks; every other check
 * (title, address, schedule) still runs, and a priced post still needs its budget.
 *
 * @mutate src/pages/post-job/useJobSubmit.ts |     if (opts.quotes) { setStep("checkout"); return; }\n |
 */
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getUser: vi.fn() } } }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), warning: vi.fn() }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { toast } from "sonner";
import { useJobSubmit, type UseJobSubmitParams } from "./useJobSubmit";

function params(over: Partial<UseJobSubmitParams> = {}): UseJobSubmitParams {
  return {
    saving: false, setSaving: vi.fn(), setRedirecting: vi.fn(), setStep: vi.fn(), setConfirmed: vi.fn(), flushDraft: vi.fn(),
    title: "Paint the back fence", description: "About 60 feet of wood fence, two coats.", category: "painting",
    streetAddress: "100 Main St", city: "Baton Rouge", addrState: "LA", zipCode: "70801", parish: "East Baton Rouge",
    dateNeeded: jobLocalDateISO(3), startTime: "09:00", isFlexibleSchedule: false, estimatedHours: "4",
    budget: "", specialRequirements: "", isRecurring: false, recurrenceInterval: "", recurrenceEndDate: "",
    recurrenceDays: [], recurrenceWeeks: 0, isGroupJob: false, helpersNeeded: "1", isUrgent: false, urgentFee: "",
    salesTaxRate: 0, offerToHelperId: null, offerResponseHours: 24, credentialTier: 0, requirePhotoProof: true,
    includeMaterials: false, materialsNote: "", saveCardForFuture: false, giftCardId: null,
    uploadAndAttachPhotos: async () => {}, uploadAndAttachScopeVideo: async () => {},
    ...over,
  };
}
const ev = () => ({ preventDefault: vi.fn() }) as unknown as React.FormEvent;

describe("Get quotes' Review needs no budget (A2-C32)", () => {
  it("a quote ask with no budget opens Review", () => {
    const p = params();
    const { result } = renderHook(() => useJobSubmit(p));
    result.current.handleReview(ev(), { quotes: true });
    expect(p.setStep).toHaveBeenCalledWith("checkout");
  });

  it("the inventory is real: a priced post with no budget is refused, and Review stays shut", () => {
    vi.mocked(toast.error).mockClear();
    const p = params();
    const { result } = renderHook(() => useJobSubmit(p));
    result.current.handleReview(ev());
    expect(p.setStep).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error).mock.calls.map((c) => String(c[0])).join(" ")).toMatch(/Minimum budget/);
  });

  it("a quote ask still runs the other checks: no address, no Review", () => {
    const p = params({ streetAddress: "" });
    const { result } = renderHook(() => useJobSubmit(p));
    result.current.handleReview(ev(), { quotes: true });
    expect(p.setStep).not.toHaveBeenCalled();
  });
});
