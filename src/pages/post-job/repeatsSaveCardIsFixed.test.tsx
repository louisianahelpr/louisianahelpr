// A3-108 (audit 11-01): on a Repeats job, Review showed a "Save card for next time" switch the poster could turn off,
// while useJobSubmit sends `saveCardForFuture: saveCardForFuture || isRecurring`, so the card was saved anyway. A
// Repeats job now says so in a fixed line (the later visits are charged to it, charge-recurring-visits FUND_LEAD_DAYS
// = 3); a one-off job keeps the switch.
//
// @mutate src/components/postjob/CheckoutStep.tsx |       {setSaveCardForFuture && isRecurring ? ( |       {setSaveCardForFuture && false ? (
// @mutate src/pages/post-job/useJobSubmit.ts |         saveCardForFuture: saveCardForFuture \|\| isRecurring, |         saveCardForFuture,
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { CheckoutStepView } from "./CheckoutStepView";
import type { usePostJobForm } from "./usePostJobForm";
import { blankComments } from "@/test/helpers/blankNonCode";

vi.mock("@/hooks/useStripeSalesTax", () => ({
  useStripeSalesTax: () => ({ salesTax: 0, loading: false, jurisdiction: null }),
}));

function makeForm(over: Record<string, unknown> = {}): ReturnType<typeof usePostJobForm> {
  return {
    setStep: vi.fn(), title: "Mow my lawn", description: "Front and back, bag the clippings.", categoryLabel: "Yard work",
    category: "yard_work", imagePreviews: [], streetAddress: "314 Lynn St", city: "Delcambre", addrState: "LA", zipCode: "70528",
    dateNeeded: "2026-11-02", startTime: "09:00", estimatedHours: "", isFlexibleSchedule: false, specialRequirements: "",
    isRecurring: false, recurrenceInterval: "", recurrenceEndDate: "", recurrenceDays: [], recurrenceWeeks: 0,
    isGroupJob: false, helpersNeeded: "2",
    isUrgent: false, urgentFeeNum: 0, budgetNum: 40, helprActivity: null, customerFeeAmount: 0, onboardingFeeAmount: 0,
    totalCharge: 40, hasGift: false, giftAppliedAmount: 0, giftCreditAmount: 0, giftLoading: false, giftUnavailable: false,
    confirmed: false, setConfirmed: vi.fn(), saveCardForFuture: false, setSaveCardForFuture: vi.fn(), saving: false,
    redirecting: false, uploading: false, uploadProgress: null, handleSubmit: vi.fn(), parish: "Vermilion",
    ...over,
  } as unknown as ReturnType<typeof usePostJobForm>;
}

describe("A3-108: a Repeats job never offers a save-card switch that does nothing", () => {
  it("a one-off job keeps the switch", () => {
    render(<CheckoutStepView form={makeForm()} />);
    expect(screen.getByText("Save card for next time")).toBeTruthy();
    expect(document.getElementById("save-card")).not.toBeNull();
    expect(document.querySelector("[data-save-card-fixed]")).toBeNull();
  });

  it("a Repeats job: no switch, a fixed line saying the card pays each later visit", () => {
    render(<CheckoutStepView form={makeForm({ isRecurring: true, recurrenceInterval: "weekly", recurrenceDays: [1], recurrenceWeeks: 4 })} />);
    expect(document.getElementById("save-card")).toBeNull();
    expect(screen.queryByText("Save card for next time")).toBeNull();
    expect(document.querySelector("[data-save-card-fixed]")?.textContent).toBe("Your card is saved to pay for each later visit, about 3 days before it.");
  });

  it("the reason holds: the submit saves the card on every Repeats job", () => {
    const src = blankComments(readFileSync("src/pages/post-job/useJobSubmit.ts", "utf8"));
    expect(src).toContain("saveCardForFuture: saveCardForFuture || isRecurring,");
  });
});
