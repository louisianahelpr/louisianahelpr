// @mutate src/components/postjob/CheckoutStep.tsx | ? `$${formatPriceExact(taxedAmount)} (the job budget and service fee)` | ? `$${formatPriceExact(budgetNum)} job budget`
/**
 * Cowork design audit 2026-10-20, J3: the Post a Job order summary said tax
 * applies "never to the fees" on a screen that listed no fee, and the same
 * sentence would be false on the poster-fee model, where a taxable job's
 * service fee is taxed with it (CheckoutStep's taxedAmount, the figure the
 * Stripe tax quote is asked for). The class: the tax note states the SAME
 * amount the tax quote is computed on, in every branch (ZIP missing, checking,
 * rate known), with and without a fee. (A "Your Helpr receives" line was NOT
 * added: owner 2026-09-24 removed it, checkoutNoHelperPayLine.test.ts.)
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CheckoutStepView } from "./CheckoutStepView";
import type { usePostJobForm } from "./usePostJobForm";

let mockTax: number | null = null;
vi.mock("@/hooks/useStripeSalesTax", () => ({
  useStripeSalesTax: () => ({ salesTax: mockTax, loading: false, jurisdiction: null }),
}));

function makeForm(over: Record<string, unknown> = {}): ReturnType<typeof usePostJobForm> {
  const form = {
    setStep: vi.fn(), title: "Build a bookshelf", description: "Flat-pack bookshelf, two hours.",
    categoryLabel: "Assembly", category: "assembly", imagePreviews: [], streetAddress: "314 Lynn St",
    city: "Delcambre", addrState: "LA", zipCode: "", dateNeeded: "2026-10-23", startTime: "09:00",
    estimatedHours: "", isFlexibleSchedule: false, specialRequirements: "", isRecurring: false,
    recurrenceInterval: "", recurrenceEndDate: "", recurrenceDays: [], recurrenceWeeks: 0,
    isUrgent: false, urgentFeeNum: 0, budgetNum: 100, helprActivity: null, customerFeeAmount: 0,
    onboardingFeeAmount: 0, totalCharge: 100, hasGift: false, giftAppliedAmount: 0, giftCreditAmount: 0,
    giftLoading: false, giftUnavailable: false, confirmed: false, setConfirmed: vi.fn(),
    saveCardForFuture: false, setSaveCardForFuture: vi.fn(), saving: false, redirecting: false,
    uploading: false, uploadProgress: null, handleSubmit: vi.fn(), parish: "Vermilion",
    ...over,
  };
  return form as unknown as ReturnType<typeof usePostJobForm>;
}

describe("J3: the tax note names exactly what is taxed", () => {
  it("with no fee listed, it never mentions fees", () => {
    render(<CheckoutStepView form={makeForm()} />);
    const note = screen.getByText(/tax applies to the/i);
    expect(note.textContent, note.textContent ?? "").toContain("$100 job budget");
    expect(note.textContent).not.toMatch(/fee/i);
  });

  it("with a service fee on a taxable job, the taxed amount includes it (the figure the Stripe quote is asked for)", () => {
    render(<CheckoutStepView form={makeForm({ customerFeeAmount: 5.7, totalCharge: 105.7 })} />);
    const note = screen.getByText(/tax applies to the/i);
    expect(note.textContent).toContain("$105.70 (the job budget and service fee)");
    expect(note.textContent).not.toMatch(/never/i);
  });

  it("with the rate known, the note names the same taxed amount", () => {
    mockTax = 10.57;
    try {
      render(<CheckoutStepView form={makeForm({ customerFeeAmount: 5.7, totalCharge: 105.7 })} />);
      const note = screen.getByText(/so tax applies to the/i);
      expect(note.textContent).toContain("$105.70 (the job budget and service fee)");
      expect(note.textContent).not.toMatch(/never/i);
    } finally {
      mockTax = null;
    }
  });
});
