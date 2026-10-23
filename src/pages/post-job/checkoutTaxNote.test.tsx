// @mutate src/components/postjob/CheckoutStep.tsx |   const taxedWhat = `$${formatPriceExact(taxedAmount)} job budget`; |   const taxedWhat = `$${formatPriceExact(taxedAmount)} job budget and fees`;
/**
 * Cowork design audit 2026-10-20, J3: the Post a job order summary said tax
 * applies "never to the fees" on a screen that listed no fee. The class: the
 * tax note states the SAME amount the tax quote is computed on (the job
 * budget; every fee line ships non-taxable, and the poster-fee model's taxed
 * service fee was removed, owner 2026-10-23), in every branch (ZIP missing,
 * checking, rate known). (A "Your Helpr receives" line was NOT added: owner
 * 2026-09-24 removed it, checkoutNoHelperPayLine.test.ts.)
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
    isUrgent: false, urgentFeeNum: 0, budgetNum: 100, helprActivity: null,
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

  it("with the rate known, the note names the same taxed amount: the job budget", () => {
    mockTax = 10.45;
    try {
      render(<CheckoutStepView form={makeForm({ totalCharge: 100 })} />);
      const note = screen.getByText(/so tax applies to the/i);
      expect(note.textContent).toContain("$100 job budget");
      expect(note.textContent).not.toMatch(/fee/i);
    } finally {
      mockTax = null;
    }
  });

  // Owner 2026-10-23 (#3555): a cleaning job the poster says cleans fabric is
  // taxed, and the note names the WORK, not the (untaxed) category.
  // @mutate src/components/postjob/CheckoutStep.tsx |             const taxable = hasTaxableLine(category, taxKind); |             const taxable = hasTaxableLine(category);
  it("a fabric-cleaning answer on an untaxed category is quoted as taxable work", () => {
    mockTax = 10.45;
    try {
      render(<CheckoutStepView form={makeForm({ category: "cleaning", categoryLabel: "Cleaning", taxKind: "fabric_cleaning", totalCharge: 100 })} />);
      const note = screen.getByText(/so tax applies to the/i);
      expect(note.textContent).toContain("Cleaning carpet, rugs or furniture is taxable labor in Louisiana");
      expect(note.textContent).toContain("$100 job budget");
    } finally {
      mockTax = null;
    }
  });

  it("an untaxed category with no answer shows no tax note", () => {
    render(<CheckoutStepView form={makeForm({ category: "cleaning", categoryLabel: "Cleaning", taxKind: null })} />);
    expect(screen.queryByText(/tax applies to the/i)).toBeNull();
  });
});
